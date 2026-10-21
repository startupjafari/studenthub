#!/bin/sh
# Самоподписанный сертификат RTMPS для стенда: certs/server.{crt,key}. В имени —
# host.docker.internal (так до ретранслятора ходит агент из docker/camera-sim) и localhost.
# Печатает строку для MEDIA_RELAY_CA_PEM в apps/api/.env.
set -eu
cd "$(dirname "$0")"
mkdir -p certs
docker run --rm -v "$PWD/certs:/out" alpine:3.22 sh -c '
  apk add -q openssl >/dev/null &&
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout /out/server.key -out /out/server.crt -days 365 -subj "/CN=studenthub-media-relay" \
    -addext "subjectAltName=DNS:host.docker.internal,DNS:localhost,DNS:relay" 2>/dev/null &&
  chmod 644 /out/server.key /out/server.crt'
# printf, а не echo: echo в /bin/sh (dash) сам превращает `\n` в переводы строк, и
# сертификат в .env разрывался на несколько строк. Кавычки — чтобы файл одинаково читали
# и dotenv в API, и `set -a && . apps/api/.env` в shell (в PEM есть пробелы).
printf "MEDIA_RELAY_CA_PEM='%s'\n" "$(awk 'BEGIN{ORS="\\n"} {print}' certs/server.crt)"
