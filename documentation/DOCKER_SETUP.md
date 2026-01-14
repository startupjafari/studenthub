# Как запустить Docker Compose

## Предварительные требования

Убедитесь, что у вас установлен Docker Desktop для Windows:
- Скачайте с https://www.docker.com/products/docker-desktop
- Установите и запустите Docker Desktop
- Дождитесь, пока Docker Desktop полностью запустится (иконка в трее должна быть зеленой)

## Быстрый запуск

### 1. Перейдите в папку backend

```powershell
cd studenthub-backend
```

### 2. Запустите Docker Compose

**Базовый запуск (только PostgreSQL и Redis):**
```powershell
docker compose up -d
```

**С инструментами для разработки (PgAdmin и Redis Commander):**
```powershell
docker compose --profile tools up -d
```

Флаг `-d` запускает контейнеры в фоновом режиме (detached mode).

## Проверка статуса

Проверить, что контейнеры запущены:
```powershell
docker compose ps
```

Должны быть запущены:
- studenthub_postgres (PostgreSQL)
- studenthub_redis (Redis)
- studenthub_pgadmin (если использовали --profile tools)
- studenthub_redis_commander (если использовали --profile tools)

## Просмотр логов

Посмотреть логи всех сервисов:
```powershell
docker compose logs -f
```

Логи конкретного сервиса:
```powershell
docker compose logs -f postgres
docker compose logs -f redis
```

## Остановка

Остановить все контейнеры:
```powershell
docker compose down
```

Остановить и удалить все данные (volumes):
```powershell
docker compose down -v
```

Внимание: команда `-v` удалит все данные из базы данных!

## Перезапуск

Перезапустить все сервисы:
```powershell
docker compose restart
```

Перезапустить конкретный сервис:
```powershell
docker compose restart postgres
```

## Доступ к сервисам

После запуска сервисы доступны по следующим адресам:

- **PostgreSQL**: `localhost:5432`
  - Пользователь: `postgres`
  - Пароль: `postgres` (по умолчанию)
  - База данных: `studenthub`

- **Redis**: `localhost:6379`
  - Пароль: не установлен по умолчанию

- **PgAdmin** (если запущен с --profile tools): `http://localhost:5050`
  - Email: `admin@studenthub.com`
  - Пароль: `admin`

- **Redis Commander** (если запущен с --profile tools): `http://localhost:8081`
  - Пользователь: `admin`
  - Пароль: `admin`

## Настройка переменных окружения

Если нужно изменить настройки (пароли, порты), создайте файл `.env` в папке `studenthub-backend`:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password
POSTGRES_DB=studenthub
POSTGRES_PORT=5432

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

PGADMIN_EMAIL=admin@studenthub.com
PGADMIN_PASSWORD=admin
PGADMIN_PORT=5050

REDIS_COMMANDER_USER=admin
REDIS_COMMANDER_PASSWORD=admin
REDIS_COMMANDER_PORT=8081
```

## Подключение к базе данных из приложения

В файле `.env` вашего backend приложения используйте:

**Для подключения из приложения (внутри Docker сети):**
```
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/studenthub?schema=public
REDIS_HOST=redis
REDIS_PORT=6379
```

**Для подключения с локальной машины:**
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/studenthub?schema=public
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Выполнение миграций

После запуска Docker Compose выполните миграции базы данных:

```powershell
cd studenthub-backend
npm run db:generate
npm run db:migrate
```

## Решение проблем

### Порт уже занят

Если получаете ошибку "port is already allocated":

1. Найдите процесс, использующий порт:
```powershell
netstat -ano | findstr :5432
```

2. Остановите процесс или измените порт в `.env`:
```env
POSTGRES_PORT=5433
```

### Контейнеры не запускаются

1. Проверьте логи:
```powershell
docker compose logs
```

2. Проверьте, что Docker Desktop запущен

3. Проверьте доступное место на диске

### Очистка

Удалить все контейнеры, volumes и сети:
```powershell
docker compose down -v --remove-orphans
```

## Полезные команды

```powershell
# Просмотр использования ресурсов
docker stats

# Просмотр всех контейнеров (включая остановленные)
docker compose ps -a

# Пересоздать контейнеры
docker compose up -d --force-recreate

# Просмотр информации о volume
docker volume ls
docker volume inspect studenthub-backend_postgres_data
```





