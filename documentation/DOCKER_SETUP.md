# Как запустить Docker Compose

## Предварительные требования

Убедитесь, что у вас установлен Docker Desktop для Windows:
- Скачайте с https://www.docker.com/products/docker-desktop
- Установите и запустите Docker Desktop
- Дождитесь, пока Docker Desktop полностью запустится (иконка в трее должна быть зеленой)

## Выбор конфигурации Docker Compose

В проекте есть два файла Docker Compose для разных сценариев:

### `docker-compose.yml` - Для разработки
**Назначение**: Локальная разработка и базовое тестирование

**Включает**:
- ✅ PostgreSQL (один инстанс, без репликации)
- ✅ Redis (базовая конфигурация, 512MB)
- ✅ PgAdmin (опционально, через `--profile tools`)
- ✅ Redis Commander (опционально, через `--profile tools`)

**Не включает**:
- ❌ Backend приложение (запускается отдельно через `npm run start:dev`)
- ❌ Load Balancer
- ❌ Реплики PostgreSQL
- ❌ PgBouncer

**Когда использовать**:
- Ежедневная разработка
- Локальное тестирование
- Нужны только БД и Redis
- Запуск приложения отдельно

---

### `docker-compose.loadbalancer.yml` - Для production-подобного тестирования
**Назначение**: Тестирование масштабирования, load balancing и production-конфигурации

**Включает**:
- ✅ PostgreSQL Master + 3 реплики (репликация)
- ✅ Redis (8GB памяти, оптимизирован)
- ✅ 3 инстанса backend приложения (app1, app2, app3)
- ✅ Nginx Load Balancer
- ✅ PgBouncer (connection pooling)
- ✅ Оптимизированные настройки для production

**Когда использовать**:
- Тестирование масштабирования
- Проверка работы Load Balancer
- Тестирование репликации PostgreSQL
- Симуляция production-окружения
- Нагрузочное тестирование

---

## Сценарии использования

### Сценарий 1: Локальная разработка (docker-compose.yml)

#### 1. Перейдите в папку backend

```powershell
cd studenthub-backend
```

#### 2. Запустите только БД и Redis

```powershell
# Базовый запуск (только PostgreSQL и Redis)
docker compose up -d

# Или с инструментами для разработки (PgAdmin и Redis Commander)
docker compose --profile tools up -d
```

#### 3. Запустите приложение отдельно

```powershell
# В другом терминале
npm run start:dev
```

#### 4. Проверка статуса

```powershell
docker compose ps
```

**Ожидаемый результат**:
- `studenthub_postgres` - PostgreSQL
- `studenthub_redis` - Redis
- `studenthub_pgadmin` - PgAdmin (если использовали `--profile tools`)
- `studenthub_redis_commander` - Redis Commander (если использовали `--profile tools`)

---

### Сценарий 2: Тестирование Load Balancer (docker-compose.loadbalancer.yml)

#### 1. Перейдите в папку backend

```powershell
cd studenthub-backend
```

#### 2. Запустите полную конфигурацию с Load Balancer

```powershell
# Запуск всех сервисов (Master, Replicas, App инстансы, Nginx, PgBouncer)
docker compose -f docker-compose.loadbalancer.yml up -d
```

#### 3. Проверка статуса всех сервисов

```powershell
docker compose -f docker-compose.loadbalancer.yml ps
```

**Ожидаемый результат**:
- `studenthub_postgres_master_lb` - PostgreSQL Master
- `studenthub_postgres_replica_1_lb` - PostgreSQL Replica 1
- `studenthub_postgres_replica_2_lb` - PostgreSQL Replica 2
- `studenthub_postgres_replica_3_lb` - PostgreSQL Replica 3
- `studenthub_redis_lb` - Redis
- `studenthub_pgbouncer_lb` - PgBouncer
- `studenthub_app1` - Application Instance 1
- `studenthub_app2` - Application Instance 2
- `studenthub_app3` - Application Instance 3
- `studenthub_nginx_lb` - Nginx Load Balancer

#### 4. Проверка работы Load Balancer

```powershell
# Проверка health check
curl http://localhost:8080/nginx-health

# Проверка API через Load Balancer
curl http://localhost:8080/api/health
```

#### 5. Просмотр логов Load Balancer

```powershell
docker compose -f docker-compose.loadbalancer.yml logs -f nginx
```

---

### Сценарий 3: Остановка и очистка

#### Остановка конфигурации разработки

