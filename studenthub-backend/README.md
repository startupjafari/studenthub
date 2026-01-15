# StudentHub Backend

Backend приложение для образовательной платформы StudentHub, построенное на NestJS.

## 🚀 Быстрый старт

### Требования

- Node.js 18+ LTS
- PostgreSQL 14+
- Redis 7+
- Docker (опционально, для локальной разработки)

### Установка

```bash
# Установка зависимостей
npm install

# Настройка переменных окружения
cp .env.example .env
# Отредактируйте .env файл

# Применение миграций
npm run db:migrate:prod

# Генерация Prisma Client
npm run db:generate
```

### Запуск

```bash
# Разработка
npm run start:dev

# Production
npm run build
npm run start:prod
```

## 📋 Доступные команды

```bash
# Разработка
npm run start:dev          # Запуск в режиме разработки
npm run start:debug        # Запуск с отладкой

# Сборка
npm run build              # Сборка проекта
npm run start:prod         # Запуск production сборки

# Линтинг и форматирование
npm run lint               # Проверка и исправление ESLint
npm run lint:check         # Только проверка ESLint
npm run lint:fix           # Исправление ESLint + форматирование
npm run format             # Форматирование Prettier
npm run format:check       # Проверка форматирования

# База данных
npm run db:generate        # Генерация Prisma Client
npm run db:migrate         # Применение миграций (dev)
npm run db:migrate:prod    # Применение миграций (prod)
npm run db:push            # Push схемы в БД
npm run db:seed            # Заполнение тестовыми данными
npm run db:studio          # Prisma Studio (GUI)
```

## 🏗️ Структура проекта

```
studenthub-backend/
├── src/
│   ├── main.ts                 # Точка входа
│   ├── app.module.ts           # Корневой модуль
│   ├── config/                 # Конфигурация
│   ├── common/                  # Общие компоненты
│   │   ├── decorators/         # Кастомные декораторы
│   │   ├── guards/             # Guards
│   │   ├── filters/            # Exception filters
│   │   ├── interceptors/       # Interceptors
│   │   ├── services/           # Общие сервисы
│   │   └── protocol/           # Application Level Protocol
│   └── modules/                # Бизнес-модули
│       ├── auth/               # Аутентификация
│       ├── users/              # Пользователи
│       ├── posts/              # Посты
│       └── ...
├── prisma/
│   └── schema.prisma           # Схема базы данных
├── docker/                     # Docker конфигурации
└── scripts/                    # Вспомогательные скрипты
```

## 🔧 Технологии

- **Framework:** NestJS 10
- **Language:** TypeScript 5
- **Database:** PostgreSQL 14+ (Prisma ORM)
- **Cache:** Redis 7+
- **Real-time:** Socket.io
- **Validation:** class-validator, class-transformer
- **Documentation:** Swagger/OpenAPI

## 📚 Документация

Полная документация находится в папке `documentation/`:

- [LOCAL_SETUP.md](../documentation/LOCAL_SETUP.md) - Локальный запуск
- [PRODUCTION_DEPLOYMENT.md](../documentation/PRODUCTION_DEPLOYMENT.md) - Production развертывание
- [ARCHITECTURE.md](../documentation/ARCHITECTURE.md) - Архитектура
- [API.md](../documentation/API.md) - API документация
- [LINTING_FORMATTING.md](../documentation/LINTING_FORMATTING.md) - Линтинг и форматирование

## 🔐 Переменные окружения

Создайте файл `.env` на основе `.env.example`:

```env
# Окружение
NODE_ENV=development
PORT=3000

# База данных
DATABASE_URL=postgresql://user:password@localhost:5432/studenthub

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRATION=15m
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRATION=7d

# Email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASSWORD=password

# Frontend
FRONTEND_URL=http://localhost:3000
```

## 🐳 Docker

```bash
# Запуск всех сервисов
docker compose up -d

# Запуск с load balancer (production-like)
docker compose -f docker-compose.loadbalancer.yml up -d
```

Подробнее: [DOCKER_SETUP.md](../documentation/DOCKER_SETUP.md)

## 🧪 Тестирование

```bash
# Запуск тестов (когда настроено)
npm test

# Тесты с покрытием
npm run test:cov

# E2E тесты
npm run test:e2e
```

## 📖 API Документация

После запуска приложения, Swagger документация доступна по адресу:

```
http://localhost:3000/api/docs
```

## 🤝 Вклад в проект

1. Создайте ветку для вашей функции (`git checkout -b feature/amazing-feature`)
2. Закоммитьте изменения (`git commit -m 'Add amazing feature'`)
3. Запушьте в ветку (`git push origin feature/amazing-feature`)
4. Откройте Pull Request

## 📝 Лицензия

MIT

## 👤 Автор

Mehman Jafari
