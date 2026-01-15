# Тестирование API через Postman

## 🔗 Базовый URL

```
http://localhost:8080/api
```

**Примечание**: Все запросы идут через Nginx Load Balancer на порту `8080`, который распределяет нагрузку между тремя инстансами приложения (app1, app2, app3).

---

## 📋 Быстрый старт

### 1. Настройка Postman Environment

Создайте новый Environment в Postman со следующими переменными:

| Variable | Initial Value | Current Value |
|----------|---------------|---------------|
| `base_url` | `http://localhost:8080` | `http://localhost:8080` |
| `api_url` | `http://localhost:8080/api` | `http://localhost:8080/api` |
| `access_token` | (оставить пустым) | (будет заполнено после авторизации) |
| `refresh_token` | (оставить пустым) | (будет заполнено после авторизации) |

### 2. Настройка Collection

Создайте новую Collection и добавьте Pre-request Script:

```javascript
// Автоматически добавляем access_token в заголовки, если он есть
if (pm.environment.get("access_token")) {
    pm.request.headers.add({
        key: "Authorization",
        value: "Bearer " + pm.environment.get("access_token")
    });
}
```

---

## ✅ Тестовые запросы

### 1. Health Check (без авторизации)

**GET** `{{api_url}}/health`

**Headers**: Не требуются

**Пример ответа**:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-01-15T08:00:00.000Z"
  },
  "meta": {
    "timestamp": "2026-01-15T08:00:00.000Z",
    "requestId": "uuid-here",
    "version": "1.0"
  }
}
```

---

### 2. Информация об API (корневой путь)

**GET** `http://localhost:8080/`

**Headers**: Не требуются

**Пример ответа**:
```json
{
  "message": "StudentHub API",
  "version": "1.0",
  "endpoints": {
    "health": "/api/health",
    "api": "/api/"
  }
}
```

---

### 3. Регистрация пользователя

**POST** `{{api_url}}/auth/register`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "email": "test@example.com",
  "password": "SecurePassword123!",
  "firstName": "Иван",
  "lastName": "Иванов",
  "username": "ivan_ivanov"
}
```

**Пример ответа**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "email": "test@example.com",
      "firstName": "Иван",
      "lastName": "Иванов"
    },
    "message": "Registration successful. Please verify your email."
  }
}
```

---

### 4. Вход в систему (Login)

**POST** `{{api_url}}/auth/login`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "email": "test@example.com",
  "password": "SecurePassword123!"
}
```

**Пример ответа** (без 2FA):
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "email": "test@example.com",
      "firstName": "Иван"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Postman Test Script** (для автоматического сохранения токенов):
```javascript
if (pm.response.code === 200) {
    const jsonData = pm.response.json();
    if (jsonData.data && jsonData.data.accessToken) {
        pm.environment.set("access_token", jsonData.data.accessToken);
        pm.environment.set("refresh_token", jsonData.data.refreshToken);
        console.log("Tokens saved to environment");
    }
}
```

---

### 5. Обновление токена (Refresh Token)

**POST** `{{api_url}}/auth/refresh`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "refreshToken": "{{refresh_token}}"
}
```

**Postman Test Script**:
```javascript
if (pm.response.code === 200) {
    const jsonData = pm.response.json();
    if (jsonData.data && jsonData.data.accessToken) {
        pm.environment.set("access_token", jsonData.data.accessToken);
        console.log("Access token refreshed");
    }
}
```

---

### 6. Получение профиля пользователя (требует авторизации)

**GET** `{{api_url}}/users/me`

**Headers**:
```
Authorization: Bearer {{access_token}}
```

**Пример ответа**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "test@example.com",
    "firstName": "Иван",
    "lastName": "Иванов",
    "username": "ivan_ivanov",
    "emailVerified": true
  }
}
```

---

### 7. Выход из системы (Logout)

**POST** `{{api_url}}/auth/logout`

**Headers**:
```
Authorization: Bearer {{access_token}}
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "refreshToken": "{{refresh_token}}"
}
```

**Postman Test Script**:
```javascript
if (pm.response.code === 200) {
    pm.environment.set("access_token", "");
    pm.environment.set("refresh_token", "");
    console.log("Logged out - tokens cleared");
}
```

---

## 🔐 Двухфакторная аутентификация (2FA)

### Включение 2FA

**POST** `{{api_url}}/auth/2fa/enable`

**Headers**:
```
Authorization: Bearer {{access_token}}
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "password": "SecurePassword123!"
}
```

**Пример ответа**:
```json
{
  "success": true,
  "data": {
    "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "secret": "JBSWY3DPEHPK3PXP"
  }
}
```

### Вход с 2FA

1. Сначала выполните обычный login - получите `temporaryToken`
2. Затем отправьте запрос:

**POST** `{{api_url}}/auth/2fa/verify`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "temporaryToken": "temporary-token-from-login",
  "code": "123456"
}
```

---

## 📝 Дополнительные endpoints

### Университеты

**GET** `{{api_url}}/universities` - Список университетов

**GET** `{{api_url}}/universities/:id` - Детали университета

### Посты

**GET** `{{api_url}}/posts` - Список постов

**POST** `{{api_url}}/posts` - Создать пост
```json
{
  "content": "Текст поста",
  "mediaIds": [1, 2]
}
```

**GET** `{{api_url}}/posts/:id` - Детали поста

