# Развертывание StudentHub в Production

## 📋 Что нужно для развертывания в production?

### Обязательные требования

1. **Сервер(ы) с Ubuntu 20.04+ или аналогичной ОС**
   - Минимальные требования: [SERVER_REQUIREMENTS.md](SERVER_REQUIREMENTS.md)
   - Рекомендуется: 4+ CPU, 8GB+ RAM, 100GB+ SSD

2. **Доменное имя**
   - Настроенный DNS
   - SSL сертификат (Let's Encrypt рекомендуется)

3. **PostgreSQL сервер**
   - Версия 14+
   - Настроенная репликация (рекомендуется)
   - Регулярные бэкапы

4. **Redis сервер**
   - Версия 7+
   - Настроенная персистентность
   - Мониторинг памяти

5. **Nginx или другой reverse proxy**
   - Для load balancing
   - SSL termination
   - Статические файлы

6. **SMTP сервер**
   - Для отправки email
   - Настроенный SMTP или сервис (SendGrid, Mailgun)

7. **AWS S3 или аналогичное хранилище**
   - Для медиа файлов
   - Настроенный bucket и IAM пользователь

8. **Мониторинг и логирование**
   - Prometheus + Grafana (рекомендуется)
   - Или альтернативные решения

---

## 🚀 Пошаговая инструкция по развертыванию

### Этап 1: Подготовка серверов

#### 1.1. Настройка основного сервера

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка необходимых пакетов
sudo apt install -y curl wget git build-essential

# Установка Node.js 18 LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Проверка версии
node --version  # Должно быть v18.x.x
npm --version
```

#### 1.2. Настройка PostgreSQL сервера

```bash
# Установка PostgreSQL
sudo apt install -y postgresql-14 postgresql-contrib

# Создание базы данных
sudo -u postgres psql
CREATE DATABASE studenthub;
CREATE USER studenthub_user WITH PASSWORD 'strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE studenthub TO studenthub_user;
\q

# Настройка репликации (опционально, для production)
# См. документацию PostgreSQL
```

#### 1.3. Настройка Redis

```bash
# Установка Redis
sudo apt install -y redis-server

# Настройка пароля
sudo nano /etc/redis/redis.conf
# Раскомментируйте: requirepass your_strong_redis_password

# Перезапуск Redis
sudo systemctl restart redis
sudo systemctl enable redis
```

#### 1.4. Установка Nginx

```bash
# Установка Nginx
sudo apt install -y nginx

# Настройка SSL (Let's Encrypt)
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

---

### Этап 2: Настройка Backend

#### 2.1. Клонирование и установка

```bash
# Создание директории
sudo mkdir -p /var/www/studenthub
sudo chown $USER:$USER /var/www/studenthub

# Клонирование репозитория
cd /var/www/studenthub
git clone <repository-url> .

# Установка зависимостей Backend
cd studenthub-backend
npm install --production
```

#### 2.2. Настройка переменных окружения

Создайте файл `.env` в `studenthub-backend/`:

```env
# ============================================
# Окружение
# ============================================
NODE_ENV=production
PORT=3000

# ============================================
# База данных
# ============================================
DATABASE_URL=postgresql://studenthub_user:strong_password@localhost:5432/studenthub?schema=public

# ============================================
# Redis
# ============================================
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_strong_redis_password

# ============================================
# JWT (ОБЯЗАТЕЛЬНО измените на сильные секреты!)
# ============================================
JWT_SECRET=your_very_strong_jwt_secret_min_32_chars_use_random_generator
JWT_EXPIRATION=15m
JWT_REFRESH_SECRET=your_very_strong_refresh_secret_min_32_chars_use_random_generator
JWT_REFRESH_EXPIRATION=7d

# ============================================
# Email (SMTP)
# ============================================
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@yourdomain.com
SMTP_PASSWORD=your_smtp_password
SMTP_FROM_EMAIL=noreply@yourdomain.com

# ============================================
# Frontend URL
# ============================================
FRONTEND_URL=https://yourdomain.com

# ============================================
# AWS S3 (для медиа файлов)
# ============================================
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=studenthub-media

# ============================================
# App
# ============================================
APP_NAME=StudentHub
```

**⚠️ ВАЖНО:** Используйте сильные пароли и секреты! Генерируйте их с помощью:
```bash
# Генерация случайного секрета
openssl rand -base64 32
```

#### 2.3. Применение миграций

```bash
cd studenthub-backend

# Применение миграций
npm run db:migrate:prod

# Генерация Prisma Client
npm run db:generate
```

#### 2.4. Сборка Backend

```bash
# Сборка проекта
npm run build

# Проверка сборки
ls -la dist/
```

#### 2.5. Настройка PM2 (процесс-менеджер)

```bash
# Установка PM2
sudo npm install -g pm2

# Запуск приложения
cd /var/www/studenthub/studenthub-backend
pm2 start dist/main.js --name studenthub-backend

# Настройка автозапуска
pm2 startup
pm2 save

# Просмотр статуса
pm2 status
pm2 logs studenthub-backend
```

---

### Этап 3: Настройка Frontend

#### 3.1. Установка зависимостей

```bash
cd /var/www/studenthub/studenthub-frontend
npm install --production
```

#### 3.2. Настройка переменных окружения

Создайте файл `.env.production`:

```env
NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api
NEXT_PUBLIC_WS_URL=https://api.yourdomain.com
NEXT_PUBLIC_APP_NAME=StudentHub
```

#### 3.3. Сборка Frontend

```bash
# Сборка для production
npm run build

# Проверка сборки
ls -la .next/
```

#### 3.4. Запуск Frontend через PM2

```bash
# Запуск Next.js в production режиме
pm2 start npm --name studenthub-frontend -- start

# Или через custom script
pm2 start ecosystem.config.js
```

**ecosystem.config.js:**
```javascript
module.exports = {
  apps: [{
    name: 'studenthub-frontend',
    script: 'npm',
    args: 'start',
    cwd: '/var/www/studenthub/studenthub-frontend',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    }
  }]
};
```

---

### Этап 4: Настройка Nginx

#### 4.1. Конфигурация для Backend API

Создайте файл `/etc/nginx/sites-available/studenthub-api`:

```nginx
upstream backend {
    least_conn;
    server localhost:3000;
    # Добавьте больше серверов для масштабирования
    # server localhost:3001;
    # server localhost:3002;
}

server {
    listen 80;
    server_name api.yourdomain.com;
    
    # Редирект на HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    # SSL настройки
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Логи
    access_log /var/log/nginx/studenthub-api-access.log;
    error_log /var/log/nginx/studenthub-api-error.log;

    # Увеличение лимитов для загрузки файлов
    client_max_body_size 50M;

    location / {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket поддержка
    location /socket.io/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

#### 4.2. Конфигурация для Frontend

Создайте файл `/etc/nginx/sites-available/studenthub-frontend`:

```nginx
upstream frontend {
    least_conn;
    server localhost:3001;
    # Добавьте больше инстансов для масштабирования
}

server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    # Редирект на HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # SSL настройки
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Логи
    access_log /var/log/nginx/studenthub-frontend-access.log;
    error_log /var/log/nginx/studenthub-frontend-error.log;

    # Статические файлы Next.js
    location /_next/static {
        alias /var/www/studenthub/studenthub-frontend/.next/static;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }

    # API проксирование
    location /api {
        proxy_pass https://api.yourdomain.com;
        proxy_http_version 1.1;
        proxy_set_header Host api.yourdomain.com;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Основное приложение
    location / {
        proxy_pass http://frontend;
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

#### 4.3. Активация конфигураций

```bash
# Создание символических ссылок
sudo ln -s /etc/nginx/sites-available/studenthub-api /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/studenthub-frontend /etc/nginx/sites-enabled/

# Проверка конфигурации
sudo nginx -t

# Перезагрузка Nginx
sudo systemctl reload nginx
```

---

### Этап 5: Настройка мониторинга

#### 5.1. Настройка PM2 мониторинга

```bash
# PM2 Web интерфейс
pm2 web

# Или используйте PM2 Plus (cloud мониторинг)
pm2 link <secret_key> <public_key>
```

#### 5.2. Настройка логирования

```bash
# Ротация логов PM2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

#### 5.3. Health checks

Настройте мониторинг health endpoints:
- Backend: `https://api.yourdomain.com/api/health`
- Frontend: `https://yourdomain.com/api/health`

---

### Этап 6: Настройка резервного копирования

#### 6.1. Автоматический бэкап базы данных

Создайте скрипт `/usr/local/bin/backup-db.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/studenthub"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Бэкап базы данных
pg_dump -U studenthub_user studenthub | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Удаление старых бэкапов (старше 7 дней)
find $BACKUP_DIR -name "db_*.sql.gz" -mtime +7 -delete

# Отправка в облачное хранилище (опционально)
# aws s3 cp $BACKUP_DIR/db_$DATE.sql.gz s3://your-backup-bucket/
```

```bash
# Сделать скрипт исполняемым
sudo chmod +x /usr/local/bin/backup-db.sh

# Добавить в cron (ежедневно в 2:00)
sudo crontab -e
# Добавить строку:
0 2 * * * /usr/local/bin/backup-db.sh
```

---

## 🔒 Безопасность

### Обязательные меры безопасности

1. **Firewall настройка:**
```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

2. **Обновление системы:**
```bash
# Автоматические обновления безопасности
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

3. **Ограничение доступа к БД:**
- Разрешить доступ только с localhost
- Использовать сильные пароли
- Регулярно обновлять PostgreSQL

4. **SSL/TLS:**
- Использовать только TLS 1.2+
- Настроить HSTS
- Регулярно обновлять сертификаты

5. **Мониторинг:**
- Настроить алерты на критические ошибки
- Мониторить использование ресурсов
- Логировать все важные события

---

## 📊 Масштабирование

### Горизонтальное масштабирование

Для поддержки 50,000+ пользователей:

1. **Несколько инстансов Backend:**
   - Запустите 3-5 инстансов через PM2 cluster mode
   - Используйте Nginx load balancer

2. **PostgreSQL репликация:**
   - Master для записи
   - 3+ реплики для чтения
   - Настройка через `docker-compose.loadbalancer.yml`

3. **Redis кластер:**
   - Настройка Redis Sentinel или Cluster
   - Для высокой доступности

4. **CDN для статических файлов:**
   - CloudFlare, AWS CloudFront
   - Кэширование статики

Подробнее: [SCALABILITY.md](SCALABILITY.md)

---

## ✅ Проверка развертывания

### 1. Проверка Backend

```bash
# Health check
curl https://api.yourdomain.com/api/health

# Swagger документация
# Откройте: https://api.yourdomain.com/api/docs
```

### 2. Проверка Frontend

- Откройте https://yourdomain.com
- Проверьте работу всех страниц
- Проверьте подключение к API

### 3. Проверка WebSocket

```javascript
// В консоли браузера
const socket = io('https://api.yourdomain.com');
socket.on('connect', () => console.log('Connected!'));
```

### 4. Проверка производительности

```bash
# Мониторинг ресурсов
htop

# PM2 мониторинг
pm2 monit

# Логи
pm2 logs
```

---

## 🔄 Обновление приложения

### Процесс обновления

```bash
# 1. Остановка приложений
pm2 stop studenthub-backend studenthub-frontend

# 2. Бэкап базы данных
/usr/local/bin/backup-db.sh

# 3. Обновление кода
cd /var/www/studenthub
git pull origin main

# 4. Обновление зависимостей
cd studenthub-backend
npm install --production
npm run build

cd ../studenthub-frontend
npm install --production
npm run build

# 5. Применение миграций (если есть)
cd ../studenthub-backend
npm run db:migrate:prod

# 6. Перезапуск
pm2 restart studenthub-backend studenthub-frontend

# 7. Проверка
pm2 status
curl https://api.yourdomain.com/api/health
```

---

## 📚 Дополнительные ресурсы

- [SERVER_REQUIREMENTS.md](SERVER_REQUIREMENTS.md) - Требования к серверам
- [SCALABILITY.md](SCALABILITY.md) - Масштабирование системы
- [DEPLOYMENT.md](DEPLOYMENT.md) - Дополнительные инструкции
- [DOCKER_SETUP.md](DOCKER_SETUP.md) - Docker конфигурации

---

**Время на полное развертывание:** 2-4 часа (в зависимости от опыта)

**Готово!** Приложение развернуто в production. 🚀
