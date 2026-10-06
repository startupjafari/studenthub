# StudentHub iOS

Нативное приложение StudentHub для iPhone. Бэкенд — `apps/api` из этого же
монорепо, собственного сервера у приложения нет.

План работ — док «StudentHub iOS — план реализации». Правила продукта, контракт API и
дизайн-система — в корне репозитория: `docs/PROJECT.md`, `docs/DESIGN_SYSTEM.md`,
`AGENTS.md`.

## Требования

- macOS с Xcode 16 (iOS 17 SDK);
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) — `brew install xcodegen`.

Файл `StudentHub.xcodeproj` в репозиторий **не коммитится**: он собирается из `project.yml`.
Так правки структуры читаются в диффе, а не прячутся в `.pbxproj`.

## Сборка

Все команды — из `apps/ios`. Проект к pnpm-воркспейсу не относится: `package.json`
у него нет, turbo и pnpm этот каталог не видят.

```sh
xcodegen generate
open StudentHub.xcodeproj
```

Из командной строки:

```sh
xcodebuild -scheme StudentHub -destination 'platform=iOS Simulator,name=iPhone 16' test
```

Адрес API задаётся в `Config/*.xcconfig`: в Debug — локальный `pnpm dev`, в Release —
домен прода. Ключ `API_BASE_URL` попадает в `Info.plist` и читается на старте.

## Структура

```
Sources/App            точка входа, корневая сцена, сборка зависимостей
Sources/Core           сеть и сессия: клиент API, конверт ответа, связка ключей
Sources/Features       экраны по областям продукта: вход, чаты, учёба, заявки
Sources/DesignSystem   токены и контролы: цвет, типографика, отступы, радиусы, движение, формы
Resources              ассеты и каталог строк
Config                 xcconfig по конфигурациям сборки
Tests                  модульные тесты
```

## Чего в этом репозитории не бывает

- кода, ресурсов и звуков из чужих мессенджеров — в том числе из `telegram-ios`
  (GPL-2.0, несовместима с закрытым приложением в App Store);
- захардкоженных пользовательских строк — только ключи каталога строк;
- токенов и паролей в коде и в истории.