**PUT** `{{api_url}}/posts/:id` - Обновить пост

**DELETE** `{{api_url}}/posts/:id` - Удалить пост

### Комментарии

**GET** `{{api_url}}/posts/:postId/comments` - Комментарии к посту

**POST** `{{api_url}}/posts/:postId/comments` - Добавить комментарий
```json
{
  "content": "Текст комментария"
}
```

### Друзья

**GET** `{{api_url}}/friends` - Список друзей

**POST** `{{api_url}}/friends/request/:userId` - Отправить запрос в друзья

**POST** `{{api_url}}/friends/accept/:requestId` - Принять запрос

**DELETE** `{{api_url}}/friends/:friendId` - Удалить из друзей

---

## 🧪 Тестирование Load Balancer

### Проверка распределения нагрузки

Создайте несколько запросов подряд и проверьте заголовки ответа:

**GET** `{{api_url}}/health`

В ответе проверьте заголовок `X-Instance-ID` (если он добавлен в приложении) или логи, чтобы увидеть, какой инстанс обработал запрос.

### Тестирование WebSocket

WebSocket доступен через:
```
ws://localhost:8080/socket.io/
```

В Postman можно использовать WebSocket запросы для тестирования real-time функциональности.

---

## 📊 Swagger документация

Если Swagger включен, доступен по адресу:

```
http://localhost:8080/api/docs
```

Или:

```
http://localhost:8080/swagger
```

---

## ⚠️ Важные замечания

### Rate Limiting

API использует rate limiting:
- **Короткий период**: 100 запросов в минуту
- **Средний период**: 200 запросов в 10 минут
- **Длинный период**: 500 запросов в 15 минут

При превышении лимита вы получите ответ `429 Too Many Requests`.

### CORS

В development режиме разрешены запросы с `localhost` на любом порту. В production нужно настроить `FRONTEND_URL` в переменных окружения.

### CSRF Protection

Некоторые запросы могут требовать CSRF токен. Проверьте заголовки ответа на наличие `X-CSRF-Token`.

### Валидация

Все входные данные валидируются. При ошибке валидации вы получите ответ `400 Bad Request` с деталями ошибок.

---

## 🔧 Troubleshooting

### Проблема: Connection refused

**Решение**: Убедитесь, что Docker контейнеры запущены:
```powershell
docker compose -f docker-compose.loadbalancer.yml ps
```

### Проблема: 502 Bad Gateway

**Решение**: Проверьте статус app инстансов:
```powershell
docker compose -f docker-compose.loadbalancer.yml logs app1
```

### Проблема: 401 Unauthorized

**Решение**: 
1. Проверьте, что токен не истек
2. Обновите токен через `/auth/refresh`
3. Выполните повторный login

### Проблема: 403 Forbidden

**Решение**: 
1. Проверьте, что email верифицирован
2. Проверьте права доступа (roles)
3. Убедитесь, что используете правильный токен

---

## 📦 Импорт Collection в Postman

Создайте файл `StudentHub_API.postman_collection.json` и импортируйте его в Postman для быстрого доступа ко всем endpoints.

### Пример структуры Collection:

```json
{
  "info": {
    "name": "StudentHub API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Health",
      "request": {
        "method": "GET",
        "header": [],
        "url": {
          "raw": "{{api_url}}/health",
          "host": ["{{api_url}}"],
          "path": ["health"]
        }
      }
    },
    {
      "name": "Auth",
      "item": [
        {
          "name": "Register",
          "request": {
            "method": "POST",
            "header": [
              {
                "key": "Content-Type",
                "value": "application/json"
              }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"email\": \"test@example.com\",\n  \"password\": \"SecurePassword123!\",\n  \"firstName\": \"Иван\",\n  \"lastName\": \"Иванов\"\n}"
            },
            "url": {
              "raw": "{{api_url}}/auth/register",
              "host": ["{{api_url}}"],
              "path": ["auth", "register"]
            }
          }
        }
      ]
    }
  ]
}
```

---

## 🚀 Быстрые команды для проверки

### Проверка через curl (PowerShell):

```powershell
# Health check
Invoke-WebRequest -Uri http://localhost:8080/api/health -UseBasicParsing

# С токеном
$token = "your-access-token"
Invoke-WebRequest -Uri http://localhost:8080/api/users/me -Headers @{Authorization="Bearer $token"} -UseBasicParsing
```

### Проверка через curl (Bash):

```bash
# Health check
curl http://localhost:8080/api/health

# С токеном
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8080/api/users/me
```

---

## 📝 Примеры тестовых сценариев

### Сценарий 1: Полный цикл регистрации и авторизации

1. ✅ Регистрация нового пользователя
2. ✅ Верификация email (если требуется)
3. ✅ Вход в систему
4. ✅ Получение профиля
5. ✅ Обновление токена
6. ✅ Выход из системы

### Сценарий 2: Работа с постами

1. ✅ Создание поста
2. ✅ Получение списка постов
3. ✅ Получение деталей поста
4. ✅ Добавление комментария
5. ✅ Обновление поста
6. ✅ Удаление поста

### Сценарий 3: Социальные функции

1. ✅ Поиск пользователей
2. ✅ Отправка запроса в друзья
3. ✅ Принятие запроса
4. ✅ Получение списка друзей
5. ✅ Удаление из друзей

---

**Готово! Теперь вы можете тестировать API через Postman.** 🎉
