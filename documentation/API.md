# API Документация

## Базовый URL

```
http://localhost:3000/api
```

## Аутентификация

Большинство endpoints требуют JWT токен в заголовке Authorization:

```
Authorization: Bearer <access_token>
```

Токен получается через `/api/auth/login` или `/api/auth/register`.

## Общие принципы

### Формат ответа

Успешный ответ:
```json
{
  "data": {...},
  "message": "Success message"
}
```

Ошибка:
```json
{
  "statusCode": 400,
  "message": "Error message",
  "error": "Bad Request"
}
```

### Пагинация

Endpoints с пагинацией возвращают:
```json
{
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10
  }
}
```

Параметры запроса:
- `page` - номер страницы (по умолчанию 1)
- `limit` - количество элементов на странице (по умолчанию 10)

## Endpoints

### Health Check

**GET /api/health**

Проверка работоспособности сервера.

Ответ:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Аутентификация

#### Регистрация

**POST /api/auth/register**

Тело запроса:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe"
}
```

Ответ:
```json
{
  "message": "Registration successful. Please verify your email."
}
```

#### Вход

**POST /api/auth/login**

Тело запроса:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Ответ:
```json
{
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe"
  },
  "accessToken": "jwt_access_token",
  "refreshToken": "jwt_refresh_token"
}
```

#### Обновление токена

**POST /api/auth/refresh**

Тело запроса:
```json
{
  "refreshToken": "jwt_refresh_token"
}
```

Ответ:
```json
{
  "accessToken": "new_jwt_access_token",
  "refreshToken": "new_jwt_refresh_token"
}
```

#### Верификация email

**POST /api/auth/verify-email**

Тело запроса:
```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

#### Повторная отправка кода верификации

**POST /api/auth/resend-verification**

Тело запроса:
```json
{
  "email": "user@example.com"
}
```

#### Включение 2FA

**POST /api/auth/enable-2fa**

Требует авторизации.

Ответ:
```json
{
  "secret": "2FA_SECRET",
  "qrCode": "data:image/png;base64,..."
}
```

#### Проверка 2FA

**POST /api/auth/verify-2fa**

Тело запроса:
```json
{
  "code": "123456"
}
```

### Пользователи

#### Получить текущего пользователя

**GET /api/users/me**

Требует авторизации.

Ответ:
```json
{
  "id": "user_id",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "avatar": "https://...",
  "role": "STUDENT",
  "emailVerified": true
}
```

#### Получить пользователя по ID

**GET /api/users/:id**

Требует авторизации.

#### Поиск пользователей

**GET /api/users/search?q=john&role=STUDENT&page=1&limit=10**

Требует авторизации.

Параметры:
- `q` - поисковый запрос
- `role` - фильтр по роли (STUDENT, TEACHER, etc.)
- `page` - номер страницы
- `limit` - количество результатов

#### Обновить профиль

**PATCH /api/users/me**

Требует авторизации.

Тело запроса:
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "bio": "My bio",
  "birthDate": "2000-01-01"
}
```

#### Загрузить аватар

**POST /api/users/me/avatar**

Требует авторизации.

Content-Type: multipart/form-data
- `file` - файл изображения

### Посты

#### Получить список постов

**GET /api/posts?page=1&limit=10**

Требует авторизации.

Параметры:
- `page` - номер страницы
- `limit` - количество постов

#### Получить пост по ID

**GET /api/posts/:id**

Требует авторизации.

#### Создать пост

**POST /api/posts**

Требует авторизации.

Тело запроса:
```json
{
  "content": "Post content",
  "media": ["url1", "url2"]
}
```

#### Обновить пост

**PATCH /api/posts/:id**

Требует авторизации. Только владелец поста.

#### Удалить пост

**DELETE /api/posts/:id**

Требует авторизации. Только владелец поста.

### Комментарии

#### Получить комментарии поста

**GET /api/comments/post/:postId?page=1&limit=10**

Требует авторизации.

#### Создать комментарий

**POST /api/comments**

Требует авторизации.

Тело запроса:
```json
{
  "postId": "post_id",
  "content": "Comment text"
}
```

#### Обновить комментарий

**PATCH /api/comments/:id**

Требует авторизации. Только владелец.

#### Удалить комментарий

**DELETE /api/comments/:id**

Требует авторизации. Только владелец.

### Реакции

#### Добавить реакцию

**POST /api/reactions**

Требует авторизации.

Тело запроса:
```json
{
  "targetType": "POST",
  "targetId": "post_id",
  "type": "LIKE"
}
```

Типы реакций: LIKE, LOVE, HAHA, WOW, SAD, ANGRY

#### Удалить реакцию

**DELETE /api/reactions/:id**

Требует авторизации. Только владелец.

### Сообщения

#### Получить список бесед

**GET /api/messages/conversations**

Требует авторизации.

#### Получить беседу

**GET /api/messages/conversations/:id**

Требует авторизации.

#### Получить сообщения беседы

**GET /api/messages/conversations/:id/messages?page=1&limit=20**

Требует авторизации.

#### Отправить сообщение

**POST /api/messages**

Требует авторизации.

Тело запроса:
```json
{
  "conversationId": "conversation_id",
  "content": "Message text",
  "media": ["url1"]
}
```

### Группы

#### Получить список групп

**GET /api/groups?page=1&limit=10**

Требует авторизации.

#### Получить группу

**GET /api/groups/:id**

Требует авторизации.

#### Создать группу

**POST /api/groups**

Требует авторизации. Только TEACHER или UNIVERSITY_ADMIN.

Тело запроса:
```json
{
  "name": "Group name",
  "description": "Group description",
  "universityId": "university_id"
}
```

#### Обновить группу

**PATCH /api/groups/:id**

Требует авторизации. Только создатель или администратор группы.

#### Удалить группу

**DELETE /api/groups/:id**

Требует авторизации. Только создатель.

#### Добавить участника

**POST /api/groups/:id/members**

Требует авторизации. Только администратор группы.

Тело запроса:
```json
{
  "userId": "user_id"
}
```

#### Удалить участника

**DELETE /api/groups/:id/members/:userId**

Требует авторизации. Только администратор группы.

### Уведомления

#### Получить уведомления

**GET /api/notifications?page=1&limit=20&unreadOnly=true**

Требует авторизации.

#### Отметить как прочитанное

**PATCH /api/notifications/:id/read**

Требует авторизации.

#### Отметить все как прочитанные

**PATCH /api/notifications/read-all**

Требует авторизации.

## Коды ошибок

- 200 - Успех
- 201 - Создано
- 400 - Неверный запрос
- 401 - Не авторизован
- 403 - Доступ запрещен
- 404 - Не найдено
- 409 - Конфликт (например, email уже существует)
- 429 - Слишком много запросов
- 500 - Внутренняя ошибка сервера

## WebSocket API

### Подключение

```javascript
const socket = io('http://localhost:3000', {
  auth: {
    token: 'your_jwt_token'
  }
});
```

### Namespaces

#### /messages

События:
- `message:new` - Новое сообщение
- `message:read` - Сообщение прочитано

#### /groups

События:
- `group:message:new` - Новое групповое сообщение

#### /notifications

События:
- `notification:new` - Новое уведомление

## Swagger документация

Интерактивная документация доступна по адресу:
```
http://localhost:3000/api/docs
```



