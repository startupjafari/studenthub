# Архитектура проекта StudentHub

## 📐 Общая архитектура

StudentHub построен по принципу **клиент-серверной архитектуры** с разделением на Backend (API сервер) и Frontend (веб-приложение). Система спроектирована для масштабирования и поддержки 50,000+ активных пользователей.

```
┌─────────────────────────────────────────────────────────┐
│                      Пользователи                        │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              Frontend (Next.js)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Web App    │  │  Mobile Web  │  │   PWA App   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└───────────────────────┬─────────────────────────────────┘
                        │
                        │ HTTP/REST API
                        │ WebSocket
                        ▼
┌─────────────────────────────────────────────────────────┐
│         Load Balancer (Nginx)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ Backend  │  │ Backend  │  │ Backend  │            │
│  │Instance 1│  │Instance 2│  │Instance 3│            │
│  └──────────┘  └──────────┘  └──────────┘            │
└───────────────────────┬─────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  PostgreSQL  │ │    Redis     │ │   AWS S3     │
│   Master +   │ │   Cache &    │ │   Media      │
│   Replicas   │ │   Queue      │ │   Storage    │
└──────────────┘ └──────────────┘ └──────────────┘
```

---

## 🖥️ Backend архитектура

### Технологический стек

- **Framework:** NestJS 10
- **Language:** TypeScript
- **Database:** PostgreSQL 14+ (Prisma ORM)
- **Cache:** Redis 7+
- **Real-time:** Socket.io
- **Authentication:** JWT, Passport.js
- **Validation:** class-validator, class-transformer
- **Documentation:** Swagger/OpenAPI

### Архитектурные принципы

#### 1. Модульная архитектура

Backend построен на основе **модульной архитектуры NestJS**, где каждый модуль отвечает за определенную область функциональности:

```
studenthub-backend/
├── src/
│   ├── main.ts                    # Точка входа приложения
│   ├── app.module.ts              # Корневой модуль
│   ├── config/                     # Конфигурация
│   │   └── configuration.ts       # Настройки из .env
│   ├── common/                     # Общие компоненты
│   │   ├── decorators/            # Кастомные декораторы
│   │   ├── guards/                # Guards для авторизации
│   │   ├── filters/               # Exception filters
│   │   ├── interceptors/          # Response interceptors
│   │   ├── services/              # Общие сервисы (Prisma, Email)
│   │   └── protocol/              # Application Level Protocol
│   └── modules/                    # Бизнес-модули
│       ├── auth/                   # Аутентификация
│       ├── users/                  # Пользователи
│       ├── posts/                  # Посты
│       ├── comments/               # Комментарии
│       ├── messages/               # Сообщения
│       ├── groups/                 # Группы
│       └── ...
├── prisma/
│   └── schema.prisma              # Схема базы данных
└── docker-compose.yml             # Docker конфигурация
```

#### 2. Структура модуля

Каждый модуль следует единой структуре:

```
modules/posts/
├── posts.module.ts                # Модуль (регистрация)
├── posts.controller.ts            # Контроллер (HTTP endpoints)
├── posts.service.ts               # Сервис (бизнес-логика)
├── dto/                           # Data Transfer Objects
│   ├── create-post.dto.ts
│   └── update-post.dto.ts
├── entities/                      # Сущности (опционально)
└── posts.gateway.ts               # WebSocket gateway (если нужно)
```

#### 3. Слои архитектуры

```
┌─────────────────────────────────┐
│      Controller Layer            │  HTTP запросы, валидация
├─────────────────────────────────┤
│      Service Layer               │  Бизнес-логика
├─────────────────────────────────┤
│      Repository Layer            │  Prisma Service (доступ к БД)
├─────────────────────────────────┤
│      Database Layer              │  PostgreSQL
└─────────────────────────────────┘
```

#### 4. Принципы проектирования

