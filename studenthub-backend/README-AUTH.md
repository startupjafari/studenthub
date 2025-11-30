# StudentHub Auth Module

Полноценный Auth Module для NestJS приложения StudentHub с поддержкой JWT, 2FA, email verification и восстановления пароля.

## 🚀 Возможности

- ✅ Регистрация и верификация email
- ✅ JWT аутентификация (Access + Refresh tokens)
- ✅ Two-Factor Authentication (2FA) через TOTP
- ✅ Восстановление пароля через email
- ✅ Смена пароля
- ✅ Управление сессиями (logout, logout all)
- ✅ Rate limiting на всех критичных endpoints
- ✅ Redis для хранения токенов и кодов верификации
- ✅ Полная Swagger документация
- ✅ Защита от OWASP Top 10

## 📋 Требования

- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- NestJS 10+

## 🛠️ Установка

1. Установите зависимости:

```bash
npm install
```

2. Создайте файл `.env` на основе `.env.example`:

```bash
cp .env.example .env
```

3. Настройте переменные окружения в `.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/studenthub
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-super-secret-refresh-key
REDIS_HOST=localhost
REDIS_PORT=6379
SENDGRID_API_KEY=your-sendgrid-api-key
```

4. Запустите миграции Prisma:

```bash
npm run db:migrate
```

5. Запустите приложение:

```bash
npm run start:dev
```

## 📚 API Endpoints

### Регистрация и верификация

- `POST /api/auth/register` - Регистрация нового пользователя
- `POST /api/auth/verify-email` - Подтверждение email по коду
- `POST /api/auth/resend-verification` - Повторная отправка кода

### Аутентификация

- `POST /api/auth/login` - Логин с email/password
- `POST /api/auth/logout` - Выход (blacklist refresh token)
- `POST /api/auth/refresh` - Обновление access token
- `GET /api/auth/me` - Получить текущего пользователя (protected)

### Восстановление пароля

- `POST /api/auth/forgot-password` - Запрос на сброс пароля
- `POST /api/auth/reset-password` - Сброс пароля по коду
- `PUT /api/auth/change-password` - Смена пароля (protected)

### Two-Factor Authentication (2FA)

- `POST /api/auth/2fa/generate` - Генерация QR кода для 2FA (protected)
- `POST /api/auth/2fa/enable` - Включение 2FA с проверкой кода (protected)
- `POST /api/auth/2fa/disable` - Отключение 2FA (protected)
- `POST /api/auth/2fa/verify` - Верификация 2FA кода при логине

## 📖 Swagger Documentation

После запуска приложения, Swagger документация доступна по адресу:

```
http://localhost:3000/api/docs
```

## 🔐 Security Features

### JWT Tokens
- **Access Token**: 15 минут expiration
- **Refresh Token**: 7 дней expiration
- Refresh токены хранятся в Redis с TTL
- Blacklist для refresh токенов при logout
- Rotation refresh токенов при каждом обновлении

### Password Security
- Минимум 8 символов
- Хеширование с bcryptjs (10 rounds)
- Проверка на часто используемые пароли
- Password strength validator

### Rate Limiting
- Login: 5 попыток за 15 минут per IP
- Register: 3 попытки за час per IP
- Reset password: 3 попытки за час per email
- 2FA verify: 5 попыток за 15 минут per user

### Email Verification
- 6-значный код с TTL 15 минут
- Хранение в Redis
- Email не верифицирован = не может пользоваться системой

## 🧪 Тестирование

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## 📁 Структура модуля

```
src/modules/auth/
├── auth.module.ts
├── auth.controller.ts
├── auth.service.ts
├── dto/
│   ├── register.dto.ts
│   ├── login.dto.ts
│   ├── refresh-token.dto.ts
│   ├── verify-email.dto.ts
│   ├── forgot-password.dto.ts
│   ├── reset-password.dto.ts
│   ├── change-password.dto.ts
│   ├── enable-2fa.dto.ts
│   └── verify-2fa.dto.ts
├── strategies/
│   ├── jwt.strategy.ts
│   ├── jwt-refresh.strategy.ts
│   └── local.strategy.ts
├── guards/
│   ├── jwt-auth.guard.ts
│   ├── jwt-refresh.guard.ts
│   ├── roles.guard.ts
│   ├── 2fa.guard.ts
│   └── email-verified.guard.ts
├── decorators/
│   ├── current-user.decorator.ts
│   ├── roles.decorator.ts
│   └── public.decorator.ts
├── services/
│   ├── token.service.ts
│   ├── password.service.ts
│   ├── 2fa.service.ts
│   └── email-verification.service.ts
└── interfaces/
    ├── jwt-payload.interface.ts
    └── auth-response.interface.ts
```

## 🔧 Использование Guards и Decorators

### Защита endpoints

```typescript
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { Public } from './decorators/public.decorator';

// Публичный endpoint
@Public()
@Get('public')
getPublicData() {
  return { message: 'This is public' };
}

// Защищенный endpoint
@UseGuards(JwtAuthGuard)
@Get('protected')
getProtectedData(@CurrentUser() user) {
  return { user };
}

// Endpoint с проверкой ролей
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Get('admin')
getAdminData() {
  return { message: 'Admin only' };
}
```

### Получение текущего пользователя

```typescript
import { CurrentUser } from './decorators/current-user.decorator';

@Get('profile')
@UseGuards(JwtAuthGuard)
getProfile(@CurrentUser() user) {
  return user;
}

// Или получить только ID
@Get('my-id')
@UseGuards(JwtAuthGuard)
getMyId(@CurrentUser('id') userId: string) {
  return { userId };
}
```

## 📝 Примеры использования

### Регистрация

```bash
POST /api/auth/register
Content-Type: application/json

{
  "email": "student@university.edu",
  "password": "SecurePass123",
  "firstName": "John",
  "lastName": "Doe"
}
```

### Логин

```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "student@university.edu",
  "password": "SecurePass123"
}
```

### Использование токенов

```bash
GET /api/auth/me
Authorization: Bearer <access_token>
```

### Обновление токена

```bash
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "<refresh_token>"
}
```

## 🚨 Важные замечания

1. **JWT Secrets**: Обязательно измените JWT_SECRET и JWT_REFRESH_SECRET в production
2. **Email**: Настройте SendGrid API key для отправки email
3. **Redis**: Убедитесь, что Redis запущен перед запуском приложения
4. **Database**: Выполните миграции Prisma перед первым запуском
5. **Security**: Используйте HTTPS в production
6. **Rate Limiting**: Настройте Redis для rate limiting в production

## 📄 Лицензия

MIT

## 👥 Автор

Mehman Jafari

