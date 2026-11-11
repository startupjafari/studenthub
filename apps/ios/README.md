# StudentHub iOS

Нативное приложение StudentHub для iPhone. Бэкенд — `apps/api` из этого же
монорепо, собственного сервера у приложения нет.

План работ — док «StudentHub iOS — план реализации». Правила продукта, контракт API и
дизайн-система — в корне репозитория: `docs/PROJECT.md`, `docs/DESIGN_SYSTEM.md`,
`AGENTS.md`.

## Требования

- macOS с Xcode 16 (iOS 17 SDK); минимальная версия системы — iOS 17, только iPhone;
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) — `brew install xcodegen`.

Внешние зависимости — Swift-пакеты из `project.yml`: GRDB (локальная база), Socket.IO
(реальное время), Sentry (трекер ошибок). Xcode скачивает их сам при первой сборке.

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
xcodebuild -project StudentHub.xcodeproj -scheme StudentHub -destination 'platform=iOS Simulator,name=iPhone 16' test
```

`-project` обязателен: рядом лежит `Package.swift` для сборки без Mac (следующий раздел),
и без флага `xcodebuild` может взять его вместо проекта.

Адрес API задаётся в `Config/*.xcconfig`: в Debug — локальный `pnpm dev`
(`http://localhost:3001/api/v1`), в Release — домен прода (пока заглушка
`api.example.invalid`, подставить до первой сборки для TestFlight). Ключ `API_BASE_URL`
попадает в `Info.plist` как `SHAPIBaseURL` и читается на старте. Так же приходит
`SENTRY_DSN` (`SHSentryDSN`): пусто — трекер не инициализируется.

CI: `.github/workflows/ios.yml` — сборка и тесты на симуляторе; `ios-release.yml` —
архив и загрузка в TestFlight вручную. Выпуск — `docs/RELEASE_IOS.md`.

## Сборка на iPhone без Mac

Из Linux или Windows (WSL) приложение собирается [xtool](https://xtool.sh) и ставится на
телефон по кабелю. Манифест — `Package.swift` и `xtool.yml` рядом с `project.yml`; на
сборку Xcode они не влияют. Бесплатного Apple ID достаточно. Симулятора, превью и
выпуска в TestFlight здесь нет — для них по-прежнему Mac или CI.

### Один раз: окружение

1. Swift 6.4 — через swiftly по инструкции https://swift.org/install/linux. Команду
   `apt-get install` из вывода `swiftly init` не пропускать: без неё `swift` падает на
   `libncurses.so.6`. swiftly прописывает себя только в `~/.profile`, который терминал
   VS Code не читает, — добавить `. "$HOME/.local/share/swiftly/env.sh"` в `~/.bashrc`.
2. `sudo apt-get install usbmuxd libimobiledevice-utils libfuse2t64` — связь с телефоном
   и запуск AppImage на Ubuntu 24.04.
3. Xcode.xip той версии, что указана в
   [установке xtool](https://xtool.sh/documentation/xtooldocs/installation-linux), — из
   браузера, https://developer.apple.com/download/all/?q=Xcode. Положить в `~/Downloads`
   внутри Linux, не на `/mnt/c`.
4. xtool — AppImage в `/usr/local/bin/xtool` по той же инструкции, затем `xtool setup`:
   вход `Password` для бесплатного Apple ID (`API Key` — для платного), путь к xip.
   Проверка: `swift sdk list` показывает `darwin`.
5. Только WSL: связь с телефоном через Windows. Проброс USB через usbipd не годится —
   xtool зависает на шаге `[Connecting]`
   ([xtool#19](https://github.com/xtool-org/xtool/issues/19)). Вместо него:
   - из Microsoft Store поставить «Устройства Apple» (Apple Devices), открыть, подключить
     iPhone кабелем, на телефоне «Доверять»;
   - пробросить порт службы Apple в WSL. Адрес Windows со стороны WSL —
     `ip route list default` в Ubuntu (ниже `172.25.128.1`); PowerShell от администратора:

     ```powershell
     netsh interface portproxy add v4tov4 listenaddress=172.25.128.1 listenport=27015 connectaddress=127.0.0.1 connectport=27015
     New-NetFirewallRule -DisplayName "WSL usbmuxd" -Direction Inbound -InterfaceAlias "vEthernet (WSL)" -Protocol TCP -LocalPort 27015 -Action Allow
     ```

   - проверка в Ubuntu: `USBMUXD_SOCKET_ADDRESS=172.25.128.1:27015 ideviceinfo -k DeviceName`.
     `scripts/device.sh` находит службу сам. Адрес может смениться после перезагрузки
     Windows — тогда пересоздать проброс с новым.

### Один раз: сеть до `pnpm dev`

Телефон ходит на API компьютера по Wi-Fi, а не на `localhost` из `Debug.xcconfig`.
`scripts/device.sh` сам подставляет в сборку адрес компьютера в локальной сети. API уже
слушает все интерфейсы (`apps/api/src/main.ts`), но в WSL с сетью NAT до Linux снаружи
не достучаться — нужен проброс портов в Windows. PowerShell от администратора:

```powershell
netsh interface portproxy add v4tov6 listenaddress=0.0.0.0 listenport=3001 connectaddress=::1 connectport=3001
netsh interface portproxy add v4tov6 listenaddress=0.0.0.0 listenport=9000 connectaddress=::1 connectport=9000
New-NetFirewallRule -DisplayName "StudentHub dev" -Direction Inbound -Protocol TCP -LocalPort 3001,9000 -Action Allow -Profile Private
```

Оба порта — на `::1`, а не на `127.0.0.1`. WSL отдаёт свои порты в Windows только на
`[::1]`, а `0.0.0.0` занимает сам проброс: проброс на `127.0.0.1` попадает обратно в
себя, и запрос висит до таймаута. С MinIO это проявляется не сразу: пока WSL после
запуска успевает занять `127.0.0.1:9000` раньше службы проброса, картинки грузятся, а
после перезагрузки Windows перестают.

Сеть Wi-Fi в Windows должна быть «Частной», телефон — в той же сети.

9000 — MinIO. Ссылки на файлы сервер подписывает на один адрес, а ходят по ним и телефон,
и браузер на компьютере. Голый IP (`192.168.0.19`) телефону подходит, а браузеру — нет:
прямая загрузка из веба на него обрывается. Поэтому адрес — имя
[nip.io](https://nip.io), которое каждый разрешает по-своему, а подпись (она привязана к
имени) остаётся верной для обоих:

- `apps/api/.env`: `MINIO_PUBLIC_ENDPOINT=<адрес компьютера>.nip.io`,
  `MINIO_PUBLIC_PORT=9000`, `MINIO_PUBLIC_USE_SSL=false`, затем перезапуск API. Телефон
  разрешает имя через обычный DNS в адрес компьютера;
- компьютер — через `hosts` в себя же, тем путём, что работал с `localhost`. PowerShell от
  администратора:

  ```powershell
  Add-Content -Path "$env:windir\System32\drivers\etc\hosts" -Value "127.0.0.1 192.168.0.19.nip.io"
  ```

- WSL — тоже через `hosts`. Подписывая первую ссылку, API спрашивает у MinIO регион по
  публичному адресу, а до адреса Windows в сети из WSL не достучаться (брандмауэр): без
  записи каждая лента ждала бы таймаут. WSL перечитывает `hosts` Windows только при
  запуске, поэтому до перезапуска WSL — вручную:

  ```sh
  sudo sh -c 'echo "127.0.0.1 192.168.0.19.nip.io" >> /etc/hosts'
  ```

Сменился адрес компьютера в сети (после перезагрузки роутер может выдать другой) —
поменять его во всех трёх местах и перезапустить API. Аватары, обложки профилей и статей
хранят адрес целиком, с хостом, — их перезаписать в базе, подставив старый и новый адрес:

```sql
UPDATE users SET
  avatar_url = replace(avatar_url, 'http://<старый>:9000/', 'http://<новый>:9000/'),
  avatar_thumb_url = replace(avatar_thumb_url, 'http://<старый>:9000/', 'http://<новый>:9000/'),
  cover_url = replace(cover_url, 'http://<старый>:9000/', 'http://<новый>:9000/')
WHERE avatar_url LIKE 'http://<старый>:9000/%' OR cover_url LIKE 'http://<старый>:9000/%';
UPDATE profile_articles SET cover_url = replace(cover_url, 'http://<старый>:9000/', 'http://<новый>:9000/')
WHERE cover_url LIKE 'http://<старый>:9000/%';
```

Чтобы этого не делать, закрепить за компьютером адрес в роутере (резервирование DHCP).

Убрать проброс: `netsh interface portproxy reset`.

### Каждый раз

```sh
pnpm dev                      # из корня репозитория
cd apps/ios && ./scripts/device.sh
```

Скрипт пересобирает `.device/` (Info.plist с адресом API, таблицы строк из каталога) и
запускает `xtool dev`. Другой сервер — `API_BASE_URL=https://.../api/v1 ./scripts/device.sh`.
Для подсказок в VS Code (расширение Swift, окно WSL) достаточно один раз выполнить
`./scripts/device.sh --prepare-only` и открыть `apps/ios`.

Первый запуск на телефоне:

- «Доверять этому компьютеру» — «Доверять». Если xtool после этого упал, запустить ещё раз;
- ошибка про режим разработчика — «Настройки → Конфиденциальность и безопасность →
  Режим разработчика», перезагрузка, снова `./scripts/device.sh`;
- «Ненадёжный разработчик» — «Настройки → Основные → VPN и управление устройством →
  ваш Apple ID → Доверять»;
- «Разрешить доступ к локальной сети» — «Разрешить», иначе запросы к API не дойдут.

### Чем отладочная копия отличается от сборки Xcode

| | Почему |
|---|---|
| bundle ID `kz.studenthub.app.dev` | основной принадлежит команде выпуска; копия встаёт рядом со сборкой из TestFlight |
| нет пушей | личный Apple ID не подписывает право `aps-environment` — нужна платная подписка |
| нет Sentry | DSN в отладке пуст, трекер и так молчит; пакет не подключён |
| системный цвет экрана запуска | каталог ассетов компилирует только Xcode (картинок иконки в нём пока нет и для Xcode) |
| разрешён http | сервер разработки в локальной сети без TLS |
| приложение живёт 7 дней | ограничение бесплатного Apple ID: потом `./scripts/device.sh` ещё раз |

Модульные тесты (`Tests/`) так не запускаются — их гоняет CI на симуляторе.

## Роли

Приложение — для студента, старосты и преподавателя. Остальные роли после входа видят
экран «Эта роль работает в браузере»: их разделы живут в вебе.

Оболочка — пять вкладок: «Главная», «Расписание», «Чаты», «Учёба», «Ещё». Состав
вкладок у всех трёх ролей одинаков, роль меняет наполнение: в «Ещё» у старосты добавляются
одногруппники, у преподавателя — дисциплины и группы, у студента и старосты — библиотека,
если вуз включил модуль.

## Структура

```
Sources/App            точка входа, корневая сцена, оболочка с вкладками, сборка зависимостей
Sources/Core           сеть и сессия (клиент API, конверт ответа, связка ключей), база GRDB,
                       чаты, реальное время, пуши, навигация и диплинки, учёба, лента,
                       заявки, библиотека, проверка версии, трекер ошибок
Sources/Features       экраны по областям продукта: вход (QR, 2FA, согласие на ПДн), главная
                       и лента, расписание, чаты, учёба, заявки и документы, библиотека,
                       «Ещё», принудительное обновление
Sources/DesignSystem   токены и контролы: цвет, типографика, отступы, радиусы, движение, формы
Resources              ассеты, каталог строк (ru, kk), манифест приватности
Config                 xcconfig по конфигурациям сборки, параметры экспорта в TestFlight
Tests                  модульные тесты
```

## Чего в этом репозитории не бывает

- кода, ресурсов и звуков из чужих мессенджеров — в том числе из `telegram-ios`
  (GPL-2.0, несовместима с закрытым приложением в App Store);
- захардкоженных пользовательских строк — только ключи каталога строк;
- токенов и паролей в коде и в истории.