- **Separation of Concerns (SoC)** - разделение ответственности
- **Dependency Injection** - внедрение зависимостей через конструкторы
- **Single Responsibility** - каждый класс отвечает за одну задачу
- **DRY (Don't Repeat Yourself)** - переиспользование кода
- **SOLID принципы** - следование принципам объектно-ориентированного программирования

### База данных

#### Архитектура БД

- **Основная БД:** PostgreSQL (Master)
- **Реплики:** 3+ реплики для чтения
- **Connection Pooling:** PgBouncer
- **ORM:** Prisma (типобезопасный доступ)

#### Модели данных

Основные сущности:
- **User** - пользователи
- **Post** - посты
- **Comment** - комментарии
- **Message** - сообщения
- **Group** - группы
- **Event** - события
- **Document** - документы

Подробнее: [DATABASE.md](DATABASE.md)

### Real-time коммуникация

#### WebSocket архитектура

```
Client                    Backend Gateway
  │                            │
  ├── connect ────────────────>│
  │                            │
  ├── subscribe ───────────────>│
  │                            │
  │<── notification ──────────┤
  │                            │
  ├── send_message ──────────>│
  │                            │
  │<── message_received ──────┤
```

**Gateways:**
- `MessagesGateway` - real-time сообщения
- `NotificationsGateway` - real-time уведомления
- `PresenceGateway` - статус онлайн/офлайн
- `GroupsGateway` - групповые события

### Кэширование

#### Многоуровневое кэширование

1. **Redis Cache** - кэширование запросов к БД
2. **In-Memory Cache** - кэширование в памяти приложения
3. **CDN** - кэширование статических файлов

---

## 🎨 Frontend архитектура

### Технологический стек

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **State Management:** Redux Toolkit + RTK Query
- **Styling:** Tailwind CSS
- **Forms:** React Hook Form + Zod
- **HTTP Client:** Axios
- **Real-time:** Socket.io Client
- **UI Components:** Headless UI

### Архитектурные принципы

#### 1. Feature-based модульная архитектура

Frontend организован по принципу **feature-based структуры**, где каждый feature содержит все необходимые компоненты:

```
studenthub-frontend/
├── app/                          # Next.js App Router
│   ├── layout.tsx               # Корневой layout
│   ├── page.tsx                  # Главная страница
│   ├── auth/                    # Страницы аутентификации
│   │   ├── login/
│   │   └── register/
│   ├── profile/
│   └── ...
├── core/                         # Ядро приложения
│   ├── api/                     # API клиент и типы
│   │   ├── client.ts           # Axios instance
│   │   └── types.ts            # TypeScript типы
│   ├── store/                   # Redux store
│   │   ├── store.ts            # Конфигурация store
│   │   ├── api/                # RTK Query API slice
│   │   └── slices/             # Redux slices
│   └── websocket/              # WebSocket клиент
│       └── socketClient.ts
├── features/                     # Feature-based модули
│   ├── auth/                   # Модуль аутентификации
│   │   ├── api/               # API endpoints
│   │   ├── components/         # Компоненты
│   │   └── hooks/             # Custom hooks
│   ├── posts/                  # Модуль постов
│   ├── messages/               # Модуль сообщений
│   └── ...
├── shared/                       # Общие компоненты
│   ├── components/             # Переиспользуемые компоненты
│   ├── hooks/                 # Общие hooks
│   └── utils/                 # Утилиты
└── lib/                         # Библиотеки и утилиты
    └── utils.ts
```

#### 2. State Management

**Redux Toolkit + RTK Query** для управления состоянием:

```
┌─────────────────────────────────┐
│      UI Components               │
├─────────────────────────────────┤
│      Redux Store                 │
│  ┌────────────┐  ┌────────────┐ │
│  │   Slices   │  │ RTK Query  │ │
│  │  (Local)   │  │  (Server)  │ │
│  └────────────┘  └────────────┘ │
├─────────────────────────────────┤
│      API Client (Axios)         │
├─────────────────────────────────┤
│      Backend API                │
└─────────────────────────────────┘
```

**Преимущества:**
- Автоматическое кэширование запросов
- Дедупликация запросов
- Оптимистичные обновления
- Автоматическое обновление токенов

#### 3. Компонентная архитектура

**Принципы:**
- **Композиция** - компоненты состоят из меньших компонентов
- **Переиспользование** - общие компоненты в `shared/`
- **Изоляция** - каждый feature изолирован
- **Типобезопасность** - TypeScript для всех компонентов

#### 4. Роутинг

**Next.js App Router:**
- File-based routing
- Server Components по умолчанию
- Client Components где нужно интерактивность
- Layouts для общих элементов

#### 5. Оптимизация производительности

**Стратегии:**
- **Code Splitting** - разделение кода по routes
- **Lazy Loading** - загрузка компонентов по требованию
- **Memoization** - кэширование компонентов (React.memo)
- **Virtual Scrolling** - для больших списков
- **Image Optimization** - оптимизация изображений Next.js
- **Bundle Optimization** - минификация и tree shaking

---

## 🔄 Взаимодействие Backend и Frontend

### REST API

```
Frontend                    Backend
   │                           │
   ├── GET /api/posts ────────>│
   │<── 200 OK {data: [...]} ──┤
   │                           │
   ├── POST /api/posts ───────>│
   │     {content: "..."}       │
   │<── 201 Created {data} ────┤
```

### WebSocket

```
Frontend                    Backend
   │                           │
   ├── connect ───────────────>│
   │<── connected ─────────────┤
   │                           │
   ├── subscribe:notifications>│
   │                           │
   │<── notification ──────────┤
   │     {type: "NEW_MESSAGE"} │
```

### Аутентификация

```
1. Frontend отправляет credentials
   POST /api/auth/login
   
2. Backend возвращает токены
   {accessToken, refreshToken}
   
3. Frontend сохраняет токены
   localStorage.setItem('accessToken', ...)
   
4. Frontend добавляет токен в заголовки
   Authorization: Bearer <token>
   
5. Backend валидирует токен
   JWT Guard проверяет токен
   
6. При истечении токена
   Frontend автоматически обновляет через /api/auth/refresh
```

---

## 📊 Масштабирование архитектуры

### Горизонтальное масштабирование

```
                    [CDN]
                      │
              [Load Balancer]
         (Nginx / HAProxy / AWS ALB)
                      │
        ┌─────────────┼─────────────┐
        │             │             │
   [Backend 1]   [Backend 2]   [Backend 3]
        │             │             │
        └─────────────┼─────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
   [PostgreSQL]  [PostgreSQL]  [PostgreSQL]
     Master      Replica 1    Replica 2
```

### Вертикальное масштабирование

- Увеличение ресурсов серверов (CPU, RAM)
- Оптимизация запросов к БД
- Кэширование на всех уровнях

Подробнее: [SCALABILITY.md](SCALABILITY.md)

---

## 🔐 Безопасность архитектуры

### Многоуровневая защита

1. **Network Level:**
   - Firewall
   - DDoS защита
   - Rate limiting

2. **Application Level:**
   - JWT аутентификация
   - Role-based авторизация
   - Валидация входных данных
   - SQL injection защита (Prisma)

3. **Data Level:**
   - Хеширование паролей (bcrypt)
   - Шифрование чувствительных данных
   - Регулярные бэкапы

---

## 📚 Дополнительные ресурсы

- [BACKEND.md](BACKEND.md) - Подробная документация Backend
- [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) - Детальная архитектура Frontend
- [SCALABILITY.md](SCALABILITY.md) - Масштабирование системы
- [DATABASE.md](DATABASE.md) - Архитектура базы данных

---

**Архитектура спроектирована для:**
- ✅ Масштабируемости
- ✅ Поддерживаемости
- ✅ Производительности
- ✅ Безопасности
- ✅ Гибкости
