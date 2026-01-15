# Общие принципы написания кода StudentHub

## 🎯 Философия кода

Код в проекте StudentHub должен быть:
- **Читаемым** - понятным для других разработчиков
- **Поддерживаемым** - легко изменять и расширять
- **Масштабируемым** - готовым к росту проекта
- **Тестируемым** - легко покрывать тестами
- **Безопасным** - следовать best practices безопасности

---

## 📐 Архитектурные принципы

### 1. Separation of Concerns (Разделение ответственности)

Каждый модуль, класс и функция должны иметь одну четко определенную ответственность.

**✅ Хорошо:**
```typescript
// Сервис отвечает только за бизнес-логику
class PostsService {
  async createPost(data: CreatePostDto) {
    // Бизнес-логика создания поста
  }
}

// Контроллер отвечает только за HTTP запросы
class PostsController {
  @Post()
  async create(@Body() data: CreatePostDto) {
    return this.postsService.createPost(data);
  }
}
```

**❌ Плохо:**
```typescript
// Смешивание ответственностей
class PostsController {
  @Post()
  async create(@Body() data: CreatePostDto) {
    // Валидация, бизнес-логика, работа с БД - все в одном месте
    const post = await this.prisma.post.create({...});
    // ...
  }
}
```

### 2. DRY (Don't Repeat Yourself)

Избегайте дублирования кода. Выносите общую логику в переиспользуемые функции, сервисы или утилиты.

**✅ Хорошо:**
```typescript
// Общая утилита
export function formatDate(date: Date): string {
  return format(date, 'dd.MM.yyyy');
}

// Использование в разных местах
const postDate = formatDate(post.createdAt);
const commentDate = formatDate(comment.createdAt);
```

**❌ Плохо:**
```typescript
// Дублирование кода
const postDate = format(post.createdAt, 'dd.MM.yyyy');
const commentDate = format(comment.createdAt, 'dd.MM.yyyy');
```

### 3. SOLID принципы

#### Single Responsibility Principle (SRP)
Каждый класс должен иметь только одну причину для изменения.

#### Open/Closed Principle (OCP)
Классы должны быть открыты для расширения, но закрыты для модификации.

#### Liskov Substitution Principle (LSP)
Подклассы должны быть заменяемы на свои базовые классы.

#### Interface Segregation Principle (ISP)
Клиенты не должны зависеть от интерфейсов, которые они не используют.

#### Dependency Inversion Principle (DIP)
Зависимости должны быть на абстракциях, а не на конкретных реализациях.

---

## 💻 Стандарты кодирования

### TypeScript

#### 1. Строгая типизация

**✅ Хорошо:**
```typescript
interface User {
  id: string;
  email: string;
  firstName: string;
}

function getUser(id: string): Promise<User> {
  // ...
}
```

**❌ Плохо:**
```typescript
function getUser(id: any): Promise<any> {
  // ...
}
```

#### 2. Избегайте `any`

Используйте `unknown` или конкретные типы вместо `any`.

**✅ Хорошо:**
```typescript
function processData(data: unknown): void {
  if (typeof data === 'string') {
    // обработка строки
  }
}
```

**❌ Плохо:**
```typescript
function processData(data: any): void {
  // ...
}
```

#### 3. Используйте интерфейсы для объектов

**✅ Хорошо:**
```typescript
interface CreatePostDto {
  content: string;
  visibility: PostVisibility;
}
```

**❌ Плохо:**
```typescript
function createPost(data: { content: string; visibility: string }) {
  // ...
}
```

### Именование

#### 1. Переменные и функции

- **camelCase** для переменных и функций
- **PascalCase** для классов и интерфейсов
- **UPPER_SNAKE_CASE** для констант
- **kebab-case** для файлов

**Примеры:**
```typescript
// Переменные
const userName = 'John';
const isActive = true;

// Функции
function getUserById(id: string) { }
async function createPost() { }

// Классы
class PostsService { }
interface UserData { }

// Константы
const MAX_RETRY_ATTEMPTS = 3;
const API_BASE_URL = 'https://api.example.com';
```

