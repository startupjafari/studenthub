# Application Level Protocol

Данный документ описывает концепцию Application Level Protocol (протокол уровня приложения) и руководство по его внедрению в проект StudentHub Backend.

## Оглавление

1. [Введение](#введение)
2. [Что такое Application Level Protocol](#что-такое-application-level-protocol)
3. [Преимущества стандартизации](#преимущества-стандартизации)
4. [Структура протокола](#структура-протокола)
5. [Внедрение в NestJS](#внедрение-в-nestjs)
6. [Практическая реализация](#практическая-реализация)
7. [Миграция существующего кода](#миграция-существующего-кода)
8. [Примеры использования](#примеры-использования)
9. [Версионирование API](#версионирование-api)

---

## Введение

Application Level Protocol (ALP) - это стандартизированный формат обмена данными между клиентом и сервером на уровне приложения. Он определяет структуру всех запросов и ответов, форматы ошибок, метаданные и правила обработки различных сценариев.

В отличие от транспортного протокола (HTTP), ALP определяет семантику данных, передаваемых через приложение.

---

## Что такое Application Level Protocol

### Определение

Application Level Protocol - это соглашение о формате всех сообщений, передаваемых между клиентом и сервером. Он включает:

- **Стандартизированную структуру ответов** - единый формат для успешных ответов
- **Стандартизированные ошибки** - единый формат обработки и передачи ошибок
- **Метаданные** - информация о версии API, времени выполнения, пагинации и т.д.
- **Коды ошибок приложения** - детализированные коды для различных сценариев
- **Версионирование** - поддержка нескольких версий API одновременно

### Зачем это нужно?

Без Application Level Protocol:

```typescript
// Разные форматы ответов в разных контроллерах
// PostsController
return post;  // Просто объект

// UsersController  
return { user, message: 'Success' };  // Объект с сообщением

// AuthController
return { user, accessToken, refreshToken };  // Разный формат

// Ошибки
throw new BadRequestException('Error');  // Только сообщение
throw new NotFoundException('Not found');  // Разные форматы
```

С Application Level Protocol:

```typescript
// Единый формат для всех успешных ответов
{
  "success": true,
  "data": { ... },
  "meta": { ... },
  "timestamp": "2024-01-01T00:00:00.000Z"
}

// Единый формат для всех ошибок
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": { ... }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

## Преимущества стандартизации

### 1. Предсказуемость

Клиентские приложения знают точный формат всех ответов, что упрощает:

- Парсинг данных
- Обработку ошибок
- Типизацию (TypeScript)
- Создание клиентских SDK

### 2. Масштабируемость

Легко добавлять новую функциональность без нарушения совместимости:

- Новые поля в метаданных
- Расширение форматов ошибок
- Версионирование API

### 3. Улучшенная обработка ошибок

Детализированные коды ошибок позволяют клиентам:

- Показывать пользователю понятные сообщения
- Выполнять специфичные действия для разных типов ошибок
- Логировать ошибки с контекстом

### 4. Упрощение разработки

Разработчики знают, какой формат использовать, что снижает количество ошибок и ускоряет разработку.

### 5. Лучшая документация

Автоматическая генерация документации на основе стандартизированных форматов.

---

## Структура протокола

### Успешный ответ

```typescript
interface SuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    timestamp: string;
    version?: string;
    requestId?: string;
    [key: string]: any;
  };
}
```

### Ответ с ошибкой

```typescript
interface ErrorResponse {
  success: false;
  error: {
    code: string;           // Код ошибки приложения
    message: string;        // Понятное сообщение
    statusCode: number;     // HTTP статус код
    details?: any;          // Дополнительные детали
    timestamp: string;
  };
  meta?: {
    version?: string;
    requestId?: string;
  };
}
```

### Пагинированный ответ

```typescript
interface PaginatedResponse<T> {
  success: true;
  data: T[];
  meta: {
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
    timestamp: string;
    version?: string;
    requestId?: string;
  };
}
```

### Коды ошибок приложения

Коды ошибок должны быть понятными и специфичными:

```typescript
// Аутентификация
AUTH_INVALID_CREDENTIALS
AUTH_TOKEN_EXPIRED
AUTH_TOKEN_INVALID
AUTH_REQUIRED

// Валидация
VALIDATION_ERROR
VALIDATION_FIELD_REQUIRED
VALIDATION_FIELD_INVALID_FORMAT

// Ресурсы
RESOURCE_NOT_FOUND
RESOURCE_ALREADY_EXISTS
RESOURCE_ACCESS_DENIED

// Бизнес-логика
BUSINESS_RULE_VIOLATION
RATE_LIMIT_EXCEEDED
OPERATION_NOT_ALLOWED
```

---

## Внедрение в NestJS

### Архитектура решения

В NestJS Application Level Protocol внедряется через:

1. **Response Interceptor** - трансформирует все успешные ответы
2. **Exception Filter** - трансформирует все ошибки
3. **Базовые классы и интерфейсы** - для типизации
4. **Утилиты** - для создания стандартизированных ответов

### Структура файлов

```
src/
├── common/
│   ├── protocol/
│   │   ├── protocol.module.ts          # Модуль протокола
│   │   ├── interfaces/
│   │   │   ├── response.interface.ts   # Интерфейсы ответов
│   │   │   └── error.interface.ts      # Интерфейсы ошибок
│   │   ├── interceptors/
│   │   │   └── response.interceptor.ts # Interceptor для успешных ответов
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts # Filter для ошибок
│   │   ├── decorators/
│   │   │   └── api-response.decorator.ts # Декораторы для метаданных
│   │   ├── utils/
│   │   │   ├── response.util.ts        # Утилиты для создания ответов
│   │   │   └── error-codes.util.ts     # Коды ошибок
│   │   └── constants/
│   │       └── error-codes.constant.ts # Константы кодов ошибок
```

---

## Практическая реализация

### Шаг 1: Создание интерфейсов

#### `common/protocol/interfaces/response.interface.ts`

```typescript
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ApiMeta;
}

export interface ApiSuccessResponse<T> extends ApiResponse<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiErrorResponse extends ApiResponse {
  success: false;
  error: ApiError;
  meta?: ApiMeta;
}

export interface ApiMeta {
  timestamp: string;
  version?: string;
  requestId?: string;
  [key: string]: any;
}

export interface PaginatedData<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
```

#### `common/protocol/interfaces/error.interface.ts`

```typescript
export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
  details?: any;
  timestamp: string;
}
```

#### `common/protocol/constants/error-codes.constant.ts`

```typescript
export enum ErrorCode {
  // Authentication
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_INSUFFICIENT_PERMISSIONS = 'AUTH_INSUFFICIENT_PERMISSIONS',
  
  // Validation
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  VALIDATION_FIELD_REQUIRED = 'VALIDATION_FIELD_REQUIRED',
  VALIDATION_FIELD_INVALID = 'VALIDATION_FIELD_INVALID',
  
  // Resources
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',
  RESOURCE_ACCESS_DENIED = 'RESOURCE_ACCESS_DENIED',
  
  // Business Logic
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  OPERATION_NOT_ALLOWED = 'OPERATION_NOT_ALLOWED',
  
  // Server
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: 'Invalid credentials',
  [ErrorCode.AUTH_TOKEN_EXPIRED]: 'Token expired',
  [ErrorCode.AUTH_TOKEN_INVALID]: 'Invalid token',
  [ErrorCode.AUTH_REQUIRED]: 'Authentication required',
  [ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS]: 'Insufficient permissions',
  
  [ErrorCode.VALIDATION_ERROR]: 'Validation error',
  [ErrorCode.VALIDATION_FIELD_REQUIRED]: 'Field is required',
  [ErrorCode.VALIDATION_FIELD_INVALID]: 'Field is invalid',
  
  [ErrorCode.RESOURCE_NOT_FOUND]: 'Resource not found',
  [ErrorCode.RESOURCE_ALREADY_EXISTS]: 'Resource already exists',
  [ErrorCode.RESOURCE_ACCESS_DENIED]: 'Access denied',
  
  [ErrorCode.BUSINESS_RULE_VIOLATION]: 'Business rule violation',
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Rate limit exceeded',
  [ErrorCode.OPERATION_NOT_ALLOWED]: 'Operation not allowed',
  
  [ErrorCode.INTERNAL_SERVER_ERROR]: 'Internal server error',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'Service unavailable',
};
```

### Шаг 2: Создание утилит

#### `common/protocol/utils/response.util.ts`

```typescript
import { ApiSuccessResponse, ApiMeta } from '../interfaces/response.interface';

export class ResponseUtil {
  static success<T>(
    data: T,
    meta?: Partial<ApiMeta>,
  ): ApiSuccessResponse<T> {
    return {
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        ...meta,
      },
    };
  }

  static paginated<T>(
    items: T[],
    pagination: {
      page: number;
      limit: number;
      total: number;
    },
    meta?: Partial<ApiMeta>,
  ): ApiSuccessResponse<{
    items: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    return {
      success: true,
      data: {
        items,
        pagination: {
          ...pagination,
          totalPages: Math.ceil(pagination.total / pagination.limit),
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
        ...meta,
      },
    };
  }
}
```

### Шаг 3: Создание Response Interceptor

#### `common/protocol/interceptors/response.interceptor.ts`

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiSuccessResponse } from '../interfaces/response.interface';
import { ResponseUtil } from '../utils/response.util';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<T>> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiSuccessResponse<T>> {
    const request = context.switchToHttp().getRequest();
    const requestId = request.id || request.headers['x-request-id'];

    return next.handle().pipe(
      map((data) => {
        // Если ответ уже обернут в стандартный формат, возвращаем как есть
        if (data && typeof data === 'object' && 'success' in data) {
          return data;
        }

        // Обертываем данные в стандартный формат
        return ResponseUtil.success(data, {
          requestId,
          version: process.env.API_VERSION || '1.0',
        });
      }),
    );
  }
}
```

### Шаг 4: Создание Exception Filter

#### `common/protocol/filters/http-exception.filter.ts`

```typescript
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiErrorResponse } from '../interfaces/response.interface';
import { ApiError } from '../interfaces/error.interface';
import { ErrorCode, ERROR_MESSAGES } from '../constants/error-codes.constant';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.id || request.headers['x-request-id'];

    let statusCode: number;
    let errorCode: string;
    let message: string;
    let details: any;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        errorCode = this.getErrorCodeFromStatus(statusCode);
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as any;
        message = responseObj.message || exception.message;
        errorCode = responseObj.code || this.getErrorCodeFromStatus(statusCode);
        details = responseObj.details;
      } else {
        message = exception.message;
        errorCode = this.getErrorCodeFromStatus(statusCode);
      }
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      errorCode = ErrorCode.INTERNAL_SERVER_ERROR;
      message = ERROR_MESSAGES[ErrorCode.INTERNAL_SERVER_ERROR];
      
      this.logger.error(
        `Unexpected error: ${exception}`,
        (exception as Error).stack,
        `${request.method} ${request.url}`,
      );
    }

    const errorResponse: ApiErrorResponse = {
      success: false,
      error: {
        code: errorCode,
        message: this.getErrorMessage(errorCode, message),
        statusCode,
        details,
        timestamp: new Date().toISOString(),
      },
      meta: {
        requestId,
        version: process.env.API_VERSION || '1.0',
      },
    };

    response.status(statusCode).json(errorResponse);
  }

  private getErrorCodeFromStatus(statusCode: number): string {
    switch (statusCode) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.AUTH_REQUIRED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.RESOURCE_NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.RESOURCE_ALREADY_EXISTS;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMIT_EXCEEDED;
      case HttpStatus.INTERNAL_SERVER_ERROR:
        return ErrorCode.INTERNAL_SERVER_ERROR;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return ErrorCode.INTERNAL_SERVER_ERROR;
    }
  }

  private getErrorMessage(code: string, defaultMessage: string): string {
    return ERROR_MESSAGES[code as ErrorCode] || defaultMessage;
  }
}
```

### Шаг 5: Обновление кастомных исключений

#### `common/exceptions/auth.exceptions.ts`

```typescript
import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../protocol/constants/error-codes.constant';

export class InvalidCredentialsException extends HttpException {
  constructor(message = 'Неверный email или пароль') {
    super(
      {
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
        message,
        statusCode: HttpStatus.UNAUTHORIZED,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class EmailAlreadyExistsException extends HttpException {
  constructor(email: string) {
    super(
      {
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        message: `Email ${email} уже зарегистрирован`,
        statusCode: HttpStatus.CONFLICT,
        details: { email },
      },
      HttpStatus.CONFLICT,
    );
  }
}
```

### Шаг 6: Регистрация в приложении

#### `main.ts`

```typescript
import { ResponseInterceptor } from './common/protocol/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/protocol/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ... остальная конфигурация

  // Глобальный Response Interceptor
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Глобальный Exception Filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // ... остальной код
}
```

### Шаг 7: Обновление контроллеров (опционально)

Контроллеры можно оставить без изменений - interceptor автоматически обернет ответы. Однако, для явного контроля можно использовать утилиты:

```typescript
import { ResponseUtil } from '../../common/protocol/utils/response.util';

@Controller('posts')
export class PostsController {
  @Get()
  async findAll() {
    const posts = await this.postsService.findAll();
    // Interceptor автоматически обернет в стандартный формат
    return posts;
  }

  // Или явно, если нужны дополнительные метаданные
  @Get('with-meta')
  async findAllWithMeta() {
    const posts = await this.postsService.findAll();
    return ResponseUtil.success(posts, {
      customField: 'customValue',
    });
  }
}
```

---

## Миграция существующего кода

### Поэтапная миграция

1. **Этап 1: Создание инфраструктуры**
   - Создать интерфейсы и константы
   - Создать interceptor и filter
   - Зарегистрировать глобально

2. **Этап 2: Обновление исключений**
   - Обновить существующие исключения для использования кодов ошибок
   - Добавить детали в исключения

3. **Этап 3: Тестирование**
   - Протестировать все endpoints
   - Убедиться, что формат ответов корректный
   - Проверить обработку ошибок

4. **Этап 4: Обновление документации**
   - Обновить Swagger документацию
   - Обновить API документацию
   - Обновить клиентские SDK (если есть)

### Обратная совместимость

Для плавной миграции можно добавить параметр для включения/выключения протокола:

```typescript
// main.ts
if (process.env.ENABLE_APPLICATION_PROTOCOL === 'true') {
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
}
```

---

## Примеры использования

### Пример 1: Успешный ответ

**Запрос:**
```http
GET /api/posts/123
Authorization: Bearer <token>
```

**Ответ (без протокола):**
```json
{
  "id": "123",
  "content": "Hello world",
  "authorId": "user-123"
}
```

**Ответ (с протоколом):**
```json
{
  "success": true,
  "data": {
    "id": "123",
    "content": "Hello world",
    "authorId": "user-123"
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z",
    "version": "1.0",
    "requestId": "req-123"
  }
}
```

### Пример 2: Пагинированный ответ

**Запрос:**
```http
GET /api/posts?page=1&limit=20
```

**Ответ (с протоколом):**
```json
{
  "success": true,
  "data": {
    "items": [
      { "id": "1", "content": "Post 1" },
      { "id": "2", "content": "Post 2" }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    }
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z",
    "version": "1.0",
    "requestId": "req-456"
  }
}
```

### Пример 3: Ошибка валидации

**Запрос:**
```http
POST /api/posts
Content-Type: application/json
{
  "content": ""
}
```

**Ответ (без протокола):**
```json
{
  "statusCode": 400,
  "message": ["content should not be empty"],
  "error": "Bad Request"
}
```

**Ответ (с протоколом):**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation error",
    "statusCode": 400,
    "details": {
      "fields": {
        "content": ["content should not be empty"]
      }
    },
    "timestamp": "2024-01-01T00:00:00.000Z"
  },
  "meta": {
    "version": "1.0",
    "requestId": "req-789"
  }
}
```

### Пример 4: Кастомная ошибка

**Код:**
```typescript
throw new InvalidCredentialsException();
```

**Ответ:**
```json
{
  "success": false,
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Неверный email или пароль",
    "statusCode": 401,
    "timestamp": "2024-01-01T00:00:00.000Z"
  },
  "meta": {
    "version": "1.0",
    "requestId": "req-101"
  }
}
```

---

## Версионирование API

### Поддержка версий

Application Level Protocol облегчает версионирование API:

```typescript
// Запрос с версией
GET /api/v1/posts
X-API-Version: 1.0

// Ответ включает версию
{
  "success": true,
  "data": { ... },
  "meta": {
    "version": "1.0",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Версионирование через заголовки

```typescript
// Interceptor может читать версию из заголовка
const apiVersion = request.headers['x-api-version'] || '1.0';

return ResponseUtil.success(data, {
  version: apiVersion,
});
```

### Версионирование через URL

```typescript
// Контроллеры могут быть организованы по версиям
@Controller('v1/posts')
export class PostsV1Controller { }

@Controller('v2/posts')
export class PostsV2Controller { }
```

---

## Дополнительные возможности

### Request ID

Добавление уникального ID для каждого запроса упрощает отладку:

```typescript
// Middleware для генерации request ID
import { v4 as uuidv4 } from 'uuid';

app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});
```

### Логирование

Интеграция с системой логирования:

```typescript
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ResponseInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        this.logger.log(
          `${request.method} ${request.url} - ${duration}ms - ${request.id}`,
        );
      }),
      map((data) => ResponseUtil.success(data)),
    );
  }
}
```

### Метрики

Добавление метрик производительности:

```typescript
meta: {
  timestamp: new Date().toISOString(),
  version: '1.0',
  requestId: 'req-123',
  metrics: {
    duration: 45, // ms
    queryCount: 3,
  },
}
```

---

## Заключение

Application Level Protocol обеспечивает:

1. **Единообразие** - все ответы следуют одному формату
2. **Предсказуемость** - клиенты знают, чего ожидать
3. **Масштабируемость** - легко добавлять новую функциональность
4. **Отладку** - request ID и метаданные упрощают поиск проблем
5. **Документацию** - автоматическая генерация документации

### Рекомендации

- Начните с базовой реализации и постепенно добавляйте функции
- Документируйте все коды ошибок
- Используйте TypeScript для типизации
- Тестируйте изменения на всех клиентах
- Обновляйте документацию при изменениях протокола

### Следующие шаги

1. Создать базовую структуру протокола
2. Внедрить interceptor и filter
3. Обновить существующие исключения
4. Протестировать на всех endpoints
5. Обновить документацию и клиентские SDK

---

*Документ описывает концепцию Application Level Protocol и практические шаги по его внедрению в NestJS приложение.*
