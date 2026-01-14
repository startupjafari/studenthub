#!/bin/bash

# Скрипт для тестирования Load Balancer
# Использование: ./scripts/test-loadbalancer.sh

set -e

LB_URL="http://localhost:8080"
API_URL="${LB_URL}/api"

echo "🧪 Тестирование Load Balancer"
echo "================================"
echo ""

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Функция для проверки ответа
check_response() {
    local url=$1
    local expected_status=$2
    local description=$3
    
    echo -n "Проверка: $description... "
    
    response=$(curl -s -w "\n%{http_code}" "$url" || echo -e "\n000")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "$expected_status" ]; then
        echo -e "${GREEN}✓ OK${NC} (HTTP $http_code)"
        return 0
    else
        echo -e "${RED}✗ FAILED${NC} (HTTP $http_code, ожидалось $expected_status)"
        echo "Ответ: $body"
        return 1
    fi
}

# Функция для проверки распределения нагрузки
check_load_distribution() {
    echo ""
    echo "📊 Проверка распределения нагрузки между инстансами..."
    echo ""
    
    instances=()
    for i in {1..20}; do
        response=$(curl -s "${API_URL}/health/info")
        instance_id=$(echo "$response" | grep -o '"instanceId":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
        instances+=("$instance_id")
        echo -n "."
        sleep 0.1
    done
    echo ""
    echo ""
    
    # Подсчет распределения
    echo "Распределение запросов:"
    printf '%s\n' "${instances[@]}" | sort | uniq -c | sort -rn
    echo ""
}

# 1. Проверка здоровья Nginx
echo "1️⃣ Проверка здоровья Nginx Load Balancer"
check_response "${LB_URL}/nginx-health" "200" "Nginx health check"
echo ""

# 2. Проверка health endpoints каждого инстанса
echo "2️⃣ Проверка health endpoints"
check_response "${API_URL}/health/live" "200" "Health live endpoint"
check_response "${API_URL}/health" "200" "Health check endpoint"
check_response "${API_URL}/health/ready" "200" "Health ready endpoint"
check_response "${API_URL}/health/info" "200" "Health info endpoint"
echo ""

# 3. Проверка распределения нагрузки
check_load_distribution

# 4. Проверка WebSocket (базовая)
echo "4️⃣ Проверка WebSocket endpoints"
echo "WebSocket endpoint: ${LB_URL}/socket.io/"
echo "   (Требует ручной проверки с клиента)"
echo ""

# 5. Нагрузочное тестирование
echo "5️⃣ Базовое нагрузочное тестирование"
echo "Отправка 50 запросов..."
success=0
failed=0

for i in {1..50}; do
    if curl -s -o /dev/null -w "%{http_code}" "${API_URL}/health/live" | grep -q "200"; then
        ((success++))
    else
        ((failed++))
    fi
    if [ $((i % 10)) -eq 0 ]; then
        echo "   Обработано: $i/50"
    fi
done

echo ""
echo "Результаты:"
echo "  Успешных: $success"
echo "  Неудачных: $failed"
echo ""

# 6. Проверка отказоустойчивости (симуляция)
echo "6️⃣ Информация об инстансах"
echo "Для проверки отказоустойчивости:"
echo "  1. Остановите один инстанс: docker stop studenthub_app1"
echo "  2. Проверьте, что Load Balancer продолжает работать"
echo "  3. Запустите инстанс обратно: docker start studenthub_app1"
echo ""

echo "✅ Тестирование завершено!"
echo ""
echo "📝 Полезные команды:"
echo "  - Просмотр логов Nginx: docker logs studenthub_nginx_lb"
echo "  - Просмотр логов инстанса: docker logs studenthub_app1"
echo "  - Проверка статуса: docker compose -f docker-compose.loadbalancer.yml ps"
echo ""