```powershell
# Остановить контейнеры
docker compose down

# Остановить и удалить volumes (⚠️ удалит все данные БД!)
docker compose down -v
```

#### Остановка Load Balancer конфигурации

```powershell
# Остановить все контейнеры
docker compose -f docker-compose.loadbalancer.yml down

# Остановить и удалить volumes (⚠️ удалит все данные!)
docker compose -f docker-compose.loadbalancer.yml down -v
```

---

### Сценарий 4: Перезапуск отдельных сервисов

#### Перезапуск в базовой конфигурации

```powershell
# Перезапустить все сервисы
docker compose restart

# Перезапустить конкретный сервис
docker compose restart postgres
docker compose restart redis
```

#### Перезапуск в Load Balancer конфигурации

```powershell
# Перезапустить все сервисы
docker compose -f docker-compose.loadbalancer.yml restart

# Перезапустить конкретный сервис
docker compose -f docker-compose.loadbalancer.yml restart app1
docker compose -f docker-compose.loadbalancer.yml restart nginx
docker compose -f docker-compose.loadbalancer.yml restart postgres-master
```

---

### Сценарий 5: Просмотр логов

#### Логи базовой конфигурации

```powershell
# Все логи
docker compose logs -f

# Логи конкретного сервиса
docker compose logs -f postgres
docker compose logs -f redis
```

#### Логи Load Balancer конфигурации

```powershell
# Все логи
docker compose -f docker-compose.loadbalancer.yml logs -f

# Логи конкретного сервиса
docker compose -f docker-compose.loadbalancer.yml logs -f app1
docker compose -f docker-compose.loadbalancer.yml logs -f nginx
docker compose -f docker-compose.loadbalancer.yml logs -f postgres-master
docker compose -f docker-compose.loadbalancer.yml logs -f pgbouncer
```

---

### Сценарий 6: Пересоздание контейнеров

#### Пересоздание базовой конфигурации

```powershell
# Пересоздать все контейнеры
docker compose up -d --force-recreate

# Пересоздать конкретный сервис
docker compose up -d --force-recreate postgres
```

#### Пересоздание Load Balancer конфигурации

```powershell
# Пересоздать все контейнеры
docker compose -f docker-compose.loadbalancer.yml up -d --force-recreate

# Пересоздать конкретный сервис
docker compose -f docker-compose.loadbalancer.yml up -d --force-recreate app1
```

---

### Сценарий 7: Масштабирование приложения (Load Balancer)

#### Увеличить количество инстансов приложения

```powershell
# Запустить 5 инстансов app1 (если настроено в compose файле)
docker compose -f docker-compose.loadbalancer.yml up -d --scale app1=5

# Или для всех app инстансов
docker compose -f docker-compose.loadbalancer.yml up -d --scale app1=3 --scale app2=3 --scale app3=3
```

**Примечание**: Для масштабирования нужно обновить `docker-compose.loadbalancer.yml`, добавив больше app инстансов.

---

### Сценарий 8: Проверка репликации PostgreSQL

#### Проверка статуса репликации (Load Balancer конфигурация)

```powershell
# Проверить репликацию на Master
docker exec -it studenthub_postgres_master_lb psql -U postgres -d studenthub -c "SELECT * FROM pg_stat_replication;"

# Проверить, что реплика в режиме standby
docker exec -it studenthub_postgres_replica_1_lb psql -U postgres -c "SELECT pg_is_in_recovery();"

# Должно вернуть: t (true) - реплика работает
```

---

### Сценарий 9: Проверка PgBouncer

#### Подключение через PgBouncer

```powershell
# Проверить статус PgBouncer
docker exec -it studenthub_pgbouncer_lb psql -h localhost -p 6432 -U postgres -d studenthub -c "SHOW POOLS;"

# Проверить активные соединения
docker exec -it studenthub_pgbouncer_lb psql -h localhost -p 6432 -U postgres -d studenthub -c "SHOW STATS;"
```

---

### Сценарий 10: Мониторинг ресурсов

#### Просмотр использования ресурсов

```powershell
# Все контейнеры
docker stats

# Конкретные контейнеры
docker stats studenthub_app1 studenthub_app2 studenthub_app3

# С ограничением по времени (5 секунд)
docker stats --no-stream
```

---

## Быстрый запуск (краткая справка)

### Для разработки:
```powershell
cd studenthub-backend
docker compose --profile tools up -d
npm run start:dev  # В другом терминале
```

