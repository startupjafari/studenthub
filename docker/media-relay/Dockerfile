# Медиа-ретранслятор камер StudentHub (README.md рядом): MediaMTX + наш конфиг.
# Бинарник берётся из официального образа (там scratch без оболочки), а оболочка нужна
# entrypoint.sh, чтобы разложить сертификат из переменных Railway.
FROM bluenviron/mediamtx:1.21.2 AS mediamtx

FROM alpine:3.22
COPY --from=mediamtx /mediamtx /usr/local/bin/mediamtx
COPY mediamtx.yml /etc/mediamtx.yml
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN adduser -D -H relay && mkdir -p /certs && chown relay /certs
USER relay
# 1936 — RTMPS для агентов (TCP-прокси), PORT — HLS для браузеров (HTTP-домен Railway).
EXPOSE 1936 8888
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
