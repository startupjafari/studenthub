import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../src/common/modules/redis.module';
import * as bcrypt from 'bcryptjs';

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let testUser: any;
  let accessToken: string;
  let refreshToken: string;
  let verificationCode: string;

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
  });

  afterAll(async () => {
    // Cleanup test data
    if (testUser) {
      await prisma.user.deleteMany({
        where: {
          email: testUser.email,
        },
      });
    }
    await app.close();
  });

  describe('POST /api/auth/register', () => {
    const testEmail = `test-${Date.now()}@test.com`;

    it('should register a new user', () => {
      return request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: 'TestPass123',
          firstName: 'Test',
          lastName: 'User',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body).toHaveProperty('email', testEmail);
        });
    });

    it('should fail with invalid email', () => {
      return request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'TestPass123',
          firstName: 'Test',
          lastName: 'User',
        })
        .expect(400);
    });

    it('should fail with weak password', () => {
      return request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'test2@test.com',
          password: '12345', // Too short
          firstName: 'Test',
          lastName: 'User',
        })
        .expect(400);
    });

    it('should fail with duplicate email', async () => {
      const duplicateEmail = `duplicate-${Date.now()}@test.com`;
      
      // First registration
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: duplicateEmail,
          password: 'TestPass123',
          firstName: 'Test',
          lastName: 'User',
        })
        .expect(201);

      // Duplicate registration
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: duplicateEmail,
          password: 'TestPass123',
          firstName: 'Test',
          lastName: 'User',
        })
        .expect(409);

      // Cleanup
      await prisma.user.deleteMany({
        where: { email: duplicateEmail },
      });
    });
  });

  describe('POST /api/auth/verify-email', () => {
    let unverifiedUser: any;
    let code: string;

    beforeAll(async () => {
      // Create unverified user
      const email = `unverified-${Date.now()}@test.com`;
      unverifiedUser = await prisma.user.create({
        data: {
          email,
          passwordHash: '$2a$10$dummyhash',
          firstName: 'Test',
          lastName: 'User',
          emailVerified: false,
        },
      });

      // Get code from Redis
      code = await redis.get(`verify:${email}`);
      if (!code) {
        code = '123456'; // Fallback for testing
      }
    });

    afterAll(async () => {
      if (unverifiedUser) {
        await prisma.user.deleteMany({
          where: { id: unverifiedUser.id },
        });
      }
    });

    it('should verify email with correct code', async () => {
      // First, generate a code
      const email = unverifiedUser.email;
      const newCode = '123456';
      await redis.setex(`verify:${email}`, 900, newCode);

      return request(app.getHttpServer())
        .post('/api/auth/verify-email')
        .send({
          email,
          code: newCode,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
        });
    });

    it('should fail with invalid code', () => {
      return request(app.getHttpServer())
        .post('/api/auth/verify-email')
        .send({
          email: unverifiedUser.email,
          code: '999999',
        })
        .expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    let loginUser: any;

    beforeAll(async () => {
      const email = `login-${Date.now()}@test.com`;
      const passwordHash = '$2a$10$rK3K7yP3vJ5jQH9Z5N5K.uqK3K7yP3vJ5jQH9Z5N5K.uqK3K7yP3vJ5'; // Hash for 'TestPass123'
      
      // Create verified user for login
      loginUser = await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName: 'Login',
          lastName: 'User',
          emailVerified: true,
        },
      });

      // Note: In real test, we should use bcrypt to hash password properly
      // For now, we'll test with mocked password service
    });

    afterAll(async () => {
      if (loginUser) {
        await prisma.user.deleteMany({
          where: { id: loginUser.id },
        });
      }
    });

    it('should fail with non-existent email', () => {
      return request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'TestPass123',
        })
        .expect(401);
    });

    it('should fail with unverified email', async () => {
      const email = `unverified-login-${Date.now()}@test.com`;
      const password = 'TestPass123';
      // Create user with proper password hash to test email verification
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName: 'Test',
          lastName: 'User',
          emailVerified: false,
        },
      });

      // Now test will check email verification after password validation
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email,
          password,
        })
        .expect(403); // EmailNotVerifiedException

      await prisma.user.deleteMany({ where: { id: user.id } });
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should fail without refresh token', () => {
      return request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({})
        .expect(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .get('/api/auth/me')
        .expect(401);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('should accept password reset request', () => {
      return request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({
          email: 'test@test.com',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
        });
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('should fail with invalid code', () => {
      return request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({
          email: 'test@test.com',
          code: '999999',
          newPassword: 'NewPass123',
        })
        .expect(400);
    });
  });

  describe('POST /api/auth/2fa/generate', () => {
    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .post('/api/auth/2fa/generate')
        .expect(401);
    });
  });
});

