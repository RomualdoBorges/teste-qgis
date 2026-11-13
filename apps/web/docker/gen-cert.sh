#!/bin/sh
# Gera um certificado autoassinado (HTTP/2 nos navegadores exige HTTPS).
# Para usar um certificado real, monte-o em /etc/nginx/certs/{server.crt,server.key}.
set -e
mkdir -p /etc/nginx/certs
if [ ! -f /etc/nginx/certs/server.crt ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -keyout /etc/nginx/certs/server.key -out /etc/nginx/certs/server.crt >/dev/null 2>&1
  echo "certificado autoassinado gerado"
fi
