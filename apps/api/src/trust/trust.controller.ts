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
import { TrustService } from './trust.service';
import { CreateTrustTokenDto } from './dto/create-trust-token.dto';
import { Public } from '../auth/decorators/public.decorator';
import { TrustGuard } from './trust.guard';

@Controller('trust')
export class TrustController {
  private readonly logger = new Logger(TrustController.name);

  constructor(private readonly trustService: TrustService) {}

  /**
   * Create a new trust token. Requires authentication.
   * Returns the trustId (JWT) and guest link URL.
   */
  @Post('tokens')
  @HttpCode(HttpStatus.CREATED)
  async createToken(@Body() dto: CreateTrustTokenDto) {
    const result = await this.trustService.generateTrustToken(
      dto.resourceType,
      dto.resourceId,
      undefined, // createdBy pulled from auth context if available
      dto.metadata,
      dto.ttlSeconds,
    );
    return {
      trustId: result.trustId,
      tokenId: result.tokenId,
      guestLink: result.guestLink,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  /**
   * GET /trust/:trustId — validate token and return resource info.
   * Public — guest users use this to view what they're approving.
   */
  @Public()
  @Get(':trustId')
  async validateToken(@Param('trustId') trustId: string) {
    const payload = await this.trustService.validateTrustToken(trustId);
    if (!payload) {
      return { valid: false };
    }
    return {
      valid: true,
      resourceType: payload.resourceType,
      resourceId: payload.resourceId,
    };
  }

  /**
   * GET /trust/:trustId/guest-link — returns the full web guest page URL.
   * Public — guests need to retrieve their link.
   */
  @Public()
  @Get(':trustId/guest-link')
  async getGuestLink(@Param('trustId') trustId: string) {
    // Re-validate to ensure it's still active
    const payload = await this.trustService.validateTrustToken(trustId);
    if (!payload) {
      return { valid: false, guestLink: null };
    }
    const guestLink = `${process.env.TRUST_GUEST_LINK_BASE_URL ?? 'http://localhost:3000'}/trust/${trustId}`;
    return { valid: true, guestLink };
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
