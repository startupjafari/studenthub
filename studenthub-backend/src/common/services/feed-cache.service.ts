import { Injectable, Inject, Logger } from '@nestjs/common';
import { REDIS_CLIENT } from '../modules/redis.module';
import Redis from 'ioredis';

/**
 * Сервис кэширования ленты постов
 * Оптимизирован для высокой нагрузки
 */
@Injectable()
export class FeedCacheService {
  private readonly logger = new Logger(FeedCacheService.name);
  
  // Время жизни кэша
  private readonly FEED_TTL = 300; // 5 минут для ленты
  private readonly POST_TTL = 3600; // 1 час для отдельных постов
  private readonly TRENDING_TTL = 600; // 10 минут для трендов
  private readonly USER_FEED_TTL = 180; // 3 минуты для персональной ленты

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // ==================== ЛЕНТА ПОСТОВ ====================

  /**
   * Получить закэшированную ленту пользователя
   */
  async getUserFeed(userId: string, page: number): Promise<any[] | null> {
    const key = `feed:user:${userId}:page:${page}`;
    const cached = await this.redis.get(key);
    
    if (cached) {
      this.logger.debug(`Кэш ленты найден: ${key}`);
      return JSON.parse(cached);
    }
    
    return null;
  }

  /**
   * Сохранить ленту пользователя в кэш
   */
  async setUserFeed(userId: string, page: number, posts: any[]): Promise<void> {
    const key = `feed:user:${userId}:page:${page}`;
    await this.redis.setex(key, this.USER_FEED_TTL, JSON.stringify(posts));
    this.logger.debug(`Лента закэширована: ${key}`);
  }

  /**
   * Инвалидировать ленту пользователя
   */
  async invalidateUserFeed(userId: string): Promise<void> {
    const pattern = `feed:user:${userId}:*`;
    const keys = await this.redis.keys(pattern);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
      this.logger.debug(`Инвалидировано ${keys.length} ключей ленты для пользователя ${userId}`);
    }
  }

  /**
   * Инвалидировать ленты друзей пользователя (при создании поста)
   */
  async invalidateFriendFeeds(friendIds: string[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    
    for (const friendId of friendIds) {
      const pattern = `feed:user:${friendId}:*`;
      const keys = await this.redis.keys(pattern);
      keys.forEach(key => pipeline.del(key));
    }
    
    await pipeline.exec();
    this.logger.debug(`Инвалидированы ленты ${friendIds.length} друзей`);
  }

  // ==================== ОТДЕЛЬНЫЕ ПОСТЫ ====================

  /**
   * Получить закэшированный пост
   */
  async getPost(postId: string): Promise<any | null> {
    const key = `post:${postId}`;
    const cached = await this.redis.get(key);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    return null;
  }

  /**
   * Сохранить пост в кэш
   */
  async setPost(postId: string, post: any): Promise<void> {
    const key = `post:${postId}`;
    await this.redis.setex(key, this.POST_TTL, JSON.stringify(post));
  }

  /**
   * Инвалидировать кэш поста
   */
  async invalidatePost(postId: string): Promise<void> {
    const key = `post:${postId}`;
    await this.redis.del(key);
  }

  // ==================== ПОПУЛЯРНЫЕ ПОСТЫ ====================

  /**
   * Получить трендовые посты
   */
  async getTrendingPosts(): Promise<any[] | null> {
    const key = 'feed:trending';
    const cached = await this.redis.get(key);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    return null;
  }

  /**
   * Сохранить трендовые посты
   */
  async setTrendingPosts(posts: any[]): Promise<void> {
    const key = 'feed:trending';
    await this.redis.setex(key, this.TRENDING_TTL, JSON.stringify(posts));
  }

  // ==================== СЧЕТЧИКИ ПОСТОВ ====================

  /**
   * Инкрементировать просмотры поста
   */
  async incrementPostViews(postId: string): Promise<number> {
    const key = `post:views:${postId}`;
    return await this.redis.incr(key);
  }

  /**
   * Получить количество просмотров поста
   */
  async getPostViews(postId: string): Promise<number> {
    const key = `post:views:${postId}`;
    const views = await this.redis.get(key);
    return parseInt(views || '0', 10);
  }

  /**
   * Инкрементировать реакции поста (для быстрого отображения)
   */
  async incrementPostReactions(postId: string): Promise<void> {
    const key = `post:reactions:${postId}`;
    await this.redis.incr(key);
    // Инвалидируем кэш поста
    await this.invalidatePost(postId);
  }

  /**
   * Декрементировать реакции поста
   */
  async decrementPostReactions(postId: string): Promise<void> {
    const key = `post:reactions:${postId}`;
    await this.redis.decr(key);
    await this.invalidatePost(postId);
  }

  // ==================== ГЛОБАЛЬНАЯ ИНВАЛИДАЦИЯ ====================

  /**
   * Очистить весь кэш лент
   */
  async clearAllFeeds(): Promise<void> {
    const pattern = 'feed:*';
    const keys = await this.redis.keys(pattern);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
      this.logger.log(`Очищен весь кэш лент: ${keys.length} ключей`);
    }
  }

  /**
   * Очистить весь кэш постов
   */
  async clearAllPosts(): Promise<void> {
    const pattern = 'post:*';
    const keys = await this.redis.keys(pattern);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
      this.logger.log(`Очищен весь кэш постов: ${keys.length} ключей`);
    }
  }

  // ==================== СТАТИСТИКА КЭША ====================

  /**
   * Получить статистику кэша
   */
  async getCacheStats(): Promise<{
    feedKeys: number;
    postKeys: number;
    totalMemory: string;
  }> {
    const feedKeys = await this.redis.keys('feed:*');
    const postKeys = await this.redis.keys('post:*');
    const info = await this.redis.info('memory');
    const usedMemory = info.match(/used_memory_human:(\S+)/)?.[1] || 'unknown';

    return {
      feedKeys: feedKeys.length,
      postKeys: postKeys.length,
      totalMemory: usedMemory,
    };
  }
}



