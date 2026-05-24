import { Injectable, Logger, InternalServerErrorException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import { BranchSelectorService } from './branch-selector.service';

// ---------------------------------------------------------------------------
// Types — TrustID Cloud API (Workflow 4)
// ---------------------------------------------------------------------------

/**
 * Digital Identity Schemes supported by TrustID Cloud.
 * Passed as `DigitalIdentityScheme` in createGuestLink requests.
 */
export enum DigitalIdentityScheme {
  /** Right To Rent (RTR) — requires RTRAgentName */
  RightToRent = 1,
  /** Right To Work (RTW) — optionally use RTWCompanyName */
  RightToWork = 2,
}

export interface CreateGuestLinkParams {
  email: string;
  name: string;
  branchId?: string;
  applicationFlexibleFieldValues?: { flexibleFieldVersionId: string; fieldValueString: string }[];
  clientApplicationReference?: string;
  digitalIdentityScheme?: DigitalIdentityScheme | number;
  /** Agent name for Right To Rent (RTR) share code downloads. Required when digitalIdentityScheme=1. */
  rtraAgentName?: string;
  /** Custom company name for Right To Work (RTW) share code document. */
  rtwCompanyName?: string;
  sendEmail?: boolean;
  callbackHeaders?: { Header: string; Value: string }[];
  /** Used for amount-based branch selection via BranchSelectorService. */
  amount?: number;
  /** Used for condition-based branch selection via BranchSelectorService. */
  conditionKey?: string;
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
  private readonly sessionTtlMs: number;
  // Stable deviceId — generated once per process lifetime.
  // TrustID expects the same DeviceId across logins (it identifies the
  // calling service, not each individual session).
  private readonly deviceId: string;
  // In-memory session cache with TTL.
  // Null means no active session; expired session triggers re-login
  // with the same deviceId.
  private sessionData: { sessionId: string; expiresAt: number } | null = null;

  // Refresh the session 30s before it actually expires so a mid-flight
  // operation (e.g. retrieving 20 images from a container) doesn't fail
  // because the session expired between image 12 and image 13.
  private static readonly SESSION_REFRESH_MARGIN_MS = 30_000;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => BranchSelectorService))
    private readonly branchSelectorService: BranchSelectorService,
  ) {
    this.baseUrl = this.configService.get<string>('trustid.apiBaseUrl') ?? 'https://api.trustid.co.uk';
    this.apiKey = this.configService.get<string>('trustid.apiKey') ?? '';
    this.username = this.configService.get<string>('trustid.username') ?? '';
    this.password = this.configService.get<string>('trustid.password') ?? '';
    this.sessionTtlMs =
      (this.configService.get<number>('trustid.sessionTtlSeconds') ?? 3600) * 1000;
    this.webhookCallbackBaseUrl =
      this.configService.get<string>('trustid.webhookCallbackBaseUrl') ??
      this.configService.get<string>('cors.origin') ??
      'http://localhost:3001';
    // Generate a stable deviceId once — re-used across all logins for
    // the lifetime of this NestJS service instance.
    this.deviceId = randomUUID();

    this.logger.log({
      message: 'TrustIdService initialized',
      baseUrl: this.baseUrl,
      webhookCallbackBaseUrl: this.webhookCallbackBaseUrl,
      deviceId: this.deviceId,
      sessionTtlMinutes: this.sessionTtlMs / 60_000,
      hasApiKey: !!this.apiKey,
      hasCredentials: !!(this.username && this.password),
    });
  }

  // -----------------------------------------------------------------------
  // Auth helpers
  // -----------------------------------------------------------------------

  /**
   * Returns the cached session if it's still valid (with a 30s margin to
   * prevent mid-operation expiry). Otherwise triggers a re-login using
   * the same stable deviceId.
   */
  private async ensureSession(): Promise<{ sessionId: string; deviceId: string }> {
    if (
      this.sessionData &&
      Date.now() < this.sessionData.expiresAt - TrustIdService.SESSION_REFRESH_MARGIN_MS
    ) {
      return { sessionId: this.sessionData.sessionId, deviceId: this.deviceId };
    }

    if (!this.username || !this.password || !this.apiKey) {
      throw new InternalServerErrorException('TrustID Cloud is not configured (missing credentials)');
    }

    return this.login();
  }

  /**
   * Authenticate with TrustID Cloud using the stable deviceId.
   * POST /VPE/session/login/
   *
   * On success the returned SessionId is cached with a TTL derived from
   * the configured `trustid.sessionTtlSeconds` (default 1 hour).
   */
  async login(): Promise<{ sessionId: string; deviceId: string }> {
    this.logger.log({ message: 'TrustID login', deviceId: this.deviceId });

    const { data } = await firstValueFrom(
      this.httpService.post<{ Success?: boolean; SessionId?: string; sessionId?: string; Message?: string }>(
        `${this.baseUrl}/VPE/session/login/`,
        { Username: this.username, Password: this.password, DeviceId: this.deviceId },
        { headers: this.baseHeaders() },
      ),
    );

    const sessionId = data.SessionId ?? data.sessionId;
    if (!sessionId) {
      throw new InternalServerErrorException(
        `TrustID login failed: ${data.Message ?? 'No SessionId in response'}`,
      );
    }

    this.sessionData = { sessionId, expiresAt: Date.now() + this.sessionTtlMs };
    this.logger.log({
      message: 'TrustID login succeeded',
      deviceId: this.deviceId,
      sessionTtlMinutes: this.sessionTtlMs / 60_000,
    });
    return { sessionId, deviceId: this.deviceId };
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
      // Try BranchSelectorService first (amount/condition rules)
      const resolved = this.branchSelectorService.resolveBranchId(params.amount, params.conditionKey);
      if (resolved) {
        branchId = resolved;
        this.logger.log({ message: 'Branch auto-selected', branchId, amount: params.amount, conditionKey: params.conditionKey });
      } else {
        // Fall back to first available TrustID branch
        const branches = await this.getBranches();
        if (branches.length === 0) throw new InternalServerErrorException('No TrustID branches available');
        branchId = branches[0].id;
      }
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
      SendEmail: params.sendEmail ?? true,
    };
    // Optional fields — only include when explicitly provided
    // (TrustID expects these to be absent, not empty strings, when unused)
    if (params.clientApplicationReference !== undefined && params.clientApplicationReference !== '') {
      body.ClientApplicationReference = params.clientApplicationReference;
    }
    if (params.digitalIdentityScheme !== undefined) body.DigitalIdentityScheme = params.digitalIdentityScheme;
    if (params.rtraAgentName !== undefined) body.RTRAgentName = params.rtraAgentName;
    if (params.rtwCompanyName !== undefined) body.RTWCompanyName = params.rtwCompanyName;

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
