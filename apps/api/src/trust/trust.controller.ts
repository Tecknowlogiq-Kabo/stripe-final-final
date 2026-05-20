import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrustService } from './trust.service';
import { CreateTrustTokenDto } from './dto/create-trust-token.dto';
import { Public } from '../auth/decorators/public.decorator';
import { TrustGuard } from './trust.guard';

@Controller('trust')
export class TrustController {
  private readonly logger = new Logger(TrustController.name);

  constructor(
    private readonly trustService: TrustService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a new trust token via TrustID Cloud (if configured) or local fallback.
   * Returns the trustId (JWT) and guest link URL.
   */
  @Post('tokens')
  @HttpCode(HttpStatus.CREATED)
  async createToken(@Body() dto: CreateTrustTokenDto) {
    const result = await this.trustService.generateTrustToken(
      dto.resourceType,
      dto.resourceId,
      undefined, // createdBy
      undefined, // userId (no auth context on public token creation)
      dto.metadata,
      dto.ttlSeconds,
      dto.email,
      dto.name,
      dto.clientApplicationReference,
      dto.branchId,
      dto.applicationFlexibleFieldValues,
    );
    return {
      trustId: result.trustId,
      tokenId: result.tokenId,
      guestLink: result.guestLink,
      expiresAt: result.expiresAt.toISOString(),
      containerId: result.containerId ?? null,
    };
  }

  /**
   * GET /trust/:trustId — validate token and return full status info.
   * Public — guest users see this page.
   */
  @Public()
  @Get(':trustId')
  async validateToken(@Param('trustId') trustId: string) {
    const payload = await this.trustService.validateTrustToken(trustId);
    if (!payload) {
      return { valid: false };
    }

    // Get full record for status + expiry
    const record = await this.trustService.getTokenStatus(trustId);
    return {
      valid: true,
      tokenId: payload.sub,
      resourceType: payload.resourceType,
      resourceId: payload.resourceId,
      status: record?.status ?? 'pending',
      expiresAt: record?.expiresAt?.toISOString() ?? null,
    };
  }

  /**
   * GET /trust/:trustId/guest-link — returns the full guest page URL.
   * If the token was created via TrustID Cloud, returns the TrustID guest URL.
   * Otherwise falls back to the local trust page.
   */
  @Public()
  @Get(':trustId/guest-link')
  async getGuestLink(@Param('trustId') trustId: string) {
    const payload = await this.trustService.validateTrustToken(trustId);
    if (!payload) {
      return { valid: false, guestLink: null };
    }

    // Check if a TrustID Cloud URL is stored in the token metadata
    const status = await this.trustService.getTokenStatus(trustId);
    if (status?.metadata) {
      try {
        const meta = JSON.parse(status.metadata);
        if (meta.trustidGuestLink || meta.guestLinkUrl) {
          return { valid: true, guestLink: meta.trustidGuestLink ?? meta.guestLinkUrl };
        }
      } catch { /* fall through to local */ }
    }

    const guestLink = `${this.configService.get('trust.guestLinkBaseUrl') ?? 'http://localhost:3000'}/trust/${trustId}`;
    return { valid: true, guestLink };
  }

  /**
   * POST /trust/webhook — webhook endpoint for external systems to approve/deny trust tokens.
   * Public. Called by external services (webhook senders) to trigger approval/denial.
   * Body: { trustId: string, action: 'approve' | 'deny' }
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() body: { trustId: string; action: 'approve' | 'deny' }) {
    this.logger.log({
      message: 'Trust webhook received',
      trustId: body.trustId?.substring(0, 20) + '...',
      action: body.action,
    });

    if (body.action === 'approve') {
      const approved = await this.trustService.approve(body.trustId);
      return { action: 'approve', success: approved };
    }

    if (body.action === 'deny') {
      const denied = await this.trustService.deny(body.trustId);
      return { action: 'deny', success: denied };
    }

    return { success: false, message: 'Invalid action. Use "approve" or "deny".' };
  }

  /**
   * Approve a trustId. Public (guest-facing).
   */
  @Public()
  @Post(':trustId/approve')
  @HttpCode(HttpStatus.OK)
  async approve(@Param('trustId') trustId: string) {
    const approved = await this.trustService.approve(trustId);
    if (!approved) {
      return { approved: false, message: 'Token is invalid, expired, or already acted upon' };
    }
    return { approved: true };
  }

  /**
   * Deny a trustId. Public (guest-facing).
   */
  @Public()
  @Post(':trustId/deny')
  @HttpCode(HttpStatus.OK)
  async deny(@Param('trustId') trustId: string) {
    const denied = await this.trustService.deny(trustId);
    if (!denied) {
      return { denied: false, message: 'Token is invalid, expired, or already acted upon' };
    }
    return { denied: true };
  }
}
