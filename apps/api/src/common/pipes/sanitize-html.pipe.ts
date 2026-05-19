import { PipeTransform, Injectable } from '@nestjs/common';

/**
 * Strip HTML tags and event-handler patterns from a string to prevent stored XSS.
 *
 * Handles:
 * - Full tag removal: <script>, <img>, <div>, etc.
 * - Event handlers in leftovers: onerror=, onclick=, etc.
 * - javascript: URLs
 * - HTML entities that encode < or >
 */
function sanitizeString(value: string): string {
  let clean = value;

  // Remove all HTML tags (<anything>)
  clean = clean.replace(/<[^>]*>/g, '');

  // Remove event-handler patterns: onerror="...", onclick='...', etc.
  clean = clean.replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');

  // Remove javascript: URLs
  clean = clean.replace(/javascript\s*:/gi, '');

  // Decode common HTML entities and re-sanitize
  clean = clean
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');

  // After decoding, strip any tags that appeared
  clean = clean.replace(/<[^>]*>/g, '');

  return clean.trim();
}

/** Recursively sanitize all string values in an object, skipping passwords. */
function sanitizeDeep(input: unknown): unknown {
  if (typeof input === 'string') return sanitizeString(input);
  if (Array.isArray(input)) return input.map(sanitizeDeep);
  if (input !== null && typeof input === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      // Preserve passwords — they're hashed, never rendered
      if (key === 'password') {
        sanitized[key] = value;
      } else {
        sanitized[key] = sanitizeDeep(value);
      }
    }
    return sanitized;
  }
  return input;
}

/**
 * Global pipe that strips HTML tags and event handlers from all incoming
 * request string fields. Applied before validation so DTO decorators
 * operate on clean values.
 *
 * Defense-in-depth against stored XSS: even if a frontend renders user
 * data without encoding, injected script/event tags are neutralized
 * at the API boundary.
 */
@Injectable()
export class SanitizeHtmlPipe implements PipeTransform {
  transform(value: unknown) {
    return sanitizeDeep(value);
  }
}