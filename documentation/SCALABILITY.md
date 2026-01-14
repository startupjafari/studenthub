# Масштабирование и Производительность - Документация

## Анализ текущей архитектуры

### Текущая конфигурация

#### 1. Load Balancer (Nginx)
- **Worker processes**: `auto` (обычно = количество CPU ядер)
- **Worker connections**: `1024` на worker
- **Максимум соединений**: ~4096 (при 4 CPU: 4 × 1024)
- **Балансировка**: `least_conn` (по наименьшему количеству соединений)
- **Keep-alive**: 32 соединения к upstream

#### 2. Backend Application Instances
- **Количество**: 3 инстанса (app1, app2, app3)
- **Технология**: NestJS на Node.js
- **Порт**: 3000 (каждый инстанс)

#### 3. База данных PostgreSQL
- **Master**: `max_connections = 200` ⚠️ **КРИТИЧЕСКОЕ ОГРАНИЧЕНИЕ**
- **Replica**: 1 реплика для чтения
- **Connection pooling**: Prisma использует встроенный пул (по умолчанию ~10 соединений на инстанс)
- **Настройки памяти**:
  - `shared_buffers = 256MB`
  - `effective_cache_size = 1GB`
  - `work_mem = 4MB`

#### 4. Redis Cache
- **Память**: 512MB ⚠️ **МОЖЕТ БЫТЬ НЕДОСТАТОЧНО**
- **Политика**: `allkeys-lru` (eviction при переполнении)
- **Использование**: кэширование, сессии, очереди

#### 5. Rate Limiting
- **Короткий период**: 100 запросов/минуту
- **Средний период**: 200 запросов/10 минут
- **Длинный период**: 500 запросов/15 минут

---

## Расчет для 50,000+ активных пользователей

### Предположения
- **Активные пользователи**: 50,000+
- **Пиковая одновременная нагрузка**: ~10,000-15,000 пользователей (20-30% от активных)
- **Средний запросов на пользователя**: 10-20 запросов/минуту
- **Пиковая нагрузка**: 500,000-1,000,000 запросов/минуту
- **Соотношение чтение/запись**: 80/20 (80% чтение, 20% запись)

### Требуемая производительность

#### HTTP запросы
- **Пиковая нагрузка**: 1,000,000 req/min = ~16,667 req/sec
- **На инстанс**: ~5,556 req/sec (при 3 инстансах)
- **Требуется**: минимум 10-15 инстансов приложения

#### База данных
- **Соединения для записи**: 150-200 (master)
- **Соединения для чтения**: 800-1,000 (реплики)
- **Требуется**: 
  - Master: `max_connections = 500-1000`
  - Replicas: минимум 5-7 реплик для чтения

#### Redis
- **Память**: минимум 4-8GB для кэширования
- **Оптимально**: Redis Cluster или Redis Sentinel для высокой доступности

#### WebSocket соединения
- **Одновременные WebSocket**: ~10,000-15,000
- **На инстанс**: ~3,333-5,000 соединений
- **Требуется**: минимум 5-7 инстансов для WebSocket

---

## Рекомендации по масштабированию

### 1. PostgreSQL - Критические изменения

#### Увеличение max_connections

**Текущее**: `max_connections = 200`  
**Рекомендуемое**: `max_connections = 1000`

```yaml
# docker-compose.loadbalancer.yml
postgres-master:
  command:
    - "postgres"
    - "-c" "max_connections=1000"
    - "-c" "shared_buffers=2GB"  # Увеличено с 256MB
    - "-c" "effective_cache_size=8GB"  # Увеличено с 1GB
    - "-c" "maintenance_work_mem=256MB"  # Увеличено с 64MB
    - "-c" "work_mem=8MB"  # Увеличено с 4MB
    - "-c" "checkpoint_completion_target=0.9"
    - "-c" "wal_buffers=32MB"  # Увеличено с 16MB
    - "-c" "default_statistics_target=100"
    - "-c" "random_page_cost=1.1"
    - "-c" "effective_io_concurrency=200"
    - "-c" "min_wal_size=2GB"  # Увеличено с 1GB
    - "-c" "max_wal_size=8GB"  # Увеличено с 4GB
    - "-c" "max_worker_processes=8"
    - "-c" "max_parallel_workers_per_gather=4"
    - "-c" "max_parallel_workers=8"
```

#### Добавление реплик для чтения

**Текущее**: 1 реплика  
**Рекомендуемое**: 5-7 реплик

