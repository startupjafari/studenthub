# Настройка отправки Email

Для отправки писем на реальную почту настройте один из вариантов:

## Вариант 1: Универсальный SMTP (Gmail, Mail.ru, Yandex, и т.д.)

Добавьте в `.env`:

```env
# SMTP Configuration (работает с любым SMTP сервером)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=your-email@gmail.com
```

### Примеры для разных провайдеров:

#### Gmail
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password  # Нужен App Password из Google Account
SMTP_FROM_EMAIL=your-email@gmail.com
```

**Важно для Gmail**: 
- Включите двухфакторную аутентификацию
- Создайте "App Password" в настройках Google Account
- Используйте App Password, а не обычный пароль

#### Mail.ru
```env
SMTP_HOST=smtp.mail.ru
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@mail.ru
SMTP_PASSWORD=your-password
SMTP_FROM_EMAIL=your-email@mail.ru
```

#### Yandex
```env
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@yandex.ru
SMTP_PASSWORD=your-password
SMTP_FROM_EMAIL=your-email@yandex.ru
```

#### Outlook/Hotmail
```env
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@outlook.com
SMTP_PASSWORD=your-password
SMTP_FROM_EMAIL=your-email@outlook.com
```

## Вариант 2: SendGrid

```env
SENDGRID_API_KEY=your-sendgrid-api-key
SENDGRID_FROM_EMAIL=noreply@studenthub.com
```

## Вариант 3: Режим разработки (коды в консоль)

Если ничего не настроено, коды будут выводиться в консоль:

```env
USE_CONSOLE_EMAIL_TRANSPORT=true
```

Или просто не настраивайте SMTP/SendGrid - коды будут логироваться автоматически.

## Переменные окружения

| Переменная | Описание | Пример |
|-----------|----------|--------|
| `SMTP_HOST` | SMTP сервер | `smtp.gmail.com` |
| `SMTP_PORT` | Порт SMTP | `587` или `465` |
| `SMTP_SECURE` | Использовать SSL/TLS | `true` или `false` |
| `SMTP_USER` | Email для авторизации | `your-email@gmail.com` |
| `SMTP_PASSWORD` | Пароль или App Password | `your-password` |
| `SMTP_FROM_EMAIL` | Email отправителя | `your-email@gmail.com` |
| `SENDGRID_API_KEY` | SendGrid API ключ (альтернатива SMTP) | `SG.xxx...` |
| `SENDGRID_FROM_EMAIL` | Email отправителя для SendGrid | `noreply@studenthub.com` |
| `USE_CONSOLE_EMAIL_TRANSPORT` | Только консольный вывод | `true` |
| `EMAIL_FAIL_SILENTLY` | Не бросать ошибки при ошибке отправки | `true` |

## Приоритет конфигурации

1. **SMTP настройки** (SMTP_HOST, SMTP_USER, SMTP_PASSWORD) - самый приоритетный
2. **SendGrid** (SENDGRID_API_KEY) - если SMTP не настроен
3. **Консольный вывод** - если ничего не настроено

## Пример полной конфигурации для Gmail

```env
# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=studenthub@gmail.com
SMTP_PASSWORD=xxxx xxxx xxxx xxxx
SMTP_FROM_EMAIL=studenthub@gmail.com

# Опционально: если ошибка отправки - логировать, но не прерывать работу
EMAIL_FAIL_SILENTLY=true
```

## Проверка работы

После настройки:

1. Перезапустите приложение
2. Зарегистрируйте нового пользователя
3. Проверьте логи - должно быть: `✅ Письмо с кодом подтверждения отправлено на ...`
4. Проверьте почту - письмо должно прийти

## Отладка

Если письма не приходят:

1. Проверьте логи на наличие ошибок
2. Убедитесь, что порты не заблокированы файрволом
3. Для Gmail - используйте App Password, не обычный пароль
4. Проверьте настройки безопасности почтового аккаунта
5. Включите `EMAIL_FAIL_SILENTLY=true` чтобы видеть коды в консоли даже при ошибках

