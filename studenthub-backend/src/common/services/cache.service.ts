import { Injectable, Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../../common/modules/redis.module';
import Redis from 'ioredis';

@Injectable()
export class CacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache with TTL
   */
  async set(key: string, value: any, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
    }
  }

  /**
   * Delete key from cache
   */
  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
    }
  }

  /**
   * Delete multiple keys matching pattern
   */
  async deletePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.error(`Cache delete pattern error for ${pattern}:`, error);
    }
  }

  /**
   * Invalidate cache for user
   */
  async invalidateUserCache(userId: string): Promise<void> {
    await this.deletePattern(`user:${userId}*`);
    await this.deletePattern(`feed:${userId}*`);
    await this.deletePattern(`groups:${userId}*`);
  }

  /**
   * Invalidate cache for post
   */
  async invalidatePostCache(postId: string, authorId: string): Promise<void> {
    await this.deletePattern(`feed:*`);
    await this.delete(`post:${postId}`);
    await this.invalidateUserCache(authorId);
  }
}
