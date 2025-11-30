import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as nodemailer from 'nodemailer';
import { InvalidVerificationCodeException } from '../../../common/exceptions/auth.exceptions';
import { REDIS_CLIENT } from '../../../common/modules/redis.module';

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly verificationCodeTTL = 15 * 60; // 15 minutes in seconds
  private readonly resetCodeTTL = 15 * 60; // 15 minutes in seconds
  private readonly fromEmail: string;
  private readonly frontendUrl: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.fromEmail =
      this.configService.get<string>('SENDGRID_FROM_EMAIL') ||
      'noreply@studenthub.com';
    this.frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ||
      'http://localhost:3001';

    // Configure email transporter (using nodemailer)
    // In production, you might want to use SendGrid directly
    const sendGridApiKey = this.configService.get<string>('SENDGRID_API_KEY');
    
    if (sendGridApiKey) {
      // Using SendGrid SMTP
      this.transporter = nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
          user: 'apikey',
          pass: sendGridApiKey,
        },
      });
    } else {
      // Development: using ethereal.email or console transport
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        auth: {
          user: 'ethereal.user@ethereal.email',
          pass: 'ethereal.pass',
        },
      });

      this.logger.warn(
        'SENDGRID_API_KEY not configured. Using development email transport.',
      );
    }
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
      throw new InvalidVerificationCodeException(
        'Verification code has expired or does not exist',
      );
    }

    if (storedCode !== code) {
      throw new InvalidVerificationCodeException('Invalid verification code');
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
      throw new InvalidVerificationCodeException(
        'Reset code has expired or does not exist',
      );
    }

    if (storedCode !== code) {
      throw new InvalidVerificationCodeException('Invalid reset code');
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
      subject: 'Verify your StudentHub email',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to StudentHub!</h2>
          <p>Thank you for registering. Please verify your email address by entering the following code:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0; font-size: 32px; letter-spacing: 8px; font-weight: bold;">
            ${code}
          </div>
          <p>This code will expire in 15 minutes.</p>
          <p>If you didn't create an account, please ignore this email.</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Verification email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}`, error);
      throw error;
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, code: string): Promise<void> {
    const mailOptions = {
      from: this.fromEmail,
      to: email,
      subject: 'Reset your StudentHub password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset Request</h2>
          <p>You requested to reset your password. Use the following code to reset it:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0; font-size: 32px; letter-spacing: 8px; font-weight: bold;">
            ${code}
          </div>
          <p>This code will expire in 15 minutes.</p>
          <p>If you didn't request a password reset, please ignore this email or contact support if you have concerns.</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Password reset email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${email}`, error);
      throw error;
    }
  }

  /**
   * Generate 6-digit verification code
   */
  private generateSixDigitCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

