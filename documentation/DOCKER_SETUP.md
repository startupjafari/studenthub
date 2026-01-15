# Настройка Docker для StudentHub

## 📋 Обзор

Проект StudentHub использует Docker и Docker Compose для контейнеризации и управления сервисами. Доступны два варианта конфигурации:

1. **`docker-compose.yml`** - базовая конфигурация для разработки
2. **`docker-compose.loadbalancer.yml`** - конфигурация с load balancer для тестирования масштабирования

---

## 📦 Требования

- **Docker** версии 20.10 или выше
- **Docker Compose** версии 2.0 или выше
- Минимум **4 GB RAM** (для load balancer конфигурации - 8 GB)
- Минимум **10 GB** свободного места на диске

### Проверка установки

```bash
docker --version
docker compose version
```

---

## 🚀 Быстрый старт

### Вариант 1: Базовая конфигурация (разработка)

```bash
cd studenthub-backend

# Запуск всех сервисов
docker compose up -d

# Просмотр логов
docker compose logs -f

# Остановка сервисов
docker compose down
```

### Вариант 2: Load Balancer конфигурация (тестирование)

```bash
cd studenthub-backend

# Запуск с load balancer
docker compose -f docker-compose.loadbalancer.yml up -d

# Просмотр логов
docker compose -f docker-compose.loadbalancer.yml logs -f

# Остановка
docker compose -f docker-compose.loadbalancer.yml down
```

---

## 📁 Структура Docker файлов

```
studenthub-backend/
├── Dockerfile                          # Образ для Backend приложения
├── docker-compose.yml                  # Базовая конфигурация
├── docker-compose.loadbalancer.yml     # Конфигурация с load balancer
├── docker/
│   └── postgres-replication/           # Скрипты для репликации PostgreSQL
│       ├── entrypoint-master.sh
│       ├── entrypoint-replica.sh
│       └── init-replication.sh
└── nginx/
    ├── Dockerfile                      # Образ для Nginx Load Balancer
    └── nginx.conf                      # Конфигурация Nginx
```

---

## 🔧 Конфигурации

### 1. docker-compose.yml (Базовая)

**Сервисы:**
- **postgres** - PostgreSQL 16 (база данных)
- **redis** - Redis 7 (кэш и очереди)
- **pgadmin** - PgAdmin 4 (управление БД, опционально)
- **redis-commander** - Redis Commander (управление Redis, опционально)

**Порты:**
- PostgreSQL: `5432`
- Redis: `6379`
- PgAdmin: `5050` (только с профилем `tools`)
- Redis Commander: `8081` (только с профилем `tools`)

**Использование:**

```bash
# Запуск основных сервисов
docker compose up -d

# Запуск с инструментами управления (PgAdmin, Redis Commander)
docker compose --profile tools up -d

# Доступ к PgAdmin
# URL: http://localhost:5050
# Email: admin@studenthub.com
# Password: admin

# Доступ к Redis Commander
# URL: http://localhost:8081
# User: admin
# Password: admin
```

### 2. docker-compose.loadbalancer.yml (Масштабирование)

**Сервисы:**
- **postgres-master** - PostgreSQL Master (запись)
- **postgres-replica-1/2/3** - PostgreSQL Replicas (чтение)
- **pgbouncer** - Connection Pooler
- **redis** - Redis (общий кэш)
- **app1/app2/app3** - 3 инстанса Backend приложения
- **nginx** - Load Balancer

**Порты:**
- PostgreSQL Master: `5432`
- PostgreSQL Replicas: `5433`, `5434`, `5435`
- PgBouncer: `6432`
- Redis: `6379`
- Nginx Load Balancer: `8080`
- Backend Apps: внутренние (через Nginx)

**Использование:**

```bash
# Запуск всей инфраструктуры
docker compose -f docker-compose.loadbalancer.yml up -d

# Доступ к приложению через Load Balancer
# URL: http://localhost:8080

# Проверка статуса всех сервисов
docker compose -f docker-compose.loadbalancer.yml ps
```

---

## 🐳 Dockerfile

### Backend приложение

**Особенности:**
- Multi-stage build для оптимизации размера
- Node.js 20 Alpine
- Prisma Client генерация
- Production зависимости только
- Non-root пользователь для безопасности
- Health check встроен

