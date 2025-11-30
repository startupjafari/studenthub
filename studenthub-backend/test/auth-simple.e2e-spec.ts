import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../src/common/modules/redis.module';
import * as bcrypt from 'bcryptjs';

/**
 * Simplified E2E tests - тестирует основные endpoints
 */
describe('Auth API Endpoints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  const testUsers: string[] = [];

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
    // Cleanup test users
    if (testUsers.length > 0) {
      await prisma.user.deleteMany({
        where: {
          email: { in: testUsers },
        },
      });
    }
    await app.close();
  });

  describe('POST /api/auth/register', () => {
    const testEmail = `test-register-${Date.now()}@test.com`;
    testUsers.push(testEmail);

    it('должен зарегистрировать нового пользователя', () => {
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

    it('должен отклонить невалидный email', () => {
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

    it('должен отклонить слабый пароль', () => {
      return request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'test2@test.com',
          password: '12345',
          firstName: 'Test',
          lastName: 'User',
        })
        .expect(400);
    });

    it('должен отклонить дубликат email', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: 'AnotherPass123',
          firstName: 'Duplicate',
          lastName: 'User',
        })
        .expect(409);
    });
  });

  describe('POST /api/auth/verify-email', () => {
    let unverifiedEmail: string;
    let verificationCode: string;

    beforeAll(async () => {
      unverifiedEmail = `unverified-${Date.now()}@test.com`;
      testUsers.push(unverifiedEmail);

      await prisma.user.create({
        data: {
          email: unverifiedEmail,
          passwordHash: await bcrypt.hash('TestPass123', 10),
          firstName: 'Unverified',
          lastName: 'User',
          emailVerified: false,
        },
      });

      // Получаем или создаем код
      verificationCode = await redis.get(`verify:${unverifiedEmail}`);
      if (!verificationCode) {
        verificationCode = '123456';
        await redis.setex(`verify:${unverifiedEmail}`, 900, verificationCode);
      }
    });

    it('должен подтвердить email с правильным кодом', async () => {
      // Убедимся, что код существует
      if (!(await redis.exists(`verify:${unverifiedEmail}`))) {
        await redis.setex(`verify:${unverifiedEmail}`, 900, verificationCode);
      }

      return request(app.getHttpServer())
        .post('/api/auth/verify-email')
        .send({
          email: unverifiedEmail,
          code: verificationCode,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
        });
    });

    it('должен отклонить неверный код', () => {
      return request(app.getHttpServer())
        .post('/api/auth/verify-email')
        .send({
          email: unverifiedEmail,
          code: '999999',
        })
        .expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    let loginEmail: string;
    let loginPassword: string;

    beforeAll(async () => {
      loginEmail = `login-${Date.now()}@test.com`;
      loginPassword = 'LoginPass123';
      testUsers.push(loginEmail);

      const passwordHash = await bcrypt.hash(loginPassword, 10);
      await prisma.user.create({
        data: {
          email: loginEmail,
          passwordHash,
          firstName: 'Login',
          lastName: 'User',
          emailVerified: true,
        },
      });
    });

    it('должен войти с правильными credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: loginEmail,
          password: loginPassword,
        })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(loginEmail);
    });

    it('должен отклонить неправильный пароль', () => {
      return request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: loginEmail,
          password: 'WrongPassword',
        })
        .expect(401);
    });

    it('должен отклонить несуществующий email', () => {
      return request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'TestPass123',
        })
        .expect(401);
    });
  });

  describe('GET /api/auth/me', () => {
    let userEmail: string;
    let userPassword: string;
    let accessToken: string;

    beforeAll(async () => {
      userEmail = `me-${Date.now()}@test.com`;
      userPassword = 'MePass123';
      testUsers.push(userEmail);

      const passwordHash = await bcrypt.hash(userPassword, 10);
      await prisma.user.create({
        data: {
          email: userEmail,
          passwordHash,
          firstName: 'Me',
          lastName: 'User',
          emailVerified: true,
        },
      });

      // Login to get token
      const loginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: userEmail,
          password: userPassword,
        })
        .expect(200);

      accessToken = loginResponse.body.accessToken;
    });

    it('должен вернуть текущего пользователя', () => {
      return request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('email', userEmail);
          expect(res.body).toHaveProperty('firstName');
          expect(res.body).not.toHaveProperty('passwordHash');
        });
    });

    it('должен отклонить запрос без токена', () => {
      return request(app.getHttpServer())
        .get('/api/auth/me')
        .expect(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    let refreshTokenValue: string;

    beforeAll(async () => {
      const email = `refresh-${Date.now()}@test.com`;
      const password = 'RefreshPass123';
      testUsers.push(email);

      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName: 'Refresh',
          lastName: 'User',
          emailVerified: true,
        },
      });

      // Login to get refresh token
      const loginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email,
          password,
        })
        .expect(200);

      refreshTokenValue = loginResponse.body.refreshToken;
    });

    it('должен обновить access token', () => {
      return request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({
          refreshToken: refreshTokenValue,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('accessToken');
          expect(res.body).toHaveProperty('refreshToken');
        });
    });

    it('должен отклонить неверный refresh token', () => {
      return request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({
          refreshToken: 'invalid-refresh-token',
        })
        .expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    let logoutEmail: string;
    let logoutPassword: string;
    let accessToken: string;
    let refreshToken: string;

    beforeAll(async () => {
      logoutEmail = `logout-${Date.now()}@test.com`;
      logoutPassword = 'LogoutPass123';
      testUsers.push(logoutEmail);

      const passwordHash = await bcrypt.hash(logoutPassword, 10);
      await prisma.user.create({
        data: {
          email: logoutEmail,
          passwordHash,
          firstName: 'Logout',
          lastName: 'User',
          emailVerified: true,
        },
      });

      // Login
      const loginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: logoutEmail,
          password: logoutPassword,
        })
        .expect(200);

      accessToken = loginResponse.body.accessToken;
      refreshToken = loginResponse.body.refreshToken;
    });

    it('должен выполнить выход', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          refreshToken,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
        });

      // Verify token is blacklisted
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({
          refreshToken,
        })
        .expect(401);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('должен принять запрос на сброс пароля', () => {
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

    it('должен отклонить невалидный email', () => {
      return request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({
          email: 'invalid-email',
        })
        .expect(400);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('должен отклонить неверный код', () => {
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
    it('должен отклонить запрос без аутентификации', () => {
      return request(app.getHttpServer())
        .post('/api/auth/2fa/generate')
        .expect(401);
    });
  });
});

