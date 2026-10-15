# StudentHub Android

Нативное приложение StudentHub для Android на Kotlin, Jetpack Compose и Material 3.
Бэкенд — `apps/api` из этого же монорепо, собственного сервера у приложения нет.

План работ — док «StudentHub Android — план реализации». Правила продукта, контракт API и
дизайн-система — в корне репозитория: `docs/PROJECT.md`, `docs/DESIGN_SYSTEM.md`,
`AGENTS.md`. Решения повторяют iOS-клиент (`apps/ios`) — при сомнении смотреть туда.

## Требования

- JDK 17;
- Android SDK с платформой 37 — проще всего через Android Studio;
- Gradle ставить не нужно: его скачивает `./gradlew` нужной версии.

На Windows с WSL2 Android Studio и эмулятор ставятся **в Windows**: эмулятору нужна
аппаратная виртуализация, внутри WSL её нет. Проект открывается по пути
`\\wsl$\...\apps\android`.

## Сборка

Все команды — из `apps/android`. Проект к pnpm-воркспейсу не относится: `package.json`
у него нет, turbo и pnpm этот каталог не видят.

```sh
./gradlew assembleDebug        # отладочный APK
./gradlew testDebugUnitTest    # unit-тесты
./gradlew lintDebug            # Android lint
```

Отладочная сборка ставится рядом с релизной: у неё `applicationId` с суффиксом `.debug`.

## Адрес API

| Сборка  | Откуда адрес                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| debug   | `http://10.0.2.2:3001/api/v1` — `pnpm dev` на машине разработчика, как его видит эмулятор                         |
| release | заглушка `api.example.invalid` в `app/build.gradle.kts` — заменить доменом прода до первой сборки для Google Play |

Для телефона вместо эмулятора адрес переопределяется в `~/.gradle/gradle.properties`:

```properties
studenthub.apiBaseUrl=http://192.168.1.10:3001/api/v1
```

Открытый HTTP разрешён только отладочной сборке и только к адресам из
`app/src/debug/res/xml/network_security_config.xml` — адрес телефона в сети добавляется туда же.

## Подпись релиза

Ключ загрузки для Google Play в репозиторий не попадает. Релизная сборка подписывается,
когда в окружении задан `ANDROID_KEYSTORE_PATH`; три остальные переменные тогда обязательны:

```
ANDROID_KEYSTORE_PATH   путь к .jks
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

Без них `./gradlew bundleRelease` собирает неподписанный AAB. Подпись для магазина ставит
Play App Signing: у нас хранится только ключ загрузки.

## Структура

```
app/                      точка входа, манифест, ресурсы
gradle/libs.versions.toml версии всех плагинов и библиотек
```

Модули `:core:*` и `:feature:*` появляются вместе с задачами, которым они нужны: пустые
модули «на вырост» не заводим.

## Чего в этом репозитории не бывает

- кода, ресурсов и звуков из чужих мессенджеров — в том числе из Telegram-Android
  (GPL-2.0, несовместима с закрытым приложением в Google Play);
- захардкоженных пользовательских строк — только ресурсы `strings.xml`;
- ключей подписи, токенов и паролей в коде и в истории.