```yaml
# Добавить в docker-compose.loadbalancer.yml
postgres-replica-2:
  image: postgres:16-alpine
  container_name: studenthub_postgres_replica_2_lb
  # ... аналогично replica-1

postgres-replica-3:
  # ... аналогично

postgres-replica-4:
  # ... аналогично

postgres-replica-5:
  # ... аналогично
```

#### Connection Pooling в Prisma

Настройте connection pool в DATABASE_URL:

```env
# Для записи (master)
DATABASE_URL=postgresql://user:password@postgres-master:5432/studenthub?schema=public&connection_limit=50&pool_timeout=20

# Для чтения (replica) - используйте PgBouncer или настройте пул
DATABASE_READ_URL=postgresql://user:password@postgres-replica-1:5432/studenthub?schema=public&connection_limit=100&pool_timeout=20
```

**Рекомендация**: Используйте PgBouncer для connection pooling:

```yaml
# docker-compose.loadbalancer.yml
pgbouncer:
  image: pgbouncer/pgbouncer:latest
  environment:
    DATABASES_HOST: postgres-master
    DATABASES_PORT: 5432
    DATABASES_USER: ${POSTGRES_USER}
    DATABASES_PASSWORD: ${POSTGRES_PASSWORD}
    DATABASES_DBNAME: ${POSTGRES_DB}
    PGBOUNCER_POOL_MODE: transaction
    PGBOUNCER_MAX_CLIENT_CONN: 1000
    PGBOUNCER_DEFAULT_POOL_SIZE: 50
    PGBOUNCER_MIN_POOL_SIZE: 10
    PGBOUNCER_RESERVE_POOL_SIZE: 5
  ports:
    - "6432:6432"
```

### 2. Redis - Масштабирование

#### Увеличение памяти

**Текущее**: 512MB  
**Рекомендуемое**: 8GB

```yaml
redis:
  command: >
    redis-server
    --appendonly yes
    --appendfsync everysec
    --maxmemory 8gb  # Увеличено с 512mb
    --maxmemory-policy allkeys-lru
    --requirepass ${REDIS_PASSWORD}
```

#### Redis Cluster (для высокой доступности)

Для production рекомендуется Redis Cluster или Redis Sentinel:

```yaml
# Redis Cluster конфигурация
redis-master:
  image: redis:7-alpine
  command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}

redis-replica-1:
  image: redis:7-alpine
  command: redis-server --replicaof redis-master 6379 --requirepass ${REDIS_PASSWORD}

redis-replica-2:
  image: redis:7-alpine
  command: redis-server --replicaof redis-master 6379 --requirepass ${REDIS_PASSWORD}
```

### 3. Backend Application - Горизонтальное масштабирование

#### Увеличение количества инстансов

**Текущее**: 3 инстанса  
**Рекомендуемое**: 10-15 инстансов

```yaml
# docker-compose.loadbalancer.yml
# Добавить app4-app15
app4:
  # ... аналогично app1

app5:
  # ... аналогично app1

# ... и так далее до app15
```

#### Обновление Nginx upstream

```nginx
# nginx/nginx.conf
upstream backend {
    least_conn;
    
    server app1:3000 max_fails=3 fail_timeout=30s weight=1;
    server app2:3000 max_fails=3 fail_timeout=30s weight=1;
    server app3:3000 max_fails=3 fail_timeout=30s weight=1;
    server app4:3000 max_fails=3 fail_timeout=30s weight=1;
    server app5:3000 max_fails=3 fail_timeout=30s weight=1;
    server app6:3000 max_fails=3 fail_timeout=30s weight=1;
    server app7:3000 max_fails=3 fail_timeout=30s weight=1;
    server app8:3000 max_fails=3 fail_timeout=30s weight=1;
    server app9:3000 max_fails=3 fail_timeout=30s weight=1;
    server app10:3000 max_fails=3 fail_timeout=30s weight=1;
    server app11:3000 max_fails=3 fail_timeout=30s weight=1;
    server app12:3000 max_fails=3 fail_timeout=30s weight=1;
    server app13:3000 max_fails=3 fail_timeout=30s weight=1;
    server app14:3000 max_fails=3 fail_timeout=30s weight=1;
    server app15:3000 max_fails=3 fail_timeout=30s weight=1;
    
    keepalive 64;  # Увеличено с 32
}

upstream websocket_backend {
    ip_hash;
    
    server app1:3000 max_fails=3 fail_timeout=30s;
    server app2:3000 max_fails=3 fail_timeout=30s;
    server app3:3000 max_fails=3 fail_timeout=30s;
    server app4:3000 max_fails=3 fail_timeout=30s;
    server app5:3000 max_fails=3 fail_timeout=30s;
    server app6:3000 max_fails=3 fail_timeout=30s;
    server app7:3000 max_fails=3 fail_timeout=30s;
    # ... остальные инстансы
}
```

