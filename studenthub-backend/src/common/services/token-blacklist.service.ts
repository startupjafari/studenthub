import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT } from '../modules/redis.module';
import Redis from 'ioredis';

@Injectable()
export class TokenBlacklistService {
  private readonly accessTokenTTL: number;
  private readonly refreshTokenTTL: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    // Время жизни access токена (по умолчанию 15 минут)
    const accessExpiration = this.configService.get<string>('JWT_EXPIRATION') || '15m';
    this.accessTokenTTL = this.parseExpiration(accessExpiration);
    
    // Время жизни refresh токена (по умолчанию 7 дней)
    const refreshExpiration = this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '7d';
    this.refreshTokenTTL = this.parseExpiration(refreshExpiration);
  }

  /**
   * Добавить токен в черный список
   */
  async blacklistToken(token: string, type: 'access' | 'refresh'): Promise<void> {
    const ttl = type === 'access' ? this.accessTokenTTL : this.refreshTokenTTL;
    const key = `blacklist:${type}:${token}`;
    await this.redis.setex(key, ttl, '1');
  }

  /**
   * Проверить, находится ли токен в черном списке
   */
  async isTokenBlacklisted(token: string, type: 'access' | 'refresh'): Promise<boolean> {
    const key = `blacklist:${type}:${token}`;
    const result = await this.redis.get(key);
    return result === '1';
  }

  /**
   * Добавить все токены пользователя в черный список (выход при смене пароля)
   */
  async blacklistUserTokens(userId: string): Promise<void> {
    // Сохраняем временную метку смены пароля
    // Все токены, выданные до этой метки, считаются недействительными
    const key = `password_changed:${userId}`;
    const timestamp = Date.now();
    await this.redis.set(key, timestamp.toString());
    // Устанавливаем время жизни равным максимальному TTL refresh токена
    await this.redis.expire(key, this.refreshTokenTTL);
  }

  /**
   * Проверить, был ли пароль изменен после выдачи токена
   */
  async wasPasswordChangedAfterToken(userId: string, tokenIssuedAt: number): Promise<boolean> {
    const key = `password_changed:${userId}`;
    const passwordChangedAt = await this.redis.get(key);
    
    if (!passwordChangedAt) {
      return false; // Пароль не был изменен
    }
    
    return parseInt(passwordChangedAt) > tokenIssuedAt;
  }

  /**
   * Преобразовать строку времени жизни в секунды
   */
  private parseExpiration(expiration: string): number {
    const match = expiration.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 900; // По умолчанию 15 минут
    }

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      case 'd':
        return value * 86400;
      default:
        return 900;
    }
  }
}
