import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import * as bcrypt from 'bcryptjs';

export class TestUtils {
  private prisma: PrismaClient;
  private redis: Redis;

  constructor(prisma: PrismaClient, redis: Redis) {
    this.prisma = prisma;
    this.redis = redis;
  }

  /**
   * Create a test user with verified email
   */
  async createVerifiedUser(email: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: 'Test',
        lastName: 'User',
        emailVerified: true,
      },
    });
  }

  /**
   * Create a test user with unverified email
   */
  async createUnverifiedUser(email: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: 'Test',
        lastName: 'User',
        emailVerified: false,
      },
    });
  }

  /**
   * Delete test user by email
   */
  async deleteUser(email: string) {
    return this.prisma.user.deleteMany({
      where: { email },
    });
  }

  /**
   * Clean all test data
   */
  async cleanTestData() {
    await this.prisma.user.deleteMany({
      where: {
        email: {
          contains: '@test.com',
        },
      },
    });
  }

  /**
   * Set verification code in Redis
   */
  async setVerificationCode(email: string, code: string) {
    return this.redis.setex(`verify:${email}`, 900, code);
  }

  /**
   * Set reset code in Redis
   */
  async setResetCode(email: string, code: string) {
    return this.redis.setex(`reset:${email}`, 900, code);
  }

  /**
   * Get verification code from Redis
   */
  async getVerificationCode(email: string): Promise<string | null> {
    return this.redis.get(`verify:${email}`);
  }
}