### Для тестирования Load Balancer:
```powershell
cd studenthub-backend
docker compose -f docker-compose.loadbalancer.yml up -d
curl http://localhost:8080/api/health
```

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

### Базовая конфигурация (docker-compose.yml)

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

### Load Balancer конфигурация (docker-compose.loadbalancer.yml)

После запуска сервисы доступны по следующим адресам:

- **Nginx Load Balancer**: `http://localhost:8080`
  - Health check: `http://localhost:8080/nginx-health`
  - API: `http://localhost:8080/api/*`
  - WebSocket: `ws://localhost:8080/socket.io/`

- **PostgreSQL Master**: `localhost:5432`
  - Пользователь: `postgres`
  - Пароль: `postgres` (по умолчанию)
  - База данных: `studenthub`

- **PostgreSQL Replica 1**: `localhost:5433`
- **PostgreSQL Replica 2**: `localhost:5434`
- **PostgreSQL Replica 3**: `localhost:5435`

- **PgBouncer**: `localhost:6432`
  - Пользователь: `postgres`
  - Пароль: `postgres` (по умолчанию)
  - База данных: `studenthub`

- **Redis**: `localhost:6379`
  - Пароль: не установлен по умолчанию

- **Application Instances** (внутри Docker сети):
  - `app1:3000`
  - `app2:3000`
  - `app3:3000`

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

### Общие команды

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

# Просмотр информации о сети
docker network ls
docker network inspect studenthub-backend_studenthub_network
```

### Команды для Load Balancer конфигурации

```powershell
# Проверка health check всех сервисов
docker compose -f docker-compose.loadbalancer.yml ps

# Просмотр логов всех app инстансов
docker compose -f docker-compose.loadbalancer.yml logs -f app1 app2 app3