#### 2. Файлы и папки

```
✅ posts.service.ts
✅ create-post.dto.ts
✅ posts.controller.ts
✅ posts.module.ts

❌ PostsService.ts
❌ createPost.dto.ts
❌ posts_controller.ts
```

### Комментарии

#### 1. Когда комментировать

- Сложная бизнес-логика
- Неочевидные решения
- TODO и FIXME
- Публичные API

**✅ Хорошо:**
```typescript
/**
 * Создает пост с автоматической модерацией контента
 * Проверяет на спам и применяет фильтры перед публикацией
 */
async createPost(data: CreatePostDto): Promise<Post> {
  // Проверка на спам через внешний сервис
  const isSpam = await this.spamDetectionService.check(data.content);
  
  if (isSpam) {
    throw new BadRequestException('Post contains spam');
  }
  
  // ...
}
```

**❌ Плохо:**
```typescript
// Создает пост
async createPost(data: CreatePostDto): Promise<Post> {
  // Проверка
  const isSpam = await this.spamDetectionService.check(data.content);
  // ...
}
```

#### 2. Избегайте избыточных комментариев

**❌ Плохо:**
```typescript
// Увеличиваем счетчик на 1
counter = counter + 1;
```

---

## 🏗️ Структура кода

### Backend (NestJS)

#### Структура модуля

```
modules/posts/
├── posts.module.ts           # Регистрация модуля
├── posts.controller.ts       # HTTP endpoints
├── posts.service.ts          # Бизнес-логика
├── dto/                      # Data Transfer Objects
│   ├── create-post.dto.ts
│   └── update-post.dto.ts
├── entities/                 # Сущности (опционально)
└── posts.gateway.ts          # WebSocket (если нужно)
```

#### Порядок методов в классе

```typescript
class PostsService {
  // 1. Конструктор
  constructor(private prisma: PrismaService) {}
  
  // 2. Публичные методы (CRUD)
  async findAll() { }
  async findOne(id: string) { }
  async create(data: CreatePostDto) { }
  async update(id: string, data: UpdatePostDto) { }
  async delete(id: string) { }
  
  // 3. Приватные методы
  private validatePost(data: CreatePostDto) { }
  private formatPost(post: Post) { }
}
```

### Frontend (Next.js)

#### Структура feature

```
features/posts/
├── api/
│   └── postsApi.ts          # RTK Query endpoints
├── components/
│   ├── PostCard.tsx
│   └── PostFeed.tsx
├── hooks/
│   └── usePosts.ts
└── types/
    └── post.types.ts
```

---

## 🔒 Безопасность

### 1. Валидация входных данных

**✅ Хорошо:**
```typescript
@Post()
async create(@Body() createPostDto: CreatePostDto) {
  // DTO автоматически валидируется через class-validator
  return this.postsService.create(createPostDto);
}

// DTO с валидацией
export class CreatePostDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;
  
  @IsEnum(PostVisibility)
  visibility: PostVisibility;
}
```

**❌ Плохо:**
```typescript
@Post()
async create(@Body() data: any) {
  // Нет валидации!
  return this.postsService.create(data);
}
```

### 2. Защита от SQL Injection

**✅ Хорошо (Prisma автоматически защищает):**
```typescript
// Prisma использует prepared statements
await this.prisma.post.findUnique({
  where: { id: userId } // Безопасно
});
```

**❌ Плохо (никогда не делайте так):**
```typescript
// НИКОГДА не используйте raw SQL с конкатенацией
await this.prisma.$queryRaw`SELECT * FROM posts WHERE id = ${userId}`;
```

### 3. Хеширование паролей

**✅ Хорошо:**
```typescript
import * as bcrypt from 'bcrypt';

const hashedPassword = await bcrypt.hash(password, 10);
const isMatch = await bcrypt.compare(password, hashedPassword);
```

**❌ Плохо:**
```typescript
// НИКОГДА не храните пароли в открытом виде
const hashedPassword = password; // ❌
```

---

## ⚡ Производительность

