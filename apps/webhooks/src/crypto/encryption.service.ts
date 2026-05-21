import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Encrypts/decrypts webhook payloads at rest using AES-256-GCM.
 *
 * Required for GDPR compliance: Stripe webhook payloads contain PII
 * (customer email, name, address, payment method last4) stored as plaintext
 * CLOBs in STRIPE_WEBHOOK_EVENTS.PAYLOAD.
 *
 * Key management:
 *   - ENCRYPTION_KEY must be a 32-byte hex string (64 chars) or a passphrase
 *   - If a passphrase, it's hashed via SHA-256 to derive a 32-byte key
 *   - Missing key → encryption is skipped with a warning (dev convenience)
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private key: Buffer | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('encryption.key');
    if (!raw) {
      this.logger.warn(
        'ENCRYPTION_KEY not set — webhook payloads will be stored as plaintext. ' +
        'Set this before handling real customer data.',
      );
      return;
    }

    // If it's a 64-char hex string, use directly; otherwise hash it
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      this.key = Buffer.from(raw, 'hex');
    } else {
      // Derive 32-byte key from passphrase via SHA-256
      const { createHash } = require('crypto');
      this.key = createHash('sha256').update(raw).digest();
    }
  }

  /**
   * Encrypts plaintext. Returns "iv:authTag:ciphertext" as hex.
   * Returns plaintext unchanged if encryption is not configured.
   */
  encrypt(plaintext: string): string {
    if (!this.key) return plaintext;

    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext (all hex-encoded)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Decrypts ciphertext. Expects "iv:authTag:ciphertext" hex format.
   * Returns plaintext unchanged if not in encrypted format or encryption is not configured.
   */
  decrypt(ciphertext: string): string {
    if (!this.key) return ciphertext;

    const parts = ciphertext.split(':');
    if (parts.length !== 3) return ciphertext; // Not encrypted

    try {
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = Buffer.from(parts[2], 'hex');

      const decipher = createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch (err) {
      this.logger.error({ message: 'Decryption failed — may be old plaintext data', err });
      return ciphertext;
    }
  }
}
