# Разработка - Руководство

## Начало работы

### Установка

1. Клонируйте репозиторий
2. Установите зависимости: `npm install`
3. Настройте `.env` файл
4. Запустите базу данных через Docker Compose
5. Выполните миграции: `npm run db:migrate`
6. Запустите сервер: `npm run start:dev`

### Структура проекта

```
studenthub-backend/
├── src/
│   ├── main.ts              # Точка входа
│   ├── app.module.ts        # Корневой модуль
│   ├── config/              # Конфигурация
│   ├── common/              # Общие компоненты
│   │   ├── decorators/      # Кастомные декораторы
│   │   ├── guards/          # Guards
│   │   ├── services/        # Общие сервисы
│   │   └── interfaces/      # Интерфейсы
│   └── modules/             # Бизнес-модули
├── prisma/
│   └── schema.prisma        # Схема БД
└── docker-compose.yml       # Docker конфигурация
```

## Стиль кода

### TypeScript

- Используйте строгую типизацию
- Избегайте `any`
- Используйте интерфейсы для объектов
- Используйте enums для констант

### NestJS паттерны

- Модули для организации кода
- Сервисы для бизнес-логики
- Контроллеры для обработки запросов
- DTOs для валидации данных
- Guards для авторизации
- Decorators для метаданных

### Именование

- Файлы: kebab-case (user.service.ts)
- Классы: PascalCase (UserService)
- Переменные: camelCase (userName)
- Константы: UPPER_SNAKE_CASE (MAX_RETRIES)

## Создание нового модуля

### 1. Генерация модуля

```bash
nest generate module modules/feature-name
nest generate controller modules/feature-name
nest generate service modules/feature-name
```

### 2. Структура модуля

```
modules/feature-name/
├── feature-name.module.ts
├── feature-name.controller.ts
├── feature-name.service.ts
└── dto/
    ├── create-feature.dto.ts
    └── update-feature.dto.ts
```

### 3. Пример модуля

**feature-name.module.ts:**
```typescript
import { Module } from '@nestjs/common';
import { FeatureNameController } from './feature-name.controller';
import { FeatureNameService } from './feature-name.service';

@Module({
  controllers: [FeatureNameController],
  providers: [FeatureNameService],
  exports: [FeatureNameService],
})
export class FeatureNameModule {}
```

**feature-name.controller.ts:**
```typescript
import { Controller, Get, Post, Body } from '@nestjs/common';
import { FeatureNameService } from './feature-name.service';
import { CreateFeatureDto } from './dto/create-feature.dto';

@Controller('feature-name')
export class FeatureNameController {
  constructor(private readonly service: FeatureNameService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() createDto: CreateFeatureDto) {
    return this.service.create(createDto);
  }
}
```

**feature-name.service.ts:**
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/services/prisma.service';
import { CreateFeatureDto } from './dto/create-feature.dto';

@Injectable()
export class FeatureNameService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.featureName.findMany();
  }

  async create(createDto: CreateFeatureDto) {
    return this.prisma.featureName.create({
      data: createDto,
    });
  }
}
```

## Работа с базой данных

### Prisma

1. Измените схему в `prisma/schema.prisma`
2. Создайте миграцию: `npm run db:migrate`
3. Сгенерируйте клиент: `npm run db:generate`

### Запросы

```typescript
// Простой запрос
const users = await this.prisma.user.findMany();

// С фильтрами
const users = await this.prisma.user.findMany({
  where: {
    role: 'STUDENT',
    emailVerified: true,
  },
});

// С пагинацией
const users = await this.prisma.user.findMany({
  skip: (page - 1) * limit,
  take: limit,
});

// С отношениями
const user = await this.prisma.user.findUnique({
  where: { id: userId },
  include: {
    posts: true,
    friends: true,
  },
});
```

## Валидация данных

### DTO с class-validator

```typescript
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;
}
```

## Авторизация

### Использование Guards

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  @Get('me')
  getMe(@CurrentUser() user: User) {
    return user;
  }

  @Get('admin')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  adminOnly() {
    return 'Admin only';
  }
}
```

## Обработка ошибок

### Кастомные исключения

```typescript
import { NotFoundException, BadRequestException } from '@nestjs/common';

if (!user) {
  throw new NotFoundException('User not found');
}

if (user.email === email) {
  throw new BadRequestException('Email already exists');
}
```

## Логирование

### Использование встроенного логгера

```typescript
import { Logger } from '@nestjs/common';

export class MyService {
  private readonly logger = new Logger(MyService.name);

  someMethod() {
    this.logger.log('Info message');
    this.logger.error('Error message', error.stack);
    this.logger.warn('Warning message');
    this.logger.debug('Debug message');
  }
}
```

## Тестирование

### Запуск тестов

```bash
npm test
npm run test:watch
npm run test:cov
```

## Git workflow

### Ветки

- `main` - production код
- `develop` - разработка
- `feature/feature-name` - новая функция
- `fix/bug-name` - исправление бага

### Коммиты

Используйте conventional commits:

- `feat:` - новая функция
- `fix:` - исправление бага
- `docs:` - документация
- `style:` - форматирование
- `refactor:` - рефакторинг
- `test:` - тесты
- `chore:` - рутинные задачи

Пример:
```
feat: add user registration endpoint
fix: resolve email verification bug
docs: update API documentation
```

## Полезные команды

```bash
# Разработка
npm run start:dev          # Запуск с hot reload
npm run start:debug         # Запуск с debugger

# База данных
npm run db:generate         # Генерация Prisma Client
npm run db:migrate           # Создание миграции
npm run db:push              # Применить изменения без миграции
npm run db:studio            # Открыть Prisma Studio

# Код
npm run lint                 # Проверка кода
npm run format               # Форматирование
npm run build                # Сборка

# Docker
docker compose up -d         # Запуск сервисов
docker compose down          # Остановка сервисов
docker compose logs -f        # Просмотр логов
```

## Отладка

### VS Code

Создайте `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug NestJS",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "start:debug"],
      "console": "integratedTerminal",
      "restart": true,
      "protocol": "inspector"
    }
  ]
}
```

## Best Practices

1. Всегда валидируйте входные данные
2. Используйте типы вместо any
3. Обрабатывайте ошибки правильно
4. Используйте async/await вместо промисов
5. Логируйте важные события
6. Пишите понятные комментарии
7. Следуйте принципу DRY (Don't Repeat Yourself)
8. Разделяйте ответственность (SRP)
9. Используйте dependency injection
10. Тестируйте критичный код