### 1. Оптимизация запросов к БД

**✅ Хорошо:**
```typescript
// Использование select для получения только нужных полей
const posts = await this.prisma.post.findMany({
  select: {
    id: true,
    content: true,
    author: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    },
  },
});
```

**❌ Плохо:**
```typescript
// Получение всех полей, включая ненужные
const posts = await this.prisma.post.findMany({
  include: {
    author: true, // Включает все поля пользователя
  },
});
```

### 2. Пагинация

**✅ Хорошо:**
```typescript
async findAll(page: number = 1, limit: number = 10) {
  const skip = (page - 1) * limit;
  
  const [items, total] = await Promise.all([
    this.prisma.post.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    this.prisma.post.count(),
  ]);
  
  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
```

**❌ Плохо:**
```typescript
// Загрузка всех записей
async findAll() {
  return this.prisma.post.findMany(); // Может быть миллионы записей!
}
```

### 3. Кэширование

**✅ Хорошо:**
```typescript
@Cacheable('posts', 300) // Кэш на 5 минут
async findPopularPosts() {
  return this.prisma.post.findMany({
    where: { isPopular: true },
  });
}
```

---

## 🧪 Тестирование

### 1. Unit тесты

**✅ Хорошо:**
```typescript
describe('PostsService', () => {
  let service: PostsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [PostsService, PrismaService],
    }).compile();

    service = module.get<PostsService>(PostsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should create a post', async () => {
    const createPostDto = { content: 'Test post' };
    const result = await service.create(createPostDto);
    
    expect(result).toHaveProperty('id');
    expect(result.content).toBe(createPostDto.content);
  });
});
```

### 2. Тестирование граничных случаев

```typescript
it('should throw error if content is empty', async () => {
  await expect(
    service.create({ content: '' })
  ).rejects.toThrow(BadRequestException);
});
```

---

## 📝 Документация кода

### 1. JSDoc комментарии для публичных API

```typescript
/**
 * Создает новый пост
 * @param createPostDto - Данные для создания поста
 * @returns Созданный пост
 * @throws {BadRequestException} Если данные невалидны
 * @throws {UnauthorizedException} Если пользователь не авторизован
 */
async create(createPostDto: CreatePostDto): Promise<Post> {
  // ...
}
```

### 2. README для модулей

Каждый сложный модуль должен иметь README с описанием:
- Назначение модуля
- Основные функции
- Примеры использования
- Зависимости

---

## 🔄 Git и версионирование

### Commit сообщения

**Формат:**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Типы:**
- `feat` - новая функция
- `fix` - исправление бага
- `docs` - документация
- `style` - форматирование
- `refactor` - рефакторинг
- `test` - тесты
- `chore` - рутинные задачи

**Примеры:**
```
feat(posts): add post creation with media upload

fix(auth): resolve token refresh issue

docs(api): update authentication endpoints
```

### Ветвление

- `main` - production код
- `develop` - разработка
- `feature/*` - новые функции
- `fix/*` - исправления багов
- `hotfix/*` - критические исправления

---

## 📚 Дополнительные ресурсы

- [STYLES_CODE.md](STYLES_CODE.md) - Детальные стандарты кодирования Backend
- [DEVELOPMENT.md](DEVELOPMENT.md) - Руководство для разработчиков
- [NestJS Best Practices](https://docs.nestjs.com/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

## ✅ Чек-лист перед коммитом

- [ ] Код следует принципам SOLID
- [ ] Нет дублирования кода (DRY)
- [ ] Все функции типизированы (нет `any`)
- [ ] Валидация входных данных
- [ ] Обработка ошибок
- [ ] Комментарии для сложной логики
- [ ] Код отформатирован (Prettier)
- [ ] Нет линтер ошибок
- [ ] Тесты написаны (если нужно)
- [ ] Документация обновлена

---

**Следование этим принципам обеспечивает:**
- ✅ Читаемый и поддерживаемый код
- ✅ Легкое масштабирование
- ✅ Высокое качество
- ✅ Безопасность
- ✅ Производительность
