import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types — TrustID Cloud API (Workflow 4)
// ---------------------------------------------------------------------------

export interface CreateGuestLinkParams {
  email: string;
  name: string;
  branchId?: string;
  applicationFlexibleFieldValues?: { flexibleFieldVersionId: string; fieldValueString: string }[];
  clientApplicationReference?: string;
  digitalIdentityScheme?: number;
  sendEmail?: boolean;
  callbackHeaders?: { Header: string; Value: string }[];
}

export interface CreateGuestLinkResult {
  linkId: string;
  guestLinkUrl: string;
  containerId: string;
}

export interface TrustIdBranch {
  id: string;
  name: string;
}

export interface TrustIdFlexibleField {
  flexibleFieldVersionId: string;
  fieldName: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class TrustIdService {
  private readonly logger = new Logger(TrustIdService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly username: string;
  private readonly password: string;
  private readonly webhookCallbackBaseUrl: string;
  // In-memory session cache with TTL
  private sessionData: { sessionId: string; deviceId: string; expiresAt: number } | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.baseUrl = this.configService.get<string>('trustid.apiBaseUrl') ?? 'https://api.trustid.co.uk';
    this.apiKey = this.configService.get<string>('trustid.apiKey') ?? '';
    this.username = this.configService.get<string>('trustid.username') ?? '';
    this.password = this.configService.get<string>('trustid.password') ?? '';
    this.webhookCallbackBaseUrl =
      this.configService.get<string>('trustid.webhookCallbackBaseUrl') ??
      this.configService.get<string>('cors.origin') ??
      'http://localhost:3001';

    this.logger.log({
      message: 'TrustIdService initialized',
      baseUrl: this.baseUrl,
      webhookCallbackBaseUrl: this.webhookCallbackBaseUrl,
      hasApiKey: !!this.apiKey,
      hasCredentials: !!(this.username && this.password),
    });
  }

  // -----------------------------------------------------------------------
  // Auth helpers
  // -----------------------------------------------------------------------

  private async getDeviceId(): Promise<string> {
    return randomUUID();
  }

  private async ensureSession(): Promise<{ sessionId: string; deviceId: string }> {
    if (this.sessionData && Date.now() < this.sessionData.expiresAt) {
      return { sessionId: this.sessionData.sessionId, deviceId: this.sessionData.deviceId };
    }

    if (!this.username || !this.password || !this.apiKey) {
      throw new InternalServerErrorException('TrustID Cloud is not configured (missing credentials)');
    }

    return this.login();
  }

  /**
   * Authenticate with TrustID Cloud.
   * POST /VPE/session/login/
   */
  async login(): Promise<{ sessionId: string; deviceId: string }> {
    const deviceId = await this.getDeviceId();

    this.logger.log({ message: 'TrustID login', deviceId });

    const { data } = await firstValueFrom(
      this.httpService.post<{ Success?: boolean; SessionId?: string; sessionId?: string; Message?: string }>(
        `${this.baseUrl}/VPE/session/login/`,
        { Username: this.username, Password: this.password, DeviceId: deviceId },
        { headers: this.baseHeaders() },
      ),
    );

    const sessionId = data.SessionId ?? data.sessionId;
    if (!sessionId) {
      throw new InternalServerErrorException(
        `TrustID login failed: ${data.Message ?? 'No SessionId in response'}`,
      );
    }

    this.sessionData = { sessionId, deviceId, expiresAt: Date.now() + 15 * 60 * 1000 };
    this.logger.log({ message: 'TrustID login succeeded', deviceId });
    return { sessionId, deviceId };
  }

  /**
   * Test connectivity to TrustID Cloud. No auth required.
   * POST /VPE/session/testConnection/
   */
  async testConnection(): Promise<boolean> {
    try {
      await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/VPE/session/testConnection/`, {}, { headers: this.baseHeaders() }),
      );
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Branches & fields
  // -----------------------------------------------------------------------

  async getBranches(): Promise<TrustIdBranch[]> {
    const session = await this.ensureSession();
    const { data } = await firstValueFrom(
      this.httpService.post<{ Success?: boolean; Branches?: { Id: string; Name: string }[] }>(
        `${this.baseUrl}/VPE/session/branches/`,
        { DeviceId: session.deviceId, SessionId: session.sessionId },
        { headers: this.baseHeaders() },
      ),
    );
    return (data.Branches ?? []).map((b) => ({ id: b.Id, name: b.Name }));
  }

  /**
   * getApplicationFlexibleFields — the canonical name.
   * Also aliased as getFlexibleFields for backward compat.
   */
  async getApplicationFlexibleFields(branchId: string): Promise<TrustIdFlexibleField[]> {
    const session = await this.ensureSession();
    const { data } = await firstValueFrom(
      this.httpService.post<{ Success?: boolean; FlexibleFields?: { FlexibleFieldVersionId: string; FieldName: string }[] }>(
        `${this.baseUrl}/VPE/session/applicationFlexibleFields/`,
        { DeviceId: session.deviceId, SessionId: session.sessionId, BranchId: branchId },
        { headers: this.baseHeaders() },
      ),
    );
    return (data.FlexibleFields ?? []).map((f) => ({
      flexibleFieldVersionId: f.FlexibleFieldVersionId,
      fieldName: f.FieldName,
    }));
  }

  /** Backward-compat alias. */
  async getFlexibleFields(branchId: string): Promise<TrustIdFlexibleField[]> {
    return this.getApplicationFlexibleFields(branchId);
  }

  // -----------------------------------------------------------------------
  // Guest link (core of Workflow 4)
  // -----------------------------------------------------------------------

  /**
   * Create a TrustID guest link.
   * POST /VPE/guestLink/createGuestLink/
   */
  async createGuestLink(params: CreateGuestLinkParams): Promise<CreateGuestLinkResult> {
    const session = await this.ensureSession();

    let branchId = params.branchId;
    if (!branchId) {
      const branches = await this.getBranches();
      if (branches.length === 0) throw new InternalServerErrorException('No TrustID branches available');
      branchId = branches[0].id;
    }

    const fields = params.applicationFlexibleFieldValues ?? [];
    if (params.clientApplicationReference && fields.length === 0) {
      fields.push({ flexibleFieldVersionId: 'client-reference', fieldValueString: params.clientApplicationReference });
    }

    const callbackUrl = `${this.webhookCallbackBaseUrl}/api/v1/webhooks/trustid`;

    const body: Record<string, unknown> = {
      DeviceId: session.deviceId,
      SessionId: session.sessionId,
      Email: params.email,
      Name: params.name,
      BranchId: branchId,
      ApplicationFlexibleFieldValues: fields,
      ContainerEventCallbackUrl: callbackUrl,
      ContainerEventCallbackHeaders: params.callbackHeaders ?? [],
      ClientApplicationReference: params.clientApplicationReference ?? '',
      SendEmail: params.sendEmail ?? true,
    };
    if (params.digitalIdentityScheme !== undefined) body.DigitalIdentityScheme = params.digitalIdentityScheme;

    this.logger.log({ message: 'Creating TrustID guest link', email: params.email, branchId, callbackUrl });

    const { data } = await firstValueFrom(
      this.httpService.post<{
        Success?: boolean; LinkId?: string; linkId?: string; GuestLink?: string; guestLink?: string;
        ContainerId?: string; containerId?: string;
      }>(
        `${this.baseUrl}/VPE/guestLink/createGuestLink/`,
        body,
        { headers: this.baseHeaders() },
      ),
    );

    const linkId = data.LinkId ?? data.linkId ?? '';
    const guestLinkUrl = data.GuestLink ?? data.guestLink ?? '';
    const containerId = data.ContainerId ?? data.containerId ?? '';

    if (!linkId || !guestLinkUrl) {
      throw new InternalServerErrorException('TrustID guest link creation failed — unexpected response');
    }

    this.logger.log({ message: 'TrustID guest link created', linkId, containerId });
    return { linkId, guestLinkUrl, containerId };
  }

  // -----------------------------------------------------------------------
  // Retrieval
  // -----------------------------------------------------------------------

  /**
   * Retrieve full document container.
   * POST /VPE/dataAccess/retrieveDocumentContainer/
   */
  async retrieveDocumentContainer(containerId: string): Promise<Record<string, unknown>> {
    const session = await this.ensureSession();
    const { data } = await firstValueFrom(
      this.httpService.post<{ Container?: Record<string, unknown>; container?: Record<string, unknown> }>(
        `${this.baseUrl}/VPE/dataAccess/retrieveDocumentContainer/`,
        { DeviceId: session.deviceId, SessionId: session.sessionId, ContainerId: containerId },
        { headers: this.baseHeaders() },
      ),
    );
    return (data.Container ?? data.container ?? {}) as Record<string, unknown>;
  }

  /**
   * Retrieve a document image as binary Buffer.
   * POST /VPE/dataAccess/retrieveImage/
   */
  async retrieveImage(imageId: string): Promise<Buffer> {
    const session = await this.ensureSession();
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.baseUrl}/VPE/dataAccess/retrieveImage/`,
        { DeviceId: session.deviceId, SessionId: session.sessionId, ImageId: imageId },
        { headers: this.baseHeaders(), responseType: 'arraybuffer' },
      ),
    );
    return Buffer.from(response.data);
  }

  /**
   * Export PDF report.
   * POST /VPE/dataAccess/exportPDF/
   */
  async exportPdf(containerId: string): Promise<Buffer> {
    const session = await this.ensureSession();
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.baseUrl}/VPE/dataAccess/exportPDF/`,
        { DeviceId: session.deviceId, SessionId: session.sessionId, ContainerId: containerId },
        { headers: this.baseHeaders(), responseType: 'arraybuffer' },
      ),
    );
    return Buffer.from(response.data);
  }

  /** Backward-compat alias with capital PDF. */
  async exportPDF(containerId: string): Promise<Buffer> {
    return this.exportPdf(containerId);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private baseHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', 'Tid-Api-Key': this.apiKey };
  }
}
