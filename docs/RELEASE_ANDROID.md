# Выпуск приложения для Android

Как довести `apps/android` до Google Play. План работ — док «StudentHub Android — план
реализации»; здесь только то, что нужно сделать для выпуска.

## Что уже готово в репозитории

- Сборка `bundleRelease` с R8 и подписью ключом загрузки из окружения (`apps/android/README.md`).
- Workflow `Android release` (`.github/workflows/android-release.yml`): по кнопке собирает
  подписанный AAB и кладёт его артефактом. В Play он не публикует — см. «Первая загрузка».
- Резервные копии выключены целиком (`allowBackup=false`, `data_extraction_rules.xml`):
  кэш переписки и сессия не уходят в Google Drive.
- Пуши FCM, трекер ошибок Sentry, минимальная версия на сервере — подключаются
  параметрами сборки и переменными сервера, без правок кода.

## Что обязан сделать человек

1. **Аккаунт разработчика — организации, а не частного лица.** У частного аккаунта
   Google требует закрытое тестирование с 12 тестировщиками 14 дней подряд, прежде чем
   откроет публикацию. Аккаунту организации нужен номер D-U-N-S — его оформление
   занимает недели, начинать стоит сразу.
2. **Приложение в Play Console** с пакетом `kz.studenthub.app`, включённый Play App
   Signing (ключ подписи хранит Google, у нас — только ключ загрузки).
3. **Ключ загрузки:**
   ```sh
   keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
   ```
   Файл и пароли — в менеджер паролей, в репозиторий никогда.
4. **Секреты и переменные GitHub** (Settings → Secrets and variables → Actions):

   | Имя | Где | Что |
   |---|---|---|
   | `ANDROID_KEYSTORE_BASE64` | secret | `base64 -w0 upload.jks` |
   | `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | secret | от ключа загрузки |
   | `ANDROID_API_BASE_URL` | variable | `https://<домен API>/api/v1` |
   | `ANDROID_SENTRY_DSN` | secret | DSN проекта Sentry; пусто — трекер выключен |
   | `FIREBASE_PROJECT_ID`, `FIREBASE_ANDROID_APP_ID`, `FIREBASE_SENDER_ID` | variable | Firebase → Project settings → Android-приложение |
   | `FIREBASE_ANDROID_API_KEY` | secret | там же |

5. **Сервер:** переменные `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` (JSON
   сервисного аккаунта Firebase), `ANDROID_MIN_SUPPORTED_VERSION`, `ANDROID_STORE_URL`;
   миграция `20261015130000_add_android_device_platform` применена на Railway.

## Первая загрузка

Первый AAB Google принимает только руками: запустить `Android release` с номером сборки
(начиная с `1`), скачать артефакт и загрузить его во внутреннее тестирование Play
Console. Следующие сборки — тем же путём, номер каждый раз больше предыдущего.

## Data safety

Ответы формы — по `docs/PERSONAL_DATA.md`. Что передаётся с телефона:

| Данные | Куда | Зачем |
|---|---|---|
| Имя, почта, учебные данные, сообщения, файлы | Сервер StudentHub | Работа платформы |
| Токен устройства | Firebase Cloud Messaging | Доставка пушей |
| Отчёты о падениях (только id пользователя) | Sentry | Стабильность |

Данные шифруются при передаче (HTTPS). Удаление аккаунта — через вуз; если Play
потребует ссылку на удаление, её нужно согласовать до подачи.

## Доступ для проверки (App access)

Платформа закрытая, без аккаунта ревьюер увидит только вход. В разделе App access
указать демо-аккаунт студента с заполненным расписанием, чатами и оценками — тот же,
что для ревью Apple (`docs/RELEASE_IOS.md`).

## App Links (Задача АБ3)

Чтобы ссылки `https://<домен веба>/…` открывались сразу в приложении, нужны:

1. Отпечаток ключа подписи из Play Console (App integrity → App signing → SHA-256).
2. Файл `apps/web/public/.well-known/assetlinks.json`:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "kz.studenthub.app",
       "sha256_cert_fingerprints": ["<SHA-256 из Play Console>"]
     }
   }]
   ```
   Отдаётся без авторизации и без редиректа.
3. В манифесте приложения — `intent-filter` с `android:autoVerify="true"` на домен веба.

До этого работают ссылки `studenthub://` и пуши; ссылки на веб открываются в браузере.
