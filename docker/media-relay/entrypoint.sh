#!/bin/sh
# Запуск ретранслятора: сертификат RTMPS — из переменных (на Railway файлов нет) либо из
# смонтированного /certs (стенд). Порт HLS — из PORT, который назначает Railway.
set -eu

mkdir -p /certs
if [ -n "${RELAY_TLS_CERT:-}" ] && [ -n "${RELAY_TLS_KEY:-}" ]; then
  # PEM в переменной — с экранированными переводами строк, как MEDIA_* у API.
  printf '%b\n' "$RELAY_TLS_CERT" > /certs/server.crt
  printf '%b\n' "$RELAY_TLS_KEY" > /certs/server.key
  chmod 600 /certs/server.key
fi
if [ ! -s /certs/server.crt ] || [ ! -s /certs/server.key ]; then
  echo "Нет сертификата RTMPS: задайте RELAY_TLS_CERT и RELAY_TLS_KEY или смонтируйте /certs" >&2
  exit 1
fi
if [ -z "${MTX_AUTHJWTJWKS:-}" ]; then
  echo "Не задан MTX_AUTHJWTJWKS — адрес JWKS API (…/api/v1/.well-known/media-jwks.json)" >&2
  exit 1
fi
# Без origin веба в mediamtx.yml остаётся localhost:3000, и браузер на проде молча режет
# ответы HLS по CORS — плеер просто не грузит видео. Не роняем: для локального запуска
# значение из mediamtx.yml подходит.
if [ -z "${MTX_HLSALLOWORIGINS:-}" ]; then
  echo "Внимание: не задан MTX_HLSALLOWORIGINS — HLS отдаётся только http://localhost:3000; на проде задайте origin веба" >&2
fi
export MTX_HLSADDRESS=":${PORT:-8888}"

exec /usr/local/bin/mediamtx /etc/mediamtx.yml