# Проверка балансировки нагрузки
# Выполните несколько запросов и проверьте, что они распределяются между инстансами
for ($i=1; $i -le 10; $i++) { curl http://localhost:8080/api/health; Start-Sleep -Seconds 1 }

# Проверка подключения к PgBouncer
docker exec -it studenthub_pgbouncer_lb psql -h localhost -p 6432 -U postgres -d studenthub

# Проверка репликации
docker exec -it studenthub_postgres_master_lb psql -U postgres -d studenthub -c "SELECT * FROM pg_stat_replication;"

# Проверка Redis памяти
docker exec -it studenthub_redis_lb redis-cli CONFIG GET maxmemory
docker exec -it studenthub_redis_lb redis-cli INFO memory
```

### Тестирование Load Balancer

```powershell
# Простой health check
curl http://localhost:8080/nginx-health

# Проверка API через Load Balancer
curl http://localhost:8080/api/health

# Проверка балансировки (должен возвращать разные INSTANCE_ID)
curl http://localhost:8080/api/health | Select-String "instance"

# Нагрузочное тестирование (требует установки Apache Bench или аналогичного)
# ab -n 1000 -c 10 http://localhost:8080/api/health
```

### Отладка и диагностика

```powershell
# Войти в контейнер PostgreSQL
docker exec -it studenthub_postgres psql -U postgres -d studenthub

# Войти в контейнер Redis
docker exec -it studenthub_redis redis-cli

# Проверить конфигурацию Nginx
docker exec -it studenthub_nginx_lb nginx -t

# Просмотр активных соединений в PgBouncer
docker exec -it studenthub_pgbouncer_lb psql -h localhost -p 6432 -U postgres -d pgbouncer -c "SHOW POOLS;"

# Проверка логов Nginx в реальном времени
docker compose -f docker-compose.loadbalancer.yml logs -f nginx | Select-String "GET\|POST"
```

### Очистка и сброс

```powershell
# Остановить и удалить все контейнеры Load Balancer конфигурации
docker compose -f docker-compose.loadbalancer.yml down -v

# Удалить все неиспользуемые volumes
docker volume prune

# Удалить все неиспользуемые сети
docker network prune

# Полная очистка (⚠️ удалит все неиспользуемые ресурсы Docker)
docker system prune -a --volumes
```

### Мониторинг производительности

```powershell
# Мониторинг использования ресурсов конкретных контейнеров
docker stats studenthub_app1 studenthub_app2 studenthub_app3

# Проверка использования диска volumes
docker system df -v

# Просмотр процессов внутри контейнера
docker top studenthub_app1
```

## Сравнительная таблица команд

| Действие | Базовая конфигурация | Load Balancer конфигурация |
|----------|---------------------|---------------------------|
| Запуск | `docker compose up -d` | `docker compose -f docker-compose.loadbalancer.yml up -d` |
| Остановка | `docker compose down` | `docker compose -f docker-compose.loadbalancer.yml down` |
| Логи | `docker compose logs -f` | `docker compose -f docker-compose.loadbalancer.yml logs -f` |
| Статус | `docker compose ps` | `docker compose -f docker-compose.loadbalancer.yml ps` |
| Перезапуск | `docker compose restart` | `docker compose -f docker-compose.loadbalancer.yml restart` |

---

## Шпаргалка: Быстрые команды

### 🚀 Быстрый старт для разработки
```powershell
cd studenthub-backend
docker compose --profile tools up -d
npm run start:dev  # В другом терминале
```

### 🧪 Быстрый старт для тестирования Load Balancer
```powershell
cd studenthub-backend
docker compose -f docker-compose.loadbalancer.yml up -d
curl http://localhost:8080/api/health
```

### 📊 Проверка статуса
```powershell
# Базовая конфигурация
docker compose ps

# Load Balancer конфигурация
docker compose -f docker-compose.loadbalancer.yml ps
```

### 📝 Просмотр логов
```powershell
# Все логи
docker compose logs -f

# Конкретный сервис
docker compose logs -f postgres
docker compose -f docker-compose.loadbalancer.yml logs -f app1
```

### 🛑 Остановка
```powershell
# Базовая
docker compose down

# Load Balancer
docker compose -f docker-compose.loadbalancer.yml down
```

### 🔄 Перезапуск
```powershell
# Все сервисы
docker compose restart

# Конкретный сервис
docker compose restart postgres
docker compose -f docker-compose.loadbalancer.yml restart app1
```

### 🧹 Очистка
```powershell
# Остановить и удалить volumes (⚠️ удалит данные!)
docker compose down -v
docker compose -f docker-compose.loadbalancer.yml down -v
```

### 🔍 Диагностика
```powershell
# Использование ресурсов
docker stats

# Health check Load Balancer
curl http://localhost:8080/nginx-health

# Проверка репликации
docker exec studenthub_postgres_master_lb psql -U postgres -d studenthub -c "SELECT client_addr, state, sync_state FROM pg_stat_replication;"

# Проверка, что реплика в режиме standby
docker exec studenthub_postgres_replica_1_lb psql -U postgres -c "SELECT pg_is_in_recovery();"
# Должно вернуть: t (true)

# Проверка работы Load Balancer
Invoke-WebRequest -Uri http://localhost:8080/api/health -UseBasicParsing
```

### ⚠️ Решение проблем

#### Проблема: Реплики не могут подключиться к Master
**Ошибка**: `no pg_hba.conf entry for replication connection`

**Решение**:
1. Убедитесь, что entrypoint-master.sh настроен правильно
2. Проверьте pg_hba.conf на master:
   ```powershell
   docker exec studenthub_postgres_master_lb cat /var/lib/postgresql/data/pgdata/pg_hba.conf | Select-String -Pattern "0.0.0.0/0"
   ```
3. Если записи нет, добавьте вручную:
   ```powershell
   docker exec studenthub_postgres_master_lb sh -c "echo '' >> /var/lib/postgresql/data/pgdata/pg_hba.conf && echo '# Replication connections from Docker network' >> /var/lib/postgresql/data/pgdata/pg_hba.conf && echo 'host replication postgres 0.0.0.0/0 md5' >> /var/lib/postgresql/data/pgdata/pg_hba.conf && psql -U postgres -c 'SELECT pg_reload_conf();'"
   ```
4. Перезапустите реплики:
   ```powershell
   docker compose -f docker-compose.loadbalancer.yml restart postgres-replica-1 postgres-replica-2 postgres-replica-3
   ```

#### Проблема: PgBouncer unhealthy
**Ошибка**: `pg_isready: command not found`

**Решение**: Healthcheck для PgBouncer использует `nc -z localhost 6432` вместо `pg_isready`. Убедитесь, что в docker-compose.loadbalancer.yml используется правильный healthcheck.

#### Проблема: Реплики перезапускаются из-за max_connections
**Ошибка**: `max_connections = 100 is a lower setting than on the primary server, where its value was 1000`

**Решение**: Убедитесь, что в docker-compose.loadbalancer.yml для всех реплик указан `max_connections=1000` в command.





