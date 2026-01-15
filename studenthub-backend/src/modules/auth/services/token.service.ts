import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload, JwtRefreshPayload } from '../../../common/interfaces/jwt-payload.interface';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import * as jwt from 'jsonwebtoken';
import {
  TokenExpiredException,
  TokenBlacklistedException,
  InvalidTokenException,
} from '../../../common/exceptions/auth.exceptions';
import { REDIS_CLIENT } from '../../../common/modules/redis.module';

@Injectable()
export class TokenService {
  private readonly accessTokenExpiration: string;
  private readonly refreshTokenExpiration: string;
  private readonly jwtSecret: string;
  private readonly jwtRefreshSecret: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.accessTokenExpiration = this.configService.get<string>('JWT_EXPIRATION') || '15m';
    this.refreshTokenExpiration = this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '7d';
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 'secret';
    this.jwtRefreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') || 'refresh-secret';
  }

  /**
   * Generate access token
   */
  generateAccessToken(userId: string, email: string, role: string): string {
    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
    };

    return this.jwtService.sign(payload, {
      expiresIn: this.accessTokenExpiration as any,
    });
  }

  /**
   * Generate refresh token with unique token ID
   */
  async generateRefreshToken(userId: string): Promise<string> {
    const tokenId = uuidv4();
    const payload: JwtRefreshPayload = {
      sub: userId,
      tokenId,
    };

    // Use jsonwebtoken directly for refresh tokens (different secret)
    const token = jwt.sign(payload, this.jwtRefreshSecret, {
      expiresIn: this.refreshTokenExpiration as any,
    });

    // Store refresh token in Redis with expiration
    const expiresInSeconds = this.parseExpirationToSeconds(this.refreshTokenExpiration);
    await this.redis.setex(`refresh:${userId}:${tokenId}`, expiresInSeconds, '1');

    // Store in session list
    await this.redis.sadd(`session:${userId}`, tokenId);
    await this.redis.expire(`session:${userId}`, expiresInSeconds);

    return token;
  }

  /**
   * Verify access token
   */
  async verifyAccessToken(token: string): Promise<JwtPayload> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.jwtSecret,
      });

      // Check if token is blacklisted
      const isBlacklisted = await this.isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw new TokenBlacklistedException();
      }

      return payload;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new TokenExpiredException();
      }
      throw new InvalidTokenException();
    }
  }

  /**
   * Verify refresh token
   */
  async verifyRefreshToken(token: string): Promise<JwtRefreshPayload> {
    try {
      const payload = jwt.verify(token, this.jwtRefreshSecret) as JwtRefreshPayload;

      // Check if refresh token exists and is valid in Redis
      const exists = await this.redis.exists(`refresh:${payload.sub}:${payload.tokenId}`);
      if (!exists) {
        throw new TokenBlacklistedException();
      }

      return payload;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new TokenExpiredException();
      }
      throw new InvalidTokenException();
    }
  }

  /**
   * Revoke refresh token (add to blacklist)
   */
  async revokeRefreshToken(token: string): Promise<void> {
    try {
      const payload = jwt.verify(token, this.jwtRefreshSecret) as JwtRefreshPayload;

      // Remove from Redis
      await this.redis.del(`refresh:${payload.sub}:${payload.tokenId}`);
      await this.redis.srem(`session:${payload.sub}`, payload.tokenId);

      // Add to blacklist
      const expiresInSeconds = this.parseExpirationToSeconds(this.refreshTokenExpiration);
      await this.redis.setex(`blacklist:${payload.tokenId}`, expiresInSeconds, '1');
    } catch (error) {
      // Token might be invalid, but we don't throw to allow logout even with invalid tokens
    }
  }

  /**
   * Revoke all refresh tokens for a user
   */
  async revokeAllRefreshTokens(userId: string): Promise<void> {
    const sessionTokens = await this.redis.smembers(`session:${userId}`);

    for (const tokenId of sessionTokens) {
      await this.redis.del(`refresh:${userId}:${tokenId}`);
      await this.redis.setex(`blacklist:${tokenId}`, 7 * 24 * 60 * 60, '1');
    }

    await this.redis.del(`session:${userId}`);
  }

  /**
   * Check if token is blacklisted
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      // Try to extract token ID from refresh token
      const payload = jwt.decode(token) as JwtRefreshPayload;
      if (payload?.tokenId) {
        const exists = await this.redis.exists(`blacklist:${payload.tokenId}`);
        return exists === 1;
      }

      // For access tokens, we might need to track them differently
      // For now, we rely on refresh token blacklisting
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Parse expiration string to seconds
   */
  private parseExpirationToSeconds(expiration: string): number {
    const unit = expiration.slice(-1);
    const value = parseInt(expiration.slice(0, -1), 10);

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
        return value * 24 * 60 * 60;
      default:
        return 15 * 60; // Default to 15 minutes
    }
  }
}
