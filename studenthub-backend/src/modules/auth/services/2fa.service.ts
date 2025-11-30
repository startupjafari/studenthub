import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../../common/services/prisma.service';
import { InvalidTwoFactorCodeException } from '../../../common/exceptions/auth.exceptions';

@Injectable()
export class TwoFactorService {
  private readonly appName: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.appName =
      this.configService.get<string>('APP_NAME') || 'StudentHub';
  }

  /**
   * Generate a secret for 2FA
   */
  generateSecret(userEmail: string): string {
    return speakeasy.generateSecret({
      name: `${this.appName} (${userEmail})`,
      issuer: this.appName,
    }).base32;
  }

  /**
   * Generate QR code for Google Authenticator
   */
  async generateQRCode(secret: string, email: string): Promise<string> {
    const otpauthUrl = speakeasy.otpauthURL({
      secret: secret,
      label: `${this.appName} (${email})`,
      issuer: this.appName,
      encoding: 'base32',
    });

    try {
      return await QRCode.toDataURL(otpauthUrl);
    } catch (error) {
      throw new Error('Не удалось сгенерировать QR-код');
    }
  }

  /**
   * Verify 2FA token
   */
  verifyToken(secret: string, token: string): boolean {
    return speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2, // Allow 2 time steps (60 seconds) tolerance
    });
  }

  /**
   * Enable 2FA for a user
   */
  async enableTwoFactor(userId: string, secret: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: secret,
      },
    });
  }

  /**
   * Disable 2FA for a user
   */
  async disableTwoFactor(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
      },
    });
  }

  /**
   * Get 2FA secret for a user (without enabling)
   */
  async getUserSecret(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true },
    });

    return user?.twoFactorSecret || null;
  }

  /**
   * Verify and enable 2FA (used during setup)
   */
  async verifyAndEnableTwoFactor(
    userId: string,
    secret: string,
    code: string,
  ): Promise<void> {
    const isValid = this.verifyToken(secret, code);
    if (!isValid) {
      throw new InvalidTwoFactorCodeException();
    }

    await this.enableTwoFactor(userId, secret);
  }
}

