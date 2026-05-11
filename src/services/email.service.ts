import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { logger } from '../utils/logger';

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class EmailService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) {
      throw new Error('SMTP non configure');
    }
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    });
    return this.transporter;
  }

  private get from(): string {
    return config.SMTP_FROM ?? '"MPE Cameroun" <noreply@mpe-cameroun.org>';
  }

  private buildBaseHtml(title: string, bodyContent: string): string {
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>` +
      `<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">` +
      `<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0"><tr><td align="center">` +
      `<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">` +
      `<tr><td style="background:#1976d2;padding:28px 40px"><h1 style="margin:0;color:#fff;font-size:22px">MPE Cameroun</h1></td></tr>` +
      `<tr><td style="padding:40px"><h2 style="margin:0 0 16px;color:#1a1a1a;font-size:20px">${title}</h2>` +
      bodyContent +
      `</td></tr>` +
      `<tr><td style="background:#f9f9f9;padding:20px 40px;border-top:1px solid #eee">` +
      `<p style="margin:0;color:#aaa;font-size:12px;text-align:center">MPE Cameroun - Tous droits reserves</p>` +
      `</td></tr></table></td></tr></table></body></html>`;
  }

  async sendPasswordReset(email: string, rawToken: string, firstName: string): Promise<void> {
    const frontendUrl = config.FRONTEND_URL ?? config.BASE_URL;
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

    if (config.NODE_ENV !== 'production') {
      logger.info({ email, resetUrl }, '[DEV] Lien de reinitialisation mot de passe');
      return;
    }

    const safeName = escapeHtml(firstName);
    const body =
      `<p style="margin:0 0 12px;color:#444">Bonjour <strong>${safeName}</strong>,</p>` +
      `<p style="margin:0 0 24px;color:#444">Cliquez sur ce bouton pour reinitialiser votre mot de passe (valide <strong>1 heure</strong>).</p>` +
      `<table cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr>` +
      `<td style="background:#1976d2;border-radius:6px">` +
      `<a href="${resetUrl}" style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-weight:600">Reinitialiser mon mot de passe</a>` +
      `</td></tr></table>` +
      `<p style="margin:0 0 24px;word-break:break-all"><a href="${resetUrl}" style="color:#1976d2;font-size:13px">${resetUrl}</a></p>` +
      `<p style="margin:0;color:#888;font-size:13px;border-top:1px solid #eee;padding-top:16px">Si vous n'etes pas a l'origine de cette demande, ignorez cet email.</p>`;

    try {
      await this.getTransporter().sendMail({
        from: this.from, to: email,
        subject: 'Reinitialisation de votre mot de passe - MPE Cameroun',
        text: `Bonjour ${firstName},\n\nLien de reinitialisation (valide 1h) :\n${resetUrl}\n\nSi vous n'etes pas a l'origine de cette demande, ignorez cet email.\n\nMPE Cameroun`,
      // plain-text uses raw firstName — no HTML injection risk in plain text
        html: this.buildBaseHtml('Reinitialisation du mot de passe', body),
      });
      logger.info({ email }, 'Email de reinitialisation envoye');
    } catch (err) {
      logger.error({ err, email }, 'Echec envoi email de reinitialisation');
      throw new Error("Impossible d'envoyer l'email. Reessayez plus tard.");
    }
  }

  async sendEmailVerification(email: string, rawToken: string, firstName: string): Promise<void> {
    const frontendUrl = config.FRONTEND_URL ?? config.BASE_URL;
    const verifyUrl = `${frontendUrl}/verify-email?token=${rawToken}`;

    if (config.NODE_ENV !== 'production') {
      logger.info({ email, verifyUrl }, '[DEV] Lien de verification email');
      return;
    }

    const safeName = escapeHtml(firstName);
    const body =
      `<p style="margin:0 0 12px;color:#444">Bonjour <strong>${safeName}</strong>,</p>` +
      `<p style="margin:0 0 24px;color:#444">Confirmez votre adresse email (lien valide <strong>24 heures</strong>).</p>` +
      `<table cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr>` +
      `<td style="background:#1976d2;border-radius:6px">` +
      `<a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-weight:600">Verifier mon email</a>` +
      `</td></tr></table>` +
      `<p style="margin:0 0 24px;word-break:break-all"><a href="${verifyUrl}" style="color:#1976d2;font-size:13px">${verifyUrl}</a></p>` +
      `<p style="margin:0;color:#888;font-size:13px;border-top:1px solid #eee;padding-top:16px">Si vous n'avez pas cree de compte, ignorez cet email.</p>`;

    try {
      await this.getTransporter().sendMail({
        from: this.from, to: email,
        subject: 'Verifiez votre adresse email - MPE Cameroun',
        text: `Bonjour ${firstName},\n\nVerifiez votre email (valide 24h) :\n${verifyUrl}\n\nSi vous n'avez pas cree de compte, ignorez cet email.\n\nMPE Cameroun`,
        html: this.buildBaseHtml('Verification de votre email', body),
      });
      logger.info({ email }, 'Email de verification envoye');
    } catch (err) {
      logger.error({ err, email }, 'Echec envoi email de verification');
      throw new Error("Impossible d'envoyer l'email de verification. Reessayez plus tard.");
    }
  }

  // --- Invitation utilisateur ----------------------------------------------
  async sendInvitation(email: string, rawToken: string, inviterName: string, tenantName: string): Promise<void> {
    const frontendUrl = config.FRONTEND_URL ?? config.BASE_URL;
    const inviteUrl = `${frontendUrl}/accept-invite?token=${rawToken}`;

    if (config.NODE_ENV !== 'production') {
      logger.info({ email, inviteUrl }, '[DEV] Lien invitation');
      return;
    }

    const safeInviter = escapeHtml(inviterName);
    const safeTenant = escapeHtml(tenantName);
    const body =
      `<p style="margin:0 0 12px;color:#444">Bonjour,</p>` +
      `<p style="margin:0 0 24px;color:#444"><strong>${safeInviter}</strong> vous invite a rejoindre <strong>${safeTenant}</strong> sur BrethrenApp.</p>` +
      `<table cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr>` +
      `<td style="background:#1976d2;border-radius:6px">` +
      `<a href="${inviteUrl}" style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-weight:600">Accepter l'invitation</a>` +
      `</td></tr></table>` +
      `<p style="margin:0 0 24px;word-break:break-all"><a href="${inviteUrl}" style="color:#1976d2;font-size:13px">${inviteUrl}</a></p>` +
      `<p style="margin:0;color:#888;font-size:13px;border-top:1px solid #eee;padding-top:16px">Ce lien est valide 7 jours. Si vous n'attendiez pas cette invitation, ignorez cet email.</p>`;

    try {
      await this.getTransporter().sendMail({
        from: this.from, to: email,
        subject: `Invitation a rejoindre ${tenantName} - MPE Cameroun`,
        text: `${inviterName} vous invite a rejoindre ${tenantName}.\n\nAcceptez l'invitation (valide 7 jours) :\n${inviteUrl}\n\nMPE Cameroun`,
        html: this.buildBaseHtml(`Invitation - ${tenantName}`, body),
      });
      logger.info({ email }, 'Email invitation envoye');
    } catch (err) {
      logger.error({ err, email }, 'Echec envoi email invitation');
      throw new Error("Impossible d'envoyer l'email d'invitation.");
    }
  }

  async sendRaw(opts: { to: string; subject: string; html: string; text: string }): Promise<void> {
    if (config.NODE_ENV !== 'production') {
      logger.info({ to: opts.to, subject: opts.subject }, '[DEV] Email brut (non envoye)');
      return;
    }
    try {
      await this.getTransporter().sendMail({
        from: this.from, to: opts.to,
        subject: opts.subject, text: opts.text, html: opts.html,
      });
    } catch (err) {
      logger.warn({ err }, 'Echec envoi email brut');
    }
  }
}

export const emailService = new EmailService();
