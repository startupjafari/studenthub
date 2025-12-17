# StudentHub Frontend

PWA приложение на Next.js для образовательной платформы StudentHub.

## Технологии

- **Next.js 14** - React фреймворк с App Router
- **TypeScript** - Типизация
- **Redux Toolkit** - Управление состоянием
- **React Hook Form** - Работа с формами
- **Zod** - Валидация форм
- **Tailwind CSS** - Стилизация
- **PWA** - Прогрессивное веб-приложение

## Установка

```bash
npm install
```

## Настройка

1. Создайте файл `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

2. Добавьте иконки для PWA в папку `public/`:
   - `icon-192x192.png` - иконка 192x192px
   - `icon-512x512.png` - иконка 512x512px
   - `favicon.ico` - фавикон

Или используйте онлайн генератор: https://realfavicongenerator.net/

## Запуск

### Разработка

```bash
npm run dev
```

Приложение будет доступно по адресу [http://localhost:3000](http://localhost:3000)

### Production

```bash
npm run build
npm start
```

## Структура проекта

```
studenthub-frontend/
├── app/                    # Next.js App Router
│   ├── login/             # Страница входа
│   ├── register/           # Страница регистрации
│   ├── verify-email/       # Страница верификации email
│   ├── layout.tsx          # Корневой layout
│   └── page.tsx            # Главная страница
├── store/                  # Redux store
│   ├── slices/            # Redux slices
│   └── store.ts           # Конфигурация store
├── lib/                    # Утилиты и API
│   └── api/               # API клиенты
├── types/                  # TypeScript типы
└── public/                 # Статические файлы
    └── manifest.json       # PWA manifest
```

## Функционал

### Авторизация
- ✅ Регистрация пользователя
- ✅ Вход в систему
- ✅ Верификация email
- ✅ Двухфакторная аутентификация (2FA)
- ✅ Автоматическое обновление токенов
- ✅ Сохранение сессии

### PWA
- ✅ Service Worker
- ✅ Manifest для установки
- ✅ Офлайн поддержка
- ✅ Адаптивный дизайн

## API Endpoints

Приложение использует следующие endpoints:

- `POST /api/auth/register` - Регистрация
- `POST /api/auth/login` - Вход
- `POST /api/auth/verify-email` - Верификация email
- `POST /api/auth/refresh` - Обновление токена
- `POST /api/auth/resend-verification` - Повторная отправка кода

## Лицензия

MIT

