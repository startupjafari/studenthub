import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as nodemailer from 'nodemailer';
import { InvalidVerificationCodeException } from '../../../common/exceptions/auth.exceptions';
import { REDIS_CLIENT } from '../../../common/modules/redis.module';

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly verificationCodeTTL = 15 * 60; // 15 minutes in seconds
  private readonly resetCodeTTL = 15 * 60; // 15 minutes in seconds
  private readonly fromEmail: string;
  private readonly frontendUrl: string;
  private readonly nodeEnv: string;
  private readonly useRealEmail: boolean;

  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';
    this.fromEmail =
      this.configService.get<string>('SMTP_FROM_EMAIL') ||
      this.configService.get<string>('SENDGRID_FROM_EMAIL') ||
      'noreply@studenthub.com';
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';

    // Configure email transporter (supports SendGrid, Gmail, Mail.ru, Yandex, etc.)
    this.transporter = this.createEmailTransporter();
    this.useRealEmail = this.transporter !== null;
  }

  /**
   * Create email transporter based on configuration
   */
  private createEmailTransporter(): nodemailer.Transporter | null {
    const useConsoleTransport =
      this.configService.get<string>('USE_CONSOLE_EMAIL_TRANSPORT') === 'true';

    if (useConsoleTransport) {
      this.logger.warn('Используется консольный транспорт (USE_CONSOLE_EMAIL_TRANSPORT=true)');
      return null as any; // Will be handled in send methods
    }

    // Option 1: Universal SMTP configuration (Gmail, Mail.ru, Yandex, etc.)
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = this.configService.get<number>('SMTP_PORT');
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPassword = this.configService.get<string>('SMTP_PASSWORD');
    const smtpSecure = this.configService.get<string>('SMTP_SECURE') === 'true';

    if (smtpHost && smtpUser && smtpPassword) {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort || (smtpSecure ? 465 : 587),
        secure: smtpSecure, // true for 465, false for other ports
        auth: {
          user: smtpUser,
          pass: smtpPassword,
        },
      });

      this.logger.log(
        `Используется SMTP сервер: ${smtpHost}:${smtpPort || (smtpSecure ? 465 : 587)}`,
      );
      return transporter;
    }

    // Option 2: SendGrid SMTP
    const sendGridApiKey = this.configService.get<string>('SENDGRID_API_KEY');
    if (sendGridApiKey) {
      const transporter = nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
          user: 'apikey',
          pass: sendGridApiKey,
        },
      });

      this.logger.log('Используется SendGrid для отправки email');
      return transporter;
    }

    // Option 3: No email configured - will log to console
    this.logger.warn(
      'Email транспорт не настроен. Коды будут выводиться в консоль. Настройте SMTP_HOST, SMTP_USER, SMTP_PASSWORD или SENDGRID_API_KEY в .env',
    );
    return null as any;
  }

  /**
   * Generate and store verification code in Redis
   */
  async generateVerificationCode(email: string): Promise<string> {
    const code = this.generateSixDigitCode();
    const key = `verify:${email}`;

    // Store code with TTL
    await this.redis.setex(key, this.verificationCodeTTL, code);

    return code;
  }

  /**
   * Verify email verification code
   */
  async verifyCode(email: string, code: string): Promise<boolean> {
    const key = `verify:${email}`;
    const storedCode = await this.redis.get(key);

    if (!storedCode) {
      throw new InvalidVerificationCodeException('Код подтверждения истек или не существует');
    }

    if (storedCode !== code) {
      throw new InvalidVerificationCodeException('Неверный код подтверждения');
    }

    // Delete code after successful verification
    await this.redis.del(key);

    return true;
  }

  /**
   * Generate and store password reset code
   */
  async generatePasswordResetCode(email: string): Promise<string> {
    const code = this.generateSixDigitCode();
    const key = `reset:${email}`;

    // Store code with TTL
    await this.redis.setex(key, this.resetCodeTTL, code);

    return code;
  }

  /**
   * Verify password reset code
   */
  async verifyResetCode(email: string, code: string): Promise<boolean> {
    const key = `reset:${email}`;
    const storedCode = await this.redis.get(key);

    if (!storedCode) {
      throw new InvalidVerificationCodeException('Код сброса истек или не существует');
    }

    if (storedCode !== code) {
      throw new InvalidVerificationCodeException('Неверный код сброса');
    }

    // Delete code after successful verification
    await this.redis.del(key);

    return true;
  }

  /**
   * Send verification email
   */
  async sendVerificationEmail(email: string, code: string): Promise<void> {
    const mailOptions = {
      from: this.fromEmail,
      to: email,
      subject: 'Подтвердите ваш email в StudentHub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Добро пожаловать в StudentHub!</h2>
          <p>Спасибо за регистрацию. Пожалуйста, подтвердите ваш email адрес, введя следующий код:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0; font-size: 32px; letter-spacing: 8px; font-weight: bold;">
            ${code}
          </div>
          <p>Этот код действителен в течение 15 минут.</p>
          <p>Если вы не создавали аккаунт, пожалуйста, проигнорируйте это письмо.</p>
        </div>
      `,
    };

    // Если транспорт не настроен, просто выводим код в консоль
    if (!this.useRealEmail || !this.transporter) {
      this.logCodeToConsole('EMAIL VERIFICATION', email, code);
      return;
    }

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`✅ Письмо с кодом подтверждения отправлено на ${email}`);
    } catch (error) {
      this.logger.error(`❌ Не удалось отправить письмо с кодом подтверждения на ${email}`, error);

      // Выводим код в консоль как fallback
      this.logCodeToConsole('EMAIL VERIFICATION (FALLBACK)', email, code);

      // В production можно выбрать - бросать ошибку или только логировать
      const failSilently = this.configService.get<string>('EMAIL_FAIL_SILENTLY') === 'true';
      if (!failSilently && this.nodeEnv === 'production') {
        throw error;
      }
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, code: string): Promise<void> {
    const mailOptions = {
      from: this.fromEmail,
      to: email,
      subject: 'Сброс пароля StudentHub',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Запрос на сброс пароля</h2>
          <p>Вы запросили сброс пароля. Используйте следующий код для сброса:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0; font-size: 32px; letter-spacing: 8px; font-weight: bold;">
            ${code}
          </div>
          <p>Этот код действителен в течение 15 минут.</p>
          <p>Если вы не запрашивали сброс пароля, пожалуйста, проигнорируйте это письмо или свяжитесь с поддержкой, если у вас есть опасения.</p>
        </div>
      `,
    };

    // Если транспорт не настроен, просто выводим код в консоль
    if (!this.useRealEmail || !this.transporter) {
      this.logCodeToConsole('PASSWORD RESET', email, code);
      return;
    }

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`✅ Письмо с кодом сброса пароля отправлено на ${email}`);
    } catch (error) {
      this.logger.error(`❌ Не удалось отправить письмо с кодом сброса пароля на ${email}`, error);

      // Выводим код в консоль как fallback
      this.logCodeToConsole('PASSWORD RESET (FALLBACK)', email, code);

      // В production можно выбрать - бросать ошибку или только логировать
      const failSilently = this.configService.get<string>('EMAIL_FAIL_SILENTLY') === 'true';
      if (!failSilently && this.nodeEnv === 'production') {
        throw error;
      }
    }
  }

  /**
   * Log verification code to console (for development)
   */
  private logCodeToConsole(type: string, email: string, code: string): void {
    this.logger.warn(`═══════════════════════════════════════════════════════`);
    this.logger.warn(`📧 ${type}: КОД`);
    this.logger.warn(`═══════════════════════════════════════════════════════`);
    this.logger.warn(`Email: ${email}`);
    this.logger.warn(`Код: ${code}`);
    this.logger.warn(`Время: ${new Date().toLocaleString('ru-RU')}`);
    this.logger.warn(`═══════════════════════════════════════════════════════`);
  }

  /**
   * Generate 6-digit verification code
   */
  private generateSixDigitCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}
