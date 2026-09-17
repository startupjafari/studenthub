# Деплой StudentHub на Railway

Стек — 6 компонентов: **api** (NestJS, persistent: WebSocket + BullMQ + cron),
**web** (Next.js standalone), **landing** (публичный сайт, Next.js standalone),
**PostgreSQL**, **Redis** (обязателен для очередей), **объектное хранилище**
(MinIO или внешний S3).

Dockerfile'ы написаны с контекстом сборки = **корень монорепо**, поэтому Root Directory
каждого сервиса = корень репо, а нужный Dockerfile задаётся через config-as-code
(`apps/api/railway.json`, `apps/web/railway.json`, `apps/landing/railway.json`).

**landing ни от чего не зависит.** У него нет ни базы, ни Redis, ни общего кода с
платформой (`docs/LANDING.md`): его можно выкатывать и откатывать в любой момент, не
трогая остальные сервисы. Обратное тоже верно — падение api на лендинге не сказывается.

---

## 1. Проект и базы данных

1. Railway → **New Project** → **Deploy from GitHub repo** → `startupjafari/studenthub`.
2. **+ New** → **Database** → **PostgreSQL**.
3. **+ New** → **Database** → **Redis**.

## 2. Сервис `api`

1. На сервисе из GitHub-репо: **Settings → General → Config-as-code path** = `apps/api/railway.json`.
   (Railway возьмёт builder=Dockerfile и `apps/api/Dockerfile`; Root Directory оставить пустым.)
2. **Variables** — задать:

   | Переменная | Значение |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `JWT_ACCESS_SECRET` | 64-символьный hex (см. ниже) |
   | `JWT_REFRESH_SECRET` | другой 64-символьный hex |
   | `REDIS_HOST` | `${{Redis.REDISHOST}}` |
   | `REDIS_PORT` | `${{Redis.REDISPORT}}` |
   | `REDIS_PASSWORD` | `${{Redis.REDISPASSWORD}}` |
   | `MINIO_ENDPOINT` | приватный домен MinIO-сервиса (шаг 4) или хост S3 |
   | `MINIO_PORT` | `9000` (MinIO) или `443` (S3/R2) |
   | `MINIO_USE_SSL` | `false` (MinIO по приватной сети) или `true` (S3/R2) |
   | `MINIO_ACCESS_KEY` | ключ хранилища |
   | `MINIO_SECRET_KEY` | секрет хранилища |
   | `MINIO_PUBLIC_ENDPOINT` | публичный домен MinIO для presigned-ссылок (см. ниже) |
   | `CORS_ORIGIN` | публичный URL web-сервиса (после шага 3) |

   Опционально: `SMTP_HOST/PORT/USER/PASS/SMTP_FROM`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`.

   Мониторинг (Ф13.8) — `SENTRY_DSN` (без него трекер молчит), плюс по желанию
   `SENTRY_ENVIRONMENT` (напр. `pilot`) и `SENTRY_RELEASE`. Здесь достаточно
   выставить переменную и перезапустить — пересборка не нужна.
   **`PORT` не задавать** — Railway присваивает его сам, приложение читает `$PORT`
   и слушает `0.0.0.0`.

   Генерация секретов локально:
   ```bash
   openssl rand -hex 32   # выполнить дважды — для ACCESS и REFRESH
   ```

3. **Settings → Networking → Generate Domain** — публичный URL api.

## 3. Сервис `web`

1. **+ New → GitHub Repo** → тот же репозиторий (второй сервис).
2. **Config-as-code path** = `apps/web/railway.json`.
3. **Variables**:

   | Переменная | Значение |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<api-домен>/api/v1` |
   | `NEXT_PUBLIC_WS_URL` | `https://<api-домен>` |
   | `NEXT_PUBLIC_APP_URL` | `https://<web-домен>` |
   | `NEXT_PUBLIC_APP_NAME` | `StudentHub` |
   | `NEXT_PUBLIC_SENTRY_DSN` | DSN проекта Sentry (пусто = трекер выключен) |

   Опционально там же: `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_RELEASE`
   и — для читаемых стектрейсов вместо минифицированных — `SENTRY_ORG`, `SENTRY_PROJECT`,
   `SENTRY_AUTH_TOKEN` (загрузка source maps на сборке; без токена шаг молча пропускается).

   > `NEXT_PUBLIC_*` инлайнятся во время **сборки** — Railway передаёт переменные
   > сервиса как build-args, поэтому менять их = пересобрать web. Это относится и к
   > `NEXT_PUBLIC_SENTRY_DSN`: добавили DSN → нужен ре-деплой, рестарта недостаточно.

4. **Generate Domain** — публичный URL web. Затем вернуться в `api` и выставить
   `CORS_ORIGIN` = этот URL.

## 3.1 Сервис `landing`

Публичный сайт. Отдельный сервис и отдельный домен — платформа при этом уезжает на
поддомен (`app.<домен>`), см. `docs/LANDING.md §2`.

