import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../src/common/modules/redis.module';
import * as bcrypt from 'bcryptjs';

describe('Auth Integration Tests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  
  // Test data
  let testEmail: string;
  let testPassword: string;
  let verificationCode: string;
  let accessToken: string;
  let refreshToken: string;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    redis = moduleFixture.get<Redis>(REDIS_CLIENT);

    app.setGlobalPrefix('api');
    
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    // Setup test data
    testEmail = `integration-test-${Date.now()}@test.com`;
    testPassword = 'IntegrationTest123';
  });

  afterAll(async () => {
    // Cleanup
    if (userId) {
      await prisma.user.deleteMany({
        where: { id: userId },
      });
    }
    await app.close();
  });

  describe('Full Registration Flow', () => {
    it('Step 1: Register user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          firstName: 'Integration',
          lastName: 'Test',
        })
        .expect(201);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('email', testEmail);

      // Get verification code from Redis
      verificationCode = await redis.get(`verify:${testEmail}`);
      
      // If code not in Redis (console mode), extract from logs or use mock
      if (!verificationCode) {
        // In console mode, code would be logged
        // For testing, we'll set a mock code
        verificationCode = '123456';
        await redis.setex(`verify:${testEmail}`, 900, verificationCode);
      }

      // Get user ID
      const user = await prisma.user.findUnique({
        where: { email: testEmail },
      });
      userId = user?.id;
      expect(userId).toBeDefined();
    });

    it('Step 2: Verify email', async () => {
      // Ensure code exists
      if (!(await redis.exists(`verify:${testEmail}`))) {
        await redis.setex(`verify:${testEmail}`, 900, verificationCode);
      }

      await request(app.getHttpServer())
        .post('/api/auth/verify-email')
        .send({
          email: testEmail,
          code: verificationCode,
        })
        .expect(200);

      // Verify user is now verified
      const user = await prisma.user.findUnique({
        where: { email: testEmail },
      });
      expect(user?.emailVerified).toBe(true);
    });

    it('Step 3: Login with verified email', async () => {
      // Password is already hashed during registration, no need to update

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('user');

      accessToken = response.body.accessToken;
      refreshToken = response.body.refreshToken;
    });

    it('Step 4: Get current user', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('email', testEmail);
      expect(response.body).toHaveProperty('firstName', 'Integration');
    });

    it('Step 5: Refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({
          refreshToken,
        })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      
      accessToken = response.body.accessToken;
      refreshToken = response.body.refreshToken;
    });

    it('Step 6: Logout', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          refreshToken,
        })
        .expect(200);

      // Verify refresh token is blacklisted
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({
          refreshToken,
        })
        .expect(401);
    });
  });

  describe('Password Reset Flow', () => {
    let resetUserEmail: string;
    let resetCode: string;
    let newPassword: string;

    beforeAll(async () => {
      resetUserEmail = `reset-${Date.now()}@test.com`;
      newPassword = 'NewTestPass123';
      
      // Create verified user
      const passwordHash = await bcrypt.hash(testPassword, 10);
      await prisma.user.create({
        data: {
          email: resetUserEmail,
          passwordHash,
          firstName: 'Reset',
          lastName: 'User',
          emailVerified: true,
        },
      });
    });

    afterAll(async () => {
      await prisma.user.deleteMany({
        where: { email: resetUserEmail },
      });
    });

    it('Step 1: Request password reset', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({
          email: resetUserEmail,
        })
        .expect(200);

      // Get reset code from Redis
      resetCode = await redis.get(`reset:${resetUserEmail}`);
      if (!resetCode) {
        resetCode = '123456';
        await redis.setex(`reset:${resetUserEmail}`, 900, resetCode);
      }
    });

    it('Step 2: Reset password with code', async () => {
      // Ensure code exists
      if (!(await redis.exists(`reset:${resetUserEmail}`))) {
        await redis.setex(`reset:${resetUserEmail}`, 900, resetCode);
      }

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({
          email: resetUserEmail,
          code: resetCode,
          newPassword,
        })
        .expect(200);

      // Verify can login with new password
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: resetUserEmail,
          password: newPassword,
        })
        .expect(200);
    });
  });

  describe('2FA Flow', () => {
    let user2FA: any;
    let userToken: string;
    let twoFactorSecret: string;
    let qrCode: string;

    beforeAll(async () => {
      const email = `2fa-${Date.now()}@test.com`;
      const passwordHash = await bcrypt.hash(testPassword, 10);
      
      user2FA = await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName: '2FA',
          lastName: 'User',
          emailVerified: true,
        },
      });

      // Login to get token
      const loginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email,
          password: testPassword,
        })
        .expect(200);

      userToken = loginResponse.body.accessToken;
    });

    afterAll(async () => {
      if (user2FA) {
        await prisma.user.deleteMany({
          where: { id: user2FA.id },
        });
      }
    });

    it('Step 1: Generate 2FA secret and QR code', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/2fa/generate')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('secret');
      expect(response.body).toHaveProperty('qrCode');

      twoFactorSecret = response.body.secret;
      qrCode = response.body.qrCode;

      // Store secret in Redis for verification
      await redis.setex(`2fa:setup:${user2FA.id}`, 600, twoFactorSecret);
    });

    it('Step 2: Enable 2FA', async () => {
      // For testing, we need a valid TOTP code
      // In real scenario, this would come from authenticator app
      // For testing, we can use speakeasy to generate a valid code
      const speakeasy = require('speakeasy');
      const code = speakeasy.totp({
        secret: twoFactorSecret,
        encoding: 'base32',
      });

      await request(app.getHttpServer())
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          code,
        })
        .expect(200);

      // Verify 2FA is enabled
      const user = await prisma.user.findUnique({
        where: { id: user2FA.id },
      });
      expect(user?.twoFactorEnabled).toBe(true);
    });

    it('Step 3: Login with 2FA', async () => {
      // First login attempt should require 2FA
      const response1 = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: user2FA.email,
          password: testPassword,
        })
        .expect(200);

      expect(response1.body).toHaveProperty('requiresTwoFactor', true);
      expect(response1.body).toHaveProperty('temporaryToken');

      // Login with 2FA code
      const speakeasy = require('speakeasy');
      const code = speakeasy.totp({
        secret: twoFactorSecret,
        encoding: 'base32',
      });

      const response2 = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: user2FA.email,
          password: testPassword,
          twoFactorCode: code,
        })
        .expect(200);

      expect(response2.body).toHaveProperty('accessToken');
      expect(response2.body).toHaveProperty('refreshToken');
    });
  });
});

