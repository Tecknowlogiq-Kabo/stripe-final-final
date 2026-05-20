import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { TrustIdService } from './trustid.service';
import { TrustService } from '../trust/trust.service';
import { TrustRepository } from '../trust/trust.repository';
import { CreateGuestLinkDto } from './dto/create-guest-link.dto';
import { CurrentUser, JwtUser } from '../auth/decorators/current-user.decorator';

@Controller('trustid')
export class TrustIdController {
  private readonly logger = new Logger(TrustIdController.name);

  constructor(
    private readonly trustIdService: TrustIdService,
    private readonly trustService: TrustService,
    private readonly trustRepo: TrustRepository,
  ) {}

  @Post('guest-link')
  @HttpCode(HttpStatus.CREATED)
  async createGuestLink(
    @Body() dto: CreateGuestLinkDto,
    @CurrentUser() user: JwtUser,
  ) {
    this.logger.log({ message: 'Creating TrustID guest link', email: dto.email, userId: user.id });

    const fields = (dto.applicationFlexibleFieldValues ?? []).map((fv) => ({
      flexibleFieldVersionId: fv.flexibleFieldVersionId,
      fieldValueString: fv.fieldValueString,
    }));

    const result = await this.trustIdService.createGuestLink({
      email: dto.email,
      name: dto.name,
      branchId: dto.branchId,
      applicationFlexibleFieldValues: fields,
      clientApplicationReference: dto.clientApplicationReference,
      sendEmail: dto.sendEmail,
    });

    const trustToken = await this.trustService.generateTrustToken(
      dto.resourceType ?? 'trustid-check',
      dto.resourceId ?? result.containerId,
      user.email,
      user.id,
      { trustidLinkId: result.linkId, trustidContainerId: result.containerId, trustidGuestLink: result.guestLinkUrl, email: dto.email, name: dto.name, ...(dto.metadata ?? {}) },
      dto.sendEmail === false ? 7 * 24 * 3600 : undefined,
    );

    return { trustId: trustToken.trustId, guestLink: result.guestLinkUrl, containerId: result.containerId, linkId: result.linkId };
  }

  @Get('tokens')
  async getMyTokens(@CurrentUser() user: JwtUser) {
    const tokens = await this.trustRepo.findByUserId(user.id);
    return {
      tokens: tokens.map((t) => ({
        id: t.id,
        resourceType: t.resourceType,
        resourceId: t.resourceId,
        status: t.status,
        expiresAt: t.expiresAt?.toISOString?.() ?? t.expiresAt,
        metadata: t.metadata ? JSON.parse(t.metadata) : null,
        createdAt: t.createdAt?.toISOString?.() ?? t.createdAt,
      })),
    };
  }

  @Get('branches')
  async getBranches() {
    return { branches: await this.trustIdService.getBranches() };
  }

  @Get('fields')
  async getFields(@Query('branchId') branchId: string) {
    if (!branchId) return { fields: [], message: 'branchId query parameter is required' };
    return { fields: await this.trustIdService.getFlexibleFields(branchId) };
  }

  @Get('container/:containerId')
  async getContainer(@Param('containerId') containerId: string) {
    this.logger.log({ message: 'Retrieving TrustID container', containerId });
    const c = await this.trustIdService.retrieveDocumentContainer(containerId) as Record<string, unknown>;
    const docs = (c.Documents ?? []) as Record<string, unknown>[];
    return {
      containerId: c.Id ?? containerId,
      applicationCode: c.ApplicationContainerCode ?? null,
      status: c.Status ?? null,
      applicationName: c.ApplicationName ?? null,
      documents: docs.map((doc: Record<string, unknown>) => ({
        id: doc.Id,
        name: doc.Name,
        type: doc.DocumentTypeName,
        status: doc.Status,
        images: ((doc.Images ?? []) as Record<string, unknown>[]).map((img: Record<string, unknown>) => ({ id: img.Id, name: img.Name })),
      })),
    };
  }

  @Get('document/:imageId')
  async getDocumentImage(@Param('imageId') imageId: string, @Res({ passthrough: false }) res: Response) {
    this.logger.log({ message: 'Retrieving TrustID image', imageId });
    const buf = await this.trustIdService.retrieveImage(imageId);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  }

  @Get('report/:containerId/pdf')
  async getPDFReport(@Param('containerId') containerId: string, @Res({ passthrough: false }) res: Response) {
    this.logger.log({ message: 'Generating TrustID PDF', containerId });
    const pdf = await this.trustIdService.exportPDF(containerId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Content-Disposition', `attachment; filename="trustid-report-${containerId}.pdf"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(pdf);
  }
}