1. **+ New → GitHub Repo** → тот же репозиторий (третий сервис из репо).
2. **Config-as-code path** = `apps/landing/railway.json`.
3. **Variables**:

   | Переменная | Значение |
   |---|---|
   | `NEXT_PUBLIC_APP_URL` | `https://app.<домен>` — адрес платформы |
   | `NEXT_PUBLIC_SITE_URL` | `https://<домен>` — адрес самого лендинга |
   | `NEXT_PUBLIC_SALES_EMAIL` | почта для заявок на демонстрацию |

   > Все три инлайнятся во время **сборки**, значит их правка требует ре-деплоя, а не
   > рестарта. Особенно это касается `NEXT_PUBLIC_APP_URL`: из него строятся не только
   > кнопки «Войти», но и 308-редиректы на платформу. Ошибка в нём означает, что
   > **напечатанные QR-наклейки над дверями аудиторий перестанут работать**.

4. **Generate Domain** → затем **Custom Domain** на корневой домен.

### Переезд платформы на поддомен

Операция на проде, выполняется человеком отдельно от выкатки лендинга:

1. В сервисе `web` добавить домен `app.<домен>` и снять корневой.
2. `web`: `NEXT_PUBLIC_APP_URL` = `https://app.<домен>` → ре-деплой.
3. `api`: `CORS_ORIGIN` = `https://app.<домен>` → рестарт.
4. `landing`: `NEXT_PUBLIC_APP_URL` = `https://app.<домен>` → ре-деплой.

**Все открытые сессии разлогинятся один раз**: refresh-cookie выписана на прежний домен.
Делать в тихое время.

Публичные пути платформы (`/login`, `/r/<код>`, `/verify`, `/employer/*` и прочие из
`PUBLIC_PATHS`) продолжают работать с корневого домена — лендинг отдаёт на них 308.

---

## 4. Объектное хранилище

**Вариант А — MinIO как сервис Railway:**
1. **+ New → Docker Image** → `quay.io/minio/minio` (на Docker Hub образ больше не
   публикуется).
2. **Settings → Deploy → Custom Start Command**: `server /data --console-address ":9001"`.
3. **Variables**: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` (≥8 симв.).
4. **Settings → Volumes** — примонтировать том на `/data` (иначе файлы не переживут редеплой).
5. В `api` указать `MINIO_ENDPOINT` = приватный домен этого сервиса
   (`<minio>.railway.internal`), `MINIO_PORT=9000`, `MINIO_USE_SSL=false`,
   ключи = root-креды MinIO.
6. **Generate Domain** на minio-сервисе (порт `9000`) → публичный адрес. Задать в `api`
   `MINIO_PUBLIC_ENDPOINT=<minio>.up.railway.app` (без схемы и порта). Presigned-ссылки
   отдаются в браузер, а он не резолвит `*.railway.internal`; хост входит в подпись S3,
   поэтому ссылки генерятся отдельным клиентом сразу на публичный адрес. `MINIO_PUBLIC_PORT`
   (по умолчанию `443`) и `MINIO_PUBLIC_USE_SSL` (по умолчанию `true`) обычно не трогать.
   Без этой переменной presigned укажут на внутренний хост → в браузере `ERR_NAME_NOT_RESOLVED`.

**Вариант Б — внешний S3 (Cloudflare R2, 10 ГБ бесплатно):**
код читает эндпоинт из env (path-style, официальный `minio`-клиент), замены кода не нужно:
`MINIO_ENDPOINT=<accountid>.r2.cloudflarestorage.com`, `MINIO_PORT=443`,
`MINIO_USE_SSL=true`, ключи R2. Бакеты создать заранее (см. список в `docs/PROJECT.md §5.5`).

## 5. Миграции БД

Runner-образ минимальный и **не содержит Prisma CLI**, поэтому миграции применяются
не из контейнера, а с локальной машины против БД Railway:

```bash
# DATABASE_URL — публичный (proxy) connection string из настроек Postgres в Railway
DATABASE_URL="postgresql://...@<proxy-host>:<port>/railway" pnpm db:deploy
DATABASE_URL="postgresql://...@<proxy-host>:<port>/railway" pnpm db:seed   # первый раз
DATABASE_URL="postgresql://...@<proxy-host>:<port>/railway" pnpm db:seed:kato   # справочник КАТО
```

Повторять `db:deploy` после каждого PR, меняющего схему. (Автоматизация через
pre-deploy command возможна, но требует добавить `prisma` в prod-зависимости —
отдельная задача.)

## 6. Порядок первого запуска

1. Postgres + Redis подняты.
2. `api` собрался и задеплоился (health `/api/v1/health` станет зелёным после шага 5).
3. Прогнать миграции + seed (шаг 5).
4. `web` собрался; проверить вход `admin@studenthub.app` паролем из вывода шага 3
   (`SEED_PASSWORD` или сгенерированный) → **сразу сменить**.
5. `landing` собрался — он ни от чего не зависит и может быть выкачен раньше остальных.
   Проверить: корень отдаёт 200, `/login` и `/r/<любой код>` — 308 на домен платформы.

## 7. Частые проблемы

- **Build падает за ~3 сек, «Failed to build an image»** — не задан Dockerfile/монорепо-контекст.
  Убедиться, что Config-as-code path указывает на `apps/<service>/railway.json`.
- **api рестартится сразу после старта** — не хватает обязательной env (`JWT_*`,
  `DATABASE_URL`, `MINIO_*`); смотреть Deploy Logs — Zod печатает список отсутствующих.
- **web собрался, но ходит на localhost** — `NEXT_PUBLIC_API_URL` не был задан на момент
  сборки; задать переменную и **пересобрать**.
- **Файлы пропали после редеплоя MinIO** — не примонтирован Volume на `/data`.