**Сборка образа:**

```bash
# Сборка образа
docker build -t studenthub-backend:latest .

# Сборка с тегом
docker build -t studenthub-backend:v1.0.0 .
```

---

## ⚙️ Переменные окружения

### Для docker-compose.yml

Создайте файл `.env` в `studenthub-backend/` или используйте переменные окружения:

```env
# PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=studenthub
POSTGRES_PORT=5432

# Redis
REDIS_PORT=6379
REDIS_PASSWORD=

# PgAdmin (опционально)
PGADMIN_EMAIL=admin@studenthub.com
PGADMIN_PASSWORD=admin
PGADMIN_PORT=5050

# Redis Commander (опционально)
REDIS_COMMANDER_USER=admin
REDIS_COMMANDER_PASSWORD=admin
REDIS_COMMANDER_PORT=8081
```

### Для docker-compose.loadbalancer.yml

Дополнительные переменные:

```env
# PostgreSQL Replicas
POSTGRES_REPLICA_PORT=5433
POSTGRES_REPLICA_2_PORT=5434
POSTGRES_REPLICA_3_PORT=5435

# JWT (для Backend приложений)
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret

# NODE_ENV
NODE_ENV=development
```

---

## 📊 Управление контейнерами

### Просмотр статуса

```bash
# Список запущенных контейнеров
docker compose ps

# Детальная информация
docker compose ps -a
```

### Логи

```bash
# Все логи
docker compose logs

# Логи конкретного сервиса
docker compose logs postgres
docker compose logs redis
docker compose logs app1  # для load balancer

# Следить за логами в реальном времени
docker compose logs -f

# Последние 100 строк
docker compose logs --tail=100
```

### Перезапуск сервисов

```bash
# Перезапуск всех сервисов
docker compose restart

# Перезапуск конкретного сервиса
docker compose restart postgres

# Перезапуск с пересборкой (для Backend)
docker compose up -d --build app1
```

### Остановка и удаление

```bash
# Остановка (контейнеры остаются)
docker compose stop

# Остановка и удаление контейнеров
docker compose down

# Остановка и удаление контейнеров + volumes (⚠️ удалит данные!)
docker compose down -v

# Удаление только контейнеров (volumes остаются)
docker compose rm
```

---

## 💾 Volumes и данные

### Созданные volumes

**docker-compose.yml:**
- `postgres_data` - данные PostgreSQL
- `redis_data` - данные Redis
- `pgadmin_data` - данные PgAdmin

**docker-compose.loadbalancer.yml:**
- `postgres_master_data_lb` - данные Master
- `postgres_replica_1_data_lb` - данные Replica 1
- `postgres_replica_2_data_lb` - данные Replica 2
- `postgres_replica_3_data_lb` - данные Replica 3
- `redis_data_lb` - данные Redis

### Управление volumes

```bash
# Список volumes
docker volume ls

# Информация о volume
docker volume inspect studenthub_postgres_data

# Удаление volume (⚠️ удалит данные!)
docker volume rm studenthub_postgres_data

# Удаление всех неиспользуемых volumes
docker volume prune
```

### Резервное копирование

```bash
# Бэкап PostgreSQL
docker compose exec postgres pg_dump -U postgres studenthub > backup.sql

# Восстановление из бэкапа
docker compose exec -T postgres psql -U postgres studenthub < backup.sql

# Бэкап Redis
docker compose exec redis redis-cli SAVE
docker compose cp redis:/data/dump.rdb ./redis-backup.rdb
```

---

## 🔍 Полезные команды

### Выполнение команд в контейнерах

```bash
# Подключение к PostgreSQL
docker compose exec postgres psql -U postgres -d studenthub

# Подключение к Redis CLI
docker compose exec redis redis-cli

# Выполнение команды в Backend контейнере
docker compose exec app1 npm run db:migrate

# Доступ к shell контейнера
docker compose exec postgres sh
```

### Мониторинг ресурсов

```bash
# Использование ресурсов
docker stats

# Информация о контейнере
docker inspect studenthub_postgres

# Health check статус
docker compose ps
```

### Очистка

