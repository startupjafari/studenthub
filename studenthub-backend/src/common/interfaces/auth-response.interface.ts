import { User } from '@prisma/client';

export interface AuthResponse {
  user: Omit<User, 'passwordHash'>;
  accessToken: string;
  refreshToken: string;
  requiresTwoFactor?: boolean;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

export interface TwoFactorGenerateResponse {
  secret: string;
  qrCode: string;
}
