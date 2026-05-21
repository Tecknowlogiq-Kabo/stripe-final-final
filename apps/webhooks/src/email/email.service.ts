import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export interface SendGuestLinkEmailParams {
  to: string;
  name: string;
  guestLink: string;
  subject?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: SESClient;
  private readonly fromAddress: string;

  constructor(private readonly configService: ConfigService) {
    const region =
      this.configService.get<string>('email.region') ??
      this.configService.get<string>('aws.region') ??
      'us-east-1';
    const accessKeyId = this.configService.get<string>('aws.accessKeyId');
    const secretAccessKey = this.configService.get<string>('aws.secretAccessKey');

    this.fromAddress =
      this.configService.get<string>('email.from') ?? 'noreply@yourdomain.com';

    this.client = new SESClient({
      region,
      credentials: accessKeyId
        ? { accessKeyId, secretAccessKey: secretAccessKey ?? '' }
        : undefined,
    });

    this.logger.log({
      message: 'EmailService initialized',
      region,
      from: this.fromAddress,
      hasCredentials: !!accessKeyId,
    });
  }

  /**
   * Send a guest-link email via AWS SES.
   *
   * The email includes a styled HTML body with the guest link as a button
   * and a plain-text fallback. The email is sent from the configured
   * `email.from` address.
   *
   * NOTE: In sandbox mode, both `from` and `to` must be verified email
   * addresses. For production, move the SES account out of sandbox.
   */
  async sendGuestLinkEmail(params: SendGuestLinkEmailParams): Promise<void> {
    const { to, name, guestLink } = params;
    const subject = params.subject ?? 'Your Document Verification Link';

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <h1 style="margin:0;font-size:20px;color:#18181b;">Document Verification</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#52525b;line-height:1.6;">
              <p style="margin:0 0 12px;">Hello ${this.escapeHtml(name)},</p>
              <p style="margin:0 0 24px;">
                You have been invited to verify your identity and upload required documents.
                Click the button below to get started:
              </p>
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center" style="background-color:#2563eb;border-radius:6px;">
                    <a href="${guestLink}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;padding:12px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Upload Documents
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:12px;color:#a1a1aa;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:12px;color:#a1a1aa;word-break:break-all;">
                ${this.escapeHtml(guestLink)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background-color:#fafafa;border-top:1px solid #e4e4e7;">
              <p style="margin:0;font-size:11px;color:#a1a1aa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                This is an automated message. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const textBody = `Hello ${name},\n\nYou have been invited to verify your identity and upload required documents.\n\nOpen this link to get started:\n${guestLink}\n\nThis is an automated message. Please do not reply.`;

    const command = new SendEmailCommand({
      Source: this.fromAddress,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: htmlBody, Charset: 'UTF-8' },
          Text: { Data: textBody, Charset: 'UTF-8' },
        },
      },
    });

    this.logger.log({ message: 'Sending guest link email', to, from: this.fromAddress });

    try {
      await this.client.send(command);
      this.logger.log({ message: 'Guest link email sent', to });
    } catch (err) {
      this.logger.error({ message: 'Failed to send guest link email', to, err });
      throw err;
    }
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  private escapeHtml(raw: string): string {
    return raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }
}
