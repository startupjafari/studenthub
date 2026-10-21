# Медиа-ретранслятор камер

MediaMTX между агентами вузов и браузерами охраны и админа (`docs/PROJECT.md` §3.10).

```
агент в вузе ──RTMPS :1936 (TCP-прокси)──▶ ретранслятор ──LL-HLS (HTTPS)──▶ браузер
                    токен публикации             ▲            токен просмотра
                                                 └── JWKS API: проверяет токены сам
```

- Видео идёт только пока его смотрят: спрос отмечает API, агент отдаёт поток по нему.
- Каждое подключение — с медиатокеном API (JWT ES256 на 2 минуты для зрителя, на 10 для
  агента), права только на путь `cam/<id камеры>`. Ретранслятор проверяет токены сам по
  открытому ключу из `GET /api/v1/.well-known/media-jwks.json`.
- Ничего не записывается. RTSP, WebRTC, SRT, MoQ, API и метрики выключены. HLS отдаётся
  только origin'у веба.
- Агент закрепляет сертификат ретранслятора: поток уходит только тому, кто предъявил
  именно его.

Почему RTMPS, а не RTSPS: в RTSP клиент отдаёт учётные данные только в ответ на вызов
сервера, а MediaMTX в режиме JWT его не присылает, и ffmpeg токен так и не передаёт. В RTMP
токен идёт параметром адреса. TLS тот же, TCP-прокси Railway пропускает его как есть.

## Railway

Отдельный сервис, как `api` и `web` (`docs/RAILWAY.md` §3.3).

1. **+ New → GitHub Repo** → этот репозиторий. **Settings → Root Directory** =
   `docker/media-relay`: контекст сборки — этот каталог (корневой `.dockerignore`
   исключает `docker/`), конфиг подхватится из `railway.json` рядом.
2. **Networking**:
   - **Generate Domain** — HTTP-адрес для зрителей (`MEDIA_RELAY_HLS_URL` у API). HLS
     слушает порт из `PORT`, который назначает Railway.
   - **TCP Proxy** → внутренний порт `1936`. Railway выдаст `<хост>.proxy.rlwy.net:<порт>` —
     это адрес для агентов, `MEDIA_RELAY_PUBLISH_URL=rtmps://<хост>:<порт>` у API.
3. **Сертификат RTMPS** — самоподписанный, на имя хоста TCP-прокси:

   ```bash
   HOST=<хост>.proxy.rlwy.net
   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 1825 \
     -keyout relay.key -out relay.crt -subj "/CN=$HOST" -addext "subjectAltName=DNS:$HOST"
   # в одну строку с \n — так их принимают переменные Railway
   awk 'BEGIN{ORS="\\n"} {print}' relay.crt; echo
   awk 'BEGIN{ORS="\\n"} {print}' relay.key; echo
   ```

   Ключ `relay.key` после этого удалить с машины: он нужен только ретранслятору.

4. **Variables** ретранслятора:

   | Переменная            | Значение                                                 |
   | --------------------- | -------------------------------------------------------- |
   | `MTX_AUTHJWTJWKS`     | `https://api.<домен>/api/v1/.well-known/media-jwks.json` |
   | `MTX_HLSALLOWORIGINS` | `https://app.<домен>` — origin веба                      |
   | `RELAY_TLS_CERT`      | `relay.crt` одной строкой                                |
   | `RELAY_TLS_KEY`       | `relay.key` одной строкой                                |

5. **Variables** сервиса `api` (`apps/api/.env.example`):

   | Переменная                | Значение                                                                       |
   | ------------------------- | ------------------------------------------------------------------------------ |
   | `MEDIA_JWT_PRIVATE_KEY`   | `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256` одной строкой |
   | `MEDIA_RELAY_HLS_URL`     | `https://<домен ретранслятора>`                                                |
   | `MEDIA_RELAY_PUBLISH_URL` | `rtmps://<хост>.proxy.rlwy.net:<порт>`                                         |
   | `MEDIA_RELAY_CA_PEM`      | тот же `relay.crt` одной строкой — его закрепит агент                          |

   Без них просмотр камер выключен: «Начать просмотр» отвечает `409` (`details.field=relay`).

**Ключ подписи ретранслятор забирает один раз, при старте.** Сменили
`MEDIA_JWT_PRIVATE_KEY` у API — перезапустите ретранслятор, иначе он отвергнет новые
токены. Сменили сертификат — обновите и `RELAY_TLS_*`, и `MEDIA_RELAY_CA_PEM`: агенты
получат новый сертификат со следующим опросом.

**Трафик.** Второй поток камеры — около 0,5 Мбит/с, это примерно 230 МБ в час на каждого
зрителя (исходящий трафик ретранслятора) плюс столько же один раз на камеру от агента.

## Разработка

```bash
cd docker/media-relay
./dev-cert.sh                 # certs/ и строка MEDIA_RELAY_CA_PEM для apps/api/.env
docker compose up -d --build  # HLS — 127.0.0.1:18888, RTMPS — 172.17.0.1:11936
```

В `apps/api/.env` для стенда:

```
MEDIA_JWT_PRIVATE_KEY=<openssl genpkey … одной строкой>
MEDIA_RELAY_HLS_URL=http://localhost:18888
MEDIA_RELAY_PUBLISH_URL=rtmps://host.docker.internal:11936
MEDIA_RELAY_CA_PEM=<строка из dev-cert.sh>
```

В `apps/web/.env.local` — `NEXT_PUBLIC_MEDIA_RELAY_URL=http://localhost:18888`: без него
CSP веба не пустит плеер к ретранслятору на http (на проде он за HTTPS и проходит и так).

Агент — профиль `agent` в `docker/camera-sim`. RTMPS опубликован на адресе моста Docker
(`host.docker.internal` для контейнеров), а не на `0.0.0.0`: агенту стенда он виден,
локальной сети разработчика — нет.