#### Увеличение worker_connections в Nginx

```nginx
# nginx/nginx.conf
events {
    worker_connections 4096;  # Увеличено с 1024
    use epoll;
    multi_accept on;
}
```

### 4. Оптимизация Prisma Service

#### Настройка connection pool в PrismaService

```typescript
// src/common/services/prisma.service.ts
constructor(
  @Optional() private readonly configService?: ConfigService,
) {
  const writeUrl = configService?.get<string>('database.url');
  
  super({
    datasources: {
      db: {
        url: writeUrl,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

  // Настройка connection pool через параметры URL
  // DATABASE_URL должен содержать: ?connection_limit=50&pool_timeout=20
}
```

### 5. Кэширование и оптимизация

#### Агрессивное кэширование

Увеличьте использование Redis для кэширования:
- Профили пользователей: TTL 1 час
- Списки постов: TTL 5 минут
- Группы и университеты: TTL 30 минут
- Статистика: TTL 10 минут

#### CDN для статических файлов

Используйте CDN (CloudFront, Cloudflare) для:
- Аватаров пользователей
- Медиа файлов (изображения, видео)
- Статических ресурсов

### 6. Мониторинг и метрики

#### Необходимые метрики

1. **Application Metrics**:
   - Request rate (req/sec)
   - Response time (p50, p95, p99)
   - Error rate
   - Active connections

2. **Database Metrics**:
   - Active connections
   - Query performance
   - Replication lag
   - Connection pool usage

3. **Redis Metrics**:
   - Memory usage
   - Hit rate
   - Evictions
   - Connections

4. **System Metrics**:
   - CPU usage
   - Memory usage
   - Network I/O
   - Disk I/O

#### Инструменты мониторинга

- **Prometheus + Grafana**: для метрик
- **ELK Stack**: для логов
- **New Relic / Datadog**: для APM
- **Sentry**: для ошибок

---

## План поэтапного масштабирования

### Этап 1: Критические изменения (Немедленно)

1. ✅ Увеличить `max_connections` в PostgreSQL до 1000
2. ✅ Увеличить память Redis до 8GB
3. ✅ Добавить 2 дополнительные реплики PostgreSQL (всего 3 реплики)
4. ✅ Увеличить `worker_connections` в Nginx до 4096
5. ✅ Настроить connection pooling (PgBouncer или через Prisma)

**Результат**: Поддержка ~5,000-7,000 одновременных пользователей

### Этап 2: Горизонтальное масштабирование (1-2 недели)

1. ✅ Увеличить количество инстансов приложения до 10
2. ✅ Добавить еще 2 реплики PostgreSQL (всего 5 реплик)
3. ✅ Настроить Redis Cluster или Sentinel
4. ✅ Оптимизировать кэширование

**Результат**: Поддержка ~10,000-12,000 одновременных пользователей

### Этап 3: Оптимизация и мониторинг (2-4 недели)

1. ✅ Увеличить количество инстансов до 15
2. ✅ Настроить CDN для статических файлов
3. ✅ Внедрить агрессивное кэширование
4. ✅ Настроить полный мониторинг (Prometheus, Grafana)
5. ✅ Оптимизировать запросы к базе данных

**Результат**: Поддержка ~15,000+ одновременных пользователей (50,000+ активных)

### Этап 4: Продвинутая оптимизация (По необходимости)

1. ✅ Database sharding (если требуется)
2. ✅ Микросервисная архитектура (если требуется)
3. ✅ Message queue (RabbitMQ, Kafka) для асинхронной обработки
4. ✅ Elasticsearch для поиска
5. ✅ Read replicas в разных регионах

---

## Рекомендуемая архитектура для 50,000+ пользователей

```
                    [CDN]
                      |
              [Load Balancer]
         (Nginx / HAProxy / AWS ALB)
                      |
        +-------------+-------------+
        |             |             |
   [App Cluster]  [App Cluster]  [App Cluster]
   (5 instances)  (5 instances)  (5 instances)
        |             |             |
        +-------------+-------------+
                      |
        +-------------+-------------+
        |             |             |
   [Redis Cluster] [PgBouncer]  [Monitoring]
   (3 nodes)       (Pool)        (Prometheus)
        |             |             |
        +-------------+-------------+
                      |
        +-------------+-------------+
        |             |             |
   [PostgreSQL]  [PostgreSQL]  [PostgreSQL]
   (Master)      (Replica 1)   (Replica 2-5)
```

