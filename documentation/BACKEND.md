# Backend - Документация

## Обзор

Backend StudentHub построен на NestJS - мощном Node.js фреймворке для создания масштабируемых серверных приложений. API использует REST архитектуру с поддержкой WebSocket для real-time функций.

## Архитектура

### Структура проекта

```
studenthub-backend/
├── src/
│   ├── main.ts                 # Точка входа приложения
│   ├── app.module.ts           # Корневой модуль
│   ├── config/                 # Конфигурация
│   ├── common/                 # Общие компоненты
│   │   ├── decorators/         # Кастомные декораторы
│   │   ├── guards/             # Guards для авторизации
│   │   ├── services/           # Общие сервисы
│   │   └── interfaces/         # TypeScript интерфейсы
│   └── modules/                # Бизнес-модули
│       ├── auth/               # Аутентификация
│       ├── users/              # Пользователи
│       ├── posts/              # Посты
│       ├── messages/           # Сообщения
│       ├── groups/             # Группы
│       └── ...
├── prisma/
│   └── schema.prisma           # Схема базы данных
└── docker-compose.yml          # Docker конфигурация
```

## Установка и настройка

### Требования

- Node.js 18 или выше
- PostgreSQL 14 или выше
- Redis 7 или выше
- npm или yarn

### Установка зависимостей

```bash
cd studenthub-backend
npm install
```

### Переменные окружения

Создайте файл `.env` в корне backend проекта. Пример переменных:

```
# Application
NODE_ENV=development
PORT=3000
APP_NAME=StudentHub

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/studenthub?schema=public

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# JWT
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_EXPIRATION=15m
JWT_REFRESH_SECRET=your-super-secret-refresh-key-min-32-chars
JWT_REFRESH_EXPIRATION=7d

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=noreply@studenthub.com

# Frontend
FRONTEND_URL=http://localhost:4000
```

### Запуск базы данных

Используйте Docker Compose для быстрого запуска PostgreSQL и Redis:

```bash
docker compose up -d
```

### Настройка базы данных

1. Сгенерируйте Prisma Client:
```bash
npm run db:generate
```

2. Выполните миграции:
```bash
npm run db:migrate
```

3. (Опционально) Заполните базу тестовыми данными:
```bash
npm run db:seed
```

### Запуск приложения

Разработка:
```bash
npm run start:dev
```

Production:
```bash
npm run build
npm run start:prod
```

## Модули

### Auth Module

Модуль аутентификации и авторизации.

**Основные функции:**
- Регистрация пользователей
- Вход в систему
- Email верификация
- Двухфакторная аутентификация (2FA)
- Обновление токенов
- Восстановление пароля

**Endpoints:**
- POST /api/auth/register - Регистрация
- POST /api/auth/login - Вход
- POST /api/auth/refresh - Обновление токена
- POST /api/auth/verify-email - Верификация email
- POST /api/auth/resend-verification - Повторная отправка кода
- POST /api/auth/enable-2fa - Включение 2FA
- POST /api/auth/verify-2fa - Проверка 2FA кода
- POST /api/auth/disable-2fa - Отключение 2FA
- POST /api/auth/forgot-password - Запрос сброса пароля
- POST /api/auth/reset-password - Сброс пароля
- POST /api/auth/change-password - Изменение пароля

### Users Module

Управление пользователями.

**Endpoints:**
- GET /api/users/me - Получить текущего пользователя
- GET /api/users/:id - Получить пользователя по ID
- GET /api/users/search - Поиск пользователей
- PATCH /api/users/me - Обновить профиль
- POST /api/users/me/avatar - Загрузить аватар

### Posts Module

Управление постами.

**Endpoints:**
- GET /api/posts - Получить список постов (с пагинацией)
- GET /api/posts/:id - Получить пост по ID
- POST /api/posts - Создать пост
- PATCH /api/posts/:id - Обновить пост
- DELETE /api/posts/:id - Удалить пост

### Messages Module

Приватные сообщения.

**Endpoints:**
- GET /api/messages/conversations - Список бесед
- GET /api/messages/conversations/:id - Получить беседу
- POST /api/messages - Отправить сообщение
- GET /api/messages/conversations/:id/messages - Сообщения беседы

### Groups Module

Управление учебными группами.

**Endpoints:**
- GET /api/groups - Список групп
- GET /api/groups/:id - Получить группу
- POST /api/groups - Создать группу
- PATCH /api/groups/:id - Обновить группу
- DELETE /api/groups/:id - Удалить группу
- POST /api/groups/:id/members - Добавить участника
- DELETE /api/groups/:id/members/:userId - Удалить участника

### WebSocket Module

Real-time коммуникация через Socket.io.

**Namespaces:**
- /messages - Приватные сообщения
- /groups - Групповые сообщения
- /notifications - Уведомления

**События:**
- message:new - Новое сообщение
- message:read - Сообщение прочитано
- notification:new - Новое уведомление

## Guards и Decorators

### Guards

- **JwtAuthGuard** - Проверка JWT токена
- **RolesGuard** - Проверка ролей пользователя
- **EmailVerifiedGuard** - Проверка верификации email
- **TwoFactorGuard** - Проверка 2FA

### Decorators

- **@CurrentUser()** - Получить текущего пользователя из токена
- **@Roles()** - Указать требуемые роли
- **@Public()** - Публичный endpoint (без авторизации)
- **@SkipEmailVerification()** - Пропустить проверку email

## Сервисы

### PrismaService

Сервис для работы с базой данных через Prisma ORM.

### CacheService

Сервис для кэширования данных в Redis.

### FileUploadService

Сервис для загрузки файлов (поддержка AWS S3 и локального хранилища).

### NotificationHelperService

Вспомогательный сервис для создания и отправки уведомлений.

## Безопасность

### Rate Limiting

Приложение использует @nestjs/throttler для ограничения количества запросов:

- Short: 100 запросов в минуту
- Medium: 200 запросов в 10 минут
- Long: 500 запросов в 15 минут

### CORS

Настроен для работы с указанными frontend URL. Настраивается через переменную окружения FRONTEND_URL.

### Helmet

Используется Helmet.js для защиты HTTP заголовков.

### Валидация

Все входные данные валидируются через class-validator DTOs.

## API Документация

Swagger документация доступна по адресу:
```
http://localhost:3000/api/docs
```

## Скрипты

- `npm run start:dev` - Запуск в режиме разработки
- `npm run build` - Сборка проекта
- `npm run start:prod` - Запуск production версии
- `npm run lint` - Проверка кода
- `npm run format` - Форматирование кода
- `npm run db:generate` - Генерация Prisma Client
- `npm run db:migrate` - Выполнение миграций
- `npm run db:push` - Применение изменений схемы без миграций
- `npm run db:studio` - Открыть Prisma Studio





