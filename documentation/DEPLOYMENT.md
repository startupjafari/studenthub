# Развертывание - Документация

## Подготовка к развертыванию

### Требования

- Сервер с Ubuntu 20.04+ или аналогичный
- Node.js 18+
- PostgreSQL 14+
- Redis 7+
- Nginx (для reverse proxy)
- PM2 или аналогичный процесс-менеджер

### Переменные окружения

Создайте файл `.env` на сервере с production значениями:

```
NODE_ENV=production
PORT=3000
APP_NAME=StudentHub

DATABASE_URL=postgresql://user:password@localhost:5432/studenthub
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=strong_redis_password

JWT_SECRET=very_strong_secret_min_32_chars
JWT_EXPIRATION=15m
JWT_REFRESH_SECRET=very_strong_refresh_secret_min_32_chars
JWT_REFRESH_EXPIRATION=7d

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@studenthub.com
SMTP_PASSWORD=smtp_password
SMTP_FROM_EMAIL=noreply@studenthub.com

FRONTEND_URL=https://studenthub.com
```

## Развертывание Backend

### 1. Установка зависимостей системы

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Установка PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Установка Redis
sudo apt install -y redis-server

# Установка Nginx
sudo apt install -y nginx

# Установка PM2
sudo npm install -g pm2
```

### 2. Настройка PostgreSQL

```bash
# Вход в PostgreSQL
sudo -u postgres psql

# Создание базы данных и пользователя
CREATE DATABASE studenthub;
CREATE USER studenthub_user WITH PASSWORD 'strong_password';
GRANT ALL PRIVILEGES ON DATABASE studenthub TO studenthub_user;
\q
```

### 3. Настройка Redis

```bash
# Редактирование конфигурации
sudo nano /etc/redis/redis.conf

# Установить пароль
requirepass your_strong_redis_password

# Перезапуск Redis
sudo systemctl restart redis
```

### 4. Клонирование и настройка проекта

```bash
# Клонирование репозитория
git clone <repository_url> studenthub-backend
cd studenthub-backend

# Установка зависимостей
npm install

# Настройка .env файла
nano .env

# Генерация Prisma Client
npm run db:generate

# Применение миграций
npm run db:migrate:prod
```

### 5. Сборка проекта

```bash
npm run build
```

### 6. Запуск с PM2

```bash
# Создание PM2 конфигурации
pm2 start dist/main.js --name studenthub-backend

# Сохранение конфигурации
pm2 save
pm2 startup
```

### 7. Настройка Nginx

Создайте файл `/etc/nginx/sites-available/studenthub`:

```nginx
server {
    listen 80;
    server_name api.studenthub.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Активация:

```bash
sudo ln -s /etc/nginx/sites-available/studenthub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 8. SSL сертификат (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.studenthub.com
```

## Docker развертывание

### Production Docker Compose

Создайте `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  postgres:
    restart: always
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports: []
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    restart: always
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
    ports: []

volumes:
  postgres_data:
  redis_data:
```

Запуск:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Мониторинг

### PM2 мониторинг

```bash
# Статус
pm2 status

# Логи
pm2 logs studenthub-backend

# Мониторинг
pm2 monit
```

### Логи приложения

```bash
# PM2 логи
pm2 logs studenthub-backend

# Nginx логи
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

## Обновление

### Процесс обновления

```bash
# Остановка приложения
pm2 stop studenthub-backend

# Получение обновлений
git pull origin main

# Установка зависимостей
npm install

# Применение миграций
npm run db:migrate:prod

# Сборка
npm run build

# Запуск
pm2 restart studenthub-backend
```

## Резервное копирование

### Автоматический бэкап базы данных

Создайте скрипт `/usr/local/bin/backup-db.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -U postgres studenthub > $BACKUP_DIR/studenthub_$DATE.sql
find $BACKUP_DIR -name "studenthub_*.sql" -mtime +7 -delete
```

Добавьте в crontab:

```bash
0 2 * * * /usr/local/bin/backup-db.sh
```

## Безопасность

### Рекомендации

1. Используйте сильные пароли для всех сервисов
2. Настройте firewall (UFW):
   ```bash
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```
3. Регулярно обновляйте систему и зависимости
4. Используйте SSL/TLS для всех соединений
5. Настройте rate limiting в Nginx
6. Используйте fail2ban для защиты от брутфорса

## Масштабирование

### Горизонтальное масштабирование

1. Используйте load balancer (Nginx, HAProxy)
2. Запустите несколько экземпляров приложения на разных портах
3. Используйте Redis для сессий и кэша
4. Настройте репликацию PostgreSQL

### Вертикальное масштабирование

1. Увеличьте ресурсы сервера (CPU, RAM)
2. Оптимизируйте настройки PostgreSQL
3. Используйте connection pooling

## Troubleshooting

### Приложение не запускается

1. Проверьте логи: `pm2 logs studenthub-backend`
2. Проверьте переменные окружения
3. Проверьте подключение к базе данных
4. Проверьте порты

### Проблемы с базой данных

1. Проверьте подключение: `psql -U postgres -d studenthub`
2. Проверьте миграции: `npx prisma migrate status`
3. Проверьте логи PostgreSQL

### Проблемы с Redis

1. Проверьте подключение: `redis-cli ping`
2. Проверьте пароль
3. Проверьте логи Redis





