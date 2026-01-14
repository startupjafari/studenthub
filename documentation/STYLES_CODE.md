# Стилистика кода Backend

Данный документ описывает стандарты написания кода, архитектурные принципы и лучшие практики для поддержания качественного, поддерживаемого и масштабируемого кода на backend проекта StudentHub.

## Оглавление

1. [Архитектура проекта](#архитектура-проекта)
2. [Общие принципы](#общие-принципы)
3. [Структура модулей](#структура-модулей)
4. [TypeScript стандарты](#typescript-стандарты)
5. [NestJS паттерны](#nestjs-паттерны)
6. [Работа с базой данных](#работа-с-базой-данных)
7. [Валидация и DTO](#валидация-и-dto)
8. [Обработка ошибок](#обработка-ошибок)
9. [Безопасность](#безопасность)
10. [Производительность](#производительность)
11. [Документация кода](#документация-кода)
12. [Тестирование](#тестирование)

---

## Архитектура проекта

### Общая структура

Backend построен на основе **модульной архитектуры NestJS**, которая обеспечивает:

- **Разделение ответственности (SoC)** - каждый модуль отвечает за свою область
- **Масштабируемость** - легко добавлять новые модули
- **Переиспользование** - общие компоненты вынесены в `common/`
- **Тестируемость** - модульная структура упрощает unit-тестирование

### Организация файлов

```
src/
├── main.ts                      # Точка входа приложения
├── app.module.ts                # Корневой модуль
├── config/                      # Конфигурация приложения
│   └── configuration.ts
├── common/                      # Общие компоненты
│   ├── constants/               # Константы и перечисления
│   ├── decorators/              # Кастомные декораторы
│   ├── dto/                     # Общие DTO
│   ├── exceptions/              # Кастомные исключения
│   ├── guards/                  # Guards для авторизации
│   ├── interceptors/            # Interceptors
│   ├── interfaces/              # TypeScript интерфейсы
│   ├── modules/                 # Общие модули (Redis и т.д.)
│   ├── services/                # Общие сервисы
│   └── utils/                   # Утилиты
└── modules/                     # Бизнес-модули
    ├── auth/
    ├── users/
    ├── posts/
    └── ...
```

### Принципы модульности

1. **Каждый модуль независим** - модули должны быть максимально автономными
2. **Общие компоненты в `common/`** - если компонент используется в 3+ модулях, он должен быть в `common/`
3. **Явные зависимости** - все зависимости должны быть явно объявлены через конструктор
4. **Единая точка входа** - каждый модуль экспортирует только необходимые сервисы/компоненты

---

## Общие принципы

### SOLID принципы

#### Single Responsibility Principle (SRP)
Каждый класс должен иметь одну причину для изменения.

```typescript
// ✅ Правильно - разделение ответственности
class PasswordService {
  hashPassword(password: string): Promise<string> { }
  validatePasswordStrength(password: string): void { }
}

class AuthService {
  constructor(private passwordService: PasswordService) {}
  async login(dto: LoginDto) { }
}

// ❌ Неправильно - слишком много ответственности
class AuthService {
  async login() { }
  async hashPassword() { }
  async sendEmail() { }
  async generateToken() { }
}
```

#### Open/Closed Principle (OCP)
Классы должны быть открыты для расширения, но закрыты для модификации.

```typescript
// ✅ Правильно - использование стратегий
interface PaymentStrategy {
  processPayment(amount: number): Promise<void>;
}

class CreditCardStrategy implements PaymentStrategy { }
class PayPalStrategy implements PaymentStrategy { }
```

#### Liskov Substitution Principle (LSP)
Подклассы должны быть заменяемы на своих базовых классов.

#### Interface Segregation Principle (ISP)
Клиенты не должны зависеть от интерфейсов, которые они не используют.

#### Dependency Inversion Principle (DIP)
Зависимости должны быть на абстракциях, а не на конкретных реализациях.

```typescript
// ✅ Правильно - зависимость от интерфейса
constructor(private cacheService: CacheService) {}

// ❌ Неправильно - зависимость от конкретной реализации
constructor(private redisCache: RedisCacheService) {}
```

### DRY (Don't Repeat Yourself)

Избегайте дублирования кода. Выносите повторяющуюся логику в утилиты или базовые классы.

```typescript
// ✅ Правильно - переиспользование
async findById(id: string, userId: string) {
  return this.prisma.post.findFirst({
    where: { id, authorId: userId },
  });
}

async delete(id: string, userId: string) {
  await this.findById(id, userId); // Переиспользование логики
  return this.prisma.post.delete({ where: { id } });
}
```

### KISS (Keep It Simple, Stupid)

Приоритет отдается простым и понятным решениям над сложными.

### YAGNI (You Aren't Gonna Need It)

Не добавляйте функциональность, пока она не понадобится.

---

## Структура модулей

### Стандартная структура модуля

Каждый модуль должен следовать единой структуре:

```
module-name/
├── module-name.module.ts        # Модуль NestJS
├── module-name.controller.ts    # REST контроллер
├── module-name.service.ts       # Бизнес-логика
├── dto/                         # Data Transfer Objects
│   ├── create-module.dto.ts
│   ├── update-module.dto.ts
│   └── get-module.dto.ts
├── guards/                      # Guards (если специфичны для модуля)
├── strategies/                  # Стратегии (если есть)
└── services/                    # Дополнительные сервисы
```

### Модуль (Module)

Модуль - это контейнер для группировки связанных компонентов.

```typescript
@Module({
  imports: [
    // Зависимые модули
    ConfigModule,
    RedisModule,
  ],
  controllers: [PostsController],
  providers: [
    PostsService,
    PrismaService,
    CacheService,
  ],
  exports: [PostsService], // Экспорт для использования в других модулях
})
export class PostsModule {}
```

**Правила:**
- Импортируйте только необходимые модули
- Экспортируйте только те сервисы, которые используются в других модулях
- Избегайте циклических зависимостей

### Контроллер (Controller)

Контроллер обрабатывает HTTP запросы и делегирует бизнес-логику сервисам.

```typescript
@ApiTags('Posts')
@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new post' })
  @ApiResponse({ status: 201, description: 'Post created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(
    @CurrentUser() user: User,
    @Body() createPostDto: CreatePostDto,
  ) {
    return this.postsService.create(user.id, createPostDto);
  }
}
```

**Правила:**
- Контроллеры должны быть тонкими - только маршрутизация и валидация
- Вся бизнес-логика в сервисах
- Используйте декораторы Swagger для документации API
- Применяйте guards для авторизации и валидации
- Используйте правильные HTTP статус-коды

### Сервис (Service)

Сервис содержит бизнес-логику приложения.

```typescript
@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Create a new post
   * @param userId - ID of the user creating the post
   * @param dto - Post creation data
   * @returns Created post
   */
  async create(userId: string, dto: CreatePostDto): Promise<Post> {
    // Валидация
    if (dto.mediaIds?.length > 0) {
      await this.validateMedia(dto.mediaIds);
    }

    // Бизнес-логика
    const post = await this.prisma.post.create({
      data: {
        authorId: userId,
        content: dto.content,
        visibility: dto.visibility || PostVisibility.PUBLIC,
      },
    });

    // Инвалидация кэша
    await this.cache.deletePattern('feed:*');

    this.logger.log(`Post created: ${post.id} by user ${userId}`);
    return post;
  }

  private async validateMedia(mediaIds: string[]): Promise<void> {
    // Приватные вспомогательные методы
  }
}
```

**Правила:**
- Сервисы должны быть независимы от HTTP контекста
- Используйте приватные методы для внутренней логики
- Логируйте важные операции
- Обрабатывайте ошибки и выбрасывайте понятные исключения
- Избегайте циклических зависимостей между сервисами

---

## TypeScript стандарты

### Типизация

#### Избегайте `any`

```typescript
// ❌ Неправильно
function processData(data: any): any {
  return data.map(item => item.value);
}

// ✅ Правильно
interface DataItem {
  value: string;
}

function processData(data: DataItem[]): string[] {
  return data.map(item => item.value);
}
```

#### Используйте строгие типы

```typescript
// ✅ Используйте конкретные типы
userId: string
count: number
isActive: boolean
tags: string[]

// ❌ Избегайте неопределенных типов
userId: string | undefined
count: number | null
```

#### Используйте интерфейсы для объектов

```typescript
// ✅ Правильно
interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

function updateProfile(user: UserProfile): void { }
```

#### Используйте типы для объединений и пересечений

```typescript
type UserRole = 'admin' | 'student' | 'teacher';
type UserWithRole = User & { role: UserRole };
```

### Именование

#### Классы и интерфейсы

```typescript
// PascalCase
class PostsService { }
interface CreatePostDto { }
type UserRole = 'admin' | 'student';
```

#### Переменные и функции

```typescript
// camelCase
const userId = '123';
const getUserById = async (id: string) => { };
const isActive = true;
```

#### Константы

```typescript
// UPPER_SNAKE_CASE для констант
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_PAGE_SIZE = 20;
const JWT_EXPIRATION = '15m';
```

#### Приватные поля

```typescript
class PostsService {
  private readonly logger = new Logger(PostsService.name);
  private cacheKey = 'posts:';
}
```

### Модификаторы доступа

Используйте правильные модификаторы доступа:

```typescript
class PostsService {
  // Публичный - используется извне
  async findAll(): Promise<Post[]> { }

  // Приватный - только внутри класса
  private async validatePost(data: CreatePostDto): void { }

  // Защищенный - для наследования
  protected async formatPost(post: Post): Post { }

  // Readonly - неизменяемое поле
  private readonly logger = new Logger(PostsService.name);
}
```

### Асинхронный код

#### Используйте async/await

```typescript
// ✅ Правильно
async getUser(id: string): Promise<User> {
  const user = await this.prisma.user.findUnique({ where: { id } });
  return user;
}

// ❌ Избегайте промисов без async/await (кроме особых случаев)
getUser(id: string): Promise<User> {
  return this.prisma.user.findUnique({ where: { id } });
}
```

#### Обработка ошибок

```typescript
// ✅ Правильно - используйте try/catch для асинхронных операций
async createPost(dto: CreatePostDto): Promise<Post> {
  try {
    return await this.prisma.post.create({ data: dto });
  } catch (error) {
    this.logger.error(`Failed to create post: ${error.message}`, error.stack);
    throw new BadRequestException('Failed to create post');
  }
}
```

### Деструктуризация

Используйте деструктуризацию для улучшения читаемости:

```typescript
// ✅ Правильно
const { id, email, firstName } = user;
const post = await this.createPost({ content, visibility });

// ❌ Неправильно
const userId = user.id;
const userEmail = user.email;
```

### Опциональные параметры

```typescript
// ✅ Используйте опциональные параметры и значения по умолчанию
function findPosts(
  page: number = 1,
  limit: number = 20,
  search?: string,
): Promise<Post[]> {
  // ...
}
```

---

## NestJS паттерны

### Dependency Injection (DI)

Все зависимости внедряются через конструктор:

```typescript
@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly logger: Logger,
  ) {}
}
```

**Правила:**
- Используйте `private readonly` для инжектируемых зависимостей
- Зависимости объявляются в конструкторе модуля
- Избегайте циклических зависимостей (используйте `forwardRef()` если необходимо)

### Декораторы

#### Стандартные декораторы NestJS

```typescript
@Controller('posts')           // Определение контроллера
@Injectable()                  // Класс как провайдер
@UseGuards(JwtAuthGuard)      // Применение guard
@Get(), @Post(), @Put()       // HTTP методы
@Body(), @Param(), @Query()   // Получение данных запроса
```

#### Кастомные декораторы

Создавайте кастомные декораторы для переиспользования логики:

```typescript
// common/decorators/current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (data: keyof User | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);

// Использование
@Get('me')
getProfile(@CurrentUser() user: User) {
  return user;
}
```

### Guards

Guards используются для авторизации и валидации доступа:

```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
```

**Применение:**

```typescript
// На уровне контроллера
@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController { }

// На уровне метода
@Get(':id')
@UseGuards(OwnershipGuard)
getPost(@Param('id') id: string) { }
```

### Interceptors

Interceptors используются для трансформации данных и логирования:

```typescript
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    
    console.log(`${method} ${url}`);
    return next.handle();
  }
}
```

### Pipes

Pipes используются для валидации и трансформации данных:

```typescript
// Встроенный ValidationPipe используется глобально в main.ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);
```

### Exception Filters

Используйте кастомные исключения для понятных ошибок:

```typescript
export class NotFoundException extends HttpException {
  constructor(resource: string, id: string) {
    super(`${resource} with id ${id} not found`, HttpStatus.NOT_FOUND);
  }
}
```

---

## Работа с базой данных

### Prisma ORM

Проект использует Prisma как ORM для работы с базой данных.

#### Использование PrismaService

```typescript
@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Post | null> {
    return this.prisma.post.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            comments: true,
            reactions: true,
          },
        },
      },
    });
  }
}
```

#### Best Practices для Prisma

1. **Используйте `select` для оптимизации**

```typescript
// ✅ Правильно - выбираем только нужные поля
await this.prisma.user.findUnique({
  where: { id },
  select: {
    id: true,
    email: true,
    firstName: true,
  },
});

// ❌ Неправильно - выбираем все поля
await this.prisma.user.findUnique({ where: { id } });
```

2. **Используйте `include` для связанных данных**

```typescript
await this.prisma.post.findUnique({
  where: { id },
  include: {
    author: true,
    comments: {
      take: 10,
      orderBy: { createdAt: 'desc' },
    },
  },
});
```

3. **Используйте транзакции для атомарных операций**

```typescript
await this.prisma.$transaction(async (tx) => {
  const post = await tx.post.create({ data: postData });
  await tx.postTag.createMany({ data: tagData });
  return post;
});
```

4. **Обрабатывайте ошибки уникальности**

```typescript
try {
  await this.prisma.user.create({ data });
} catch (error) {
  if (error.code === 'P2002') {
    throw new ConflictException('User already exists');
  }
  throw error;
}
```

5. **Используйте пагинацию**

```typescript
async findMany(page: number = 1, limit: number = 20) {
  const skip = (page - 1) * limit;
  
  const [data, total] = await Promise.all([
    this.prisma.post.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    this.prisma.post.count(),
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
```

### Миграции

1. Создавайте миграции для всех изменений схемы
2. Называйте миграции описательно: `add_user_email_verification`
3. Всегда тестируйте миграции на тестовой базе
4. Не редактируйте примененные миграции

---

## Валидация и DTO

### Data Transfer Objects (DTO)

DTO используются для валидации входных данных.

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength, IsEnum } from 'class-validator';

export class CreatePostDto {
  @ApiProperty({ 
    description: 'Post content',
    maxLength: 5000,
    example: 'Hello world!'
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @ApiProperty({
    enum: PostVisibility,
    description: 'Post visibility',
    default: PostVisibility.PUBLIC,
    required: false,
  })
  @IsEnum(PostVisibility)
  @IsOptional()
  visibility?: PostVisibility;
}
```

**Правила для DTO:**

1. **Все поля должны иметь декораторы валидации**
2. **Используйте `@ApiProperty` для Swagger документации**
3. **Разделяйте DTO для создания и обновления**

```typescript
// create-post.dto.ts
export class CreatePostDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}

// update-post.dto.ts
export class UpdatePostDto {
  @IsString()
  @IsOptional()
  content?: string;
}
```

4. **Используйте общие DTO для пагинации**

```typescript
// common/dto/pagination.dto.ts
export class PaginationDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}
```

### Кастомная валидация

Создавайте кастомные валидаторы для сложной логики:

```typescript
// Создание кастомного валидатора
@ValidatorConstraint({ name: 'isValidPassword', async: false })
export class IsValidPasswordConstraint implements ValidatorConstraintInterface {
  validate(password: string): boolean {
    return password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);
  }
}

export function IsValidPassword(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidPasswordConstraint,
    });
  };
}
```

---

## Обработка ошибок

### Кастомные исключения

Создавайте понятные исключения для разных сценариев:

```typescript
// common/exceptions/auth.exceptions.ts
export class InvalidCredentialsException extends HttpException {
  constructor(message = 'Неверный email или пароль') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class EmailAlreadyExistsException extends HttpException {
  constructor(email: string) {
    super(`Email ${email} уже зарегистрирован`, HttpStatus.CONFLICT);
  }
}
```

### Использование исключений

```typescript
@Injectable()
export class AuthService {
  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new InvalidCredentialsException();
    }

    const isValid = await this.passwordService.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isValid) {
      throw new InvalidCredentialsException();
    }

    // ...
  }
}
```

### HTTP статус-коды

Используйте правильные HTTP статус-коды:

- `200 OK` - успешный запрос
- `201 Created` - ресурс создан
- `400 Bad Request` - ошибка валидации
- `401 Unauthorized` - не авторизован
- `403 Forbidden` - нет доступа
- `404 Not Found` - ресурс не найден
- `409 Conflict` - конфликт (например, email уже существует)
- `500 Internal Server Error` - внутренняя ошибка сервера

### Логирование ошибок

```typescript
@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  async create(dto: CreatePostDto): Promise<Post> {
    try {
      return await this.prisma.post.create({ data: dto });
    } catch (error) {
      this.logger.error(
        `Failed to create post: ${error.message}`,
        error.stack,
        'PostsService.create',
      );
      throw new BadRequestException('Failed to create post');
    }
  }
}
```

---

## Безопасность

### Аутентификация и авторизация

1. **Всегда используйте guards для защищенных endpoints**

```typescript
@Controller('posts')
@UseGuards(JwtAuthGuard)  // Обязательная аутентификация
export class PostsController {
  @Post()
  @UseGuards(RolesGuard)  // Дополнительная проверка ролей
  @Roles('admin', 'moderator')
  create(@Body() dto: CreatePostDto) { }
}
```

2. **Проверяйте права доступа на уровне сервиса**

```typescript
async update(id: string, userId: string, dto: UpdatePostDto) {
  const post = await this.prisma.post.findUnique({ where: { id } });
  
  if (post.authorId !== userId) {
    throw new ForbiddenException('You can only edit your own posts');
  }
  
  return this.prisma.post.update({ where: { id }, data: dto });
}
```

3. **Не передавайте чувствительные данные в ответах**

```typescript
// ✅ Правильно - исключаем пароль
const user = await this.prisma.user.findUnique({
  where: { id },
  select: {
    id: true,
    email: true,
    firstName: true,
    // passwordHash не включаем
  },
});
```

### Валидация входных данных

Всегда валидируйте входные данные через DTO:

```typescript
// ValidationPipe настроен глобально в main.ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,           // Удаляет поля, не определенные в DTO
    forbidNonWhitelisted: true, // Выбрасывает ошибку при лишних полях
    transform: true,           // Преобразует типы
  }),
);
```

### Защита от SQL инъекций

Prisma автоматически защищает от SQL инъекций, но важно:

- Никогда не используйте сырые SQL запросы с пользовательскими данными
- Используйте параметризованные запросы Prisma

### Rate Limiting

Используйте rate limiting для защиты от злоупотреблений:

```typescript
@Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 запросов в минуту
@Post('login')
async login(@Body() dto: LoginDto) { }
```

### CORS

CORS настроен в `main.ts`. В production всегда указывайте конкретные origins.

---

## Производительность

### Кэширование

Используйте кэширование для часто запрашиваемых данных:

```typescript
async findById(id: string): Promise<Post> {
  const cacheKey = `post:${id}`;
  
  const cached = await this.cache.get<Post>(cacheKey);
  if (cached) {
    return cached;
  }

  const post = await this.prisma.post.findUnique({ where: { id } });
  await this.cache.set(cacheKey, post, 300); // 5 минут
  
  return post;
}
```

### Пагинация

Всегда используйте пагинацию для списков:

```typescript
async findAll(page: number = 1, limit: number = 20) {
  const skip = (page - 1) * limit;
  
  return this.prisma.post.findMany({
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
  });
}
```

### Оптимизация запросов

1. **Используйте `select` вместо `include` когда возможно**

```typescript
// ✅ Правильно - выбираем только нужные поля
await this.prisma.user.findUnique({
  where: { id },
  select: {
    id: true,
    email: true,
    posts: {
      select: {
        id: true,
        content: true,
      },
    },
  },
});
```

2. **Избегайте N+1 проблем**

```typescript
// ❌ Неправильно - N+1 запросов
const posts = await this.prisma.post.findMany();
for (const post of posts) {
  const author = await this.prisma.user.findUnique({
    where: { id: post.authorId },
  });
}

// ✅ Правильно - один запрос
const posts = await this.prisma.post.findMany({
  include: {
    author: true,
  },
});
```

3. **Используйте индексы в базе данных**

Определяйте индексы в `schema.prisma` для часто используемых полей.

### Ленивая загрузка

Не загружайте данные, которые не нужны:

```typescript
// ✅ Правильно - загружаем связи только при необходимости
async findById(id: string, includeAuthor: boolean = false) {
  return this.prisma.post.findUnique({
    where: { id },
    include: includeAuthor ? { author: true } : undefined,
  });
}
```

---

## Документация кода

### Комментарии

Используйте JSDoc для документирования функций и методов:

```typescript
/**
 * Создает новый пост
 * @param userId - ID пользователя, создающего пост
 * @param dto - Данные для создания поста
 * @returns Созданный пост
 * @throws {BadRequestException} Если валидация не прошла
 */
async create(userId: string, dto: CreatePostDto): Promise<Post> {
  // ...
}
```

### Swagger документация

Документируйте все endpoints через Swagger:

```typescript
@ApiTags('Posts')
@Controller('posts')
export class PostsController {
  @Post()
  @ApiOperation({ summary: 'Create a new post' })
  @ApiResponse({
    status: 201,
    description: 'Post created successfully',
    type: PostResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(@Body() dto: CreatePostDto) { }
}
```

### README модуля

Для сложных модулей создавайте README с описанием:

- Назначение модуля
- Основные endpoints
- Зависимости
- Примеры использования

---

## Тестирование

### Структура тестов

Тесты должны следовать структуре исходного кода:

```
src/
└── modules/
    └── posts/
        ├── posts.service.ts
        └── posts.service.spec.ts
```

### Unit тесты

Тестируйте сервисы изолированно:

```typescript
describe('PostsService', () => {
  let service: PostsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PostsService,
        {
          provide: PrismaService,
          useValue: {
            post: {
              create: jest.fn(),
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<PostsService>(PostsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should create a post', async () => {
    const dto = { content: 'Test post' };
    const userId = 'user-id';
    
    jest.spyOn(prisma.post, 'create').mockResolvedValue({
      id: 'post-id',
      ...dto,
      authorId: userId,
    } as any);

    const result = await service.create(userId, dto);
    
    expect(result.content).toBe(dto.content);
    expect(prisma.post.create).toHaveBeenCalled();
  });
});
```

### E2E тесты

Используйте E2E тесты для проверки интеграции:

```typescript
describe('PostsController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/posts (POST)', () => {
    return request(app.getHttpServer())
      .post('/posts')
      .send({ content: 'Test post' })
      .expect(201);
  });
});
```

---

## Заключение

Следование этим стандартам и лучшим практикам поможет поддерживать высокое качество кода, упростит разработку и обеспечит масштабируемость приложения.

### Ключевые принципы

1. **Модульность** - разделяйте код на логические модули
2. **Типизация** - используйте строгие типы TypeScript
3. **Валидация** - всегда валидируйте входные данные
4. **Безопасность** - проверяйте права доступа на всех уровнях
5. **Производительность** - оптимизируйте запросы и используйте кэширование
6. **Документация** - документируйте код и API
7. **Тестирование** - пишите тесты для критичной логики

### Полезные команды

```bash
# Линтинг
npm run lint

# Форматирование
npm run format

# Тестирование
npm run test
npm run test:e2e

# Проверка типов
npm run build  # TypeScript компиляция проверяет типы
```

---

*Документ актуален на момент последнего обновления. При изменениях в проекте документ должен быть обновлен соответственно.*