### Ресурсы серверов

#### Application Servers (15 инстансов)
- **CPU**: 4-8 cores
- **RAM**: 8-16GB
- **Storage**: 50GB SSD

#### Database Master
- **CPU**: 16-32 cores
- **RAM**: 64-128GB
- **Storage**: 500GB-1TB NVMe SSD

#### Database Replicas (5 реплик)
- **CPU**: 8-16 cores
- **RAM**: 32-64GB
- **Storage**: 500GB-1TB NVMe SSD

#### Redis Cluster (3 nodes)
- **CPU**: 4-8 cores
- **RAM**: 16-32GB
- **Storage**: 100GB SSD

#### Load Balancer
- **CPU**: 8-16 cores
- **RAM**: 16-32GB
- **Network**: 10Gbps

---

## Конфигурационные файлы

### Обновленный docker-compose.loadbalancer.yml

См. раздел "Рекомендации по масштабированию" выше для детальных конфигураций.

### Обновленный nginx.conf

См. раздел "Backend Application - Горизонтальное масштабирование" выше.

### Переменные окружения

```env
# Database
DATABASE_URL=postgresql://user:password@pgbouncer:6432/studenthub?schema=public&connection_limit=50
DATABASE_READ_URL=postgresql://user:password@postgres-replica-1:5432/studenthub?schema=public&connection_limit=100

# Redis
REDIS_HOST=redis-master
REDIS_PORT=6379
REDIS_PASSWORD=strong_password
REDIS_CLUSTER_MODE=true

# Application
NODE_ENV=production
PORT=3000
INSTANCES=15

# Rate Limiting (можно увеличить для production)
THROTTLE_SHORT_TTL=60000
THROTTLE_SHORT_LIMIT=200  # Увеличено с 100
THROTTLE_MEDIUM_TTL=600000
THROTTLE_MEDIUM_LIMIT=500  # Увеличено с 200
THROTTLE_LONG_TTL=900000
THROTTLE_LONG_LIMIT=1000  # Увеличено с 500
```

---

## Тестирование производительности

### Нагрузочное тестирование

Используйте инструменты:
- **k6**: для нагрузочного тестирования
- **Apache JMeter**: для комплексного тестирования
- **Artillery**: для Node.js приложений
- **wrk**: для быстрого тестирования

### Пример скрипта k6

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 1000 },   // Ramp-up до 1000 пользователей
    { duration: '5m', target: 5000 },      // Увеличить до 5000
    { duration: '5m', target: 10000 },    // Увеличить до 10000
    { duration: '2m', target: 0 },         // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],    // 95% запросов < 500ms
    http_req_failed: ['rate<0.01'],      // < 1% ошибок
  },
};

export default function () {
  const res = http.get('https://api.studenthub.com/api/health');
  check(res, { 'status was 200': (r) => r.status == 200 });
  sleep(1);
}
```

---

## Резюме

### Текущая емкость
- **Одновременные пользователи**: 300-500
- **Активные пользователи**: 1,000-2,000

### Целевая емкость (после масштабирования)
- **Одновременные пользователи**: 15,000+
- **Активные пользователи**: 50,000+

### Критические изменения
1. ✅ PostgreSQL: `max_connections = 1000` (с 200)
2. ✅ PostgreSQL: 5-7 реплик (с 1)
3. ✅ Redis: 8GB памяти (с 512MB)
4. ✅ Application: 10-15 инстансов (с 3)
5. ✅ Nginx: `worker_connections = 4096` (с 1024)
6. ✅ Connection pooling (PgBouncer)
7. ✅ Redis Cluster для высокой доступности

### Следующие шаги
1. Внедрить изменения Этапа 1 (критические)
2. Настроить мониторинг
3. Провести нагрузочное тестирование
4. Постепенно масштабировать до целевой емкости

---

## Дополнительные ресурсы

- [PostgreSQL Performance Tuning](https://www.postgresql.org/docs/current/performance-tips.html)
- [Redis Best Practices](https://redis.io/docs/manual/patterns/)
- [Nginx Performance Tuning](https://www.nginx.com/blog/tuning-nginx/)
- [Prisma Connection Pooling](https://www.prisma.io/docs/guides/performance-and-optimization/connection-management)
- [Node.js Performance Best Practices](https://nodejs.org/en/docs/guides/simple-profiling/)