```bash
# Остановка и удаление контейнеров, сетей
docker compose down

# Удаление неиспользуемых образов
docker image prune

# Полная очистка (⚠️ удалит все неиспользуемое!)
docker system prune -a --volumes
```

---

## 🛠️ Troubleshooting

### Проблема: Контейнеры не запускаются

```bash
# Проверка логов
docker compose logs

# Проверка статуса
docker compose ps

# Пересборка образов
docker compose build --no-cache

# Перезапуск Docker daemon
# Windows: Перезапустите Docker Desktop
# Linux: sudo systemctl restart docker
```

### Проблема: Порты заняты

```bash
# Проверка занятых портов
# Windows
netstat -ano | findstr :5432

# Linux/Mac
lsof -i :5432

# Измените порты в .env файле или docker-compose.yml
```

### Проблема: PostgreSQL не подключается

```bash
# Проверка health check
docker compose exec postgres pg_isready -U postgres

# Проверка логов
docker compose logs postgres

# Проверка подключения из контейнера
docker compose exec app1 ping postgres
```

### Проблема: Redis не работает

```bash
# Проверка подключения
docker compose exec redis redis-cli ping

# Проверка с паролем
docker compose exec redis redis-cli -a your-password ping

# Проверка логов
docker compose logs redis
```

### Проблема: Load Balancer не балансирует

```bash
# Проверка статуса всех app инстансов
docker compose -f docker-compose.loadbalancer.yml ps

# Проверка Nginx конфигурации
docker compose -f docker-compose.loadbalancer.yml exec nginx nginx -t

# Проверка логов Nginx
docker compose -f docker-compose.loadbalancer.yml logs nginx
```

### Проблема: Недостаточно памяти

```bash
# Проверка использования памяти
docker stats

# Уменьшите количество реплик в load balancer конфигурации
# Или увеличьте лимиты памяти в Docker Desktop
```

---

## 📝 Примеры использования

### Разработка с Hot Reload

```bash
# Запуск только БД и Redis
docker compose up -d postgres redis

# Запуск Backend локально с hot reload
npm run start:dev
```

### Тестирование Load Balancer

```bash
# Запуск всей инфраструктуры
docker compose -f docker-compose.loadbalancer.yml up -d

# Тестирование нагрузки
ab -n 1000 -c 10 http://localhost:8080/api/health

# Мониторинг логов всех app инстансов
docker compose -f docker-compose.loadbalancer.yml logs -f app1 app2 app3
```

### Миграции базы данных

```bash
# Запуск миграций в контейнере
docker compose exec app1 npm run db:migrate

# Или локально (если БД доступна)
npm run db:migrate
```

### Prisma Studio

```bash
# Запуск Prisma Studio в контейнере
docker compose exec app1 npx prisma studio

# Или локально
npm run db:studio
```

---

## 🔐 Безопасность

### Production рекомендации

1. **Используйте сильные пароли** для PostgreSQL и Redis
2. **Не используйте PgAdmin и Redis Commander** в production
3. **Ограничьте доступ к портам** через firewall
4. **Используйте secrets** для чувствительных данных
5. **Регулярно обновляйте образы** Docker
6. **Используйте non-root пользователей** (уже настроено в Dockerfile)

### Secrets Management

```bash
# Создание Docker secrets (для production)
echo "your-secret-password" | docker secret create postgres_password -

# Использование в docker-compose.yml
secrets:
  postgres_password:
    external: true
```

---

## 📚 Дополнительные ресурсы

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [PostgreSQL Docker Image](https://hub.docker.com/_/postgres)
- [Redis Docker Image](https://hub.docker.com/_/redis)
- [Nginx Documentation](https://nginx.org/en/docs/)

---

## ✅ Чек-лист настройки

- [ ] Docker и Docker Compose установлены
- [ ] `.env` файл создан с необходимыми переменными
- [ ] Порты не заняты другими приложениями
- [ ] Достаточно места на диске (10+ GB)
- [ ] Достаточно RAM (4+ GB для базовой, 8+ GB для load balancer)
- [ ] Docker Desktop запущен (Windows/Mac)
- [ ] Протестирован запуск `docker compose up -d`
- [ ] Проверены health checks всех сервисов
- [ ] Настроены резервные копии (для production)

---

**Готово!** Docker настроен и готов к использованию! 🐳
