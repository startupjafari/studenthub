FROM nginx:alpine

# Копируем конфигурацию
COPY nginx.conf /etc/nginx/nginx.conf

# Создаем директорию для логов
RUN mkdir -p /var/log/nginx

# Expose порт
EXPOSE 80 443

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/nginx-health || exit 1

CMD ["nginx", "-g", "daemon off;"]
