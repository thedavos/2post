import { Injectable, Logger } from "@nestjs/common";

/**
 * Email delivery — SMTP when configured, log-preview otherwise (dev parity:
 * legacy logs to console via EMAIL_BACKEND=console in development).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  get configured(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.EMAIL_HOST_USER);
  }

  async send(input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<void> {
    if (!this.configured) {
      this.logger.log(
        `[email preview] to=${input.to} subject="${input.subject}"\n${input.text}`,
      );
      return;
    }

    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.EMAIL_HOST_USER!,
        pass: process.env.EMAIL_HOST_PASSWORD ?? "",
      },
    });

    await transport.sendMail({
      from: process.env.DEFAULT_FROM_EMAIL ?? process.env.EMAIL_HOST_USER!,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    await this.send({
      to,
      subject: "BrightBean Studio — reset your password",
      text: `Reset your password (valid 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
      html: `<p>Reset your password (valid 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, ignore this email.</p>`,
    });
  }

  async sendInvitation(
    to: string,
    inviterName: string,
    orgName: string,
    inviteUrl: string,
  ): Promise<void> {
    await this.send({
      to,
      subject: `${inviterName} invited you to ${orgName} on BrightBean Studio`,
      text: `${inviterName} invited you to collaborate in "${orgName}".\nAccept: ${inviteUrl}`,
      html: `<p>${inviterName} invited you to collaborate in <strong>${orgName}</strong>.</p><p><a href="${inviteUrl}">Accept invitation</a></p>`,
    });
  }
}
