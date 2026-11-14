# Правила iOS-разработки StudentHub (по образцу Telegram-iOS)

## §0. Как читать этот документ

**Что это.** Все правила из репозитория Telegram-iOS — корневые `AGENTS.md` и `CLAUDE.md`, 40 `CLAUDE.md`
подсистем и документы `docs/` — переложены на iOS-клиент StudentHub (`apps/ios`) и наш стек: Swift 6.4 в режиме
языка Swift 5, SwiftUI + UIKit, iOS 17+ (iOS 26 через `#available`), SwiftPM + `xtool` из Linux, XcodeGen и
`xcodebuild` на CI, GRDB, Socket.IO, свой сервер на NestJS. Первоисточник — репозиторий
[TelegramMessenger/Telegram-iOS](https://github.com/TelegramMessenger/Telegram-iOS), ветка `master` на 14.11.2026;
пути в строках «Источник» указаны от его корня. В наш репозиторий он не копируется (лицензия GPL v2, а вложенные
`CLAUDE.md` подхватывались бы агентами); для чтения его можно скачать локально в `telegram-ios-rules/`.

**Статус: черновик на чтение владельцу.** Документ не утверждён и не подключён в `AGENTS.md`. Пока владелец не
решит иначе, правила здесь — рекомендации. Если правило расходится с `AGENTS.md`, `apps/ios/README.md` или
решениями владельца, побеждают они. Такие места помечены «согласовать с AGENTS.md».

**Лицензия.** Исходники Telegram-iOS распространяются под GPL v2. Переносим только идеи и правила, код и скрипты
Telegram не копируем (в том числе `tools/animation_sheet.py`).

**Цифры.** 8 агентов прочитали все 90 файлов целиком и выписали 1139 записей. После склейки повторов
(одно правило часто встречается в нескольких файлах Telegram) осталось 958 правил в 15 разделах. Сверка с нашим
кодом нашла 150 мест, где код расходится с правилом: они перечислены в приложении А.

**Откуда «Сейчас у нас».** Это выводы из чтения кода ветки `develop` (коммит `1f595d20`, 14.11.2026; статусы обновлены
после #499). На iPhone они не воспроизводились, тесты под них не писались. Пометка «проверить на iPhone» значит, что по
коду судить нельзя.

**Формат правила.**

- **Правило** — что делать у нас, в повелительной форме.
- **Почему** — обоснование или измерение, на котором Telegram построил правило.
- **Сейчас у нас** — соблюдено, расходится (с файлом и строкой) или «проверить на iPhone». Строки нет, если
  сверка ничего не дала.
- **Применимость** — есть только у правил, которые переносятся не полностью.
- *Источник* — откуда правило взято в репозитории Telegram-iOS.

Номера правил сквозные: раздел.подтема.правило, например 9.3.2.

### Словарь: понятия Telegram и наши

| Telegram-iOS | StudentHub iOS |
|---|---|
| Bazel, `Make.py build`, `Make.py test` | `xtool dev build` из Linux (только debug); `scripts/test.sh` + `xcodebuild` на CI (`.github/workflows/ios*.yml`) |
| Симулятор, XcodeBuildMCP, `simctl io recordVideo` | Симулятора нет: iPhone по USB (`scripts/device.sh`), запись экрана с телефона, разбор кадров через `ffprobe`/`ffmpeg` |
| Postbox (локальная БД — источник правды экранов) | `AppDatabase` (GRDB, `DatabasePool`, WAL), `Core/Storage/*` |
| pts / getDifference (позиция и догон) | `ChatRecord.lastSeq` / `GET /chats/:id/updates?since=&sinceTs=` |
| `differenceTooLong` | `ChatUpdatesDTO.overflow` → `MessageStore.clearHistory` + `loadLatest` |
| Апдейты MTProto (`Api.Updates`) | события Socket.IO → `RealtimeCoordinator.handle` |
| history fill / chat-list fill | страница истории `MessageStore.save(messages:)` / страница списка `ChatStore.save(chats:)` |
| Notification extension | тихий пуш в самом приложении (`didReceiveRemoteNotification`); расширений у нас нет |
| Сессия MTProto, ключ авторизации | access/refresh-токены, `Core/Session/*`, связка ключей (`Core/Security/*`) |
| CoreList, `ListView`, `ChatHistoryListNode` | лента чата `MessageListView` (`UICollectionView`, не перевёрнута), `MessageStackLayout`, `MessageTimeline`; списки — SwiftUI `List` |
| `ASDisplayNode`, `asyncLayout` | `UIView` / SwiftUI, `UIHostingConfiguration` в ячейках ленты |
| RichTextEditor, `ChatInputContent` | поле ввода `ComposerTextView` (`UITextView`), текст — markdown-строка |
| InstantPage V2, рендер rich-text | `RichText` (`Features/Feed/FeedComponents.swift`), `MessageCodeBlocks`, статьи в `Features/Feed` |
| MediaGrid, MediaPickerUI | `RecentMediaGrid` / `PhotoAssets` (лист вложений), `ChatSharedContentView`, `ChatMediaGallery` |
| HLSPlayback (свой плеер) | `AVPlayer` с HLS-вариантом от сервера |
| Виджеты-сообщения (QuickJS/LiteHTML) | карточки сообщений: опросы, чек-листы, геопозиция, пересланные посты; превью ссылок |
| tgcalls, WebRTC | звонков нет |
| `TelegramEngine` facade | слой `Core/*` (API, Store, Realtime) между сетью/БД и `Features/*` |

### Оглавление

- §1. Сборка и окружение
- §2. Тесты
- §3. Визуальная проверка и анимации
- §4. Компилятор, Swift, оптимизация
- §5. UIKit и SwiftUI: окна, касания, клавиатура, раскладка, жесты
- §6. Списки и лента чата
- §7. Поле ввода и текст
- §8. Медиа
- §9. Данные, синхронизация, сеть, realtime
- §10. Безопасность, приватность, вход и выход, ссылки
- §11. Доступность
- §12. Раскладка под устройства и безопасные зоны
- §13. Производительность
- §14. CI, зависимости, внешние загрузки
- §15. Документация, процесс, работа агентов
- Приложение А. Расхождения кода с правилами
- Приложение Б. Неприменимое целиком
- Приложение В. Покрытие первоисточника

---

## §1. Сборка и окружение

У iOS-клиента две сборки из одних исходников: `Package.swift` + `xtool.yml` (локально из Linux, `xtool dev`)
и `project.yml` (XcodeGen, Xcode на macOS-раннерах CI). Главная мысль раздела: «собралось» доказывает
только сборка под iOS в обеих конфигурациях, а «исправлено на телефоне» — только заведомо свежая установка.

### 1.1 Две системы сборки и манифесты

#### 1.1.1 Обе сборки обязаны компилироваться
**Правило.** Любая правка должна собираться и в `Package.swift` (xtool, без Sentry), и в `project.yml` (Xcode,
с Sentry). Код под условием (`#if canImport(Sentry)` в `Core/Observability/Observability.swift`, `#if DEBUG`)
проверяй в обеих сборках: локально `xtool dev build`, на CI — проверка «iOS — итог» (`ios.yml`, `scripts/test.sh build`).
**Почему.** У Telegram пакет собирается и SwiftPM, и Bazel. Однажды ветка `//conditions:default` условной
конфигурации молча отдала Linux флаги macOS: ошибка проявилась только в одной из сборок.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Build and test»: «Both build systems must compile»); `submodules/TgVoipWebrtc/CLAUDE.md` («macOS Build Support» / «Linux Build Support»); `CLAUDE.md` («Subsystem guides», Framework export lists); `Telegram/CLAUDE.md` («Framework export lists»)*

#### 1.1.2 Новый ключ, разрешение, ресурс или зависимость — во все манифесты
**Правило.** Новый ключ Info.plist (`NS…UsageDescription`, `SH…`), URL-схему, ресурс или зависимость добавляй
во все места, где они описаны: `project.yml` (Info.plist для Xcode), `Package.swift` + `xtool.yml`,
`scripts/device_bundle.py` (генерирует Info.plist для сборки на iPhone). Исключение по решению владельца —
Sentry только в `project.yml`. Проверяй обе сборки: забытое место ломает только одну из них.
**Почему.** У Telegram забытый в списках клиент или вложенный фреймворк ломает линковку только релизной
сборки, и это видно на линковке, а не в рантайме.
*Источник: `Telegram/CLAUDE.md` («Framework export lists»: новый клиент — в `clients`, новый фреймворк — в `provided_by_frameworks`); `CLAUDE.md` («Subsystem guides»)*

#### 1.1.3 `Bundle.module` не использовать
**Правило.** Ресурсы загружай через `Bundle.main` и каталоги из `Resources/`. `Bundle.module` не используй: в
сборке Xcode его нет. Сейчас в `Sources` его нет — так и держать.
**Почему.** У Telegram `Bundle.module` существует только в SwiftPM, поэтому загрузку ресурсов приходится
разводить через `#if SWIFT_PACKAGE` и держать обе ветки в синхроне.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Build and test»)*

#### 1.1.4 Файл вне глоба одной из сборок молча из неё выпадает
**Правило.** Исходники клади только под `Sources/`: его глобят и `Package.swift`, и `project.yml`. Ресурсы лежат в
`Resources/` (Xcode) и в `.device/` (их готовит `scripts/device.sh`). Новый каталог ресурсов или исключение
(`excludes` в `project.yml`) добавляй в оба пути.
**Почему.** У Telegram файл `.m`/`.h`, положенный не в тот каталог, компилировался SwiftPM, но молча пропадал
из Bazel.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextInputDecObjC/CLAUDE.md` («Layout and build»)*

#### 1.1.5 Проект Xcode генерируется: правится `project.yml`
**Правило.** `StudentHub.xcodeproj` не коммитится (`apps/ios/.gitignore`: `*.xcodeproj/`). Файлы, таргеты,
ресурсы и настройки сборки правь в `project.yml`. Всё, что меняет состав исходников или зависимостей, правь
в обоих манифестах (см. 1.1.2).
**Почему.** У Telegram `.xcodeproj` тоже генерируется XcodeGen, поэтому ручная правка проекта теряется при
следующей генерации.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` (вступление)*

#### 1.1.6 `.gitignore` пишется с учётом нечувствительной к регистру ФС
**Правило.** CI собирает на macOS, где регистр в именах не различается, а локальная сборка идёт в Linux, где
различается. Каталоги в `apps/ios/.gitignore` записывай с завершающим `/` (`build/`, `.build/` — так и есть).
Если имя нового файла отличается от игнорируемого только регистром, проверь его `git check-ignore -v`.
**Почему.** У Telegram шаблон `/build` без слэша на macOS скрыл файл `BUILD`. Файл жил только локально и
не попал в репозиторий.
*Источник: `submodules/MTProtoRustEngine/CLAUDE.md` («`.gitignore` ignores `/build/`, not `/build`…»)*

### 1.2 Что доказывает сборка

#### 1.2.1 Компиляцию доказывает только сборка под iOS
**Правило.** `swift build` в `apps/ios` без `--swift-sdk` собирает под Linux-хост. Ошибка «no such module 'UIKit'»
там — не ошибка кода. Собирай `xtool dev build` или `scripts/device.sh --prepare-only` + сборку против Darwin
SDK (`~/.swiftpm/swift-sdks/darwin.artifactbundle`). `swiftc -typecheck` против собранного модуля проверяет
типы, но не линковку и не поведение. В отчёте пиши, что именно запускалось.
**Почему.** У Telegram библиотека, собранная отдельно от приложения, собирается под хост, и UIKit не находится.
А код за `#if canImport(UIKit)` / `TARGET_OS_IOS` на macOS компилируется в пустоту, поэтому «собралось на хосте»
ничего не доказывает.
*Источник: `build-system/Make/CLAUDE.md` (последний абзац: `--target` на голой `swift_library`); `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Verification traps»: «`swift test` compiles no canvas code»); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextInputDecObjC/CLAUDE.md` («The kernel is invisible to a macOS build»); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextInputDecUpstream/CLAUDE.md` («Provenance»)*

#### 1.2.2 Читать код выхода самой сборки, а не конвейера
**Правило.** У `xtool dev build … | tee log` и `swiftc -typecheck … | grep` код выхода — от последней команды
конвейера. Запускай с `set -o pipefail` или смотри `${PIPESTATUS[0]}` (так делает `scripts/test.sh`).
Строка «Build complete» в логе успеха не доказывает. Итог CI читай по `scripts/ci-results.sh`: коммит прогона,
статус задач, число выполненных тестов. Одной зелёной галочки шага мало.
**Почему.** У Telegram код выхода фоновой задачи оказывался статусом последней команды обёртки, а процесс тестов
падал уже после строки «0 failures» (SIGTRAP).
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` («Build, test, install»: «Read the build's own exit status…»); `docs/superpowers/plans/2026-10-15-navbar-split-right-buttons.md` («Global Constraints»: `echo exit=$?`, SIGTRAP после «0 failures»); `docs/superpowers/plans/2026-10-13-message-widgets.md` («Global Constraints»: «Read a build's own exit code…»)*

#### 1.2.3 Видеть все ошибки за один проход
**Правило.** Отдельных модулей у нас нет: собирается один таргет `StudentHub`, и компилятор Swift печатает все
ошибки модуля сразу. На CI `scripts/test.sh build` кладёт в `summary.md` только первые 40 строк `error:`
(`scripts/test.sh:131`). После массовой правки смотри полный `build.log` в артефактах прогона, а не только
сводку.
**Почему.** У Telegram выборочной сборки нет. При правке, которая может дать ошибки во многих файлах,
используют `--continueOnError`, чтобы получить все ошибки за один прогон.
*Источник: `CLAUDE.md` («Build»: одна поддерживаемая сборка, `--continueOnError`)*

#### 1.2.4 Релизную сборку проверять отдельно
**Правило.** Локально собирается только Debug (`xtool`), на PR — тоже Debug (`scripts/test.sh build`). Release
собирает только `ios-release.yml` (ручной запуск). Правки, чувствительные к оптимизации (замыкания с `[weak]`,
дженерики в горячих путях ленты, код за `#if DEBUG`), прогоняй релизной сборкой на CI до выпуска. В отчёте
указывай, была ли релизная сборка. Зелёный PR о Release ничего не говорит.
**Почему.** У Telegram отладочные сборки экспортируют всё, поэтому часть ошибок видна только при релизной
линковке. В отчёте у них отдельно отмечено, после каких правок релиз не пересобирался.
*Источник: `CLAUDE.md` («Subsystem guides»: release link fails); `Telegram/CLAUDE.md` («Framework export lists»); `docs/superpowers/specs/2026-10-15-navbar-split-right-buttons-design.md` («Testing»: debug and release builds; «Results»: release not re-run after follow-ups)*

#### 1.2.5 Скорость и память на debug-сборке не мерить
**Правило.** Абсолютные замеры скорости и памяти делай на сборках CI: perf-набор (`ios-nightly.yml`,
`scripts/test.sh perf`) против `Tests/perf-baseline.json`. На локальной debug-сборке (`xtool dev build`)
допустимы только относительные сравнения «до/после» на той же сборке.
**Почему.** У Telegram горячий C-код собирают с `-O2` даже в debug: без этого debug-сборка в разы отличается
от релиза по стеку и времени (около 10 КБ стека C на вызов JS).
*Источник: `docs/superpowers/specs/2026-10-13-message-widgets-design.md` (§2: quickjs-ng `-O2` в debug); `docs/superpowers/specs/2026-10-29-message-widgets-cpu-clock-limits-design.md` («Debug builds»)*

#### 1.2.6 Не оставлять новых предупреждений
**Правило.** Предупреждения у нас ошибками не считаются (`project.yml:26` `SWIFT_TREAT_WARNINGS_AS_ERRORS: "NO"`;
`scripts/test.sh` показывает из предупреждений только `warning: unreachable`). Своих новых предупреждений не
оставляй. Включить режим «warnings as errors» может только владелец.
**Почему.** У Telegram предупреждения — ошибки почти во всех модулях: неиспользуемая переменная валит сборку.
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` («Pitfalls: Build»)*
**Применимость.** частично — у нас режим выключен, переносится только «не оставлять новых».

#### 1.2.7 Если поведение не сходится с кодом, сначала чистая сборка
**Правило.** Бывает, что после правки ресурсов (`Localizable.xcstrings`), `@inlinable`-кода или дженериков
поведение сборки `xtool dev build` не сходится с исходниками. Тогда сначала сделай чистую сборку и только
потом делай выводы о коде.
**Почему.** У Telegram инкрементальная сборка SwiftPM/Xcode не пересобирала клиента, у которого изменился
инлайнящийся аксессор.
*Источник: `submodules/TelegramApi/CLAUDE.md` («SwiftPM and Xcode incremental builds can fail to recompile a client…»)*
**Применимость.** частично — генерации кода вне Bazel у нас нет, переносится риск инкрементальной сборки.

#### 1.2.8 Импорты бинарника смотреть `dyld_info`, не `nm -u`
**Правило.** Если понадобится проверить бинарник на приватные или лишние символы, делай это на macOS-раннере
командой `xcrun dyld_info -imports`.
**Почему.** У бинарников с chained fixups `nm -u` ничего не показывает.
*Источник: `Telegram/CLAUDE.md` («Count a binary's imports with `xcrun dyld_info -imports`…»)*
**Применимость.** частично — сейчас такая проверка не нужна.

### 1.3 Окружение и порядок запуска

#### 1.3.1 Оболочка агента не читает профиль: окружение задавать в команде
**Правило.** swiftly прописывает себя только в `~/.profile`, поэтому в командах агента перед `swift`/`xtool`
выполняй `. "$HOME/.local/share/swiftly/env.sh";`. Токен GitHub передавай в той же команде:
`GH_TOKEN=$(gh auth token --user startupjafari) scripts/ci-results.sh`. На CI Xcode выбирается явно через
`DEVELOPER_DIR=/Applications/Xcode_26.6.app/Contents/Developer` (`ios.yml`, `ios-nightly.yml`,
`ios-snapshots.yml`). На «Xcode по умолчанию» раннера не полагайся.
**Почему.** У Telegram переменная для сборки лежит в `~/.zshrc`, а bash агента его не читает. Служба
gitlab-runner запускается без Homebrew в PATH, поэтому инструменты там ищут по явным путям.
*Источник: `CLAUDE.md` («Build»: `TELEGRAM_CODESIGNING_GIT_PASSWORD`, `source ~/.zshrc`); `build-system/Make/CLAUDE.md` (PATH службы без Homebrew)*

#### 1.3.2 Полную сборку запускает один главный агент, ставит на телефон человек
**Правило.** `xtool dev build` тяжёлый и делит кеш `.build`. Запускай его один раз и только из главного агента,
не параллельно в подагентах: подагентам остаются `swiftc -typecheck` и чтение кода. На iPhone
(`scripts/device.sh`) ставь только по просьбе владельца, проверяет он сам.
**Почему.** У Telegram сборку всего приложения делает только главный агент. По умолчанию правило «только собрать»:
ставит и проверяет пользователь.
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` («Ground rules»: «Full app builds run in the main agent, never in subagents»; «build only, the user installs and verifies»)*

#### 1.3.3 Когда собирать и тестировать
**Правило.** Сборки и проверки запускай только по прямой просьбе владельца или при подготовке коммита или PR
(корневой `AGENTS.md`). При подготовке PR: локально `xtool dev build` и `swiftc -typecheck` тестов, затем
проверка «iOS — итог». На PR она только собирает, тесты там не идут. Если правка задела ленту, сессию или
синхронизацию, попроси ручной запуск `ios.yml` с `suites: unit` (или `pr`) либо дождись `ios-nightly.yml`.
**Почему.** У Telegram после каждой волны правок идёт полная сборка с `--continueOnError`, а если волна задела
модуль с юнит-тестами — прогон этих тестов.
*Источник: `CLAUDE.md` («Postbox → TelegramEngine», правило 6)*
**Применимость.** частично — порядок запуска проверок у нас другой (по просьбе, тесты на CI).

### 1.4 Установка на iPhone и свежесть сборки

#### 1.4.1 Прежде чем судить «исправлено / не исправлено», убедиться, что на iPhone свежая сборка
**Правило.** После `scripts/device.sh` (`xtool dev`) убедись, что установка в этом запуске завершилась без
ошибки и что на телефоне именно новая сборка. Признаком служит видимая правка или время сборки
`.device/Info.plist`. В отчёте называй коммит сборки. Вывод «не воспроизводится» после установки без такой
проверки ничего не доказывает.
**Почему.** У Telegram `simctl install` с тем же номером сборки молча оставлял старое приложение. Старая сборка
запускалась и работала нормально, и фикс «не работал» три прогона подряд.
**Сейчас у нас.** соблюдено (#499): номер сборки — время сборки UTC, коммит — в ключе `SHBuildCommit` Info.plist,
`device.sh` печатает строку со сборкой.
*Источник: `CLAUDE.md` («Updating the running simulator after a rebuild»); `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` («Build, test, install»: «A same-build-number `simctl install` silently keeps the old app»); `Tests/WidgetHarness/CLAUDE.md` («Build, test, run»); `Tests/ComposerHarness/CLAUDE.md` («The reused test simulator can run a STALE host app»)*
**Применимость.** частично — симулятора нет, переносится принцип «сначала докажи свежесть установки».

#### 1.4.2 Переустановка не должна стирать данные: приложение без просьбы не удалять
**Правило.** Переустановка через `xtool dev` с тем же bundle id `kz.studenthub.app.dev` (`xtool.yml:7`) сохраняет
вход и базу GRDB. Не удаляй приложение с телефона «для чистоты» и «при сомнении в свежести» без согласия
владельца: потеряются сессия и локальная база. Свежесть доказывай по 1.4.1. Чистое состояние для проверки
даёт только mock-режим UI-тестов (`SH_UITEST_MOCK=1`, `UITestBootstrap.prepare`).
**Почему.** У Telegram заменяется только контейнер бандла, а контейнер данных остаётся, поэтому вход сохраняется.
Удаление прежних установок допускается только на выделенных тестовых симуляторах.
*Источник: `CLAUDE.md` («Updating the running simulator…»: контейнер данных отдельный); `Tests/WidgetHarness/CLAUDE.md` («Build, test, run»)*
**Применимость.** частично — у Telegram это про симулятор, у нас — телефон владельца.

#### 1.4.3 Ручная проверка называет, что именно проверялось
**Правило.** В записи о проверке на iPhone указывай коммит сборки, сервер (`API_BASE_URL`: Railway или
локальный), положение `PerformanceFlags` и отладочных переключателей. Если без нужного положения флага
проверка бессмысленна, так и пиши.
**Почему.** У Telegram чек-лист ручной проверки называет коммит, устройство и обязательный отладочный
переключатель («без него проверяется не то») и сверяет бинарник на устройстве с собранным.
*Источник: `docs/superpowers/phase6-manual-checklist-record.md` («Build under test»; установка с guard; «framework md5 verified identical to the .ipa»)*

#### 1.4.4 Брать только свежий вывод; перед разрушающим шагом — проверка
**Правило.** (1) Артефакты CI бери только из каталога прогона текущего коммита: `build/ci/<id прогона>/`,
`scripts/ci-results.sh --run <id>` или `--wait` после пуша. Сверяй строку «Коммит:» в выводе скрипта:
старый каталог рядом выглядит так же. (2) Путь к собранному приложению задавай конкретно, без
«первого попавшегося». (3) Любой `rm -rf` по вычисленному пути делай только после проверки, что путь непустой и
источник существует. Так уже сделано в `scripts/ci-results.sh`: `RUN_ID` проверяется до `rm -rf "$DEST"`.
**Почему.** У Telegram сборку берут только из `bazel-bin`, а не `find` по каталогу всех конфигураций: можно
взять сборку для устройства вместо симулятора. Без проверки источника перед `rm -rf` оставался симулятор без
приложения. Каталог упаковки после инкрементальной сборки хранит прежние бинарники с поддельными датами.
**Сейчас у нас.** соблюдено (#499): `run_bench` берёт конкретный `Debug-iphonesimulator/StudentHub.app`, а не первое
найденное.
*Источник: `CLAUDE.md` («Updating the running simulator…»: bazel-bin vs bazel-out, guard перед `rm -rf`, terminate, уборка staging, `Telegram_archive-root/`)*
**Применимость.** частично — симулятора нет, принципы переносятся на артефакты CI и скрипты.

### 1.5 Неприменимо к нам
- Сигнализация SCTP, групповые звонки, SFU, симулкаст, кодеки, логирование RTC и статическое разрушение
  (`submodules/TgVoipWebrtc/CLAUDE.md`) — звонков и WebRTC у нас нет (общий урок о двух сборках вынесен в 1.1.1).
- Пошаговые правки WebRTC-транспорта (`peer_connection.*`, `MtProtoDtlsTransportTest`, BUILD, команды
  `tgcalls_cli`; `docs/superpowers/plans/2026-09-16-tgcalls-mtproto-dtls-slot.md`) — звонков нет.

---
## §2. Тесты

Тесты iOS-клиента — `Tests/StudentHubTests` (юнит, в хосте приложения), `StudentHubSnapshotTests`, `StudentHubUITests`
(mock API) и `StudentHubPerfTests`. Из Linux они не запускаются, на PR CI их тоже не гоняет — только `ios-nightly.yml`
и ручной запуск `ios.yml`. Главная мысль раздела: зелёная сводка ничего не значит, пока не видно, что нужные тесты
выполнились, что они умеют краснеть и что поведение проверено там, где оно живёт (часто — только на iPhone).

### 2.1 Запуск тестов и чтение результата

#### 2.1.1 Тесты гоняет только CI; «проходит» — после прогона CI
**Правило.** Из Linux тесты не собираются ни `xtool dev build`, ни `swift build`. Новые тесты проверяй
`swiftc -typecheck` против собранного модуля, а прогон смотри на CI. На PR проверка «iOS — итог» только собирает
(`scripts/test.sh build`). Тесты идут в `ios-nightly.yml` (`scripts/test.sh full` после вливания iOS в develop)
или при ручном запуске `ios.yml` с полем `suites` (`unit`, `pr`, `snapshot`, `ui`, `perf`…). Результат —
`scripts/ci-results.sh` (`--nightly`, `--run <id>`, `--wait`). Пока CI тест не прогнал, не пиши «тесты проходят».
Проверки запускай только по просьбе владельца (`AGENTS.md`).
**Почему.** У Telegram демо и тесты вне основной цели Bazel проверяет только их собственный набор xcodebuild. Если
XCTest не грузится на хосте, файлы тестов хотя бы компилируют `swiftc` вручную.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` («Project»); `submodules/TelegramUI/Components/PeerInfo/PeerInfoVisualMediaPaneNode/CLAUDE.md` («Tests»: `swiftc -Xlinker -bundle`, `xctest`); `CLAUDE.md` («Running tests»)*
**Применимость.** частично — локального прогона у нас нет вовсе.

#### 2.1.2 Запускать конкретный набор или класс
**Правило.** Наборы запускай через `scripts/test.sh unit|snapshot|ui|ui-extended|perf|scroll|bench`, один класс или
тест — через `-only-testing:StudentHubTests/<Класс>[/<тест>]`. Имя после `-only-testing` — это класс, а не файл:
`ChatSyncTests.swift` содержит `ChatDTOTests` и `ChatStoreTests`, `MessageSyncTests.swift` — `MessageStoreTests` и
`MessageOutboxTests`.
**Почему.** У Telegram набор по умолчанию ссылается на висящую цель и не собирается, поэтому цели запускают явно
(`--target`).
*Источник: `CLAUDE.md` («Running tests»: `--target`, `Tests/AllTests`)*

#### 2.1.3 Ноль выполненных тестов — провал, а не успех
**Правило.** Итог прогона читай по сводке `summary.md` (`scripts/xcresult_summary.py`, `scripts/ci-results.sh`) и
коду выхода, а не по строкам отдельных наборов. Проверь, что нужный класс выполнился: его имя есть в журнале,
выполнено N > 0. Опечатка в `-only-testing:` молча даёт 0 тестов. Резкое падение числа выполненных тестов без
удаления тестов значит, что набор не собрался или не запустился.
**Почему.** У Telegram фильтр по имени печатал «Executed 0 tests, with 0 failures». Несобравшийся бандл печатал
«0 failures» от другой схемы. Строки отдельных наборов тоже говорят «with 0 failures», а первая из нескольких строк
`Executed` бывает чужой. Поэтому в гайде записано ожидаемое число тестов каждого набора.
*Источник: `docs/superpowers/plans/2026-09-25-reserved-corners.md` (Task 1 Step 5); `docs/superpowers/phase6-gate-record-2026-08-24.md` («Two gate commands were themselves defective»); `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Verification traps»: «Read every `Executed …` line»); `Tests/ComposerHarness/CLAUDE.md` («Build, test, run»: `--test_filter` takes a CLASS name); `docs/superpowers/plans/2026-10-13-message-widgets.md` (Task 7 Step 8); `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§8); `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` (ожидаемое число тестов)*

#### 2.1.4 Краш внутри теста оставляет сводку зелёной
**Правило.** Сверяй число выполненных кейсов в `.xcresult` / `summary.md` с ожидаемым и ищи в журнале прогона
(`artifacts/<набор>/xcodebuild.log`) строки `Fatal error` и «crashed».
**Почему.** У Telegram тест, упавший на `fatalError`, не считается ни пройденным, ни проваленным, и сводка
показывает «N tests, 0 failures».
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` («Verification traps»); `Tests/ComposerHarness/CLAUDE.md` («A red test that TRAPS prints no failure»)*

#### 2.1.5 Сначала зелёная база, число тестов до и после
**Правило.** Перед iOS-задачей узнай состояние тестов на базе: последний `ios-nightly.yml` на develop
(`scripts/ci-results.sh --nightly`). Иначе свои падения не отличить от прежних. После задачи сверь, что выполнено
ровно на столько тестов больше, сколько ты добавил: новый файл мог не попасть в таргет. Если правка задела общий
механизм (`ImageMemoryCache`, `MessageListView`, `Motion`, `APIClient`), укажи в описании PR число тестов до и после.
**Почему.** У Telegram до правок прогоняют наборы (139 и 76 тестов), и после каждого шага ожидаемое число растёт
ровно на добавленное. При вскрытии движка прокрутки они записали счёт тестов до и после.
*Источник: `docs/superpowers/plans/2026-10-15-navbar-split-right-buttons.md` (Task 0 Step 2; «Expected: Executed N tests»); `docs/superpowers/plans/2026-10-27-media-grid-stage1.md` (Task 1 Step 4, Task 13)*

#### 2.1.6 Упавший прогон не должен висеть в `simctl diagnose`
**Правило.** Каждый вызов `xcodebuild test` / `test-without-building` получает `-collect-test-diagnostics never`
(двумя аргументами). Если прогон завис после «Test Suite … failed», найди процесс `pgrep -fl "simctl diagnose"`. Убивать
его безопасно: он только собирает логи, и прогон сразу вернёт настоящий результат.
**Почему.** У Telegram при падении xcodebuild по умолчанию собирает `simctl diagnose … --timeout=600` — до 10 минут
простоя после последнего теста. Проходящий прогон не зависает, упавший — почти всегда.
**Сейчас у нас.** соблюдено (#499): `run_suite` передаёт `-collect-test-diagnostics never`.
*Источник: `CLAUDE.md` («Running tests», абзац про `simctl diagnose`); `build-system/bazel-patches/CLAUDE.md` («xctestrunner-collect-test-diagnostics.patch», последний абзац); `submodules/TelegramUI/Components/CoreList/CLAUDE.md` («Build / Test»); `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` (команды сборки и тестов)*

#### 2.1.7 Без параллельности и пересекающихся прогонов на одном симуляторе
**Правило.** Передавай `-parallel-testing-enabled NO` явно. Не запускай два процесса XCTest на одном симуляторе:
`bench` и UI-наборы — по очереди, тяжёлые замеры — не параллельно. Флак повторяй последовательно
(`-test-iterations N`), а не параллельными копиями.
**Почему.** У Telegram параллельные повторы на одном симуляторе убивают друг друга, и провал ничего не говорит о
тесте. Параллельный прогон ломал проверки анимаций.
**Сейчас у нас.** соблюдено (#499): `run_suite` передаёт явный `-parallel-testing-enabled NO`.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Host/Engine/AGENTS.md` («Xcode simulator testing»); `Tests/ComposerHarness/CLAUDE.md` («Repeat a test with a shell loop…, never `--runs_per_test`»); `submodules/TelegramUI/Components/CoreList/CLAUDE.md` («Build / Test»); `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md`; `Tests/WidgetHarness/CLAUDE.md` («The conformance set»: «one at a time»)*

#### 2.1.8 Опция xcodebuild — двумя аргументами, и проверить, что она читается
**Правило.** Опции `xcodebuild` в `scripts/test.sh` и workflow пиши как «флаг значение» — двумя аргументами, не
`-флаг=значение`. Сомнительный флаг проверь заведомо неверным значением: xcodebuild должен его отвергнуть.
**Почему.** У Telegram `-collect-test-diagnostics=never` xcodebuild читал как настройку сборки и молча игнорировал
(`=bogus` принимался). Так и выяснилось, что флаг не работал.
*Источник: `build-system/bazel-patches/CLAUDE.md` («xctestrunner-collect-test-diagnostics.patch»)*

#### 2.1.9 Раннер привязан к конкретному устройству и ОС
**Правило.** `scripts/test.sh` выбирает UDID по имени `SH_TEST_DEVICE` (iPhone 17 Pro) и по последней iOS (или
`SH_TEST_OS`), а не по имени в `-destination`: одно имя бывает у нескольких рантаймов. Эталоны снимков сравнимы
только в среде Xcode 26.6 / iPhone 17 Pro (`__Snapshots__/ios26@3x`). Устройство и ОС тестов «попутно» не меняй.
Если нужного симулятора нет, остановись и спроси, а не бери похожий.
**Почему.** У Telegram раннер по умолчанию выбирал несуществующее устройство, и процесс тестов падал с кодом 15.
Похожий симулятор — это уже другое устройство.
*Источник: `CLAUDE.md` («Running tests»: `ios_test_runner`); `submodules/TelegramUI/Components/CoreList/CLAUDE.md` («Build / Test»)*

#### 2.1.10 Новый файл теста подхватывается сам
**Правило.** Таргеты в `project.yml` собирают каталоги целиком (`- path: Tests/StudentHubTests` и т. д.). Новый файл
попадает в таргет после `xcodegen generate`, `.xcodeproj` не коммитится. Если файл лёг в другой каталог или под
`excludes`, тест молча пропадёт — сверяй число тестов (2.1.5).
**Почему.** У Telegram файл в `Telegram/Tests/Sources/` подхватывается целью через Bazel без ручного членства.
*Источник: `docs/ui-testing.md` («Adding a New Test File»)*

#### 2.1.11 «Упал» без отчёта о сбое — читать журнал о причине выхода
**Правило.** Если UI-тест показал «crashed», а отчёта о сбое нет, сначала посмотри журнал устройства во вложениях
`.xcresult` (на iPhone — `idevicesyslog`) и только потом строй гипотезы.
**Почему.** У Telegram выход через `exit_with_reason` не оставляет `.ips`, причина видна только в журнале launchd.
*Источник: `Tests/ComposerHarness/CLAUDE.md` («A Tier 2 "crashed" with no crash report»)*
**Применимость.** частично — журнал симулятора у нас доступен только во вложениях CI.

#### 2.1.12 Тесты на время — отдельным набором и перезапуск в одиночку
**Правило.** Тесты линейности и времени держи в `perf` (`StudentHubPerfTests`, ночной `ios-nightly.yml`), а не в
юнит-наборе. Если такой тест упал, перезапусти его в одиночку и только потом считай регрессией.
**Почему.** У Telegram тесты, меряющие время, флакуют под нагрузкой, поэтому их перезапускают отдельно.
*Источник: `docs/message-widgets-native-runtime.md` («Tests»: `GumboForkTests`, `testSelectorParsingIsLinear`)*

### 2.2 Отчёт: что проверено и чем

#### 2.2.1 Зелёные тесты необходимы, но не достаточны
**Правило.** Изменение ленты, поля ввода или меню готово только после проверки на iPhone владельца
(`scripts/device.sh`). В отчёте раздели три части: что подтверждено тестами на CI, что — на iPhone, что не
проверено никем. Не пиши «проверено», если сценарий не прогонялся. Описание команды — не прогон, «типчек прошёл» —
не проверка поведения. Возможность, которую ни один тест не прогнал, — утверждение, а не покрытие.
**Почему.** У Telegram из шести поведений, проверенных на экране, два сломались при первом касании, и ни одно не было
видно зелёному набору: синтетические данные чище настоящих. В их отчётах отдельно перечислено, что вид, VoiceOver и
инвалидация «ещё не проверены вручную».
*Источник: `docs/chat/corelist-chat-history-backend.md` («Scroll to item»: Verification status; «Interactive drag start»); `docs/instantpage-richtext.md` («Compact InstantPage previews», «Validation on 2026-09-29»); `docs/superpowers/richtext-stock-divergences-followups.md` («Also recorded: two unexercised capability claims»)*

#### 2.2.2 Проверки, которые тесты не делают, — отдельным списком
**Правило.** В отчёте по задаче перечисли, что надо проверить на iPhone, отдельно от проверенного автоматически.
Пример для сессии: `SessionStoreTests` работают на словаре в памяти и не проверяют настоящую связку ключей,
запертость до первой разблокировки, фон и заморозку. Поэтому для правки сессии в списке ручных проверок:
перезагрузка + тихий пуш до разблокировки, убийство приложения во время продления, «Выйти» в авиарежиме и досылка,
два аккаунта подряд, переустановка, смена сети посреди продления, продление дольше 10 с.
**Почему.** У Telegram документ прямо говорит, чего тесты не проверяют («These commands describe the available
checks; they are not a claim…»), а ручные проверки после влития перечислены явно.
*Источник: `docs/passcode.md` («Verification coverage and limits»); `docs/superpowers/plans/2026-09-16-tgcalls-mtproto-dtls-slot.md` (Task 5 Step 6)*

#### 2.2.3 Критерий успеха — наблюдаемый итог и счётчики, а не «код 0»
**Правило.** Тест и проверка на устройстве называют наблюдаемый итог: сообщение дошло в обе стороны и встало на
место по `seq`, продление одно (`SessionStoreTests` считают вызовы), после выхода связка ключей пуста. Критерии —
числа: холодный старт = одно продление, после обрыва — один запрос `updates`, а не цикл, открытие чата — ограниченное
число запросов. Превышение — стоп и разбор до коммита. Зелёная сборка и отсутствие падений поведение не проверяют.
**Почему.** У Telegram «exit 0» ни разу не доказал двусторонний звук: успешный прогон задан перечнем признаков.
Шторм переговоров нашли по числу операций (4765 `SetLocalDescription` против 4).
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («Testing»: «"exit 0" alone never proved two-way media»); `docs/superpowers/plans/2026-09-16-tgcalls-mtproto-dtls-slot.md` (Task 3 Step 3); `docs/superpowers/specs/2026-09-16-tgcalls-mtproto-dtls-slot-design.md` («Renegotiation storm»)*

#### 2.2.4 Выводы о высоте, клавиатуре и отступах — предварительные до iPhone
**Правило.** На CI-симуляторе аппаратная клавиатура, экранной там нет. Выводы о высоте поля, клавиатуре и панели
emoji подтверждай на iPhone, а до этого пиши «предварительно».
**Почему.** У Telegram стенд не воспроизводит клавиатурную механику экрана чата, поэтому такие выводы помечаются
`provisional`.
*Источник: `Tests/ComposerHarness/CLAUDE.md` («The one standing caveat», «Keyboard height»)*

#### 2.2.5 Системное поведение текста снимать логом на устройстве
**Правило.** Записи выделения, автокоррекции и IME от системы до юнит-тестов не доходят. Сними настоящую
последовательность на iPhone временным `Logger(subsystem:category:)` + `idevicesyslog` из Linux, потом убери лог.
Только после этого строй гипотезу о фиксе.
**Почему.** У Telegram то, что система делает с выделением (касание по медиа, плавающий курсор), сначала снимают
логом и лишь потом чинят.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Verification traps»: «OS-driven selection writes never reach unit tests»)*
**Применимость.** частично — симулятора нет, снимаем на телефоне.

#### 2.2.6 Что не построить в тестах — проверять записью экрана
**Правило.** Переходы просмотрщика, жесты листа, PhotoKit проверяй UI-тестом на mock, если можно. Если нельзя —
запись экрана iPhone и перечень того, что в ней смотреть. В отчёте прямо пиши: «проверено записью» или «не проверено».
**Почему.** У Telegram переход в галерею и догрузку дыр не строит ни один тестовый таргет, поэтому их проверяют по
записанным кадрам.
*Источник: `docs/superpowers/plans/2026-10-28-shared-media-grid-stage1.md` («Review Focus»)*
**Применимость.** частично.

#### 2.2.7 Результаты проверки — таблицей «сценарий × прогоны × итог» с контролем
**Правило.** Отчёты о проверке (`CHANGELOG-PERF.md` в корне, `apps/ios/MOTION_TESTING_REPORT.md`) пиши таблицей:
сценарий, число прогонов, результат и контроль «до изменения». Неуспехи объясняй сравнением с контролем.
**Почему.** У Telegram итог — таблица сценариев по 8 прогонов на строку. Результат 5/8 объяснён тем же 13↔13 у
контроля.
*Источник: `docs/superpowers/specs/2026-10-11-tgcalls-compatimpl-v2-protocol-design.md` («Results (2026-10-11)»)*

#### 2.2.8 Медленная сеть — один и тот же профиль до и после
**Правило.** Медленную историю в тестах задавай `SH_UITEST_HISTORY_DELAY_MS`, на iPhone — через Network Link
Conditioner (Настройки ▸ Для разработчиков). Для медиа-задач называй в отчёте профиль и бери один и тот же для «до»
и «после».
**Почему.** У Telegram отладочная сборка запускается с профилем сети (`-debugNetworkProfile`), и тот же набор
профилей используется в лаборатории тестов, поэтому цифры сравнимы.
*Источник: `submodules/HLSPlayback/CLAUDE.md` («A slow network on the simulator»); `docs/native-hls-player.md` («Tests»)*
**Применимость.** частично — своего формирователя сети нет.

#### 2.2.9 Готово = перечень честных и враждебных случаев, у каждого — тест
**Правило.** Для новой карточки или вида сообщения заранее перечисли в задаче или PR фикстуры честных случаев (mock в
`Sources/App/UITesting`, `Tests/StudentHubTests/Fixtures`) и враждебных: пустые поля, огромные строки,
RTL-переопределения, чужие схемы ссылок, тысяча пунктов. Перечисли и крайние случаи: пустая карточка, ошибка
загрузки, две карточки одного опроса на экране, правка во время анимации, удаление с открытым меню. У каждого случая
— имя теста.
**Почему.** У Telegram критерий версии — перечисленные примеры с правильной высотой плюс атакующий корпус, который
не сделал ни одного запроса. Каждый крайний случай плана назван тестом и задачей, где тест появится.
*Источник: `docs/superpowers/specs/2026-10-13-message-widgets-design.md` («Goal»); `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` (§2 п. 3); `docs/superpowers/plans/2026-10-13-message-widgets.md` («Review Focus»)*

### 2.3 Красный тест, мутанты и закреплённое поведение

#### 2.3.1 Сначала падающий тест — в том же коммите, что фикс
**Правило.** Для чистых функций (раскладка, автоматы, синхронизация, сессия) порядок такой: тест → ожидаемое падение
с названной причиной → реализация → прохождение. Локально красного прогона не получить, поэтому пиши тест вместе с
правкой, проверяй `swiftc -typecheck`, а прохождение — на CI. Для багфикса тест, ловящий баг, кладётся в тот же
коммит. Причину падения называй в отчёте: «не находит тип» и «ассерт не сошёлся» — разные вещи. Находки по ходу
записывай в отчёт задачи.
**Почему.** У Telegram каждый шаг плана — «Write the failing test / Run, expect failure (named reason) / implement /
pass». Дисциплина у них: красный до фикса, подтверждение, что тест запускался, журнал находок.
*Источник: `docs/superpowers/plans/2026-09-25-reserved-corners.md` (Task 1 Steps 1–5); `docs/superpowers/plans/2026-10-27-media-grid-stage1.md` и остальные планы; `docs/superpowers/plans/2026-09-16-tgcalls-mtproto-dtls-slot.md` (Task 2 Steps 3–7); `docs/superpowers/plans/2026-10-13-message-widgets.md` («Run it to make sure it fails»); `Tests/ComposerHarness/CLAUDE.md` («Discipline when something breaks»)*
**Применимость.** частично — локального запуска нет.

#### 2.3.2 Красный — по поведению; новый тест проверяется мутантом
**Правило.** Падение из-за некомпилирующегося API не в счёт. Для ключевых тестов (лента, движение, синхронизация,
сессия) сломай правило на месте: убери проверку `seq == lastSeq + 1`, поменяй знак или ветку. Убедись в падении на
CI одним прогоном ветки, верни код и прогони чисто. В отчёте назови, какой мутант проверен. Регрессионному тесту
нужен контроль, который краснеет без фикса.
**Почему.** У Telegram новые тесты-пины проверяются мутантами. На этапе 5 сценарный стенд не поймал ни одной из 14
мутаций правил — их держали только юнит-тесты. Счётчик проходов засчитывал мусор, и вывести на чистую воду его
помог контроль с заведомо неверным ключом (прогон 0/2).
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` («Ground rules»: «behavioural RED… break the implementation in place»); `docs/state-sync.md` («Pin a behaviour by seeing the new test fail under a scratch break»); `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§7, §6b); `submodules/TgVoipWebrtc/CLAUDE.md` (wrong-key negative control); `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Verification traps»)*

#### 2.3.3 Любая проверка должна уметь дать другой ответ
**Правило.** Прежде чем записать результат как доказательство, покажи, что инструмент способен выдать
противоположное. Если grep или скрипт ответил «ничего», проверь его на заведомо существующем совпадении. Если
ждёшь 1 — убедись, что инструмент умеет показать 2.
**Почему.** У Telegram это первое правило раздела «Verification traps»: рядом с отрицательным результатом всегда стоит
положительный контроль.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Verification traps»)*

#### 2.3.4 Охранный тест подписан как охранный
**Правило.** Тест, закрепляющий уже существующее поведение, помечай комментарием «guard: закрепляет существующее».
Такой тест может пройти сразу, и это не нарушение 2.3.1.
**Почему.** У Telegram охранные тесты так и подписаны, чтобы их прохождение при написании не принимали за
бесполезный тест.
*Источник: `docs/superpowers/plans/2026-10-15-navbar-split-right-buttons.md` («Global Constraints»: «Guard tests that pin existing behaviour say so»)*

#### 2.3.5 Если тест-сначала невозможен — записать решение и цену ошибки
**Правило.** Если ошибку нельзя воспроизвести тестом (краш-ловушка `preconditionFailure`, только на устройстве),
запиши в отчёте: почему, чем доказана эквивалентность, что делать, если ты неправ.
**Почему.** У Telegram отказ от упавшего теста оформлен решением с ценой ошибки и планом отката.
*Источник: `docs/superpowers/postbox-refactor-log.md` («Ruling: no failing test first…»)*

#### 2.3.6 Тест, которому нечего проверить, — «не выполнен», а не «прошёл»
**Правило.** Тест без данных или пропущенный по условию не засчитывается. UI-тесты без `SH_UITEST_LOGIN` пропущены
(`ChatFlowsUITests`) — в отчёте это «не выполнено», а не «зелёное». Невыполнимое действие оформляй `XCTSkip` с
причиной, а не пустым проходом.
**Почему.** У Telegram проверка, которую раннер не может выполнить по-настоящему, отчитывается как «not performed»,
а невыполнимые действия в базе соответствия — `skip`, не `pass`.
*Источник: `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` (§3 анти-цели, §5 V3); `Tests/WidgetHarness/CLAUDE.md` («The baseline is a ratchet»)*

#### 2.3.7 Рефакторинг без изменения поведения — сначала тесты-характеристики
**Правило.** Перед переделкой ленты или синхронизации напиши тест на текущее поведение (`MessageTimelineTests`,
`ChatSyncTests.swift`, `OptimisticSyncTests`). Баг, замеченный по пути, оформляй отдельной задачей или строкой в
`docs/BUGS.md`, а не чини «заодно» (`AGENTS.md`: не рефакторить попутно).
**Почему.** У Telegram три кандидата в дефекты, найденные на этапе без изменения поведения, закреплены «как есть» и
записаны отдельными продуктовыми задачами.
*Источник: `docs/superpowers/phase6-gate-record-2026-08-24.md` (Outstanding п. 3)*

#### 2.3.8 Новая настройка общего механизма по умолчанию повторяет прежнее поведение
**Правило.** Новый параметр общего кода (`ImageMemoryCache`, `MessageListView`, `Motion`, `APIClient`) по умолчанию
даёт прежнее поведение. Тесты самого механизма при этом не меняются.
**Почему.** У Telegram при вскрытии движка прокрутки его поведение и тесты не менялись, а каждая новая настройка
`MediaGrid` по умолчанию повторяет сегодняшнее поведение.
*Источник: `docs/superpowers/plans/2026-10-27-media-grid-stage1.md` (Task 1, Task 13); `docs/superpowers/plans/2026-10-28-shared-media-grid-stage1.md` («Global Constraints»)*

#### 2.3.9 Тест не правят, чтобы он прошёл; тест безопасности не ослабляют
**Правило.** Если тест упал после рефакторинга, значит, поведение изменилось: остановись и доложи. Тесты сессии и
выхода (`SessionStoreTests`, `LocalData.erase`), валидации ссылок и приватности при смене аккаунта не правятся
«чтобы позеленело» — их падение означает дыру, о которой надо сообщить человеку.
**Почему.** У Telegram тест не правят ради прохода. Упавший атакующий файл означает дыру в валидаторе, о ней
сообщают, а тест не ослабляют.
*Источник: `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§7); `docs/superpowers/plans/2026-10-13-message-widgets.md` (Task 9 Step 6)*

#### 2.3.10 Ожидаемые падения — с причиной и условием снятия; список только сокращается
**Правило.** Известный дефект закрепляй тестом с `XCTExpectFailure("<причина>")` и ссылкой на правило — как флаг 2.5
в `PerformanceFlagUITests.swift:33`. Такой тест покраснеет при починке. Исправление — отдельный коммит, который
снимает `XCTExpectFailure`. Новые ожидаемые падения добавляй только осознанно, с объяснением в описании PR, и снимай
сразу после починки. Что юнит-уровень проверить не может, закрывай UI-тестом.
**Почему.** У Telegram известные дефекты синхронизации (Q5, Q8) закреплены как есть, исправление переворачивает ровно
эту проверку своим коммитом. Файлы ожидаемых сбоев с причиной у каждой строки только сокращаются.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («A change that moves pinned behaviour flips that test in its own commit»); `docs/state-sync.md` («Q5 and Q8 are still pinned as defects»); `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§1); `Tests/WidgetHarness/CLAUDE.md` («The conformance set»: «A test that must stop… names the reason's prefix»); `docs/message-widgets-native-runtime.md` («What the corpus still trips on», «Tests»: wpt-expectations, expected-failures); `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` (§8)*

#### 2.3.11 Чинить незакреплённый слой, а не закреплённый
**Правило.** Если новый вызывающий код не сходится с закреплённым тестом компонентом `DesignSystem`, правь вызывающий
код. Расхождение сначала сравни с эталонной реализацией: багом считается только настоящее изменение поведения.
**Почему.** У Telegram при расхождении сначала сравнивают с эталонной песочницей и не трогают закреплённый хост-тестом
слой отрисовки.
*Источник: `docs/superpowers/plans/2026-10-13-message-widgets.md` (Task 5 Step 8, Task 10 Step 4)*

#### 2.3.12 Скрипт-страж сам покрыт тестами и отрицательными проверками
**Правило.** Если заводится скрипт-страж (проверка по коду в CI), у него свои тесты. Нарушение вне списка
исключений падает, устаревшая запись в списке падает, упоминание в комментарии или строке не считается, интерполяция
в строке считается. Каждую отрицательную проверку после прогона откатывай.
**Почему.** У Telegram каждое правило стража проверено нарочно сломанным примером, а мутации (8/8) показали дыру в
плановом тесте.
*Источник: `docs/superpowers/postbox-refactor-log.md` («Negative checks, each reverted»; «Mutation check of the unit tests: 8/8 mutants killed»)*

#### 2.3.13 Запрет выпиленного API можно закрепить тестом-сканом
**Правило.** Когда выпиливаем опасный API (прямой `UIApplication.shared.open` из карточек, `Locale(identifier:)` с
данными сервера, `String(decoding:)`), запрет можно закрепить grep-проверкой по `apps/ios/Sources` в CI. Это новое
правило CI, поэтому только с согласия владельца.
**Почему.** У Telegram после удаления механизма тест-сканер падает, если удалённое имя снова появится в коде.
*Источник: `docs/message-widgets-native-runtime.md` («Invariants»: `:WidgetRuntimeNoWorkUnitsScanTests`); `docs/superpowers/specs/2026-10-29-message-widgets-cpu-clock-limits-design.md` («Removing the work-unit accounting»)*
**Применимость.** частично — механизм вводится только по решению владельца.

### 2.4 Уровень теста и тестируемость кода

#### 2.4.1 Решения — чистые функции и типы без UIKit, с юнит-тестами
**Правило.** Геометрию, группировку, якоря, пороги, «прибыло ли новое», позицию меню над клавиатурой, ширину пузыря,
кнопку «вниз», решения медиа (какая копия, ключ, «N из M», окно предзагрузки, правило повтора) выноси в чистые
типы с тестами в `Tests/StudentHubTests`. Контроллер или вид остаётся мостом к UIKit, его проводку проверяй на
iPhone и записывай, что не проверено. Образцы уже есть: `MessageTimeline` («чистая функция без UIKit и без базы»,
`MessageTimelineTests`), `MessageStackGeometry` (`MessageStackGeometryTests`), `MessageHeightEstimate`,
`MessageCodeBlocks` (`MessageCodeBlocksTests`), `ChatMediaWindow`, `ImageTarget` (`ImageTargetTests`),
`RadiusScaleTests`.
**Почему.** У Telegram размещение панелей, кнопок и тостов, значки и номера сетки, выбор «дыры», арифметика свёрнутых
цитат вынесены в чистые функции с хостовыми тестами. Приватную раскладку тестом не достать.
*Источник: `docs/iphone-duo-layout.md` («Checking a screen»); `docs/app-unit-tests.md` (`UndoUITests`, `ItemListUITests`, `ReactionContextGeometryTests`); `submodules/TelegramUI/Components/News/CLAUDE.md` (вступление, `NewsFeedSupport`); `submodules/MediaPickerUI/CLAUDE.md`; `submodules/TelegramUI/Components/PeerInfo/PeerInfoVisualMediaPaneNode/CLAUDE.md` (`:MediaGridPaneDecisionsTests`); `docs/superpowers/plans/2026-10-28-shared-media-grid-stage1.md` (Task 6); `docs/instantpage-richtext.md` («Collapsed quotes», «Testability»)*

#### 2.4.2 Решение под тестом — без локализованных строк и живых системных объектов
**Правило.** Чистые решения возвращают перечисления, числа и ключи (например, `(index, total)` вместо строки
«3 из 10»), а текст собирает вид через `String(localized:)`. Строку под тестом сравнивай по ключу. В решениях не
должно быть `UIWindow`, `UIApplication.shared`, Keychain и сети. Тест не зависит от языка симулятора и каталога
`Localizable.xcstrings`.
**Почему.** У Telegram `PresentationStrings` не строятся в процессе тестов и падают на assert. Так же вынесены
решения из приватных или живых объектов: `NotificationContent` приватен, `UIWindow` в бесхостовом процессе падает
при выходе.
*Источник: `CLAUDE.md` («Running tests»); `docs/app-unit-tests.md` (EditableTokenList, NotificationService, LegacyMediaPicker); `docs/superpowers/plans/2026-10-27-media-picker-grid-stage2.md` (Task 5)*

#### 2.4.3 Тест — на самом низком уровне, который воспроизводит дефект; с шапкой
**Правило.** По умолчанию пиши тест в `StudentHubTests`: размеры, состояния, разбор, снимки. В `StudentHubUITests` —
только если дефект в доставке ввода: курсор, жесты пузыря (свайп, меню, двойной тап), клавиатура, автокоррекция,
IME. Скриншоты прикладывай `XCTAttachment`, длинные наборы отправляй в nightly. Над тестом-регрессией — шапка: что
сломалось, как увидели, уровень и почему.
**Почему.** У Telegram юнит-уровень берут, если неверна модель после правки, а XCUITest — только для пути касания.
*Источник: `Tests/ComposerHarness/CLAUDE.md` («Which tier a regression test belongs in»); `Tests/WidgetHarness/CLAUDE.md` («Which tier»)*

#### 2.4.4 Первый ответчик, клавиатура и жесты пузыря — UI-тест в приложении
**Правило.** Клавиатуру, меню по долгому нажатию, двойной тап и свайп ответа проверяй в `StudentHubUITests` на mock
API, а не в `StudentHubTests`.
**Почему.** У Telegram в голом юнит-тесте нет `UIApplication` и окна: поле не может стать первым ответчиком, а
двойной тап не проходит через обработку жестов пузыря.
*Источник: `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` (§5 V3)*

#### 2.4.5 Тест зовёт общий код, а не копию замыкания экрана
**Правило.** Логику, которую нужно проверить (что отправится, нормализация, переключение списков), держи в чистых
типах (`ComposerFormat`, `ComposerList`, `ComposerFormatting`), которые зовут и экран, и `StudentHubTests`. В тесте
её не дублируй.
**Почему.** У Telegram тест, скопировавший замыкание чата, проверял копию. Решение вынесли в модуль, который видят
и чат, и тест.
*Источник: `Tests/ComposerHarness/CLAUDE.md` («Call the chat's shared code, never copy a chat closure»; «The send-path oracle (p20)»)*

#### 2.4.6 Тест собирает объект тем же путём и с той же конфигурацией, что прод
**Правило.** Тесты поля и модели создают объекты так же, как экран: `ComposerTextController` + `attach`,
`ChatThreadModel` с теми же зависимостями через инициализатор прод-кода. Упрощённый конструктор с другими
умолчаниями не годится. В снимках и UI-тестах передавай `MessageBubbleView` те же замыкания и
`MessageCapabilities`, что и `MessageListView`. «Удобные» заглушки, меняющие ветвление, запрещены.
**Почему.** У Telegram голый `IDDocumentCanvasView()` брал бэкенд по умолчанию, и все тесты «нового» бэкенда
проверяли старый. Ненулевой `tapMessage` в моке заставлял пузырь брать каждый тап как одиночный, и двойной не
доходил.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/InputBackend/CLAUDE.md` («Backends and selection»); `Tests/WidgetHarness/CLAUDE.md` («Synthetic»)*

#### 2.4.7 Настоящий код поверх синтетического окружения; что синтетика — записано
**Правило.** UI-тесты на mock API (`SH_UITEST_MOCK=1`, `Sources/App/UITesting`) и `MessageBubbleSnapshotTests`
проверяют настоящие экраны и `MessageBubbleView`/`MessageListView`, упрощёнными видами их не подменяй. Синтетика
здесь — сеть и данные. Расхождения в фикстурах — не баги продукта. Выводы о сети и синхронизации из таких тестов
предварительны до проверки на живом `pnpm dev` или Railway. Мок расширяй новыми сценариями по договорённости, а не
«чтобы позеленело».
**Почему.** У Telegram стенды держат настоящую панель ввода и настоящие пузыри над поддельным контекстом. Баги против
подделок не заводятся, а выводы о раскладке вокруг пузыря предварительны.
*Источник: `Tests/ComposerHarness/CLAUDE.md` («What this is, and what it is not»); `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («The widget harness»); `Tests/WidgetHarness/CLAUDE.md` («What is real and what is synthetic»)*

#### 2.4.8 Поведение под флагом — в обоих положениях
**Правило.** Новая ветка кода под `PerformanceFlags` проверяется в обоих положениях: `SH_PERF_FLAGS=all=0` / `all=1`
(поле `perf_flags` в `ios.yml`), `PerformanceFlagUITests`, `MessageBubbleSnapshotTests` с флагом и без. Снимки и
UI-тесты ленты гоняй в том положении, что в сборке, и во втором. Добавляя флаг, добавь его в эту матрицу.
**Почему.** У Telegram жесты, проходившие под старым списком, падали под новым. Приёмка новой сетки включает дымовую
проверку старой после переключения, а каждый класс тестов виджетов идёт в обоих режимах исполнителя.
*Источник: `docs/superpowers/specs/2026-10-27-media-picker-grid-stage2-design.md` («Verification»); `docs/superpowers/plans/2026-10-27-media-picker-grid-stage2.md` (Task 7 Step 2); `Tests/WidgetHarness/CLAUDE.md` («Real too: the list»); `docs/superpowers/plans/2026-10-13-message-widgets.md` (Task 7, `TestSupport`)*

#### 2.4.9 Что автоматизация не может воспроизвести — юнит-тест чистой части и руки
**Правило.** Прерывания анимаций (касание посреди пружины, «вниз» во время перехода к сообщению) проверяй тестами
чистых частей (`MotionTests`, `GesturePhysicsTests`) и на iPhone руками.
**Почему.** У Telegram вызов инструмента касания занимает 0,8–2,5 с, и два тапа внутри анимации 0,5 с не получить.
Этот случай закреплён юнит-тестом.
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` («Verifying against native»); `docs/superpowers/specs/2026-10-15-navbar-split-right-buttons-design.md` («Results»)*

#### 2.4.10 Проверяемое поведение — в наблюдаемом, а не за `assert` или логом
**Правило.** Поведение, которое нужно проверить, выводи в возвращаемое значение, состояние или счётчик. Ветки, где
срабатывает только `assert` или пишется только лог, тестом не проверить.
**Почему.** У Telegram XCTest падает на `assert`, а строки лога стенд не читает.
*Источник: `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§9)*

#### 2.4.11 Обход бага iOS — с комментарием и тестом, который поймает возврат
**Правило.** У каждого обхода бага iOS (стекло без `contentShape`, PhotosPicker в строке Form, клавиатура iOS 26/27,
обходы симулятора в UI-тестах из `MOTION_TESTING_REPORT.md`) должен быть комментарий с версией iOS и симптомом. Где
возможно, добавь тест (UI-тест на mock), который детерминированно падает при возврате бага или громко сообщает,
что обход больше не нужен.
**Почему.** У Telegram баг `MTLBinaryArchive.serialize` закреплён тестом с зомби-объектами, чтобы регрессия падала
всегда, а не иногда. Обновление зависимости, при котором заплатка перестаёт применяться, должно валить сборку.
*Источник: `submodules/MetalEngine/CLAUDE.md` (`MetalPipelineCacheTests`); `build-system/bazel-patches/CLAUDE.md` («xctestrunner-collect-test-diagnostics.patch»)*
**Применимость.** частично — Metal нет, переносится принцип.

#### 2.4.12 Изменил общий контекст — обнови моки и дублёры
**Правило.** Изменение `AppServices`, `APIClient` или DTO требует поправить `Sources/App/UITesting`
(`MockAPIProtocol`, `MockFixtures`, `UITestBootstrap`) и тестовые дублёры (`SessionRefreshing`, `SecretStore`,
`ChatsFetching`) и проверить их `swiftc -typecheck`.
**Почему.** У Telegram стенд поля ввода со стабами собирается отдельно и ломается от любого изменения общего API.
*Источник: `docs/superpowers/postbox-refactor-log.md` («A `SharedAccountContext` change needs the composer harness stub regenerated…»)*

### 2.5 Приёмы: синхронизация, оракулы, инварианты, контракты

#### 2.5.1 Синхронизацию держат тесты на настоящем хранилище и сценарном дублёре сети
**Правило.** Тесты синхронизации (`MessageSyncTests.swift`, `ChatSyncTests.swift`, `RealtimeCoordinatorTests`,
`OutboxServiceTests`, `OptimisticSyncTests`) строй на `AppDatabase.inMemory()` и протоколах-дублёрах
(`ChatsFetching`, `ChatMessagesFetching`, `RealtimeTransport`). Утверждай, какие запросы ушли, что лежит в базе и
какие сигналы выставлены.
**Почему.** У Telegram настоящий менеджер состояния работает поверх временной базы со сценарным сервером
(`ScriptedServer`: ответы по порядку, `hold`/`release`, `pushInline`, `requestNames`). Стоимость считается по
именам запросов.
**Сейчас у нас.** частично: дублёры считают только число вызовов (`calls`), журнала имён запросов и «удержания»
ответа (чтобы событие сокета пришло, пока запрос в пути) нет. Без них гонки из §9 не закрепить.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («Behaviour is pinned by `Tests/StateSync`»); `docs/state-sync.md` («Changing state sync safely», «Cost model»)*

#### 2.5.2 Модель сервера и случайные сеансы
**Правило.** Модель сервера на тех же протоколах с `AppDatabase.inMemory()` строй как юнит-тест на CI с
фиксированным набором сидов. Сеансы доводи до покоя: нет новых запросов N мс, а не маркер очереди. Затем сравни
пропавшие сообщения, призраков, устаревшие и «не сошлось». Новый падающий сид получает ужатый тест до исправления.
Первые цели: «разрыв по seq», «список не двигает позицию», «поздний ответ не воскрешает и не откатывает».
**Почему.** У Telegram модель сервера прогоняет случайные сеансы с входящими, правками, удалениями, убийством
приложения, офлайном, потерянными, двойными и переставленными пушами и задержкой 0–50 мс. Зависшая очередь маркер
покоя не пройдёт.
*Источник: `docs/state-sync.md` («The truth server»); `docs/superpowers/reports/2026-10-25-state-sync-truth-run.md` (§1–§9)*
**Применимость.** частично — у нас это новая работа, только по согласию владельца.

#### 2.5.3 Изменение порядка — 20 прогонов подряд
**Правило.** Правку порядка операций в `RealtimeCoordinator`, `OutboxService` или догоне прогоняй на CI командой
`-only-testing:StudentHubTests/RealtimeCoordinatorTests -test-iterations 20 -run-tests-until-failure` (ручной запуск
workflow). Зависание — регресс.
**Почему.** У Telegram правка порядка или раннера проходит 20 полных прогонов подряд без единого зависания.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md`; `docs/state-sync.md` («An ordering or runner change passes 20 consecutive full-suite runs…»)*

#### 2.5.4 Флак — повтор, принудительное чередование, классификация
**Правило.** Флак теста синхронизации повтори N раз (`-test-iterations`). Добавь в дублёр крючок, который
выстраивает подозреваемый порядок, и отнеси флак к одному из трёх видов: A — стенд, B — гонка в продукте, C — среда.
Гонку продукта не «чини» задержкой в тесте.
**Почему.** У Telegram флак около 2 % проявился только при сотнях повторов в одном процессе. Крючок дал 20/20
зависаний против 1/20 без него. Это оказалась гонка в продукте, и её не прятали подгонкой стенда.
*Источник: `docs/superpowers/reports/2026-10-15-state-sync-q13-poll-result-loss.md` («Runs», «Classification»)*

#### 2.5.5 Инкрементальное обновление = полная пересборка (случайный оракул)
**Правило.** Инкрементальные пути (`MessageStackGeometry.setHeight` / `recompute(from:)`, окно
`chatWindowedObservation`, применение дельт `/updates` по `seq`) покрывай тестом «N случайных изменений
инкрементально == построить заново». Для геометрии: случайные `setHeight` против `init(sections:)`.
**Почему.** У Telegram каждое обновление виджета — патч. Оракулы `testRandomEditsMatchARebuild` и
`testOpsMatchAFreshMirror` сравнивают его с полной сборкой, а отказ патча — внутренняя ошибка, а не тихая
пересборка.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Every flush after the boot is incremental»)*

#### 2.5.6 Случайная грамматика с фиксированным зерном
**Правило.** Для `MessageStackGeometry` и `MessageTimeline` заведи стресс-тест: случайные вставки, удаления и смены
высот с фиксированным зерном и проверкой инвариантов (монотонные рамки, сумма высот = `contentHeight`,
уникальность id). При падении печатай зерно и префикс действий, падение сворачивай в фокусный тест. Отдельный тест
проверяет, что генератор действительно выдаёт все виды действий.
**Почему.** У Telegram так устроен `MixedPassStressTests`: новые виды действий идут на отдельном генераторе, чтобы не
было «пустого» покрытия.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` («Tests», `MixedPassStressTests`)*

#### 2.5.7 Инварианты — после каждого теста набора
**Правило.** В тестах `ImageDownloads`, `ImageDiskCache` и `ImageMemoryCache` (`ImageDiskCacheTests.swift`,
`FeedRenderingTests.swift`) после каждого теста делай общую проверку: одна загрузка на ключ (`inFlightCount`),
после выхода из аккаунта ничего не записано, отменённый ждущий не держит загрузку.
**Почему.** У Telegram общий харнесс плеера после каждого теста проверяет инварианты (ни один диапазон не скачан
дважды и т. п.), а не только ожидаемый результат.
*Источник: `docs/native-hls-player.md` («Tests»)*

#### 2.5.8 Тест «каждое поле учтено»
**Правило.** `MessageStore.upsert` (`Core/Chats/MessageStore.swift:175`) копирует поля в `MessageRecord` вручную:
`seq`, `content`, `editedAt`, `deletedAt`, `pinnedAt`, `absorb`. Нужен тест: сообщение со всеми заполненными полями
→ `upsert` поверх существующей строки → каждое значение столбца совпадает с `MessageRecord(server:)`. Новый столбец,
для которого в `upsert` нет решения, уронит тест.
**Почему.** У Telegram поле со значением по умолчанию компилируется и теряется при каждом слиянии, поэтому число
полей закреплено тестом (`testStoredFieldCountMatchesEveryInitAndUnion`).
*Источник: `docs/state-sync.md` (инвариант 23)*

#### 2.5.9 Две записи одного контракта сверяются тестом
**Правило.** DTO в `Core/*API.swift` и схемы `packages/shared-schemas` — две записи одного контракта. Сверку держат
`APIContractTests` и `ParityTests` (общие правила с вебом). Меняешь поле — меняешь обе записи и тест.
**Почему.** У Telegram смещения записаны и в Swift, и в таблице, и согласие между ними проверяет `AccessorProbeTests`.
*Источник: `submodules/TelegramApi/CLAUDE.md` («Offsets are baked into Swift and into the table; they must agree»)*

#### 2.5.10 Проверку держать на выходе, а не в общем разборщике, и закрепить тестом
**Правило.** Проверку внешних ссылок на «логин» перед хостом не встраивай в `DeepLink`/`RichText` — они служат и для
отображения. Ставь её только в открыватель ссылок. Тест в `StudentHubTests` с примерами: `user@host`, U+2215,
U+2044, punycode-двойник, markdown с чужим адресом.
**Почему.** У Telegram такая проверка в общем `parseUrl` поменяла бы заголовок списка общих ссылок. Поведение
закреплено `UrlWhitelistTests`.
*Источник: `submodules/UrlWhitelist/CLAUDE.md` («Keep the check out of `parseUrl`…»; «`UrlWhitelistTests` … pins `externalUrlWithLoginPart`»)*

#### 2.5.11 Эталон рендера Markdown — веб
**Правило.** Для Markdown эталоном служит веб (`react-markdown` + GFM). Заведи набор строк-фикстур с ожидаемыми
сущностями (что жирное, что ссылка, где код) и тест в `StudentHubTests`, что iOS-разбор даёт те же сущности.
Расхождения веди списком.
**Почему.** У Telegram вид виджетов следует ответам Chromium, закреплённым набором соответствия, а расхождения
записаны.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Rendering follows Chromium's answers…»)*

#### 2.5.12 Внешняя установка и правка пользователя — разные пути и в тестах
**Правило.** В тестах поля внешнюю установку (черновик с другого устройства, очистка после отправки) делай через
`model.draft = …` и утверждай пустую историю отмены. Правку пользователя делай через `ComposerTextController.insert` /
`apply` и утверждай одну ступень отмены.
**Почему.** У Telegram тест, моделировавший одно через другое, проверял не то.
*Источник: `Tests/ComposerHarness/CLAUDE.md` («External content sets and timing»: «Two routes into the composer»)*

#### 2.5.13 Оракул сравнивает подобное с подобным
**Правило.** Если не уверен, так ли должен вести себя `UITextView`, воспроизведи ту же последовательность действий
на чистом `UITextView` в тесте-контроле. Сравнивай с ним по тем же нажатиям, а не по той же итоговой строке.
**Почему.** У Telegram оракул, набиравший после отмены, сравнивал с состоянием, которое отмена перерисовала.
*Источник: `Tests/ComposerHarness/CLAUDE.md` («The composition oracle compares like with like»)*

#### 2.5.14 Помощник теста не меняет того, что отдаёт в продукт
**Правило.** Канонизация строк и записей в тестах нужна только для сравнения. В продукт (в `draft`, в API мока)
подавай исходное значение.
**Почему.** У Telegram нормализатор в фаззе склеил два одинаковых emoji и отправил в редактор модель, которую тот
никогда не создаёт.
*Источник: `Tests/ComposerHarness/CLAUDE.md` («The fuzz's normaliser keeps atoms apart»)*

#### 2.5.15 Набор тестов подсистемы перечислен рядом с ней
**Правило.** Для ленты и пузыря держи перечень тестов: `MessageStackGeometryTests`, `MessageTimelineTests`,
`MessageCodeBlocksTests`, `RichTextCacheTests` (`FeedRenderingTests.swift`), `ComposerFormattingTests`,
`MessageBubbleSnapshotTests`, `PerformanceFlagUITests`, `ScrollSmoothnessTests`. Запуск — CI (`scripts/test.sh`,
`scripts/ci-results.sh`).
**Почему.** У Telegram справочник подсистемы перечисляет все её цели тестов и способ запуска.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Tests»)*

### 2.6 Надёжность самого теста

#### 2.6.1 Ждать условие с таймаутом, а не паузу и не один виток
**Правило.** Отложенное (`draftTask` в `ChatThreadModel`, `DispatchQueue.main.async` в `updateUIView`, вставку из
буфера) жди ожиданием по условию: `XCTNSPredicateExpectation` на смену значения с запасом до 3 с. Фиксированная
пауза и `main.async { fulfill }` не годятся.
**Почему.** У Telegram `main.async { fulfill }` не дожидался `asyncAfter`. Обычная вставка в `UITextView` приходит
через 20–30 мс, первая HTML-вставка в процессе — около секунды. Фиксированная пауза давала «двойную вставку» в
следующем кейсе.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Verification traps»); `Tests/ComposerHarness/CLAUDE.md` («External content sets…»: paste settle)*

#### 2.6.2 Объект под тестом держать живым до конца
**Правило.** В `StudentHubTests` держи сильную ссылку на `ComposerTextController`, `UITextView` или модель до конца
теста, иначе отложенный проход сработает против мёртвого объекта.
**Почему.** У Telegram объект, который никто не держал, умирал до отложенного прохода, и тест «ничего не произошло»
проходил впустую.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Verification traps»: canvas nobody retains)*

#### 2.6.3 «Ровно один» — считать за окно, а не ждать
**Правило.** Проверки «ровно одно `onChange` / одна запись черновика / один запрос» строй счётчиком за окно времени.
Перед счётом слей события, которые послала сама подготовка.
**Почему.** У Telegram ожидание возвращается на первом колбэке, и дубль на следующем витке невидим.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Verification traps»); `Tests/ComposerHarness/CLAUDE.md` («Discipline»: «Count, do not wait»)*

#### 2.6.4 Таймер должен сработать, а не только запуститься
**Правило.** В юнит-тестах таймерной логики (живая геопозиция, истечение, повторы realtime) используй внедряемый
планировщик или явное ожидание `XCTestExpectation` и проверяй, что таймер действительно сработал.
**Почему.** У Telegram, если тест не прокручивает главный run loop, сценарии с таймерами проверяли только старт.
*Источник: `docs/superpowers/specs/2026-10-13-message-widgets-design.md` («Open items» п. 5)*

#### 2.6.5 Время, случайность, часовой пояс и локаль — внедряемые
**Правило.** Логика с «сейчас» (живая геопозиция `isLive(at:)`, чётность недели, «вчера/сегодня» в ленте, сроки)
принимает `now`, календарь и часовой пояс параметром. Тесты фиксируют `TimeZone` и `Locale` и не полагаются на
настройки раннера CI.
**Почему.** У Telegram время скриптов идёт от хоста, случайность — от зерна. `Date` читает часовой пояс процесса,
поэтому повторяемый прогон фиксирует `TZ`, а лимиты тестируются на фейковых часах.
*Источник: `docs/message-widgets-native-runtime.md` («Time is the host's»; «Only the CPU limits read a clock»); `docs/superpowers/specs/2026-10-29-message-widgets-cpu-clock-limits-design.md` («Tests»)*

#### 2.6.6 Тест не трогает живое глобальное состояние процесса
**Правило.** Тесты не активируют `AVAudioSession`, не пишут в `UserDefaults.standard`, Keychain и настоящую базу —
только во внедрённые заглушки. Политику голосовых (кто владеет аудиосессией, пауза музыки, системный звонок) держи
в чистом автомате, как `VoiceRecordingMachine` (`VoiceRecordingMachineTests`), а не в `VoicePlayback.swift`.
**Почему.** У Telegram настоящий менеджер аудиосессии строится в тестах без активации (`manualActivate`), и сессия
процесса не трогается. Записывающему устройству нужны живые аудиоустройства, поэтому политику держат в
тестируемых помощниках.
*Источник: `docs/app-unit-tests.md` (`TelegramAudioTests`)*

#### 2.6.7 Изменённое тестом глобальное состояние вернуть в `defer`
**Правило.** Тесты, меняющие `PerformanceFlags.overrides`, тему, Dynamic Type, `KeyboardFrame` или синглтоны
(`MessageMenuTouch.shared`, `BubbleAnchors.shared`), возвращают их в `defer` или `tearDown`.
**Почему.** У Telegram переключённый бэкенд, ширина и поворот возвращаются в `defer`: остальные кейсы рассчитывают на
исходное состояние.
*Источник: `Tests/ComposerHarness/CLAUDE.md` («The arrange channel», «Width, rotation»)*

#### 2.6.8 Живое хранилище текста копировать перед сравнением
**Правило.** `UITextView.textStorage` — живой объект. Снимай `NSAttributedString(attributedString:)` или `text` до
действия, иначе «до» и «после» окажутся одним объектом.
**Почему.** У Telegram геттер `BlockLayoutEngine.attributedString` отдавал живое хранилище, и сравнение шло с самим
собой.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Verification traps»)*

#### 2.6.9 Сначала утвердить предусловие, иначе тест проходит вхолостую
**Правило.** UI-тест прокрутки внутри поля (6+ строк, `maxLines`) сначала утверждает, что поле действительно
прокручивается (высота контента больше рамки), и только потом — что курсор в кадре.
**Почему.** У Telegram регрессия прокрутки к курсору проходила вхолостую на фикстуре, которая не переполняла поле.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Verification traps»: «Caret-reveal tests can pass vacuously»)*

#### 2.6.10 Тест «что на экране» — вид в окне и непустая выборка
**Правило.** Юнит-тесты анимации или положения видов размещают вид в `UIWindow` и утверждают, что выборка
(`presentation()`, кадр) не `nil`. Иначе тестируй чистую функцию (`MessageStackGeometry`, `MotionTests`).
Правильность подтверждай мутацией.
**Почему.** У Telegram фикстуры не были в дереве рендера, `presentation()` возвращал `nil`, и тест проходил впустую.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` («Tests»: «The suite is blind to the resume provider…»)*

#### 2.6.11 Тестируемый вид — не в начале координат
**Правило.** Юнит-тесты попадания и геометрии (меню, якоря, свайп) ставят вид в хост со смещённым началом
(например, y = 100), а где нужно — в `UIWindow`.
**Почему.** У Telegram отсоединённый вид случайно совпадал по координатам с родителем, и тест не видел промахов
нажатий.
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` («Pitfalls: Taps and hit testing»)*

#### 2.6.12 На `sendActions` в юнит-тестах не полагаться
**Правило.** Действия контролов проверяй вызовом обработчика или метода модели, а не `UIControl.sendActions(for:)`.
**Почему.** У Telegram в тесте без `UIApplication` `sendActions` уходит в никуда.
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` («Pitfalls»: «No `UIApplication` in `ios_unit_test`»)*
**Применимость.** частично — `StudentHubTests` у нас работают в хосте приложения, но надёжнее звать обработчик.

#### 2.6.13 Масштаб экрана в геометрических тестах — явный
**Правило.** Чистые геометрические функции (`MessageStackGeometry`, оценка высоты) не читают `UIScreen.main.scale`:
масштаб передаётся параметром, а тест проверяет на 3.0. Снимки снимаются в фиксированной среде `ios26@3x`.
**Почему.** У Telegram тестовый процесс сообщает экран 1x, где привязка к пикселю — просто `floor`, и тест про сетку
без явного `screenScale: 3.0` не может упасть.
*Источник: `docs/instantpage-richtext.md` («Text Size / content scale»: «The test process reports a 1x screen»)*

#### 2.6.14 Пиксели вне экрана — через `layer.render(in:)`
**Правило.** В `StudentHubSnapshotTests` и самописных пиксельных проверках вне экрана снимай через
`layer.render(in:)` поверх непрозрачной заливки. Учитывай, что этот способ игнорирует `maskedCorners`. Скан чернил
веди с точностью до пикселя устройства.
**Почему.** У Telegram `drawHierarchy(afterScreenUpdates:)` вне экрана давал чёрный кадр.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` («Verification traps»: «Pixels»)*
**Применимость.** частично.

#### 2.6.15 Утечки — по росту на цикл, каждая итерация в `autoreleasepool`
**Правило.** В `StudentHubPerfTests` мерь память по нескольким циклам с `autoreleasepool` на каждую итерацию и суди по
росту на поздних циклах (исключив один самый большой шаг), а не по абсолюту.
**Почему.** У Telegram без `autoreleasepool` 1000 циклов выглядели утечкой на 1,9 ГБ.
*Источник: `Tests/ComposerHarness/CLAUDE.md` («The endurance guard judges per cycle»; «Timing and memory loops need an `autoreleasepool`»)*

#### 2.6.16 Тест проверяет, что модели и база отпущены
**Правило.** В тестах синхронизации держи `weak`-ссылку на `ChatThreadModel`, `RealtimeCoordinator` и `AppDatabase` и
в конце жди `nil` с таймаутом. Так тест поймает утечку модели чата: бесконечный `for await` с сильной ссылкой —
см. комментарий в `ChatThreadModel.observeMessages` (`Features/Chats/Thread/ChatThreadModel.swift:1514`).
**Почему.** У Telegram тест, после которого Postbox ещё удерживается через 5 с после `close()`, падает. Намеренное
удержание допускается только с причиной (`retainedPostboxAtCloseReason`).
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md`*

#### 2.6.17 Пороги времени — порядки величины, с запасом и из замера
**Правило.** Точные времена проверяй в `StudentHubPerfTests` против `perf-baseline.json`. В юнит-тест ставь порог
только на порядок величины (O(1) против O(n) на 100 000 элементов), не точные миллисекунды. Пороги (baseline,
ограничения карточек) выставляй по замеру на `SH_UITEST_LARGE=1`, с запасом и с записью, откуда взято число.
**Почему.** У Telegram юнит-тесты держат пороги горячих операций («10k lookups < 5 ms»). Планку «четверть окна» не
приняли вслепую: честный виджет сам укладывается в 82 мс из 100.
*Источник: `docs/superpowers/plans/2026-10-27-media-grid-thumbnail-store.md` (Task 1–2); `docs/superpowers/specs/2026-10-29-message-widgets-cpu-clock-limits-design.md` («Tests»)*

#### 2.6.18 Перетаскивание — всегда парой колбэков
**Правило.** В тестах ленты эмулируй перетаскивание парой `scrollViewWillBeginDragging` / `scrollViewDidEndDragging`,
никогда одним из них. Пакетные обновления — через те же хуки движка, что в приложении.
**Почему.** У Telegram «начало» без «конца» оставляло движок в режиме трекинга. Стенд копит обновления и шлёт их
одной транзакцией (`holdsUpdates`, `flushUpdates()`).
*Источник: `Tests/WidgetHarness/CLAUDE.md` («Resize anchors»)*

### 2.7 UI-тесты и mock-стенд

#### 2.7.1 UI- и perf-тесты — на изолированном стенде, не против прода
**Правило.** Новый UI-тест наследует `MockUITestCase` (`SH_UITEST_MOCK=1`): фикстуры вместо сети, без сокета и
пушей, чистое состояние (`UITestBootstrap.prepare`), только Debug, учётка `student@test.local`. Живой сервер нужен
только `ChatFlowsUITests` с учёткой из `TEST_RUNNER_SH_UITEST_LOGIN/PASSWORD`. Сценарии, которые что-то нажимают и
отправляют, не гоняй на iPhone владельца с его настоящим аккаунтом — только на mock или с явного согласия.
**Почему.** У Telegram флаг `--ui-test` даёт отдельный каталог данных, который стирается при каждом запуске, и
тестовые серверы, а без флага тест работает с продом. Демо и тесты сетки гоняют только на выделенном симуляторе,
а не там, где выполнен вход в Telegram.
*Источник: `docs/ui-testing.md` («Test Environment», «Always pass --ui-test»); `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Run only on the dedicated simulator»)*

#### 2.7.2 Тестовое приложение герметично
**Правило.** При `SH_UITEST_MOCK=1` в сеть не уходит ничего. Сокет подменяет `MockRealtimeTransport`
(`App/UITesting/UITestEnvironment.swift:78`), `APIClient` и `URLSession.shared` перехватывает `MockAPIProtocol`.
Загрузки, которые идут мимо `URLProtocol` (AVPlayer/AVFoundation), в mock-сценарии не допускай или проверяй по
журналу.
**Почему.** У Telegram флаг «не держать соединение» не мешал дозвону к серверам. Дыру закрыли прокси на
`127.0.0.1:1` и проверили по журналу.
*Источник: `Tests/ComposerHarness/CLAUDE.md` («The harness is hermetic»)*

#### 2.7.3 Заглушка падает с именем, а не возвращает правдоподобное
**Правило.** В моке (`MockAPIProtocol`) и тестовых подменах сервисов неописанный маршрут или метод — громкая ошибка с
именем, а не пустой успех.
**Почему.** У Telegram заглушка, возвращавшая `false`, была неотличима от верного ответа и стоила пяти сессий
отладки.
**Сейчас у нас.** соблюдено: неописанный маршрут отвечает 404 «Mock: маршрут не описан» (`App/UITesting/MockAPIProtocol.swift:158`).
*Источник: `Tests/ComposerHarness/CLAUDE.md` («Unprovided members trap and name themselves»)*

#### 2.7.4 Ждать элемент, искать по идентификатору
**Правило.** Перед взаимодействием вызывай `waitForExistence(timeout:)` (`MockUITestCase.timeout` = 15 с), ассерты
ставь на конечные состояния, `sleep` не используй. Тесты идут на русском (`-AppleLanguages (ru)`,
`MockUITestCase.swift:53`), поэтому ищи по `accessibilityIdentifier` вида `auth.signIn`, а не по тексту: смена
перевода не должна ломать тест.
**Почему.** У Telegram перед взаимодействием всегда `waitForExistence`, элементы ищут по идентификатору
доступности, метке и типу.
*Источник: `docs/ui-testing.md` («Key Patterns»)*

#### 2.7.5 В дереве доступности — только видимое; кнопка — один элемент
**Правило.** `LazyVStack` и `UICollectionView` ленты реализуют только видимое, поэтому в тесте сначала прокрути до
элемента. Идентификатор ставь на `Button`, а не на `Text` внутри, иначе запрос найдёт не кнопку. Учитывай копию кнопки
вкладки под «линзой» Liquid Glass на iOS 26 (`Tests/UIShared/TabBarButtons.swift`).
**Почему.** У Telegram скрытое, прозрачное, нулевое и обрезанное в дерево не попадает, список отдаёт одну строку за
каждым краем, а компоненты-кнопки — один элемент.
*Источник: `docs/ui-testing.md` («The tree holds only what is on screen»)*

#### 2.7.6 Каждый тест — с чистого запуска
**Правило.** `MockUITestCase.setUpWithError` запускает приложение на каждый тест, `relaunch(environment:)` даёт чистый
перезапуск с другим окружением. Тест не зависит от порядка и от предыдущего теста.
**Почему.** У Telegram каждый `launch()` с `--ui-test` стирает базу, и каждый тест получает свежее состояние.
*Источник: `docs/ui-testing.md` («Relaunch between tests»)*

#### 2.7.7 Решение о пропуске — до `launch()`
**Правило.** `XCTSkip` вызывай до запуска приложения.
**Почему.** У Telegram `XCTSkip` после `app.launch()` превращается в провал «Application is not running».
**Сейчас у нас.** соблюдено: `ChatFlowsUITests` пропускается по `SH_UITEST_LOGIN` до `launch()`
(`Tests/StudentHubUITests/ChatFlowsUITests.swift:18`, запуск — `:21`).
*Источник: `Tests/ComposerHarness/CLAUDE.md` («Tier 2 cannot skip after launching»)*

#### 2.7.8 Подготовка — через окружение запуска; имя сценария — контракт
**Правило.** Состояние готовь переменными `SH_UITEST_SCENARIO`, `SH_UITEST_LARGE`, `SH_UITEST_REDUCE_MOTION`,
`SH_UITEST_HISTORY_DELAY_MS`. Тест синтезирует только те касания, которые проверяет. Имена сценариев держи
константами, а перед действием проверяй видимый признак того, что сценарий применился.
**Почему.** У Telegram опечатка в аргументе сценария молча давала сценарий по умолчанию, поэтому тест сначала
проверяет метку на экране.
**Сейчас у нас.** соблюдено (#499): неизвестный `SH_UITEST_SCENARIO` в DEBUG роняет запуск (`preconditionFailure`) с
перечнем известных сценариев.
*Источник: `Tests/ComposerHarness/CLAUDE.md` («The arrange channel»)*

#### 2.7.9 Аргументы и переменные запуска разбираются строго
**Правило.** Неизвестный ключ или значение в `SH_UITEST_*` и `SH_PERF_FLAGS` должны быть заметны: лог или падение в
DEBUG, а не молчаливый пропуск.
**Почему.** У Telegram аргумент с двумя дефисами (`--widget-set`) молча игнорировался.
**Сейчас у нас.** соблюдено (#499): неизвестный флаг или значение не 0/1 в `SH_PERF_FLAGS` в DEBUG роняет запуск с
перечнем известных имён.
*Источник: `Tests/WidgetHarness/CLAUDE.md` («The arrange channel»: «One leading dash»)*

#### 2.7.10 Состояние экрана для тестов — табло доступности; формат — контракт
**Правило.** Значения, которые UI-тесты читают через `accessibilityIdentifier` / `accessibilityValue` (например,
`chat.composer.editor`), считай контрактом: менять только вместе с тестами, при смене формата — с версией. В `switch`
по нашим перечислениям в таких местах не пиши `default`, чтобы новый случай не прошёл молча. Если ленте понадобится
DEBUG-табло (размер, центр, состояние пузырей), его формат описывается рядом с кодом. `ScrollProbe` таким табло не
является: это системный лог (`idevicesyslog -m ScrollProbe`). Жди нужного значения, а не время.
**Почему.** У Telegram дамп модели — строка формата с версией в `accessibilityValue`, и смена формата правит все
тесты. Тест ждёт ухода из заглушки 160 pt, прежде чем целиться внутрь.
*Источник: `Tests/ComposerHarness/CLAUDE.md` («The model readout — a test contract»); `Tests/WidgetHarness/CLAUDE.md` («The readout — a test contract»)*

#### 2.7.11 Касания в UI-тестах: долгое нажатие, проверка после набора
**Правило.** Курсор ставь через `coordinate.press(forDuration: 0.1)`. Не касайся правого края поля, там кнопки
emoji и ⛶. После `typeText` проверяй значение поля. Гонки фокуса считай на сборке без отладочных логов, потому что
наблюдение меняет частоту гонки.
**Почему.** У Telegram мгновенный tap не ставил курсор, а рамка поля заходит под кнопку «Отправить».
*Источник: `Tests/ComposerHarness/CLAUDE.md` («Driving the simulator: pre-baked hazards»); `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Verification traps»: «Simulator driving»)*

#### 2.7.12 Сценарий прокрутки — история выше экрана и отдельно короткий чат
**Правило.** Тесты поведения ленты при росте строк и подгрузке (`PerformanceFlagUITests`, `ScrollSmoothnessTests`)
используют историю заметно выше экрана (`SH_UITEST_LARGE=1`), а отдельно — короткий чат.
**Почему.** У Telegram чат, помещающийся на экран, не прокручивается, и край там держит только собственная раскладка
списка.
*Источник: `Tests/WidgetHarness/CLAUDE.md` («Resize anchors»)*

#### 2.7.13 Тема и ширина — как в продукте
**Правило.** Снимки пузырей делай в теме и ширинах приложения: узкий, обычный и широкий экран, светлая и тёмная
тема, крупный шрифт (так уже сделано).
**Почему.** У Telegram набор соответствия гоняется на теме приложения для входящего пузыря темы по умолчанию — как в
продукте.
*Источник: `Tests/WidgetHarness/CLAUDE.md` («The conformance set»)*

#### 2.7.14 Обвязки и замеры зовут те же входы, что и приложение
**Правило.** `ScrollBenchmark`, `ScrollSmoothnessTests` и `PerformanceFlagUITests` двигают ленту настоящими жестами
XCUITest или теми же методами контроллера, что и приложение (`scrollToBottom(token:)`). Прямая запись `contentOffset`
в обход логики не годится.
**Почему.** У Telegram стенд с чужим распознавателем не звал `noteTouchDown`, множитель повторных взмахов застревал
на 1, и замер врал.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` («Scroll engine and physics»: «Harnesses must drive production's entry points»)*

#### 2.7.15 Частный API в тестах — понятная ошибка, а не краш
**Правило.** Частных API XCTest у нас нет. Если понадобятся, отсутствие класса или селектора должно давать
понятную ошибку, а не падение процесса.
**Почему.** У Telegram мультитач идёт через частный синтез событий XCTest, и при отсутствии класса тест бросает
`MultiTouchError.missing`.
*Источник: `Tests/WidgetHarness/CLAUDE.md` («Which tier»)*
**Применимость.** частично — частного синтеза касаний у нас нет.

#### 2.7.16 Витрина для ручной проверки — mock-сценарий, без сети
**Правило.** Демонстрационные сообщения и карточки показывай только через mock-сценарии (`SH_UITEST_MOCK`,
`SH_UITEST_SCENARIO`, только Debug, фикстуры `Sources/App/UITesting`), а не реальными запросами к Railway. Такие
данные не порождают сетевых вызовов. Для ручной проверки на iPhone и снимков заведи чат-фикстуру «Витрина
сообщений»: Markdown, код, длинные строки, RTL, эмодзи.
**Почему.** У Telegram в DEBUG пункт настроек вставляет набор соответствия локальными сообщениями в «Избранное». Их
нельзя переслать, а их запросы сразу получают отказ.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Local widget messages, for development»); `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` (§5 V1); `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§4 п. 9)*

### 2.8 Данные, фикстуры и эталоны

#### 2.8.1 Эталоны не перезаписывают, чтобы позеленить
**Правило.** Снимки (`Tests/**/__Snapshots__/ios26@3x`), фикстуры `APIContractTests` и `Tests/perf-baseline.json`
при рефакторинге не перезаписывай. Снимки переснимаются только меткой `ios-record-snapshots` на PR (или
`record_snapshots` в `ios.yml`), после этого — посмотреть diff глазами (README). Намеренное изменение или улучшение
закрепляй отдельным коммитом с причиной и картинками или числами. Эталон работает как храповик: падает и на
регресс, и на незаписанное улучшение. Записывать поверх регресса нельзя — регресс надо чинить.
**Почему.** У Telegram эталон, снятый со старой реализации, служит доказательством эквивалентности новой. Golden-файлы
генерируются только скриптом. Поведение, закреплённое тестом-фиксацией, меняется только коммитом, который явно
переснимает ожидание.
*Источник: `submodules/TelegramApi/CLAUDE.md` («`GoldenTests` … never re-record those on the engine»; `Tests/ParseFailureTests.swift`); `submodules/HLSPlayback/CLAUDE.md` («Goldens … regenerate … never by hand»); `docs/native-hls-player.md` («Tests»); `Tests/WidgetHarness/CLAUDE.md` («The baseline is a ratchet»); `docs/message-widgets-native-runtime.md` («Tests»: `WR_GOLDENS_UPDATE=1`); `docs/superpowers/richtext-stock-divergences-followups.md` («The distinction…», «What a follow-up project would need to do»)*

#### 2.8.2 Тестовые данные — с краями и настоящими особенностями
**Правило.** В `MessageTimelineTests`, `MessageStackGeometryTests` и UI-фикстурах (`Sources/App/UITesting`) покрывай
края: пустой чат, одно сообщение, переход к первому и к последнему, разные высоты пузырей (длинный текст, фото,
альбом), смену дня, системные сообщения. Синтетика «50 одинаковых строк, переход к 25-й» покрытием не считается.
**Почему.** У Telegram проверка «коллекции не пересекаются» ни разу не сработала на настоящем чате: служебные строки с
постоянными id переживают замену. Три ошибки подряд жили ровно на краях коллекции.
*Источник: `docs/chat/corelist-chat-history-backend.md` («Scroll to item»: full-replace, constant ids, «Enumerate the edges…»)*

#### 2.8.3 Тестовые данные — несимметричные
**Правило.** Бери двух пользователей с разными id, токены с разным `sub`, не нули и не одинаковые значения, чтобы
ошибка направления или перепутанный аргумент давали падение.
**Почему.** У Telegram фикстура ключа из нулей скрыла бы ошибку направления шифрования.
*Источник: `docs/superpowers/plans/2026-09-16-tgcalls-mtproto-dtls-slot.md` (фикстура ключа из нулей)*

#### 2.8.4 Фикстуры медиа — синтетические, реальные файлы не коммитятся
**Правило.** Картинки и видео для тестов генерируй прямо в тесте (однотонные, градиент, Core Graphics,
`AVAssetWriter`), а команду генерации держи рядом. Фото людей и файлы из реальных чатов в репозиторий не клади.
**Почему.** У Telegram фикстуры плеера создаются ffmpeg (`testsrc2`, синус), а коммитить настоящий сегмент запрещено.
*Источник: `docs/native-hls-player.md` («Tests»: «Never commit a real segment»)*

#### 2.8.5 Фикстуры mock меняются осознанно и вместе с DTO
**Правило.** Ответы mock API (`Sources/App/UITesting/MockFixtures.swift`) и JSON-фикстуры тестов меняй осознанно при
смене контракта, в том же PR, что и DTO. Сборка их не генерирует.
**Почему.** У Telegram фикстуры — побайтовые копии, один раз сгенерированные и закоммиченные. Перегенерация делается
руками при смене исходника.
*Источник: `docs/superpowers/plans/2026-10-13-message-widgets.md` (Task 5 Step 1)*

---
## §3. Визуальная проверка и анимации

Как доказывать, что визуальная правка и анимация сделаны правильно, и как устроены анимации, чтобы не дёргались.
Главная мысль: зелёная сборка и тесты ничего не говорят о том, как правка выглядит и движется. Доказательство —
кадры записи экрана, разобранные со ссылками на номер и время кадра. Без них в отчёте пишется «по кадрам не проверено».

### 3.1 Принцип: кадры, а не сборка

#### 3.1.1 Визуальная правка готова только после разбора кадров
**Правило.** Визуальную или анимационную правку не называть готовой по зелёному `xtool dev build`, `swiftc -typecheck`
или по зелёной проверке «iOS — итог». Доказательство — кадры: видео прогона с CI (`scripts/test.sh` пишет
`artifacts/<набор>/run.mp4`, `scripts/ci-results.sh` скачивает его в `build/ci/<id>/`) или запись экрана iPhone от
владельца. `MotionTests` (физика пружин покадрово) и снимки `StudentHubSnapshotTests` проверяют модель. Кадров
реального движения они не заменяют.
**Почему.** Юнит-тесты фиксируют модель: значения хореографии и рамки. Обрезку, «выпрыгивание», отставание и
перелёт видно только в кадрах.
*Источник: `AGENTS.md` («Visual features and animations: judge them from recorded frames»)*

#### 3.1.2 До записи письменно зафиксировать ожидание
**Правило.** В отчёте по визуальной правке и в брифе субагенту первым идёт блок «Ожидание». В нём перечислить: какие
элементы движутся и какие из них вместе, какая пружина (`Motion.snappy` / `interactive` / `press` / `lively` из
`DesignSystem/Motion.swift`), направление, примерную длительность, сколько раз пружина перелетает. Отдельно —
запрещённые состояния: дыра между пузырями, прыжок ленты, мигание стекла, элемент стоит, пока соседи едут. Потом
кадры сравниваются с этим блоком.
**Почему.** Без заранее записанного ожидания кадры только описывают, а сравнивать их не с чем.
*Источник: `AGENTS.md` («1. Know what correct looks like first»)*

#### 3.1.3 Неверную анимацию мерить, а не разглядывать
**Правило.** Чистые части движения проверять покадровыми тестами модели: `MotionTests` на 60/120 Гц,
`MessageStackGeometryTests`. Видимое на устройстве проверять записью экрана iPhone, разобранной по кадрам
(§3.3). Впечатление «сильно пересекается» переводить в число: сколько pt, какой элемент, в каком кадре.
**Почему.** Telegram превратил «сильное пересечение» на глаз в 348 pt с названным виновником за 15 мс теста, без
сборки приложения: модель анимации сэмплировали на нескольких фазах.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Scroll to item: «when a symptom is a wrong animation, measure it»)*

#### 3.1.4 Отчёт об анимации — со ссылками на кадры
**Правило.** В каждом отчёте агента и в описании PR с визуальной правкой указывать файл записи (путь в
`build/ci/<id>/…` или имя файла владельца), номера и времена кадров. Пример: «#23–#31 (t=0,512–0,645): лента стоит,
пока меню перелетает на 9 pt». Если кадров не смотрели, писать прямо: «по кадрам не проверено». Корневой
`AGENTS.md` требует того же для непрогнанных проверок.
**Почему.** Утверждение об анимации без ссылок на кадры не проверено.
*Источник: `AGENTS.md` (последний абзац)*

#### 3.1.5 Разделять «проверено на экране» и «(код)»; открытое записывать
**Правило.** Исправление раскладки подтверждать изображением с экрана: скриншотом CI, снимком, записью владельца. В
отчёте явно разделять «проверено на экране» и «(код)», то есть проверено только чтением и сборкой. Всё, что требует
устройства, — отдельной строкой «не проверено на iPhone: …». То, что собрано из Linux и не запускалось, называть «не
собрано / не запускалось», а не «работает».
**Почему.** У Telegram исправитель поменял унаследованный узел, а на экране был другой (стеклянная кнопка). Два
ревьюера этого не заметили, поймал только снимок. Поворот, RTL, реальные сообщения и слабое устройство там явно
числятся «Open», а не «сделано».
*Источник: `CLAUDE.md` («iPhone Duo layout», третий пункт); аудит («sticker pack's visible glass button was a different
node… caught by an FP capture, not by the two reviewers»); `iphone-duo-layout.md` («Bug shapes», последний пункт);
R («Open», V6)*

#### 3.1.6 Нет инструмента для касаний — сказать и передать проверку человеку
**Правило.** Локально у нас нет Mac, симулятора и MCP-инструментов. Интерактивная проверка — это либо XCUITest на CI
(`StudentHubUITests`, mock API), либо владелец на iPhone. Агент прямо пишет: «интерактивно не проверено, нужен прогон
CI / проверка на телефоне». Проверку не изображать и обходные пути не искать.
**Почему.** Telegram запрещает скатываться к `cliclick`/`osascript`/`screencapture`: нет прав, попадёшь не в тот
симулятор. Пассивный снимок допустим.
*Источник: `CLAUDE.md` («Driving the simulator UI: use the Xcode MCP server»)*

#### 3.1.7 Невизуальное поведение проверять логом, а не скриншотами
**Правило.** Логику ленты (окно наблюдения, якорь прокрутки, догон) проверять логом: `ScrollProbe.note(...)`
(`Features/Chats/Thread/ScrollProbe.swift`) и `ScrollBenchmark` (пишет отчёт в `tmp` контейнера). Временную
инструментацию снимать до коммита.
**Почему.** Скриншот-тест не нужен, чтобы проверить поведение. Временная инструментация и лог дают ответ быстрее.
*Источник: `submodules/TelegramUI/Components/CoreList/AGENTS.md` (второй абзац)*

#### 3.1.8 Исходы наблюдения заранее расписывать в плане
**Правило.** В плане iOS-работы, которая зависит от проверки на iPhone, заранее писать: «если увидим X — делаем Y,
иначе Z». Причины различать, сравнивая два сценария рядом. Например, въезд своего и чужого сообщения.
**Почему.** У Telegram план заранее говорит, что делать при каждом исходе наблюдения. Решение записывается как
постановление, а не придумывается на ходу.
*Источник: plan (Task 5 Step 7 — «drop the press continuation… and record it as a ruling»; Task 1 Step 3b)*

#### 3.1.9 Входная точка iOS отсылает к этому разделу
**Правило.** В `apps/ios/README.md` (раздел «Тесты», абзац «Что тесты не заменяют») добавить ссылку на §3
`docs/IOS_RULES.md`. Так правило найдут из входной точки iOS.
**Почему.** Корневой гайд Telegram коротко повторяет правило и ссылается на процедуру.
**Сейчас у нас.** расходится: в README ссылки нет, абзац «Что тесты не заменяют» — `apps/ios/README.md:106`.
*Источник: `CLAUDE.md` («Visual features and animations: verify from recorded frames»)*

### 3.2 Запись экрана

#### 3.2.1 Знать предел своего записывающего; видео без пересэмплирования
**Правило.** На CI писать `xcrun simctl io "$UDID" recordVideo --codec h264`, как уже делает `scripts/test.sh`. На
iPhone пользоваться встроенной записью экрана и помнить её потолок. По такой записи можно судить о форме движения,
перелёте, обрезке, порядке слоёв и о том, едут ли элементы вместе. О подвисаниях на 120 Гц по ней судить нельзя:
кадр 8,3 мс в неё не попадает. Темп кадров на телефоне меряют `ScrollJankMonitor`
(`Features/Chats/Thread/ScrollJankMonitor.swift`), MetricKit через Sentry (`Core/Observability/Observability.swift`)
и Instruments → Animation Hitches на Mac.
**Почему.** XcodeBuildMCP пересэмплирует видео в 30 к/с и прячет как раз покадровые детали. Запись владельца
измерили: H.264 384×848 px, time_base 1/600, 5853 интервала. Медиана 33,3 мс, 5686 интервалов ровно по 33,3 мс,
остальные кратны им (67, 100, 133… до 1000 мс на неподвижном экране). Значит, встроенная запись iPhone даёт не больше
30 к/с и меньше 1 px на pt.
*Источник: `AGENTS.md` («2. Record», пункт `simctl io recordVideo` vs `record_sim_video`)*

#### 3.2.2 Частота записи переменная: время брать из метки кадра
**Правило.** Любой разбор (скрипт, таблица в отчёте) берёт время кадра из `pts_time`. «Кадр N» — только ссылка для
человека. Почти-копию кадра (изменение ≈ 0 через пару мс) не считать подвисанием.
**Почему.** Симулятор пишет кадр только тогда, когда экран меняется: со своей меткой (единицы 1/600 с) и с частотой
дисплея, пока что-то движется. Подвисание на записи выглядит как один длинный интервал. Запись iPhone тоже переменная:
интервалы 33,3…1000 мс на сетке 1/600.
*Источник: `AGENTS.md` («2. Record», «The recording is variable-rate»); handoff («Verifying against native»: «read the pts»)*

#### 3.2.3 Метки времени брать из `ffprobe`, а не из `ffmpeg`
**Правило.** Картинки извлекать из `ffmpeg` по порядку, время — из `ffprobe -show_entries frame=pts_time`. Число
кадров из обоих должно совпасть, иначе разбор прерывается. Для времени не использовать `drawtext=%{pts}` и
`select='between(t,…)'`. Диапазон `--start/--end` применять уже после склейки «кадр ↔ время из ffprobe». На
Linux `ffmpeg` и `ffprobe` есть в `/usr/bin`.
**Почему.** В файле бывает повторённая метка. После неё `ffmpeg` (`showinfo`, `select` по `t`) молча переходит на
время декодирования и отстаёт на секунды: измерено 11,66 с, затем 8,07 с. Сами кадры при этом идут по порядку.
*Источник: `AGENTS.md` («Take the timestamps from ffprobe, never from ffmpeg»); `tools/animation_sheet.py` (`extract`)*

#### 3.2.4 Пиксели записи — не точки: масштаб вычислять
**Правило.** Вся геометрия разбора считается в точках. Масштаб K = ширина записи в px / ширина экрана модели в pt.
Считать его для каждой записи по `ffprobe … -show_entries stream=width,height`. На CI (iPhone 17 Pro, 3x) K = 3. Для
записи с iPhone K ≈ 0,95: 384 px на ~402 pt.
**Почему.** У Telegram кадр — это пиксели устройства: 402×874 pt пишутся как 1206×2622. Если угадать масштаб
неверно, «перелёт 9 pt» превратится в 30 pt.
*Источник: `AGENTS.md` («Frames are the device's pixels (3x…)», «All geometry is in points»)*

#### 3.2.5 Жест — в известный момент записи; запись останавливать через SIGINT
**Правило.** Прежде чем начинать жест, дождаться в логе записи строки «Recording started». В конце подождать
секунду на успокоение и остановить запись `kill -INT`. На CI жест делает XCUITest, а записывает `scripts/test.sh`.
На iPhone координатных касаний из Linux нет, жест делает владелец. Попросить его: начать запись, подождать секунду,
сделать жест, подождать секунду, остановить.
**Почему.** Касание должно лечь в известный момент записи. SIGINT корректно закрывает файл.
**Сейчас у нас.** соблюдено (#499): запись видео стартует по строке «Recording started», перед `SIGINT` — секунда.
**Применимость.** частично: `axe touch` и локальный симулятор у нас недоступны. Переносится принцип «известный
момент + SIGINT».
*Источник: `AGENTS.md` («2. Record», блок команд и пункт про `axe touch`)*

#### 3.2.6 Записывать весь жест с запасом и каждый путь отдельно
**Правило.** Записывать жест целиком, с паузой до и после. Каждый путь, который задевает правка, — отдельной
записью. Типовые пути у нас:
- открыть и закрыть меню сообщения (`Thread/Menu/MessageMenuOverlay.swift`) с клавиатурой и без;
- отправка с клавиатурой и без;
- лента у низа, в середине и у верха (как в `PerformanceFlagUITests`);
- светлая и тёмная тема, крупный шрифт;
- «Уменьшение движения» (`SH_UITEST_REDUCE_MOTION=1`).

«Медленные анимации» симулятора — только дополнительная запись к записи на реальной скорости.
**Почему.** Время — часть оценки. Замедленная запись его искажает.
*Источник: `AGENTS.md` («2. Record», последний пункт)*

#### 3.2.7 Задержку отрисовки не подгонять по симулятору; мерить видео, а не снимками
**Правило.** Тайминги, задержки и ощущение от анимаций ленты подгонять только по записи экрана iPhone. Видео прогона
с CI (`artifacts/<набор>/run.mp4`) годится, чтобы понять порядок событий, но не для кадровой точности. Мерить
видеозаписью, не серией снимков экрана.
**Почему.** Задержка «коммит → экран» на симуляторе ≈ 0,01 кадра, на устройстве ≈ 1 кадр. Снимок экрана
(`simctl io screenshot`) перерисовывает экран заново и задержку не показывает.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Scroll engine and physics: «Don't tune the opening against the Simulator»;
«never `simctl io screenshot`, which re-renders»)*

#### 3.2.8 Записи экрана — в scratchpad, не в git
**Правило.** Записи экрана, присланные владельцем (вроде `ScreenRecording_*.mp4` в корне репозитория), разбирать
`ffmpeg -i <файл> -fps_mode passthrough …` с временем из pts (§3.2.2–3.2.3). Листы кадров класть в scratchpad. Сами
видео в git не добавлять.
**Почему.** У Telegram плёнки в репозитории не хранятся. Видео раздувает историю и ничего не даёт коду.
*Источник: handoff («Verifying against native»: films not kept; Pitfalls: Tooling — `-fps_mode passthrough`)*

### 3.3 Разбор кадров: листы, метрики, треки

#### 3.3.1 Методика листов кадров и что она меряет
**Правило.** Запись разбирается так:
- Диапазон кадров приводится к точкам (`scale=iw/K:-2:flags=area`, `-fps_mode passthrough`). Время берётся из
  `ffprobe` `frame=pts_time`; если там `N/A` — из `best_effort_timestamp_time`. Число кадров у ffmpeg и ffprobe
  обязано совпасть.
- По каждому кадру считаются величины на сером кадре шириной 160 px:
  - `change` — средний модуль разности с предыдущим кадром (0…255);
  - `to_final` — то же с последним кадром, то есть с покоем;
  - `region` — рамка пикселей с разностью больше 12;
  - `interval` — мс от предыдущего кадра.

  Кадр с `change` < 0,05 считается неизменившимся.
- Успокоение — последний момент, после которого `to_final` ≤ max(0,3; 2 % максимума) до конца записи.
- «Проход через покой» — локальный минимум ниже 25 % стартового расстояния, после которого кривая снова растёт больше
  чем на этот порог. Печатается в % от старта.
- Выход разбора: листы `sheet-NN.png` (все кадры диапазона по порядку, подпись «#номер t=секунды +мс от предыдущего»,
  помеченные кадры в красной рамке), `motion.png`, `tracks.png`, `frames.tsv`, `frames/NNNNN.png`. Кроме того —
  сводка: начало и конец движения, момент «в пределах 2 % от покоя навсегда», проходы через покой, помеченные кадры,
  путь каждого трека, расхождение треков.

Пороги — стартовые значения, а не догма.
**Почему.** Это измерительная часть `tools/animation_sheet.py` у Telegram. Она превращает «выглядит странно» в
числа, на которые можно сослаться.
**Сейчас у нас.** расходится: своего инструмента нет. Пока его нет, минимум такой: кадры диапазона с номерами и
временем из ffprobe, листы по 8×4 и ссылки на номера кадров в отчёте.
**Применимость.** частично: инструмент придётся написать свой (§3.3.3).
*Источник: `AGENTS.md` («3. Turn it into frames»); `tools/animation_sheet.py` (docstring, `measure`, `flag`,
`settling`, `track`, `togetherness`)*

#### 3.3.2 Разбор записи iPhone на Linux
**Правило.** Записи с iPhone и `run.mp4` из CI разбирать по шагам:
1. Параметры: `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,time_base,r_frame_rate -of
   default=nw=1 rec.mp4`. Из них масштаб K (§3.2.4).
2. Времена: `ffprobe -v error -select_streams v:0 -show_entries frame=pts_time,best_effort_timestamp_time -of csv=p=0
   rec.mp4 > pts.csv`.
3. Кадры по порядку: `ffmpeg -hide_banner -nostdin -i rec.mp4 -vf "crop=…,scale=iw/K:-2:flags=area" -fps_mode
   passthrough frames/%05d.png`. Кроп задаётся в пикселях записи (pt × K). Число PNG должно совпасть с числом строк
   `pts.csv`, иначе стоп.
4. Метрики без Pillow: `ffmpeg -i rec.mp4 -vf "scale=160:-2,format=gray" -fps_mode passthrough -f rawvideo -` даёт
   по 160×H байт на кадр. `change` и `to_final` считать на чистом Python.
5. Листы: `ffmpeg -i frames/%05d.png -vf "drawtext=text='#%{n}':…,tile=8x4" sheet-%02d.png`. Номер кадра из
   ffmpeg надёжен; время подписывать по таблице из шага 2, а не через `%{pts}`.
6. Треки: вертикального поиска хватает для ленты и меню. Для горизонтальных жестов (свайп назад, свайп ответа, смена
   вкладки историй) нужен поиск по X.

Подписи и метрики держать в pt. Свой скрипт положить в `apps/ios/scripts/` рядом с `xcresult_summary.py` и
`perf_check.py`. Писать его на стандартной библиотеке Python + ffmpeg. Pillow или numpy — это новая зависимость,
спросить владельца.
**Почему.** Методика Telegram рассчитана на запись симулятора 3x и Pillow. У нас запись с телефона ≤ 30 к/с, поэтому
подвисания на 120 Гц ею не доказываются.
**Применимость.** частично: скрипта нет, методика переносится полностью, а 120-Гц темп с записи телефона не измерить.
*Источник: `tools/animation_sheet.py`; `AGENTS.md` («2–3»)*

#### 3.3.3 Код инструмента Telegram не заимствовать
**Правило.** Переносить только описание методики (§3.3.1–3.3.2). Реализацию писать с нуля, не копируя функции,
имена и структуру.
**Почему.** `tools/animation_sheet.py` — часть GPL-2.0 репозитория Telegram. GPL несовместима с закрытым приложением
(`apps/ios/README.md`, «Чего в этом репозитории не бывает»). Общее правило о стороннем коде — §14.3.1.
*Источник: `tools/animation_sheet.py`; `apps/ios/README.md` («Чего в этом репозитории не бывает»)*

#### 3.3.4 Флаги `gap` и `jump` — подсказки: каждый открыть и назвать
**Правило.** Определения флагов:
- `gap` — интервал больше 1,5× медианы при изменении кадра ≥ 5 % от максимального в ролике. Медиана считается только
  по кадрам, которые менялись.
- `jump` — `change` > 1,0 и больше 3× медианы изменения соседей (окно ±3 кадра, без самого кадра).

На каждый флаг открыть плитки вокруг и сказать, что это:
- `jump` бывает законным, если элемент и должен появиться сразу.
- `gap` на CI-раннере (macOS-26, общий) по умолчанию подозревать на раннер, пока он не повторится в той же точке в
  двух-трёх прогонах. Подтверждать на iPhone: `ScrollJankMonitor` и ощущение владельца.
- На записи iPhone медиана 33,3 мс, поэтому `gap` там — потерянный кадр 30-кадровой записи, не обязательно вина
  приложения. На CI-симуляторе медиана 16,7 мс (iOS 26.5, по измерению Telegram).
**Почему.** `gap` значит «кадр нарисован поздно или стоп»: спиннер и каретка со своей низкой частотой не считаются.
`jump` значит рывок, телепорт или появление посреди плавного движения. Флаги указывают, куда смотреть, но не дают
вердикта. Темп кадров подтверждается на устройстве.
*Источник: `AGENTS.md` («3», пункты `gap`/`jump»; «4. Evaluate», Every flagged frame); `tools/animation_sheet.py` (`flag`)*

#### 3.3.5 Треки: как выбирать области и чему не верить
**Правило.** Трек `NAME=X,Y,W,H` — это область в последнем кадре, где элемент в покое. Для уходящего элемента
область берётся в первом кадре. Требования к области:
- лежит внутри одного элемента;
- имеет фактуру: текст, значки, края;
- не захватывает соседей, которые двигаются иначе.

Для ленты брать текст или время внутри пузыря, не его край: соседние пузыри одного цвета спутаются. Для меню
сообщения брать значок слева в строке меню и сам поднимаемый пузырь. Верить участку, где сходятся несколько треков.
Расхождение сверять по листу.
**Почему.** В каждом кадре ищется только вертикальный сдвиг шаблона (±260 pt; грубо с шагом 2, потом уточнение ±2).
Если ошибка > 12, трек «не найден». Текст, который меняет размер или цвет, и текст поверх меняющегося фона читаются
как «не найден» или, хуже, как уверенный неверный сдвиг. Похожие строки списка путаются между собой.
*Источник: `AGENTS.md` («Tracks are the precise instrument»); `tools/animation_sheet.py` (`track`)*

#### 3.3.6 Диапазон, кроп и плитку подбирать под то, что оценивается
**Правило.** `--start/--end` оставляют только движение; времена — по часам записи. Кропать нужно, если на экране
одновременно есть постороннее движение: индикатор «печатает», таймер голосового, гифка. Иначе оно испортит кривую.
Кропать и увеличивать плитку, пока движение не станет видно. На записи iPhone (≈0,95 px/pt) плитка шире самой
записи бессмысленна, нужно кропать область жеста.
**Почему.** Кривая «до покоя» и столбики меряют всё, что попало в кадр. Плитка 200 px на экране 402 pt — это
полпикселя на точку: перелёт 9 pt на листе займёт 4–5 px.
*Источник: `AGENTS.md` («Use --start/--end … Mind the scale»)*

#### 3.3.7 Форма движения — по кривой «расстояние до покоя»
**Правило.** Сравнить длительность, время успокоения и число проходов через покой с задуманным в `Motion`.
Пружина должна давать столько проходов, сколько у неё перелётов по `MotionTests`:
- лишний проход — дефект;
- ни одного прохода у пружины с перелётом — анимацию что-то съело, например «Уменьшение движения» или
  `animation(nil)`.

Величину перелёта читать по кадрам, а не по процентам.
**Почему.** Ease-out падает к нулю и остаётся там. Пружина касается покоя и поднимается на величину перелёта, по разу
на колебание. Ступенька на кривой — подвисание. Проценты считаются от разницы картинки, а не от пути.
*Источник: `AGENTS.md` («4. Evaluate», Shape)*

#### 3.3.8 «Едут вместе» — одно смещение в каждом кадре
**Правило.** Элементы, которые движутся как одно целое, проверять треками: в каждом кадре, включая перелёт, у них
одно смещение. Главные места у нас:
- лента и поле ввода при показе клавиатуры;
- пузырь и меню в `MessageMenuOverlay`;
- отправка;
- свайп ответа (`SwipeToReply.swift`).
**Почему.** Так ловится класс дефектов: элемент стоит, пока соседи едут, приезжает на кадр позже или перелетает один.
У элементов на одной пружине с разным путём фаза одна, а амплитуда разная. Этот класс у нас уже встречался — «дыры
между пузырями у верха ленты», флаг 2.5. Треки дают его числом.
*Источник: `AGENTS.md` («4. Evaluate», Togetherness)*

#### 3.3.9 Листы читать целиком
**Правило.** Пройти листы от начала до конца и искать то, чего не видит ни одна метрика:
- обрезку;
- неверный порядок слоёв в одном кадре;
- вспышку цвета;
- перенос строки текста в полёте;
- элемент, нарисованный дважды при передаче.

У нас особенно внимательно — на стекле (iOS 26/27): вспышка непрозрачного фона на кадр при смене материала, двойной
пузырь при передаче из ленты в оверлей меню, перенос текста пузыря при анимации ширины.
**Почему.** Метрики меряют величину изменения. Что именно изменилось, видно только глазами.
*Источник: `AGENTS.md` («4. Evaluate», The frames, not just the numbers)*

### 3.4 Проверка на устройстве и ручные проходы

#### 3.4.1 Сборку на iPhone ставит и проверяет человек — по чек-листу
**Правило.** Агент собирает и выдаёт чек-лист проверки с ожидаемым результатом по каждому пункту. Сборку на iPhone
ставит владелец (`scripts/device.sh`, xtool) или агент по его просьбе. Запись экрана тоже делает владелец: Пункт
управления → «Запись экрана». Агент не переустанавливает приложение «чтобы записать». Он просит поставить сборку и
снять нужный жест. На CI запись делает `scripts/test.sh` сам. Типовой чек-лист после правки карточки сообщения:
- свой и чужой пузырь;
- тёмная тема, крупный шрифт;
- прокрутка с переиспользованием ячеек;
- двойной и долгий тап;
- пересылка, правка.

**Почему.** Запись пассивна и не трогает приложение. Установка его трогает, поэтому у Telegram это делает только
человек или разрешённый симулятор.
*Источник: `AGENTS.md` («2. Record», первый абзац); P (Global Constraints: «Never install the app on a simulator or
device; the user installs and verifies»; Task 15 Step 4); S13 §7 («Manual check»)*

#### 3.4.2 Фиксированные оси ручного прохода
**Правило.** Каждый визуальный случай проходит одни и те же оси:
- светлая и тёмная тема;
- самый крупный Dynamic Type;
- реально включённое «Уменьшение движения» (`SH_UITEST_REDUCE_MOTION=1` в UI-тестах, `Motion.respecting` в коде);
- свой и чужой пузырь;
- пересоздание при прокрутке;
- пересылка, правка, удаление;
- версии ОС: минимальная iOS 17 (без стекла), iOS 26/27 (со стеклом). Итог — на iPhone владельца.
**Почему.** У Telegram проверки идут на минимальной (26.0), промежуточной и новейшей ОС, с реально включённым Reduce
Motion. Поведение на устройстве проверяют отдельно от симулятора.
**Применимость.** частично: поворота, iPad и RTL у нас нет (только iPhone, портрет — `UISupportedInterfaceOrientations`
в `project.yml`).
*Источник: `docs/context-menu-liquid-morph.md` («Objective-C adapter validation», «Earlier animation validation»);
S19 §2 п. 4*

#### 3.4.3 Список прерываний для анимационной работы
**Правило.** До кода составить список рискованных переплетений и проверить каждое. Для ленты и шапки чата:
- уход назад посреди `MessageListGlide` или перехода к сообщению;
- долгое нажатие (меню) посреди пружины;
- появление клавиатуры или панели закреплённого посреди анимации;
- смена режима выбора;
- нажатие на «вниз» посреди въезда своего сообщения.
**Почему.** У Telegram у каждого переплетения свой тест: переход посреди анимации, меню посреди, перекладка
(поворот, ширина), переключение состояния, нажатие посреди.
*Источник: plan (Review Focus); handoff (Deferred minors: rotation mid-transition, layout lag, non-animated top change)*

#### 3.4.4 Прокрутку проверять взмахом с инерцией
**Правило.** Каждое изменение ленты, плавающей даты или кнопки «вниз» проверять на iPhone тремя способами: медленным
перетаскиванием, взмахом с инерцией и остановкой инерции касанием.
**Почему.** Поправка, которая работает при перетаскивании и ломается при взмахе, не попала в анимацию инерции.
**Сейчас у нас.** соблюдено в перф-тесте: `ScrollSmoothnessTests` делает взмахи `swipeUp/swipeDown(velocity: .fast)`.
Остановка инерции касанием там не проверяется.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Deferred: «the check must include a momentum fling»)*

#### 3.4.5 На реальных аккаунтах не трогать чужое
**Правило.** На iPhone владельца и на тестовых учётках Railway (`security.0@…`, демо-студенты) без просьбы не делать
следующего:
- не открывать чаты с непрочитанным;
- не выходить из аккаунта владельца и не переключать аккаунты;
- не голосовать в чужих опросах ради проверки.

Перед каждым касанием смотреть свежий экран. UI-тесты на CI идут на mock API (`SH_UITEST_MOCK=1`), там можно всё.
**Почему.** Сервер отмечает сообщения прочитанными сразу при открытии чата, и собеседник увидит галочки. Касание по
устаревшему экрану попадает не туда.
*Источник: plan (Global Constraints: «Never mark messages read… screenshot and locate a row before every tap»; Task 5
Step 7); S19 §6*

#### 3.4.6 Редкий путь — вручную против настоящего сервера, потом устройство
**Правило.** Переполнение догона и разрыв по `seq` проверять на Railway (тестовая среда с `develop`) на iPhone
владельца. Сценарий: офлайн, больше 200 сообщений с другого устройства, правки и удаления во время офлайна, затем
возврат. Рискованное держать под выключенным флагом в `App/PerformanceFlags.swift`, пока не проверено на устройстве.
**Почему.** Telegram вызывает редкий путь принудительно, через отладочный порог, на настоящем сервере. Перед выпуском —
подписанная сборка и внутренние тестировщики.
*Источник: handoff §6g, §5*

#### 3.4.7 PiP, фон и экран блокировки — только на iPhone
**Правило.** Картинку в картинке, звук в фоне и экран блокировки проверять на iPhone. Если PiP нужен, добавить режим
`audio` и категорию `AVAudioSession.playback`. Правка `project.yml` и `Info.plist` — с согласия владельца.
**Почему.** На симуляторе это не проверяется, у Telegram это отдельный список для устройства.
**Сейчас у нас.** проверить на iPhone: `SystemPlayer` ставит `allowsPictureInPicturePlayback = true`
(`Features/Feed/MediaViewer.swift:912`), но в `UIBackgroundModes` есть только `remote-notification` и `location`
(`apps/ios/project.yml:83-87`). Без режима `audio` PiP и звук в фоне система не поддерживает.
*Источник: `docs/native-hls-player.md` («Simulator checks» → «Not checkable on the simulator»)*

### 3.5 Механика анимаций UIKit и Core Animation

#### 3.5.1 Нулевая длительность означает «без анимации» — применять значение напрямую
**Правило.** При уменьшении движения не вызывать `UIView.animate(withDuration: 0 …)` вместо «без анимации».
Применять значение напрямую, как это делают `reveal()` и `animateLayout()` при `reduceMotion`. Где 0 всё же
передаётся, проверить, что завершение не ломает новое состояние.
**Почему.** Завершение такой анимации всё равно приходит асинхронно и может перебить следующее состояние. У Telegram
`isAnimated` был истинным для любого `.System` даже при нулевой длительности, и пузырь в ~20 местах запускал свои
анимации.
**Сейчас у нас.** проверить: длительность 0 передают `flash` (`Features/Chats/Thread/MessageListView.swift:829`,
`still ? 0 : …`) и `SwipeToReply` (`Features/Chats/Thread/SwipeToReply.swift:79`, `Motion.isReducedNow ? 0 : 0.2`).
*Источник: `docs/chat/corelist-chat-history-backend.md` (Node hosting); `submodules/TelegramUI/Components/CoreList/CLAUDE.md` («A zero duration is
immediate…»)*

#### 3.5.2 Новая анимация начинается с того, что свойство показывает сейчас
**Правило.** Все перезапускаемые анимации — с `.beginFromCurrentState`, как в `flash`, `animateEntrance`,
`hideFloatingHeaders`. Стартовое значение не вычислять из другого свойства или из модели другого вида.
`MessageListGlide` продолжает движение с текущей скоростью: `start()` при идущем движении ничего не делает. Морф,
развёрнутый на полпути, разворачивается с того места, где он сейчас.
**Почему.** Telegram пробовал брать «откуда» у соседнего трека (высоты строки) — содержимое прыгало на величину
накопленного расхождения, изменение откатили.
*Источник: `docs/chat/corelist-chat-history-backend.md` («`from` is THIS property's own current presentation value»);
`submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Resuming from the screen); `News/CLAUDE.md` («A morph starts from what is on screen»)*

#### 3.5.3 Повторяемое движение — одна анимация на свойство, под стабильным ключом
**Правило.** Для повторяемых движений (`animateLayout()` на каждую смену высоты пузыря, въезд `animateEntrance`)
использовать `.beginFromCurrentState` и одну анимацию на свойство. Свой `CABasicAnimation` ставить только с
`forKey:` (стабильный ключ). При нулевом смещении снимать ключ, а не ставить анимацию с `from == to`. Прежде чем
переносить механизм из старой реализации, выяснить, из какой её ветки он: одноразовой или повторяемой.
**Почему.** UIKit делает анимации `position/bounds/transform` аддитивными: повторный `UIView.animate` поверх идущего
складывается. У Telegram без ключа каждая итерация компенсации высоты добавляла ещё одну анимацию. Сумма N сдвинутых по
фазе кривых расходилась с одной кривой высоты строки. Видно это только при повторных проходах, одиночный тест не
ловит.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Height changes need the node's content compensated; Item
height is replaced from scratch each pass)*

#### 3.5.4 Анимации принадлежат своему владельцу
**Правило.** Своя `CAAnimation` ставится с уникальным ключом и снимается по этому ключу. Не вызывать
`removeAllAnimations()` на слоях ячеек или ленты.
**Почему.** Иначе снесёт чужие анимации: системные анимации ячеек, подсветку. У Telegram keyframe-анимации помечены
своим координатором, и снимает их только он.
**Сейчас у нас.** соблюдено: `removeAllAnimations` и своих `CABasicAnimation` в `Sources` нет.
*Источник: handoff (Rulings: «A transition's keyframes belong to it… stamped with their coordinator… never by another»)*

#### 3.5.5 Конец анимации определять по завершению, а не по таймеру
**Правило.** Окончание анимации брать из её завершения. Для SwiftUI это
`withAnimation(_:completionCriteria: .logicallyComplete) { … } completion: { … }` (iOS 17). Для прокрутки — делегат
`scrollViewDidEndScrollingAnimation`. Таймер допустим только как страховка, например на случай «прокрутки не было».
Оверлей не убирать раньше конца видимого движения. При этом действие, которого пользователь ждёт мгновенно, не
откладывать до полного успокоения пружины.
**Почему.** У Telegram завершение пружины приходит намного позже видимого конца: ≈1,3 с против ≈0,7 с. Действие из
завершения ждёт лишнее, а снятие по таймеру раньше конца обрывает видимое затухание. При передаче после завершения
нельзя дать мелькнуть кадру.
**Сейчас у нас.** соблюдено (#499): оверлей меню снимается по завершению пружины (`completionCriteria`), подсветка
перехода к сообщению — по концу прокрутки (`scrollViewDidEndScrollingAnimation`); таймер 1 с остался только страховкой.
*Источник: `docs/context-menu-liquid-morph.md` («Dismissal during presentation»: «Still open… waits for the close to
settle»; «Frame rate»; «Closing handoff»); handoff (Rulings: Transition clock — «Endings come from Core Animation's
completions, not timers»)*

#### 3.5.6 Модель в анимации — сразу финальная; завершение убирает только невидимое
**Правило.** Модельные значения внутри анимационного блока — финальные видимые (`floating.alpha = 0` внутри
блока). В `completion` делать только то, что уже не видно, как `updateFloatingDate()` после гашения. Не оставлять
модель видимой в расчёте на то, что её спрячет завершение.
**Почему.** Рендер-сервер снимает анимации на кадр-другой раньше, чем завершение выполнится на главном потоке. Всё,
что оставлено видимым «до завершения», мелькает.
*Источник: `News/CLAUDE.md` («The end of a morph's animations is its end state»)*

#### 3.5.7 Анимация с `from == to` не завершится: на её завершение не полагаться
**Правило.** У своих `CABasicAnimation` с делегатом не ставить равные концы — вместо этого снять ключ. Завершение
`UIView.animate` приходит всегда, но асинхронно. Переходы состояний не строить на завершении, если значение могло не
измениться.
**Почему.** Core Animation не запускает анимацию с равными концами и не сообщает о её конце. Telegram ведёт такие
состояния по аналитическому сроку.
**Применимость.** частично: своих CA-анимаций у нас сейчас нет.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Clocks and Core Animation: «CA never runs a `from == to` animation…»)*

#### 3.5.8 Одно «сейчас» на кадр
**Правило.** В покадровых вычислениях брать время один раз на кадр и передавать его дальше. В
`MessageListGlide.tick` это `link.targetTimestamp`. Не вызывать `CACurrentMediaTime()` в каждой подфункции.
**Почему.** Если время берётся отдельно для каждой строки, между строками появляется перекос.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Clocks and Core Animation: «one time per pass… per-row sampling skews…»)*

#### 3.5.9 Поправка положения — внутри функции, из которой строится анимация
**Правило.** Положение плавающей даты (`floatingPlacement()`) — чистая функция от смещения, она пересчитывается на
каждом кадре `scrollViewDidScroll`. Так и держать. Если что-то будет анимироваться на рендер-сервере (UIView- или
CA-анимация, а не покадрово), любые поправки положения вносить внутрь той функции, из которой строится анимация.
**Почему.** У Telegram исправление «после решения» по рамкам видов не попадало в запечённый трек полёта. Заголовок
ехал без поправки всю инерцию и прыгал в конце.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Deferred: topic headers inside `AttachmentOffsetMap.y(atOffset:)`)*

#### 3.5.10 Пружина в UIKit: длительность — это время успокоения, форму задаёт демпфирование
**Правило.** В `UIView.animate(withDuration:delay:usingSpringWithDamping:…)` длительность означает время
успокоения. Скорость меняется длительностью, характер — демпфированием. Значения брать из токенов
`DesignSystem/Motion.swift` (`Motion.Springs.*`, `Motion.Duration.*`). Связанные анимации одного вида (масштаб,
сдвиг и прозрачность в `animateEntrance`) ставить одним блоком, чтобы они завершались вместе.
**Почему.** Пружина масштабируется под длительность. Если при прямой анимации слоя не передать `timingFunction`,
пружина тихо откатывается на ease-in-out. Парные аддитивные фазы, снятые не вместе, дают мигание пузыря на кадр
(90 %).
*Источник: `TelegramUI/Sources/CLAUDE.md` (Message send transition: `CALayer.makeAnimation`; «remove all four together»)*

#### 3.5.11 Константы движения — из источника, а не на глаз
**Правило.** Значения в `DesignSystem/Motion.swift` и в своих анимациях ленты сопровождать комментарием об
источнике: Apple HIG, замер записи Telegram или системного приложения на iPhone, «отклик 0,3 с как у
`Motion.lively`». Если имитируется системное поведение, сначала записать эталон на iPhone и разобрать его по кадрам.
**Почему.** Telegram берёт тайминги и пружины из разбора UIKitCore/SwiftUICore и сверяет с записью нативных
приложений. Сначала замер натива, потом код.
*Источник: handoff (Ground rules: «Every constant comes from those sources, not from eyeballing»); spec (Testing:
«Native first»)*

#### 3.5.12 Медленные анимации и анимации на display link
**Правило.** Системные анимации симулятор замедляет сам. `MessageListGlide` (CADisplayLink, свой шаг пружины)
замедлению не подчиняется. Это принятое ограничение: при разборе замедленной записи помнить, что пружина к низу идёт
в реальном времени.
**Почему.** Telegram применяет масштаб Slow Animations ровно один раз, а физические полёты принято оставлять без
замедления.
**Применимость.** частично: своего масштабирования Slow Animations у нас нет.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (`CoreListTransition` and curves; Clocks and Core Animation; Scroll engine: «Physics
flights ignore Slow Animations»)*

### 3.6 Анимации ленты и пузырей

#### 3.6.1 Одинаковое значение — не трогать; изменилось — заменить от текущего; соседи едут вместе
**Правило.** Сеттеры в покадровых путях (`updateFloatingDate`, `SwipeToReply.place`) выходят сразу, если значение
то же. `animateLayout()` анимирует весь `collectionView.layoutIfNeeded()`, поэтому строки под выросшим пузырём едут
той же пружиной. Не заменять это анимацией одной ячейки. Новые строки появляются без анимации геометрии
(`animatingDifferences: false`), въезд делается своей анимацией содержимого.
**Почему.** У Telegram неизменившееся свойство (до 1e-6 pt) — точный no-op: он не трогает трек, фазу и кривую.
Двигаться должен каждый выживший элемент, у которого сменилось положение. Если ограничиться «уже анимирующимися»,
остальные прыгнут позже.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Granular animation contract)*

#### 3.6.2 Перемер анимировать только при правке на месте; погрешность одна на всю ленту
**Правило.** `animateLayout()` вызывать только при `inPlace` (та же лента, изменилось содержимое). Не на догрузке и
не в прокрутке. Погрешность 0,5 pt — одна для ширины (`MessageStackLayout.shouldInvalidateLayout(forBoundsChange:)`),
высоты и смещений. Новую константу сравнения не вводить.
**Почему.** Telegram анимирует перемер, только если содержимое перенастроено или сменилась ширина. Новые строки,
въехавшие при прокрутке, и внеэкранные ставятся сразу. Погрешность ширины 0,5 общая для списка и хоста: если они
расходятся, проходы зацикливаются или пропускаются.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Item protocol: «The measure transition…»; shared `0.5` epsilon «must agree»)*

#### 3.6.3 Анимация не переживает переиспользование ячейки
**Правило.** Ячейки переиспользуются. Завершения на `cell.contentView` (гашение подсветки в `flash`, въезд) не должны
трогать ячейку, которая уже показывает другое сообщение. Для этого проверять id или сбрасывать состояние в
`willDisplay`, как сейчас делается `contentView.backgroundColor = .clear`. Признак «идёт анимация» не хранить в
свойстве `MessageCell`, которое переживает переиспользование. Незавершённые анимации снимать при переиспользовании.
**Почему.** У Telegram завершения хранят поколение и привязку, поэтому устаревшее завершение не может очистить
замену. Когда проявление управлялось «занятостью слота», ячейка, отданная под другое сообщение, проявлялась без
причины.
**Сейчас у нас.** проверить: второй шаг `flash` гасит фон с задержкой 0,8 с (`MessageListView.swift:841-848`) и
может прийти в ячейку, уже показывающую другое сообщение. `willDisplay` сбрасывает фон (`:1337`).
`prepareForReuse` у ячеек не переопределён.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Granular animation contract: completions capture generation and binding);
`docs/instantpage-richtext.md` (Whole-content vs same-content updates: «gated on a local crossfadeIn flag»)*

#### 3.6.4 Вид, созданный внутри анимированного прохода, раскладывается без анимации
**Правило.** Первую раскладку новых ячеек и видов делать в `UIView.performWithoutAnimation`, в SwiftUI — с
`transaction.animation = nil`.
**Почему.** У Telegram вид, созданный внутри анимированного прохода, без немедленной раскладки «вырастал из угла».
**Сейчас у нас.** проверить на iPhone: `animateLayout()` оборачивает `collectionView.layoutIfNeeded()` в пружину
(`MessageListView.swift:964`). Ячейки, впервые появившиеся в этом проходе, могут вырасти из угла.
`performWithoutAnimation` в коде не используется. Сценарий: реакция у нижнего пузыря, когда снизу въезжает новая
ячейка.
*Источник: `News/CLAUDE.md` (Compact / Expanded posts: `hasLaidOut`)*

#### 3.6.5 Пока высота анимируется, содержимое не выходит за пузырь
**Правило.** Пока растёт пузырь (реакция, раскрытие, правка), содержимое не выходит за форму пузыря ни в одном кадре.
Растущий пузырь не налезает на нижний. Если налезает, включать `clipsToBounds` на время анимации и снимать в конце.
Проверять записью экрана с iPhone покадрово.
**Почему.** Раскладка строки берёт новую высоту сразу, а рамка анимируется. Растущая строка без обрезки рисует новое
поверх нижних строк.
**Сейчас у нас.** проверить на iPhone: при `animateLayout()` SwiftUI-содержимое ячейки уже новой высоты, а рамка
ячейки едет пружиной.
*Источник: `News/CLAUDE.md` («A row clips itself while its height animates»); `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («While the
height animates»)*

#### 3.6.6 Отправка: старт из того, что на экране; одна кривая с лентой
**Правило.** Пузырь отправки и лента должны двигаться по одной вертикальной кривой. Если будет морф из поля ввода,
его старт брать из presentation-слоя поля, а не из `convert`.
**Почему.** У Telegram `convert` давал конец прокрутки, и пузырь стартовал на прокрутку ниже. Лента, едущая по другой
кривой, заставляет пузырь «плыть» относительно соседей. Затухание вставки при морфе подавляется, чтобы не было второго
проявления.
**Сейчас у нас.** проверить на iPhone: морфа нет. `animateEntrance` поднимает своё сообщение на +28 pt с масштаба
0,9 (пружина 0,4 с, демпфирование 0,82; `MessageListView.swift:1025-1040`). Лента едет к низу `MessageListGlide`
(критическая пружина, отклик 0,3 с). Это разные кривые: проверить на записи, что пузырь не дрейфует относительно
соседей.
**Применимость.** частично: морфа нет, правило одной кривой применимо.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Send animation); `TelegramUI/Sources/CLAUDE.md` (Message send
transition: «the history list scrolls on the bubble's vertical curve»)*

#### 3.6.7 Чужой компонент переиспользовать флагами; связанные константы менять вместе
**Правило.** `MessageHeightEstimate.Metrics` (`estimateMetrics(width:)` в `MessageListView`) повторяет отступы и
шрифты `MessageBubbleView`. Меняя пузырь, менять и оценку. Переиспользуя пузырь в другом месте (превью в
`ChatPeekView`, закреплённые, меню), подключать его флагами (`isMenuPreview`), а не копией.
**Почему.** У Telegram пост ленты рисует настоящий пузырь чата с флагами `hides…`. Геометрия задана константами,
поэтому при их смене колонка поедет — это записано рядом. У нас расхождение оценки с пузырём даёт лишние перемеры и
рывки, они видны в `ScrollJankMonitor`.
*Источник: `News/CLAUDE.md` («The bubble is the chat's own»; «Bubble geometry is placed by constants, not measured»)*

#### 3.6.8 Живое содержимое не подменять снимком
**Правило.** Анимированное содержимое (голосовое с волной, видео, GIF) не растворять снимком. Живые виды, которые
переносятся в оверлей (плеер, анимация), не вынимать из окна. У вида один владелец за раз.
**Почему.** У Telegram снимок узла, который рисует себя один раз, вышел пустым. Lottie, вынутый из окна, встаёт на
паузу и застревает на первом кадре.
**Сейчас у нас.** проверить на iPhone: `crossfade` (`UIView.transition(with:… .transitionCrossDissolve)`,
`MessageListView.swift:895`) растворяет снимок старого содержимого. Для статичных пузырей это годится, анимированное
в снимке замрёт.
**Применимость.** частично: снимки у нас только в `crossfade`.
*Источник: handoff (Rulings: Capsules — «never snapshotted», «Lottie pauses a view that leaves its window»); plan
(Global Constraints: «Never a still copy… lend live views»)*

#### 3.6.9 Анимировать замену только при смене видимого содержимого
**Правило.** Если пузырь анимирует смену содержимого (`.contentTransition`, `.transition`), условием служит изменение
видимого текста или вида блока. Не любые поля `Equatable`: `remoteId`, `seq`, `updatedAt`, id вложения анимацию
запускать не должны. Относительное время не перезапускает анимацию содержимого.
**Почему.** У Telegram отпечаток читает видимые строки и вид блоков, а не id. Дата входит своим значением, а не
отформатированной строкой: переход «3 минуты назад» → «4» не растворяет пузырь.
*Источник: `docs/instantpage-richtext.md` (Whole-content vs same-content updates: «The fingerprint reads strings, not
identities»)*

#### 3.6.10 Подтверждение сервером той же правки — без вспышки
**Правило.** Когда по сокету приходит эхо оптимистичной правки (`PerformanceFlags.optimisticActions`) с тем же
текстом, не перерисовывать пузырь с анимацией и не сбрасывать раскрытие или выделение.
**Почему.** К моменту подтверждения содержимое обычно уже равно оптимистичному. Проверка равенства не даёт вспышки
«ни за что».
*Источник: `docs/instantpage-richtext.md` (Whole-content vs same-content updates: «The InstantPage == guard»)*

#### 3.6.11 Проход без анимации не пересоздаёт медиа
**Правило.** При `apply(snapshot, animatingDifferences: false)` не пересоздавать виды медиа и не перезапускать
загрузки.
**Почему.** Пересоздание при неанимированном проходе только перезапускает медиа и их загрузки.
*Источник: `docs/instantpage-richtext.md` («A non-animated pass takes the same-content path»)*

#### 3.6.12 Вынос содержимого в дочерний вид меняет анимацию
**Правило.** При рефакторинге вида, который участвует в анимации размера (пузырь, меню, клавиатура), проверять
результат покадрово на iPhone. Ребёнку анимировать кадр явно, вместе с родителем.
**Почему.** Анимация `bounds` у `UIImageView` тянет картинку по кривой. У контейнера, который ставит ребёнка в
`layoutSubviews`, ребёнок прыгает сразу в конечное положение. Telegram добавил на это тест-сторож.
*Источник: `docs/instantpage-richtext.md` (Tearing the bubble: «Moving the silhouette into a child made the backdrop
stop animating»)*

### 3.7 Меню сообщения

#### 3.7.1 Место меню фиксируется при открытии
**Правило.** Раскладку меню считать один раз при открытии: из `request.rowRect/bubbleRect` и низа клавиатуры на тот
момент. Хранить её в `MessageMenuRequest`. Уход клавиатуры не должен двигать уже открытое меню.
**Почему.** У Telegram меню занимает место источника, привязывается к краю по половине экрана и ограничивается
краями. Позиция фиксируется при открытии, даже если источник потом перекладывается.
**Сейчас у нас.** соблюдено (#499): верх клавиатуры снимается при открытии меню, уход клавиатуры открытое меню не
двигает.
*Источник: `docs/context-menu-liquid-morph.md` («Which menus morph»: «The placement is decided when the menu opens and
kept for its lifetime»)*

#### 3.7.2 Закрытие во время открытия разворачивает анимацию сразу; касания не блокировать
**Правило.** `dismiss()` во время открытия сразу разворачивает пружину SwiftUI (`shown = false`). Так и держать.
Пункты и фон должны нажиматься с первого кадра: не вешать `allowsHitTesting(shown)`. Повторное долгое нажатие во
время закрытия сейчас игнорируется (`guard menu == nil` в `openMenu`, `ChatThreadView.swift:855`). Это безопасно; если
понадобится переоткрывать сразу — см. §3.7.3.
**Почему.** У Telegram закрытие ждало конца открытия (1,3 с успокоения), и меню игнорировало касания. После
исправления закрытие разворачивает идущую анимацию с текущего места, и меню нажимается с ~0,1 с.
**Сейчас у нас.** соблюдено.
*Источник: `docs/context-menu-liquid-morph.md` («Dismissal during presentation (2026-09-29)»)*

#### 3.7.3 Пока меню открыто, источник скрыт; старое завершение не трогает новое меню
**Правило.** На время меню скрывать строку-источник (прозрачность 0) и возвращать её по `onDismiss`. Если разрешить
переоткрытие во время закрытия, `closeMenu` старого меню не должен обнулять новый `menu`: сравнивать `request.id`.
**Почему.** У Telegram источник скрыт всё время жизни меню. Перекрывающиеся показы считают владельцев, и исходная
видимость возвращается после последнего. Завершение старого меню не раскрывает источник под новым.
**Сейчас у нас.** расходится: оверлей рисует копию пузыря (`isMenuPreview: true`, `MessageMenuOverlay.swift:270`), а
настоящий пузырь остаётся в ленте под `.ultraThinMaterial`. Источник не скрывается (`openMenu`/`closeMenu`,
`ChatThreadView.swift:854-893`). Если меню сдвинуло копию, под ней виден размытый двойник.
**Применимость.** частично: учёт владельцев нужен, только если разрешить переоткрытие.
*Источник: `docs/context-menu-liquid-morph.md` («Source visibility across menu lifetime», «Rapid profile-menu
reopening», `ContextMenuSourceLease`)*

#### 3.7.4 Превью — живой вид в ненажатом состоянии, не снимок
**Правило.** Превью в меню — живой `MessageBubbleView(isMenuPreview: true)`. Снимком его не заменять. Подсветку
нажатия пузыря снимать до показа меню.
**Почему.** У Telegram снимок, снятый во время затухания нажатия, оставался тусклым: модельная непрозрачность 1, а
видимая 0,4. Перешли на живой вид, который получает обновления, пока меню открыто.
**Сейчас у нас.** соблюдено.
*Источник: `docs/context-menu-liquid-morph.md` («Separately rendered source backgrounds», «Live profile sources»)*

#### 3.7.5 Морф меню из стекла — только из цельного стекла с содержимым
**Правило.** На iOS 26 системные `Menu` сами морфят из стеклянной подложки. Кнопка меню в общей капсуле морфит всю
капсулу: проверить на устройстве, что это выглядит задуманно. От кнопки без своего стекла морфа не ждать.
**Почему.** У Telegram меню «вырастает» из стекла кнопки, только если источник — всё видимое стекло с содержимым. Если
кнопка сидит в общей стеклянной панели, превращается вся панель; это допускается только намеренно.
**Сейчас у нас.** проверить на iPhone: в `ComposerEditorView.toolbar` два `Menu` («Форматирование», «Список») сидят в
одной `composerGlass(in: Capsule())` (`Features/Chats/Thread/Composer/ComposerEditorView.swift:159-214`).
**Применимость.** частично: своего морфа у нас нет, правило касается системных `Menu`.
*Источник: `docs/context-menu-liquid-morph.md` («Which menus morph»)*

#### 3.7.6 Набор сценариев для меню
**Правило.** Завести UI-сценарии для `MessageMenuOverlay`:
- открыть и закрыть в первые 50 мс;
- повторное долгое нажатие во время закрытия;
- меню у верха и у низа (с клавиатурой);
- сообщение удалено или изменено, пока меню открыто.
**Почему.** У Telegram отдельный режим запуска прогоняет 26 автоматических проверок показа и закрытия меню:
изменение размера, удалённый источник, верх и низ, закрытие во время показа.
**Применимость.** частично: это идея набора тестов, у нас его нет.
*Источник: `docs/context-menu-liquid-morph.md` («Telegram integration gallery»)*

### 3.8 Медиа, растворения и маски

#### 3.8.1 Картинка из кеша — сразу, без проявления
**Правило.** Новые плитки брать из памяти синхронно, в `init` или `body`. `withAnimation` — только для ответа из
`.task`. Ответ дискового кеша, пришедший быстрее ~100 мс, тоже не анимировать.
**Почему.** У Telegram изображение, пришедшее во время привязки ячейки или в пределах 100 мс от запроса, ставится
без растворения. Растворяется только опоздавшее.
**Сейчас у нас.** соблюдено: `RemoteImage` берёт копию из `ImageMemoryCache` в первом кадре
(`Features/Feed/FeedComponents.swift:47`), `ChatMediaThumb` — `ChatMediaThumbnails.cached` в `init`.
*Источник: `MediaGrid/CLAUDE.md` (`MediaGridCellLayer.isBinding`, `imageRequestTime`); `PeerInfoVisualMediaPaneNode/CLAUDE.md`
(«Anything set during the grid's binding pass… shows at once»)*

#### 3.8.2 Перекрёстное растворение: нижний слой непрозрачен, тает только верхний
**Правило.** Растворения «заглушка → картинка», «постер → видео» и переходы просмотра делать так: нижний слой
остаётся непрозрачным до конца, верхний проявляется поверх. Заглушку убирать после завершения. Проверять по кадрам
записи на iPhone.
**Почему.** Когда два слоя растворяются навстречу (1→0 и 0→1), в середине сквозь них проступает фон. У Telegram
каждое масштабирование светлело на 17–23 единицы яркости. С непрозрачным нижним слоем — не больше 4–5.
**Сейчас у нас.** расходится: `RemoteImage` при приходе картинки убирает LQIP-ветку и показывает картинку с
`.transition(.opacity)` (`Features/Feed/FeedComponents.swift:54`). Под анимацией оба слоя растворяются навстречу.
`ChatMediaThumb` проверить.
*Источник: `MediaGrid/CLAUDE.md` («Zoom crossfade»)*

#### 3.8.3 Проявлять по рядам, а не мозаикой
**Правило.** Если владелец отметит «мозаику» в плитках «Медиа», перейти на проявление по рядам. Длительности брать
из `Motion` с учётом «Уменьшения движения».
**Почему.** У Telegram ячейка держит заглушку, пока не готов весь её ряд. Ряды проявляются сверху вниз с шагом 40 мс
в пределах 0,3 с. Поздняя картинка проявляется поверх заглушки за 0,2 с.
**Сейчас у нас.** плитки проявляются по одной.
**Применимость.** частично: это рекомендация по виду.
*Источник: `PeerInfoVisualMediaPaneNode/CLAUDE.md` («Images»: `mediaGridPaneRowIsReady`, `mediaGridPaneRevealDelays`)*

#### 3.8.4 Быстрый путь вместо системной операции — сверять с выводом системы
**Правило.** Заменяя `.blur`, `CIFilter` или `UIGraphicsImageRenderer` более быстрым путём, сравнить результат
попиксельно со старым на снимке (snapshot-тест) и явно принять допуск. «Быстрее, но выглядит иначе» — это не замена.
**Почему.** `.softLight` в CoreGraphics — не тот soft light, что в PDF/CSS; предел совпадения ±1/255. `vImageScale`
в 5,5 раза быстрее, но сдвигает результат до 5/255, поэтому Telegram оставил растяжение на `CGContext.draw`.
**Применимость.** частично: своих реализаций смешения у нас нет.
*Источник: `GradientBackground/CLAUDE.md` («Reimplementing a CoreGraphics operation»)*

#### 3.8.5 Узор с прозрачностью: альфу не терять
**Правило.** Если узор `ChatWallpaper` (сейчас `Canvas` поверх градиента, `Features/Chats/ChatChrome.swift:16,51`)
начнут кешировать в картинку, рендерер должен быть с прозрачностью (`UIGraphicsImageRendererFormat.opaque = false`).
Снимки проверять в светлой и тёмной теме и с «Повышенным контрастом» (там узор убран).
**Почему.** Композиция прозрачного узора в непрозрачный буфер теряет альфу и читает неинициализированную память.
Тестовая фикстура у Telegram прозрачная, премультиплицированная и двухцветная.
**Применимость.** частично: растрового узора у нас нет.
*Источник: `GradientBackground/CLAUDE.md` («The wallpaper pattern is transparent»)*

#### 3.8.6 Затухание на полупрозрачном фоне — маской, а не наложением
**Правило.** Затухание «Показать полностью» в карточке поста или статьи на стеклянном или полупрозрачном фоне делать
через `mask(LinearGradient)`, а не `overlay` градиентом цвета фона.
**Почему.** Градиент цвета фона поверх полупрозрачной заливки даёт серое пятно. Затухание нужно вырезать из альфы
маской и анимировать фоном маски.
*Источник: `docs/instantpage-richtext.md` (Collapsed quotes: «The fade is a MASK, not an overlay»)*

#### 3.8.7 При раскрытии ничего не создаётся и не удаляется
**Правило.** Раскрытие и сворачивание длинного текста анимировать высотой контейнера и маской, а не заменой одного
`Text` другим.
**Почему.** У Telegram обрезанные строки остаются нарисованными, меняются только высота и маска. Иначе сворачивание
«моргало». Маска создаётся в прямоугольнике до касания и анимируется вместе с цитатой.
*Источник: `docs/instantpage-richtext.md` (Collapsed quotes: «Nothing past the cut is DISCARDED», «A collapsing quote
keeps its cut lines DRAWN»)*

#### 3.8.8 Единственное различие двух состояний — перекрёстным растворением
**Правило.** Элемент, который единственный отличает два состояния (например, «…»), растворять через
`.contentTransition(.opacity)`. Не растворять слой, который при этом меняет размер, — картинка сплющится.
**Почему.** У Telegram многоточие появляется растворением содержимого слоя и только при равном размере коробки.
**Применимость.** частично: своего рисования текста нет, правило переносится на SwiftUI.
*Источник: `docs/instantpage-richtext.md` (Collapsed quotes: «The "…" is the one drawn difference… CROSSFADES»)*

### 3.9 Неприменимо к нам

Записей со статусом «неприменимо» в разделе нет. Частично применимые отмечены строкой «Применимость» у правил 3.2.5,
3.3.1, 3.3.2, 3.4.2, 3.5.7, 3.5.12, 3.6.6, 3.6.8, 3.7.3, 3.7.5, 3.7.6, 3.8.3, 3.8.4, 3.8.5, 3.8.8.

---
## §4. Компилятор, Swift, оптимизация

Как писать Swift-код, чтобы ошибки ловил компилятор, а не пользователь, и какие ловушки самого компилятора и языка
надо знать. Главная мысль: делай так, чтобы любое пропущенное решение ломало сборку (без значений по умолчанию, без
`default:`). Локально собирается только debug новым Swift 6.4.2, поэтому release-сборку и известные баги
тулчейна держать в голове отдельно.

### 4.1 Тулчейн и баги компилятора

#### 4.1.1 Swift 6.4: `[weak]` в локальном замыкании, которое захватывает `var`
**Правило.** Если замыкание сохраняется в локальный `let`, не убегает (вызывается только напрямую) и захватывает
изменяемую локальную переменную, писать его без `[weak]`/`[unowned]`, с сильным захватом: `{ [self] i in … }`.
Зацикливания не будет, потому что замыкание не убегает. Безопасны:
- замыкание, переданное прямо в параметр (`Task { [weak self] … }` в `RealtimeCoordinator` и `OutboxService`);
- форма `weak var w = x`.

Если правка вводит такой шаблон, отметить это отдельной строкой в отчёте.
**Почему.** Swift 6.4 (Xcode 27) и при `-Onone`, и при `-O` в такой форме уничтожает ящик захвата сразу после
создания (`MandatoryAllocBoxToStack`). Для NSObject это чтение мёртвого слота: падение в `objc_msgSend` на устройстве.
Для Swift-класса — молчаливый nil, и `guard let x else { return }` тихо пропускает работу. В коде синхронизации
Telegram нет ни одного `[weak]`, кроме безопасных форм.
**Сейчас у нас.** соблюдено. Локальный тулчейн — Swift 6.4.2 (`swift --version`): им приложение собирается для
iPhone через xtool. CI пока на Xcode 26.6. Значит, этот баг проявится сначала только на телефоне владельца, а CI будет
зелёным. Grep формы `let x = { [weak …` нашёл одно место — `DesignSystem/ClipboardPasteButton.swift:50`
(`deliver`). Оно убегает (через `loadObject` → `Task`) и не захватывает `var`, так что не подпадает.
*Источник: `CLAUDE.md` («Swift 6.4: [weak] in a local closure that also captures a var»); `submodules/TelegramCore/Sources/State/CLAUDE.md` («`Sync/` has
no `[weak]`/`[unowned]` capture list»); `docs/state-sync.md` (инвариант 21); handoff §2*

#### 4.1.2 Release-сборку прогонять заранее, до вливания и до выпуска
**Правило.** Перед вливанием крупной правки `Core/` и перед выпуском собрать Release на CI: `ios-release.yml` вручную
или отдельную Release-сборку в `ios.yml`. Не откладывать архив до дня отправки.
**Почему.** У Telegram Swift 6.4 падает в `SimplifyCFG` на `-Osize`
(`BorrowUtils.swift:551: Fatal error: cannot get borrow introducers…`), а debug-сборка того же кода компилируется.
Падение впервые видно на CI с релизными флагами (WMO, `-Osize`). Триггер: вложенная функция из циклов плюс
межмодульно встроенный метод с цепочкой `&&`/`||` по `self.size` у заимствованной структуры с массивом. Лечилось
статической функцией с локальным `size`. Перед выдачей пользователям у Telegram — подписанная сборка на устройстве.
**Сейчас у нас.** локально собирается только Debug (`xtool dev build`). Release собирается только в
`ios-release.yml`. Когда CI перейдёт на Xcode 27 (Swift 6.4), такие падения появятся именно там.
*Источник: `CLAUDE.md` («Swift 6.4: SimplifyCFG crash in release builds only»); handoff §6d, §6g*

#### 4.1.3 Падение компилятора только в Release — воспроизводить командой из лога
**Правило.** Если архив падает в `swift-frontend`, взять команду фронтенда из лога xcodebuild и повторять её на
macOS-раннере или локально через `swiftc -O` с Darwin SDK xtool. Указывать отдельный `-module-cache-path` во
временном каталоге. Минимизируя пример, сохранять вызывающего.
**Почему.** WMO удаляет внутреннюю функцию без вызовов ещё до оптимизации, поэтому один файл без вызывающего падение
не воспроизводит. Повтор с общим кешем модулей портит его: «module … is defined in both».
**Применимость.** частично: execroot Bazel у нас нет, переносится сам порядок действий.
*Источник: `build-system/Make/CLAUDE.md` («Replaying a release-only compiler crash from a CI log»); `CLAUDE.md` («Swift
6.4: SimplifyCFG crash…»)*

#### 4.1.4 Попиксельные циклы на Swift и уровень оптимизации
**Правило.** Не писать попиксельные циклы на Swift на главном пути: обои `ChatWallpaper`, размытие, заглушки.
Использовать Core Image (`LQIP.blur`), Core Graphics, `ImageIO`, Accelerate/vImage. Скорость такого кода замерять в
той сборке, о которой утверждаешь. На iPhone через `xtool dev build` это debug (`-Onone`), на CI и TestFlight —
release. Результат одной сборки ничего не говорит о другой.
**Почему.** У Telegram смешение обоев занимает 3,4 мс при `-O` и 1083 мс при `-Onone`. SIMD при `-Onone` медленнее
скалярного кода. Поэтому их модуль собирается с `-O` даже в debug.
*Источник: `GradientBackground/CLAUDE.md` (вступление; корневой «Per-module `-O` and pixel loops»)*

#### 4.1.5 Проверка полноты — полной сборкой, а не типизацией одного файла
**Правило.** После изменений, которые касаются видимости типов или сигнатур, проверять `xtool dev build` целиком, а
не только `swiftc -typecheck` одного файла. Это особенно важно, если приложение когда-нибудь разделят на пакеты.
**Почему.** У Telegram внутренний тип в `public init` другого модуля дал ошибку компиляции, которая всплыла только на
полной сборке.
**Применимость.** частично: у нас один модуль приложения.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 audio/music: «InstantPageMediaPlaylistId had to become public»)*

### 4.2 Предупреждения и доступность API

#### 4.2.1 Новый код не добавляет предупреждений
**Правило.** В своей правке не оставлять новых предупреждений, особенно о конкурентности Swift 6 при режиме языка 5.
Смотреть вывод `xtool dev build`. Глобально включать `-warnings-as-errors` в `Package.swift` или `project.yml` —
отдельная задача, только с согласия владельца.
**Почему.** У Telegram новые модули (в том числе `MediaPickerUI`) собираются с `-warnings-as-errors`, а чужой
вендоренный код — с `-w`.
**Сейчас у нас.** решение владельца: `SWIFT_TREAT_WARNINGS_AS_ERRORS: "NO"` (`apps/ios/project.yml:26`).
**Применимость.** частично: флаг не включён, правило держится дисциплиной.
*Источник: `docs/superpowers/plans/2026-10-27-media-picker-grid-stage2.md` (Global Constraints); P (Global Constraints:
«Warnings are errors for every new `swift_library`»)*

#### 4.2.2 После ретипизации искать предупреждения, которые у Telegram были бы ошибками
**Правило.** После смены типов искать в выводе сборки по файлам правки строки `always fails`, `never succeeds`,
`will never be executed`, `is never used` и исправлять их как ошибки.
**Почему.** У Telegram страховкой ретипизации служит предупреждение «'is' test always fails», превращённое в ошибку.
Первая же сборка поймала четыре чтения через неявный `self` как всегда-неуспешные приведения. У нас флаг выключен
(§4.2.1), поэтому искать приходится вручную.
*Источник: «the project compiles with `-warnings-as-errors`… "'is' test always fails"»; «Four reads used implicit
`self`…»*

#### 4.2.3 Новые API — под `#available` с рабочей веткой для iOS 17; чистые части — без UI
**Правило.** Минимальная версия — iOS 17. Всё из iOS 18/26 (Liquid Glass, новые API PhotoKit/AVKit) — под
`if #available`, с рабочей веткой для iOS 17. Чистую логику медиа держать в файлах без SwiftUI и сети, чтобы её
проверяли юнит-тесты: раскладку, выбор окна предзагрузки, ступени размеров (`ImageTarget`), окно галереи
(`ChatMediaWindow`).
**Почему.** У Telegram исходники сетки импортируют только UIKit, QuartzCore, Foundation, Photos и CoreList. API новее
минимальной iOS там только под `#available`, потому что код собирается и в приложении.
*Источник: `MediaGrid/CLAUDE.md` (правило импортов)*

#### 4.2.4 `#available` — только нижней границей; при подъёме минимума удалять мёртвые ветки
**Правило.** Проверки версии писать только снизу: `#available(iOS 26, *)`. Когда минимальная iOS поднимется (сейчас
17), удалить ветки ниже нового минимума.
**Почему.** Ветки ниже минимума больше не проверяются и тихо портятся. У Telegram потребители FFmpeg защищены
проверками «версия ≥ N», поэтому убранные API лежат в мёртвых ветках.
**Применимость.** частично: FFmpeg у нас нет, правило переносится на проверки версии iOS.
*Источник: `ffmpeg/CLAUDE.md` («App consumers are guarded lower-bound only»)*

### 4.3 Компилятор как проверка полноты

#### 4.3.1 Новое обязательное поле — без значения по умолчанию
**Правило.** Добавляя в модель поле, которое должно протекать через копии и производные значения (контекст пузыря
`bubbleContext` → `BubbleContext`, вход геометрии `MessageStackGeometry`, конфигурация ячейки), не давать ему
значения по умолчанию в инициализаторе. В каждом месте конструирования решать явно: переслать, разделить или обнулить.
**Почему.** У Telegram новые параметры `reservedCorners:`/`division:` с умолчанием скомпилировались бы во всех 42
местах конструирования и молча потеряли бы углы в производных раскладках. Без умолчания компилятор перечислил каждое
место.
*Источник: `docs/superpowers/specs/2026-09-25-reserved-corners-design.md` («1. Types»); план (Global Constraints)*

#### 4.3.2 `switch` по своим перечислениям — без `default:`
**Правило.** В функциях, которые перебирают виды блоков, вложений и сообщений (`ChatAttachmentKind`, `ChatMediaKind`,
`CommunityMarkdownView.Block`, превью списка чатов), и в классификаторах вида «поддерживается ли», «есть ли медиа»,
«можно ли править или переслать» не писать `default:`. Каждый случай решать явно. Новый случай должен не
компилироваться, пока ему не решат судьбу.
**Почему.** У Telegram рекурсия сборщика заканчивалась `default: break`, и код внутри цитаты никто не подсвечивал. При
`default: true` кнопки отправлялись бы как обычный текст и уничтожались. `default:` в сборе медиа компилировался и
молча переставал качать файл.
*Источник: `docs/instantpage-richtext.md` (Syntax highlighting: «previously ended in default: break»; Inline buttons:
«richTextIsEntityExpressible returns false for textButton», «allMedia… both need .document»)*

#### 4.3.3 Изменение формы `enum` — полная сборка плюс grep по всем читателям
**Правило.** Изменив `enum` со связанными значениями, собрать `xtool dev build` целиком и пройти
`grep -rn '\.case(' Sources Tests` по всему `apps/ios`. Включать тесты и моки UI-тестов (`Sources/App/UITesting`).
**Почему.** Новое связанное значение ломает все конструкции, поэтому полная сборка и есть проверка полноты. Но
читатели вне основного набора находятся только grep'ом.
*Источник: `docs/instantpage-richtext.md` (Task-list checkboxes, BlockQuote nested blocks: «The enum-arity change is
compile-enforced»)*

#### 4.3.4 Копию с изменением писать через `var copy = self`
**Правило.** «Копию с изменением» писать как `var copy = self; copy.x = …; return copy`. Не перечислять все поля в
`init`. Касается DTO, `MessageRecord` и моделей экранов.
**Почему.** У Telegram метод пересобирал тему поле за полем. Пропущенное поле возвращалось к умолчанию при смене
размера шрифта, и ошибкой компиляции это не было.
*Источник: `docs/instantpage-richtext.md` (Unsupported blocks: «MUST be listed in withUpdatedFontStyles»; Inline buttons:
«reconstructs the struct field by field»)*

#### 4.3.5 Тип шире схемы — недостижимые случаи сводить явно и записывать
**Правило.** Переиспользуя общий `enum` в контексте, где часть значений недопустима (например, `Role`), записать
недостижимые значения и то, как они обрабатываются.
**Почему.** У Telegram переиспользованный тип шире допустимого. Недостижимые случаи при кодировании сводятся к
`disabled`, и это записано.
**Применимость.** частично: прямого аналога у нас нет.
*Источник: `docs/instantpage-richtext.md` (Inline buttons: «ReplyMarkupButtonAction is deliberately reused»)*

#### 4.3.6 Никаких `fatalError`/`preconditionFailure` на данных извне
**Правило.** `fatalError` и `preconditionFailure` в `default` по данным с сервера или из базы запрещены. Вместо них —
ветка `unknown`. Ища соответствия протоколу, проверять все написания: через `typealias`, в списке после первого, в
`extension`.
**Почему.** У Telegram обёртка с аварийной веткой `default` упала в релизе на трёх неучтённых классах: grep `': Media\b'`
не увидел другого написания. `preconditionFailure` нельзя поймать в XCTest.
*Источник: «Post-review fix: `EngineCustomMedia`»*

#### 4.3.7 Порядок параметров `init` с умолчаниями совпадает с вызовами
**Правило.** Новые параметры (например, замыкания в `MessageBubbleView` и `MessageCapabilities`) добавлять в конец
или сразу обновлять все вызовы.
**Почему.** Swift требует, чтобы именованные параметры шли в объявленном порядке.
*Источник: `docs/instantpage-richtext.md` (Task-list checkboxes: «their init-parameter order must match the
ChatController call-site order»)*

#### 4.3.8 Перестановка аргументов меняет порядок вычисления
**Правило.** Если при смене сигнатуры аргументы имеют побочные эффекты (`await`, счётчики, `next()`), сохранять
порядок их вычисления или выносить их в локальные `let`.
**Почему.** Telegram переставлял аргументы, только убедившись, что они без побочных эффектов.
*Источник: Wave P6 («Moving `reference:` first changes the order in which arguments are evaluated»)*

### 4.4 Ловушки семантики Swift

#### 4.4.1 В словаре с опциональным значением `= nil` удаляет ключ
**Правило.** Для `[K: V?]` записывать «известно, что nil» только через `dict.updateValue(nil, forKey: k)`. Запись
`dict[k] = nil` означает «ключа нет». На ревью искать `: [.*: .*?]`.
**Почему.** У Telegram семь мест «опросить канал» молча не работали два года. Удаление медиа не доходило до
представлений.
**Сейчас у нас.** соблюдено: `ChatStore.setPinnedOrder` возвращает `[String: Int?]`
(`Core/Chats/ChatStore.swift:81`) и строит его через `Dictionary(uniqueKeysWithValues:)`. При правке не заменять
это на присваивание `previous[id] = chat.pinnedOrder`.
*Источник: `docs/state-sync.md` (инвариант 25); `Postbox/CLAUDE.md` («`updatedMedia[id] = nil`… deletes the key»)*

#### 4.4.2 Исключительный доступ: вложенный и перекрывающийся
**Правило.** Не обращаться к тому же хранимому свойству из замыкания, переданного в мутирующий метод этого свойства
(`entries[key].mutate { … self.entries … }`). Не держать `inout` на поле класса через вызов, который может это поле
читать. Проверяется только тестом этого пути: компилятор такое не ловит.
**Почему.** Замыкание, вызванное, пока значение удерживается через вычисляемое свойство, теряет вложенную запись.
Перекрывающийся доступ к полю класса падает во время выполнения, и только на том пути, который до него доходит.
*Источник: `docs/state-sync.md` (инварианты 10, 20)*

#### 4.4.3 Указатель из временного буфера не выносить за замыкание
**Правило.** Указатель из `Data.withUnsafeBytes` или `withUnsafeBufferPointer` не выносить за пределы замыкания.
Вычисляемое свойство, которое возвращает `Data`, держать в локальной `let` или в `withExtendedLifetime` на всё время
работы с байтами (аудио, изображения, разбор файлов).
**Почему.** Геттер возвращает новый буфер при каждом обращении. Указатель из него — это use-after-free.
*Источник: «A bytes field's getter returns a new `Buffer` on every access…»*

#### 4.4.4 Имя поля DTO не должно совпадать с требованием протокола
**Правило.** DTO с полем `description` (например, `MessageExtras.LinkPreview.description` в `Core/Chats/ChatDTO.swift`)
не подписывать на `CustomStringConvertible`. Тип с полем `hash` не подписывать на `Hashable` с ручной реализацией
через это поле.
**Почему.** Компилятор это примет, но смысл подменится. У Telegram типы ни от чего не наследуют, поэтому поле
`description`/`hash` всегда остаётся полем.
*Источник: «Not NSObject on purpose… a TL field named `hash` or `description` is always the field»*

#### 4.4.5 Ручное `==` — под тест
**Правило.** На каждое ручное `==` (например, `MessageHeightEstimate.Input` в `MessageStackGeometry.swift:58`)
писать тест: «равное равно, разное не равно».
**Почему.** У Telegram `isEqual` возвращал обратное и был безвреден, пока путь не начали использовать.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 audio/music: «Fixed a dormant inverted isEqual»)*

#### 4.4.6 Переопределяемый метод — требованием протокола, не только в `extension`
**Правило.** Метод, который типы переопределяют, объявлять в теле протокола как требование, а не только в
`extension`.
**Почему.** Реализация только в `extension` вызывается статически. Через ссылку типа протокола молча берётся значение
по умолчанию.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 collage & slideshow: «explicit per-class witnesses»)*

#### 4.4.7 Локальная переменная, ставшая полем, теряет безопасность повторного входа
**Правило.** Вынося локальные флаги («был первым респондером», «идёт программная правка») в свойства
`ComposerTextController` или `Coordinator`, копировать их в `let` до вызовов UIKit (`becomeFirstResponder`,
`replace`), которые могут синхронно позвать делегата.
**Почему.** Локальную переменную видит только свой кадр стека. Перенесённая в поле объекта, она перезаписывается
вложенным вызовом изнутри `super` или системного кода.
*Источник: `docs/superpowers/richtext-seam-stage2-inheritance.md` (D27, Family 8)*

#### 4.4.8 Параметр не может быть условным
**Правило.** Если часть кода уходит под `#if` (Sentry, `UITestHooks`), сигнатуры общего кода не должны называть типы
из неё. Передавать свои нейтральные типы.
**Почему.** Параметр инициализатора не может стоять внутри `#if`. Поэтому Telegram передаёт через конвейер свои типы.
**Применимость.** частично: у нас таких сигнатур мало, правило — на будущее.
*Источник: «a parameter of `AccountFinalStateEvents`' initializer cannot be inside an `#if`»*

#### 4.4.9 Имена в модуле уникальны
**Правило.** Приложение — один модуль. Делая `private` тип внутренним (`internal`), проверить grep'ом, что такого
имени нет в другом файле (`DurationBadge`, `Thumb`, `Placeholder`…), и дать предметное имя.
**Почему.** У Telegram общие куски значков стали внутримодульными под уникальными именами, потому что соседний файл
держит приватные типы с простыми именами.
*Источник: `PeerInfoVisualMediaPaneNode/CLAUDE.md` («Shared helpers»)*

### 4.5 Конкурентность и время жизни

#### 4.5.1 Главный поток синхронно ждёт только того, кто никогда не ждёт главный
**Правило.** Не использовать `DispatchQueue.main.sync`, семафоры и ожидание `Task { … }.value` на главном потоке для
работы, которая сама может прыгнуть на `@MainActor`.
**Почему.** Будет взаимная блокировка. У Telegram главный поток синхронно ждёт выделенный поток только потому, что тот
никогда не ждёт главного.
*Источник: P (Task 7, `MessageWidgetExecutor`: «deadlock-free because JS never waits on main»); S13 §2 («Stack», п. 3)*

#### 4.5.2 Не менять состояние SwiftUI синхронно из `updateUIView`/`sizeThatFits`
**Правило.** В `updateUIView` и `sizeThatFits` все изменения состояния делать через `DispatchQueue.main.async`.
Новую логику туда добавлять по тому же образцу. Сеттеры настроек не раскладывают и не стреляют событиями.
**Почему.** Иначе «Modifying state during view update», рекурсия и лишние проходы.
**Сейчас у нас.** соблюдено: так сделаны `controller.refresh/measure`, переключение `isScrollEnabled` и фокус в
`Thread/Composer/ComposerTextView.swift`.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` («Parent-driven layout and state»)*

#### 4.5.3 `TaskLocal` не переходит в отсоединённые задачи и чужие колбэки
**Правило.** `ScreenCache.scope` — это `@TaskLocal` (`Core/Cache/ScreenCache.swift:56`). В `Task.detached`,
колбэках socket.io, `NotificationCenter` и GRDB-наблюдении его нет. Если запрос должен идти в рамках кеша экрана,
вызывать его из задачи, которая унаследовала scope, или ставить scope явно: `ScreenCache.$scope.withValue`.
**Почему.** У Telegram контекст в `TaskLocal` терялся в задачах, запущенных чужим рантаймом, поэтому его ставят явно и
снимают после.
*Источник: «Swift `TaskLocal` carries the session… UniFFI launches separate tasks…»*

#### 4.5.4 Работа после `await` и на другом потоке сначала проверяет, что ещё не остановлено
**Правило.** `Task { [weak self] … }` и колбэки после `await` проверяют, что модель ещё жива и сессия та же. Редкие
гонки воспроизводить многократным прогоном теста, а не одним.
**Почему.** У Telegram фоновая запись захватывала сырой указатель, а закрытие его уничтожало. Под параллельной
нагрузкой было ~2 % падений; после флага `_isStopped` — 5000 из 5000 прогонов прошли.
*Источник: «Known Issues» (`writeStateLogRecords()`, `_isStopped`)*

#### 4.5.5 Время жизни и порядок остановки записаны
**Правило.** Модель для отрисовки карточки — неизменяемый `struct` (`MessageRecord`, `MessageExtras` — `Hashable`),
который безопасно передавать между потоками. У объектов с ресурсами (`CLLocationManager` в `LiveLocationSharing`,
сокет в `RealtimeTransport`) один владелец и явный порядок остановки: сначала realtime, потом стирание данных, как в
`AppSessionModel.signOut()`.
**Почему.** У Telegram каждая сырая ссылка спарена со счётной. Кто разрушается первым, записано и закреплено тестами.
Опубликованное дерево — неизменяемые данные, которые живут дольше документа.
*Источник: R («Lifetime», «`RenderTree` is destroyed first», «The tree is plain data and outlives its document»)*

### 4.6 Типы, API и контракты

#### 4.6.1 «Нет значения» — это `Optional`, а не заглушка
**Правило.** «Нет значения» выражать через `Optional`, а не через `""`, `0` или `"unknown"`. Известность — явным
признаком (`isKnown`), а не сравнением со значением.
**Почему.** У Telegram «неизвестный SSRC» и настоящий `userId` 0 по значению не отличались.
*Источник: «Membership decides, not the value»*

#### 4.6.2 Данные с сервера не мутировать на месте
**Правило.** Правку данных с сервера делать новой копией в модели экрана, а не мутацией общего DTO из кеша
(`ScreenCache`, GRDB-записи).
**Почему.** У Telegram поля полезной нагрузки только читаются: чтобы изменить поле, создают новое значение.
**Применимость.** частично: часть наших DTO объявлена через `var` ради значений по умолчанию при декодировании.
*Источник: «Payload fields are read-only. To change one, construct a new `Cons_y`»*

#### 4.6.3 Функция возвращает то, что обещает контракт; «залипшую» ошибку не читать
**Правило.** После успешной операции не читать «последнюю ошибку» как её причину. Функция возвращает то, что обещает
вызывающему, а не внутреннюю величину.
**Почему.** У Telegram декоратор вернул длину шифротекста вместо обещанной, вызывающий прочитал давнюю, никогда не
сбрасываемую ошибку канала и остановил отправку.
*Источник: spec («Send return value… reads the ICE channel's never-cleared last error»)*

#### 4.6.4 Доменный тип не заменять на `Any`; API менять на месте
**Правило.** Не вводить `Any`/`AnyHashable` вместо доменного типа. Сигнатуру менять на месте и обновлять всех
вызывающих в том же коммите. Старую перегрузку «на время» не оставлять.
**Почему.** Стирание типа выбрасывает смысл. Параллельные перегрузки дробят API и оставляют старый путь навсегда.
*Источник: корневой `CLAUDE.md` Telegram, правила 8 и 10*

#### 4.6.5 Умолчания обёртки совпадают с оборачиваемым
**Правило.** Новая обёртка (`Endpoint+Verbs`, методы `*API`) повторяет умолчания того, что оборачивает: таймаут,
`isIdempotent`, `requiresAuthorization` (`Core/Network/Endpoint.swift:20,30`). Проверять это явно. Перегрузки не
должны создавать двусмысленных вызовов.
**Почему.** Telegram сначала составляет опись и сверяет каждое умолчание фасада с источником.
*Источник: «Inventory first, and check every facade default against its source»; Wave P6*

#### 4.6.6 Новые классы — `final`
**Правило.** Новые классы объявлять `final` по умолчанию: модели экранов — `@Observable final class`.
**Почему.** У Telegram в Bazel-сборке непересобранные зависимые падают на устаревшей vtable. У нас SwiftPM и Xcode
пересобирают модуль целиком, так что этой ловушки нет. `final` даёт статическую диспетчеризацию и явное намерение.
**Применимость.** частично: причина Telegram (Bazel) у нас отсутствует, правило держим ради диспетчеризации.
*Источник: P (Global Constraints: «New Swift classes are `final`»)*

#### 4.6.7 Массовая замена — только источника цикла, отдельным коммитом
**Правило.** Механические замены по многим файлам делать отдельным коммитом, без попутных правок логики. В описании
перечислить, что отложено. Полноту проверять полной сборкой.
**Почему.** Замена типо-одинаковая. Ветки поведения по видам Telegram не трогает: меняет только источник цикла.
*Источник: `docs/instantpage-richtext.md` (Rich-message media: «Only switch the loop SOURCE»; «Build-only completeness gate»)*

#### 4.6.8 Код в брифе и плане должен компилироваться
**Правило.** Код в брифах агентам и в планах проверять типизацией (`swiftc -typecheck` против модуля), прежде чем
отдавать исполнителю. Противоречие в брифе — повод задать вопрос, а не выбирать наугад.
**Почему.** У Telegram бриф объявлял хранимые свойства и `override` в расширении — в Swift так нельзя. Пункты брифа
противоречили друг другу.
*Источник: `docs/superpowers/richtext-seam-stage2-inheritance.md` (D27 — TWO TASK-31 BRIEF DEFECTS; D36/D37)*

### 4.7 Неприменимо к нам

Записей со статусом «неприменимо» в разделе нет. Частично применимые отмечены строкой «Применимость» у правил 4.1.3,
4.1.5, 4.2.1, 4.2.4, 4.3.5, 4.4.8, 4.6.2, 4.6.6.

---
## §5. UIKit и SwiftUI: окна, касания, клавиатура, раскладка, жесты

Как окна, клавиатура, касания и раскладка ведут себя на самом деле, особенно на iOS 26/27, где их поведение
расходится с документацией. Главное: касание и геометрию проверяют настоящим пальцем на iPhone, потому что
`hitTest` в тесте и симулятор показывают не то, что получает пользователь. У каждого касания, рамки и
жеста должен быть ровно один владелец.

### 5.1 Окна и клавиатура

#### 5.1.1 Положение клавиатуры — только из публичных уведомлений; nil значит «клавиатуры нет»
**Правило.** Рамку клавиатуры брать только из `keyboardWillChangeFrame`/`keyboardWillHide`, как
`Thread/Menu/KeyboardFrame.swift`. Не искать окно клавиатуры по иерархии, через `UIApplication.windows`
или приватные классы. Если данных о клавиатуре нет, считать, что она спрятана, а не что произошла ошибка.
**Почему.** У Telegram `+[UIRemoteKeyboardWindow remoteKeyboardWindowForScreen:create:]` при сборке с SDK
iOS 27 падает с `brk #0`: запрет срабатывает по версии SDK, а не ОС. Окно клавиатуры законно бывает nil,
если она ещё не создавалась или вынесена из процесса.
**Сейчас у нас.** Соблюдено: `KeyboardFrame` слушает только публичные уведомления.
*Источник: `CLAUDE.md` («iOS 26/27 windows and touch delivery», п. 1); `docs/ios27-windows-and-touches.md` («Getting the keyboard window»)*

#### 5.1.2 Своё окно никогда не окажется выше клавиатуры
**Правило.** Меню и оверлеи не поднимать поверх клавиатуры отдельным `UIWindow` с повышенным `windowLevel`.
Если элемент должен быть виден при открытой клавиатуре, его ставят над ней по её рамке либо прячут
клавиатуру.
**Почему.** `UIRemoteKeyboardWindow` стоит на уровне 1e7+1, а уровень окон приложения система обрезает
до 1e7. Поэтому своё окно всегда рисуется под клавиатурой.
**Сейчас у нас.** Соблюдено: `MessageMenuOverlay` раскладывается над клавиатурой по `KeyboardFrame.top`.
*Источник: `CLAUDE.md` («iOS 26/27 windows…», п. 2); `docs/ios27-windows-and-touches.md` («Window levels»)*

#### 5.1.3 Окно клавиатуры не искать в списках окон; касания над ней приходят нам
**Правило.** Не перебирать `windows`, чтобы найти клавиатуру. Зона над полем ввода (оверлей меню, лист
вложений) должна быть готова принять касание, которое пришло «сквозь» клавиатуру.
**Почему.** Окно клавиатуры — внутренняя сцена с `isInternalWindow`. Его нет ни в `UIWindowScene.windows`,
ни в `UIApplication.windows` (SDK фильтрует его с iOS 16). Вне своих клавиш оно возвращает из `hitTest`
nil, и касание проваливается в окно под ним.
*Источник: `docs/ios27-windows-and-touches.md` («Getting the keyboard window», «Window levels»)*

#### 5.1.4 Не переводить координаты между окнами на разных `UIScreen` (iOS 27: NaN)
**Правило.** Перед `convert(_:to:)` между окнами, которые могут оказаться в разных сценах (системный лист,
оверлей в отдельном окне), сравнить `window?.screen`. Если экраны разные, связывать окна через их `frame`.
Значение с `isInfinite`/`isNaN`/`isNull` никогда не присваивать в `frame`/`center`.
**Почему.** На iOS 27 окно клавиатуры живёт на другом объекте `UIScreen`, хотя дисплей тот же. `convert`
между такими окнами возвращает `CGRectNull` с бесконечным началом. Следующее присваивание роняет
приложение с ошибкой `CALayer position contains NaN` или запускает анимацию «из бесконечности». Telegram
нашёл четыре таких случая один за другим.
**Сейчас у нас.** Соблюдено: все переводы идут внутри одного окна (`convert(…, to: nil)` в `MessageListView`
и `BubbleAnchor`, `to: window` в `PullToRefresh` и `ScreenKit`). Телефон владельца на iOS 27, так что правило
понадобится, как только появится второе окно.
*Источник: `docs/ios27-windows-and-touches.md` («Never convert coordinates between the app window and the keyboard window (iOS 27)»)*

#### 5.1.5 Перенос вида в другой контейнер на время анимации
**Правило.** Когда вид на время анимации переносят в другой контейнер (например, «пузырь → меню»:
`BubbleAnchor` + `MessageMenuOverlay`):
1. Не определять, «чей это элемент», по текущему `superview`.
2. Перекрывающиеся открытия (второе меню раньше, чем закрылось первое) делят один перенос, а вернуть вид
   на место можно только после последнего.

`matchedGeometryEffect` между разными презентациями (`sheet`/`fullScreenCover`) работает через отдельные
окна, поэтому проверять его покадрово.
**Почему.** У Telegram морф меню не рисовался через портал между окном приложения и окном клавиатуры.
Пока источник был перенесён, код, который узнавал его по месту в иерархии, переставал его узнавать. Второе
меню находило источник уже в своём окне.
**Применимость.** Частично: окна клавиатуры для меню у нас нет, переносится принцип.
*Источник: `docs/ios27-windows-and-touches.md` (четвёртая жертва: `LensTransitionContainer`, `CrossWindowSourceTake`)*

#### 5.1.6 Своё `UIWindow` создавать только уже привязанным к сцене
**Правило.** Если понадобится своё окно, создавать его через `UIWindow(windowScene:)` и только потом
назначать корень. Исправление бага, который не воспроизводится на новой ОС, проверять на той версии, где
баг есть.
**Почему.** Клиент поворота регистрируется в `setRootViewController:`, только если окно уже в
`UIWindowScene`. Без этого клавиатура остаётся в старой ориентации (iOS 26). На iOS 27 баг не
воспроизводится, поэтому проверить на ней исправление нельзя.
**Сейчас у нас.** Окна создаёт SwiftUI (`WindowGroup`). Свои `UIWindow` есть только в тестах, и там они
сделаны правильно: `Tests/StudentHubSnapshotTests/SnapshotTestCase.swift:117`.
**Применимость.** Частично: приложение только портретное (`UISupportedInterfaceOrientations` в `project.yml`).
*Источник: `docs/ios27-windows-and-touches.md` («The keyboard rotates only by following the app window (iOS 26)»)*

#### 5.1.7 Системную геометрию перечитывать при раскладке и применять только при изменении
**Правило.** Значения, от которых зависит раскладка (верх клавиатуры, safe area ленты), не брать из одного
уведомления. Их перечитывают на проходе раскладки и применяют, только если они изменились: повтор того же
значения ничего не делает. Чтобы отладить такой наблюдатель, временно ставят лог «только при изменении» и
проверяют, что в покое он молчит.
**Почему.** Системные регионы меняются вместе с проходом `layoutSubviews`, иногда без смены safe area, так
что одного `viewSafeAreaInsetsDidChange` мало. Если не отбрасывать одинаковые значения, раскладка
повторяется бесконечно. Отчёт системы первые 0,65 с после поворота бывает переходным.
**Применимость.** Частично: поворотов и iPhone Duo у нас нет, а принцип для `KeyboardFrame` и ленты
переносится.
*Источник: `docs/superpowers/specs/2026-09-25-reserved-corners-design.md` («Measured facts»); `docs/iphone-duo-layout.md` («The device»); `docs/superpowers/plans/2026-09-25-reserved-corners.md` (Review Focus 1–2)*

#### 5.1.8 Отступы под клавиатуру задаёт один владелец
**Правило.** Отступ под клавиатуру для поля или ленты ставит один владелец. Если высоту уже уменьшил
SwiftUI (избегание клавиатуры), `UITextView` не должен добавлять свой отступ: тогда ему
`contentInsetAdjustmentBehavior = .never`. Смена отступа не двигает прокрутку пользователя. Исключение —
прокрутка, которая стояла в самом верху.
**Почему.** У Telegram поле получает отступы от хоста и само клавиатуру не наблюдает, иначе отступ
посчитается дважды.
**Сейчас у нас.** Лента сделана правильно (`MessageListView.swift:542`, `.never`). У `ComposerUITextView`
оставлено `.automatic` по умолчанию. Проверить на iPhone, что в полноэкранном редакторе под клавиатурой
нет двойного пустого места.
**Применимость.** Частично: нужна проверка.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` («Parent-driven layout and state»); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` («Caret and scrolling»)*

#### 5.1.9 Смену отступа под пальцем не компенсировать второй раз
**Правило.** Пока палец на ленте (`collectionView.isTracking`, без инерции), смену её высоты или нижнего
отступа не компенсировать сдвигом `contentOffset`: ленту уже двигает палец. Сами отступы при этом
применяются. Подменять это доп. прокруткой на «−дельта» нельзя.
**Почему.** Когда клавиатура скрывается интерактивно, один жест и листает историю, и уменьшает отступ.
Компенсация сдвигает содержимое на двойной путь пальца, а прокрутка на «−дельта» гасит инерцию и
отцепляет ленту от низа.
**Сейчас у нас.** Проверить на iPhone: у ленты `keyboardDismissMode = .interactive`, и
`viewDidLayoutSubviews` зовёт `scrollToBottom` или `shiftKeepingBottom(by:)`, не проверяя `isTracking`
(`MessageListView.swift:208-216`). Медленно тянуть клавиатуру вниз из середины переписки: лента не должна
ехать вдвое быстрее пальца.
*Источник: `docs/chat/corelist-chat-history-backend.md` («Inset changes while tracking»); `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (`compensatesInsetChange`)*

#### 5.1.10 Взмах, закрывший клавиатуру, не должен ещё и швырнуть ленту
**Правило.** Не добавлять над лентой свой распознаватель, который закрывает клавиатуру: это делает сам
`UIScrollView` (`keyboardDismissMode = .interactive`). Если свой всё же понадобится, то, закрыл ли жест
клавиатуру, решать в момент отпускания (отпускать с нулевой скоростью), а не на следующем проходе
раскладки.
**Почему.** Telegram отпускает такой взмах с нулевой скоростью. Если отпускание пропустить, лента остаётся
за краем. Флаг, выведенный из уже завершённого прохода раскладки, Telegram называет «правильной идеей в
неправильное время».
**Применимость.** Частично: эту механику у нас держит система.
*Источник: `docs/chat/corelist-chat-history-backend.md` («The dismissing flick must not also fling», `shouldStopScrolling`)*

#### 5.1.11 Свой `hitTest` окна или оверлея не должен глушить системное меню правки
**Правило.** Если появится своё `UIWindow` или оверлей с переопределённым `hitTest`, он обязан пропускать
контейнер `UIEditMenuInteraction`. Проверять на iPhone, что пункты меню над выделением в поле нажимаются.
**Почему.** Меню правки живёт в своём верхнем контейнере. Если окно его не пропускает, касания по меню
проваливаются в контент.
**Применимость.** Частично: своих окон и `hitTest` уровня окна у нас пока нет, правило на будущее.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («The system edit menu needs `Window1.hitTest`»); `docs/richtext-composer.md` (§3)*

### 5.2 Доставка касаний: прозрачные виды, наложения, `hitTest`

#### 5.2.1 Вид, который ничего не рисует, не получает касаний
**Правило.** В SwiftUI каждому стеклу и прозрачному ловцу касаний давать `contentShape`; это уже принятое
правило. В UIKit прозрачный вид, который должен ловить тап (подложка «тап мимо — закрыть»), получает
прозрачные `layer.contents` (пустую картинку 1×1) или собственный `point(inside:)` либо жест на родителе.
`backgroundColor = .clear` и почти нулевая альфа для этого не годятся. Проверять настоящим касанием на
iPhone с iOS 27, а не `hitTest` в тесте.
**Почему.** Слой без `backgroundColor` и без `contents` на iOS 26/27 не получает настоящих касаний, хотя
`hitTest` его возвращает. `.clear` и alpha 0,0001 не срабатывают, alpha 0,0004 срабатывает, но полагаться
на этот порог нельзя. Ещё одна ловушка: обёртка с ранним выходом «цвет не изменился» так ни разу и не
присваивает цвет.
**Сейчас у нас.** Соблюдено в SwiftUI: `contentShape` стоит в 167 местах.
*Источник: `CLAUDE.md` («iOS 26/27 windows…», п. 3); `docs/ios27-windows-and-touches.md` («A layer that renders nothing receives no touches»); `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Tile rule»)*

#### 5.2.2 Наложения и вложенные виды пропускают касания везде, кроме своих контролов
**Правило.** Вид поверх интерактивного содержимого отвечает `point(inside:)`/`hitTest` только своими
частями: кнопкой, капсулой. Вне их он возвращает nil, а скрытый вид касание не забирает. В SwiftUI для
этого у декоративного `allowsHitTesting(false)`, а `contentShape` только у контролов. Новые наложения над
`collectionView` ленты (бейджи, кнопка «вниз») проверять на iPhone касанием под ними, не только
прокруткой.
**Почему.** Если проброс сломан, этого не видно: лента листается, а нажать ничего нельзя.
**Сейчас у нас.** Соблюдено: `FloatingDateView.point(inside:)` отвечает только по капсуле
(`MessageListView.swift:1472`); у `AnchorView` `isUserInteractionEnabled = false` (`Menu/BubbleAnchor.swift:51`);
у стрелки свайпа тоже (`SwipeToReply.swift:42`).
*Источник: `submodules/TelegramUI/Components/RichTextEditorMediaView/CLAUDE.md` («Interaction is control-scoped via `hitTest`»); `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Attachments: «Every view in the attachment chain must be a passthrough»)*

#### 5.2.3 Подложки и оверлеи над полем ввода не перехватывают касания
**Правило.** Любой оверлей поверх `ComposerTextView` ставить с `allowsHitTesting(false)` и
`accessibilityHidden(true)`. Ниже подсветки выделения — только неинтерактивное.
**Почему.** Иначе оверлей съедает касания, которые нужны для курсора и лупы.
**Сейчас у нас.** Соблюдено: подсказка «Сообщение» (`Composer/ComposerEditorView.swift:60-61`).
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Selection wash and hosted views»)*

#### 5.2.4 `hitTest` зовут и для касаний вне вида
**Правило.** Побочные эффекты в `hitTest`/`point(inside:)` допустимы только после проверки, что точка
попала в свою область. Событие «касание началось» брать из `touchesBegan` или распознавателя.
**Почему.** UIKit опрашивает верхний вид о каждом касании на экране. Если считать вызов `hitTest`
касанием «меня», то, как у Telegram, прокрутка ленты будет обрывать анимацию шапки.
**Сейчас у нас.** Соблюдено: `FloatingDateView.point(inside:)` только проверяет область.
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` (Rulings: «Capsules outlive…»)*

#### 5.2.5 Уходящий элемент касаний не принимает, приходящий принимает сразу
**Правило.** Элементы, которые исчезают анимацией (кнопка «вниз», панель ответа, гаснущая плавающая дата),
перестают принимать касания с начала ухода (`allowsHitTesting(false)` / `isUserInteractionEnabled = false`).
Появляющиеся принимают с начала появления.
**Почему.** Так у Telegram сделаны капсулы навбара: прибывающая нажимается сразу, уходящая не нажимается
вовсе.
**Сейчас у нас.** Плавающая дата соблюдает: `point(inside:)` отказывает при `alpha ≤ 0.01`.
*Источник: `docs/superpowers/specs/2026-10-15-navbar-split-right-buttons-design.md` (Design §2: «Taps: an arriving pill takes taps at once; a leaving one takes none»); `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` («Removed capsule… stops taking touches»)*

#### 5.2.6 Строка в морфе не принимает касаний, лента под ней принимает
**Правило.** Если появится длинный морф строки (меню, раскрытие), строка в полёте не открывает меню, не
подсвечивается и не начинает свайп. Прокрутка ленты на ней при этом начинается.
**Почему.** У Telegram морфирующая строка не принимает нажатие, подсветку, долгое нажатие и новый свайп,
а прокрутка и пейджер на ней работают.
**Применимость.** Частично: въезд пузыря (`animateEntrance`, `.allowUserInteraction`) короткий, длинных
морфов строк у нас нет.
*Источник: `submodules/TelegramUI/Components/News/CLAUDE.md` («A morphing row takes no touches until it lands»)*

#### 5.2.7 Пустой обработчик — тоже обработчик
**Правило.** Не вешать «на всякий случай» `.onTapGesture {}` или `Button {}`. В ячейках ленты нажатие на
ссылку или вложение принадлежит им, а нажатие на пустое место пузыря — никому (ленте).
**Почему.** У Telegram само наличие замыкания меняло поведение: пузырь отвечал на нажатие пустым действием,
и нажатие строки не срабатывало.
*Источник: `submodules/TelegramUI/Components/News/CLAUDE.md` (Taps: «The feed item has no `tapMessage`…»)*

#### 5.2.8 Тап «раскрыть» уступает ссылкам внутри текста
**Правило.** `.onTapGesture` на контейнере текста (раскрыть цитату или длинный текст) не должен перехватывать
`Link`/`openURL`. Рамка, внутри которой есть ссылки, неинтерактивна: переключение срабатывает последним,
после ссылок.
**Почему.** У Telegram интерактивная рамка забирала касание раньше, чем разбирались ссылки, и ссылка
сворачивала цитату вместо того, чтобы открыться.
*Источник: `docs/instantpage-richtext.md` (Collapsed quotes: «The frame view stays isUserInteractionEnabled = false»)*

#### 5.2.9 Плашка времени поверх содержимого — зона пузыря
**Правило.** Для плашки времени поверх медиа выбрать одно правило и держать его: либо касание по плашке
принадлежит пузырю и не открывает медиа, либо наоборот. Учитывать, что при сжатии пузыря по долгому
нажатию точка касания смещается.
**Почему.** У Telegram дата поверх виджета и коробка вокруг неё принадлежат пузырю. Коробка учитывает
сжатие при нажатии, а виджету сообщают, какая зона закрыта.
**Применимость.** Частично: содержимого, которому нужно сообщать безопасную зону, у нас нет. См. также
§12 (время поверх карточки).
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («The time over the widget is its content safe area»)*

### 5.3 Жесты ленты чата

#### 5.3.1 Арбитраж жестов — решением «начинать ли», без `require(toFail:)` и одновременности
**Правило.** Конфликты жестов в `MessageListView` и других UIKit-местах решать в
`gestureRecognizerShouldBegin`/`shouldReceive`. Касание владеет тот, кто распознал первым, как у
`UIScrollView`. Новых `require(toFail:)` на панораму ленты не добавлять. Одновременное распознавание
панорамы ленты с жестами строк (`SwipeToReply`, `menuPress`) не разрешать. Если жесты нужно вложить в
прокрутку хоста, ставить ей `delaysContentTouches = false`.
**Почему.** `require(toFail:)` задерживает касание. Разрешённая одновременность перебивает отказы в других
местах, и содержимое едет вместе с историей. Telegram пробовал чинить это через
`shouldBeRequiredToFailBy`, но тогда распознаватель висит в `.possible` до отпускания, а долгое нажатие
тем временем играет анимацию, которая так и не срабатывает («лимб»). Ленты, где есть только тапы, такую
регрессию не ловят.
**Сейчас у нас.** Проверить на iPhone: в `SwipeToReply.attach(to:)` стоит
`collectionView.panGestureRecognizer.require(toFail: pan)` (`SwipeToReply.swift:32`). Задержка мала, потому
что свайп сразу отказывается при движении не влево. Проверить, что касание останавливает катящуюся ленту
и что долгое нажатие сразу после взмаха работает без задержки.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` («Gestures», «Gate-only arbitration»); `docs/chat/corelist-chat-history-backend.md` (Gesture arbitration); `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (The limbo gotcha)*

#### 5.3.2 Начало любого перетаскивания отменяет ожидающее меню
**Правило.** Когда начинается перетаскивание ленты или свайп «ответить», ожидающее долгое нажатие
`menuPress` отменяется (`MessageMenuTouch` сбрасывается) до того, как сыграет анимация нажатия. Сдвиг
пальца больше `allowableMovement` (10 pt) проваливает меню. Касание катящейся ленты не открывает меню и не
выбирает пункт. Сценарий «медленный свайп ответить не открывает меню» закрыть UI-тестом.
**Почему.** Меню не должно открыться после того, как человек начал листать. У Telegram начало свайпа не
проваливало долгое нажатие, и меню открывалось через 0,23 с каждого свайпа.
**Сейчас у нас.** Проверить на iPhone: явной отмены `menuPress` при старте `SwipeToReply.pan` нет. Работа
держится на умолчании UIKit (одновременность не разрешена) и на `allowableMovement`; `menuPress` с
длительностью 0,3 с настроен в `MessageListView.swift:553`.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Interactive drag start; Gesture arbitration); `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Drags are decided per press»)*

#### 5.3.3 Распознаватели ленты — на том же виде, что и её панорама
**Правило.** `menuPress`, `SwipeToReply.pan` и будущие жесты ленты вешать на `collectionView`. Не вешать
их на `view` контроллера или SwiftUI-оверлей над `MessageListView`.
**Почему.** UIKit собирает распознаватели касания от вида вверх, а `gestureRecognizerShouldBegin` перебирает
`pan.view.gestureRecognizers`. Распознаватель на предке молча ломает отложение и перехват.
**Сейчас у нас.** Соблюдено.
*Источник: `submodules/TelegramUI/Sources/CLAUDE.md` (compiler-invisible invariants: `scrollGestureHostView`)*

#### 5.3.4 Свои распознаватели на ленте: `delaysTouchesEnded = false` и уборка на любом завершении
**Правило.** Кнопки внутри пузырей (вложения, опросы, «показать ещё», ссылки) должны срабатывать сразу.
Если они срабатывают с задержкой, своим распознавателям ставить `delaysTouchesEnded = false`, как у
`UIScrollView.panGestureRecognizer`. Своё состояние (стрелка свайпа, сдвиг ячейки) убирать и на
`.cancelled`/`.failed`, а не только на `.ended`.
**Почему.** По умолчанию `delaysTouchesEnded = true`, и `UIControl` в строках не получает отпускание.
Провалившийся пан обязан сообщить об отпускании из `reset()`, иначе содержимое остаётся за краем.
**Сейчас у нас.** Проверить на iPhone: `SwipeToReply.pan` и `menuPress` созданы с умолчаниями.
`false` стоит только у `App/KeyboardDismissal.swift:42`. Уборку на `.cancelled`/`.failed` оба делают:
`SwipeToReply.reset()` и `touch.reset()`.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (The limbo gotcha: «`delaysTouchesEnded` must stay `false`…», «A pan that FAILS reports the lift from `reset()`»)*

#### 5.3.5 Касание, остановившее инерцию, — не нажатие
**Правило.** Касание катящейся ленты не открывает вложение, ссылку или меню. `UIScrollView` сам не отдаёт
ячейкам такое касание, но SwiftUI-кнопки внутри `UIHostingConfiguration` и свои распознаватели
(`menuPress`, `SwipeToReply`) нужно проверить отдельно.
**Почему.** У Telegram касание, поймавшее полёт, запоминается, и выбор строки по отпусканию его читает и
не срабатывает.
**Сейчас у нас.** Проверить на iPhone.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Host-facing…: `lastTouchCaughtMovingContent`; Scroll engine and physics)*

#### 5.3.6 Ничего срочного на `.began` панорамы
**Правило.** Реакции «в момент касания» (отклик, подсветку, остановку полёта) вешать на само касание, а не
на `.began` панорамы.
**Почему.** Панораму ленты внутри `NavigationStack` может задержать системный жест «назад»: он решается
примерно через 2 pt вне оси или при отпускании. `SwipeToReply` работает только влево, поэтому свайпу
«назад» от левого края не мешает.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (The limbo gotcha → Mirror half)*

#### 5.3.7 Нажатие на плавающую дату не срабатывает от лёгкого свайпа
**Правило.** Лёгкий свайп по плашке даты не открывает календарь «Перейти к дате». Если на iPhone такое
воспроизводится, сделать своё нажатие с допуском движения около 2 pt.
**Почему.** Касание, которое сдвинулось меньше порога пана (10 pt), пан не запускает, а обычный тап терпит
движение, поэтому лёгкий свайп у Telegram принимался за нажатие, и чат прыгал к дате.
**Сейчас у нас.** Проверить на iPhone: `FloatingDateView` и `DaySeparatorView` (SwiftUI `Button`) вызывают
`onDayTap`.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Gesture arbitration: date pill, 2 pt slop)*

#### 5.3.8 После «Домой» и возврата лента не листается — сбросить застрявшие распознаватели
**Правило.** Если появится баг «после возврата в приложение чат не листается», первым делом смотреть
застрявшие распознаватели (`SwipeToReply.pan`, `menuPress`, жесты `SlideSelection`). Лечение: при
деактивации или активации сцены переключать `isEnabled` у своих распознавателей, которые не в покое.
**Почему.** На iOS 27.2 у Telegram после «Домой» чат не листался до переоткрытия. Свайп «Домой» с ленты
оставлял пан с касанием, которое забрала система.
**Сейчас у нас.** Пока не наблюдалось; телефон владельца на iOS 27.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (The limbo gotcha: «A scene deactivating cancels a pan that is not idle…», #127)*

#### 5.3.9 Арбитраж менять через параметр с прежним поведением по умолчанию
**Правило.** Общие жесты ленты (`MessageListView`, `MessageMenuTouch`, `SwipeToReply`) правят через
опциональный параметр, умолчание которого сохраняет старое поведение. Не менять поведение всех пузырей
ради одной карточки.
**Почему.** У Telegram новый параметр арбитража (`hasLongTapAction`) по умолчанию оставляет все
существующие вызовы как были, меняется только новый.
*Источник: `docs/superpowers/specs/2026-10-13-message-widgets-design.md` §5 (`hasLongTapAction` по умолчанию `true`); `docs/superpowers/plans/2026-10-13-message-widgets.md` (Task 14)*

### 5.4 Касания внутри пузыря

#### 5.4.1 Тап — элементу, долгое нажатие — меню, двойной тап — реакция, но не по контролам
**Правило.** Элементы внутри пузыря получают тап: кнопка «скопировать код», ссылки, варианты опроса,
пункты чек-листа, голосовое. Долгое нажатие открывает меню сообщения (`MessageMenuOverlay`), и при этом
текущее касание элемента отменяется без срабатывания. Двойной тап ставит реакцию, но только на
неинтерактивной части пузыря. Двойной тап по варианту опроса или пункту чек-листа реакцию не ставит.
Одиночный тап по кнопке не должен ждать второго.
**Почему.** У Telegram касание внутри живого виджета отдаётся виджету: быстрый двойной тап по его кнопке не
превращается в реакцию, а меню завершает касание виджета отменой.
**Сейчас у нас.** соблюдено (#499): двойной тап — `UITapGestureRecognizer` ленты рядом с долгим нажатием; живые элементы
помечены `bubbleControl`, одиночный тап по ним второго не ждёт.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Touches»); `docs/superpowers/specs/2026-10-13-message-widgets-design.md` §5 «Touches and the bridge» (`.ignore`, `hasLongTapAction: false`); `docs/superpowers/plans/2026-10-13-message-widgets.md` (Task 14); `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` §9*

#### 5.4.2 У строки один владелец долгого нажатия
**Правило.** В ленте долгое нажатие обрабатывает один `menuPress` на `collectionView`; SwiftUI
`.contextMenu` в пузыри не ставить. В списке чатов — системный `.contextMenu` строки. Чьё долгое нажатие
на ссылке внутри пузыря, решить явно и записать.
**Почему.** У Telegram долгое нажатие строки — контекстный жест, который проваливает нажатие и свайп
строки. Собственный жест пузыря выключен, чтобы два жеста не гонялись.
*Источник: `submodules/TelegramUI/Components/News/CLAUDE.md` (Taps: «A long press is a context gesture…»)*

#### 5.4.3 Кнопка внутри пузыря работает, только если пузырь уступает касание
**Правило.** Кнопки внутри пузыря (копировать код, опрос, голосовое) проверять UI-тестом при активных жестах
пузыря: меню по долгому нажатию, двойной тап-реакция, свайп «ответить». Декоративные дочерние виды ставить
с `allowsHitTesting(false)`.
**Почему.** У Telegram распознаватель пузыря забирал касание и отменял трекинг кнопки: кнопка
подсвечивалась и не срабатывала. Метка кнопки сама была интерактивной и перехватывала попадание.
*Источник: `docs/instantpage-richtext.md` (Unsupported blocks: «The Update button only works if the host steps out of the way — twice»)*

#### 5.4.4 Вертикальное перетаскивание всегда листает чат; край экрана не занимать
**Правило.** Внутри пузыря не бывает вертикальных `ScrollView`. Ни один жест карточки (ползунок,
горизонтальная прокрутка вариантов) не забирает вертикальную прокрутку ленты и свайп «назад» от края.
Горизонтальный захват решать порогом меньше порога ленты (около 4 pt против примерно 10 pt у ленты) и
явным направлением.
**Почему.** У Telegram это решение пользователя: виджет не может запретить вертикальную прокрутку,
направление решает первое движение, а полоса 20 px у переднего края виджету не достаётся. Пан ленты
стартует около 10 pt, поэтому жест, решённый на 10 pt, проигрывал.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («The chat always scrolls»); `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` §9–§10*

#### 5.4.5 Горизонтально прокручиваемое содержимое получает свой жест
**Правило.** Если содержимое внутри строки прокручивается по горизонтали (галереи в постах `PostMediaView`),
у него свой жест, а свайп «ответить» и горизонтальные жесты контейнера на нём не начинаются. Блоки кода в
пузыре не прокручивать вбок, а переносить. В статье на отдельном экране горизонтальный `ScrollView` кода
допустим.
**Почему.** У Telegram свайп страниц и свайп строки уступают галерее, иначе её не пролистать.
**Сейчас у нас.** Соблюдено для кода: перенос вместо прокрутки выбран сознательно, см. комментарий в
`MessageCodeBlocks.swift:119`. Пометка в одной из записей про «горизонтальную прокрутку блоков кода в
пузыре» устарела.
*Источник: `submodules/TelegramUI/Components/News/CLAUDE.md` (Taps; Pinch); `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («The chat always scrolls»)*

#### 5.4.6 Отменённое касание не нажимает
**Правило.** Кнопки карточек делать системной `Button`: SwiftUI сам отменяет её при прокрутке. Не заменять
их на `DragGesture(minimumDistance: 0)` или `onTapGesture` с ручной логикой, которая сработает и при
начавшейся прокрутке или открытии меню.
**Почему.** У Telegram клик засчитывается только при отпускании в пределах 8 pt над тем же элементом.
Долгое нажатие, прокрутка и свайп ответа отменяют касание.
*Источник: `docs/superpowers/specs/2026-10-13-message-widgets-design.md` §5 («Touches inside the widget»)*

#### 5.4.7 Тап в ячейке ленты — распознавателем или `Button`, не `.touchUpInside`
**Правило.** SwiftUI-элементы внутри пузыря (`Button`/`onTapGesture`) проверять на конфликт со
`SwipeToReply`, долгим нажатием меню и прокруткой. В UIKit-частях тап делать через
`UITapGestureRecognizer`.
**Почему.** Система жестов списка отменяет `.touchUpInside`.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 audio/music: «Tap is a UITapGestureRecognizer, never an ASControl»)*

#### 5.4.8 Пока открывается медиа, повторные тапы игнорировать, но не дольше заданного времени
**Правило.** Тап по фото, видео или файлу в ленте и по истории защищать от двойного открытия (двух
презентаций подряд) с таймаутом: если открытие ничего не сообщило, отпустить через 1 с, а в любом случае
не держать больше 4 с. Решение писать чистой функцией с тестом.
**Почему.** Галерея у Telegram появляется, только когда готов первый элемент (до 2 с). Без защиты второй
тап открывает её дважды, а без таймаута зависшая загрузка блокирует тапы навсегда.
*Источник: `docs/app-unit-tests.md` (`ChatControllerInteractionTests`, `chatIsOpeningMedia`)*

#### 5.4.9 Тактильный отклик — только на касание человека и не чаще разумного
**Правило.** `.sensoryFeedback`/`UIImpactFeedbackGenerator` в карточках срабатывают только в ответ на жест
самого человека (голос, отметка, двойной тап). Никогда не от событий WS (чужой голос,
`checklist:updated`) и не очередью.
**Почему.** Telegram разрешает хаптик только видимому виджету, только в окне касания (5 с после отпускания)
и в пределах лимита «ведро на 5 с, пополнение 10/с». Это защита от атаки «вибро-таймер».
*Источник: `docs/message-widgets-native-runtime.md` («Haptics», анти-атака `haptic-timer-buzz`)*

### 5.5 Листы, сетки, поле ввода, анимируемые виды

#### 5.5.1 Сетка в листе вложений — на `ScrollView`; свой прокручиватель — только с арбитражем листа
**Правило.** Не заменять `ScrollView` сетки в `AttachmentMenuSheet` на свой прокручиватель (UIKit-вид с
собственным pan), не проверив на iPhone все сценарии:
- потянуть вниз у верха — лист сворачивается или закрывается;
- прокрутка вверх разворачивает лист;
- выбор протягиванием отменяет жест листа;
- щипок никогда не двигает лист, а начало зума просит лист развернуться.

Если добавлять в сетку выбор протягиванием или щипок, соблюдать то же.
**Почему.** Системный лист ищет под пальцем настоящий `UIScrollView` и по нему решает, тянуть лист или
прокручивать. Для сетки на своём движке Telegram пришлось вводить протокол: у верха ли контент, крутится
ли, остановить или передать жест.
**Сейчас у нас.** Соблюдено: системный лист с `.presentationDetents([.medium, .large])` и
`.presentationContentInteraction(.scrolls)` (`Attach/AttachmentMenuSheet.swift:148`), сетка — SwiftUI
`ScrollView`.
**Применимость.** Частично: арбитраж у нас системный, правило защищает от его поломки. Выбора
протягиванием и щипка пока нет.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Stage 2: the app's photo picker»); `submodules/MediaPickerUI/CLAUDE.md` («Selection», «Attachment container»); `docs/superpowers/specs/2026-10-27-media-picker-grid-stage2-design.md` («Attachment container arbitration»); `docs/superpowers/plans/2026-10-27-media-picker-grid-stage2.md` (Review Focus 1, Task 6)*

#### 5.5.2 Жесты сетки не забирают касания у плитки камеры и шапки
**Правило.** Жест на всю сетку `RecentMediaGrid` (выбор протягиванием, щипок) не должен действовать на
плитку камеры, шапку альбома и карточку «Все фото и видео». Для этого `.simultaneousGesture` с проверкой
точки или жест только на плитках снимков.
**Почему.** Иначе кнопки в шапке и на камере не получают своё отпускание.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («The tap and pan-to-select recognizers ignore touches in `headerView` and `cameraView`»)*

#### 5.5.3 Ручка выделения у края экрана не запускает «назад» и не тянет лист
**Правило.** Проверять на iPhone: левую ручку выделения в поле чата и в листах (`.sheet`) тянут у края
экрана — экран не должен уходить назад, а лист не должен ехать. Если понадобится запрет, ставить его только
на время перетаскивания ручки, а не на весь редактор.
**Почему.** У Telegram ручки выделения запрещают интерактивный переход, закрытие листа и жест клавиатуры
только на самой ручке. Флаги на весь редактор ломают прокрутку.
**Применимость.** Частично: своего полноширинного свайпа «назад» у нас нет, системный работает от края.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` («Selection-handle drag»)*

#### 5.5.4 К курсору листать только после своей правки или смены геометрии
**Правило.** `scrollRangeToVisible` вызывать только после собственной правки текста или смены геометрии,
но не на каждом `updateUIView`. Проход без изменений ничего не листает.
**Почему.** У Telegram редактор сам не листает к курсору: он отмечает «долг», и хост выполняет его в своём
проходе раскладки. Иначе сбивается ручная прокрутка пользователя.
**Сейчас у нас.** `ComposerTextView.swift:113` листает к выделению, только когда включается прокрутка
(`if scrolls`). Остальные программные места — команды форматирования и списков.
**Применимость.** Частично: `UITextView` листает и сам.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («The host decides when the caret is revealed»); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` («Selection notifications and the caret reveal»)*

#### 5.5.5 Выбор из листа показывать из самого листа
**Правило.** PhotosPicker, выбор собеседника и другие экраны выбора, которые открываются из листа,
показывать из этого же листа (`.sheet` внутри листа), а не из экрана под ним. После закрытия проверять
клавиатуру. Модальное окно с клавиатурой не выталкивать пушем.
**Почему.** У Telegram экран, открытый из листа на навигации чата, оказывался под листом, а пуш листа
ломал клавиатуру редактора.
*Источник: `docs/instantpage-richtext.md` (Inline buttons, Authoring: «The sheet stays window-presented; the picker joins it at window level»)*

#### 5.5.6 Жест, начатый во время анимации, берёт видимую позицию
**Правило.** Если жест перехватывает анимируемый вид (лента в полёте, лист, просмотр после броска, пружины
`Motion`), читать `layer.presentation()` или текущее значение пружины, а не модельное значение. Движение
останавливается там, где вид виден.
**Почему.** Иначе вид прыгает под пальцем к конечной точке анимации.
*Источник: `docs/superpowers/plans/2026-10-27-media-grid-stage1.md` (Task 9, Review Focus 3)*

#### 5.5.7 Бросок продолжается в соседней прокрутке с той же скоростью
**Правило.** Если появится шапка, которая сворачивается своим жестом над отдельной прокруткой, скорость
жеста передавать в прокрутку, чтобы бросок продолжался.
**Почему.** У Telegram шапка профиля передаёт скорость сетке (`transferVelocity`).
**Применимость.** Частично: информация о чате — один `List`/`ScrollView`, вложенных прокруток сейчас нет.
*Источник: `submodules/TelegramUI/Components/PeerInfo/PeerInfoVisualMediaPaneNode/CLAUDE.md` («Header»)*

#### 5.5.8 Геометрию шапки мерить по развёрнутому состоянию складывающегося элемента
**Правило.** Свою складывающуюся шапку (если появится) мерить по развёрнутому полю. Системный
`.searchable` (`Feed/SearchView.swift`, `PostComposerView.swift`) складывает система.
**Почему.** У Telegram проход раскладки при сложенном поиске ставил поиск на 44 pt выше.
**Применимость.** Частично: складывание у нас делает система.
*Источник: `submodules/TelegramUI/Components/News/CLAUDE.md` (The header's search folds as the chat list's)*

### 5.6 Раскладка, замер, слои

#### 5.6.1 Вид не задаёт себе `frame`: его ставит родитель
**Правило.** Рамку ставит родитель или система раскладки, а вид раскладывает детей по своим `bounds`.
Публичные `update`/`configure`/`apply` не пишут `self.frame` и при смене высоты содержимого не зовут себе
`setNeedsLayout`, а сообщают хосту. В `UIViewRepresentable` высоту отдают через `sizeThatFits` +
`invalidateIntrinsicContentSize()`. В SwiftUI `Layout` (`ChatBubbleStack`, `MessageStackLayout`)
`placeSubviews` кладёт детей в выданные `bounds` с размером из `sizeThatFits` при той же ширине. Ребёнок
не «дотягивает» себя до предложенной высоты. Исключение — корневые вью контроллеров.
**Почему.** В асинхронной раскладке замер возвращает размер, и вид, который пишет себе `frame` из
`update()`, портит только что измеренное. У нас именно замер от предложенной высоты дал дыры в ленте при
флаге 2.5 (`MOTION_TESTING_REPORT.md`).
**Сейчас у нас.** Соблюдено: `self.frame =` нигде нет. `ComposerUITextView` отдаёт высоту через
`ComposerTextView.sizeThatFits`, а смену ширины — колбэком `onWidthChange` на следующем витке.
*Источник: `CLAUDE.md` («View frame ownership»); `docs/richtext-composer.md` (§1); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` («Layout convention»); `submodules/TelegramUI/Components/RichTextEditorMediaView/CLAUDE.md` («View-frame ownership»)*

#### 5.6.2 Текст мерить той шириной, в которой он будет разложен
**Правило.** Высоту пузыря или строки мерить ровно при ширине раскладки (`MessageStackGeometry`, кеш высот
2.5, `ChatBubbleStack`). Любая смена ширины — клавиатура, режим выбора с кружками слева — повод сбросить
замер.
**Почему.** У Telegram текст, центрированный в полосе, мерили по полной ширине, и он вылезал за левый край.
Ошибку нашли сканом 43 файлов.
*Источник: `docs/superpowers/duo-screen-audit-2026-10.md` («After the audit»)*

#### 5.6.3 При замере ограничивать ребёнка шириной контейнера
**Правило.** В раскладках с переносом (`ChatFlowLayout` для реакций) мерить ребёнка с
`ProposedViewSize(width: ширина контейнера, height: nil)`, а не `.unspecified`. Тогда второй проход
(расстановка) не переполнит строку.
**Почему.** У Telegram каждая кнопка заранее ограничена шириной ряда, поэтому жадная упаковка не
переполняет строку.
**Сейчас у нас.** соблюдено (#499): `ChatFlowLayout` предлагает детям ширину контейнера вместо `.unspecified`.
*Источник: `docs/instantpage-richtext.md` (Inline buttons: «Pass 1's maxWidth is what makes pass 2 safe»)*

#### 5.6.4 Замер и отрисовка берут одни константы
**Правило.** Оценка высоты (`MessageHeightEstimate`) по смыслу отличается от самого пузыря, но отступы и
высоты частей пузыря она берёт из тех же токенов (`Spacing`, метрики пузыря), что и вид, а не из
продублированных чисел. Общую геометрию отрисовки и замера считать одной функцией.
**Почему.** У Telegram две независимые конструкции однажды разошлись в том, входят ли поля в размер.
**Сейчас у нас.** соблюдено (#499): отступы пузыря в `ChatBubbleMetrics`, вид и `MessageHeightEstimate` читают их
оттуда.
*Источник: `docs/instantpage-richtext.md` (Inline buttons: «…is the ONLY construction path», «instantPageButtonLabelOrigin is shared…»)*

#### 5.6.5 Значение раскладки несёт только геометрию
**Правило.** Кеш высот хранит только числа. Вид меряет себя сам, тем же стилем, что и оценка.
**Почему.** У Telegram текстовые узлы создаются заново при каждом вызове, поэтому вид владеет своими узлами
и перемеряет их той же функцией, что и раскладка.
*Источник: `docs/instantpage-richtext.md` (Unsupported blocks: «The layout value carries geometry only»)*

#### 5.6.6 Функции размещения получают размер параметром, а не читают живые `bounds`
**Правило.** В UIKit-частях (меню сообщения, `BubbleAnchor`) размер брать из переданной раскладки или
кадра. Не читать `view.bounds` только что созданного вида или вида, кадр которого поставят после вызова.
**Почему.** Размещение вызывается до `layoutSubviews` свежего вида, и его кадр ещё нулевой. Проход
раскладки ставит кадр уже после вызова.
*Источник: `docs/instantpage-richtext.md` (Inline buttons: «The placement functions must not read a pill's live bounds»; Tearing the bubble: «updateTearMask takes the size as a parameter»)*

#### 5.6.7 `CALayer.frame` не годится, чтобы узнать, изменился ли кадр
**Правило.** В UIKit-частях (`MessageListView`, меню, `KeyboardFrame`) сравнивать с сохранённым прошлым
вычисленным значением, а не с `layer.frame`/`view.frame`.
**Почему.** `frame` выводится из `position` и `bounds`. Для значения 7/3 круговое преобразование даёт другое
число, и проверка «кадр изменился» срабатывала всегда, а анимации перезапускались.
**Сейчас у нас.** Плавающая дата уже ставится через `bounds` и `center`, а не `frame`
(`MessageListView.swift`, `updateFloatingDate`).
*Источник: `docs/instantpage-richtext.md` (Tearing the bubble: «Never ask CALayer.frame whether a frame changed»)*

#### 5.6.8 Петли «размер → состояние → размер» должны сходиться
**Правило.** `onGeometryChange`/`GeometryReader`, которые пишут в `@State`, от которого зависит размер,
записывают только реальное изменение и с порогом. Иначе ячейка перекладывается бесконечно.
**Почему.** Telegram доставляет наблюдатели размера не больше 4 раундов за обновление
(`kResizeObserverRounds`), остальное переносит на следующее.
*Источник: `docs/message-widgets-native-runtime.md` («ResizeObserver… at most `kResizeObserverRounds` (4)… rounds»)*

#### 5.6.9 Название строки не укорачивать ради значения; проверять на 375 pt
**Правило.** В строках «название + значение справа» (`DesignSystem/Rows.swift`) приоритет сжатия у
значения: у названия `layoutPriority` выше. Проверять снимками на узкой ширине
(`StudentHubSnapshotTests`, устройство `se` 375×667) и с крупным шрифтом.
**Почему.** У Telegram строка оставляет значению место после заголовка, и на 375 pt и уже усекается
значение, а заголовок — никогда.
**Сейчас у нас.** Соблюдено: `Rows.swift:101` (`layoutPriority(1)` у названия). Короткое значение не
режется, а название переносится. Длинное значение режется посередине. При крупном шрифте раскладка
переключается (`isAccessibilitySize`).
*Источник: `docs/app-unit-tests.md` (`ItemListUITests`, `itemListDisclosureLabelConstrainedWidth`)*

#### 5.6.10 Кнопка, сменяющая другую, стоит на том же месте
**Правило.** Пары «Изменить/Готово» и «Выбрать/Отмена» в навбаре и тулбарах стоят на одном месте с одним
размером кликабельной области. При смене соседи не сдвигаются.
**Почему.** У Telegram «Готово», сменяющая текстовую «Изменить», остаётся в том же ряду (`staysInRow`).
*Источник: `docs/iphone-duo-layout.md` («The rules», п. 9)*

#### 5.6.11 Радиус скругления — от фактического размера, а не запечённый
**Правило.** Капсулы и круги делать через `Capsule()`/`Circle()` или
`cornerRadius = bounds.height / 2` в `layoutSubviews`, а не константой под один размер шрифта.
**Почему.** У Telegram фон кнопки отправки был запечён под диаметр 34, и при росте поля радиус стал
неверным.
*Источник: `docs/instantpage-richtext.md` (Text Size / content scale)*

#### 5.6.12 Обрезает один владелец
**Правило.** Скругление пузыря делает сам пузырь: форма фона или `clipShape` в одном месте. Медиа и код
внутри не дублируют обрезку своими радиусами, если граничат с краем пузыря.
**Почему.** У Telegram обрезку делает только контейнер; укорачивать вложенный вид или включать ему
`clipsToBounds` запрещено.
**Применимость.** Частично: механизма потокового раскрытия, на котором Telegram это выяснил, у нас нет.
*Источник: `docs/instantpage-richtext.md` (AI streaming animation: «containerNode does ALL the clipping»)*

#### 5.6.13 Щель в 1 px у скругления закрывать расширением медиа во всю ширину
**Правило.** Если медиа во всю ширину пузыря не доходит до края на долю пикселя, расширять кадр медиа, но не
уменьшать обрезку и не расширять пузырь. Маленькие медиа не трогать. Проверять в снимках @3x.
**Почему.** У Telegram из-за сдвига на −1 у правого скругления оставалась щель в 1 px. Медиа во всю ширину
заходит на 4 pt дальше.
**Применимость.** Частично: у нас пока не наблюдалось.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 block media: «Full-width media bleeds 4pt»)*

#### 5.6.14 Переиспользуемому слою сбрасывать всё, что ставит хоть одна ветка
**Правило.** В UIKit-частях (ячейки ленты, меню) при переиспользовании возвращать в исходное все свойства
слоя, которые ставит хоть одна ветка: `cornerRadius`, `maskedCorners`, `mask`, `opacity`, `transform`.
Рамку со скруглением делать собственной `border` слоя с `cornerRadius`, без `masksToBounds`.
**Почему.** У Telegram ветка «без скругления» сбрасывала только `cornerRadius`, и переиспользованный слой
сохранял старые `maskedCorners`.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 table: «The 10pt rounded outer border», «Filled corner cells»)*

#### 5.6.15 Вид с `draw(_:)` и `cornerRadius` без `clipsToBounds` остаётся прямоугольником
**Правило.** UIKit-виду, который реализует `draw(_:)` и при этом скруглён, ставить `clipsToBounds = true`
или рисовать фон отдельным слоем.
**Почему.** `backgroundColor` рисуется в содержимое слоя, а `cornerRadius` без `masksToBounds` содержимое не
обрезает.
*Источник: `docs/instantpage-richtext.md` (Inline buttons: «clipsToBounds is what makes the pill a pill»)*

#### 5.6.16 Подслои всегда лежат поверх содержимого слоя
**Правило.** Индикаторы и наложения над текстом, нарисованным в слое, располагать порядком дочерних видов, а
не подслоем. Если поверх нужен эффект, текст выносить в дочерний вид.
**Почему.** Нарисованное в `draw(_:)` лежит в `contents`, а подслои всегда над ним, и мерцание загрузки
смывало бы текст.
*Источник: `docs/instantpage-richtext.md` (Inline buttons: «emojiContainerView sits ABOVE…», «The loading shimmer needs the label in a child view»)*

#### 5.6.17 В `CALayer.draw(in:)` не рисовать то, что рассчитывает на единичную CTM
**Правило.** Если рисуем сами (`UIGraphicsImageRenderer` для превью), тени и смещения проверять на
устройстве @3x. Рисование, которое пересчитывает смещения через CTM, вести в свой bitmap-контекст.
**Почему.** У Telegram тени LiteHTML пропадали в контексте слоя 2x/3x.
**Применимость.** Частично: своего рисования у нас мало.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Tile rule»)*

#### 5.6.18 Точку касания переводить через `convert`, а не складывать отступы руками
**Правило.** Везде, где точку касания считаем вручную (`MessageMenuTouch`, `BubbleAnchor`, `SlideSelection`),
переводить координаты через `convert(_:to:)`.
**Почему.** У Telegram `hitTest` и `convert` учитывали сдвиг сами, а ручные помощники поиска текста под
пальцем — нет, и попадание в ячейке смещалось на `contentInset`.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 table: «Manual cell-coordinate helpers MUST add contentInset»)*

### 5.7 Стекло, панели, меню, тема

#### 5.7.1 Стекло не гасить через `alpha` предка
**Правило.** Стекло гасить, убирая вид, через видимость самого стекла или прозрачность слоя контейнера
(`layer.opacity`). Не трогать `alpha` вида-предка. То же для SwiftUI `.opacity` над `glassEffect`.
**Почему.** При `alpha < 1` у предка UIKit сразу перестаёт рисовать стекло, и плавного затухания не
получается.
**Сейчас у нас.** Проверить на iPhone: плавающая дата (`FloatingDateView`, внутри `DaySeparatorView` с
`.chatCapsuleSurface()`, на iOS 26 это стекло) гаснет через `floating.alpha`
(`MessageListView.swift:572,1128,1146`). Лента стартует с `collectionView.alpha = 0` (`:561`). Если капсула
исчезает скачком, а не гаснет, перейти на `layer.opacity`.
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` (Rulings: «Glass opacity goes on layers, never `UIView.alpha`…»; Pitfalls: «Alpha does not hide native glass inside a glass container»)*

#### 5.7.2 Кнопки панели группирует система
**Правило.** На iOS 26 группировку кнопок в SwiftUI-тулбаре не переделывать руками.
- «Изм.» или «Готово» рядом со значком — две капсулы, это норма.
- Значки в одном `ToolbarItemGroup` — одна капсула.
- Разделять капсулы через `ToolbarSpacer`.
- Общий фон выключать через `sharedBackgroundVisibility(.hidden)`, как у аватара
  (`ChatThreadView.swift:1406`).

Всё это — под `#available(iOS 26, *)`.
**Почему.** Telegram измерил правило UIKit (`_requiresOwnSection`): текстовая кнопка и выделенная
(`.prominent`) всегда стоят в своей капсуле, а подряд идущие значки делят одну. Правило действует везде,
экраны ничего не делают.
*Источник: `docs/superpowers/specs/2026-10-15-navbar-split-right-buttons-design.md` («What UIKit does», Design §1)*

#### 5.7.3 Стекло в общем контейнере: не анимировать тон слившейся формы
**Правило.** Внутри `GlassEffectContainer` (`DesignSystem/Glass.swift`) не анимировать смену тона стекла,
которое сливается с соседним. Форму и радиус стекла не менять покадрово во время его анимации. Проверять на
iPhone с iOS 26/27.
**Почему.** Два стекла в одном контейнере рисуются одной формой. Анимированная смена эффекта рисует тёмную
полосу на стыке, пока идёт. Смена радиуса отменяет идущую смену тона.
**Применимость.** Частично: своего слияния капсул у нас нет.
*Источник: `docs/superpowers/specs/2026-10-15-navbar-split-right-buttons-design.md` («How glass behaves in a glass container», Design §2); `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` (Pitfalls: «Glass effect changes…»)*

#### 5.7.4 У каждой стеклянной анимации — запасной путь до iOS 26 и при уменьшении движения
**Правило.** У каждого `glassEffect` есть ветка для iOS 17–25 (`#available`, как в `Glass.swift`). При
уменьшении движения (`Motion.isReducedNow`, `\.motionReduced`) остаётся только прозрачность: через
`Motion.respecting`, `withMotion`, `AnyTransition.motion(_:reduced:)`.
**Почему.** У Telegram без нативного слияния уходящая капсула гаснет в своём контейнере, а при уменьшении
движения работает только прозрачность, без масштаба, толчка и размытия.
*Источник: `docs/superpowers/specs/2026-10-15-navbar-split-right-buttons-design.md` (Design §2: «Without native glass merging…», «Reduce Motion: opacity only…»)*

#### 5.7.5 Меню: значок слева, отметка выбранного справа, растёт из источника
**Правило.** Значки пунктов меню ставить слева (правило владельца). Отметку текущего выбора (сортировка,
режим) — справа от текста. Источник меню — видимая капсула или кнопка целиком (системный `Menu` на iOS 26
так и делает). У `MessageMenuOverlay` источник — пузырь.
**Почему.** У Telegram меню «…» растёт из капсулы, потому что источник — капсула, а не кнопка. Значок
режима стоит слева, галочка — справа.
*Источник: `submodules/TelegramUI/Components/News/CLAUDE.md` (Compact / Expanded posts)*

#### 5.7.6 Поднятое в меню содержимое масштабируется трансформом, а не новой раскладкой
**Правило.** Если копию пузыря в `MessageMenuOverlay` надо вписать в экран, уменьшать её трансформом:
раскладка и перенос текста не меняются. Закрытие идёт на одной длительности с затемнением. Повторное
завершение нажатия не запускает анимацию отпускания второй раз.
**Почему.** У Telegram при подъёме в меню содержимое уменьшается трансформом `contentView`, и никогда — более
узкой раскладкой. Возврат идёт на длительности самого меню.
**Применимость.** Частично: меню у нас своё и устроено иначе.
*Источник: `submodules/TelegramUI/Components/News/CLAUDE.md` (Taps: «lifted, the content is scaled…»)*

#### 5.7.7 Вспомогательная копия не должна находиться в реестрах и поиском по типу
**Правило.** Каждая копия пузыря вне ленты (меню, закреплённые, превью чата) передаёт
`isMenuPreview: true`, чтобы не регистрировать якорь в `BubbleAnchors`. Временный контейнер не делать того
типа, который ищут поиск источника меню и сэмплер нажатия. У одного элемента один владелец.
**Почему.** `BubbleAnchors` — реестр по `(id, part)`, и в нём выигрывает последний, кто зарегистрировался.
Копия под тем же id перехватывает якорь у настоящего пузыря.
**Сейчас у нас.** соблюдено (#499): `ChatPeekView` рисует копии пузырей с `isMenuPreview` и якоря ленты не
перехватывает.
*Источник: `docs/superpowers/plans/2026-10-15-navbar-split-right-buttons.md` (Task 5 Step 4); `submodules/TelegramUI/Components/News/CLAUDE.md` (floating avatar: «two avatars»)*

#### 5.7.8 Смена темы обновляет всё, что от неё зависит
**Правило.** В UIKit-частях с цветом (`MessageListView`, меню, `ComposerUITextView`) брать динамические
`UIColor`. Там, где цвет запекается (`cgColor` слоёв, атрибутированные строки), обновлять его через
`registerForTraitChanges`.
**Почему.** У Telegram текстовый узел не хранит строку, и если при смене темы забыть пересобрать строку или
цвет, остаётся старый цвет.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 audio/music: «updatePresentationData must refresh EVERYTHING…»)*

#### 5.7.9 Палитра — по стороне пузыря, а не по сырому флагу автора
**Правило.** Цвета внутри пузыря зависят только от `item.isOwn` — того же флага, который выбирает фон
пузыря. Дочерние виды не читают автора заново.
**Почему.** У Telegram пересланное своё сообщение в «Избранном» хранится как входящее, но рисуется исходящим.
Сырой флаг давал синий заголовок на синем пузыре.
**Сейчас у нас.** Соблюдено: `MessageCodeBlockView` (`accent`), `ChatPollView`, ссылки.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 audio/music: «The row's palette follows the bubble's direction»)*

#### 5.7.10 Цвет, зависящий от темы, ставить в виде, а не в кеше
**Правило.** Кеш `RichText` не содержит цветов, зависящих от темы, кроме динамических системных
(`Palette.primary`). Цвета по стороне пузыря ставить в виде через `.foregroundStyle` или `.tint`.
**Почему.** При построении строки темы ещё нет, и «опасные» и «успешные» подписи получили бы цвет текста.
*Источник: `docs/instantpage-richtext.md` (Inline buttons: «The pill recolours its label in the view, not at construction»)*

#### 5.7.11 Ссылки в пузыре — цветом, без подчёркивания
**Правило.** Ссылки в пузыре рисовать цветом (`.tint`) без подчёркивания и так и держать. Если
подчёркивание когда-нибудь появится, под ссылкой из одних эмодзи его не рисовать.
**Почему.** Подчёркивание под одним эмодзи выглядит оторванной чертой.
**Применимость.** Частично: подчёркиваний у нас нет.
*Источник: `docs/instantpage-richtext.md` (Inline buttons: «An emoji-only link-button label gets NO underline»)*

### 5.8 Жизненный цикл, потоки, обработчики, состояние

#### 5.8.1 UI-объекты — только на главном потоке
**Правило.** Модели экранов делать на `@MainActor`. Ячейки, `UIView` и отрисовку `UIImage` в контексте
вести только на главном потоке. Вне главного считать только данные (`MessageTimeline.build`,
форматирование времени).
**Почему.** У Telegram приложение падало при прокрутке, потому что узлы строк создавались вне главного
потока. Строгая проверка параллелизма у нас `targeted` (`SWIFT_STRICT_CONCURRENCY` в `project.yml`), и
компилятор ловит не всё.
*Источник: `docs/superpowers/duo-screen-audit-2026-10.md` («After the audit»: Chat Themes crash)*

#### 5.8.2 Колбэк изнутри чужого обновления — асинхронным переходом
**Правило.** Обработчики KVO `AVPlayer`, делегатов UIKit и колбэков Observation, которые меняют состояние
SwiftUI или модели и вызываются изнутри чужого обновления, переходят асинхронно:
`Task { @MainActor in }` или `DispatchQueue.main.async`. Не по схеме «если уже на главном — выполнить
сразу».
**Почему.** У Telegram обёртка, которая выполняла блок сразу на главном потоке, приводила к повторному
входу в обновление состояния плеера. У нас то же даёт «Modifying state during view update».
*Источник: `docs/native-hls-player.md` («`HLSNativePlayerSource` hops with `DispatchQueue.main.async`…»)*

#### 5.8.3 Очистка — своими событиями владельца, а не через `deinit` чужого объекта
**Правило.** Display link (`MessageListGlide`) и задачи (`headerHideTask`, `markReadRetry`) останавливает сам
владелец на своих событиях (`viewDidDisappear`, отмена) и по своему пределу времени. На `deinit` и на
жизнь другого объекта не полагаться.
**Почему.** У Telegram шапка сама забирает капсулы по своим триггерам с пределом 1,6 с: переход мог не
вернуть их, а `deinit` узла бывает вне главного потока.
**Сейчас у нас.** Соблюдено: `glide.stop()` вызывается в `viewDidDisappear` (`MessageListView.swift:190`).
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` (Rulings: «The bar never depends on the transition…»)*

#### 5.8.4 Системе, которая держит цель сильно, — только слабый посредник
**Правило.** `CADisplayLink` и `Timer` держат цель сильно. Поэтому цель — слабый посредник, либо
`invalidate()` до ухода экрана. Наблюдатели `AVPlayer`, KVO и `NotificationCenter` снимать до освобождения.
**Почему.** У Telegram регистрация приёмника видео напрямую, а не через посредника, дала use-after-free.
Посредник снимают до `Close()`.
**Сейчас у нас.** Соблюдено: `MessageListGlide` работает через `Ticker` со слабой ссылкой;
`ScrollBenchmark` явно делает `invalidate()`; `ScrollJankMonitor` — синглтон.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` (Video sink wiring: «never the app's sink, always the proxy…», `detachVideoSinkProxy`)*

#### 5.8.5 Фоновая работа, которой нужна отрисовка, живёт в окне
**Правило.** `AVPlayerLayer` и анимации, которые должны работать, держать в иерархии окна и с ненулевой
альфой.
**Почему.** Вне окна или при `alpha = 0` система молча останавливает их без ошибок. У Telegram так тормозил
скрытый веб-вид.
**Применимость.** Частично: `WKWebView` у нас нет, переносится принцип для медиа.
*Источник: `submodules/WebProxyTransport/CLAUDE.md` («The web view must be in a real view hierarchy or WebKit throttles… Zero alpha is not equivalent»)*

#### 5.8.6 Тяжёлые объекты хоста передавать замыканием, а не удерживать
**Правило.** Модели пузыря и ячейки не держат сильную ссылку на `ChatThreadModel` или контроллер ленты.
Передавать замыкания с `[weak self]`. Неубегающим замыканиям `weak` не нужен.
**Почему.** У Telegram контекст сообщения не удерживает фон чата, а получает его замыканием.
*Источник: `docs/instantpage-richtext.md` (Unsupported blocks: «The wallpaper travels as… a closure»)*

#### 5.8.7 Повторные `configure`/`update` идемпотентны
**Правило.** `configure(_:id:)` ячеек ленты и `updateUIView` обёрток (`ComposerTextView`, оверлей меню)
вызываются часто. Повторный вызов с теми же данными ничего не пересоздаёт и не запускает загрузок.
**Почему.** У Telegram обновление вида вызывается при каждом применении раскладки, поэтому оно только
присоединяет вид, если тот ещё не присоединён, и выставляет `frame`.
*Источник: `docs/superpowers/specs/2026-10-13-message-widgets-design.md` §4 «The view» («`update(item:)` is idempotent…»)*

#### 5.8.8 Переиспользованный вид заново получает обработчики
**Правило.** `configure(_ cell:id:)` при каждой конфигурации пересоздаёт `UIHostingConfiguration` с
актуальными замыканиями — так и держать. В UIKit-ячейках обработчики назначать в `configure`, а не в
`init`.
**Почему.** У Telegram вид, созданный для прежнего хоста, без переподключения молча переставал реагировать
после прокрутки.
**Сейчас у нас.** Соблюдено: `MessageListView.swift:714`.
*Источник: `docs/instantpage-richtext.md` (Inline buttons: «The reuse arm must re-wire onButtonTapped», «documentTapped must be wired in BOTH renderer arms»)*

#### 5.8.9 Обработчик берётся у текущего владельца при каждой отрисовке
**Правило.** Действия из вложенных видов пузыря передавать через `onAction` из окружения или параметр,
который приходит сверху при каждой отрисовке, а не запоминать в дочернем объекте.
**Почему.** У Telegram вложенные виды создаются заново, а хост ставил обработчик только корню, и кнопка в
ячейке таблицы не работала.
*Источник: `docs/instantpage-richtext.md` (Inline buttons: «A button inside <details> or a table cell reaches the host through hostCallback»)*

#### 5.8.10 Элементы в ряду — по стабильному id
**Правило.** `ForEach` в пузыре (реакции, варианты опроса, кнопки) строить по стабильному id, а не по
`offset`, чтобы состояние нажатия или анимации пережило обновление.
**Почему.** У Telegram тап обновлял сообщение и пересобирал ряд, и пересоздание стирало только что начатое
мерцание.
*Источник: `docs/instantpage-richtext.md` (Inline buttons: «…rebuild() must reuse pills positionally»)*

#### 5.8.11 Одна решающая функция для связанных выводов
**Правило.** Если два элемента показывают одно и то же решение (название и аватар «Избранного» или
«Поддержки», заголовок чата и значок типа, счётчик в строке и на вкладке), решение принимает одна
функция, а не две копии условия.
**Почему.** У Telegram заголовок и аватар токена берутся из одного `EditableTokenListPeerAlias`, чтобы не
разошлись: «Избранное» с иконкой, а не с фото аккаунта.
*Источник: `docs/app-unit-tests.md` (`EditableTokenListNodeTests`)*

#### 5.8.12 Переходное значение без объекта — это «ничего»
**Правило.** Состояния вида «прогресс или анимация + nil-объект» (выделение в режиме выбора
`SlideSelection`, подсветка `context.highlight`, прогресс свайпа ответа) при nil-объекте ведут себя как
«состояния нет».
**Почему.** У Telegram при исчезновении разделённого вида выделение снималось с прогрессом 0 и без чата.
Каждая строка брала `1 - 0` и оставалась серой.
*Источник: `docs/app-unit-tests.md` (`ContactsPeerItemTests`)*

#### 5.8.13 Индикатор загрузки — один на действие
**Правило.** Если действие запущено из кнопки через `ActionRunner`, индикатор показывается на кнопке, без
второго глобального. Переходить на локальный индикатор можно только вместе с его отрисовкой.
**Почему.** У Telegram, если кнопка сама показывает загрузку, общая панель не показывается. Новый
вызывающий с промисом убирает панель, только если рисует прогресс сам.
*Источник: `docs/instantpage-richtext.md` (Inline buttons: «A supplied promise suppresses the .requestInProgress title panel»)*

#### 5.8.14 Индикатор ожидания — только когда действие ждёт сеть
**Правило.** Локальные действия (прокрутка к якорю, переход по месту) индикатора ожидания не показывают.
**Почему.** Он ложно намекал бы, что идёт запрос в сеть.
*Источник: `docs/instantpage-richtext.md` (Anchor navigation: «No activate: on the anchor tap action»)*

#### 5.8.15 Не искать свои символы и методы по имени во время работы
**Правило.** Не использовать `dlsym`, `NSSelectorFromString`/`perform` и `NSClassFromString` по своим типам и
методам.
**Почему.** У Telegram `dlsym` по своим символам ломается из-за списков экспорта. Поиск по имени хрупок и
незаметно отваливается при переименовании.
**Сейчас у нас.** Соблюдено: grep `dlsym` и `NSSelectorFromString` ничего не находит.
**Применимость.** Частично: списков экспорта у нас нет.
*Источник: `CLAUDE.md`, `Telegram/CLAUDE.md` («Nothing may look up the app's own symbols by name at runtime (dlsym)»)*

### 5.9 Неприменимо к нам
- Нет: каждая запись раздела переносится хотя бы частично. Частичные случаи отмечены строкой
  «Применимость».

---
## §6. Списки и лента чата

Как устроена и как держится лента переписки (`Features/Chats/Thread/MessageListView.swift`: `UICollectionView` +
diffable data source + `UIHostingConfiguration`), а также другие длинные списки (лента постов, «Медиа» чата).
Главная мысль: строка видит только свой элемент, позиция держится событиями и якорями по id, а всё, что двигает
ленту не пальцем, делается в одном месте, по итоговому состоянию и с записью в `ScrollProbe`.

### 6.1 Модель строки: соседи, равенство, группировка

#### 6.1.1 Всё, что строка берёт у соседей, лежит в её элементе
**Правило.** Всё, что ячейка читает о соседях (хвостик, имя автора, вертикальный отступ группы, разделитель дня),
вычисляй в `MessageTimeline.build` по итоговому массиву (после всех вставок и удалений) и клади полем в
`MessageTimeline.Item`. Ячейка соседей не читает. Новое поведение «от соседа» — новое поле в `Item`, а не передача
соседних элементов в пузырь.
**Почему.** Список перенастраивает строку только когда меняется её значение (у нас — `old != itemsByID[id]` в
`MessageListViewController.apply` → `reconfigureItems`). Факт, не попавший в элемент, после вставки соседнего
сообщения устаревает: старая ячейка остаётся с неверным хвостом или лишним именем.
**Сейчас у нас.** Соблюдено: `isFirstInGroup`/`isLastInGroup` считаются в `MessageTimeline.build`, лежат в `Item`
(`Hashable`), смена группировки попадает в `changed` → `reconfigureItems`; отступ `.margins(.vertical, …)` берётся
из `item.isLastInGroup`.
*Источник: `CLAUDE.md` («Neighbor descriptors», первые два абзаца); `docs/chat/corelist-chat-history-backend.md`
(Neighbor awareness)*

#### 6.1.2 Равенство элемента ленты — полное, «удобного умолчания» не бывает
**Правило.** `Hashable`/`Equatable` элементов ленты и входов геометрии — синтезированные или полные. Ручной `==`
(например, `MessageHeightEstimate.Input` в `MessageStackGeometry.swift`) обновляй в том же коммите, где добавляешь
поле; поле, которое на вид не влияет, исключай явно и с комментарием.
**Почему.** Слишком строгое равенство — лишние перераскладки на каждой транзакции, слишком слабое — устаревший вид.
Telegram нарочно не дал `neighborDescriptor` реализации по умолчанию: «консервативное» умолчание компилировалось бы
везде и молча гоняло перераскладку.
*Источник: `CLAUDE.md` («Neighbor descriptors»: `neighborDescriptor` без реализации по умолчанию, `noNeighborInfluence`)*

#### 6.1.3 «Соседа нет» и «сосед не группируется» — разные состояния
**Правило.** Различай начало ленты/окна (`previous == nil`) и «предыдущее — другого автора или дня». Сейчас оба
случая дают `isFirstInGroup = true`; при правках окна истории помни, что первое сообщение подгруженного окна может
продолжать группу из ещё не загруженной части.
**Почему.** У Telegram от этого различия зависит отрисовка (`first` против `firstWithHeader`); склеив их, получаешь
лишнее имя автора или разрыв группы на стыке окна.
**Применимость.** Частично — в `MessageTimeline.build` различия пока нет, правило для доработки окна
(`chatWindowedObservation`).
*Источник: `CLAUDE.md` («Neighbor descriptors»: `nil` против дескриптора без нужного аспекта)*

#### 6.1.4 Группировку решать явным полем; при аудите искать скрытые чтения соседа
**Правило.** «Входит ли сосед в мою группу» решай явным правилом (`MessageTimeline.continues(_:before:calendar:)`),
а не типом карточки (`MessageCards`, `MessageKindViews`) и не `as?`. Проверяя ленту, ищи не только
`previous`/`next`, но и производные: `joinsAbove`, `hasTail` (`MessageBubbleView.swift`), проверки на `nil`.
**Почему.** Чтения соседа прячутся за проверками типа, параметрами помощников и сравнениями с `nil`; имя
`previousItem` у Telegram вообще бывает «прошлым состоянием этой же строки». Приведение к конкретному типу ломается
при появлении нового вида карточки.
*Источник: `CLAUDE.md` («Neighbor descriptors»: «Header families»; «Neighbor reads hide behind…»)*

#### 6.1.5 Решения, влияющие на высоту и соседей, — по модели строки до раскладки
**Правило.** Всё, что меняет высоту строки (реакции, имя автора, ответ, вложения), решай по `MessageTimeline.Item`,
чтобы оценка высоты (`estimateInput(for:)` в `MessageListView.swift`) видела то же, что нарисует пузырь.
**Почему.** Telegram решает «реакции вне пузыря» до раскладки по структуре модели; второй детектор в самой раскладке
неизбежно расходится с первым, и это расхождение пришлось записать как принятое.
**Применимость.** Частично — реакций вне пузыря у нас нет, переносится принцип «решение по модели».
*Источник: `docs/instantpage-richtext.md` (Status node positioning, «A pill can't host multi-row reactions»)*

#### 6.1.6 Служебная строка между сообщениями принадлежит дню
**Правило.** Секция ленты = день (`MessageTimeline.Day`, `id` — начало суток). Если появится служебная строка
(«Непрочитанные», «Новые сообщения»), она — элемент секции своего дня, а не отдельная секция.
**Почему.** У Telegram строка без ключа заголовка рвала серию: разделитель «непрочитанные» посреди дня давал две
плашки одной даты.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Floating headers: `ChatUnreadItem`, `ChatReplyCountItem`)*

#### 6.1.7 У разных видов строк — свои пространства id
**Правило.** Id элементов снапшота различаются по виду строки: сообщение (`message.id`), будущие служебные строки
(«непрочитанные» и т. п.) — с собственным префиксом; секции — по `Date`. Служебные строки не берут id из той же
последовательности, что сообщения.
**Почему.** У Telegram блоки «размышлений» получили отдельный счётчик: их появление больше не перенумеровывало
содержимое, виды и состояние раскрытия выживали.
*Источник: `docs/instantpage-richtext.md` (InstantPage thinking blocks, «Top-level only; separate stable-id namespace»)*

#### 6.1.8 Порядок на экране — не порядок по времени
**Правило.** «Первое/последнее» сообщение выбирай по `createdAt`/`seq`/порядку снапшота, а не по порядку
`visibleCells` или `indexPathsForVisibleItems` (их порядок не гарантирован). Лента у нас не перевёрнута, но
сгруппирована по дням: видимое «первое» по видам ≠ первое по времени.
**Почему.** У Telegram объединённая ячейка таблицы раскладывалась после строк, и «первый и последний отрисованные
куски» оказывались не границами цитаты.
*Источник: `docs/instantpage-richtext.md` (Rich reply quotes, «Display order is not document order»)*

### 6.2 Снапшот, идентичность и переиспользование ячеек

#### 6.2.1 Строка — по стабильному локальному id; правка содержимого — перенастройкой
**Правило.** Элемент снапшота — `message.id` (локальный id; он не меняется при подтверждении отправки, см.
`MessageStore.confirm(localID:with:)`). Никогда не ключуй строки по `remoteId`, индексу или времени. Изменение
сообщения (правка, реакция, статус, прочтение) — только `snapshot.reconfigureItems`, не `reloadItems` и не новый id.
Внутри пузыря не вешай `.id(...)` на содержимое, которое меняется при каждом обновлении, а `ForEach` веди по id
пунктов (`Poll.Option.id`, `Checklist.Item.id`, вложения), не по индексу. Добавляя в пузырь новое состояние, проверь,
что оно меняет `Item` (`Hashable`) или учтено в `changed` (как `readState`).
**Почему.** Diffable-снапшот сравнивает только идентификаторы: изменённое содержимое без `reconfigureItems` не
перерисуется. Пересоздание вида (новый id, `.id` на меняющемся содержимом) сбрасывает состояние и анимации — у
Telegram это давало вспышку «полный текст → маска» на каждом куске потокового ответа.
**Сейчас у нас.** Соблюдено: `MessageListView.swift:330` — `snapshot.reconfigureItems(changed)`.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Architecture: Entry array…, Node hosting);
`docs/instantpage-richtext.md` (AI streaming animation, «The pageView is REUSED across stableVersion bumps»);
S13 §4 «The item» (`stableId` = `.widget(path)`)*

#### 6.2.2 Id в снапшоте уникальны — иначе падение
**Правило.** Уникальность гарантирует слой данных: `MessageStore.upsert` (своё неподтверждённое + эхо с сервера по
nonce) и `MessageTimeline.build` не выдают одно сообщение дважды; `Day.id` (начало суток) уникален. Слияние своего
сообщения с эхом realtime держи под тестами (`MessageSyncTests`: `testSocketEchoBeforeResponseDoesNotDuplicate`,
`testEchoWithNonceConfirmsItsOwnRow`; `OutboxServiceTests`).
**Почему.** `Dictionary(uniqueKeysWithValues:)` в `apply` и `NSDiffableDataSourceSnapshot` падают на повторе id;
CoreList у Telegram проверяет уникальность до диффа.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (`applyChanges` validates unique identities)*

#### 6.2.3 Ленту менять только целым снапшотом через `apply`
**Правило.** Содержимое ленты меняется только новым снапшотом в `MessageListViewController.apply(days:revision:…)`.
Никаких `insertItems`/`deleteItems`/`reloadData` на `collectionView` в обход `dataSource`.
**Почему.** Telegram применяет пакет в строгом порядке (удаления по убыванию, вставки по возрастанию, обновления) и
отдаёт итог одним проходом; порядок у нас берёт на себя UIKit, но только если вход один.
**Применимость.** Частично — порядок операций решает diffable data source; переносится «один вход, целый снапшот».
*Источник: `docs/chat/corelist-chat-history-backend.md` (Transaction flow)*

#### 6.2.4 Живое состояние ячейки вид наблюдает сам
**Правило.** Загрузку, прогресс, проигрывание голосового пузырь читает сам из `@Observable`-источника
(`VoicePlayback`, `ChatFileDownloads`, загрузчик вложений), а не ждёт новой конфигурации ячейки и не получает
их полем `Item`.
**Почему.** Конфигурация ячейки (`UIHostingConfiguration`) пересоздаётся только при смене элемента; у Telegram
поставщик вида — одноразовый, что не в ключе, до вида не доходит.
*Источник: `submodules/TelegramUI/Components/RichTextEditorMediaView/CLAUDE.md` («The media-view provider seam is ONE-SHOT»)*

#### 6.2.5 Переиспользованная ячейка не наследует ничего от прежнего сообщения
**Правило.** Ячейка `MessageCell` получает новую `UIHostingConfiguration` на каждую привязку; состояние SwiftUI,
относящееся к сообщению или вложению, отделяй личностью по id (как `.id(attachment.id)` у одиночной плитки в
`AttachmentView.swift`). Результаты асинхронных загрузок перед записью сверяй с id сообщения/вложения. Не рассчитывай,
что привязка начинается с пустого вида. Если появится свой `prepareForReuse` — он отменяет загрузки и сбрасывает
картинку, прогресс, выделение; привязку делай без неявных анимаций слоя
(`UIView.performWithoutAnimation`/`CATransaction.setDisableActions(true)`).
**Почему.** У Telegram ячейки переназначаются на новые индексы на месте, и `prepareForReuse` обязан сбросить всё про
прежний снимок; иначе плитка чужого сообщения показывает прежний снимок, а слои «доезжают» анимацией.
**Сейчас у нас.** Соблюдено для плитки: комментарий у `.id(attachment.id)` прямо называет риск «унаследовать
прежний снимок и открытый спойлер».
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Thumbnails»: переназначение на месте, контракт
подкласса, «Binding runs with actions disabled»)*

#### 6.2.6 Локальное состояние и ресурсы строки живут по id, не по индексу
**Правило.** Раскрыт ли текст или спойлер, показан ли перевод, что выбрано, что проигрывается, загруженные данные
карточки (результаты опроса, снимок карты) — храни по id сообщения/вложения (вне ячейки или с личностью по id) и
сбрасывай при смене id. Плееры и загрузчики в ячейке живут по ключу «id сообщения + вложения»: смена счётчиков и
реакций их не пересоздаёт, правка содержимого или другое сообщение — даёт свежее состояние. Никогда не ключуй по
`IndexPath`: он меняется при подгрузке истории сверху.
**Почему.** У Telegram состояние, привязанное к порядковому номеру, липло к чужому блоку при дописывании;
переиспользованный узел для другого сообщения обязан уничтожить экземпляры, а тот же id — сохранить раскрытие.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 media spoiler, «Reuse resets reveal state by media id»;
Collapsed quotes, «Keyed by structural path, not ordinal»); `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Lifetime»; «The message's
context and state»); S13 §4 «Lifetime: the bubble»; P — Task 11*

#### 6.2.7 Два вида одной строки — одна идентичность и один тип вида
**Правило.** Смена режима одной строки (свёрнуто/развёрнуто) — это смена параметров одного вида, а не
`if expanded { ViewA } else { ViewB }`; в diffable — тот же id. Образец — `PostTextView` с `lineLimit`.
**Почему.** Разные идентичности или типы заставляют список заменить строку (затухание) вместо анимации; у Telegram
компактный и развёрнутый пост — один компонент, смена режима — один анимированный проход.
*Источник: `News/CLAUDE.md` (Compact / Expanded posts)*

#### 6.2.8 `IndexPath` ↔ id — только у источника данных
**Правило.** Перевод индекса в id и обратно — только `dataSource.indexPath(for:)` / `itemIdentifier(for:)` /
`sectionIdentifier(for:)`. `sectionItemIDs` — кеш для оценок раскладки того же прохода; не вычисляй из него
`IndexPath` для прокрутки, подсветки, меню.
**Почему.** Связь индекс ↔ вид знает только список; позиция, выведенная из загруженного диапазона, протекает его
инвариантами в чужой код.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Index lookup…, `loadedItemView(at:)` is the authority)*

#### 6.2.9 Скрывая элементы, не меняй адресацию остальных
**Правило.** Если часть элементов не показывается (неподдержанный вид, фильтр), адресуй оставшиеся по id, а не по
индексу в отфильтрованном массиве.
**Почему.** У Telegram фильтрация перенумеровала бы блоки, и переключатель чек-листа попал бы не в тот пункт —
поэтому функция возвращает индексы для пропуска, а не новый массив.
*Источник: `docs/instantpage-richtext.md` (Unsupported blocks, «It reports indices to skip rather than returning a filtered array»)*

### 6.3 Высоты строк и кеш раскладки

#### 6.3.1 Ключ кеша высот содержит всё, что меняет высоту
**Правило.** `MessageHeightKey.revision` — хеш `MessageTimeline.Item` + режим выбора + `isGroup`. Всё, что меняет
высоту строки, обязано входить в `Item` или в ключ отдельно: текст, вложения, реакции, «изм.», ответ, асинхронно
пришедшее (превью ссылки, размеры медиа от медиа-системы, расшифровка голосового, результаты опроса после голоса,
пункты чек-листа). Иначе такое содержимое явно перезапрашивает раскладку ячейки.
**Почему.** У Telegram без версии сообщения в ключе кеш закрывал новое содержимое, а пришедшая подсветка синтаксиса
не рисовалась. У нас без этого включение кеша высот (`PerformanceFlags.chatHeightCache`, шаг 2.5) даёт дыры и
наложения — ровно то, из-за чего флаг сейчас выключен.
**Сейчас у нас.** Соблюдено в ключе: `heightKey(id:width:)` и `layout.key` в `MessageListView.swift` хешируют `Item`,
`selection != nil` и `bubbleContext.isGroup`.
*Источник: `docs/instantpage-richtext.md` («Layout cache key includes message.stableVersion»; «The rich bubble's
cached-layout key includes the highlight»); S13 §4 «Height changes»; P — Task 14 (`widgetLayoutVersions`)*

#### 6.3.2 Размер шрифта — часть ключа каждого кеша раскладки
**Правило.** Держи `MessageHeightKey.category = preferredContentSizeCategory` и добавляй размер шрифта в ключ любого
нового кеша высот или раскладки. Кеш разбора `RichText` от шрифта сознательно не зависит (шрифт разрешается при
отрисовке) — не клади в него ничего, что зависит от шрифта, темы или языка.
**Почему.** У Telegram смена Text Size не меняет объект темы, поэтому кеши пузыря и предпросмотра несут размер шрифта
своим ключом; иначе после смены размера остаются старые высоты.
*Источник: `docs/instantpage-richtext.md` (Text Size / content scale, «Text Size does not change the theme object»)*

#### 6.3.3 Раскрытие — вход раскладки и часть ключа кеша
**Правило.** Если в пузыре чата появится раскрытие (длинный текст, цитата) при включённом `chatHeightCache`,
состояние раскрытия обязано входить в `MessageHeightKey`. Обрезку делай на уровне раскладки, а не маской поверх
полной высоты.
**Почему.** Обрезка на уровне вида считала высоту по раскрытому; без раскрытия в ключе тап менял состояние и получал
старую раскладку — «мёртвый тап».
**Сейчас у нас.** В ленте постов раскрытие держит `@State expanded` в `PostTextView`, высоту считает SwiftUI — ок.
*Источник: `docs/instantpage-richtext.md` (Collapsed quotes, «Expansion is a LAYOUT INPUT», «expandedQuotePaths is part
of the currentPageLayout CACHE KEY»; Show more, «showMoreExpanded is part of BOTH layout caches»)*

#### 6.3.4 Высота строки известна до прихода асинхронных данных
**Правило.** Высоту карточки и вложения задавай из того, что пришло с сообщением (размеры медиа, метаданные).
Миниатюра файла, обложка ссылки, снимок карты после загрузки высоту строки не меняют. Если высота всё же меняется
(опрос, карточка профиля, стикер) — один раз и с инвалидацией. Декодирование и снимки — вне главного потока.
**Почему.** Главный поток Telegram ждёт только размер (≤ 20 мс), отрисовку — никогда; иначе оценка и кеш высот врут,
лента прыгает, редактор и пузырь расходятся.
**Сейчас у нас.** Соблюдено у карты: `LocationMessageView.size = 240×140` (`MessageKindViews.swift`), снимок
приходит позже.
*Источник: `docs/instantpage-richtext.md` (Inline buttons, «The thumbnail deliberately does NOT change the row height»);
R — «Only the size is critical»; S19 §5 V1; S13 §4 «Height changes»*

#### 6.3.5 Асинхронная высота — заглушка известной высоты и ограничение min/max
**Правило.** Для элементов, чья высота приходит асинхронно (превью ссылки, опрос с подгрузкой), — заглушка заранее
известной высоты и ограничение min/max; замер кешируй по сообщению (`MessageHeightCache`, лимит 4000).
**Почему.** У Telegram высота виджета до отчёта — 160 pt, затем ограничена 50…600 и кешируется по сообщению вместе с
якорем, чтобы прокрутка назад не прыгала и один ответ сервера не растянул строку на экран.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Size (MessageWidgetBubbleSize)»)*

#### 6.3.6 Замер подменяет оценку только в покое и с якорем
**Правило.** Оценки высот (`chatEstimatedHeights`, `MessageHeightEstimate`) подменяй измеренными вне жеста и полёта,
удерживая верхнюю видимую ячейку; картинку перезапрашивай, только если сменилась ступень `ImageTarget`.
**Почему.** Telegram ставит точную раскладку только без перехода, щипка, перетаскивания и полёта и так, что верхний
видимый снимок остаётся на той же доле ряда. У нас кеш высот (2.5) выключен именно из-за дыр у верха.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Level 1», третий пункт)*

#### 6.3.7 Перемер строки — только её
**Правило.** Догрузка картинки или строки реакций перемеряет одну строку (самоизмерение `preferredLayoutAttributesFitting`
+ `invalidationContext`, `MessageCollectionView.onContentHeightChange` → `contentHeightChanged`) и не вызывает `apply`
всего снапшота или `reloadData`.
**Почему.** У Telegram `onContentDidChange` помечает строку грязной и планирует один склеенный проход ровно для неё.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Self-update and view reuse)*

#### 6.3.8 Колбэки раскладки и запросы геометрии — без побочных эффектов
**Правило.** Замыкание секции `MessageListLayout`, `estimatedSection`, `MessageStackLayout.key/estimate/headerHeight`,
`invalidationContext(...)` и любые функции «где сейчас сообщение X» — только чтение и расчёт: без
`dataSource.apply`, `layoutIfNeeded`, `scrollToItem`, `setContentOffset`, подгрузки и записи в модель. Раскрытие или
подгрузку, нужные для ответа, делай заранее отдельным шагом.
**Почему.** У Telegram резолвер цели вызывается внутри построения окна и не имеет права менять список или входить
повторно; запрос прямоугольника якоря остаётся чистым и синхронным.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (`applyChanges`, `CoreListScrollTarget`: «It must not mutate the list or re-enter»);
`docs/instantpage-richtext.md` (Anchor navigation, «getAnchorRect stays a pure synchronous query»)*

#### 6.3.9 Видимые строки — двоичным поиском, не перебором
**Правило.** Своя раскладка ленты ищет видимые строки двоичным поиском по накопленным смещениям; `firstIndex(where:)`
по всем сообщениям на каждом кадре прокрутки недопустим.
**Почему.** У Telegram поиск видимых шёл перебором от нуля на каждом тике — чем глубже, тем медленнее.
**Сейчас у нас.** Соблюдено: `MessageStackGeometry.elements(from:to:)` — секции перебором, строки двоичным поиском.
*Источник: `docs/superpowers/specs/2026-10-27-media-picker-grid-design.md` («Scrolling»);
`docs/superpowers/plans/2026-10-27-media-grid-stage1.md` (Task 3, «never iterate items»)*

#### 6.3.10 Анимированная смена высот: строки из-за края въезжают без анимации
**Правило.** Крупные смены высот (вход в выбор, смена шрифта) делай без анимации или затуханием всей ленты, а не
пружиной по частям.
**Почему.** `UICollectionView` в `animateLayout()` анимирует только ячейки, видимые до и после; въехавшие из-за края
появляются сразу на месте. Telegram для этого расширяет поле предзагрузки на путь строк.
**Применимость.** Частично — механика UIKit другая.
*Источник: `News/CLAUDE.md` («Every row the switch carries across the screen morphs», `prepareHeightChange`)*

### 6.4 Позиция ленты: низ, якоря, переходы

#### 6.4.1 «Держаться низа» — защёлка, которую ставят и снимают события
**Правило.** `sticksToBottom` включают события (открытие, кнопка «вниз», своя отправка), снимают события
(`scrollViewWillBeginDragging`, переход к сообщению). Никогда не выводи её из смещения; «у низа ли сейчас»
(`isNearBottom`) — отдельный вопрос. После перехода к сообщению верхнее видимое держится `restore(pinned)`, пришедшее
ниже ленту не тянет, подсказкой служит счётчик на кнопке «вниз».
**Почему.** У Telegram закрепление — защёлка, а «место» — отдельная величина; слияние их в одно число — известное
семейство дефектов. Удержание цели — по id, не по индексу.
**Сейчас у нас.** Соблюдено; комментарий в коде запрещает решать по смещению.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Pin to bottom edge; Holding a scrolled-to message);
`submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Bottom-edge pin, The scroll hold)*

#### 6.4.2 «У низа» — только когда загружен свежий край
**Правило.** Решения «у низа переписки» принимай только вместе с `!model.isDetached`: в окне истории низ окна — не низ
переписки.
**Почему.** У Telegram смещение «известно» только когда окно доходит до края коллекции.
**Сейчас у нас.** Соблюдено: `followsBottom: !model.isDetached`, в окне истории кнопка «вниз» видна всегда
(`showsDownButton` в `ChatThreadView.swift`).
*Источник: `docs/chat/corelist-chat-history-backend.md` (Content offsets and displayed item range)*

#### 6.4.3 Смена высоты строки: у низа — остаёмся у низа, выше видимого — держим видимое
**Правило.** Строка целиком выше видимого верха сдвигает смещение на свою разницу, видимая растёт вниз; если лента у
низа — остаётся у низа; первая высота — как у нового сообщения; за край ленты пустоту не выводить. Держи оба
инварианта под тестами (`MessageStackGeometryTests`, `PerformanceFlagUITests`).
**Почему.** У Telegram строка сама выбирает, какой край стоит на месте; строка вне экрана экран не двигает, список
упирается в концы.
**Сейчас у нас.** Соблюдено: `MessageStackGeometry.offsetAdjustment` + `sticksToBottom`.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Which edge stays put»); S19 §10; R — Divergences M1d*

#### 6.4.4 Под пальцем и на инерции смещение не корректировать, инерцию не гасить
**Правило.** Не меняй `contentInset`/`contentSize`/`contentOffset` во время `isTracking` или инерции, если это
двигает содержимое под пальцем, и не останавливай инерцию ради правки геометрии (`setContentOffset(текущее,
animated: false)` гасит взмах). Поправку при перемере строки выше видимого во время броска откладывай до остановки или
применяй без сброса скорости. Свои правки краёв не делай на каждом кадре инерции.
**Почему.** У Telegram цель «держать край» обрывает инерцию, поэтому её не ставят, пока палец на экране или список
тормозит (тест `testAFlingPastAResizingWidgetKeepsItsMomentum`); перенос края под пальцем без компенсации даёт скачок
на следующем кадре, а остановка движения оставляет содержимое там, где отпустили.
**Сейчас у нас.** Проверить на iPhone: `MessageListLayout.invalidationContext` (`MessageListView.swift`) и
`MessageStackLayout.invalidationContext` ставят `contentOffsetAdjustment` без проверки `isTracking`/`isDecelerating`.
Если перемер во время броска гасит инерцию — это возможная причина рывков при `chatHeightCache`.
**Применимость.** Частично — физику ведёт `UIScrollView`.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Which edge stays put», «A target ends a held jump and stops momentum…»);
`docs/chat/corelist-chat-history-backend.md` («The hold is applied DURING the drag…», «Halting motion instead…»)*

#### 6.4.5 Смена отступов держит якорь и не останавливает движение
**Правило.** Клавиатура, панель ответа, закреплённое — это смена нижнего/верхнего отступа (`setBottomInset`,
`setTopObstruction` → `applyTopInset`): держи якорь (низ ленты или верхнее видимое), не останавливай прокрутку и
полёт, не обрезай отскок у края.
**Почему.** У Telegram изменение только нижнего отступа просто перекладывает, не трогая движение, только верхнего —
сдвигом, не обрывая жест; проход раскладки не обрезает «резинку».
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Rotation and width changes», пункты 1–3)*

#### 6.4.6 Удержание позиции и подстройка под высоты не конкурируют
**Правило.** Пока лента держит позицию (переход к ответу, первое непрочитанное), изменения высот её не перехватывают,
и наоборот: подстройка под высоту не «закрепляет» строку.
**Почему.** У Telegram при закреплённой строке цели изменения размера нет вовсе — иначе каждый проход возвращал бы
строку назад.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («While the list holds a pinned row… there is no resize target at all»)*

#### 6.4.7 Подгрузка не сдвигает то, что видно
**Правило.** Любая подгрузка «вверх» (история переписки, медиа старее) сохраняет видимый элемент на месте. Подгрузка
вниз сдвига не даёт.
**Почему.** У Telegram заполнение дыры меняет ячейки на месте, а смена числа — вставка/удаление в конце, так что над
экраном ничего не двигается.
**Сейчас у нас.** Соблюдено: «Медиа» чата (`ChatContentList`, `PagedLoader`) грузит вниз; окно просмотра
(`ChatMediaWindow.prepend(older:)`) растёт в начало, `TabView` держится за id страницы; лента — `restore(pinned)`.
*Источник: `PeerInfoVisualMediaPaneNode/CLAUDE.md` («Data»); `docs/superpowers/specs/2026-10-28-shared-media-grid-design.md`
(«Hole fills»); `docs/superpowers/plans/2026-10-28-shared-media-grid-stage1.md` (Review Focus)*

#### 6.4.8 Сохранение и восстановление позиции — точные взаимные обратные
**Правило.** Любое новое сохранение позиции (возврат в чат, поиск) — как `topVisibleItem()`/`restore(_:)`: якорь по id
и расстояние от того же края (`frame.minY − contentOffset.y`), восстановление обратной формулой без пересчёта единиц.
**Почему.** У Telegram смещение строки сохраняется как `frame.minY − insets.top` и восстанавливается как `.top(offset)`
— та же договорённость; любая асимметрия даёт дрейф при каждом восстановлении.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Index lookup…, `itemNodeRelativeOffset`)*

#### 6.4.9 Удалённый якорь — ближайший выживший ниже, затем выше
**Правило.** Если верхнее видимое сообщение исчезло, держи соседнее выжившее (сначала ниже, потом выше), а не грубую
компенсацию. `topVisibleItem()` не учитывает оттяжку у верха (смещение меньше `−contentInset.top`).
**Почему.** У Telegram при сохранении видимого держится строка на краю, а при её удалении — ближайшая выжившая;
отскок никогда не влияет на выбор якоря и направление.
**Сейчас у нас.** соблюдено (#499): кандидаты в якорь — верхнее видимое, видимые под ним и три над ним; при удалении
держится ближайшее выжившее.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Virtual content and settled window: `.preserveVisibleContent`, mutation anchors)*

#### 6.4.10 Первую позицию ставить после размеров и содержимого
**Правило.** Первая позиция — только в `positionInitiallyIfPossible()` при ненулевой высоте и непустом снапшоте,
дважды через `layoutIfNeeded()` (оценки → настоящие высоты); до этого лента прозрачна (`alpha = 0`). В тестах раскладки
задавай `contentSize`/высоты до смещения.
**Почему.** `UIScrollView` зажимает смещение, заданное до раскладки (−100 → 0).
*Источник: `docs/chat/corelist-chat-history-backend.md` (Pin to bottom edge: negative `bounds.origin.y` clamped);
`submodules/TelegramUI/Components/CoreList/CLAUDE.md` («UIScrollView clamps bounds.origin.y writes»)*

#### 6.4.11 Якорь первого непрочитанного переживает появление панелей
**Правило.** Если после открытия появляются панели сверху (закреплённое, шапка), первое непрочитанное должно остаться
под нижней кромкой панелей. Решать «было ли оно прижато» — по старому отступу, ставить — по новому, в одном месте.
**Почему.** У Telegram полоса «пожаловаться» появлялась посреди открытия, и разделитель уходил под неё; разнесённые
половины решения оставляли одну из них заглушкой.
**Сейчас у нас.** Проверить на iPhone: открытие ставит `initialAnchor` через `scrollToItem(.top)`, а `applyTopInset`
(`MessageListView.swift`) держит только низ. Сценарий — чат с непрочитанным и закреплённым сообщением.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Unread item alignment)*

#### 6.4.12 Переход к далёкому — без пробега; цепочки переходов проверять
**Правило.** Далёкая цель (> 1,5 экрана, `nearScreens`) или только что заменённое окно — мгновенно через `crossfade`,
близкая — анимацией; после прокрутки — досадка по настоящим высотам в `finishFocus`. Проверяй цепочки: ответ → сразу
«вниз»; «вниз» → сразу закреплённое; дата из календаря → сразу ещё одна.
**Почему.** У Telegram позиция цели считается после её замера, далёкий прыжок — без затухания по направлению, а второй
прыжок, разворачивающий первый на лету, рисовал прежнее окно поверх нового.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Scroll to item: resolver, direction, full-replace carousel,
«Two jumps in a row…»)*

#### 6.4.13 Недозаполненная лента — от высот, одним запасом
**Правило.** Если появится выравнивание короткой переписки к низу (к полю ввода) или центрирование приветствия, —
одним запасом (верхний отступ = высота экрана − высота содержимого), посчитанным от высот, учтённым и в
`bottomOffset`, и в `applyTopInset`, заданным до первой расстановки. При переполнении запас сбрасывается в ноль.
**Почему.** Посчитанный от текущего положения строки запас плывёт под оттяжкой; ноль так же важен, как положительное
значение — он снимает центрирование, когда содержимое переросло экран.
**Применимость.** Частично — короткая переписка сейчас стоит у верха (`bottomOffset = max(−inset.top, …)`).
*Источник: `docs/chat/corelist-chat-history-backend.md` (Trailing item space); `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Stacking from the
bottom, `stacksFromBottom`)*

#### 6.4.14 Раскрытие строки держит её верх тем же проходом
**Правило.** «Ещё» у поста (`PostTextView`, `lineLimit` → `nil`) в `LazyVStack`: верх поста остаётся на месте, текст
растёт вниз; если верх под шапкой — встаёт на кромку. Позицию держи тем же проходом раскладки, а не отдельным
`scrollTo` после.
**Почему.** У Telegram повторная центровка прокруткой после морфа запрещена: она гасит инерцию и идёт на более
позднем такте.
**Применимость.** Частично — режимов отображения ленты у нас нет; правило раскрытия применимо.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (`.preserveCentredContent`, `.preserveItem(identity)`); `News/CLAUDE.md` (Pinch…)*

#### 6.4.15 «Ещё» меняет только хвост; строки ниже не пропадают
**Правило.** Раскрытие переключает `lineLimit` у того же `Text` — общая часть не перерисовывается; нижние посты в
`LazyVStack` не мигают и не исчезают на кадр.
**Почему.** У Telegram обрезанный текст рисуется ровно как начало целого, раскрытие — клипом с пружиной, а нижние
строки на время прохода остаются загруженными.
**Сейчас у нас.** Проверить на iPhone: раскрытие длинного поста (`PostCardView.swift`, `PostTextView`).
**Применимость.** Частично — без клипа и выборочного затухания.
*Источник: `News/CLAUDE.md` (Show more)*

#### 6.4.16 Позицию прокрутки писать синхронно
**Правило.** Переход к сообщению/дате, «вниз», будущий ползунок — смещение `UICollectionView`/`ScrollViewReader`
ставится сразу на главном, без `Task`/`debounce`/троттлинга между жестом и записью.
**Почему.** У Telegram ползунок писал смещение через фоновую очередь и троттлинг 0,05 с — сетка прыгала рывками по
много экранов.
*Источник: `docs/superpowers/specs/2026-10-27-media-picker-grid-design.md` («Scrubber»)*

#### 6.4.17 Пороги смещения — с допуском; у элемента от порога есть свой путь снятия
**Правило.** Сравнения смещений — с допуском не меньше 0,5 pt (как `abs(...) > 0.5` в `shiftKeepingBottom`,
`restore`, `scrollToBottom`); `MessageListGlide` досаживает на цель точно. Элемент, появляющийся по порогу смещения
(кнопка «вниз»), исчезает не только по следующему сообщению о смещении.
**Почему.** У Telegram покой в 0,333 pt от края (сетка 3×) при пороге `< −0.1` держал невидимый вид 94 pt, съедавший
касания; направление отскока, перевыведенное из смещения у самой границы, однажды унесло ленту на 800 000 pt.
*Источник: `docs/chat/corelist-chat-history-backend.md` («The cause that actually shipped… a third of a point»);
`submodules/TelegramUI/Components/CoreList/CLAUDE.md` («A settle at an edge must land ON the edge», «The bounce springs
toward the edge the deceleration CROSSED»)*

#### 6.4.18 Компенсации — разностью внутри прохода
**Правило.** Инерцию системного `UIScrollView` останавливает только `setContentOffset(contentOffset, animated: false)`
(он же гасит идущую `setContentOffset(…, animated: true)`) — пользуйся им осознанно (см. 6.4.4). Компенсации (`grown`,
`restore`) считай разностью «до/после» внутри одного прохода, а не абсолютным пересчётом позже.
**Почему.** У Telegram смещение стабильно в пределах кадра, а разностные вычисления обязаны оставаться разностями —
иначе в них попадает чужое движение.
**Применимость.** Частично — у Telegram свой движок прокрутки, у нас системный.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Scroll engine and physics: «never sample a running animation… halt with
`haltMotionInPlace()`»)*

### 6.5 Жесты, отложенные действия и сообщения наружу

#### 6.5.1 В `scrollViewDidScroll` отличать палец от программы
**Правило.** Побочные эффекты «человек листает» (показ плавающей даты, сброс защёлок, замер рывков) — только при
`isDragging || isDecelerating` (как `showHeaders()` в `handleScroll`). «Палец на ленте» — `isTracking`, «катится» —
`isDecelerating`; не путать.
**Почему.** `UIScrollView` вызывает `scrollViewDidScroll` и на программные записи смещения; у Telegram программные
записи в колбэк пользовательской прокрутки не входят вовсе.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Scroll-engine seam)*

#### 6.5.2 Состояние жеста сбрасывается в начале следующего жеста
**Правило.** Флаги жеста (`sticksToBottom`, `pendingFocus`, `glide`) снимай в `scrollViewWillBeginDragging`, а не в
конце жеста; одноразовые величины (прогресс оттяжки, «вооружено») потребляй и обнуляй в конце.
**Почему.** У Telegram «перетаскивание началось у низа», сброшенное на конце, уже не видел проход раскладки после
скрытия клавиатуры; необнулённый прогресс оттяжки «вооружал» действие на следующем несвязанном отпускании.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Interactive drag start; Overscroll actions)*

#### 6.5.3 У каждого «началось» — «закончилось» на всех путях
**Правило.** `ScrollJankMonitor.begin/end` и `scheduleHeaderHide` закрываются в `scrollViewDidEndDragging(!decelerate)`
и `scrollViewDidEndDecelerating`. Для путей, где конца не будет (инерцию прервала программная `setContentOffset` в
`scrollToBottom`, `crossfade`, `restore`), закрывай состояние явно.
**Почему.** У Telegram ничто не сбрасывало «листается» — после первого перетаскивания чат считал, что его листают
вечно; касание без начавшегося жеста оставляло «замедляется».
**Сейчас у нас.** Проверить на iPhone: после программной прокрутки посреди инерции плавающая дата гаснет, а
`ScrollJankMonitor` закрывает замер.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Deferred items п. 3); `submodules/TelegramUI/Components/CoreList/CLAUDE.md` («A touch-down catch
idles the physics too»)*

#### 6.5.4 Автопрокрутка без пальца — тоже действие человека
**Правило.** Если `SlideSelection` или перетаскивание начнут листать ленту у края, такой сдвиг снимает
`sticksToBottom`, останавливает `glide`, гасит `pendingFocus` — как `scrollViewWillBeginDragging`.
**Почему.** У Telegram автопрокрутка при выделении двумя пальцами — пользовательская: снимает защёлки, гасит инерцию,
за вызов не дальше запаса предзагрузки.
**Применимость.** Частично — автопрокрутки при выделении сейчас нет.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Host-facing embedding seam, `scroll(by:)`)*

#### 6.5.5 Одно отложенное действие на цель
**Правило.** Новые задержки — одна задача на назначение, отмена прежней, проверка поколения/цели на срабатывании.
**Почему.** У Telegram каждое отпускание заводило свою задержку и аниматор без связи между ними — любое переплетение
приземлялось не туда.
**Сейчас у нас.** Соблюдено: `headerHideTask` отменяется перед новым, `scheduleFocusFinish` сверяет
`pendingFocus == request`, `markReadRetry` — одна задача, `loadOlder` сверяет `windowGeneration`.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Overscroll actions, «The landing is one-at-a-time»)*

#### 6.5.6 Действия по результату `apply` — в его завершении, с захваченными параметрами
**Правило.** Всё, что зависит от применённого снапшота (досадка низа, `restore(pinned)`, `reportBottom`), — в
завершении `dataSource.apply(...)`. Параметры прохода (`wasAtBottom`, `pinned`, `followed`) захватывай до `apply` и
передавай в завершение, а не перечитывай из изменившегося состояния.
**Почему.** У Telegram проход, попавший внутрь другого, откладывается; синхронное чтение после него находит прежнее
окно, а флаги прохода обязаны пережить откладывание.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Arriving messages…, deferral; Send animation)*

#### 6.5.7 Анимация прохода решается один раз
**Правило.** В каждом проходе — одна переменная «анимировать ли» (как `animated = (tailGrew && !replaced) || inPlace
|| animatingToBottom` в `apply`), и она идёт во все части: прокрутку, дорисовку высоты, плавающую дату. Уменьшение
движения — внутри того же решения (`!reduceMotion`).
**Почему.** У Telegram переход выводится один раз по старшинству и служит и применяемой, и сообщаемой анимацией;
отдельные решения по частям рассинхронизируются.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Transaction flow, `transition:` derived once)*

#### 6.5.8 Сначала записать новое состояние, потом сообщить — и только при смене
**Правило.** Любое сообщение из ленты наружу — как `reportBottom()`: записать (`reportedAtBottom`), сравнить, и лишь
при смене отправить (`onBottomChange`) асинхронно, вне прохода обновления SwiftUI.
**Почему.** У Telegram зеркальное значение записывается до вызова колбэка, чтобы колбэк, вызвавший новое обновление,
не зациклился.
*Источник: `docs/chat/corelist-chat-history-backend.md` (`updateVisibleItemRange(force:)`)*

#### 6.5.9 После программной прокрутки сообщать итог, а не середину анимации
**Правило.** Кнопка «вниз» не мигает при своей отправке, нажатии «вниз» и открытии клавиатуры у низа. Если нужно —
сообщай по цели (`sticksToBottom`/идущий `glide`), окончательное — в `glide.onFinish` (он уже вызывает
`reportBottom`).
**Почему.** У Telegram сообщённое начало прыжка оставляло кнопку «вниз» до следующей ручной прокрутки, а середина
анимации отступа клавиатуры (~98 pt против порога 40) показывала кнопку у низа.
**Сейчас у нас.** Проверить на iPhone эти три сценария: `reportBottom()` считает по текущему `contentOffset`, а во
время `MessageListGlide` смещение ещё посередине.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Content offsets…, `.settled`)*

#### 6.5.10 Смена геометрии вне прокрутки сама пересчитывает «у низа» и дату
**Правило.** Запись `contentOffset` вызывает `scrollViewDidScroll` сама, а смена `contentSize`/`contentInset` без
смены смещения — нет: после неё явно зови `reportBottom()` и `updateFloatingDate()` (как в `defer` завершения
`apply` и в `applyTopInset`). Новый путь, меняющий геометрию, — с тем же хвостом.
**Почему.** У Telegram удержание оттяжки двигало содержимое мимо транзакции, последнее значение «застревало», и
элемент жил над нулевым смещением, съедая касания.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Overscroll actions, «any geometry mutation outside a transaction
owes a content-offset report»)*

#### 6.5.11 Колбэк «видимый диапазон изменился» — один раз на изменение
**Правило.** `FeedPrefetcher`, `ChatMediaPrefetcher` и подгрузку страниц (`loader.loadMore`) запускай по изменению окна
видимого: сравни с прошлым значением и выйди, если оно то же.
**Почему.** У Telegram диапазон сообщается после каждого прохода привязки, но только когда он изменился; иначе работа
на каждом кадре прокрутки.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Hosts other than the picker», `onVisibleRangeChanged`)*

#### 6.5.12 Обработчики ленты читаются в момент вызова
**Правило.** `MessageListView.bind(_:)` переназначает замыкания при каждом обновлении SwiftUI, контроллер зовёт
`self?.onReachTop?()` в момент события. Не копируй эти замыкания в долгоживущие `Task`/таймеры.
**Почему.** В скопированном замыкании окажется устаревшая версия с устаревшим захватом модели; Telegram читает
колбэки из `self` в момент вызова, чтобы подхватить позднее назначенный контроллер.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Pagination, «Callbacks are read off `self` at call time»)*

#### 6.5.13 У общего колбэка один владелец
**Правило.** Снимая обработчик синглтона (`ImageDownloads.shared`, `RealtimeCoordinator`, `VideoPlaybackCenter.shared`,
`PhotoAlbumsModel`) в `deinit`/`onDisappear`, проверь, что он всё ещё твой (токен/идентичность).
**Почему.** У Telegram `deinit` старого источника данных снимал подписку нового — при смене альбома новый источник
оставался глухим.
**Сейчас у нас.** Соблюдено у `VideoPlaybackCenter.deactivate(_:)`: сбрасывает `activeID`, только если он свой.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («`onThumbnailsChanged` has one owner»)*

#### 6.5.14 Уходящая лента замирает с начала ухода
**Правило.** Собственные движения ленты (display link пружины `MessageListGlide`) не продолжаются, пока экран уезжает
назад: останавливай их в начале ухода, учитывая отменённый свайп назад (экран остаётся).
**Почему.** У Telegram подавить колбэк ≠ подавить движение: уезжающий снимок должен и остановиться, и перестать
принимать касания.
**Сейчас у нас.** соблюдено (#499): `glide.stop()` в `viewWillDisappear`; при отменённом свайпе назад пружина доезжает в
`viewDidAppear`.
**Применимость.** Частично — сам переход делает система; переносится остановка своих движений.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Overscroll actions, `globalIgnoreScrollingEvents`)*

#### 6.5.15 Строку с открытым свайпом не перекладывать молча
**Правило.** Открытые действия свайпа строки не должны оставаться над чужой строкой и не должны запускать действие не
той строки, когда список перестраивается (новое сообщение переставило чаты).
**Почему.** У Telegram контрол свайпа сбрасывался за кадр при смене раскладки, поэтому новая раскладка строки ждёт
закрытия свайпа, а свайп закрывается в одной транзакции с проходом строки.
**Сейчас у нас.** Проверить на iPhone: список чатов — SwiftUI `List` со `.swipeActions` (`ChatListView.swift`,
слева и справа), открытый свайп при пришедшем сообщении.
**Применимость.** Частично — свайпы ведёт система.
*Источник: `News/CLAUDE.md` (Pinch, per-row expansion…, «Nothing opens a row on a layout it has not taken»)*

### 6.6 Видимость, плавающая дата и оверлеи

#### 6.6.1 Прочитанным считать только реально видимое
**Правило.** Отметку прочтения и счётчик кнопки «вниз» считай по сообщениям, видимым в полосе
`[contentOffset.y + contentInset.top, contentOffset.y + bounds.height − contentInset.bottom]` (ниже панелей и выше поля
ввода), а не по `indexPathsForVisibleItems`/`visibleCells` целиком. Для прочтения недосчитывать безопаснее, для
автовоспроизведения годится весь экран. Неотправленные (без `remoteId`/`seq`) в отметку не входят. Перед уходом с
экрана дочитай видимое. Решение — чистой функцией с тестом.
**Почему.** Загруженное окно = экран + запас предзагрузки; выдав его за «видимое», Telegram ломал автовоспроизведение,
прочтение и анимации реакций. Строка под панелью сверху не в счёт (тест
`ChatControllerInteractionTests.chatHistoryMaxVisibleReadIndex`). У нас лента уходит под панели
(`contentInsetAdjustmentBehavior = .never`).
**Сейчас у нас.** соблюдено (#499): лента сообщает нижнюю строку, видимую между панелями и полем ввода; `markRead` не
отмечает ниже неё.
**Применимость.** Частично — автовоспроизведения в ленте чата нет.
*Источник: `docs/app-unit-tests.md` (`ChatControllerInteractionTests`); `docs/chat/corelist-chat-history-backend.md`
(Item visibility; Item-node enumeration)*

#### 6.6.2 Геометрию строк брать в пространстве ленты; во время анимации `convert` отдаёт цель
**Правило.** Геометрию строки бери через `collectionView.layoutAttributesForItem(at:)` или
`convert(…, to: collectionView)`, не из `frame` вида внутри ячейки. Во время `UIView.animate { layoutIfNeeded() }`
(`animateLayout`, `crossfade`) модель уже в конце: `BubbleAnchors.shared.rect(for:part:)` и `convert` вернут конечное
место. Если оверлей (меню, будущая анимация отправки) стартует с того, что на экране, — `layer.presentation()` или жди
конца анимации. Пружина `MessageListGlide` пишет `contentOffset` каждый кадр — там модель совпадает с экраном.
**Почему.** У Telegram сравнение с локальной рамкой узла читало не то пространство (поиск сообщения под точкой не
совпадал никогда), а `convert` складывает модельные значения: «где есть» и «где будет» молча путаются.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Item-node enumeration, Item-node geometry);
`submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Row geometry is a pair)*

#### 6.6.3 Код, который меряет экран, запускать после итоговой геометрии
**Правило.** После реакции или правки из меню (`Menu/MessageMenuOverlay.swift`) возврат пузыря читай только после того,
как лента применила новую высоту (`dataSource.apply` + `layoutIfNeeded`). Проверяй именно сценарий «реакция из
открытого меню», а не только двойное касание.
**Почему.** У Telegram пузырь, измеренный через `convert` при старой высоте узла, садился на 34 pt ниже и прыгал;
сборка этого не ловит, а двойное касание меняет высоту без меню и годится как «рассекатель», не как регрессионный тест.
*Источник: `docs/chat/corelist-chat-history-backend.md` («The apply runs between those writes, and the order is load-bearing»)*

#### 6.6.4 Решения — по модели, не по отрисованному
**Правило.** Решения ленты (`isNearBottom`, `wasAtBottom`, «выросло сверху») принимай по модели (`contentOffset`,
атрибуты раскладки), а не по presentation-слоям посреди анимации.
**Почему.** У Telegram сэмплированное положение верно для отрисовки и неверно для решений; решения сравнивают старое
итоговое состояние.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Ghost blocks, «`settledRootY` is the SAMPLED root…»)*

#### 6.6.5 Оверлеи, следящие за содержимым, — в том же кадре
**Правило.** `floatingDate`, стрелку `SwipeToReply`, меню ставь синхронно в `scrollViewDidScroll` (как
`updateFloatingDate`), не через `DispatchQueue.main.async`/`Task`. Не анимируй `contentOffset` через `UIView.animate`,
если оверлеи не едут в той же анимации.
**Почему.** У Telegram вид, расставляемый из покадровых колбэков, отставал от полёта на кадр-два (до 60 pt); всё, что
смещает экранное содержимое, должно ехать одной дорожкой, иначе остаются «призраки».
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Host-facing…, `addContentMotionMirror`; Programmatic viewport scrolling)*

#### 6.6.6 Плавающая дата — наложение; её видимость — одна функция движения
**Правило.** Держи части вместе: `floatingDate` — над лентой (`view.addSubview`), свою строку дня прячет только пока
плавающая на виду (`coveredDay`), показ — от пальца/инерции в `handleScroll`, программные сдвиги её не будят, гашение —
`scheduleHeaderHide` (1,5 с), VoiceOver читает строки дней.
**Почему.** У Telegram заголовки дат — наложение, места не резервируют, а «прилипание» и мигание — одна функция:
прилипание без мигания хуже, чем ничего.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Floating headers and avatars)*

#### 6.6.7 Подпись даты не пустеет
**Правило.** Плавающая дата в ленте и подписи месяцев в медиа на незагруженных участках берут ближайшую известную
дату, а не пустеют.
**Почему.** У Telegram подпись ползунка не должна быть пустой там, где сегодняшняя не пуста; дата берётся у ближайшего
якоря.
**Применимость.** Частично — ползунка у нас нет.
*Источник: `docs/superpowers/specs/2026-10-28-shared-media-grid-design.md` («Left to the builder»)*

#### 6.6.8 Цепочки предков не считать фиксированным числом шагов
**Правило.** Никаких `superview?.superview?…`: SwiftUI в `UIHostingConfiguration` → `contentView` → ячейка →
`collectionView`, и глубина зависит от версии iOS. Координаты — `convert(_:to: nil)` / `BubbleAnchors`, поиск
ячейки — `indexPathForItem(at:)`.
**Почему.** У Telegram узлы строк стали на уровень глубже, и пропущенный шаг зеркалил эффекты на ~180°.
*Источник: `TelegramUI/Sources/CLAUDE.md` (compiler-invisible invariants)*

#### 6.6.9 Боковые отступы — у содержимого строки, не у прокрутки
**Правило.** Горизонтальные поля пузырей — `.margins(.horizontal, Spacing.md)` в конфигурации ячейки;
`collectionView.contentInset` — только вертикальный. Боковые поля меняй перенастройкой ячеек. Если появятся боковые
панели, проверяй асимметричный случай отдельно.
**Почему.** У Telegram обрамление строки отступом ломало сторону и анимацию, и ошибка была невидима, пока левый и
правый отступы равны.
**Применимость.** Частично — приложение только портретное (`project.yml`, `UISupportedInterfaceOrientations`),
асимметричных отступов нет.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Horizontal insets go to the item…; …are mirrored on the way to CoreList)*

### 6.7 Пузырь и карточки внутри него

#### 6.7.1 Время «в строку» — только если пузырь кончается текстом
**Правило.** Каждый новый блок в пузыре (таблица, список, карточка ссылки, опрос) решает: несёт ли он невидимую копию
времени, или время уходит на свою строку. Время встаёт в последнюю строку, только если нижний элемент — текст.
**Почему.** У Telegram дата «цеплялась» к тексту, погребённому над таблицей.
**Сейчас у нас.** Соблюдено: `MessageCodeText` получает `metaPlaceholder = nil`, если текст кончается кодом.
*Источник: `docs/instantpage-richtext.md` (Status node positioning, «Trail the last line only when the bottom-most item is text»)*

#### 6.7.2 Невидимая копия времени повторяет видимую метку
**Правило.** `metaPlaceholder` (место под время) повторяет видимую `meta()` по составу и ширине: булавка, «изм.»,
время, состояние отправки, число прочитавших. Новый элемент метки добавляй в обе сразу; лучше собрать обе из одного
описания.
**Почему.** У Telegram якорь даты в замере обязан совпадать с якорем при отрисовке, иначе дату обрезает или сдвигает.
**Сейчас у нас.** соблюдено (#499): невидимая копия времени держит место под тот же знак, что рисует `stateMark`.
*Источник: `docs/instantpage-richtext.md` (Status node positioning, «statusAnchorY… must mirror statusFrameY…»)*

#### 6.7.3 Нижний отступ пузыря одинаков во всех состояниях
**Правило.** Состояния пузыря (отправляется, отправлено, ошибка, удалено, с реакциями) не меняют нижний отступ, если
не меняется содержимое. Константа отступа — одна на все ветки.
**Почему.** У Telegram при потоковом ответе статус скрыт, и отдельная ветка добавляет тот же отступ — иначе пузырь
подпрыгивал на 6 pt, когда появлялась дата. Две ветки — два конца одного инварианта, менять вместе.
*Источник: `docs/instantpage-richtext.md` (Status node positioning, «Bubble height leaves ~6pt below the date»,
«hasDraft adds the same 6pt»)*

#### 6.7.4 Подсветка поиска — при каждой отрисовке, не в кеше
**Правило.** Подсветку найденного (`SearchHighlight.apply`) накладывай на копию разбора при каждой отрисовке; не
храни подсвеченную строку в кеше.
**Почему.** У Telegram показанная подсветка цитаты переприменяется после каждой раскладки, соседние куски — один
отрезок; закешированная подсветка переживает смену запроса.
*Источник: `docs/instantpage-richtext.md` (Rich reply quotes, «The bubble re-applies a shown highlight after every layout»)*

#### 6.7.5 Статичное содержимое — сразу, обогащение — потом
**Правило.** Карточка рисует данные сообщения в первом кадре (вопрос и варианты опроса, название чек-листа, имя
контакта) и лишь затем накладывает загруженное (голоса, аватар, снимок карты).
**Почему.** У Telegram разметка публикуется до первого скрипта, поэтому зависший скрипт оставляет видимое содержимое.
**Сейчас у нас.** Соблюдено у опроса и карты.
*Источник: R — «The first flush is in `boot`»*

#### 6.7.6 Сбойная карточка — видимое состояние, а не тишина
**Правило.** Карточка без загруженных данных показывает то, что пришло с сообщением (вопрос опроса, имя из
`ProfileShare`, «Публикация недоступна»), и честную пометку об ошибке, а не вечный индикатор. Касания по неработающей
карточке отдаются пузырю (меню, ответ). «Нет данных» и «загрузка» не путать.
**Почему.** У Telegram два разных исхода: не стартовал — «не поддерживается», остановлен — последний кадр и значок;
мёртвый виджет перестаёт забирать касания.
*Источник: R — «Stops are final», «A frozen widget is a picture», «A boot that published nothing did not start»; S13 §6*

#### 6.7.7 Повторяющийся сбой не крутится по кругу
**Правило.** Если загрузка данных карточки (результаты опроса, `MKMapSnapshotter`, карточка профиля) падает повторно,
не повторяй её на каждом появлении ячейки: помни отказ по id в памяти и повторяй по событию (новая версия,
переподключение) или по «Повторить».
**Почему.** У Telegram после двух остановок подряд виджет не запускается, пока не сменится содержимое или не
перезапустится приложение (`MessageWidgetRestartPolicy`).
*Источник: R — «Restarts» (§5.7)*

#### 6.7.8 Карточка в превью неинтерактивна и не делает запросов
**Правило.** В превью-контекстах (меню сообщения `isMenuPreview`, плашка закрепа `ChatPinnedListView`, шапка ответа,
пересылка, поиск, «Материалы чата») карточка — только картинка: без голосования, без запросов на появление, без
таймеров.
**Почему.** У Telegram превью-виджет не принимает касаний, не шлёт вызовов и не трогает хранилище.
*Источник: S26 §5 W1 «Preview mode»; R — «A preview… takes no input»*

#### 6.7.9 Таймеры карточек идут при прокрутке и спят вне экрана
**Правило.** `Timer` для карточек добавляй через `RunLoop.main.add(timer, forMode: .common)`. Обновление «живой»
геопозиции (`TimelineView(.periodic(from:by: 30))` в `MessageKindViews.swift`) — не чаще нужного и не для невидимых
ячеек; анимаций у скрытых карточек нет.
**Почему.** В режиме по умолчанию таймер стоит, пока палец на ленте; у Telegram таймеры виджета — в `.common`,
скрытому — 1 Гц, кадры — только видимому.
*Источник: S13 §2 «Timers, frames and queries»; P — Task 7*

#### 6.7.10 Частичная перерисовка — с запасом на выступ глифов
**Правило.** Если карточка рисуется своим `draw(_:)`/`CALayer` с частичной инвалидацией (`setNeedsDisplay(_:)`),
расширяй прямоугольник под курсив и эмодзи.
**Почему.** У Telegram изменённые прямоугольники расширены на 2 px, иначе остаются огрызки глифов.
**Применимость.** Частично — своих частично перерисовываемых слоёв почти нет.
*Источник: R — «Changed rects are the union of a step's publishes»*

### 6.8 Устройство ленты, предзагрузка, отладка

#### 6.8.1 Одна точка входа и члены, названные по намерению
**Правило.** Внешний интерфейс ленты — `MessageListView` → `MessageListViewController`: `apply(days:revision:anchor:
context:selection:)` (единственный вход содержимого), `focus(_:)`, `scrollToBottom(token:)`, `setBottomInset`,
`setTopObstruction`, `followsBottom`. Новое поведение добавляй так же — одним членом по намерению; не открывай наружу
`collectionView`, `contentOffset`, `contentInset`. Две величины для сравнения отдавай одним вызовом из одного
состояния.
**Почему.** Пару сырых членов можно реализовать наполовину или прочитать в разные моменты одной анимации; член,
названный по механизму («top content inset»), каждая реализация понимает по-своему.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Architecture, Content offsets, Overscroll actions, Unread item
alignment); `submodules/TelegramUI/Sources/CLAUDE.md` (Contract rules)*

#### 6.8.2 Порядок вызовов в `updateUIViewController` — несущий
**Правило.** Любой публичный метод контроллера ленты, который может оказаться вызван первым, начинает с
`loadViewIfNeeded()`. Не переставляй вызовы в `MessageListView.updateUIViewController` без этой проверки.
**Почему.** `setBottomInset` вызывается первым и делает `loadViewIfNeeded()`; только поэтому `apply(...)` застаёт
`dataSource`, созданный в `viewDidLoad`. У Telegram `let _ = self.view` в `init` так же несущий: без него завершение
перезагрузки не приходит.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Architecture, Eager view load);
`submodules/TelegramUI/Sources/CLAUDE.md`*

#### 6.8.3 Настройка при создании — при создании; жизненный цикл — в своих точках
**Правило.** Тип раскладки (`chatHeightCache`) выбирается один раз в `configureCollectionView`; `glide.scrollView`/
`target` — в `viewDidLoad`; `ScrollBenchmark.startIfRequested` — после первой расстановки. Не переносить эти места.
Флаг, читаемый при создании, действует только на новый экран чата.
**Почему.** У Telegram одноразовая настройка задаётся в фабрике, а ручки из `viewDidAppear` в фабрику не переносятся —
меняется поведение; пресет анимации отправки работает после переоткрытия чата.
*Источник: `TelegramUI/Sources/CLAUDE.md` (Contract rules; Message send transition)*

#### 6.8.4 Заглушка с правдоподобной константой молча выключает поведение
**Правило.** При смене реализации ленты (`MessageListLayout` ↔ `MessageStackLayout` по `chatHeightCache`) выпиши всё,
что зависело от старой, и проверь каждое: `contentOffsetAdjustment` при перемере выше видимого, `onMeasured`/кеш
высот, плавающая дата и `coveredDay`, префетч, `contentHeightChanged`, `reportBottom`, пороги 80 pt / 0,5 pt. Ни одна
ветка новой реализации не возвращает константу «на время» без `assertionFailure` в Debug.
**Почему.** У Telegram заглушки выключили возврат к низу после скрытия клавиатуры и сброс «листается» (подсказка
больше не появлялась), а `enableUnreadAlignment` оказался мёртвым кодом. Порог, безопасный на старой реализации, — не
доказательство для новой.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Scope; Interactive drag start; Deferred items п. 3)*

#### 6.8.5 Лента только сообщает о краях; догрузку решает модель
**Правило.** Лента зовёт `onReachTop`/`onReachBottom` за 3 экрана (`preloadScreens`), не чаще раза в 0,3 с
(`lastPageRequest`). Решение «грузить ли», склейка и отбрасывание повторных запросов — только в модели
(`ChatThreadModel.loadOlder`: `isLoadingOlder`, `pendingWindowReset`, `windowGeneration`); лента не знает курсоров.
**Почему.** У Telegram список лишь наблюдает край; запросы склеиваются и дедуплицируются среди стоящих и летящих, ответ
применяется, даже если край уже покинут, выключение продвигает поколение.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Virtual content…, `onLoadedEdgeReached`; Demo app, Auto Load)*

#### 6.8.6 «Пришло новое» — по положению хвоста
**Правило.** Прибывшим считай непрерывный блок новых id у свежего края (`noteEntrances`: хвост после прежнего
последнего, не больше 3, страницы истории встают молча). Не отбрасывай прибытие из-за перенастройки предыдущего
пузыря (`changed`) или удаления далёкого.
**Почему.** У Telegram первая версия предиката дисквалифицировала прибытие при удалении старейшего и слиянии группы —
то есть ломала самый частый случай.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Arriving messages slide in as a block)*

#### 6.8.7 Предзагрузка — один полный список по важности, очередь заменяется
**Правило.** `FeedPrefetcher` и `ChatMediaPrefetcher` отменяют всё, что выпало из окна, — держи это. Окно считай одним
списком от важного к второстепенному; при смене — замена, а не добавление; на быстром ходу смотри на два шага вперёд.
**Почему.** У Telegram планировщик отдаёт один непересекающийся отсортированный список только при изменении; с одним
шагом вперёд на быстром ходу был белый кадр.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Thumbnails», последний пункт)*

#### 6.8.8 Быструю прокрутку распознавать и по прыжку
**Правило.** Если появится «быстрый режим» (отложить чёткие загрузки при быстрой прокрутке), считай быстрым и скачок
позиции больше высоты экрана (прыжок к дате, к сообщению из поиска).
**Почему.** У Telegram шаг больше экрана за кадр сразу считается быстрым, не дожидаясь 50 мс замера скорости.
**Применимость.** Частично — ползунка у нас нет.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («A frame step longer than the viewport…»)*

#### 6.8.9 Каждое программное движение ленты пишется в `ScrollProbe` с причиной
**Правило.** Любая запись `contentOffset`/`contentInset`, сделанная не пальцем, сопровождается `ScrollProbe.note(...)` с
причиной (как в `shiftKeepingBottom`, `restore`, `applyTopInset`, «grown compensation»). Скачки разбирай по логу с
телефона (`idevicesyslog -m ScrollProbe`, `-m ScrollJank`), а не на глаз.
**Почему.** У Telegram трасса касаний, пана, полёта и каждой программной записи с вызывающими функциями — единственное,
что отличает скачок от прокрутки.
**Сейчас у нас.** Соблюдено: `ScrollProbe` (os_log, только Debug) и `ScrollJankMonitor`.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Scroll trace)*

#### 6.8.10 Мерить пересоздание видов, а не только FPS
**Правило.** Работая над лентой, считай, сколько ячеек/хостинг-видов пересоздаётся при событии (реакция,
`checklist:updated`), а не только рывки (`ScrollJankMonitor`, `ScrollProbe`): событие одной карточки не перестраивает
соседние пузыри.
**Почему.** У Telegram счёт слоёв, пересозданных при неизменном элементе, с разбивкой по причине нашёл главные
источники лишней работы.
**Применимость.** Частично — такого счётчика у нас нет.
*Источник: R — «Churn»*

### 6.9 Неприменимо к нам
- Перевёрнутая лента: поворот ровно один раз (π на обёртке и в строке), hitTest и снимки — на обёртке
  (`docs/chat/corelist-chat-history-backend.md`, Rotation invariant) — наша лента не перевёрнута (`UICollectionView`
  сверху вниз, низ держится смещением). Если когда-нибудь перевернём — поворот в одном месте и пересмотр всех «верх/низ»
  (`topVisibleItem`, `bottomOffset`, плавающая дата).

---
## §7. Поле ввода и текст

Раздел про поле ввода сообщения (`Features/Chats/Thread/Composer/`), разметку Markdown и отрисовку текста в пузыре, статье и превью. Главная мысль: у текста одна модель (markdown-строка), одна функция на каждое решение (что уйдёт, как выглядит превью, как разбирается разметка) и одна типографика у поля и пузыря. Пути источников даны относительно `telegram-ios-rules/`.

### 7.1 Модель текста и путь к отправке

#### 7.1.1 Единственный носитель текста — markdown-строка `draft`
**Правило.** Поле ввода, полноэкранный редактор (`ComposerEditorView`), черновик в GRDB (`DraftRecord`), `PUT /chats/:id/draft`, исходящая очередь (`OutboxService`) и правка обмениваются только строкой `model.draft` с разметкой Markdown. Не храните и не передавайте `attributedText` поля. Не вводите второй «настоящий» формат в виде атрибутированной строки, которую потом надо синхронизировать с текстом. Форматирование — чистые функции над строкой и `NSRange` в UTF-16 (`ComposerFormatting.swift`), применяемые одной отменяемой заменой.
**Почему.** Telegram держит композер на модели-значении `ChatInputContent` и вытеснил `NSAttributedString` как носитель: форматирование, упоминания, черновик, правка и отложенная отправка конвертируются через общие кодеки, и два формата больше не расходятся.
**Сейчас у нас.** Соблюдено: «поле ввода остаётся простым текстом, и черновик, правка и сервер видят ровно то, что уйдёт» (`ComposerFormatting.swift:3-8`).
*Источник: `CLAUDE.md` (RichTextEditor editor & the ChatInputContent composer); `docs/richtext-composer.md` (§2 «`ChatInputContent` — the composer currency»)*

#### 7.1.2 На сервер уходит сырой текст из поля
**Правило.** Отправляйте исходный Markdown, набранный человеком. Нигде по пути (черновик, исходящая очередь, правка) не подменяйте его отрисованным или очищенным текстом.
**Почему.** У Telegram классификатор «простое/богатое сообщение» получает сырой ввод, а не уже преобразованный, иначе решение расходится с тем, что набрал человек.
**Сейчас у нас.** Соблюдено: `ComposerFormatting` правит строку, а не атрибуты.
*Источник: `docs/instantpage-richtext.md` (Markdown send, «The classifier is fed the RAW effectiveInputText.string»)*

#### 7.1.3 Отображение не попадает в модель
**Правило.** Если в поле появится подсветка разметки, ставьте атрибуты только в `textStorage` для показа. Никогда не стройте `draft` из `attributedText`. Цвет задавайте через `textColor` и динамический `UIColor(Palette.foreground)`, чтобы смена темы перекрашивала без пересборки.
**Почему.** У Telegram цвета темы, подставленный шрифт и подсветка синтаксиса существуют только в отрисовке и снимаются при чтении обратно. Иначе они грязнят модель: например, в тёмной теме в сообщение попадает чёрный текст.
**Сейчас у нас.** Соблюдено само собой: модель — строка.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` (The shared mapper); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Render-only attributes; Theme)*

#### 7.1.4 Писать в поле и в модель только при изменении
**Правило.** В `ComposerTextView.updateUIView` присваивайте `view.text` только при `view.text != text`, а в модель пишите только при `parent.text != view.text` (`Coordinator.pushText`). Сохраняйте обе проверки.
**Почему.** Telegram сравнивает состояние ввода по значению (сначала быстрый путь по выделению и тексту), и это убирает лишние перерисовки. Каждая лишняя запись `text` сбрасывает выделение и историю отмены и может оборвать IME-набор.
**Сейчас у нас.** Соблюдено (`ComposerTextView.swift:70`, `:134`).
*Источник: `docs/richtext-composer.md` (§2 «Load-bearing invariants», `ChatTextInputState.==`)*

#### 7.1.5 Если поле нормализовало текст — вернуть результат в модель
**Правило.** Когда появится нормализация (7.2.2, 7.2.3), после `view.text = text` сравните `view.text` с `text`. При расхождении асинхронно запишите нормализованную строку в `model.draft`. Нормализатор должен быть идемпотентным: повторный прогон не меняет строку. Иначе `updateUIView` и `pushText` зациклятся.
**Почему.** Редактор Telegram сообщает чату нормализованный результат на следующем витке, чтобы «Отправить» читало то, что показано. Цепочка «модель → поле → модель» обязана быть устойчивой.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` (Composer bridge and chat contracts, «A set is reported back whenever the read-back differs»); `docs/richtext-composer.md` (§4 «Code blocks»)*

#### 7.1.6 Что уйдёт при отправке, решает одна функция
**Правило.** Заведите одну чистую функцию «текст к отправке»: обрезка пробелов и удаление невидимых `U+200B…U+200D`, `U+2060`, `U+FEFF`, как `messageText()` в `packages/shared-schemas/src/chats.ts`. Вызывайте её из кнопки «Отправить», из самой отправки, из счётчика длины и из `StudentHubTests`. Копировать её логику в тест нельзя.
**Почему.** Маршрут отправки и разбиение текста у Telegram вынесены в общий модуль, который вызывают и чат, и оракул тестов. Копия логики в тесте проверяет саму себя.
**Сейчас у нас.** соблюдено (#499): что уйдёт на сервер, решает одна функция `OutgoingText`, она же снимает невидимые
символы.
*Источник: `docs/richtext-composer.md` (§5 «Send», `chatComposerSendRoute`/`chatComposerTextMessages`); `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` (Composer bridge and chat contracts)*

#### 7.1.7 Счётчик длины считает то, что уйдёт, и предупреждает до отправки
**Правило.** Введите в поле счётчик по функции из 7.1.6. Считайте в UTF-16 (`utf16.count`, как JS `length`), потому что сервер принимает до 4000 единиц после очистки (`messageText(max = 4000)`, `SaveDraftSchema`). Показывайте счётчик у края лимита и блокируйте «Отправить» сверх него. Текст молча не обрезайте. Разбиение на несколько сообщений — только по решению владельца.
**Почему.** У Telegram длина в панели — это длина того, что отправит текстовый маршрут, вместе с кодом и цитатами; длинное делится на части по 4096.
**Сейчас у нас.** соблюдено (#499): лимит 4000 (UTF-16, как `messageText`), счётчик у края лимита, «Отправить» неактивна
сверх него.
*Источник: `docs/richtext-composer.md` (§2, §5 «the panel's length counter counts what the text route sends»); `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` (Composer bridge…, `HarnessLengthCounterCodeBlockTests`)*

#### 7.1.8 Служебная разметка — одна пара функций «закодировать/распознать»
**Правило.** Служебные вставки в текст (упоминание `@login`, ссылки на внутренние объекты) кодируйте и распознавайте одной парой функций. Регулярное выражение упоминания (`RichText.mention`, `FeedComponents.swift:414`) не дублируйте в поле ввода и поиске.
**Почему.** У Telegram кодирование и разбор маркера кастомного эмодзи сведены в одну пару функций, чтобы стороны не разошлись.
*Источник: `docs/instantpage-richtext.md` (Custom emoji in markdown messages, «One shared marker, one set of helpers»)*

#### 7.1.9 Ключи из пользовательского текста нормализует одна функция — на записи и на чтении
**Правило.** Строковые ключи кешей и словарей, взятые из пользовательского текста (язык блока кода, ключевые слова `EmojiKeywords`, хэштеги, поиск), нормализуйте одной функцией и при записи, и при чтении.
**Почему.** У Telegram `"Swift"` не находил грамматику (`"swift"` давал 3 сущности, `"Swift"` — 0): запись и чтение кеша нормализовали по-разному, и каждый промах был молчаливым.
*Источник: `docs/instantpage-richtext.md` (Syntax highlighting, «Extraction and application must normalize the language the same way»)*

### 7.2 Двери ввода: вставка, нормализация, программные вставки

#### 7.2.1 Каждая дверь ввода проходит один шлюз
**Правило.** Нормализацию, лимит длины и продолжение маркеров делайте в одном месте — `textView(_:shouldChangeTextIn:replacementText:)`. Его проходят набор, вставка, диктовка и перетаскивание. Второе место — путь внешней установки в `updateUIView`. Не размазывайте эту логику по `paste(_:)` и кнопкам.
**Почему.** У Telegram набор, вставка, marked text, диктовка и сброс перетаскиванием идут через один шлюз решений; новая дверь подключается к нему, а не получает свою копию правил.
**Сейчас у нас.** соблюдено (#499): `shouldChangeTextIn` в `ComposerTextView` — единый шлюз ввода.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (Keystrokes are decided at the surface gate)*

#### 7.2.2 Один нормализатор переводов строк на всех входах
**Правило.** Заведите одну функцию, которая превращает CRLF, CR, `U+2028`, `U+2029` и NEL в `\n`. `U+2028` у нас тоже перевод: в Markdown это обычный перенос. Зовите её при вставке (через шлюз 7.2.1), при внешней установке текста (черновик с сервера, правка) и перед отправкой. Нормализация может укоротить строку — позиции курсора после неё пересчитывайте.
**Почему.** Telegram нормализует переводы строк на каждой двери в редактор и пересчитывает длину после нормализации.
**Сейчас у нас.** соблюдено (#499): шлюз ввода, внешняя установка текста и отправка нормализуют CRLF, CR, U+2028/2029 и
NEL.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` (Core model, «One line-break normaliser»); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (Clipboard and drag)*

#### 7.2.3 В тексте не бывает символа-заглушки `U+FFFC`
**Правило.** Удаляйте `U+FFFC` в той же нормализации, что и переводы строк (7.2.2).
**Почему.** У Telegram голый `U+FFFC` не попадает ни в сеть, ни в буфер: вставка сводится к тому, что несёт модель, без вложений и чужих цветов.
**Сейчас у нас.** соблюдено (#499): `U+FFFC` снимается в шлюзе ввода и перед отправкой.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` (Fragments, paste and RTF); `docs/richtext-composer.md` (§4); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (Clipboard and drag)*

#### 7.2.4 Поиск перевода строки — литеральный
**Правило.** В `ComposerFormat`, `ComposerList` и будущем нормализаторе ищите `\n` через `components(separatedBy:)`, через `NSString` с `.literal` или по `utf16`. `replacingOccurrences(of: "\n", …)` — только с `options: .literal`.
**Почему.** Перевод строки перед комбинирующим знаком образует одну составную последовательность, и поиск без `.literal` его не находит.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (Typing attributes…, «Every structural "\n" search is LITERAL»)*

#### 7.2.5 Однострочные значения ссылки не держат переводов строк; разметка экранируется
**Правило.** Адрес и подпись в `[подпись](адрес)` — однострочные значения. Схлопывайте в них переводы строк в один пробел. В подписи экранируйте `[` и `]`, в адресе кодируйте пробелы и `)` (`%20`, `%29`).
**Почему.** В однострочных полях Telegram (язык кода, автор, заголовок) любой пробельный отрезок с переводом строки становится одним пробелом на каждой двери, иначе блок раскалывается. У нас иначе ломается Markdown в пузыре и на вебе.
**Сейчас у нас.** соблюдено (#499): подпись и адрес ссылки однострочные, `[ ]` экранируются, пробел и скобки в адресе
кодируются.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (One-line fields hold no line break of any kind, on every door)*

#### 7.2.6 Вставка из чужого приложения — только текст, одинаково во всех полях
**Правило.** Держите `allowsEditingTextAttributes = false` (по умолчанию) у поля и у полноэкранного редактора: оба вставляют только текст, одинаково. Не включайте `allowsEditingTextAttributes`.
**Почему.** У Telegram интервалы между абзацами в RTF не превращаются в пустые строки, и все редакторы вставляют одно и то же одинаково.
**Сейчас у нас.** Соблюдено.
*Источник: `docs/richtext-composer.md` (§7 «RTF paste: paragraph spacing is not a blank line»)*

#### 7.2.7 Картинка из буфера — в лист вложений; буфер не читать без «Вставить»
**Правило.** Вставку без текстового представления отдавайте листу вложений (`ComposerUITextView.paste` → `onPasteImages`). Пункт «Вставить» показывайте по `UIPasteboard.general.hasImages`, который не читает данные. Не добавляйте чтение `UIPasteboard.general.string/images` вне `paste(_:)`.
**Почему.** У Telegram медиа из буфера уходит хосту. Чтение буфера вне явной вставки вызывает системный запрос разрешения.
**Сейчас у нас.** Соблюдено (`ComposerTextView.swift:197-213`).
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Copy and paste, `canPasteMedia`); `Tests/ComposerHarness/CLAUDE.md` (Never read the clipboard before writing it)*

#### 7.2.8 Порядок обработчиков вставки: общий не глотает частный
**Правило.** Сейчас в `ComposerUITextView` картинки уходят в лист вложений, всё остальное вставляется как есть. Новые обработчики вставки ставьте так, чтобы общий не проглатывал частный и наоборот. На каждый обработчик — тест.
**Почему.** У Telegram частный обработчик (эмодзи) захватывал вставку раньше структурного разбора Markdown, и заголовки терялись.
**Применимость.** Частично: разбора Markdown при вставке у нас нет.
*Источник: `docs/instantpage-richtext.md` (Custom emoji in markdown messages, «The emoji reattach must NOT outrank STRUCTURAL markdown-on-paste»)*

#### 7.2.9 Преобразующая вставка — две ступени отмены
**Правило.** Если появится автопреобразование при вставке (автосписки, превращение ссылки, очистка форматирования), сначала вставляйте текст как есть, а преобразование делайте отдельной ступенью отмены на следующем витке (`DispatchQueue.main.async`). Тогда ⌘Z и встряхивание вернут исходный текст.
**Почему.** Telegram кладёт сырой markdown и заменяет его преобразованным на следующем витке run loop: иначе `groupsByEvent` склеивает обе регистрации в одну ступень. Промежуточное состояние при этом не рисуется.
**Применимость.** Частично: сейчас вставка ничего не преобразует, правило на будущее.
*Источник: `docs/richtext-composer.md` (§7 «Two-step undo»); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Copy and paste)*

#### 7.2.10 Вставка «от имени пользователя» идёт через поле как ввод
**Правило.** Emoji с панели, упоминание, шаблон — через `insertText` или `replace(_:withText:)` поля (`ComposerTextController.insert/deleteBackward`). Не через `model.draft = …`. Запасной путь `model.draft += emoji` допустим только когда поля действительно нет (`hasView == false`).
**Почему.** У Telegram emoji-клавиатура и «Упомянуть» вставляют командой редактора: это равно набору — одна ступень отмены, одно `onChange`, без пересборки всей строки.
**Сейчас у нас.** Соблюдено.
*Источник: `docs/richtext-composer.md` (§4 «Custom emoji / mention / date»); `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` (Composer bridge…); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (Host integration)*

#### 7.2.11 После программной вставки курсор — за вставленным
**Правило.** После вставок (emoji, шаблоны, упоминания) курсор ставьте за вставленным. Команды форматирования, наоборот, выделяют содержимое внутри маркеров: так задумано, чтобы сразу печатать. `toggleList` держит курсор на месте в строке — сохраняйте это.
**Почему.** У Telegram после вставки курсор встаёт за последним вставленным; если вставка кончилась не текстом, в конце документа добавляется строка для курсора.
**Сейчас у нас.** Соблюдено.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (The caret goes after everything inserted)*

#### 7.2.12 Коды подтверждения нормализуются перед проверкой
**Правило.** Код 2FA (`OneTimeCodeField`, `LoginModel.verifyTwoFactor`) и коды QR и кабинетов перед отправкой приводите к ASCII-цифрам (полноширинные и арабские цифры с клавиатуры) и обрезайте пробелы. Буквенный резервный код приводите к NFC. Новых ограничений на ввод не вводите.
**Почему.** Telegram приводит цифры любых письменностей с однозначным `wholeNumberValue` к ASCII, а буквенные коды — к канонической композиции.
**Сейчас у нас.** Расходится: `LoginModel.swift:81` только обрезает пробелы, цифры не приводит. Проверить на iPhone с казахской и арабской раскладками.
*Источник: `docs/passcode.md` («Numeric normalization maps characters with a single-digit `wholeNumberValue`…»)*

### 7.3 Отмена, фокус и IME

#### 7.3.1 У поля своя история отмены; её очищает только внешняя установка текста
**Правило.** Внешняя установка текста (очистка после отправки, черновик с другого устройства, правка) вызывает `undoManager?.removeAllActions()`. Больше историю ничто не очищает. Кнопки «Отменить/Повторить» обновляйте по уведомлениям менеджера, а не внутри `undo()`. У поля панели и у полноэкранного редактора должны быть разные `undoManager`. Если окажется, что менеджер общий, переопределите `undoManager` в `ComposerUITextView` своим экземпляром.
**Почему.** У редактора Telegram свой `UndoManager`, и чужие регистрации не попадают в `canUndo`. Правка от имени пользователя — одна ступень. `canUndo` внутри `undo()` устаревший.
**Сейчас у нас.** Соблюдено: очистка при внешней установке (`ComposerTextView.swift:74`), обновление по уведомлениям (`:252-258`). Проверить на iPhone: `UITextView` по умолчанию берёт менеджер из цепочки ответчиков, а оба поля живут в одном окне.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Undo); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (Undo); `Tests/ComposerHarness/CLAUDE.md` (External content sets)*

#### 7.3.2 Ступени отмены: набор склеивается, каждая команда — одна ступень
**Правило.** Склейку набора оставьте `UITextView`. Каждая команда (`apply`, `toggleList`) — одна замена `replace(_:withText:)`, то есть одна ступень. Новую команду тоже делайте одной заменой, а не серией `insertText`.
**Почему.** У Telegram набор склеивается в «прогон», который рвётся на перемещении курсора, вставке и форматировании. Отмена содержимого возвращает курсор, отмена форматирования — выделение.
**Сейчас у нас.** Соблюдено.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Undo); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (The editor owns its undo stack)*

#### 7.3.3 Во время IME-составления текст поля не трогать, но внешнюю установку не терять
**Правило.** Пока `markedTextRange != nil`, внешнюю установку в `updateUIView` не применяйте. Если установка важна (очистка после «Отправить»), отложите её до конца составления, а не отбрасывайте. Смена ширины (`onWidthChange`) и переключение `isScrollEnabled` не должны прерывать составление.
**Почему.** Для Telegram составление — это набор: удаление выделения и составление — одна ступень. Отложенная установка документа посреди составления у них записана как известная опасность. Перерасчёт по ширине ронял составление.
**Сейчас у нас.** Расходится, проверить на iPhone японской клавиатурой: `updateUIView` пропускает установку при marked text (`ComposerTextView.swift:70`), но пропущенное значение потом перетирается — по окончании составления `textViewDidChange` пишет `view.text` обратно в `draft`.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (IME compositions are typing); `docs/superpowers/richtext-seam-stage2-inheritance.md` (D38, D39)*

#### 7.3.4 Отмена посреди IME-составления сбрасывает составление
**Правило.** Проверьте кнопки «Отменить/Повторить» полноэкранного редактора (`ComposerTextController.undo/redo`) посреди японского или китайского составления. При сбоях перед `undo()` вызывайте `unmarkText()`.
**Почему.** ⌘Z или встряхивание посреди составления должны очищать его состояние. В системном поле незавершённое составление — своя ступень отмены, в редакторе Telegram — нет, и это расхождение записано.
**Сейчас у нас.** Проверить на iPhone.
*Источник: `docs/superpowers/richtext-seam-stage2-inheritance.md` (D39); `docs/superpowers/richtext-stock-divergences-followups.md` (§3)*

#### 7.3.5 `onChange` — ровно один раз на правку
**Правило.** Не зовите `onChange?()` вручную после `insertText`/`replace`, если `UITextView` сам пришлёт `textViewDidChange`. Прежде чем обернуть метод, посмотрите, не шлёт ли он уведомление сам.
**Почему.** Хост Telegram раскладывается на каждом `onChange`, поэтому дубль — лишний проход. Обёртка вокруг метода, который сам шлёт уведомления, удваивает их.
**Сейчас у нас.** соблюдено (#499): `onChange` досылается, только если `UITextView` не прислал `textViewDidChange`.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (Host integration, «`onChange` fires exactly once per edit»); `docs/superpowers/richtext-seam-stage2-inheritance.md` (D35)*

#### 7.3.6 Фокус меняется только на настоящем переходе
**Правило.** Вызывайте `becomeFirstResponder` только при `!view.isFirstResponder` (в `updateUIView` и `didMoveToWindow`). Меняйте `isFocused` в `textViewDidBegin/EndEditing` только при отличии значения. Касание, давшее фокус, только ставит курсор и не показывает меню.
**Почему.** У Telegram флаг «только что стал первым ответчиком» ставится только при настоящем переходе. Повторный `becomeFirstResponder` (фокус по касанию вниз) его не трогает, иначе о переходе сообщается дважды.
**Сейчас у нас.** Соблюдено (`ComposerTextView.swift:84-94`, `:146`, `:150`, `:180`).
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Gestures); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (Host integration, «Focus is the ENGINE's transition»); `docs/superpowers/richtext-seam-stage2-inheritance.md` (D27)*

#### 7.3.7 Поле, убираемое из формы, сначала теряет фокус
**Правило.** В SwiftUI-формах (редактор статьи в `CommunityArticlesViews.swift`, опрос `PollForm` в `ChatPollCreatorView.swift`, `ChecklistComposerView`) перед удалением поля сбрасывайте `@FocusState`.
**Почему.** У Telegram удаление поля в фокусе вызывало повторный вход в обновление и падение.
*Источник: `docs/instantpage-richtext.md` (Inline buttons, Authoring, «A payload field must not be focused when an update removes it»)*

#### 7.3.8 Язык клавиатуры запоминается с черновиком
**Правило.** Если будем делать: язык храните локально рядом с `DraftRecord` (на сервер без решения владельца не отправлять). Предвыбирайте его разовым переопределением `textInputMode` в `ComposerUITextView`: верните режим с нужным `primaryLanguage` из `UITextInputMode.activeInputModes` один раз до `becomeFirstResponder`. Читайте `textInputMode?.primaryLanguage` только у первого ответчика.
**Почему.** Поле Telegram сообщает основной язык клавиатуры (для поиска emoji и черновика) и предвыбирает его при открытии черновика. Прочитанный до фокуса язык «съедает» разовое переопределение.
**Применимость.** Частично: это возможность, а не обязательство.
*Источник: `docs/richtext-composer.md` (§3 «Keyboard input language»); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Keyboard language, custom input, emoji views)*

#### 7.3.9 Направление письма — автоматически по содержимому, как в пузыре
**Правило.** Не задавайте полю `textAlignment` жёстко `.left`/`.right` и не ставьте ему `semanticContentAttribute`: оставьте `.natural`, тогда `UITextView` ведёт себя как системный. Пузырь (`RichText` в `Feed/FeedComponents.swift`) должен выравнивать абзац так же. При правке проверьте строку на арабском или иврите и в поле, и в пузыре.
**Почему.** У Telegram направление абзаца определяется по первому сильному символу — тем же правилом, что в отправленном пузыре. Курсор пустого поля следует языку клавиатуры, ручного переключателя нет.
**Применимость.** Частично: ru/kk пишутся слева направо, но чужой текст в сообщениях бывает.
*Источник: `docs/richtext-composer.md` (§3 «Writing direction (RTL)»); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (RTL / writing direction)*

### 7.4 Форматирование в поле

#### 7.4.1 «Форматирование» — подменю системного меню правки, только при непустом выделении
**Правило.** Пункты форматирования добавляйте в `Coordinator.textView(_:editMenuForTextIn:suggestedActions:)` через `formatMenu()` и только при `range.length > 0`. Значки — слева. Ссылку запрашивайте диалогом (`askLink`). Отдельную панель поверх выделения не заводите.
**Почему.** У Telegram подменю Format вклеено в системное меню правки только для непустого выделения, а «Ссылка» идёт через диалог хоста.
**Сейчас у нас.** Соблюдено (`ComposerTextView.swift:154-163`).
*Источник: `docs/richtext-composer.md` (§4 «Formatting menu»); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (`composerSelectedRange` and the edit-menu hook)*

#### 7.4.2 Правки по выделению расширять до границ составных символов
**Правило.** Перед `format.apply` прогоняйте выделение через `(text as NSString).rangeOfComposedCharacterSequences(for: range)`. Все диапазоны — в UTF-16 (`NSRange`), не в `Character.count`. Маркеры `ComposerFormat` — ASCII, там это безопасно.
**Почему.** Команды Telegram над выделением сначала расширяют диапазон до границ графем, иначе половина суррогатной пары остаётся мусорным кодом.
**Сейчас у нас.** соблюдено (#499): выделение расширяется до границ составных символов перед форматированием.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Grapheme safety; Left/right arrow navigation…); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (Typing attributes…, «Inline format ranges widen to composed characters»)*

#### 7.4.3 Внутри кода — без форматирования и автокоррекции
**Правило.** Когда выделение внутри ```` ``` ```` или `` ` ``, отключайте пункты «Форматирования», кроме «Блок кода». «Ссылку» не применяйте к моноширинному, моноширинный — к ссылке. При курсоре внутри блока кода выключайте автокоррекцию: `autocorrectionType = .no` и `reloadInputViews()`, потому что система кеширует эти признаки.
**Почему.** У Telegram в коде нет автокоррекции и проверки орфографии, встроенные форматы в коде не применяются и отключены в меню, а моноширинный поверх ссылки и ссылка поверх кода ничего не делают.
**Сейчас у нас.** соблюдено (#499): внутри кода доступен только «Блок кода», автокоррекция, орфография и умные кавычки в
коде выключены.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Code blocks and the language line); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (A code block is plain text; Inline exclusions)*

#### 7.4.4 Ссылка, текст которой и есть адрес, — не ссылка
**Правило.** При пустом выделении «Ссылка» вставляет голый адрес. При выделении, равном адресу (с допусками на схему, конечный `/` и процент-кодирование), — тоже голый адрес. Вставка из буфера — всегда простой текст.
**Почему.** Telegram превращает такие ссылки в обычный текст: голый URL получатель распознаёт сам.
**Сейчас у нас.** соблюдено (#499): ссылка без выделения или с подписью, равной адресу, вставляется голым адресом.
*Источник: `docs/richtext-composer.md` (§7 «Self-referential links are stripped»); `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` (RTF import, `strippingSelfReferentialLinks`)*

#### 7.4.5 Никогда не давать `[](url)`
**Правило.** `ComposerFormat.link` не должен давать ссылку с пустой подписью: подставляйте адрес (с учётом 7.4.4 — голый адрес) или плейсхолдер текста.
**Почему.** CommonMark выбрасывает `[](url)` целиком; Telegram заменяет пустую подпись пробелом.
**Сейчас у нас.** Соблюдено: подпись при пустом выделении равна адресу (`ComposerFormatting.swift:62`), а `askLink` не пропускает пустой адрес.
*Источник: `docs/instantpage-richtext.md` (Custom emoji in markdown messages, «Empty alt → a space»)*

#### 7.4.6 Многострочная цитата — один блок, пустая строка внутри остаётся цитатой
**Правило.** `ComposerFormat.quote` префиксует каждую строку `"> "`, включая пустые. Не «оптимизируйте» пустые строки в голое `""` — это рвёт цитату на две в вебе и в пузыре. Две разные цитаты разделяет строка вне цитаты. Снятие цитаты должно узнавать и строку `">"` без пробела.
**Почему.** У Telegram разрезание цитаты по `\n` давало на экране N отдельных цитат: многострочная цитата обязана быть непрерывным блоком.
**Сейчас у нас.** соблюдено (#499): снятие цитаты узнаёт строку `">"` без пробела.
*Источник: `docs/richtext-composer.md` (§2 «Contiguity is load-bearing for quotes»)*

#### 7.4.7 Одиночный перевод строки — перевод строки везде
**Правило.** Любой рендер разметки обязан сохранять одиночный `\n` как перевод строки, а не как мягкий перенос CommonMark. Это касается Android, превью и уведомлений. Сверяйте один и тот же текст на трёх клиентах.
**Почему.** У Telegram ответ ChatGPT, разобранный по CommonMark, склеивался в одну строку. Теперь `\n` — перевод, пустая строка между блоками — пустой абзац.
**Сейчас у нас.** Соблюдено на iOS (`inlineOnlyPreservingWhitespace`, `FeedComponents.swift:400`) и на вебе (`whitespace-pre-wrap`, `br: () => null` в `apps/web/src/entities/chat/ui/message-content-markdown.tsx:44-50`).
*Источник: `docs/richtext-composer.md` (§7 «Line breaks are read as written»)*

#### 7.4.8 Маркеры списков продолжаются по Return
**Правило.** Если делать: в `textView(_:shouldChangeTextIn:replacementText:)` Return в строке с маркером (`ComposerList.marker`) вставляет `\n` и следующий маркер, Return на пустом пункте удаляет маркер, Backspace в начале пункта снимает маркер. Всё одной ступенью отмены и не во время marked text.
**Почему.** У Telegram Return в пункте открывает следующий пункт, на пустом — выходит из списка, а двойной Return выходит из цитаты.
**Сейчас у нас.** `ComposerList` ставит `- `/`N. ` только кнопкой, Return пишет голый `\n`.
**Применимость.** Частично: это улучшение поведения.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Lists and checklists; Quotes); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (Return and Backspace at a block's start)*

#### 7.4.9 Горячие клавиши форматирования вызывают команды поля
**Правило.** При поддержке аппаратной клавиатуры заведите `keyCommands` в `ComposerUITextView`: ⌘B, ⌘I, ⇧⌘X (зачёркнутый), ⌘K (ссылка), ⇧⌘M (моноширинный). Все они вызывают `ComposerTextController.apply(_:)`, названия (`discoverabilityTitle`) — из каталога строк.
**Почему.** У Telegram ⌘B и прочие выполняют команды редактора (⇧⌘N снимает форматирование), а не пересобирают строку.
**Применимость.** Частично: по желанию, аппаратных сочетаний у нас нет.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` (Composer bridge…, «The chat's ⌘B & co. run the engine editor's own commands»)*

#### 7.4.10 Подсветка в поле — с задержкой, не на выделении и не во время составления
**Правило.** Если появится подсветка разметки в поле, красьте примерно через 300 мс после правки, а не на каждое изменение выделения. Пропускайте проход при `markedTextRange != nil`. Меняйте только атрибуты в `textStorage` внутри `beginEditing/endEditing`.
**Почему.** Подсветка кода у Telegram идёт по задержке после правки, с кешем и только при смене. Перекраска пересоздаёт хранилище и рвёт IME, поэтому безопасна лишь вне marked text.
**Применимость.** Частично: подсветки нет, правило на будущее.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Code syntax highlighting is a host seam)*

#### 7.4.11 Справа в поле — место только под видимые кнопки
**Правило.** Правый отступ поля в `MessageComposerView` считайте из видимых кнопок (`expandsInline`, часы отложенных, emoji). Новую кнопку внутри поля добавляйте в эту формулу, а не постоянным отступом.
**Почему.** У Telegram отступ резервирует место под кнопку отправки, только когда она показана; иначе пустое поле лишне сужено.
**Сейчас у нас.** Соблюдено (`MessageComposerView.swift:127`).
*Источник: `docs/richtext-composer.md` (§3 «Empty-input right inset»)*

### 7.5 Типографика и размер текста

#### 7.5.1 Масштаб текста — только Dynamic Type, применённый один раз
**Правило.** Весь текст пузыря и статьи масштабируйте только текстовыми стилями (`Typography.body`, `.caption2`, `UIFont.preferredFont(forTextStyle:)`). Не умножайте уже динамический шрифт ещё раз: никакого `UIFontMetrics.scaledValue` поверх `preferredFont` и `.dynamicTypeSize` поверх масштабированного размера. Не задавайте фиксированные `size:` в пузыре. Зависящие от шрифта отступы берите из `@ScaledMetric` один раз.
**Почему.** У Telegram размер текста пузыря выводится из одного коэффициента `contentScale` и округляется в двух точках: шрифты — до целых пунктов, геометрия — к пиксельной сетке. Ниже по цепочке на него никто не умножает: совпадение при двойном округлении — «везение, а не свойство».
*Источник: `docs/instantpage-richtext.md` (Text Size / content scale, «One scale, applied once»); `submodules/InstantPageUI/CLAUDE.md` (Text Size)*

#### 7.5.2 Поле, плейсхолдер и пузырь — один текстовый стиль
**Правило.** Шрифт, межстрочный интервал, отступы цитаты и блока кода в `ComposerTextView`/`ComposerEditorView` и в пузыре (`MessageBubbleView`, `MessageCodeBlocks.swift`) берите из одних токенов `DesignSystem/Typography`, а не дублируйте числа. Поле (`preferredFont(.body)` с `adjustsFontForContentSizeCategory`), плейсхолдер (`Typography.body`) и пузырь держите одним стилем. При правке шрифта сравните поле и отправленный пузырь глазами на устройстве.
**Почему.** У Telegram оба редактора раскладывают текст пиксель в пиксель как отправленный пузырь, по общим метрикам. Из 14 мест, где читался размер шрифта поля, 8 были прибиты к 17 pt: набранный текст масштабировался, а плейсхолдер — нет.
**Применимость.** Частично: полного WYSIWYG у нас нет по решению — маркеры Markdown в поле видны намеренно. Принцип общих метрик переносится.
*Источник: `CLAUDE.md` (RichTextEditor…, `RichTextRenderMetrics`); `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` (Layout: the InstantPage V2 metrics contract; Known gaps); `docs/instantpage-richtext.md` (Text Size, «Not scaled, on purpose»; «The LEGACY composer follows Text Size everywhere»)*

#### 7.5.3 Минимальная высота пустого поля — из `lineHeight` того же шрифта
**Правило.** Минимальную высоту поля и отступы выводите из `font.lineHeight` того же шрифта, а не константой. При смене категории шрифта пересчитывайте. Ветвления по `ContentSizeCategory` пишите без `default:`, чтобы новая ступень не компилировалась молча.
**Почему.** У Telegram минимальная высота не масштабировалась, и пустое поле «доезжало» анимацией до нужной высоты. Чтения размера сведены в функции, `switch` по размерам исчерпывающий, тест сверяет минимальную высоту с замеренной высотой пустого поля на каждой ступени.
**Сейчас у нас.** Соблюдено: поле читает `font.lineHeight` (`ComposerTextView.swift:101`).
*Источник: `docs/instantpage-richtext.md` (Text Size, «The LEGACY composer follows Text Size everywhere»)*

#### 7.5.4 Высоты текста округлять вверх
**Правило.** Высоту поля округляйте `ceil` — не убирайте его из `ComposerTextView.sizeThatFits`.
**Почему.** У Telegram `ceil` высоты обязателен: дробная высота сдвигает всё, что ниже.
**Сейчас у нас.** Соблюдено (`ComposerTextView.swift:102`, `:107`, `:116`).
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` (Layout: the InstantPage V2 metrics contract)*

#### 7.5.5 Число строк нельзя считать как высота строки × N
**Правило.** При доработке берите число строк из раскладки (`layoutManager` или фрагменты строк TextKit 2), а не делением высоты на `font.lineHeight`. Лимит высоты поля — тоже. Проверьте счёт на строке из emoji и на арабском.
**Почему.** Подставленные шрифты (арабский, тайский, корейский) и emoji добавляют интерлиньяж, и строка выходит выше. У Telegram это открытый долг, закреплённый тестом.
**Сейчас у нас.** Расходится, проверить на iPhone: `ComposerTextController.measure` считает `lineCount` делением (`ComposerTextView.swift:335`), `sizeThatFits` — лимит как `lineHeight × maxLines` (`:107`). Счёт и порог «кнопка ⛶ с трёх строк» могут ошибаться.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` (Layout…, «A substituted face's LEADING is not clamped», emoji overhang)*

#### 7.5.6 Своя оценка высоты текста — по полной высоте строки шрифта
**Правило.** `MessageHeightEstimate` берёт `UIFont.lineHeight` — не подменяйте его на `pointSize` или `capHeight`. Округляйте только итоговую высоту (`.rounded(.up)`), а не промежуточные значения.
**Почему.** У Telegram элемент текста получил высоту `ascent + descent` вместо урезанной коробки. Внутренние смещения не округляются к пикселю, чёткость держит округлённый кадр элемента.
**Сейчас у нас.** Соблюдено (`MessageListView.swift:709`, `MessageStackGeometry.swift:98`).
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 text item height)*

#### 7.5.7 Сравнивать метрики одной природы
**Правило.** В расчётах высот не смешивайте `lineHeight`, `ascender`, `capHeight` и `pointSize`.
**Почему.** У Telegram сравнение полного подъёма шрифта с урезанной коробкой строки раздувало каждую строку примерно на 4 pt.
*Источник: `docs/instantpage-richtext.md` (Inline buttons, «Line-height inflation: never compare attachment.ascent against lineAscent directly»)*

#### 7.5.8 Код, цитата и тело держат постоянную ступень друг к другу
**Правило.** Код в пузыре (`MessageCodeBlockView`: `.system(.subheadline, design: .monospaced)`) и в статье (`.footnote`) — текстовые стили, они масштабируются вместе с телом. Новые блоки (цитату, таблицу) задавайте тоже текстовым стилем, а не размером. Проверяйте снимком в крупном шрифте: ступень между телом и кодом не должна «съезжать».
**Почему.** У Telegram код, таблица и тело цитаты стоят «на ступень ниже тела» и обязаны совпадать на каждом шаге размера, в том числе внутри цитаты.
**Сейчас у нас.** Соблюдено: матрица снимков включает `.accessibilityExtraLarge` (`Tests/StudentHubSnapshotTests/SnapshotTestCase.swift:50`).
*Источник: `docs/instantpage-richtext.md` (Text Size, «Code = table = quote body»)*

#### 7.5.9 Множитель не восстанавливать из округлённого размера
**Правило.** Не выводите коэффициенты обратно из `pointSize` уже масштабированного шрифта (например, «во сколько раз тело больше 17»). Нужен размер заголовка — берите его текстовый стиль (`.title3`, `.headline`), как `CommunityMarkdownView.blockView`.
**Почему.** У Telegram восстановление множителя из уже округлённого размера сдвигало заголовок H2 на пункт; правильно хранить множитель.
*Источник: `docs/instantpage-richtext.md` (Text Size, «The theme's stored fontSizeMultiplier»)*

#### 7.5.10 Защита от двойного масштабирования — `assert`
**Правило.** Если появится своя функция раскладки текста, принимающая и шрифт, и коэффициент масштаба, ставьте `assert` против случая, когда переданы оба сразу.
**Почему.** Раскладка Telegram падает на `assert`, если ей дали уже масштабированную тему и коэффициент.
**Применимость.** Частично: своей текстовой раскладки нет, масштабирует SwiftUI; правило на будущее.
*Источник: `docs/instantpage-richtext.md` (Text Size, «layoutInstantPageV2 asserts»)*

#### 7.5.11 Смена размера текста требует перераскладки
**Правило.** Смена категории шрифта должна инвалидировать раскладку ленты (ключ кеша высот уже содержит шрифт) и перерисовывать UIKit-части.
**Почему.** У Telegram смена Text Size сама по себе — смена темы, которая заново раскладывает виджет.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` (The master sheet ends in the renderer's UA layer)*

#### 7.5.12 Одна таблица стилей на пузырь, предпросмотр и редактор
**Правило.** Стили тела, кода и заголовков пузыря и статьи держите в `DesignSystem/Typography`, а не литералами в видах.
**Почему.** У Telegram три копии таблицы стилей разошлись, и предпросмотр отправки перестал совпадать с пузырём. Их свели в общую таблицу; победили значения пузыря, потому что его видит получатель. Тесты паритета вызывают функции рендерера.
**Сейчас у нас.** соблюдено (#499): стили кода, подписи языка и заголовков статьи — токены `Typography`.
*Источник: `docs/instantpage-richtext.md` (The chat-message text categories, and editor layout parity)*

#### 7.5.13 Правка общего стиля двигает и редактор — снимать обе стороны
**Правило.** Правка `CommunityMarkdownView` меняет и читателя статьи, и предпросмотр в редакторе: проверяйте снимками обе поверхности.
**Почему.** У Telegram связь редактора с рендерером и есть смысл общей таблицы: поменял значение — жди сдвига в обоих.
*Источник: `docs/instantpage-richtext.md` (The chat-message text categories, «Do not change a value in chatMessage without expecting the editor to move with it»)*

#### 7.5.14 Предпросмотр рисуется тем же видом и теми же размерами, что и результат
**Правило.** Предпросмотр статьи рисуйте тем же `CommunityMarkdownView`, что и читатель (`CommunityArticlesViews.swift:1202`). Отдельный «упрощённый» вид не заводите. Предпросмотр вложения перед отправкой — теми же видами и размерами, что и отправленное. Неактивные элементы оставляйте на месте, но неактивными.
**Почему.** У Telegram одна палитра и одна раскладка в редакторе и в сообщении, чтобы редактор оставался WYSIWYG. Кнопка рисуется и там, где тап инертен, — иначе ширина плашки в предпросмотре отличалась бы.
**Сейчас у нас.** Соблюдено для статьи.
*Источник: `docs/instantpage-richtext.md` (Syntax highlighting, «The palette is libprisma's LIGHT one everywhere»; Unsupported blocks, «The Update button is always rendered»)*

#### 7.5.15 Две поверхности с разной настройкой не объединять «для порядка»
**Правило.** Стили статьи (`CommunityMarkdownView`: межстрочный 4, крупные заголовки) и пузыря чата разные намеренно. Не сводите их к одному набору без снимков обеих поверхностей.
**Почему.** У Telegram объединение интервалов читателя и пузыря сломало ритм читателя. Теперь тест закрепляет константы и то, что функции различаются.
*Источник: `docs/instantpage-richtext.md` (BlockQuote nested blocks, «V1 and V2 have SEPARATE spacing functions, and must keep them»)*

#### 7.5.16 Интервал между блоками — одно место настройки на поверхность
**Правило.** Интервалы блоков в `CommunityMarkdownView` и `MessageCodeText` берите из токенов `Spacing`, с одним местом настройки на каждую поверхность.
**Почему.** У Telegram интервал — одна база плюс отступ вида, настраиваемые в одном месте; два абзаца подряд идут без зазора, вложенные блоки получают свой фиксированный отступ.
*Источник: `docs/instantpage-richtext.md` (BlockQuote nested blocks, «Block spacing (V2) is one base gap plus a per-type padding», «Nested children use a FIXED 10pt»)*

### 7.6 Разбор и отрисовка сообщения

#### 7.6.1 Поддерживаемый Markdown — один контракт для веба и приложений
**Правило.** Запишите в `docs/PROJECT.md`, какой Markdown — контракт сообщения, и держите iOS и Android в нём, либо явно перечислите, что приложение показывает «как есть».
**Почему.** У Telegram граница «простое/богатое» и список триггеров записаны явно: что отправлено как структура, то и нарисовано.
**Сейчас у нас.** Решение владельца: веб рисует сообщение полным GFM (заголовки, списки, таблицы, формулы — `message-content-markdown.tsx`), iOS-пузырь — только строчную разметку (`.inlineOnlyPreservingWhitespace`). Таблица, отправленная с веба, на iPhone видна сырыми `|`.
*Источник: `docs/instantpage-richtext.md` (Markdown send, «Boundary rule»)*

#### 7.6.2 Один разборщик на каждый синтаксис; классификатор зовёт настоящий разбор
**Правило.** Решение «есть ли разметка» принимает тот же разборщик, что рисует. Дешёвый предфильтр может давать лишний разбор, но не должен пропускать. Образец — `MessageCodeBlocks.segments(ifAny:)`: предфильтр `contains("```")`, затем настоящий разбор. Новый синтаксис вводите одним разборщиком на все места.
**Почему.** У Telegram «что включает богатый режим» решает тот же разборщик, что рисует, поэтому решение не расходится с отрисовкой.
**Сейчас у нас.** соблюдено (#499): статья делит код через `MessageCodeBlocks`, как пузырь.
*Источник: `docs/instantpage-richtext.md` (Markdown send, «Approach A (parse-then-inspect)»)*

#### 7.6.3 Смена семантики разбора — записанное изменение поведения
**Правило.** Изменения разборщика, меняющие вид уже отправленных сообщений, отмечайте в описании PR и проверяйте на реальных старых сообщениях.
**Почему.** У Telegram `> p1\n>\n> p2` стал одной цитатой вместо двух, и это записано как изменение поведения.
*Источник: `docs/instantpage-richtext.md` (BlockQuote nested blocks, «Behavior change»)*

#### 7.6.4 Связанные пары меняются только вместе
**Правило.** На связанные пары — разбор Markdown и отрисовка, `MessageHeightEstimate` и пузырь, клиент и контракт `apps/api` — заводите тест, проверяющий их согласие, или комментарий у обеих сторон со ссылкой друг на друга.
**Почему.** У Telegram схему id узлов разделяют нумератор и рендерер цитат, и ничто не проверяет пару.
*Источник: `docs/instantpage-richtext.md` (Rich reply quotes, «The node id scheme is shared by the enumerator and the renderer, and nothing checks the pair»)*

#### 7.6.5 Выглядит нажимаемым — нажимается, и наоборот
**Правило.** Либо дайте упоминанию `@login` ссылку на профиль (внутренняя схема и перехват `openURL`), либо не красьте его как ссылку. Вид и действие любой сущности — безусловные.
**Почему.** У Telegram цвет ссылки и обработчик тапа даты зависели от формата, который почти всегда пуст, и даты стали «мёртвым» текстом.
**Сейчас у нас.** соблюдено (#499): упоминание выделено весом, но без цвета ссылки, раз не нажимается.
*Источник: `docs/instantpage-richtext.md` (Inline custom emoji, «A RichText.textDate renders as a LINK in V2 whatever its format»)*

#### 7.6.6 Вид и тап читают один и тот же атрибут
**Правило.** Нажимаемость сущностей определяйте по `AttributedString.link`, который ставит `RichText`. Обработчик `openURL` разбирает только то, что поставил разбор. Новую сущность добавляйте сразу в оба места.
**Почему.** Отрисовка у Telegram ставит те же ключи атрибутов, по которым пузырь ищет сущность под пальцем.
*Источник: `docs/instantpage-richtext.md` (RichText entity cases, «Display attaches the same TelegramTextAttributes.* keys…»)*

#### 7.6.7 Обратная связь нажатия — у каждой нажимаемой сущности
**Правило.** `.tint` на `Text` подсвечивает только `link`. Если появятся нажимаемые сущности другим механизмом, дайте им свою подсветку нажатия.
**Почему.** У Telegram ключ, пропущенный в списке, молча терял подсветку нажатия и индикатор загрузки.
*Источник: `docs/instantpage-richtext.md` (RichText entity cases, «linkSelectionRects and the bubble tap path check EVERY interactive key»)*

#### 7.6.8 Строгое распознавание формул: `$5-$10` — не математика
**Правило.** Если формулы появятся на iOS, `$…$` считайте формулой только при четырёх границах: снаружи — край строки или не буква и не цифра, внутри — не пробел, число `$` совпадает. Блочные `$$` — отдельная строгая проверка. То же предложите вебу.
**Почему.** У Telegram `$5-$10`, `$FOO=$BAR`, `cost$5$total` остаются текстом.
**Сейчас у нас.** Расходится на вебе: формулы ищутся грубой эвристикой `/\$\$?[^$\n]+\$\$?/` (`apps/web/src/entities/chat/ui/message-content-markdown.tsx:56`), и цены в тенге или долларах могут стать формулами.
**Применимость.** Частично: формул на iOS нет.
*Источник: `docs/instantpage-richtext.md` (Formulas trigger rich messages)*

#### 7.6.9 Место под встроенный объект — не пробелом
**Правило.** Невидимая копия времени `metaPlaceholder` резервирует ширину видимым текстом в `Color.clear` — так и держите, не заменяйте её пробелами или `\u{2002}` нужной ширины. Если появятся встроенные картинки или кастомные эмодзи в `AttributedString`, заполнитель — `U+FFFC`, не неразрывный пробел.
**Почему.** У Telegram заполнитель был пробелом, а CoreText позволяет концевым пробелам «висеть» за краем: эмодзи в конце строки рисовался за пузырём, до 28 pt. Неразрывный пробел склеивает соседей. Измерено перебором ширин.
**Сейчас у нас.** Соблюдено (`MessageCodeBlocks.swift:131`, `:156`).
*Источник: `docs/instantpage-richtext.md` (Inline custom emoji, «The inline-attachment placeholder MUST NOT be whitespace»)*

#### 7.6.10 Встроенный объект центрируется по строке и не раздувает её
**Правило.** Значки в строке текста (`Text(Image(systemName:))`) — системного размера текстового стиля, без `.font(.largeTitle)` внутри строки тела.
**Почему.** У Telegram эмодзи размером около строки центрируются по ней. Раньше высота строки удваивалась.
**Применимость.** Частично: кастомных эмодзи в тексте нет.
*Источник: `docs/instantpage-richtext.md` (Inline custom emoji, «Inline emoji/images are CENTERED on the font line box»)*

#### 7.6.11 Позиции глифов в RTL — с учётом направления строки
**Правило.** Если появятся свои вычисления позиций глифов (`NSLayoutManager`, TextKit 2 для выделения или подсветки), учитывайте направление строки: начальный край объекта — минимум из двух смещений.
**Почему.** У Telegram смещение по индексу начала в RTL давало правый край, и эмодзи уезжали на свою ширину в арабской строке.
**Применимость.** Частично: своих вычислений нет, RTL-языков в локализации нет, но сообщения на арабском бывают.
*Источник: `docs/instantpage-richtext.md` (Inline custom emoji, «Inline-attachment x must be the LEADING edge, computed RTL-safely»)*

#### 7.6.12 Направление ряда — `leading`/`trailing`, не `left`/`right`
**Правило.** Во всех `HStack`, `alignment` и `padding` используйте `leading`/`trailing`.
**Почему.** У Telegram «влево» значит «к началу», и в RTL ряд идёт справа налево по одному правилу для всех режимов.
*Источник: `docs/instantpage-richtext.md` (Inline buttons, «One RTL rule covers all four modes»)*

#### 7.6.13 Элемент шире пузыря переносится или усекается
**Правило.** Длинный URL без пробелов или длинное слово в коде переносится по символам или усекается по графемам с многоточием, но не расширяет пузырь. Новый вид встроенного объекта добавляйте веткой в каждое место, где перечислены виды. Регрессия — снимок «строка без пробелов в 300 символов».
**Почему.** У Telegram перенос с возвратом знал только перечисленные виды: новый без ветки молча вылезал за пузырь. Объект шире строки у них усекается по графемам.
*Источник: `docs/instantpage-richtext.md` (Inline buttons, «An overflowing pill needs an arm in the re-break block»; «A pill wider than the whole line is truncated»)*

#### 7.6.14 Ширина пузыря учитывает ширину кода
**Правило.** `MessageCodeBlockView` растягивается `.frame(maxWidth: .infinity)`. Если пузырь начнёт подгоняться под ширину содержимого, код обязан участвовать шириной своего текста. Регрессия — снимок «короткий текст + длинная строка кода»: код не обрезан.
**Почему.** У Telegram при сжатии пузыря блок кода исключили из расчёта целиком: пузырь стал уже кода, и тот обрезался краем. Поймано на устройстве.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 code block, «In the fitToWidth shrink a band contributes its INNER content»)*

#### 7.6.15 Подпись языка — обычный текст со стилем, нормализованный при разборе
**Правило.** Подпись языка — текстовый стиль (`.caption.weight(.semibold)`), без ручных размеров. Приводите язык к одному виду (`lowercased()`, обрезка пробелов) в разборе `MessageCodeBlocks.split`, а не при отрисовке.
**Почему.** У Telegram подпись языка была единственным шрифтом мимо общей раскладки, и через неё протекал масштаб. Теперь это обычный текстовый элемент, регистр приводится при раскладке.
**Сейчас у нас.** соблюдено (#499): язык блока приводится к нижнему регистру при разборе.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 code block, «The language line is a real laid-out text item»)*

#### 7.6.16 Перенос слов — по правилам Unicode, а не по пробелам
**Правило.** Если появятся таблицы или своя разбивка текста (обрезка превью, колонки), режьте через `enumerateSubstrings(.byWords)` или токенизатор, а не по `" "`.
**Почему.** У Telegram минимальная ширина колонки — самый широкий неразрывный отрезок по UAX #14 (`CFStringTokenizer`). «Слова по пробелам» ломали китайский и тайский.
**Применимость.** Частично: таблиц в iOS нет, GFM-таблицы рисует только веб.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 table, «Overflowing tables compress down to whole words»)*

#### 7.6.17 Контекст рекурсивного разбора — структурой
**Правило.** В рекурсивных разборах (вложенные цитаты или списки, если появятся) передавайте параметры контекста одной структурой, а не по одному аргументу.
**Почему.** У Telegram ограничение ширины не доходило до вложенного вызова (31 рекурсивный вызов), а поле с другим смыслом (`boundingWidth`) переиспользовать было нельзя.
**Применимость.** Частично: рекурсивного разбора у нас нет.
*Источник: `docs/instantpage-richtext.md` (Inline buttons, «The cap arrives via inlineButtonMaxWidth»; «KNOWN BUG… recursion never forwards boundingWidth»)*

#### 7.6.18 Сгенерированное не править
**Правило.** `EmojiKeywords.generated.swift` меняйте через генератор (`scripts/emoji_keywords.py`) и исходные данные, а не правкой сгенерированного файла.
**Почему.** У Telegram источник истины — схема `.fbs`, а не сгенерированный FlatBuffers-код.
**Применимость.** Частично: FlatBuffers у нас нет, принцип общий.
*Источник: `docs/instantpage-richtext.md` (Inline custom emoji, «flatc casing/required gotchas»)*

### 7.7 Обрезка, превью, выделение и копирование

#### 7.7.1 Однострочное превью сообщения — одна функция для всех поверхностей
**Правило.** Заведите одну функцию «превью сообщения»: снимает разметку, блок кода заменяет на «Код», вложения — подписью. Вызывайте её в списке чатов, панели ответа, закрепе, поиске и пушах.
**Почему.** У Telegram одна функция строит превью, и список чатов, панели ответа и закрепа, пересылка и уведомление получают одно и то же.
**Сейчас у нас.** соблюдено (#499): `MessagePreview` снимает строчный Markdown, блок кода заменяет словом «Код»; её
зовут список чатов, панели ответа и правки, закреп.
*Источник: `docs/instantpage-richtext.md` (Editing rich messages, «previewText() lives in TelegramStringFormatting»; Compact InstantPage previews)*

#### 7.7.2 Превью ограничено по графемам и по объёму чтения
**Правило.** Превью сообщения или поста режьте по `Character` (графемам), а не по `utf16` или байтам, и добавляйте многоточие. Ограничивайте объём, который превью вообще читает: огромное сообщение не должно разбираться целиком ради одной строки.
**Почему.** У Telegram тело превью — до 200 графем, обход — до глубины 64, 4096 узлов и 16384 единиц UTF-16.
*Источник: `docs/instantpage-richtext.md` (Compact InstantPage previews, «Preview bodies are limited to 200 grapheme clusters»)*

#### 7.7.3 Видимая строка превью и озвучиваемый текст — раздельно
**Правило.** `accessibilityLabel` строки чата — человеческий текст («Фото», «Код»), а не значки и не разметка. Озвучку стройте отдельной функцией, не из видимой строки.
**Почему.** У Telegram видимая строка с атрибутами и текст для VoiceOver — разные функции, и озвучка не подменяет видимое.
*Источник: `docs/instantpage-richtext.md` (Compact InstantPage previews, `styleInstantPagePreview` / `instantPagePreviewPlainText`)*

#### 7.7.4 Многоточие добавляется, строка не переписывается
**Правило.** Обрезку текста делайте через `lineLimit` и `truncationMode`, а не вырезанием подстроки с «…».
**Почему.** У Telegram переписанная усечённая строка ломала диапазоны, попадания касаний, позиции эмодзи и раскрытие. У нас иначе ломаются ссылки, подсветка поиска и выделение.
*Источник: `docs/instantpage-richtext.md` (Collapsed quotes, «The ellipsis is APPENDED, never folded into the line»)*

#### 7.7.5 Усечённая строка: за обрезом ничего не раскладывается и не нажимается
**Правило.** Свёрнутые подписи, цитаты и превью в списке чатов с эмодзи-картинками и ссылками (`RichText`) проверяйте на обрезе: в начале строки ничего лишнего не рисуется, тап по ссылке за многоточием не срабатывает.
**Почему.** CoreText даёт смещение 0 всему за обрезом: у Telegram эмодзи ложились на первое слово. Подсветка ссылки, пересекающей обрез, должна начинаться со ссылки.
**Применимость.** Частично: своих кастомных эмодзи в тексте почти нет.
*Источник: `docs/app-unit-tests.md` (`InteractiveTextComponentTests`)*

#### 7.7.6 Обрезка — по графемам, атомы не режутся
**Правило.** Любую обрезку пользовательского текста (превью, цитата ответа, лимит поля) делайте по `Character`. Не режьте посередине ссылку, упоминание или эмодзи-последовательность. Граница внутри атома при выделении включает атом целиком, обрезка по длине — исключает. Тест: флаг, эмодзи с оттенком кожи и семейный ZWJ на границе.
**Почему.** У Telegram кнопка-атом не делится обрезкой, не считается пробелом и не триммится. Граница внутри формулы, эмодзи или даты включает атом, а обрезка по длине его исключает, по целым графемам (флаги, оттенки кожи, ZWJ).
*Источник: `docs/instantpage-richtext.md` (Inline buttons, «A button behaves as a discrete atom»; Rich reply quotes, «Atoms are never cut», «Boundaries and length cuts snap to whole grapheme clusters»)*

#### 7.7.7 Смещения — в одной оси; отображение не равно исходнику
**Правило.** Диапазоны в `AttributedString` (отрисованный текст) и в `content` (исходник со `**`) — разные оси. Переводите между ними через атрибут или разбор, никогда не считайте символы. `ComposerFormat` работает в UTF-16 (`NSRange`) — держите это явно.
**Почему.** У Telegram ось смещений определена явно (`RichText.plainText` в UTF-16): отображаемые смещения не равны исходным, и мостом служат только штампы, а не подсчёт символов.
*Источник: `docs/instantpage-richtext.md` (Rich reply quotes, «The flat axis is RichText.plainText in UTF-16»)*

#### 7.7.8 Копирование отдаёт то, что решено, без потерь
**Правило.** Решите и запишите, что кладёт «Копировать»: исходник (как веб-редактор) или отрисованный текст. Кнопка блока кода копирует чистый код. Проверка «пустой текст» должна учитывать сообщения, у которых видимый текст есть, а `content` пуст.
**Почему.** У Telegram копирование богатого сообщения кладёт в буфер фрагмент, RTF и простой текст, а копирование выделения — Markdown выделенного с правильной склейкой цитат и кода.
**Сейчас у нас.** Решение владельца: «Копировать» кладёт исходный Markdown `message.content` со `**` и ```` ``` ```` (`ChatThreadView.swift:810`). Кнопка кода уже копирует чистый код (`:812`).
**Применимость.** Частично: богатого формата в буфере у нас нет.
*Источник: `docs/instantpage-richtext.md` (Copying rich messages as markdown)*

#### 7.7.9 Копирование выделенной части — из исходника по диапазону
**Правило.** Копирование выделенного (`model.selectedText`) стройте из исходника по диапазону, а не из отрисованного текста.
**Почему.** У Telegram строчная разметка выделения восстанавливается из атрибутов отрисованного фрагмента, чтобы ничего не терялось.
**Применимость.** Частично: выделение у нас по сообщениям, не по символам.
*Источник: `docs/instantpage-richtext.md` (Copying rich messages, «Inline markdown is read from display attributes»)*

#### 7.7.10 Выделение текста доходит до конца строки
**Правило.** Диапазоны выделения текста сообщения держите полуоткрытыми. Проверяйте выделение последнего символа и последнего эмодзи (графемы) в строке.
**Почему.** У Telegram верхняя граница выделения исключающая, и привязка к индексу последнего символа делала этот символ невыделяемым.
*Источник: `docs/instantpage-richtext.md` (RichText entity cases, «Rich-data text selection must reach a line's trailing edge»)*

#### 7.7.11 Выделение текста — из меню сообщения; закрытие меню его снимает
**Правило.** Выделение текста сообщения открывайте из меню сообщения. При закрытии меню любым путём наложение выделения снимайте.
**Почему.** У Telegram выделение — режим поднятого пузыря с «Копировать» и «Выбрать всё», один фрагмент на пузырь, и любой выход из меню убирает наложение.
**Применимость.** Частично: посимвольного выделения в пузыре так у нас нет.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` (Text selection is the lifted bubble's)*

#### 7.7.12 Текст карточек в ленте по умолчанию не выделяется
**Правило.** Не ставьте `.textSelection(.enabled)` тексту карточек в ленте: это конфликтует с долгим нажатием для меню. Выделение — через пункт меню сообщения, как для обычного текста (`model.selectedText`).
**Почему.** У Telegram текст виджета по умолчанию не выделяется: выделение даёт клиент через меню, и виджет не знает, что выделил читатель.
*Источник: `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` (§8, `user-select`); `docs/message-widgets-native-runtime.md` (The selectable text)*

#### 7.7.13 Известная потеря при правке — явный запрет, а не `default:`
**Правило.** Сообщения, которые нельзя править без потерь (опрос, чек-лист, стикер, геопозиция), не должны показывать «Редактировать». Скрывайте пункт явной проверкой вида и закрепите это в `MessageMenuTests`.
**Почему.** У Telegram правка сообщения с кнопками теряла их. Исправление — положительная проверка `containsButtons`, выключающая правку, а не ветка по умолчанию.
**Сейчас у нас.** соблюдено (#499): `canEdit` явно проверяет вид (`isEditableKind`), тест в `MessageMenuTests`; сервер
вид при правке пока не проверяет.
*Источник: `docs/instantpage-richtext.md` (Editing rich messages, «Known limitation»; Inline buttons, «KNOWN LOSSY, deferred…»)*

#### 7.7.14 Открывать вложение по названному id, а не «первое подходящее»
**Правило.** Файл или медиа из пузыря открывайте по id вложения (`AttachmentRecord.id`). Не нашли — ничего не открывайте.
**Почему.** У Telegram выбор «первое медиа сообщения» мог открыть другой файл: лучше не открыть ничего, чем не тот.
*Источник: `docs/instantpage-richtext.md` (Inline buttons, «Tapping a downloaded file opens it through the stock pipeline… Naming the medium is load-bearing»)*

### 7.8 Проверка поля на iPhone

#### 7.8.1 Ручной чек-лист поля ввода при каждой его правке
**Правило.** При правке `Composer/ComposerTextView.swift` и соседних файлов пройдите на iPhone:
- автозамена и предсказания (ru, kk): принятая автозамена откатывается одним удалением, «призрак» предсказания уходит при перемещении курсора и не дублирует слово;
- Undo после применения форматирования (`ComposerFormatting` — одна отменяемая замена) и после вставки длинного текста или Markdown;
- плавающий курсор (долгое нажатие пробела), прокрутка у края;
- переключение на emoji-панель и обратно (высота `KeyboardFrame.lastHeight`);
- фокус → открыть профиль → назад: CPU в покое (`CADisplayLink` остановлены), каретка работает;
- японская и китайская раскладки (marked text) хотя бы дымово: отмена всей композиции одним шагом, тап в сторону фиксирует набор;
- автоповтор клавиши, смена размера клавиатуры во время композиции.
**Почему.** Telegram держит ручной чек-лист из 22 пунктов и трёх отдельных проверок: автозамена, предсказание, IME, структура, выделение (лупа, ручки, RTL), плавающий курсор, орфография, вставка большого Markdown, фокус с уходом на другой экран, «Выбрать всё» в большом документе, поворот. 2350 UIKit-тестов этих сбоев не видели.
**Применимость.** Частично: без поворота (у нас только портрет) и без таблиц и структурного редактора.
*Источник: `docs/superpowers/phase6-manual-checklist-record.md` (пункты 1–22, «Three checks owed»)*

### 7.9 Неприменимо к нам
- Нет: все записи раздела переносятся хотя бы общим принципом. Частично применимые отмечены в самих правилах строкой «Применимость».

---
## §8. Медиа

Вложения, картинки, сетки и альбомы, пикер медиатеки, просмотр, видео и голосовые. Главная мысль: картинка и
загрузка привязаны к стабильному id, видимое получает синхронную заглушку и грузится первым, размер медиа известен до
загрузки, а всё, что касается PhotoKit и `AVPlayer`, проверяется на iPhone, а не на симуляторе.

### 8.1 Загрузка, отправка и скачивание вложений

#### 8.1.1 Загрузка и скачивание никогда не оставляют подписчика ждать вечно
**Правило.** Каждая ветка загрузчика вложений и `OutboxService` (ошибка сети, отмена, уход с экрана, сбой подписанной
ссылки) переводит сообщение в конечное состояние (`sendState` `.failed`/`.sent`) до того, как забыть задачу. Экран
только наблюдает загрузку: его наблюдение её не продлевает и не отменяет.
**Почему.** У Telegram каждый путь вытеснения загрузки сначала сообщает подписчикам конечное состояние, потом удаляет
контекст; «нужда» держит загрузку, наблюдатель только смотрит. Иначе пузырь крутит индикатор вечно.
*Источник: `docs/richtext-composer.md` (§6a «A context must never leave a subscriber waiting», «Needs and subscribers
are counted separately»)*

#### 8.1.2 Вложение либо доезжает, либо видно с «Повторить»
**Правило.** Не допускай молчаливой потери вложения: загрузка, оборванная закрытием приложения, помечается неудачной
(`AttachmentUploader.failAbandoned`) и ждёт «Повторить». Черновик хранится локально и зеркалится с сервера
(`ChatThreadModel.loadDraft/persistDraft`, `ChatStore.mirrorServerDraft`).
**Почему.** У Telegram прикреплённое медиа загружается сразу, становится облачным и переживает закрытие и повторное
открытие поля; черновик синхронизируется между устройствами.
**Применимость.** Частично — фоновой дозагрузки после закрытия приложения у нас нет, это сознательно проще.
*Источник: `CLAUDE.md` («RichTextEditor…»: media pre-upload; draft persistence)*

#### 8.1.3 Протухшая ссылка на файл перезапрашивается мимо кеша
**Правило.** Подписанные ссылки MinIO истекают. После 403/истечения повтор загрузки или скачивания берёт новую ссылку
у API по id вложения, а не переиспользует сохранённую: сбрасывай её через `AttachmentURLProvider.invalidate(_:)`.
Ошибку «навсегда» по протухшей ссылке не показывай.
**Почему.** У Telegram повтор после «ссылка устарела» обходит кеш и быстрый путь, иначе снова уходит та же
отвергнутая ссылка; файл качается по ссылке на сообщение, чтобы её можно было обновить.
**Сейчас у нас.** Соблюдено: `AttachmentURLProvider` кеширует ссылку до `expiresAt − 30 с` и сбрасывает её
`invalidate` (`AttachmentView.swift`, `ChatFileDownloads.swift`).
*Источник: `docs/richtext-composer.md` (§6a «`forceReupload` must bypass the whole registry»); `docs/instantpage-richtext.md`
(InstantPage V2 audio/music, «Audio files fetch via a message reference»)*

#### 8.1.4 Прогресс принадлежит виду вложения
**Правило.** Прогресс загрузки вложения вид вложения читает сам из `@Observable`-источника; не передавай его
параметром в `MessageBubbleView` и не клади в `MessageTimeline.Item`.
**Почему.** Иначе каждый тик меняет хеш строки (`MessageHeightKey.revision`) и перемеряет ленту. У Telegram прогресс не
входит в ключ переиспользования вида, а полный `update` перезапрашивает картинку.
*Источник: `docs/richtext-composer.md` (§6a «Progress is owned by the media view»);
`submodules/TelegramUI/Components/RichTextEditorMediaView/CLAUDE.md` («Load-bearing invariants»)*

#### 8.1.5 Скачивание файла — только через `ChatFileDownloads`
**Правило.** Любое скачивание файла из пузыря идёт через `ChatFileDownloads` (единый реестр), а не прямым
`URLSession`.
**Почему.** У Telegram прогресс выводится из записи менеджера загрузок; загрузка в обход оставляла значок «скачать»
навсегда. У нас в обход реестра не работают кольцо прогресса и отмена.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 audio/music, «Fetch MUST go through the fetch manager»)*

#### 8.1.6 «Неизвестно» — это «ещё не знаем», не «скачано»
**Правило.** Для строки файла — одна функция «состояние → (значок, действие)», общая для отрисовки и касания;
неизвестное состояние показывает и делает «скачать».
**Почему.** У Telegram `.none` рисовался стрелкой «скачать», а тап трактовал его как «открыть» — открывались
нескачанные файлы; разбиение состояний в тапе и отрисовке обязано быть одним.
*Источник: `docs/instantpage-richtext.md` (Inline buttons, «tapped() and updateFetchState() must partition fetchStatus IDENTICALLY»)*

#### 8.1.7 У неотправленного сообщения нет «скачать» для своего файла
**Правило.** Вложение в исходящей очереди (`AttachmentUploader`) показывает локальный файл и прогресс загрузки на
сервер, а не стрелку скачивания.
**Почему.** У Telegram у сообщения без id стрелка «скачать» молча ничего не делала.
*Источник: `docs/instantpage-richtext.md` (Inline buttons, «KNOWN: fetch/cancelFetch… guard on message?.id»)*

#### 8.1.8 Вид вложения — из модели, а не из угадывания по содержимому
**Правило.** «Отправить как файл» (`asFiles` в `AttachmentSendSheet`) даёт сообщение-файл, даже если MIME `image/*`.
Отрисовку пузыря решай по виду вложения из DTO (`AttachmentRecord.chatKind`, где `asDocument` перевешивает MIME), а не
по MIME или содержимому файла.
**Почему.** У Telegram изображение, отправленное «как файл», остаётся документом; угадывание по MIME отправляло его в
фото.
**Сейчас у нас.** Соблюдено для «как файл»: `chatKind` проверяет `asDocument` раньше MIME. Голосовое пока узнаётся по
имени `voice-` — это угадывание; новый вид лучше заводить полем в DTO.
*Источник: `submodules/TelegramUI/Components/RichTextEditorMediaView/CLAUDE.md` («Types»); `docs/richtext-composer.md`
(§4 «Document (file) blocks»)*

#### 8.1.9 Видео для сети — с `moov` в начале
**Правило.** Не убирай `shouldOptimizeForNetworkUse = true` в `MediaPreparation.exportMP4` и не переходи на писатель
без него.
**Почему.** С `moov` в начале первый кадр и постер по ссылке читаются с начала файла (`ChatMediaThumbnails.firstFrame`,
`ChatVideoFrames`). У Telegram ослабление границы резерва молча теряло faststart — файл валиден, но не стримится.
*Источник: `MediaEditor/CLAUDE.md` («The reservation and the upper bound must agree», «A reservation that turns out too small is not an error»)*

#### 8.1.10 Каждую раскладку медиа проверять на отправке
**Правило.** Меняя путь отправки, проверяй на iPhone одиночное фото, видео, альбом (сетка `ChatMediaTile`), файл и
голосовое: нет мигания, тап работает сразу после подтверждения.
**Почему.** У Telegram одиночные, видео и коллажи покрыты, а для слайдшоу записано, что делать, если начнёт мигать.
*Источник: `docs/instantpage-richtext.md` (Send-time media continuity, «Coverage»)*

### 8.2 Картинки: ключи, копии, заглушки

#### 8.2.1 Ключ картинки — стабильный id, не индекс и не вся структура
**Правило.** Загрузку картинки в пузыре и сетке ключуй id вложения (`.task(id: attachment.id)`), а не размером,
прогрессом или всем сообщением; размеры и режим вписывания — обычные параметры раскладки. Ключи `ImageMemoryCache`,
задачи и страницы просмотра — по id файла / `localIdentifier`, никогда по номеру строки или плитки.
**Почему.** У Telegram всё, что попадает в равенство компонента, перезапрашивает картинку при каждом изменении;
индексное состояние пересчитывается источником, потому что окна галереи и ленты растут в обе стороны.
**Сейчас у нас.** Соблюдено: `ForEach(assets, id: \.localIdentifier)`, ключи `att:<id>:<points>`, `chatmedia:<id>`.
*Источник: `submodules/TelegramUI/Components/RichTextEditorMediaView/CLAUDE.md` («Load-bearing invariants»);
`submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Invariants worth knowing»);
`docs/superpowers/specs/2026-10-28-shared-media-grid-design.md`*

#### 8.2.2 Плитка не возвращается к пустой; заменяет картинку только более чёткая
**Правило.** При смене цели/ступени не сбрасывай `image` в `nil` до прихода новой (`RemoteImage` показывает любую копию
по ключу), не меняй крупную копию на мелкую, сбой загрузки не стирает уже показанное.
**Почему.** У Telegram показанная плитка никогда не пустеет, заглушку заменяет только картинка шире в видимых пикселях.
**Сейчас у нас.** Соблюдено в кеше: `ImageMemoryCache.store(_ decoded:for:)` хранит крупнейшую копию.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Thumbnails», «Thumbnail store…»);
`docs/superpowers/plans/2026-10-27-media-grid-thumbnail-store.md` (Global Constraints)*

#### 8.2.3 Одна копия на объект и размер — по ступеням
**Правило.** Размер копии бери через `ImageTarget.view(_:scale:mode:step:)` (шаг 32) и `sources.best(forPoints:)`; не
запрашивай точный пиксельный размер ячейки мимо них.
**Почему.** Соседние ширины должны попадать в одну цель и один ключ кеша; у Telegram на уровне у снимка один размер
копии, во вкладке профиля — ступени ширины 64/150/200/280.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Uniform levels»); `PeerInfoVisualMediaPaneNode/CLAUDE.md`*

#### 8.2.4 Одно правило копии для предзагрузки и для показа
**Правило.** Меняя размер плитки или правило `best(forPoints:)`, меняй его в одном месте: предзагрузка должна греть тот
же ключ и цель, что показ.
**Почему.** Иначе предзагрузка греет не тот ключ и работа уходит впустую; у Telegram одно правило качества обслуживает
предзагрузку, стартовый уровень и обложку.
**Сейчас у нас.** Соблюдено: `FeedPrefetcher.imageRequest` считает ключ и цель как `RemoteImage` плитки,
`ChatMediaPrefetcher` берёт `ChatMediaTile.cacheKey`/`pixelPoints`.
*Источник: `submodules/HLSPlayback/CLAUDE.md` («One preload-quality rule»); `docs/native-hls-player.md`*

#### 8.2.5 Пустая плитка лечится синхронной заглушкой, а не настройкой очереди
**Правило.** Если плитка появляется пустой, сначала ищи, почему нет синхронной заглушки (нет `placeholder`/LQIP в
ответе, не тот ключ памяти), а не крути параллельность загрузок.
**Почему.** У Telegram белые вспышки, «змейка» и белый экран имели одну причину — каждая картинка асинхронна;
подстройка планировщика не помогла, помогло хранилище синхронных миниатюр. У нас та же схема: LQIP в ответе сервера и
копия в памяти в первом кадре.
*Источник: `docs/superpowers/specs/2026-10-27-media-grid-thumbnail-store-design.md` («Why»)*

#### 8.2.6 Размытая заглушка — одна, размытая заранее, без живого `.blur`
**Правило.** Заглушку из LQIP бери готовой размытой (`LQIP.blurred(from:)`), а не `LQIP.image(from:)` + `.blur(radius:)`
на плитке.
**Почему.** Живое размытие — лишний проход вне экрана на каждой плитке и каждом кадре прокрутки; у Telegram крошечное
превью декодируется и размывается один раз вне главного потока.
**Сейчас у нас.** соблюдено (#499): плитки «Медиа» показывают готовое размытое LQIP без живого `.blur`.
*Источник: `PeerInfoVisualMediaPaneNode/CLAUDE.md` («Images», `blurredImmediateThumbnail`);
`docs/superpowers/specs/2026-10-28-shared-media-grid-design.md` («Instant placeholder»)*

#### 8.2.7 Маленькие картинки не растягивать
**Правило.** Плитки чата (`ChatMediaTile`) и картинки статей не увеличивай сверх исходного размера в пикселях; кроме
декодера, держи это и в раскладке.
**Почему.** Увеличение даёт мыло; у Telegram масштаб — `min(доступно / ширина, 1)`.
**Сейчас у нас.** В декодере соблюдено (`FeedRenderingTests.testNeverUpscalesPastOriginal`).
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 block media, «Small images are NOT upscaled»)*

#### 8.2.8 Слот и отрисовка медиа считают размер одной формулой
**Правило.** Оценка высоты пузыря (`MessageHeightEstimate`, кеш высот) и фактическая раскладка медиа берут размеры из
одной функции (`ChatMediaTile.singleSize(for:)` и соседние).
**Почему.** Расхождение резерва и рендера — прыжки ленты; у Telegram высота медиа ограничена `min(1000, ширина)`, и
резерв, и рендер считают её одной формулой.
*Источник: `submodules/TelegramUI/Components/RichTextEditorMediaView/CLAUDE.md` («Media aspect handling»)*

#### 8.2.9 Нулевые размеры от сервера — запасная пропорция и в раскладке, и в запросе
**Правило.** Где размер медиа идёт в два места (раскладка и `maxPixelSize` декодера, `previewURL(minWidth:)` альбомов),
запасное значение подставляй в оба.
**Почему.** У Telegram карта 0×0 схлопывалась в высоту 0; запас только в раскладке давал правильный по размеру пустой
прямоугольник.
**Сейчас у нас.** Соблюдено в раскладке: `ChatMediaTile.singleAspect` берёт 0,75 при отсутствии или нуле.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 block media, «.map blocks get a 600×300 fallback»)*

#### 8.2.10 Заглушка загрузки — внутри той же формы обрезки
**Правило.** Заглушки медиа в пузыре (`Palette.muted`) рисуй внутри той же формы обрезки, что и картинку.
**Почему.** У Telegram фон узла вылезал за скругление; заливка должна идти до скругления углов.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 block media, «.map blocks show a theme placeholder»)*

#### 8.2.11 Индикатор поверх картинки — контрастный
**Правило.** Индикаторы загрузки — системные (правило владельца); поверх медиа — на затемняющей подложке. Проверяй в
светлой и тёмной теме.
**Почему.** У Telegram прозрачный цвет делал стрелку и кольцо невидимыми на картинке, а белое мерцание — на светлой
заливке.
*Источник: `docs/instantpage-richtext.md` (Inline buttons, «Do NOT pass foregroundNodeColor: .clear…»)*

### 8.3 Сетки и альбомы

#### 8.3.1 Альбом — те же ячейки, что одиночное медиа
**Правило.** Ячейка альбома — тот же `ChatMediaTile`, что одиночная плитка; просмотр и переходы не имеют веток
«если это альбом».
**Почему.** У Telegram коллаж раскладывается в обычные элементы медиа, и галерея, реестр, скрытие, переиспользование
работают без кода под коллаж.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 collage & slideshow, «Collage is a flatten, not a container»)*

#### 8.3.2 Плитки альбома — по id вложения
**Правило.** Сетка альбома в пузыре и в листе вложений — `ForEach` по id вложения, не по индексу.
**Почему.** При правке альбома уцелевшие ячейки не пересоздаются — нет мигания и повторных загрузок; у Telegram
сопоставление идёт по id медиа с учётом повторов.
**Сейчас у нас.** Соблюдено в мозаике (`AttachmentView.swift`, `ForEach(Array(items.enumerated()), id: \.element.id)`).
*Источник: `submodules/TelegramUI/Components/RichTextEditorMediaView/CLAUDE.md` («Mosaic containers»)*

#### 8.3.3 Нераспознанный элемент альбома не оставляет дыру
**Правило.** Вложение неизвестного типа в альбоме исключай из сетки до раскладки (показывай файлом) — не резервируй под
него место.
**Почему.** У Telegram мозаика резервировала место под каждый элемент, а ячейку давала только распознанным — дыра и
смещение.
**Сейчас у нас.** Соблюдено: неизвестный MIME даёт `chatKind = .file`, а в мозаику идут только `showsAsMedia`.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 collage & slideshow, «A collage with an undecodable item…»)*

#### 8.3.4 Одиночное фото и плитка альбома вписываются по-разному
**Правило.** Как вписывать одиночное фото (целиком на подложке или с обрезкой) и плитки альбома (заполнение с обрезкой)
— решение дизайна; при правке отображения сверяйся с `docs/DESIGN_SYSTEM.md`.
**Почему.** У Telegram одно фото вписывается целиком с размытым фоном в полях, ячейки мозаики — с обрезкой.
**Применимость.** Частично — решение дизайна.
*Источник: `submodules/TelegramUI/Components/RichTextEditorMediaView/CLAUDE.md` («Single media aspect handling»)*

#### 8.3.5 Медиа последним — время плашкой поверх
**Правило.** Медиа-сообщение без подписи показывает время плашкой поверх нижнего правого угла плитки, без резерва
места. Для альбома решай по нижнему ряду сетки, а не по последней ячейке.
**Почему.** У Telegram у коллажа последний элемент бывает половинной ячейкой; проверяется нижний ряд с допуском 2 pt.
*Источник: `docs/instantpage-richtext.md` (Status node positioning, «Trailing full-width media → overlaid pill», «The check is over the bottom ROW»)*

#### 8.3.6 Медиа без подписи — во всю ширину пузыря
**Правило.** Медиа без подписи занимает пузырь без внутренних полей и скругляется его радиусами; проверяй снимками без
подписи для входящего и исходящего.
**Почему.** У Telegram виджет заполняет пузырь, а хвост продолжает цвет нижнего угла.
**Применимость.** Частично — виджетов нет, принцип для медиа-пузыря тот же.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («The widget fills its bubble»)*

#### 8.3.7 Видимое — первым и разом, без «змейки»
**Правило.** Если при открытии вкладки «Медиа» плитки заполняются снизу вверх — ставь видимые плитки экрана одной пачкой
или в обратном порядке чтения, чтобы первыми загрузились верхние.
**Почему.** У Telegram очередь LIFO при привязке в порядке чтения заполняла экран снизу вверх по одной ячейке; лечится
пакетной привязкой кадра.
**Сейчас у нас.** Проверить на iPhone: `ChatMediaThumbnails` (`ChatSharedContentView.swift`) — LIFO на 4 слота
(`release()` → `waiting.popLast()`), плитки встают в очередь в порядке появления.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Binding a frame's cells happens inside `performBatch`»);
`docs/superpowers/specs/2026-10-27-media-grid-thumbnail-store-design.md` («A "snake" after a zoom-out»)*

#### 8.3.8 На быстрой прокрутке — заглушки, чёткие — после успокоения
**Правило.** Если быстрый пролёт «Медиа» забивает очередь, показывай на ходу LQIP (`placeholder` из ответа) и запускай
загрузку после короткой паузы, а не на каждое появление плитки (`.task(id:)`).
**Почему.** У Telegram выше 2 экранов/с ячейки получают только миниатюры, чёткие — через 0,12 с после остановки,
предзагрузка на быстром ходу на паузе.
**Применимость.** Частично — принцип для будущей доработки; сейчас отмена при уходе плитки спасает сеть.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Thumbnails», moving fast);
`docs/superpowers/specs/2026-10-27-media-grid-thumbnail-store-design.md` («Moving fast»)*

#### 8.3.9 Плотность сетки — по тому, что успевает заполниться по сети
**Правило.** Добавляя зум или мелкую сетку во «Медиа» чата, не делай уровни мельче того, что подписанные ссылки и лимит
частоты сервера успевают заполнить (сейчас 3 колонки, `ChatMediaThumbnails.points = 140`).
**Почему.** У Telegram самый мелкий уровень (31 колонка) для сетевых медиа убран — его не заполнить.
**Применимость.** Частично — зума у нас нет.
*Источник: `docs/superpowers/specs/2026-10-28-shared-media-grid-design.md` (Goals)*

#### 8.3.10 Индекс и отрисовка меняются вместе
**Правило.** Новый вид содержимого, попадающий в «Общие материалы» (`ChatSharedContentView`), поиск или просмотр, — в
том же PR научи все экраны, которые этот индекс показывают.
**Почему.** У Telegram индексация медиа богатых сообщений без правки всех мест отрисовки давала пустые ячейки и строки
не того вида.
*Источник: `docs/instantpage-richtext.md` (Rich-message media, «The tag-index change is what creates the work»)*

#### 8.3.11 Производное не дублировать там, где оно уже едет само
**Правило.** При пересылке и ответе не дублируй вложения в двух полях DTO.
**Почему.** У Telegram медиа при пересылке уже едет в атрибуте; подмена через общий путь дала бы двойную отрисовку.
*Источник: `docs/instantpage-richtext.md` (Rich-message media, «Do NOT route the FORWARD path through effectiveMedia»)*

### 8.4 Пикер медиатеки (PhotoKit)

#### 8.4.1 PhotoKit проверять только на iPhone
**Правило.** Поведение и скорость `PHImageManager`/`PHCachingImageManager` (`RecentMediaGrid`, `PhotoAlbumsModel`,
`PhotoAssets`) проверяй на iPhone; результаты симулятора CI для PhotoKit доказательством не считаются.
**Почему.** На симуляторе `.fastFormat` падает с ошибкой 3303, `.opportunistic` не отдаёт сначала деградированную
картинку, `PHCachingImageManager` не кеширует цели меньше ~100 px, iCloud заблокирован.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («The dedicated simulator's PhotoKit is not a device»)*

#### 8.4.2 Синхронный запрос PhotoKit — только `.fastFormat`, и не на главном
**Правило.** `isSynchronous = true` в `PHImageRequestOptions` не ставь на главном потоке нигде, а вне `.fastFormat` —
нигде вообще.
**Почему.** У Telegram синхронный `.highQualityFormat` заблокировал главный поток на 240 с.
**Сейчас у нас.** Соблюдено: запросы асинхронные (`AssetTile.thumbnail()` через continuation, обложки в
`PhotoAlbumsModel`).
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Never request synchronously…»)*

#### 8.4.3 Миниатюры плиток не качают оригиналы из iCloud
**Правило.** Для плиток сначала локально (`.opportunistic`/`.fastFormat`, `isNetworkAccessAllowed = false`); сеть —
только для видимых и только в покое. Сеть нужна при отправке (`PhotoAssets.imageData`/`movieFile`), а не для плитки.
Менять — с проверкой на iPhone с медиатекой в iCloud.
**Почему.** У Telegram миниатюры берутся локально без сети; сеть для iCloud-снимков — отдельная полоса на 2 запроса,
только когда сетка стоит и не идут чёткие запросы.
**Сейчас у нас.** соблюдено (#499): миниатюры только с устройства; из iCloud качается видимая плитка в покое, не больше
двух сразу.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` (абзац про iCloud, «Thumbnail store, filler…»)*

#### 8.4.4 `PHCachingImageManager` — греть окно впереди тем же размером, или не использовать
**Правило.** Либо грей окно (видимые ± экран) `startCachingImages`/`stopCachingImages` с тем же `targetSize`
(`140 * displayScale`), `contentMode` и опциями, что у запроса плитки, либо честно используй `PHImageManager.default()`.
**Почему.** Кеш с другим размером цели бесполезен; у Telegram прогрев идёт на окно впереди движения, по одному вызову
на серию одинаковых размеров.
**Сейчас у нас.** соблюдено (#499): окно сетки прогревается `PHCachingImageManager` тем же размером.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Level-1 rows differ in pixel size…»);
`docs/superpowers/specs/2026-10-27-media-picker-grid-design.md` («`startCachingImages` is never called»)*

#### 8.4.5 Первый экран пикера — заранее, ожидание с жёстким потолком
**Правило.** Если открытие листа вложений заметно «пустое» — запускай выборку `PhotoAssets.recent()` и запросы первых
~12 плиток при нажатии на скрепку, до появления листа. Любое синхронное ожидание на главном — с потолком в десятки
миллисекунд.
**Почему.** У Telegram кеш первого экрана начинает грузиться, когда лист только появляется, первая раскладка ждёт его
не дольше 50 мс, запись показывается только при совпадении id и версии.
**Применимость.** Частично — кеша первого экрана нет, `RecentMediaGrid` начинает `reload()` в `onAppear`.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Launch cache»);
`docs/superpowers/plans/2026-10-27-media-grid-thumbnail-store.md` (Task 4b)*

#### 8.4.6 Изменения медиатеки при открытом листе применять, а не терять
**Правило.** Если добавляешь `PHPhotoLibraryChangeObserver` в `RecentMediaGrid`: изменения разбирай вне главного по
своему последнему результату, применяй одной операцией, удалённые снимки убирай из `selection`, верхний видимый
держи на месте, всю сетку не пересоздавай.
**Почему.** У Telegram `apply(removed/inserted/changed)` идёт в том же обороте, где источник уже отдаёт новый список;
несходящиеся счётчики — перезагрузка.
**Сейчас у нас.** соблюдено (#499): `PHPhotoLibraryChangeObserver` обновляет сетку, удалённые снимки снимаются с выбора.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Library changes»); `submodules/MediaPickerUI/CLAUDE.md`;
`docs/superpowers/plans/2026-10-27-media-grid-stage1.md` (Task 11)*

#### 8.4.7 Выбор — по идентификатору, порядок — из упорядоченного списка
**Правило.** Выбор сравнивай по `localIdentifier`, а не по экземпляру `PHAsset`; номер на плитке и порядок отправки —
из упорядоченного списка выбора, при любой смене альбома и изменении медиатеки.
**Почему.** После перевыборки альбома или медиатеки объекты `PHAsset` новые; у Telegram выбор живёт в контексте выбора
и читается по идентификатору.
**Сейчас у нас.** соблюдено (#499): выбор хранится и сравнивается по `localIdentifier`.
*Источник: `submodules/MediaPickerUI/CLAUDE.md` («Selection»); `docs/superpowers/plans/2026-10-27-media-picker-grid-stage2.md`
(Review Focus 2)*

#### 8.4.8 Загрузка из iCloud при отправке — видимая и отменяемая
**Правило.** Для долгой загрузки снимка из iCloud показывай прогресс (`PHImageRequestOptions.progressHandler`,
`PHAssetResourceRequestOptions.progressHandler`) и давай отменить.
**Почему.** У Telegram качающиеся iCloud-снимки показывают кольцо, касание отменяет загрузку.
**Применимость.** Частично — `PhotoAssets.imageData`/`movieFile` качают из iCloud (`isNetworkAccessAllowed = true`) без
прогресса и отмены.
*Источник: `submodules/MediaPickerUI/CLAUDE.md` («Download rings», `AssetDownloadManager`)*

#### 8.4.9 Перевод «номер в сетке → объект» — в одном месте
**Правило.** Если в сетке появится ещё один «лишний» элемент или предзагрузка по индексам — заведи одну функцию
перевода индекса и зови её везде, а не считай смещение по месту.
**Почему.** У Telegram сдвиг на «лишние» элементы (черновики, вставленное) и перевёрнутый порядок «Недавних»
применяются ко всем индексам разом: изменениям, предзагрузке, кешу.
**Применимость.** Частично — сейчас индексной арифметики нет: «Недавние» и альбомы приходят новыми первыми
(`PhotoAssets.recent()`/`assets(in:)`), плитка камеры стоит вне `ForEach`.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` (`MediaGridPhotoLibraryDataSource`);
`submodules/MediaPickerUI/CLAUDE.md` («Data»)*

#### 8.4.10 Системный пикер — без невидимой подложки, съедающей касания
**Правило.** `.fileImporter`, `PhotosPicker` и камеру не оборачивай в самодельные невидимые контейнеры; если обёртка
неизбежна — у неё выход по таймауту и при уходе приложения в фон. Проверяй сценарий «открыть выбор файла →
заблокировать телефон → вернуться». Из той же семьи — принятое правило «`PhotosPicker` не в строке Form/меню».
**Почему.** У Telegram UIKit откладывал показ до 3 с; если приложение уходило в неактивное (Face ID, блокировка),
показ молча отменялся, а невидимый полноэкранный хост оставался и забирал все касания.
*Источник: `docs/app-unit-tests.md` (`LegacyMediaPickerUITests`, `DocumentPickerPresentation`)*

### 8.5 Просмотр и галерея

#### 8.5.1 Первый кадр просмотра — уже загруженная картинка плитки
**Правило.** Передавай в `MediaViewer` ключ (или саму `UIImage`) плитки-источника как стартовую картинку, пока грузится
копия 840 pt.
**Почему.** У Telegram входящий уровень получает заглушки до первого кадра перехода и берёт чёткую картинку уходящей
ячейки, если она подходит по размеру.
**Сейчас у нас.** соблюдено (#499): плитки записывают ключ своей картинки по id файла, просмотр показывает её, пока
грузится копия 840 pt.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («A zoom's incoming cells get thumbnails before the first transition frame…»)*

#### 8.5.2 Из встроенного видео в просмотр — тот же плеер
**Правило.** Передавай играющий `AVPlayer` (или хотя бы `currentTime()`) из `InlineVideoView` в просмотр и обратно.
**Почему.** У Telegram просмотр забирает уже играющий узел — нового плеера и чёрного кадра нет, кадр растёт из пузыря.
**Сейчас у нас.** соблюдено (#499): `ViewerVideo` берёт уже созданный `AVPlayer` карточки
(`VideoPlaybackCenter.borrow`).
*Источник: `docs/native-hls-player.md` («Bubble to gallery: the gallery takes over the playing node»)*

#### 8.5.3 Открытие видео с позиции — позиция до старта
**Правило.** Когда появится продолжение с сохранённого места или ссылка на время — создавай `AVPlayerItem` и делай
`seek(to:)` до `play()`/`replaceCurrentItem`.
**Почему.** У Telegram без стартовой позиции плеер начинал с 0 и грузил начало, а перемотка приходила через 50 мс.
**Применимость.** Частично — на будущее: сейчас `AVPlayer(url:)` + `play()` всегда с нуля.
*Источник: `submodules/HLSPlayback/CLAUDE.md` («A caller that knows where playback starts passes it»); `docs/native-hls-player.md`*

#### 8.5.4 Закрытие просмотра возвращает в ячейку текущего элемента
**Правило.** Если появится переход «из плитки и обратно», закрытие летит в плитку того элемента альбома, на котором
стоит просмотр, а не того, по которому тапнули.
**Почему.** У Telegram карусель следует за текущим элементом галереи, и закрытие летит в его слот.
**Применимость.** Частично — анимированного перехода плитка ↔ просмотр у нас сейчас нет.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 collage & slideshow, «The slideshow follows the gallery's current item»)*

#### 8.5.5 Покрытие спойлера не перехватывает касания; первый тап раскрывает
**Правило.** По скрытому медиа первый тап только раскрывает, следующий — открывает просмотр; само покрытие касаний не
берёт.
**Почему.** У Telegram «пыль» неинтерактивна, и тап по скрытому медиа сразу открывал бы галерею.
**Сейчас у нас.** Соблюдено: `AttachmentView` — `if isHidden { revealed = true } else { open() }`, `spoilerCover` с
`.allowsHitTesting(false)`, состояние `revealed` отделено `.id(attachment.id)`.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 media spoiler, «The dust cover is NON-interactive»)*

### 8.6 Видео, предзагрузка, сеть

#### 8.6.1 Предзагрузка не трогает оригинал видео
**Правило.** Предзагрузка греет только постер; первый кадр из оригинала — только для видимой плитки. Сам ролик
предзагрузкой не качать никогда.
**Почему.** У Telegram предзагрузчики качали начало или весь оригинал HLS-видео (2,5 МБ и 21 МБ лишнего при открытии
«Избранного»), хотя плеер его не читает.
**Сейчас у нас.** соблюдено (#499): предзагрузка видео берёт только постер, оригинал не читает.
*Источник: `submodules/HLSPlayback/CLAUDE.md` («The chat prefetchers skip an HLS video's original file»); `docs/native-hls-player.md`*

#### 8.6.2 Видимое загружается раньше упреждающего; один файл — одна загрузка
**Правило.** Введи приоритет загрузок (видимое > упреждающее), не прерывая уже идущие; один и тот же файл не качается
дважды.
**Почему.** У Telegram части файла берутся с высшего приоритета, запрошенное дважды живёт только в высшей корзине,
упреждающее ждёт, пока плеер набирает буфер.
**Применимость.** Частично — `ImageDownloads`/`AttachmentURLProvider` уже делят запрос в полёте, но приоритета нет:
упреждающие картинки ленты конкурируют с видимыми.
*Источник: Network/CLAUDE — «Media downloads (`FetchV2`)»*

#### 8.6.3 Автозагрузка отдельно от автовоспроизведения
**Правило.** `ChatMediaPrefetcher` — одна загрузка на id вложения, отмена при уходе и смене медиа, без зависимости от
«играть»; освобождение — в `deinit`.
**Почему.** У Telegram видео качается по настройке даже при выключенном автовоспроизведении, с дедупликацией по id.
*Источник: `docs/instantpage-richtext.md` (rich-message video, «Auto-download is decoupled from autoplay», «Reuse & spoiler»)*

#### 8.6.4 Политику считает хост, вид получает готовое значение
**Правило.** Решение «качать автоматически / играть GIF» (сеть, режим экономии, настройки) считай в модели ленты или в
`ChatMediaPrefetcher`; вид получает готовый `Bool`.
**Почему.** У Telegram нижний модуль не знает семантики чата — только вызывает замыкания «качать?/играть?».
*Источник: `docs/instantpage-richtext.md` (rich-message video, «Policy is computed in the bubble, consumed as booleans»)*

#### 8.6.5 Видимость запускает воспроизведение без «мёртвого окна»
**Правило.** Анимированные GIF и видео в ячейке стартуют и когда созданы уже на экране, и когда появились позже —
проверь оба порядка событий.
**Почему.** У Telegram плеер, созданный до первой отметки видимости, подключается на ней, созданный позже — сразу с
текущей видимостью; иначе ролик стоит до следующей прокрутки.
*Источник: `docs/instantpage-richtext.md` (rich-message video, «Visibility gating has no dead-attach window»)*

#### 8.6.6 Плеер — в тот же вписанный прямоугольник, что постер
**Правило.** Встроенный `AVPlayerLayer`/GIF рисуй с `videoGravity = .resizeAspect` или в тот же кадр, что постер.
**Почему.** У Telegram плеер по `bounds` сплющивал вертикальное видео в ограниченную коробку, и постер с видео не
совпадали.
*Источник: `docs/instantpage-richtext.md` (rich-message video, «The inline player must be framed to the aspect-FITTED rect»)*

#### 8.6.7 Молчаливые отказы плеера ловить на устройстве
**Правило.** Наблюдай `AVPlayerItem.status` и `errorLog()` и проверяй медиа на iPhone, не только на симуляторе.
**Почему.** Формат, который `AVPlayer` не играет, даёт чёрный экран без ошибки; у Telegram отсутствующий декодер
принимал кадры и ничего не показывал, не написав в лог ни строки.
**Применимость.** Частично — своих декодеров нет, переносится наблюдение за `AVPlayer`.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («H264 Decoder Requires Two Build Flags… `NullVideoDecoder`»; «FFmpeg 7+ Removed `reordered_opaque`»)*

#### 8.6.8 Аппаратный декодер строже эталонного
**Правило.** Новый формат или параметры нарезки видео на сервере (HLS, постеры) проверяй воспроизведением в `AVPlayer`
на iPhone, а не только `ffprobe` и веб-плеером. Отдельно для сервера (`apps/api`): аудио может кончаться раньше видео —
сегменты не резать по концу аудиодорожки.
**Почему.** У Telegram поток, проходивший ffmpeg и свой парсер, VideoToolbox отвергал (длинные `skip_run`).
**Применимость.** Частично — касается сервера и приёмки.
*Источник: `third-party/subcodec/CLAUDE.md` («Known Issues»); `submodules/HLSPlayback/CLAUDE.md`, `docs/native-hls-player.md`*

#### 8.6.9 Новый кеш — только после замера повторов
**Правило.** Новые кеши (ссылок, ответов) вводи после замера повторов (сигнпост или счётчик «повторно в этом
процессе»), а не заранее.
**Почему.** У Telegram кеш обновлённых ссылок отложили, пока лог не покажет повторные обновления той же ссылки.
**Применимость.** Частично — `AttachmentURLProvider` уже кеширует подписанные ссылки до `expiresAt − 30 с`.
*Источник: Network/CLAUDE — «A refreshed file reference is not kept across fetches…»*

### 8.7 Звук и голосовые

#### 8.7.1 У аудиосессии один владелец активации
**Правило.** `AVAudioSession` включает и выключает одно место — `VoiceAudio.shared` (`Voice/VoiceRecorder.swift`).
Второй компонент не вызывает `setActive(false)` поверх чужого воспроизведения; ресурс прошлого голосового/видео
освобождается до старта следующего.
**Почему.** У Telegram вендорный код больше не может выключить системную сессию, а контекст прошлого звонка
списывается при создании следующего.
**Сейчас у нас.** Соблюдено: `VoiceAudio` выключает сессию, только если она всё ещё `.playAndRecord` и держателей нет;
`VoicePlayback` переключается через `VoiceAudio.shared.activatePlayback()`.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («activation and deactivation are owned by CallKit and `ManagedAudioSession`»;
«`SharedCallAudioContext` retires the previous call's context…»)*

#### 8.7.2 Запись голосового не вытесняет чужой звук высшего приоритета
**Правило.** При записи голосового не деактивируй чужую активную сессию (системный вызов, FaceTime) «под себя».
Прерывание (`AVAudioSession.interruptionNotification`) — это остановка записи с сохранением.
**Почему.** У Telegram деактивация сессии звонка роняла его аудио, поэтому запись никогда, даже временно, не вытесняет
`.voiceCall`.
**Сейчас у нас.** Соблюдено для прерываний: `VoiceRecorder` останавливает запись и оставляет её на прослушивание.
**Применимость.** Частично — звонков в приложении нет.
*Источник: `docs/app-unit-tests.md` (`TelegramAudioTests`)*

#### 8.7.3 Конец воспроизведения: короткие ролики и защита от рекурсии
**Правило.** Зацикливание и «досмотрено до конца» проверяй на очень коротких роликах и голосовых < 1 с. Обработчик
конца не вызывает синхронно `seek` + `play`, который снова вызывает обработчик: переходи через `Task`/главную очередь
и ставь защиту от повторного входа.
**Почему.** У Telegram ролик короче допуска конца (0,1 с) сразу «в конце», а пустой `seek` в ту же точку синхронно
перезапускал проверку конца — до переполнения стека.
**Сейчас у нас.** Соблюдено: зацикливания нет; `VoicePlayback` ловит конец тикером и делает `await player.seek(to: .zero)`
до `onFinish`.
**Применимость.** Частично — своего HLS-допуска у нас нет, `AVPlayer` (`MediaViewer.swift`, `PostMediaView.swift`,
`StoriesViews.swift`) ведёт конец сам.
*Источник: `docs/app-unit-tests.md` (`UniversalMediaPlayerTests`)*

#### 8.7.4 Ключ воспроизведения — вложение, не общий синтетический id
**Правило.** Состояние воспроизведения голосовых (`VoicePlayback`) ключуй по id вложения (в пределах сообщения), никогда
по URL файла или индексу в пузыре.
**Почему.** У Telegram все богатые сообщения получили один синтетический id `(0,0)`, и два аудио на экране делили
ползунок и кнопку.
**Сейчас у нас.** Соблюдено: `playback.currentID == attachment.id`.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 audio/music, «The playlist key is message-scoped»)*

#### 8.7.5 «Играет» — от плеера, кольцо загрузки — от загрузчика
**Правило.** Для голосовых и файлов «играет/пауза» бери из `VoicePlayback`, прогресс скачивания — из
`ChatFileDownloads`; не выводи одно из другого.
**Почему.** У Telegram это два разных сигнала из двух источников; выведенное одно из другого врёт при паузе во время
загрузки.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 audio/music, «The big control's play/pause comes from OUR playlist…»)*

#### 8.7.6 Мини-плеер ведёт к сообщению для любого источника звука
**Правило.** Если голосовые получат панель «сейчас играет», тап по ней ведёт к сообщению для любого вида источника.
**Почему.** У Telegram тап по панели мини-плеера не узнавал новый тип плейлиста и ничего не делал.
**Применимость.** Частично — мини-плеера нет.
*Источник: `docs/instantpage-richtext.md` (Rich-message media, «…the mini player bar needs its own tap arm»)*

### 8.8 Неприменимо к нам
- Свой видеописатель (VideoToolbox + mp4-муксер FFmpeg: длительность кадра, `MaxKeyFrameInterval`, DTS при B-кадрах,
  приминг AAC, оценка резерва `moov`; `MediaEditor/CLAUDE.md`) — экспорт у нас системный (`AVAssetExportSession`,
  `MediaPreparation.exportMP4`).
- Свой HLS-плеер (порт hls.js поверх `ChunkMediaPlayerV2`: уровни, ABR, буфер, поиск по опорному кадру;
  `submodules/HLSPlayback/CLAUDE.md`, `docs/native-hls-player.md` D1–D14) — HLS играет `AVPlayer`, ABR и буфер системные.
  Общий урок для сервера вынесен в 8.6.8.
- Измеритель пропускной способности для плеера (`DownloadThroughputMeter`, Network/CLAUDE) — своего плеера нет,
  `AVPlayer` оценивает скорость сам.

---
## §9. Данные, синхронизация, сеть, realtime

Как iOS-клиент получает, хранит и сверяет данные: границы слоёв (`APIClient`, `AppDatabase`, `RealtimeCoordinator`),
совместимость форматов со старыми сборками, догон по `seq`, запись в GRDB, повторы, сессия и карточки сообщений.
Главное: синхронизация не сдаётся на временной ошибке, ошибка никогда не выглядит как удаление, а позиция догона
двигается только тем, что реально применено по порядку.

### 9.1 Слои и единые точки входа

#### 9.1.1 Один фасад на подсистему; HTTP к API — только через `APIClient`
**Правило.** Запросы к нашему API с `Authorization` и refresh-cookie идут только через `Core/Network/APIClient.swift`
(через `*API`-структуры в `Core/`). Авторизованный клиент один — `AppServices.api = APIClient(authorization: session)`;
клиенты без авторизации заводятся только для публичных маршрутов (`AuthAPI`, `AuthRecoveryAPI`,
`InviteRegistrationAPI`, `ClientVersionAPI`). Realtime — один насос событий в `RealtimeCoordinator`, локальная база —
`AppDatabase`. Прямой `URLSession` допустим только для presigned-файлов (`ImageDownloads`, `AttachmentUploader`,
`ChatFileDownloads`, `VoicePlayback` и т. п.) и никогда не несёт токен сессии; заголовок `Bearer` вне `APIClient` —
только медиатокены камер (`SecurityCamerasView`, `UAdminCamerasViews`). Карточки сообщений не открывают свои сокеты и
не ходят в `URLSession` напрямую.
**Почему.** У Telegram слой API видит один модуль, ни одна сеть не стартует без входов из одной функции, а рантайм
виджетов достижим только через один фасад. Компилятор этого не гарантирует (модуль у нас один), поэтому это правило:
второй авторизованный клиент завёл бы свою очередь продлений и второй refresh в полёте.
*Источник: `submodules/MTProtoRustEngine/CLAUDE.md` («Networks get it only through `networkEngineInputs`»);
`submodules/TelegramApi/CLAUDE.md` («Only TelegramCore depends on TelegramApi … so don't add one»);
`docs/message-widgets-native-runtime.md` («M1d's invariants: One facade»)*

#### 9.1.2 Формат провода и хранилище живут в `Core`; GRDB не расползается по экранам, без псевдонимов
**Правило.** DTO сервера, `APIClient`/`Endpoint*` и записи базы — в `Sources/Core`; экраны работают с моделями ядра.
Новые места с `import GRDB` в `Features` не добавлять: наблюдение и запросы выносить в `Core` (как `ChatListQuery`,
`MessageStore`). Не заводить `typealias DB = DatabaseQueue` / `typealias Store = AppDatabase`, чтобы «спрятать»
зависимость: либо настоящая обёртка с узким API в `Core`, либо честный тип.
**Почему.** У Telegram сгенерированный API импортирует только ядро (в другом месте скомпилируется, но запрещено), ядро
не реэкспортирует Postbox, а псевдонимы на зонтичные типы названы переименованием без инкапсуляции.
**Сейчас у нас.** соблюдено (#499): GRDB только в `Core` (запросы в `Core/*/…Queries`, `AsyncValues` в `Core/Storage`),
страж `apps/ios/scripts/check_layers.sh` в CI без исключений.
**Применимость.** частично — Postbox/TelegramEngine нет, переносится принцип «слой хранения не протекает в UI».
*Источник: `CLAUDE.md` («Subsystem guides»: TelegramApi; «Postbox → TelegramEngine», правила 1–2)*

#### 9.1.3 Ядро не зависит от UI-фреймворков
**Правило.** Новый код в `Sources/Core` писать без `UIKit`/`SwiftUI`; UI-помощники — в `Features`/`DesignSystem`,
системные сервисы — за протоколом (как `BackgroundActivity` в `SessionStore`).
**Почему.** TelegramCore общий с macOS — ни UIKit, ни Display в нём нет; помощники с UIKit живут у потребителя. У нас
`Package.swift` объявляет и `.macOS(.v14)`, а ядро без UI проще тестировать.
**Сейчас у нас.** соблюдено (#499): `Core` без UIKit и SwiftUI (картинки — в `DesignSystem/Images`, пуши за протоколом),
страж `apps/ios/scripts/check_layers.sh`.
**Применимость.** частично — общего с macOS кода нет, переносится требование к новому коду.
*Источник: `CLAUDE.md` («Postbox → TelegramEngine», правило 7)*

#### 9.1.4 Доменные типы не стирать в `Any`
**Правило.** Модели сообщений, вложений, чатов (`MessageRecord`, `AttachmentRecord`, DTO) не передавать как `Any`,
`[String: Any]`, `AnyHashable` ради удобства; нужна гибкость — `enum` с ассоциированными значениями или обёртка с
узким API.
**Почему.** Стирание выбрасывает смысл типа; Telegram запрещает заменять протоколы `Media`/`Peer`/`Message` на
`Any`/`AnyObject` и при невозможности возвращает исходный тип с пометкой.
*Источник: `CLAUDE.md` («Postbox → TelegramEngine», правило 8)*

#### 9.1.5 API ядра меняется на месте, без дублей рядом
**Правило.** Меняя сигнатуру в `Core`, обновляй все вызовы в том же PR; не оставляй «старую + новую» перегрузку и
ничего «на всякий случай». Формат хранения при этом не меняется (см. 9.2.1).
**Почему.** У Telegram публичный API меняется на месте: добавочные перегрузки рядом со старой дробят API и оставляют
утечку навсегда.
*Источник: `CLAUDE.md` («Postbox → TelegramEngine», правило 10; шпаргалка «facade … changes its signature in place»)*

#### 9.1.6 Логику клиента строить по фактическому серверу; при расхождении верить ответу
**Правило.** Клиентскую логику realtime, догона и outbox проектируй по коду сервера (`apps/api/src/modules/chats`,
`apps/api/src/common/realtime`) и `docs/PROJECT.md`, а не по догадке. Если `docs/PROJECT.md` или `apps/api/openapi.json`
расходятся с фактическим ответом API — верь ответу (проверь запросом к Railway или моку), правь DTO и запиши
расхождение в `docs/PROJECT.md` (правило `AGENTS.md`: менял контракт — обнови PROJECT.md). Расхождение — вопрос к
серверу, а не повод молча «поправить на клиенте».
**Почему.** У Telegram все дефекты совместимости звонков оказались следствием неверной модели протокола собеседника;
при расхождении документации и сервера верен реальный провод, проверенный независимо.
*Источник: `docs/superpowers/specs/2026-10-11-tgcalls-compatimpl-v2-protocol-design.md` («The 13.0.0 protocol»);
`docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§5 W3, §8)*

#### 9.1.7 Непроверенное допущение о сервере записывать как открытое
**Правило.** Допущения о поведении `apps/api`, не проверенные на реальном ответе, помечай в коде или README как
непроверенные и проверяй по `apps/api/openapi.json` или запросом.
**Почему.** Telegram записал зависимость от того, что сервер дозаполнит документы, как «OPEN runtime risk», а не как
факт.
*Источник: `docs/instantpage-richtext.md` (Custom emoji in markdown messages, «OPEN runtime risk»)*

#### 9.1.8 Ограничения клиента — те же, что у сервера, в одном месте и со ссылкой
**Правило.** Лимиты, которые проверяет и сервер, держи в одном месте с комментарием-ссылкой на серверную константу, как
`ChatFolderLimits` («те же, что проверяет сервер (`CHAT_FOLDER_LIMITS`)»). Для карточек (длина вопроса, число
вариантов опроса, пунктов чек-листа) — так же; меняется на сервере — меняй одновременно.
**Почему.** У Telegram каждый лимит — строка таблицы со ссылкой на константу политики; клиент не изобретает своих чисел.
*Источник: `docs/message-widgets-native-runtime.md` («Limits»)*

#### 9.1.9 Общий формат между клиентами — одна спецификация и тест паритета
**Правило.** Форматы и правила, которые читают iOS, Android и веб (шеринг профиля `ProfileShare` ↔ `parseProfileShare`
в вебе, разметка `RichText`, ссылки `DeepLink`, расчёт среднего, видимость, чётность недели), проверяй общими примерами
в `Tests/StudentHubTests/ParityTests.swift` («обязан совпадать с вебом»). Меняя формат — правь все клиенты и тест в
одной задаче; новое общее правило — сразу с парным тестом.
**Почему.** У Telegram формат, который читают разные реализации, вынесен и закреплён тестом; решающие таблицы политики
проверяются против фикстур апстрима.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («The frame layout is shared, not reimplemented»);
`docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§4 «My calls», п. 1);
`docs/superpowers/specs/2026-10-29-message-widgets-cpu-clock-limits-design.md` (Goals, п. 2)*

#### 9.1.10 Выключатель функции — один и проверяется на каждом входе; выключено = прежний путь
**Правило.** Раздел, недоступный роли или серверу (`MoreSection`, `WorkspaceView.libraryEnabledKey`), прячется одним
признаком, который проверяет каждая точка входа: вкладка, диплинк `AppRouter`, пуш. Выключенный путь не бросает
ошибку, по которой что-то повторит запрос. Рискованный вид или карточку вводи под флагом `App/PerformanceFlags.swift` с
безопасным прежним путём; серверный выключатель — через существующий публичный конфиг (`GET /client-version` или новый
ключ), и выключение вступает без перезапуска. Предпочитай `if`-флаг `#if`-у (неактивный `#if` не проверяется
компилятором); нужен `#if` — определи условие и в `Package.swift` (`swiftSettings: .define`), и в `project.yml`, иначе
две сборки разойдутся.
**Почему.** У Telegram «запаркованный» API отвечает пустым успехом (иначе повторы), у каждой функции один шлюз, блоки
`#if` маленькие; виджеты рисуются только при включённом флаге и без серверного kill switch, а закрытый шлюз возвращает
прежний вид.
**Применимость.** частично — серверного выключателя карточек у нас нет.
*Источник: `submodules/TelegramApi/CLAUDE.md` («Parked APIs»); `docs/superpowers/specs/2026-10-13-message-widgets-design.md`
(§1 «Gate», §6); `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` (§5 V1)*

#### 9.1.11 Автоотключение рискованной подсистемы привязывать к версии сборки
**Правило.** Если появится серверный выключатель или локальная отметка «отключить после падений», ключуй её версией
сборки (`AppConfiguration.clientVersion`), чтобы исправленная сборка не унаследовала отключение. До тех пор рискованное
держится под `PerformanceFlags` до проверки на iPhone.
**Почему.** У Telegram два падения движка за сутки выключают его на сутки, но отметки действуют только для сборки,
которая их записала.
**Применимость.** частично — механизма учёта падений у нас нет, правило на случай его появления.
*Источник: `submodules/MTProtoRustEngine/CLAUDE.md` («a local crash-loop fallback … Each part counts only for the build
that wrote it»)*

#### 9.1.12 Флаг с соседним смыслом не управляет чужим поведением
**Правило.** Не завязывай поведение на признак «рядом по смыслу» (роль вместо модуля вуза, `twoFactorEnabled` вместо
отдельного признака) — заведи свой явный признак.
**Почему.** У Telegram флаг `isConference`, похожий по смыслу, молча урезал исходящее видео до одного слоя.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («`isConference` is NOT read by this engine»)*

#### 9.1.13 Связанные настройки ставятся вместе, из одного решения
**Правило.** Настройки, работающие только вместе, задавай в одном месте рядом: `httpCookieStorage = nil` +
`httpShouldSetCookies = false` + `httpCookieAcceptPolicy = .never` в сессии `APIClient`; запись refresh-токена в
связку ключей и в `RefreshCookieJar`.
**Почему.** У Telegram опция без парной фабрики давала тихо неработающий транспорт; обе ставятся из одного булева.
*Источник: `docs/superpowers/specs/2026-09-16-tgcalls-mtproto-dtls-slot-design.md` (Invariants);
`docs/superpowers/plans/2026-09-16-tgcalls-mtproto-dtls-slot.md` (Global Constraints)*

#### 9.1.14 Узкая замена вместо опции, которая выключает лишнее
**Правило.** Если системная настройка выключает больше нужного (`URLSessionConfiguration.httpCookieStorage = nil`
убрал и нужную refresh-cookie — отсюда свой `RefreshCookieJar`), не латай последствия по местам: сделай узкую замену и
опиши в комментарии, почему так.
**Почему.** У Telegram `disable_encryption` выключил ещё сертификаты, отпечатки и SCTP; три патча-возврата дали шторм
пересогласований.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` (история); `docs/superpowers/specs/2026-09-16-tgcalls-mtproto-dtls-slot-design.md`
(Background)*

#### 9.1.15 Конфигурация задаётся один раз; ленивое разрешение кеширует только успех
**Правило.** `AppConfiguration` (адрес API, веба) неизменна на время процесса. Ленивые вычисления, зависящие от
доступности (связка ключей, база до разблокировки — `DatabaseHolder`), не кешируют неудачу и повторяют после
разблокировки.
**Почему.** У Telegram повтор той же конфигурации допустим, другая — отказ; разрешение группы связки ключей кеширует
только успех и повторяется, когда связка стала доступна.
*Источник: `docs/passcode.md` («Configuration is immutable … caches only success»)*

#### 9.1.16 Диагностика показывает действующее значение, а не запрошенное
**Правило.** Там, где фактическое состояние может отличаться от заданного (`PerformanceFlags` с переопределением
`SH_PERF_FLAGS`, ветки `#available(iOS 26, *)`, сборка xtool без Sentry), в логах и отладочных экранах показывай
действующее значение. Прежде чем делать выводы о поведении флага на iPhone, убедись, какое значение действует в этой
сборке.
**Почему.** У Telegram переключатель движка пишет желание, а строка рядом показывает фактический движок: выбор может быть
отклонён фабрикой или конфигом.
**Применимость.** частично — отладочного экрана движков нет, принцип переносится на флаги.
*Источник: `submodules/MTProtoRustEngine/CLAUDE.md` («the `Engine:` row … shows what the account actually runs»)*

#### 9.1.17 Служебные исходящие события логируются целиком, без секретов
**Правило.** Для расследований realtime (подписки `chat:join`, `auth:refresh`, догон по `seq`) пиши в отладочный лог
событие и параметры целиком — кроме токенов и содержимого сообщений (`docs/BACKEND_RULES.md §13`). В выводах указывай,
измерено или выведено.
**Почему.** У Telegram следующий лог должен отвечать, что именно попросили; степень уверенности («inferred, not
measured») записывается.
**Применимость.** частично — отдельного журнала служебных событий у нас нет.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («it is logged whole … Causation … is inferred, not measured»)*

### 9.2 Совместимость форматов и неизвестные значения

#### 9.2.1 Формат на диске меняется только вперёд: новой миграцией или версией
**Правило.** Схема GRDB — только новой миграцией в `Core/Storage/AppDatabase+Migrations.swift`; применённые миграции
не править, `eraseDatabaseOnSchemaChange` не включать. Формат `ScreenCacheStore` меняется подъёмом номера схемы. При
рефакторинге DTO и записей `CodingKeys` и имена колонок неизменны. Ключи `UserDefaults` (`storage.owner`,
`ScheduleModel.syncedKey`, `appearance.theme`) и Keychain не переименовывать без переноса значения. Меняется API —
формат хранения остаётся.
**Почему.** У Telegram сохранённые кодировки (PostboxCoding, FlatBuffers, настройки темы) остаются побайтно прежними,
сырое хранение прячется за новой поверхностью; иначе старые сборки и расширения не прочтут данные.
**Сейчас у нас.** соблюдено: `eraseDatabaseOnSchemaChange` сознательно не включён (`AppDatabase+Migrations.swift:12`).
*Источник: `CLAUDE.md` («Postbox → TelegramEngine», правило 10; «Subsystem guides»: Theme settings);
`docs/state-sync.md` («Changing state sync safely»); `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§2);
`docs/superpowers/postbox-refactor-log.md` (правило 10, `RichTextDraft`)*

#### 9.2.2 Новое поле — опциональное, и его отсутствие значит «признака нет»
**Правило.** Новая колонка в миграции GRDB — `NULL` или умолчание, означающее «признака нет»; новые поля DTO,
`MessageExtras` (JSON-колонка `extras`), `Codable` в `UserDefaults` и кеше экранов — опциональные, отсутствие = старое
поведение. Писать поле только когда оно отличается от умолчания, чтобы обычные данные остались прежними. Тест в
`AppDatabaseTests`/`MessageSyncTests` на чтение `extras`, записанного прошлой сборкой.
**Почему.** У Telegram новое поле пишется только при отличии от умолчания, тесты сверяют байты с master; трёхзначное
хранение «0 = nil» читает старые страницы без изменений; новые ключи у старых сообщений просто отсутствуют.
*Источник: `submodules/TelegramUIPreferences/CLAUDE.md` («With bubbles on, the stored bytes are what they were»);
`docs/instantpage-richtext.md` (Task-list checkboxes, «Tri-state persistence»); `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md`
(§5 W1); `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` (§10); `CLAUDE.md` («Subsystem guides»: Theme settings)*

#### 9.2.3 Меняя смысл или форму значения — переводи старое при чтении на каждой границе, пиши только новое
**Правило.** Если меняешь набор значений или форму данных (`@AppStorage`, `UserDefaults`, записи GRDB, DTO, кеш
экранов) — функция перевода старых значений при чтении (с тестом, для кеша — `ScreenCacheTests`), запись только
новых. Каждая граница декодирования (декодер DTO, чтение GRDB, кеш экранов) принимает обе формы. Переименование или
смена типа поля `extras` = чтение старого и нового вида.
**Почему.** У Telegram старое число колонок сетки (2–12) отображается в новые уровни при чтении; старая форма цитаты
поднимается в новую на каждой границе (API, кеш, FlatBuffers).
*Источник: `submodules/TelegramUI/Components/PeerInfo/PeerInfoVisualMediaPaneNode/CLAUDE.md` («Levels»);
`docs/superpowers/specs/2026-10-28-shared-media-grid-design.md` («Stored level»); `docs/instantpage-richtext.md`
(blockQuote nested blocks, «Legacy shapes lift … at every decode boundary»)*

#### 9.2.4 Неизвестное сохранённое значение перечисления — запасной вариант, никогда `!`
**Правило.** `AppearanceTheme(rawValue:)` из `@AppStorage("appearance.theme")`, перечисления в записях GRDB и в DTO —
только с запасным значением (`?? .system`, кейс `unknown` при декодировании). Новый кейс не должен ронять предыдущую
версию приложения после отката TestFlight → старая сборка.
**Почему.** У Telegram старые сборки и расширения разворачивают сырое значение темы через `!` на старте; поэтому новые
темы пишутся в старые ключи как Classic/Night, а тест закрепляет все сочетания. Новое raw-значение (`raw 4`) не читается
старой сборкой.
*Источник: `submodules/TelegramUIPreferences/CLAUDE.md` («Older builds crash on a theme they do not know»);
`CLAUDE.md` («Subsystem guides»: Theme settings); `docs/app-unit-tests.md` (`TelegramPresentationDataTests`);
`docs/richtext-composer.md` (§8)*

#### 9.2.5 Неизвестное значение с сервера — `.unknown`, а не падение
**Правило.** Сервер наш и обновляется раньше клиента: новый тип сообщения, вложения, роли, код ошибки обязан
декодироваться в `.unknown(raw)` и показываться заглушкой, а не `fatalError`/`preconditionFailure`/падением декодера
всей страницы. Образец — `APIErrorCode` (`default: self = .unknown(rawValue)`). Необязательные поля в DTO; при
неожиданном ответе — `Observability.unexpectedResponse(statusCode:kind:)` с именем типа, а не с телом. Обёртки-классы
не сравнивать через `===`.
**Почему.** У Telegram обёртка `EngineMedia.init` падает на незнакомом классе, поэтому всё самодельное обязано
объявлять протокол; неизвестный конструктор всегда логируется со своим id.
**Сейчас у нас.** соблюдено для кодов ошибок: `Core/Network/APIError.swift:31,56`.
*Источник: `CLAUDE.md` («Engine wrapper cheat sheet»); `submodules/TelegramApi/CLAUDE.md` («Unknown constructors are
logged with their exact id»); `docs/richtext-composer.md` (§8)*

#### 9.2.6 Массивы декодировать поэлементно, неизвестный элемент пропускать
**Правило.** Массивы в DTO декодируй поэлементно с пропуском или заменой неизвестного (`Role.unknown`, неизвестный вид
вложения → файл), чтобы одно новое значение с сервера не роняло весь ответ.
**Почему.** У Telegram старая сборка не декодирует новый вид действия, и мягкий декодер выбрасывает только блок с ним,
а не документ.
*Источник: `docs/instantpage-richtext.md` (Inline buttons, Authoring, «A build older than .userProfile cannot decode it»)*

#### 9.2.7 Неподдерживаемое содержимое — общая плашка «Обновите приложение», серия — одна, подпись остаётся
**Правило.** Неизвестный вид сообщения, вложения или системного события рисуется одной общей плашкой «Обновите
приложение» (общий вид для чата, ленты, уведомлений), а не пустым пузырём и не падением. Подряд идущие неподдерживаемые
блоки — одна плашка. Если не разобралось только медиа — подпись сообщения остаётся видна в обычном пузыре.
**Почему.** У Telegram всё, что сборка не декодирует, — `.unsupported` с общей плашкой; серия — одна плашка; компонент
общий с отдельным пузырём, подпись сохраняет пузырь.
*Источник: `docs/instantpage-richtext.md` (Unsupported blocks); `submodules/InstantPageUI/CLAUDE.md` (Unsupported blocks);
`submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` (вступление)*

#### 9.2.8 Новый вид сообщения обязан деградировать в читаемый текст на старом клиенте
**Правило.** Контракт: новый вид сообщения несёт текст-замену в `content` (или сервер подставляет его для клиентов ниже
версии из `X-Client-Version`). Клиент для пустого `content` без известных `extras` рисует заглушку «Сообщение не
поддерживается этой версией — обновите приложение», как уже делается для неизвестного `systemType` («Событие в чате»,
ключ `chats.system.unknown`).
**Почему.** У Telegram, пока формат не утверждён, виджет едет блоком кода, который любой старый клиент покажет как код;
в списке чатов и уведомлениях — заглушка.
**Сейчас у нас.** расходится: заглушки для пустого сообщения неизвестного вида нет — будет пустой пузырь и пустое превью
(`Core/Chats/ChatListQuery.swift:113` `specialPreview` знает только известные виды; заглушка есть лишь для `systemType`:
`Thread/MessageBubbleView.swift:992`, `ChatListView.swift:945`).
*Источник: `docs/superpowers/specs/2026-10-13-message-widgets-design.md` («Decisions», Wire format);
`docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` (§2, п. 1)*

#### 9.2.9 Смысл события или поля под старым именем не менять
**Правило.** У iOS-сборок в поле нет мгновенного обновления. Смысл существующего события сокета, поля DTO или формата
текста (`ProfileShare`, nonce outbox) не меняй под тем же именем: новое имя или поле, сервер поддерживает оба, пока живы
старые сборки (`X-Client-Version`, рычаг — `ForcedUpdateView`). Значение по умолчанию для неизвестной версии — осознанная
ветка, а не скопированный `default`. Флаг, меняющий провод, обязаны понимать все стороны.
**Почему.** У Telegram сборка 14.0.0 до 11.10.2026 не работает с более поздней под той же версией; копирование
`default` из соседней карты перевело бы все звонки на V2.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («A 14.0.0 build from before 2026-10-11 …», «an unknown version is V3»,
`network_signaling_nosctp`)*

#### 9.2.10 Наружу — старая форма, если её хватает
**Правило.** Пока старые версии приложения в руках людей, серверу и клиентам не вводить новый формат там, где старый
выражает то же (контракт — `docs/PROJECT.md`).
**Почему.** У Telegram простая цитата уходит старым конструктором, чтобы её поняли старые получатели.
**Применимость.** частично — формат определяет сервер `apps/api`.
*Источник: `docs/instantpage-richtext.md` (blockQuote nested blocks, «Outbound stays on the legacy wire constructor»)*

#### 9.2.11 Тест «туда-обратно» — продовым кодеком; поле, которое мы шлём, обязано вернуться
**Правило.** Записи GRDB (`DraftRecord`, `MessageRecord` и пр.) проверяй раунд-трипом через настоящую `AppDatabase` с
миграциями, а не через `JSONEncoder`. Для каждого DTO и `Record` с полями, которые клиент сам отправляет, держи тест
«закодировать → раскодировать → равно» (`APIContractTests`, `AppDatabaseTests`).
**Почему.** У Telegram JSON-раунд-трип в тесте маскировал падение реального кодировщика черновика; а разбор ответа API
жёстко ставил `language: nil`, отправка язык сохраняла, эхо теряло — подсветка не работала нигде, и никто не заметил.
**Применимость.** частично — Postbox нет, переносится «тестировать продовый кодек».
*Источник: `docs/richtext-composer.md` (§2 «Codable (drafts) goes through `AdaptedPostbox…`»); `docs/instantpage-richtext.md`
(Syntax highlighting, «InstantPageBlock(apiBlock:) hard-coded language: nil»)*

#### 9.2.12 Новые поля сервера сохранять сразу, до UI
**Правило.** Новые поля, появившиеся в API, сохраняй в GRDB и кеш сразу, даже если UI их ещё не показывает, — чтобы
будущий UI не требовал миграции и перезагрузки истории.
**Почему.** Telegram сначала добавил модели и хранил их без потерь, чтобы отрисовка стала чистой правкой вида без
миграции кеша.
*Источник: `docs/instantpage-richtext.md` (Inline buttons & document blocks, вступление)*

#### 9.2.13 Состояние — отдельным полем, а не зашитым в строку
**Правило.** Признаки сообщений (системный тип, чек-лист, стикер) — полями `MessageExtras`/записи, не префиксами в
`content`.
**Почему.** Прототип Telegram прятал флаг в строку номера пункта и не мог выразить «нумерованный и с галочкой».
*Источник: `docs/instantpage-richtext.md` (Task-list checkboxes, «checked is orthogonal to num»)*

#### 9.2.14 Идентификаторы — `String`, счётчики — `Int`, имена полей — из контракта
**Правило.** Идентификаторы из JSON — `String`; счётчики — `Int` (64 бита); имена полей — только из контракта
(`APIContractTests`), не по памяти.
**Почему.** У Telegram переполнение `int_value()` для uint32 > INT_MAX и опечатка имени поля (`ssrcs` вместо `sources`)
ломали молча.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («json11 `int_value()` Overflows», «Join Payload JSON Field Name»)*

#### 9.2.15 Не полагаться на то, что сервер сохраняет порядок и идентификаторы
**Правило.** В списках, где сервер может переупорядочить или пересоздать элемент (аватары профиля, закреплённые, папки
чатов), «текущий» ищи по признаку, а не по позиции; при смене id того же содержимого не перекачивай кешированное
(`ImageDiskCache`, ключи по id медиа).
**Почему.** У Telegram сервер при возврате старого фото кладёт копию с новым id на старое место; рисование поверх первого
элемента показывало фото дважды.
**Применимость.** частично — сценарий с аватарами Telegram у нас не воспроизведён, переносится принцип.
*Источник: `docs/app-unit-tests.md` (`PeerAvatarGalleryUITests`)*

#### 9.2.16 Режимная настройка — через один аксессор
**Правило.** Режимов темы у нас нет (система/светлая/тёмная — одно значение). Если появится настройка, зависящая от
режима (обои на тему, отдельно для тёмной), читай и пиши её только через один аксессор.
**Почему.** У Telegram выбор темы идёт через `currentModeTheme`, чтобы выбор в одном режиме не трогал другой.
**Применимость.** частично — правило на будущее.
*Источник: `submodules/TelegramUIPreferences/CLAUDE.md` («Read and write the theme choice through `currentModeTheme`»)*

### 9.3 Догон и позиция синхронизации

Соответствие понятий: pts/getDifference Telegram = `ChatRecord.lastSeq` / `GET /chats/:id/updates?since=&sinceTs=`;
`differenceTooLong` = `ChatUpdatesDTO.overflow`; history fill = `MessageStore.save(messages:)`/`replaceHistory`;
chat-list fill = `ChatStore.save(chats:)`; notification extension = тихий пуш в самом приложении.

#### 9.3.1 Синхронизация не сдаётся на временной ошибке
**Правило.** Любой путь, который догоняет состояние (догон чата `ChatThreadModel.catchUp`, обновление списка после
переподключения, досылка очереди, переподключение сокета), при временной ошибке (`ActionFailureKind.transient`: нет
связи, 5xx, 429) повторяет сам с паузой 2 → 60 с с разбросом (образцы — `OutboxService.scheduleRetry`,
`RealtimeCoordinator.scheduleReconnect`) и останавливается только на ответе по существу (`.rejected`), отмене
(`.cancelled`) или выходе из аккаунта. «Запасной путь, который больше никто не спросит» — тоже «сдаться». Обратное
тоже обязательно: отказ по существу (403, 422) не повторяется вечно — строка уходит в «не отправлено» без автоповтора.
Исключения записывать поимённо в карту синхронизации. Ошибка отдельного события не останавливает насос `pump`.
**Почему.** Правило владельца Telegram: «мы никогда не бросаем синхронизацию и загрузку истории» — временная ошибка
даёт повтор с растущей паузой без конечной ветки «сдаёмся»; повтор заканчивает только ответ сервера по существу или
выход.
**Сейчас у нас.** соблюдено (#499): `catchUp` и обновление списка после переподключения повторяют временную ошибку с
паузой 2 → 60 с; 403/422 при отправке помечают строку `sendRejected` без автоповтора, очередь идёт дальше.
*Источник: `CLAUDE.md` («Subsystem guides»: Account state sync); `submodules/TelegramCore/Sources/State/CLAUDE.md`
(«Never give up»); `docs/state-sync.md` (инвариант 12); `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md`
(§2 «Owner rules»); `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§6)*

#### 9.3.2 Позиция двигается только по порядку: разрыв по `seq` — догон
**Правило.** `seq` в чате растёт на 1 за сообщение. В `RealtimeCoordinator.save` и `MessageStore.liftLastSeq` поднимай
позицию, только если `seq == lastSeq + 1` (или ответ догона сам несёт непрерывный хвост); `seq <= lastSeq` — уже есть;
`seq > lastSeq + 1` — сообщение сохранить, `lastSeq` не трогать и поставить догон этого чата с прежней позиции. Ложная
тревога стоит одного пустого `GET …/updates` — это дешевле молча потерянного сообщения. Сначала подтвердить на сервере,
что `seq` видимых участнику сообщений идёт без пропусков (очистка «для себя», скрытые); если нет — всё равно считать
разрывом `seq > lastSeq + 1` и догонять.
**Почему.** У Telegram обновление с `pts` применяется, только если локальное значение ровно `pts − pts_count`; всё
остальное — разрыв, который закрывает запрос разницы. Позиция двигается только применённым.
**Сейчас у нас.** соблюдено (#499): сокет двигает позицию догона (`syncSeq`) только по порядку; сообщение через разрыв
сохраняется, открытый чат догоняет по `gapVersion`.
*Источник: `CLAUDE.md` («Subsystem guides»: Account state sync); `docs/state-sync.md` («Interpretation and sequencing»,
«Channel pts rule»); `docs/state-sync-audit-2026-10.md` (§5 «Gap detection»); `submodules/TgVoipWebrtc/CLAUDE.md`
(«classified on receipt … applied one at a time»)*

#### 9.3.3 Позицию догона фиксировать на момент обрыва, до следующих событий
**Правило.** После `.connected` позицию для `catchUpAfterReconnect` бери на момент обрыва или подключения: запомни её в
координаторе до обработки следующих событий (или чини корнем по 9.3.2).
**Почему.** У Telegram продолжение догона ставится в голову очереди в том же блоке, где закончился шаг; пуши, пришедшие
во время запроса, применяются после — иначе «дыра» и лишний запрос.
**Сейчас у нас.** соблюдено (#499): чинено корнем по 9.3.2 — позиция `syncSeq` не перескакивает разрыв, и событие насоса
не может сдвинуть её мимо пропущенного.
*Источник: `docs/state-sync.md` (инварианты 4 и 11, `DifferenceCharacterizationTests.testSliceContinuationRunsBeforeGroupsPushedMidPoll`)*

#### 9.3.4 Страница списка чатов не двигает позицию догона
**Правило.** Развести два смысла `ChatRecord.lastSeq`: «номер последнего сообщения» (превью списка) и «до какого номера
переписка в базе непрерывна» (позиция `?since=`). Завести отдельный столбец позиции догона новой миграцией в
`AppDatabase+Migrations.swift`; двигают его только догон, непрерывная страница истории и сообщение по порядку. Список
чатов пишет только превью и номер последнего.
**Почему.** У Telegram заполнение списка чатов позиции не двигает — иначе всё между старой позицией и последним
сообщением теряется навсегда; оно оставляет «дыру», которую закроет загрузка истории. Прогон с моделью сервера нашёл
«призрака» за первой страницей диалогов.
**Сейчас у нас.** соблюдено (#499): позиция догона — отдельная колонка `syncSeq`, страница списка её не двигает.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` (сброс `differenceTooLong`); `docs/state-sync.md`
(инварианты 14, 28); `docs/superpowers/reports/2026-10-25-state-sync-truth-run.md` (§9)*

#### 9.3.5 Отметка времени догона — из ответа сервера; диапазоны — по `seq`
**Правило.** Границы окон и курсоров строй по `seq` (min/max), а не по первому/последнему в ленте (лента сортирована
по `createdAt`, неотправленное без `seq` — в конце). `sinceTs` для `GET …/updates` бери из `syncedAt` прошлого ответа
(сервер его отдаёт — «момент до чтения по часам сервера»), а не из `messages.last?.createdAt`: последняя строка может
быть своей неотправленной с часами телефона, и правки за расхождение часов пропадут. Вопрос к серверу: `mutated` и
`deletedIds` режутся `take: 200` без признака переполнения — неполную дельту клиент примет за полную.
**Почему.** У Telegram границы проверки строятся по минимуму/максимуму id (импортированная история идёт не по времени),
а новая позиция берётся из самого ответа, а не отдельным запросом.
**Сейчас у нас.** соблюдено (#499): `sinceTs` берётся из `syncedAt` ответа сервера.
*Источник: `docs/superpowers/reports/2026-10-15-difference-too-long-exploration.md` («Build min_id/max_id from the min
and max ids», «take pts from the constructor»)*

#### 9.3.6 Границы диапазонов: включительно/исключительно и тесты на края
**Правило.** На каждую ограниченную выборку по `seq` (`messages(chatID:aroundDate:)`, `lowerFloor`, `since` в догоне:
сервер берёт `seq > since`; окно — `seq < target` / `seq > target` плюс сама цель) — тест на края: первое сообщение
чата, окно из одного сообщения, `since = lastSeq` при пустом хвосте, переход к первому сообщению. Низ диапазона не
выводить догадкой.
**Почему.** Две потери сообщений у Telegram нашлись только моделью сервера: исключительная граница `max_id` теряла
сообщение 1 у «дыры» из одного id, `min_id 1` — первый пост канала.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («The around fill learns the top from the server»);
`docs/state-sync.md` («Holes and history fills»); `docs/superpowers/reports/2026-10-25-state-sync-truth-run.md` (§4, §9)*

#### 9.3.7 Позиция пишется в той же транзакции и после данных
**Правило.** В любом пути догона позиция пишется после всего содержимого в той же `database.writer.write`; никогда
отдельной транзакцией «до» или «после».
**Почему.** У Telegram запись позиций идёт после содержимого в той же транзакции; содержимое читает старую позицию.
**Сейчас у нас.** соблюдено: `MessageStore.apply` — правки, удаления, затем `liftLastSeq` в одной `write`
(`Core/Chats/MessageStore.swift:29–44`).
*Источник: `docs/state-sync.md` (инвариант 18); `docs/state-sync-audit-2026-10.md` (§8)*

#### 9.3.8 Запись по снимку — с проверкой «ничего не сдвинулось»
**Правило.** Ответ догона, начатого от `since = X`, перед перестроением (overflow, `replaceHistory`) сверяй внутри
транзакции записи: позиция чата не изменилась с момента запроса. Изменилась — ничего не стирать, повторить догон.
Монотонные поля (`lastSeq` через `max`) этой проверки не требуют.
**Почему.** У Telegram результат, построенный от снимка, пишется, только если сохранённая позиция всё ещё равна снимку;
так решаются гонки двух опросов одного чата.
*Источник: `docs/state-sync.md` (инвариант 17); `docs/state-sync-audit-2026-10.md` (§4 «P0 verifyTransaction»)*

#### 9.3.9 Ошибка — не удаление
**Правило.** Удалять или скрывать строку из `message`/`chat` можно только по явному ответу сервера (`deletedIds`,
`message:deleted`, `message:hidden`, 404 с кодом `NOT_FOUND` по конкретному id). Ошибка догона или страницы никогда не
ведёт к `clearHistory`, `removeHidden` или «пустой ленте». Классифицировать ошибку — `ActionFailureKind(error)`.
**Почему.** У Telegram ни сбой запроса, ни таймаут, ни FLOOD_WAIT не означают «сообщения нет»; валидатор, удалявший всё
при сбое проверки, назван дефектом.
**Сейчас у нас.** соблюдено: удаления — только по событиям и `deletedIds`. Держать при любых правках.
*Источник: `docs/state-sync.md` (инвариант 14, «Holes and history fills»);
`docs/superpowers/reports/2026-10-15-difference-too-long-exploration.md` («Design implications»)*

#### 9.3.10 Переполнение догона: сначала скачать, потом одной транзакцией заменить
**Правило.** На `overflow` сначала скачай последнюю страницу, затем одной транзакцией запиши её, убери отправленные
строки вне окна и выстави позицию. Не вышла страница — история остаётся как была.
**Почему.** У Telegram сброс сначала получает всё нужное, затем одной транзакцией перестраивает хранилище и ставит
позицию; процесс, убитый посередине, просто повторяет сброс.
**Сейчас у нас.** соблюдено (#499): на overflow сначала качается последняя страница, потом заменяется история.
*Источник: `docs/state-sync.md` («`differenceTooLong` and the account reset», инварианты 11, 15);
`docs/superpowers/reports/2026-10-15-difference-too-long-exploration.md` («Ordering to copy from Android»)*

#### 9.3.11 Неотправленное и локальное не стираются никогда
**Правило.** Перекачка истории не трогает неотправленное (`sendState != sent`), черновики (`draft`) и активную
трансляцию геопозиции. `eraseAll` — только при смене человека на устройстве.
**Почему.** У Android Telegram `DELETE` при сбросе не фильтровал `send_state` и унёс бы неотправленное; tdlib явно
сохраняет исходящую живую геопозицию.
**Сейчас у нас.** соблюдено: `clearHistory`, `replaceHistory`, `clearHistory(from:to:)` фильтруют `sendState == sent`
(`Core/Chats/MessageStore.swift:85–150`).
*Источник: `docs/superpowers/reports/2026-10-15-difference-too-long-exploration.md` (Android, tdlib)*

#### 9.3.12 Сверка страницы с базой: удалять только в покрытом диапазоне и только подтверждённое
**Правило.** Если вводить сверку: страница сервера непрерывна по `seq`, поэтому отправленные строки с `seq` в `[min, max]`
страницы, которых нет в ответе, помечай `deletedAt` (мягко, как сервер) в той же транзакции — кроме строк, изменённых
после начала запроса (нужна метка версии строки или сравнение с прочитанным в начале), и никогда неотправленных.
Диапазон закрывать не дальше последнего подтверждённого.
**Почему.** У Telegram отсутствующее в ответе удаляется только после ответа по существу и только если строку не
переписали, пока шёл запрос (решения владельца: «не вернувшееся считается удалённым», «написанное во время проверки
остаётся под своей дырой»).
**Сейчас у нас.** соблюдено (#499): подтверждённые строки внутри диапазона страницы, которых нет в ответе, получают
`deletedAt`.
**Применимость.** частично — механизма сверки нет, правило для его введения.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («A history fill … confirms first»); `docs/state-sync.md`
(«Holes and history fills», инвариант 14); `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§6e–6h)*

#### 9.3.13 Альтернатива стиранию на overflow — пометка «требует сверки» (решение владельца)
**Правило.** Вариант для обсуждения с владельцем: на `overflow` не стирать историю, а пометить её «не сверена» (номер
поколения на чате) и сверять страницами окно, которое человек смотрит. Сейчас выбран вариант «стереть», как у Android
Telegram.
**Почему.** У Telegram после потери непрерывности канал не стирается: сохранённое ниже отметки помечается и лениво
сверяется видимым окном пачками по 64.
**Применимость.** частично — вариант для обсуждения.
**Сейчас у нас.** соблюдено (волна 5): на `overflow` история не стирается — последняя страница ложится поверх, ниже ставится граница `unsyncedBelow`, при прокрутке страницы сверяются (9.3.12) и граница опускается; явная очистка сервером по-прежнему стирает (`MessageStore.resetAfterOverflow`, `ChatThreadModel.revalidateOlder`, `docs/IOS_SYNC_MAP.md`).
*Источник: `docs/superpowers/reports/2026-10-15-difference-too-long-exploration.md` («channel-revalidation», «Design
implications»)*

#### 9.3.14 Локальная очистка не засоряет журнал удалений
**Правило.** Если появится журнал недавних удалений (для 9.5.2), то `MessageStore.clearHistory` (overflow),
`replaceHistory` (окно истории) и `removeHidden` — локальные удаления: в журнал их не писать или забывать сразу.
**Почему.** У Telegram отладочный сброс без `forgetRecentlyDeletedMessages` на 5 минут запрещал сохранять эти сообщения
и закрывал дыру над пустотой.
**Применимость.** частично — журнала у нас нет.
**Сейчас у нас.** соблюдено (волна 5): несверенное ниже `unsyncedBelow` показывается из базы и сверяется при прокрутке, окно ленты не опускается ниже границы без сверки (`docs/IOS_SYNC_MAP.md`).
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («A debug reset … forgets them»);
`docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§6g, §6h)*

#### 9.3.15 Сначала показать страницу, потом дотягивать ссылки
**Правило.** Страницу истории пиши сразу (`MessageStore.save`), а недостающее для пузыря (цель ответа вне окна, превью
ссылки, медиа) дотягивай после и перерисовывай из базы. Заглушку показывай только для ссылки, которую реально ждём, и
сразу в итоговом размере (без прыжка ленты).
**Почему.** У Telegram страница сохраняется и закрывает дыру в первой транзакции; цели ответов, эмодзи, сторис
дотягиваются следом, ждавшие сообщения перерисовываются из текущей строки.
**Сейчас у нас.** соблюдено большей частью: ответ несёт `replyQuote`.
**Применимость.** частично.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («A history fill stores before it resolves», «Forum topics …
skeletons»)*

#### 9.3.16 Тихий пуш не делает разрушительного и не завершает сессию
**Правило.** Тихий пуш (`AppDelegate.didReceiveRemoteNotification` → `PushSync.catchUp`) — секунды на работу, база
может быть заперта. В этом пути — только первая страница списка и бейдж; никаких `clearHistory`/overflow-перекачек,
`eraseAll`, `moveStoreAside`, выхода из аккаунта, отправок из очереди; ни при какой ошибке сессия не завершается. До
разблокировки `DatabaseHolder.isAvailable == false` → отложить (`deferredSync`), а не открывать базу. `completion`
вызывать всегда и в пределах бюджета.
**Почему.** У Telegram расширение уведомлений делит базу с приложением и живёт на коротком бюджете: оно никогда не
сбрасывает аккаунт, не ставит операций в общую очередь, на «слишком длинную разницу» отвечает «готово», а сброс делает
приложение.
**Сейчас у нас.** соблюдено (`Core/Push/PushSync.swift`, `App/AppDelegate.swift:13,64`); правило для будущих правок.
**Применимость.** частично — расширений у нас нет, тот же случай — тихий пуш в приложении.
*Источник: `CLAUDE.md` («Subsystem guides»: Account state sync); `submodules/TelegramCore/Sources/State/CLAUDE.md`
(«The notification extension never resets the account»); `docs/state-sync.md` (инвариант 13, «The notification
extension»); `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§2)*

### 9.4 Realtime, открытие чата и прочтения

#### 9.4.1 Порядок обработки событий: `await`, а не `Task {}`, и наоборот
**Правило.** `await` внутри `RealtimeCoordinator.handle` выполняется строго по очереди событий (один читатель `pump`,
`for await event … await handle(event)`). Не заменяй `await` в обработчике на `Task {}` «чтобы не ждать» — события
начнут обгонять друг друга (прочтение раньше самого сообщения). И не сворачивай `Task { @MainActor in … }` (это всегда
отложенный запуск) в прямой вызов, не проверив, кто полагается на отложенность (`.onChange(of: connectionEpoch)` в
`ChatThreadView`, `AppShellView`). Любое такое изменение — с тестом порядка в `RealtimeCoordinatorTests`.
**Почему.** У Telegram `Queue.async` на текущей очереди выполняет блок сразу, и от этого зависит порядок; превращать
встроенный вызов в постановку в очередь и обратно запрещено.
**Применимость.** частично — принцип тот же, механизм свой (главный актор и `Task`).
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («`Queue.async` and `deliverOn` run inline»);
`docs/state-sync.md` («Queue semantics the order depends on», инвариант 4); `docs/state-sync-audit-2026-10.md` (§3);
`docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§2)*

#### 9.4.2 Долгое соединение — одно на процесс и живёт по спросу переднего плана
**Правило.** Сокет один (`RealtimeCoordinator`), `start`/`stop`/`resume` идемпотентны, переподключение — по фазе сцены
и сети, а не по собственному фоновому таймеру. Новые долгие соединения (камеры, LL-HLS) делай так же.
**Почему.** У Telegram один транспорт на процесс; запуск и остановка идемпотентны, жизнь привязана к фазе приложения,
своих фоновых таймеров нет.
*Источник: `submodules/WebProxyTransport/CLAUDE.md` («One process-wide carrier»)*

#### 9.4.3 Желаемые подписки хранятся целиком и переигрываются при подключении
**Правило.** Открытые чаты (`RealtimeCoordinator.open(chatID:)`) — желаемое состояние: до подключения сокета оно
запоминается, после подключения или переподключения подписки переигрываются целиком. Не слать `chat:join` в
неподключённый сокет в расчёте, что он дойдёт.
**Почему.** У Telegram запрошенный набор каналов хранится полностью, применяется в `onJoined()` и переигрывается при
открытии канала данных.
**Сейчас у нас.** соблюдено для открытого чата: на `.connected` выполняется `transport.join(openChatID)`
(`Core/Realtime/RealtimeCoordinator.swift:225–226`).
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («`setRequestedVideoChannels` is the full set»)*

#### 9.4.4 «Своё» определяется по ключу обмена и `token.subject` в момент применения
**Правило.** Эхо своего сообщения узнаётся по `nonce` (локальный id строки), а не по `senderId`; «своё» (сообщение,
присутствие, реакция) определяй по `token.subject` в момент применения. События, пришедшие до восстановления сессии,
не классифицируй по пустому id.
**Почему.** У Telegram ответ на предложение определяется по `exchangeId`, а не по роли; себя отфильтровывают там, где
личность уже известна, а не на входе.
**Сейчас у нас.** соблюдено для эха: `MessageStore.ownPending` сверяет по `nonce` (`Core/Chats/MessageStore.swift:232`).
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («Never decide by role», «The engine owns "which endpoint is me"»)*

#### 9.4.5 Неизвестное событие игнорируется; «поля нет» ≠ «поле пустое»
**Правило.** Конверт `event` `{type, entityId, version, ts, data}` (`RealtimeTransport`) разбирает только известные
типы — так и держать. В частичных обновлениях различай «поля нет» (без изменений) и «поле пустое» (очистить) — как
`chat:updated` с `avatarUrl: String??`. Исход для неизвестного id ничего не меняет.
**Почему.** У Telegram отсутствующее поле в обновлении — «без изменений», пустое — «очистить»; исход для чужого id
игнорируется.
*Источник: `docs/message-widgets-native-runtime.md` («Divergences… v0.4.0», «Requests»);
`docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§5 W2)*

#### 9.4.6 Исчерпывающий `switch` без `default` по событиям и исходам
**Правило.** `RealtimeCoordinator.handle` (`RealtimeEvent`), `ActionFailureKind`, `OptimisticSettlement` — без
`default`. Новый `RealtimeEvent` — с решением в каждом `switch`.
**Почему.** У Telegram исход без ветки «вешает» очередь; без `default` новый случай не скомпилируется, пока не решено,
что с ним делать.
**Сейчас у нас.** соблюдено.
*Источник: `docs/state-sync.md` (инварианты 7, 19, 24)*

#### 9.4.7 Каждое место, где вход молча теряется, названо и закреплено тестом
**Правило.** Известные места: `RealtimeCoordinator.handle` — `guard active` (между выходом и входом); события сокета во
время офлайна (их никто не переприсылает — `docs/PROJECT.md` §9.2c); `emit` без соединения (см. 9.4.16). Каждое — в
карту синхронизации и в `RealtimeCoordinatorTests`.
**Почему.** У Telegram места молчаливой потери входа перечислены в карте и закреплены тестами как поведение
(`testAddUpdatesBeforeResetIsDropped`).
*Источник: `docs/state-sync.md` («Ingress points», «Open issues»)*

#### 9.4.8 Считать и уведомлять только новое
**Правило.** Увеличивай `unreadCount` (и показывай будущие баннеры по сокету) только если `upsert` вставил новую строку:
`MessageStore.upsert` должен возвращать признак вставки.
**Почему.** У Telegram уведомление — только для сообщения, которого в базе не было до записи, иначе повтор уведомляет
дважды.
**Сейчас у нас.** соблюдено (#499): повторный `message:new` не удваивает счётчик непрочитанного.
*Источник: `docs/state-sync.md` (инвариант 22)*

#### 9.4.9 Эфемерное не хранится и истекает
**Правило.** `chat:action` и `presence:changed` — только в памяти координатора; «печатает» гаснет через 4 с без «стоп»
(`docs/PROJECT.md` §9.1a). После переподключения прежние действия не считать живыми.
**Почему.** У Telegram «печатает» старше 60 с и реакции-уведомления старше 20 с отбрасываются.
**Сейчас у нас.** соблюдено.
*Источник: `docs/state-sync.md` («Typing is kept only when …», «reactions younger than 20 s»)*

#### 9.4.10 Порядок, зависящий от обхода `Set`/`Dictionary`, задавать явно
**Правило.** Где показывается «первый» элемент словаря, бери его по явному правилу (последний начавший, сортировка по
id). Ответы сервера применяй в порядке массива (`created + mutated` по `seq`), не перекладывая в `Set`.
**Почему.** Порядок обхода `Set`/`Dictionary` в Swift свой в каждом процессе; Telegram явно фиксирует типы контейнеров,
от которых зависит порядок слияния.
**Сейчас у нас.** соблюдено (#499): «печатает» показывается по последнему начавшему.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («Keep the container types whose iteration order decides an
order»); `docs/state-sync.md` (инвариант 27, «Container order»)*

#### 9.4.11 Инкрементальный путь обязан совпадать с полной загрузкой
**Правило.** Состояние ленты после применения событий (`message:updated`, реакции, закреп, `checklist:updated`,
удаление) должно совпадать с тем, что даёт свежая загрузка того же чата. В `ChatSyncTests`/`MessageSyncTests`/
`RealtimeCoordinatorTests` держи тест-оракул: последовательность событий с фиксированным зерном → сравнить записи базы
с полной загрузкой той же истории из фикстуры.
**Почему.** У Telegram свежая сборка — оракул: после случайных правок патченный документ равен свежесобранному
(`testRandomEditsMatchARebuild`).
*Источник: `docs/message-widgets-native-runtime.md` («Rendering (M1c)», «Tests»)*

#### 9.4.12 Агрегирующий экран не открывает живую подписку на каждый источник
**Правило.** Списки, собранные из многих чатов (список чатов, главная), читают общую таблицу GRDB одним наблюдением
(`ChatListModel` — `ValueObservation`), а не открывают realtime-комнату на каждый чат. Если появится слияние нескольких
постраничных источников — показывай только до самого «короткого» курсора.
**Почему.** У Telegram локальная лента из 40 каналов не идёт через `viewTracker` (он опрашивает каждый канал); слияние
остановлено на «фронтире», иначе посты тихого источника встают не по порядку.
**Применимость.** частично — слияния постраничных источников у нас нет.
*Источник: `submodules/TelegramUI/Components/News/CLAUDE.md` («The tab without the server's feed»)*

#### 9.4.13 Экран не ждёт сети; второстепенное — после первого кадра
**Правило.** Лента открывается наблюдением базы до сети. Закреплённое, статус группы, отложенные, черновик с сервера
запускай после первого снимка ленты, не до.
**Почему.** У Telegram представление истории создаётся сразу из базы; опрос и прогрев профиля идут рядом и стартуют после
первого загруженного представления.
**Сейчас у нас.** соблюдено для ленты: `ChatThreadModel.start` → наблюдение базы до сети.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («An unjoined channel's view does not wait for the poll»);
`submodules/TelegramCore/Sources/TelegramEngine/Messages/CLAUDE.md` («`getDiscussionMessage` is sent before the probe runs»)*

#### 9.4.14 Независимые запросы при открытии — параллельно; пустой ответ — не подтверждение
**Правило.** На входе в чат независимые запросы — `async let`/`withTaskGroup` (так сделаны `rejoin`, `loadGroupStatus`).
Показанное «на опережение» (кеш экрана, окно по ссылке) сверяй с ответом сервера и не принимай пустой или ошибочный
ответ за подтверждение. Логику выбора запросов держи чистыми функциями с юнит-тестами.
**Почему.** У Telegram комментарии открываются за один оборот (два запроса рядом); спекулятивное заполнение остаётся,
только если авторитетный ответ называет ту же ветку; пустой ответ закрыл бы все дыры настоящей ветки.
*Источник: `submodules/TelegramCore/Sources/TelegramEngine/Messages/CLAUDE.md` («Opening a post's comments»)*

#### 9.4.15 Не запрашивать то, чего у типа чата не бывает
**Правило.** Запросы, имеющие смысл только для групп (присутствие, прочтения участников, состав), — только после
проверки типа; то же для будущих типов (каналы, сообщества).
**Почему.** У обычного канала Telegram нет тем — запрос тем убран из критического пути открытия.
**Сейчас у нас.** соблюдено: `loadGroupStatus` проверяет `isGroupChat()` (`ChatThreadModel.swift:1142–1143`).
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («Plain channels request no forum topics»)*

#### 9.4.16 «Прочитать» — до серверного последнего; отметку прочтения не терять
**Правило.** «Прочитать» из списка — `POST /chats/read` по id чатов (сервер читает до своего последнего). В открытом чате
отметку считай отправленной только при `isConnected`; иначе досылай после `.connected`. То же для других событий,
уходящих сокетом (`realtime.edit`).
**Почему.** У Telegram «прочитать» из списка читает до последнего сообщения сервера, иначе непрочитанное, которого
устройство не видело, возвращает чат в непрочитанные.
**Сейчас у нас.** соблюдено (#499): отметки прочтения, правки и удаления без соединения копятся в координаторе и уходят
на `.connected`.
*Источник: `submodules/TelegramCore/Sources/TelegramEngine/Messages/CLAUDE.md` («Marking a whole chat read from the chat
list», issue #98)*

#### 9.4.17 Частичное окно истории не делает заявок о прочтении
**Правило.** В окне истории (`isDetached`, `MessageStore.replaceHistory`) не слать «прочитано» по последнему сообщению
окна и не ставить разделитель непрочитанного, пока окно не дошло до свежего.
**Почему.** У Telegram представление вокруг одного сообщения до загрузки окружения не утверждает ничего о прочтении
(`maxReadIndex = nil`) и не дёргает перезагрузку.
**Сейчас у нас.** соблюдено (#499): `markRead` молчит в окне истории и не отмечает ниже видимой строки.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («Opening a post from the News feed»)*

#### 9.4.18 Нет серверного прочтения — нет и счётчика; сменилось членство — перечитать строку чата
**Правило.** Сейчас все чаты — по членству. При появлении просмотра без вступления (каналы, сообщества) не держи
`unreadCount` и не шли прочтений. На смену членства (`chat:member-added`/`removed`, принятие запроса) перечитывай строку
чата, а не жди страницы списка.
**Почему.** У Telegram для канала без членства сервер прочтений не ведёт; при вступлении клиент сам ставит проверку
прочтения, потому что вход её не гарантирует.
**Сейчас у нас.** расходится: события членства сведены к `chatActivity` → обновлению первой страницы (`Core/Realtime/RealtimeCoordinator.swift:313`): чат за её пределами не
обновится.
**Применимость.** частично — просмотра без членства пока нет.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («Channels the account is not a member of: no read state»,
«A join does not reliably fetch the dialog»)*

### 9.5 Локальная база и файловые кеши: запись, слияние, отказоустойчивость

#### 9.5.1 Поздний ответ не откатывает более новое состояние
**Правило.** Догон `GET /chats/:id/updates`, страница истории или превью списка, ушедшие в полёт раньше события сокета,
не перезаписывают более свежее. Сравнивай внутри `database.writer.write` с текущей строкой (не со снимком на начало
запроса): если у строки `editedAt` новее, чем в ответе (или в ответе `nil`, а в базе дата), — `content` и `editedAt` не
трогать; то же для `pinnedAt` и состояния опроса/списка, когда у них появится метка времени или `version` из конверта
события. Источник свежести — серверные метки, не время прихода.
**Почему.** У Telegram ответ, собранный до правки, не затирает правку, пришедшую пушем (`RecentlyEditedMessages`);
`validateBatch` подменял сохранённое при любом расхождении дат, даже если сохранённое новее. Урок прогона: чем упорнее
повторы («не бросать»), тем чаще запрос в пути во время правки — защита обязательна. Новое состояние виджета пишется как
правка, чтобы догоняющая загрузка не вернула старое.
**Сейчас у нас.** соблюдено (#499): `MessageStore.upsert` внутри записи сравнивает с текущей строкой: текст и `editedAt`
— только если правка не старее.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («An answer message edited after the request went out …»);
`docs/state-sync.md` (инвариант 14); `docs/superpowers/reports/2026-10-25-state-sync-truth-run.md` (§5);
`docs/superpowers/reports/2026-10-15-difference-too-long-exploration.md` («validateBatch replaces …»);
`submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («A shared widget's state is polled while it watches on
screen»); `docs/message-widgets-native-runtime.md` («Divergences… v0.4.0»)*

#### 9.5.2 Поздний ответ не воскрешает удалённое
**Правило.** `deletedAt` в базе только ставится (nil → дата); снимает его лишь явное событие (сейчас такого нет).
Журнал недавних удалений не нужен — хватает монотонности поля.
**Почему.** У Telegram удаление, пришедшее, пока ответ страницы был в пути, не отменяется этим ответом (журнал на
5 минут); без этого 4 из 500 сеансов модели сервера кончались «призраками».
**Сейчас у нас.** соблюдено (#499): `MessageStore.upsert` `deletedAt` только ставит, поздний ответ удалённое не
воскрешает.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («A history fill and its follow-up store no message deleted
in the last few minutes»); `docs/state-sync.md` (инвариант 14); `docs/superpowers/reports/2026-10-25-state-sync-truth-run.md`
(§3)*

#### 9.5.3 Слияние состояний: правило на каждое поле
**Правило.** Отметки времени и номера — максимум (`othersReadAt`, `memberReads`, `lastSeq`); текущее состояние
(заголовок, аватар) — последнее по времени события. Новое поле в `ChatRecord`/`MessageRecord` — явно реши, кто его
перезаписывает (страница списка, сокет, догон) и по какому правилу.
**Почему.** У Telegram при слиянии каждое поле сливается по своему правилу (списки дописываются, флаги — ИЛИ, отметки —
максимум); забытое поле тихо теряется.
**Сейчас у нас.** соблюдено для существующих отметок.
*Источник: `docs/state-sync.md` («Events», `union`; инвариант 23)*

#### 9.5.4 Записанное в базу — с сигналами в той же обработке
**Правило.** Производное от записи (счётчик непрочитанного, `pinnedVersions`, бейдж, баннер) выставляй в той же
обработке, что и запись, а не «после обновления списка»; планирование `scheduleListRefresh` не отменяет уже применённое.
**Почему.** У Telegram события зафиксированной записи (уведомления, удаления, «печатает») доставляются, даже если следом
запланирован новый догон: позиция ушла вперёд, повторно их не пришлют.
*Источник: `docs/state-sync.md` (инвариант 8)*

#### 9.5.5 Зависимые строки — в той же транзакции, родитель первым
**Правило.** Строку с внешним ключом пиши в одной транзакции с родителем и после него (`attachment` → `message`, `draft`
→ `chat`). `folderChat` намеренно без ключа на чат — читать с этим в уме.
**Почему.** У Telegram справка о теме, записанная отдельно от её сообщений, пропадает при фиксации.
**Сейчас у нас.** соблюдено: `ChatStore.upsert` пишет чат, затем превью.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` («The answer's missing topics are stored in the same
transaction as the messages»)*

#### 9.5.6 Транзакция синхронна и замкнута: никаких `await`, UI и колбэков внутри
**Правило.** Один ответ сервера — одна `write`. Внутри `database.writer.write { db in … }` — никаких `await` сети,
вызовов UI, другого обработчика того же потока; `db` не выносить наружу и не захватывать в `Task`. Сначала транзакция,
потом наблюдатели (`@Observable`, `ValueObservation`) получают результат; фоновую работу, начатую из записи
(скачивание файла, обновление кеша), запускай после записи со скопированными значениями.
**Почему.** У Telegram догон — один синхронный вызов в транзакции, а живущие дольше неё замыкания захватывают копии;
пока задача виджета идёт, хост синхронно не вызывается, повторный вход возвращается сразу.
*Источник: `docs/state-sync.md` (инвариант 16); `docs/superpowers/specs/2026-10-13-message-widgets-design.md`
(§2 «No re-entrancy»); `docs/message-widgets-native-runtime.md` («No script runs inside a native algorithm», «A flush
entered from inside a flush returns at once»)*

#### 9.5.7 Обновление пакетом — атомарно; снимок экрана заменяется целиком
**Правило.** Ответ `updates`, страница истории и пакет WS применяются одной транзакцией GRDB; модель экрана заменяет
снимок целиком после успешного чтения, а не правит его по частям — сбой посередине не оставит ленту в смешанном
состоянии.
**Почему.** У Telegram загрузка строит новый документ и устанавливает его, только если сборка, раскладка и публикация
удались.
*Источник: `docs/message-widgets-native-runtime.md` («The flush is atomic in what it publishes»)*

#### 9.5.8 Запись без изменений не будит наблюдения
**Правило.** Новые пути записи — как существующие: `updateChanges(db, from:)` вместо полной перезаписи, сравнение
вложений перед записью, `removeDuplicates` у `ValueObservation`.
**Почему.** У Telegram перезапись без изменений будила представление → новая проверка → бесконечная петля.
**Сейчас у нас.** соблюдено: `MessageStore.upsert`, `ChatStore.upsert`, `saveAttachments`.
*Источник: `docs/superpowers/reports/2026-10-15-difference-too-long-exploration.md` («Avoid the restamp loop»)*

#### 9.5.9 Несколько таблиц одного экрана — одно наблюдение
**Правило.** `ValueObservation` по нескольким таблицам одного региона не дели на отдельные наблюдения — увидишь
рассогласованные кадры (чат без последнего сообщения).
**Почему.** У Telegram многоключевой `combinedView` атомарен; разбиение на параллельные подписки даёт промежуточные
несогласованные состояния.
*Источник: `docs/superpowers/postbox-refactor-log.md` («Do not split a multi-key `combinedView` into parallel
subscriptions»)*

#### 9.5.10 Временная ошибка открытия базы — не повод откладывать её
**Правило.** Классифицируй `DatabaseError.resultCode`: откладывать базу в резервную копию только на
`SQLITE_CORRUPT`/`SQLITE_NOTADB` и ошибку миграции, и то после N подряд неудачных запусков (счётчик в `UserDefaults`,
сбрасывается успешным открытием). На временных (`SQLITE_FULL`, `SQLITE_BUSY`, `SQLITE_IOERR`, `SQLITE_CANTOPEN`) —
работать в памяти этот запуск, файл не трогать. Не удалять прежнюю резервную копию, пока новая не подтверждена.
**Почему.** У Telegram занятость, I/O, нехватка места, защита до разблокировки — не вердикт; база удаляется только после
третьего подряд неудачного открытия и только при ошибках, которые удаление может исправить.
**Сейчас у нас.** соблюдено (#499): база откладывается только при порче или ошибке миграции, прежние копии хранятся.
*Источник: `submodules/Postbox/CLAUDE.md` («The schema probe gives no verdict on transient errors», «The one valve is a
failed `sqlite3_open_v2`»)*

#### 9.5.11 Базу откладывают только целым набором файлов
**Правило.** Никогда не удалять и не переносить `chats.sqlite` без `-wal`/`-shm`: только каталог целиком.
**Почему.** У Telegram удаление одного файла базы оставляло чужой журнал `-shm` и повторяющуюся «порчу».
**Сейчас у нас.** соблюдено: `AppDatabase.moveStoreAside` переносит каталог целиком.
*Источник: `submodules/Postbox/CLAUDE.md` («`SqliteValueBox` self-heal policy»)*

#### 9.5.12 Разделяемые строки: проверить уникальность ключа вложения
**Правило.** `attachment.id` — первичный ключ, равный id медиа на сервере, с `messageId` одного сообщения. Проверить на
сервере, что id вложения уникален и у копии при пересылке; если нет — ключ `(messageId, id)` новой миграцией, иначе
`saveAttachments` упрётся в уникальность и сорвёт всю запись. Удаление общего — пометкой-надгробием, а не сразу.
**Почему.** У Telegram медиа, на которое ссылаются несколько сообщений, хранится одной записью со счётчиком; удаление
«для всех» по счётчику ломало учёт — решение: надгробие и честный счётчик.
**Сейчас у нас.** расходится (риск, зависит от сервера): `table.primaryKey("id", .text)` у `attachment` (`Core/Storage/AppDatabase+Migrations.swift:127–129`).
**Применимость.** частично.
*Источник: `submodules/Postbox/CLAUDE.md` («Postbox shared-media removal (deferred design: tombstones)»)*

#### 9.5.13 Файловый кеш: атомарная запись, данные раньше индекса, поколение против чужих данных
**Правило.** Новый файловый кеш (медиа, сводки чатов) делай как `ImageDiskCache`: запись `.atomic` с классом защиты;
файл данных пишется до записи о нём в индекс или GRDB; старое удаляется после фиксации нового; поколение
(`generation`, сбрасывается выходом из аккаунта) проверяется перед записью; страницы с незаписанными изменениями не
вытесняются; при нехватке памяти и уходе в фон — обрезка до видимого.
**Почему.** У Telegram переиспользованный слот никогда не покажет прежний снимок (поколение), а старая страница
удаляется только после того, как на диске индекс без неё.
**Сейчас у нас.** соблюдено: `ImageDiskCache` пишет `.atomic` и сверяет `generation`, `ImageMemoryCache` — `NSCache` с
`totalCostLimit`.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Thumbnail store, filler and launch cache»);
`docs/superpowers/plans/2026-10-27-media-grid-thumbnail-store.md` (Task 2)*

#### 9.5.14 Испорченный файл кеша — пустой кеш, а не падение
**Правило.** Любой файловый кеш и кеш экранов (`screenCache`) при мусоре в файле отдаёт промах и пересобирается, ничего
не стирая; на это — тест.
**Почему.** У Telegram битый индекс или страница дают пустое хранилище и пересборку (`testCorruptIndexStartsEmpty`,
`testCorruptPageGivesNilNotCrash`).
**Сейчас у нас.** соблюдено в `ImageDiskCache` («ошибка чтения — промах, ничего не стирается»).
*Источник: `docs/superpowers/plans/2026-10-27-media-grid-thumbnail-store.md` (Global Constraints, Task 2)*

#### 9.5.15 Кеш не растёт без предела
**Правило.** Каждый новый кеш (кадры видео `ChatVideoFrames`, LQIP, кеш экранов) — с явным пределом и уборкой.
**Почему.** Неограниченный рост хранилища — анти-цель Telegram; у страниц есть бюджет памяти и обрезка.
**Сейчас у нас.** соблюдено: `ImageDiskCache` 200 → 150 МБ (LRU), `ImageMemoryCache` — 80 МБ стоимости.
*Источник: `docs/superpowers/specs/2026-10-27-media-grid-thumbnail-store-design.md` (Anti-goals, Memory)*

#### 9.5.16 На диск кладётся только проверенное: «завершилось» ≠ «получено»
**Правило.** Кладя ответ в `ImageDiskCache`, проверь, что это картинка (декодируется или есть размеры в
`CGImageSource`); иначе испорченный ответ живёт на диске до 7 дней. Успех загрузки проверяй по байтам, а не по факту
завершения.
**Почему.** У Telegram ошибка диапазонной загрузки превращалась в «завершение», поэтому успех проверяют по байтам на
диске.
**Сейчас у нас.** соблюдено (#499): перед записью в `ImageDiskCache` ответ проверяется через `CGImageSource` (формат и
размеры кадра).
*Источник: `docs/native-hls-player.md` («A segment load whose fetch completed with bytes still missing has failed»,
`fetchedResourceRangeUntilOnDisk`)*

#### 9.5.17 «Сироты» в кеше определяются только по полному каталогу
**Правило.** Фоновый уборщик (вложения в `AttachmentRecord`, файлы outbox, дисковый кеш) удаляет «ненужное» только
сверяясь с полным списком, а не с отфильтрованным окном (вкладка «Медиа» без файлов, окно последних сообщений
`chatWindowedObservation`). Полного списка нет — не удаляй, пусть уйдёт по LRU или сроку.
**Почему.** У Telegram заполнителю миниатюр нельзя давать альбом или выборку «только фото» — он объявит сиротами все
остальные снимки.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («never give the filler an album's data source»);
`submodules/MediaPickerUI/CLAUDE.md` («a type-filtered fetch … never drives the filler»)*

#### 9.5.18 Временный файл удаляется, когда потребитель уже держит новый
**Правило.** Временные файлы (`PhotoAssets.movieFile`, `MediaDownload.file`, outbox) удаляй после того, как их забрал
потребитель (экспорт закончился, лист «Поделиться» закрыт, загрузка подтверждена), а не в момент передачи.
**Почему.** У Telegram временные файлы частей удаляются через оборот после того, как плеер получил новый список.
*Источник: `docs/native-hls-player.md` («Part temp files are disposed a main-queue turn after …»)*

#### 9.5.19 Оптимизация меняет цену, а не правильность
**Правило.** Кеш экранов, ETag/`304`, «не писать без изменений» — только экономия: промах или неверная метка обязаны
давать полный ответ, а не показ устаревшего как свежего.
**Почему.** У Telegram неверный хеш в запросе истории возвращает полный ответ, а не ошибочное «не изменилось».
*Источник: `docs/superpowers/reports/2026-10-15-difference-too-long-exploration.md` («server-api»)*

### 9.6 Повторы, загрузки и исходы операций

#### 9.6.1 Любой автоповтор — растущая пауза с потолком и разбросом
**Правило.** Все петли повтора — экспонента с потолком 60 с и разбросом ±20 % (`OutboxService.jittered`), сброс паузы
при успехе или новом поводе (`kick`, `resume`). Новых петель «повтор сразу» не добавлять; `APIClient.attempt`
(0,5 → 1 с), `OutboxService`, `RealtimeCoordinator.scheduleReconnect` — всегда с потолком. Предел числа подряд — для
вспомогательных автоповторов (старт аудиосессии, повторные предложения протокола); пути синхронизации числом не
ограничиваются (9.3.1).
**Почему.** У Telegram повторный сброс ждёт по нарастающей до минуты (повтор без паузы оставлен известной проблемой);
неограниченный рост пауз рукопожатия был дефектом.
**Сейчас у нас.** соблюдено: `OutboxService`, `RealtimeCoordinator`.
*Источник: `docs/state-sync.md` («`consecutiveResetDelay`», «Open issues» Q6); `submodules/TgVoipWebrtc/CLAUDE.md`
(«Timer Tuning»)*

#### 9.6.2 Таймер повторов идёт только при наличии сети
**Правило.** Повторы загрузки медиа строй как `OutboxService` (`NWPathMonitor`): без сети — ждать восстановления пути, а
не жечь попытки по таймеру.
**Почему.** У Telegram паузы между повторами отсчитываются только пока сеть аккаунта подключена (`ConnectedTimer`).
*Источник: `docs/native-hls-player.md` («Failures (D10)»)*

#### 9.6.3 У каждого неподтверждённого отправления — свой таймер повтора
**Правило.** Повтор не может зависеть от того, что человек отправит что-то ещё: `OutboxService` держит собственный
`retryTask`; так же — отложенные выходы и подтверждения прочтения.
**Почему.** У Telegram повтор зависел от следующей отправки, и в тихом звонке потерянное сообщение не уходило никогда.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («A message sent with nothing queued had no resend timer»)*

#### 9.6.4 Любое ожидание — с потолком
**Правило.** Каждое «ждём, пока …» ограничено по времени (`SessionStore.tokenWait` 10 с, короткое ожидание истории
`chatThinHistoryShortWait`); упорядочивающая очередь не должна уметь ждать саму себя.
**Почему.** У Telegram упорядочивающая очередь дала взаимную блокировку 14 → 13; ожидания ограничены (до 10 с),
автоматические повторные предложения — тремя подряд.
*Источник: `docs/superpowers/specs/2026-10-11-tgcalls-compatimpl-v2-protocol-design.md`*

#### 9.6.5 Результат не теряется между хопами; флаги «идёт» снимаются на всех путях
**Правило.** На мостах «обратный вызов → async» (`withCheckedContinuation`, `AsyncStream.Continuation`) возобновляй
ровно один раз и вместе со значением; `finish()` — только после последнего `yield`. Флаги «идёт» (`OutboxService.running`,
`RealtimeCoordinator.reconnect`, `listRefresh`) снимай на всех путях выхода (`defer`); операция, которая может не
вернуться (запрос без таймаута, ожидание токена), — с таймаутом, иначе флаг навсегда блокирует следующие проходы.
**Почему.** У Telegram завершение, выполненное «на месте», обгоняло значение с другого потока; подписчик закрыт —
значение потеряно, опрос навсегда висит в голове очереди и `reset()` его не снимает.
*Источник: `docs/superpowers/reports/2026-10-15-state-sync-q13-poll-result-loss.md` («Root cause», «Production fix
options»); `docs/state-sync.md` (инвариант 5)*

#### 9.6.6 Успех фиксируется после результата; путь отказа оставляет возможность повторить
**Правило.** Признаки «подключено», «загружено», «аудиосессия активна» (`VoicePlayback`, `Voice/VoiceRecordingViews.swift`,
`RealtimeCoordinator`) выставляй после успеха; при сбое откатывай состояние так, чтобы следующий вызов попробовал снова;
повторы — с пределом и строкой в логе на каждую попытку.
**Почему.** У Telegram `_isStarted` выставлялся до результата, и единичный сбой старта аудио становился вечным на весь
звонок.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («A failed audio-unit start used to be permanent for the call»)*

#### 9.6.7 Одна операция за раз на ключ; запуск — в одном месте
**Правило.** Очереди выполняют только голову и запускаются одной функцией; завершение снимает свою операцию. Догоны чата,
обновление списка, досылка — не больше одного в полёте на ключ.
**Почему.** У Telegram очередь синхронизации выполняет только голову, запускает её одна `startFirstOperation()`, «сначала
снять, потом проверить».
**Сейчас у нас.** соблюдено: `OutboxService` (`running` + `rerun`), `RealtimeCoordinator` (один читатель потока),
`listRefresh` отменяет прежний, `MessageOutbox.retry` захватывает строку транзакцией.
*Источник: `docs/state-sync.md` (инварианты 1, 3; «Kinds and placement»)*

#### 9.6.8 Запрос в полёте делится; неразрешённое переспрашивается
**Правило.** Запрос в полёте делить между потребителями (как `UnreadNotificationsCounter`, `AttachmentURLProvider`),
свежий ответ переиспользовать (`ScreenCacheStore`, `RemoteValue`); переход по глубокой ссылке в чат не дублирует
загрузку, которую сделает сам экран. Карточки пользователей (`ProfileCards`), ссылки на вложения, неизвестный автор в
чате: пока не разрешено — переспрашивать при следующей потребности с дедупликацией, а не помечать «запрошено» навсегда.
**Почему.** У Telegram второй потребитель того же ответа в течение 30 с запрос не повторяет; а SSRC, запрошенный ровно
один раз, оставлял участника навсегда нерасшифровываемым, если ответ его пропустил.
**Сейчас у нас.** соблюдено частично.
*Источник: `submodules/TelegramCore/Sources/TelegramEngine/Messages/CLAUDE.md` («… is skipped within 30 s of the
opener's», «A comment link fetches its thread once»); `submodules/TgVoipWebrtc/CLAUDE.md` («Unresolved SSRCs are re-asked»)*

#### 9.6.9 Неудачная подгрузка перезапускается сама, пока видна дыра
**Правило.** Подгрузка истории вверх/вниз (`ChatThreadModel`, `PagedLoader`) — не больше одной на направление; после
неудачи — автоматический повтор с паузой, пока экран показывает пустое место, а не только по кнопке «Повторить»; при
уходе с экрана задачи отменяются.
**Почему.** У Telegram загрузка, закончившаяся ничем, в тихом чате не перезапускалась никогда — исправлено таймером на
20 с с переоценкой.
**Сейчас у нас.** соблюдено (#499): `PagedLoader.loadMore` после временного сбоя повторяет с паузой 2 → 60 с, пока
строка на экране; отказ по существу ждёт «Повторить».
*Источник: `docs/state-sync.md` («Holes and history fills», `ManagedMessageHistoryHolesContext`);
`docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§6h)*

#### 9.6.10 Смена фильтра или запроса — новое поколение; поздние ответы старого отбрасываются
**Правило.** Смена вкладки «Медиа/Файлы/…», поискового запроса, альбома в `RecentMediaGrid`, страницы: ответ прежней
выборки не попадает в новую — счётчик поколения или отмена `Task` прежней загрузки и проверка перед присвоением.
**Почему.** У Telegram переключение «фото/видео» строит новый список, ответы старого отбрасываются по счётчику поколений;
поздний ответ на вытесненное предложение отбрасывается, а не принимается за новое.
**Сейчас у нас.** соблюдено в `OptimisticSync`.
*Источник: `submodules/TelegramUI/Components/PeerInfo/PeerInfoVisualMediaPaneNode/CLAUDE.md` («Data»);
`submodules/TgVoipWebrtc/CLAUDE.md` («a late answer to a superseded offer is dropped»)*

#### 9.6.11 Не показывать вечное «проверяется…»
**Правило.** Индикатор (статус связи, «отправляется», статус загрузки, «печатает») для того, что никто не измерит, не
крутится бесконечно — покажи конечное состояние.
**Почему.** У Telegram неактивная строка прокси показывается «не проверено», а не вечной проверкой.
*Источник: `submodules/WebProxyTransport/CLAUDE.md` («`ProxyServersStatuses` never pings an inactive WEB row»)*

#### 9.6.12 Числа с сервера проверяются по диапазону; единицы — в имени
**Правило.** Числа, пришедшие с сервера (`expiresIn` QR, интервалы), проверяй на диапазон с откатом к своему значению;
секунды/миллисекунды — в имени параметра; действующие значения пиши в лог.
**Почему.** У Telegram отсутствующий ключ, не число или значение вне 1–60000 мс оставляет умолчание; каждое соединение
логирует свои значения; конструктор без значения по умолчанию не даёт пропустить настройки.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («Timer Tuning»)*

#### 9.6.13 Сбой сети не окончателен; окончательна только ошибка содержимого
**Правило.** Для видео: при `AVPlayerItem.status == .failed` — повтор с паузой; при 401/403 — заново подписать ссылку
(`AppServices.attachmentURLs.media(for:)`) и пересоздать item, сохранив позицию; «не получилось» — только после
исчерпания повторов или при ошибке содержимого.
**Почему.** У Telegram загрузка ждёт сервер сколько нужно (решение владельца): повтор 1, 2, 4, 8 с, проблемный уровень
— на охлаждение 30 с…5 мин; окончательно только неразбираемый плейлист.
**Сейчас у нас.** картинки так и делают («сбой не запоминается», `isRetryable`), камеры пересоздают источник до 8 раз.
Расходится: `InlineVideoView` (`Features/Feed/PostMediaView.swift:181–240`) и `ViewerVideo`
(`Features/Feed/MediaViewer.swift:891–900`) не следят за `.failed` и не повторяют, а HLS-ссылка несёт истекающий токен
`?t=`.
*Источник: `submodules/HLSPlayback/CLAUDE.md` («No network failure is terminal»); `docs/native-hls-player.md` («Failures
(D10)»)*

#### 9.6.14 Ошибка содержимого запоминается до смены источника
**Правило.** Битую картинку или вложение, которое не декодировалось, не перезапрашивай на каждой отрисовке ячейки —
помни отказ по ключу до смены источника.
**Почему.** У Telegram виджет, не стартовавший для результата, не перезапускается для того же результата.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («An inline result that is a widget is a preview»,
«Lifetime»)*

#### 9.6.15 Один файл — одна загрузка
**Правило.** Картинки — только через `ImageMemoryCache.load` → `ImageDownloads` (одна задача на ключ без подписи). Новый
загрузчик медиа (предзагрузка, экспорт, «Поделиться») не открывает свой `URLSession` на тот же файл, а идёт через общий
путь. `MediaDownload.file` для «Поделиться» качает оригинал отдельно — допустимо, это другой файл.
**Почему.** У Telegram плеер грузит через общий файловый контекст и присоединяется к идущей предзагрузке чата, а не
качает те же байты второй раз.
*Источник: `submodules/HLSPlayback/CLAUDE.md` («Loads go through MediaBox's own file context»); `docs/native-hls-player.md`
(«Fetches go through MediaBox's own file context»)*

#### 9.6.16 Повышенный приоритет загрузки — только пока он нужен
**Правило.** Предзагрузка — `.utility`, видимое — приоритет экрана. Не поднимай приоритет долгоживущей задаче (видео,
большие вложения) на всё время — только пока человек ждёт глазами.
**Почему.** У Telegram приоритет просматриваемому ролику — только пока в буфере меньше 10 с (снимается выше 20 с и на
паузе); держать его всю дорогу — уморить остальные загрузки на медленной сети.
**Применимость.** частично — своих очередей видео нет.
*Источник: `submodules/HLSPlayback/CLAUDE.md` («Queue priority only while the watched video is short of buffer»);
`docs/native-hls-player.md`*

#### 9.6.17 Сбой подготовки вложения обязан завершить отправку
**Правило.** Любой сбой экспорта, чтения ассета или загрузки (`AttachmentSendSheet`, `MediaPreparation.exportMP4`,
`AttachmentUploader`, `OutboxService`) переводит запись в «не отправлено, Повторить», а не оставляет вечное
«Отправляется». Проверяй ветку `export.status != .completed` и отмену `Task`.
**Почему.** У Telegram при сбое писателя экспорт возвращал «успех», и сообщение навсегда оставалось «в обработке».
*Источник: `submodules/TelegramUI/Components/MediaEditor/CLAUDE.md` («A writer failure while a frame is being composed
must still end the export»)*

#### 9.6.18 Части файла, который ещё пишется, — только если формат гарантирует их окончательность
**Правило.** Сейчас видео экспортируется целиком (`MediaPreparation.exportMP4`), потом грузится; от 50 МБ — многочастно
(`AttachmentUploader.multipartThreshold`). Совмещая экспорт и загрузку, используй только формат, где загруженные части не
перепишутся, и неизменный размер части с первой отправленной.
**Почему.** У Telegram писатель резервирует место под `moov` в начале, загрузчик держит части, задевающие заголовок, до
конца; размер части нельзя менять после первой; меньше 10 МБ ничего не отдаётся.
**Применимость.** частично — параллельной загрузки нет.
*Источник: `submodules/TelegramUI/Components/MediaEditor/CLAUDE.md` («Stories and chat videos upload while they are
exported»)*

#### 9.6.19 Переписывая экран с медиа — сохраняй действующие правила загрузки; трафика не больше
**Правило.** Сохраняй размеры страниц (`ChatMediaGallery.pageSize = 30`), ступени копий и ограничение параллельности
(`ChatMediaThumbnails` — 4, из-за лимита частоты сервера, 429); сравни число запросов до и после.
**Почему.** Новая сетка профиля Telegram взяла прежние правила загрузки (размеры страниц, выбор дыры, ступени); больше
трафика — провал.
*Источник: `docs/superpowers/specs/2026-10-28-shared-media-grid-design.md` (Intent, Anti-goals, Non-goals)*

### 9.7 Сессия и выход из аккаунта

#### 9.7.1 Единственный писатель сессии применяет результат продления только в своей эпохе
**Правило.** У сессии есть эпоха (номер); её увеличивают `signOut`, `forgetSession` и вход (`adopt` из `LoginModel`, QR,
регистрации). Продление запоминает эпоху на старте и применяет результат, только если эпоха не изменилась, иначе
выбрасывает его. Тест в `SessionStoreTests`: выход во время продления → `hasStoredSession == false` после его
завершения.
**Почему.** У Telegram ключи пишет один координатор и только если состояние не изменилось с начала операции
(compare-and-set; токен пишется, только если постоянный ключ всё ещё тот, под которым шёл импорт).
**Сейчас у нас.** соблюдено (#499): у сессии эпоха — продление, начатое до «Выйти», сессию не воскрешает.
*Источник: `submodules/MTProtoRustEngine/CLAUDE.md` («`MTContext` stays the one coordinator and the only writer»)*

#### 9.7.2 Повтор после потерянного ответа обязан попасть в окно грации сервера
**Правило.** refresh-токен одноразовый; повтор старого токена вне окна грации (`REFRESH_REUSE_GRACE_MS`, по умолчанию
10 с, `withinReuseGrace` в `apps/api/src/modules/auth/auth.service.ts`) сервер считает кражей: гасит всю цепочку,
отзывает access-токены и рвёт сокеты на всех устройствах. Держи `AuthAPI.refreshTimeout + lossRetryDelay` меньше окна
(или согласуй окно на сервере); после таймаута длиннее окна повтор вслепую не шли. Покрыть тестом в `SessionStoreTests`
(как `testLostRefreshResponseIsRetriedOnce`, но с задержкой ответа больше окна).
**Почему.** У Telegram после сбоя переноса авторизации уже экспортированные байты не пересылаются вслепую — делается
один свежий экспорт.
**Сейчас у нас.** соблюдено (#499): повтор продления укладывается в окно грации сервера.
*Источник: `submodules/MTProtoRustEngine/CLAUDE.md` («a transfer never resends exported bytes after a failure»);
`docs/BACKEND_RULES.md` (§6.2)*

#### 9.7.3 Операцию, которую обязан узнать сервер, журналировать до действия и досылать
**Правило.** Как выход без сети: `pendingLogouts` в связке ключей, досылка `completePendingLogouts()` при возврате на
передний план, каждый — своей refresh-cookie; отказ по существу — удалить из журнала. Новые операции того же рода
(отвязка пуш-токена, отзыв устройства) — тем же способом.
**Почему.** У Telegram намерение записывается до действия (`pendingBiometricAccount`), незавершённое доделывается позже
(`resumeCleanup()`).
**Сейчас у нас.** соблюдено (`Core/Session/SessionStore.swift:258–290`).
*Источник: `docs/passcode.md` («persist `pendingBiometricAccount` before creating the item», «`resumeCleanup()` …
retries deletions»)*

#### 9.7.4 Продление и сетевые действия сессии — не в расширениях
**Правило.** Расширений у нас нет (`project.yml`: только приложение и тестовые бандлы). Если появится Notification
Service Extension: refresh-токен ему недоступен (связка ключей без общей access group), продление в расширении
запрещено — оно ротировало бы токен за спиной приложения, и следующий refresh приложения стал бы «кражей» (9.7.2).
**Почему.** У Telegram сетевой движок ставится только в приложении, а транспорт отказывается работать, если главный
бандл — `.appex`.
**Применимость.** частично — расширений нет, правило на будущее.
*Источник: `submodules/MTProtoRustEngine/CLAUDE.md` («Installed by `NetworkEngine.activate()` … never in extensions»);
`submodules/WebProxyTransport/CLAUDE.md` («`Network.swift` refuses the carrier outright when the main bundle ends in
`.appex`»)*

### 9.8 Сообщения, черновики, карточки и оптимистичные действия

#### 9.8.1 Локальный id строки — ключ всего локального и не меняется при подтверждении
**Правило.** Строка сообщения живёт под локальным id (= `nonce`), сервер ставит `remoteId` (`MessageStore.ownPending`),
лента идентифицирует строки по `message.id`. Не менять id строки при подтверждении и не строить ключи ячеек, кешей,
воспроизведения по `remoteId`. Локальные данные сообщения (скачанный путь, прогресс голосового, раскрытие) — в GRDB по
локальному id строки. Предпросмотры и фикстуры (`PerfFixture`) не пишут в реальную базу.
**Почему.** У Telegram ключ переиспользования — `stableId`, который не меняется при переходе локального id в серверный;
ключ по `message.id` пересоздавал вид, и медиа мигали. Хранилище виджета живёт в производных данных сообщения и
следует за сменой id.
**Сейчас у нас.** соблюдено.
*Источник: `docs/instantpage-richtext.md` (Send-time media continuity, «The reuse key is message.stableId»);
`submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («A widget's storage is in its message's derived data»)*

#### 9.8.2 Известное с отправки не теряется при эхо сервера
**Правило.** Любое поле вложения, известное клиенту раньше сервера, переносится в серверную запись при подтверждении,
как `localPath` и размеры снимка в `MessageStore.saveAttachments`.
**Почему.** У Telegram при подтверждении локальные байты загрузки переносятся на серверный ресурс — ничего не
перекачивается, пузырь не прыгает.
**Сейчас у нас.** соблюдено (`Core/Chats/MessageStore.swift:252–293`).
*Источник: `docs/instantpage-richtext.md` (Send-time media continuity, «The data layer already re-homes the bytes»)*

#### 9.8.3 После смены id обновить привязки действий, но не картинку
**Правило.** Действия пузыря (ответить, переслать, открыть в галерее, меню) берут актуальный серверный id из текущего
`item`, а не захваченный при первой отрисовке. При смене id вложения (временный → серверный) обнови ключ открытия и
скачивания, не сбрасывая показанное изображение.
**Почему.** У Telegram переиспользованный вид медиа держал старую локальную идентичность для тапа и статуса загрузки — тап
молча ничего не делал до пересоздания.
*Источник: `docs/instantpage-richtext.md` (Send-time media continuity, «The reused media node's INTERACTIVE bindings are
refreshed too — its image is NOT»)*

#### 9.8.4 Локальное эхо показывает то, что сделает сервер
**Правило.** Оптимистичное сообщение в очереди (пересылка, ответ) отображай с теми полями, которые вернёт сервер
(подпись «переслано», без чужих реакций), чтобы при подтверждении пузырь не менялся. Повтор отправки из очереди не
добавляет полей, которых не было в исходной.
**Почему.** У Telegram эхо пересылки сразу показывает копию в той форме, которую создаст сервер, иначе виджет
перезапускался не с теми флагами; при повторной отправке цитата остаётся, только если её просили.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Forwards», «The echo is the copy the server will
make»); `docs/instantpage-richtext.md` (Rich reply quotes, «A resend keeps a reply's quote only if …»)*

#### 9.8.5 Черновик: локальный сразу, серверный не затирает живой набор
**Правило.** `ChatStore.mirrorServerDraft` принимает серверный черновик, только если локальный синхронизирован
(`isSynced`); `ChatThreadModel.loadDraft` пишет в поле только в пустое поле — так и держать, проверку `!local.isSynced`
не ослаблять. Принятое у нас отличие от Telegram: пустой серверный черновик удаляет синхронизированный локальный (чтобы
отправка на вебе гасила черновик в iOS).
**Почему.** У Telegram пришедший с сервера черновик применяется, только если локального нет или он строго новее;
выборка никогда не очищает черновик — очистка идёт только живым путём.
**Сейчас у нас.** соблюдено (`Core/Chats/ChatStore.swift:306–323`).
*Источник: `docs/richtext-composer.md` (§6 «Draft persistence», «Re-login restore»)*

#### 9.8.6 Правка сообщения не трогает черновик чата
**Правило.** Держи текст правки отдельно от черновика (или запоминай черновик до правки и возвращай его после), а
`persistDraft` при `editing != nil` не вызывай.
**Почему.** У Telegram состояние ввода правки (`editMessage.inputState`) и черновик нового сообщения
(`composeInputState`) — разные значения; синхронизация одного не затирает другое.
**Сейчас у нас.** соблюдено (#499): текст правки хранится отдельно от черновика (`ComposerInput`), после правки в поле
возвращается прежний черновик.
*Источник: `docs/richtext-composer.md` (§6, «Invariant — `ChatInterfaceState.parse` … does NOT override
`editMessage.inputState`»)*

#### 9.8.7 Черновики после повторного входа — один разборщик
**Правило.** Черновик приходит в DTO списка чатов и проходит один путь `ChatStore.mirrorServerDraft`; не заводи второй
разборщик черновика для realtime-события.
**Почему.** У Telegram после входа черновики приходят полем диалога в общем списке; общий разборщик для обоих путей.
**Сейчас у нас.** соблюдено.
*Источник: `docs/richtext-composer.md` (§6 «Re-login restore»)*

#### 9.8.8 Два хранилища одного состояния — один писатель
**Правило.** Текст поля (`view.text`) и `model.draft` — два хранилища; направление записи одно: поле → модель в
`pushText`, модель → поле только как внешняя установка. Не добавляй третье (кеш в контроллере, `@State`-копию в
редакторе); выделение не храни вне поля.
**Почему.** У Telegram счётчик ревизий и выделение хранились в двух местах, одно писали, другое нет — защита стала
тавтологией, набор текста молча не работал.
*Источник: `docs/superpowers/richtext-seam-stage2-inheritance.md` (D35, Task 29, D38)*

#### 9.8.9 Хранится исходник; правка равна отправке
**Правило.** Сообщение хранит исходный Markdown (`content`), правка открывает его же; никогда не хранить отрисованный
текст вместо исходника. Правка проходит те же проверки, что отправка.
**Почему.** У Telegram правка восстанавливает Markdown диалектом того разборщика, который будет его читать, и
классифицирует заново, как отправку.
*Источник: `docs/instantpage-richtext.md` (Editing rich messages, «Re-classify every edit (edit ≡ send)», «The converter
emits CommonMark inline»)*

#### 9.8.10 Не собирать состояние из представления с потерями
**Правило.** Черновик, правка и исходящая очередь хранят исходный текст; никакой путь не собирает состояние поля из
отрисованного `AttributedString` или из превью.
**Почему.** У Telegram обратная запись через «плоскую» строку молча превращала заголовки в абзацы через полсекунды после
вставки; тест-сторож ищет новые такие места в исходниках.
*Источник: `docs/instantpage-richtext.md` (Custom emoji in markdown messages, «NEVER write composer state back through
ChatTextInputState(inputText:selectionRange:)»)*

#### 9.8.11 «Только для показа» — найти все вызовы; регресс-тест должен падать на откате
**Правило.** Прежде чем считать функцию «только для вида», найди все её вызовы (`grep`). Регресс-тест считается
настоящим, только если он падает на откаченном исправлении.
**Почему.** У Telegram «плоскую» проекцию считали отображением, а из неё сериализовали отправку и черновик — эмодзи в
цитате уходили текстом; тест проверен откатом: 4 из 7 краснеют.
*Источник: `docs/instantpage-richtext.md` (Custom emoji in markdown messages, «The flat projection is READ on the send
path too»)*

#### 9.8.12 Проверка «изменилось ли» сравнивает всё, что уходит
**Правило.** «Сохранить правку» неактивна, только если не изменилось ничего из отправляемого (текст, вложения, ответ).
**Почему.** У Telegram охрана «ничего не поменялось» сравнивала только текст и пропускала смену вида.
*Источник: `docs/instantpage-richtext.md` (Editing rich messages, «Change-detection compares the rich attribute»)*

#### 9.8.13 Длинный текст: граница сервера, разметку не резать
**Правило.** Длину сообщения ограничивает сервер (ключ `validation.*`); клиент проверяет ту же границу до отправки и не
делит Markdown посередине разметки.
**Почему.** У Telegram богатое сообщение обходит деление на куски по 4096 символов; при сбое разбора идёт обычный путь,
который делит.
**Применимость.** частично — своего деления на куски у нас нет.
*Источник: `docs/instantpage-richtext.md` (Markdown send, «Transmission»)*

#### 9.8.14 Производное от текста — с ключом-самим-текстом
**Правило.** Производное от текста (подсветка поиска, найденные ссылки, разбор кода) храни с ключом-текстом, как
`RichText`/`MessageCodeBlocks`: правка меняет ключ. Если ключом станет id — сверяй с текущим текстом и отбрасывай
целиком при любом несовпадении.
**Почему.** У Telegram подсветка хранится на сообщении и может пережить правку; каждый диапазон сверяется с текущей
строкой, при несовпадении выбрасывается вся подсветка.
*Источник: `docs/instantpage-richtext.md` (Syntax highlighting, «A cached highlight can outlive the text it described»)*

#### 9.8.15 Оптимистичное действие: модель главнее, итог — последнее намерение человека
**Правило.** Оптимистичные действия (`Core/Optimistic/OptimisticSync.swift`, `PerformanceFlags.optimisticActions`) — отметка
пункта чек-листа, голос в опросе — переключают вид сразу, источник истины — пришедшая модель. При отказе откатывается
только своё изменение; если человек успел нажать ещё раз, итог — его последнее намерение, а не снимок до отправки.
Повторный тап до ответа берёт оптимистичное, а не устаревшее значение.
**Почему.** У Telegram откат вернул старое значение поверх более позднего действия: включивший микрофон собеседник
молчал до конца звонка. Двойной тап по галочке перечитывал старое значение и слал его же.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («`active` does not survive a rollback by itself»);
`docs/instantpage-richtext.md` (Task-list checkboxes, Tap-to-toggle, «Optimistic flip, model supersedes»)*

#### 9.8.16 Пункты чек-листа адресовать id с сервера
**Правило.** Пункты чек-листа адресуй id пункта с сервера, не индексом; путь к элементу и обход по нему делаются и
проверяются парой.
**Почему.** У Telegram раскладка ставит структурный путь `[Int]`, а функция переключения по нему ходит — их проверяли
вместе.
*Источник: `docs/instantpage-richtext.md` (Task-list checkboxes, «Checkbox identity is a structural [Int] path»)*

#### 9.8.17 Живое состояние карточки пишется в сохранённое сообщение
**Правило.** Событие с полным состоянием карточки обновляет `MessageRecord.extras` в транзакции
(`AppDatabase.writer.write`); память — только сигнал для открытого экрана.
**Почему.** У Telegram новое общее состояние записывается в сохранённую медиа сообщения тем же путём, что серверное
обновление; в памяти — только расписание опроса.
**Сейчас у нас.** соблюдено (#499): `checklist:updated` и свой ответ ложатся в `extras` сохранённого сообщения.
*Источник: `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§4 «My calls», п. 3)*

#### 9.8.18 Изменение данных не пересоздаёт карточку; другое сообщение — пересоздаёт
**Правило.** Идентичность карточки = id сообщения (+ режим: превью/пересылка/закреп), а не её данные: новые результаты
опроса или пункты чек-листа обновляют вид на месте, не сбрасывая локальное состояние (выбранные, но не отправленные
варианты `selection` в `ChatPollView`, раскрытость). Обратно: ячейка `UICollectionView` с `UIHostingConfiguration`
(`MessageListView.configure`), переиспользованная для другого сообщения, обязана сбросить `@State` карточки — нужен
`.id(poll.id)` или `task(id:)`, включающий `poll.id`.
**Почему.** У Telegram ключ реестра виджета — контекст (флаги, пересылка, тип чата, зритель), а не состояние: правка
состояния доходит в работающий виджет без перезапуска.
**Сейчас у нас.** проверить на iPhone: `ChatPollView` перезагружается по `.task(id: realtime.pollSignal(poll.id).version)`
(`Features/Chats/Thread/ChatPollView.swift:95`), а у двух разных опросов версия обычно одинакова (0) — если SwiftUI
сохранит состояние при переиспользовании ячейки, покажутся результаты чужого опроса.
*Источник: `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§4, п. 10);
`docs/message-widgets-native-runtime.md` («The widget's state and requests», «Nothing restarts»)*

#### 9.8.19 У запроса из пузыря — ровно один исход
**Правило.** Каждое действие из пузыря (голос, закрытие опроса, отметка пункта, реакция, загрузка превью ссылки)
завершается ровно одним исходом — успех, ошибка или отмена — и снимает флаг занятости (`defer { isVoting = false }` в
`ChatPollView` — образец). Задавай явный `Endpoint.timeout` (иначе действует системный таймаут `URLSession`); ответ для
исчезнувшей карточки игнорируй; при переиспользовании ячейки отменяй `Task`. Для сообщения без `remoteId` (в очереди)
запрос с локальным id не шли — жди подтверждения или откажи сразу. Ожидание из-за 429 не пережидается молча.
**Почему.** У Telegram запрос без исхода — провал (виджет больше не сможет спросить); через 30 с без ответа запрос
завершается как failed; запрос локального сообщения сразу получает отказ; при смене сообщения в узле запросы
отменяются.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («A request reaches the bot from the bubble»);
`docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§3 анти-цели, §4 п. 5);
`docs/message-widgets-native-runtime.md` («Requests»)*

#### 9.8.20 Окно с действием завершает свой вызов при любом закрытии
**Правило.** Листы с действием (создание опроса, пересылка) при закрытии свайпом или сменой аккаунта завершают ожидающий
вызов (`continuation` возобновляется), не оставляя вечно ждущий `await`; уже отправленное на сервер уходом с экрана не
отменяется.
**Почему.** У Telegram окно, закрытое любым путём, кроме своих кнопок, завершает вызов отказом; запрос, сообщающий об
оплате, держит координатор, а не пузырь.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («The window holds its call», «The coordinator holds
the call, not the bubble»)*

#### 9.8.21 Ошибки действия показываются по коду; неизвестное — «не удалось»
**Правило.** Ошибки действий карточек показывай через `error.userMessage` (`APIError`), с отдельными ветками для 429
(подождать) и для «опрос закрыт / нет прав»; неизвестный код — общее «не удалось», без падения и без молчания.
**Почему.** У Telegram явная таблица соответствия кодов исходам (`WIDGET_RESPONSE_TIMEOUT` → timeout, `FLOOD_WAIT_*` →
rate limited), всё неизвестное — failed.
*Источник: `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§4, п. 5)*

#### 9.8.22 Опрос состояния — только для видимого, с дросселем и одним «носителем» на сущность
**Правило.** Результаты опроса кешируй по `pollID` (в `RealtimeCoordinator` или хранилище); при появлении ячейки
перечитывай не чаще раза в N секунд, если не было `poll:updated`; один запрос в полёте на `pollID`; вне экрана —
ничего.
**Почему.** У Telegram ничего не опрашивается вне экрана; первый опрос сразу при появлении, затем не чаще раза в 5 с;
на один `widget_id` — один опрашивающий виджет.
**Сейчас у нас.** расходится: `ChatPollView` перечитывает результаты на каждом появлении ячейки (`.task(id:)`,
`ChatPollView.swift:95`), и два пузыря с одним опросом (пересылка) грузят его дважды.
*Источник: `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§4.A, §4 п. 3–4, анти-цели)*

#### 9.8.23 «Читать далее»: раскрытие на месте, один запрос
**Правило.** «Читать далее» в постах и статьях, загрузка полного текста статьи — одна загрузка в полёте на ключ (как
`optimisticActions`); полное уже в кеше — раскрыть сразу; пузырь растёт вниз без прыжка верха; повторное раскрытие
защищено.
**Почему.** У Telegram состояние «показать больше» локально для сообщения и сверяется с текущим id; есть защита от
второго запроса и повторного раскрытия.
*Источник: `docs/instantpage-richtext.md` («Show more» for partial rich messages)*

#### 9.8.24 Переход к цели по шагам — с гарантией остановки
**Правило.** Переход к сообщению (ответ, закреп, поиск) подгружает страницы до нахождения; каждый шаг обязан
продвигаться, иначе остановка и сообщение «не найдено» — не бесконечный цикл подгрузок.
**Почему.** У Telegram раскрытие вложенных `<details>` по одному уровню завершается защитой прогресса: «не продвинулись
— сдаёмся».
*Источник: `docs/instantpage-richtext.md` (Anchor navigation, «The expansion loop terminates via a progress guard»)*

#### 9.8.25 Действие предлагается, только если оно выполнимо
**Правило.** Пункты меню сообщения (`MessageMenuTests`) показываются по проверке выполнимости, а не «всегда».
**Почему.** У Telegram «Цитировать» показывается, только пока выделение превращается в цитату.
*Источник: `docs/instantpage-richtext.md` (Rich reply quotes, «Quote is offered only while the selection maps to a quote»)*

### 9.9 Неприменимо к нам
- Значок непрочитанного на кнопке «Назад» у чата, открытого из ленты новостей
  (`submodules/TelegramCore/Sources/State/CLAUDE.md`) — счётчика на кнопке «Назад» у нас нет.
- Ключ шифрования базы и перешифровка живого файла — только процессом-владельцем, генерация ключа под `flock`
  (`submodules/Postbox/CLAUDE.md`) — база у нас не шифруется, и процесс один (расширений нет).

---
## §10. Безопасность, приватность, вход и выход, ссылки

Раздел о том, как клиент обращается с сессией, секретами, ссылками и чужим содержимым. Главная мысль:
ложный выход и утечка токена хуже любой другой ошибки, а всё, что пришло в сообщении от другого человека,
недоверенно — его разбор не должен падать, ходить в сеть или открывать что-то молча. Граница безопасности при этом
всегда на сервере; клиентские проверки — удобство и защита от случайностей.

### 10.1 Сессия и выход из аккаунта

#### 10.1.1 Ложный выход — худший исход: условия выхода только сужаются
**Правило.** Единственный путь к «сессия кончилась» — ответ `/auth/refresh` с конвертом ошибки, чей код
`meansSessionExpired` (`UNAUTHORIZED`/`TOKEN_EXPIRED`), в `SessionStore.refreshNow()`. Выходом не являются и не должны
стать: 401 обычного эндпоинта (`APIClient` делает одно продление и отдаёт ошибку экрану), отказ сокета
(`RealtimeCoordinator` только переподключается), `malformedResponse(401)` от прокси или капчи Wi‑Fi (у него нет
`code`), 403/429/5xx, ошибка декодирования, запертая связка ключей. Перед любой правкой `Core/Session/*`,
`Core/Network/APIClient.swift`, `App/AppSessionModel.swift`, `Core/Push/PushSync.swift` и частей `Core/Realtime/*`
про токен перечитай этот подраздел. Новое условие, ведущее к `forgetSession()`/`sessionEnded`, — только с согласия
владельца и с тестом в `SessionStoreTests`/`AccessTokenTests` (в том числе «транзиентная ошибка не выходит»).
**Почему.** Выход отбрасывает человека на экран входа и теряет его состояние; у Telegram он стирает локальные данные,
поэтому каждый путь к нему обнесён несколькими условиями сразу, и ни одно из них ослаблять нельзя.
**Сейчас у нас.** соблюдено: ворота в `SessionStore` (одно продление в полёте, запертая связка — не продлевать и не
стирать, выход только по `meansSessionExpired`, обрыв сети откладывает решение, один повтор после потерянного ответа).
*Источник: `CLAUDE.md` (Subsystem guides: «A false logout is the worst outcome there is… never loosen the gates»);
`submodules/TelegramCore/Sources/Network/CLAUDE.md` (вводный абзац); `submodules/MTProtoRustEngine/CLAUDE.md` («Refused
binds alone never log out», финальная фраза)*

#### 10.1.2 Вердикт сервера окончателен, перепроверка его не отменяет
**Правило.** Если `/auth/refresh` вернул конвертный `UNAUTHORIZED` (токен отозван, цепочка порвана, пользователь
заблокирован), принимай его сразу (`forgetSession()` + `sessionEnded`) — не «перепроверяй» через `/auth/me` или второй
refresh. Обратная сторона: 401 на обычном запросе — не вердикт о сессии; вердикт выносит только refresh.
**Почему.** Ответ сервера по существу уже решение; дополнительная проба может сказать только меньше и лишь задержит
выход.
*Источник: `submodules/MTProtoRustEngine/CLAUDE.md` («Never gate it on `MTContext.checkIfLoggedOut`…»)*

#### 10.1.3 Решение о сессии — только по живому ответу; локальная годность — не решение
**Правило.** Истёкший локально `AccessToken.isUsable()` и `SessionRestoration.cached` — повод продлить, а не вывод о
сессии. `isUsable()`/`earlyRefreshWindow` решают только, слать ли токен или продлить заранее; отозван ли токен, знает
только сервер. Режим `ScreenCache` `.cachedOnly` никогда не продлевает сессию и ничего о ней не решает. Таймаут
продления — «нет вердикта» (`refreshUndecided`), не выход. Роль и scope берутся только из JWT (`AccessToken`), никогда
из состояния интерфейса или ответа экрана.
**Почему.** У Telegram проверка обязана уйти на сервер со свежим ключом и никогда не отвечает по сохранённому
состоянию; локальная годность сессии не заменяет сверку с авторитетным хранилищем.
**Сейчас у нас.** соблюдено: так устроены `APIClient.perform` и `SessionStore.restore()`.
*Источник: `submodules/MTProtoRustEngine/CLAUDE.md` («The probe must contact the server…», «gives up without a verdict
after 120 s»); `docs/passcode.md` («`isValid` alone checks local lifetime/revocation…»)*

#### 10.1.4 Нет ответа или отказ «по другой причине» — нет вердикта
**Правило.** Транспортная ошибка, 5xx, `malformedResponse` ≥ 500 (`APIError.isUndecided`), 429 (лимит refresh,
`BACKEND_RULES §6.3`), 403 блокировки вуза и неподтверждённого работодателя (сервер намеренно не гасит цепочку —
`auth.service.ts`), режим техработ — всё это `refreshUndecided`, не выход. Повтор продления после потерянного ответа —
ровно один (`scheduleRetryAfterLoss`, флаг `retriedAfterLoss`). Пока связка ключей заперта (`SecretStore.isLocked`, до
первой разблокировки после включения), продление не запускается и ничего не стирается (`refreshNow`,
`resumeAfterUnlock`). Сохраняй эти ветки при правках.
**Почему.** У Telegram серия отказов сама по себе ничего не доказывает: выход только после двух `-404`, второй — на
новом соединении; любой другой ответ, даже ошибка, оставляет аккаунт.
*Источник: `submodules/MTProtoRustEngine/CLAUDE.md` («A server refuses fresh temporary keys for a while for other
reasons too…»; «Any answer to that call, an error included, keeps the account…»; «-404 twice…»)*

#### 10.1.5 Смерть сессии не выводится из косвенных признаков
**Правило.** Не заключай, что сессия мертва, из того, что сокет не подключается, пуш не доходит или экраны получают
401. Решает только ответ refresh (10.1.1).
**Почему.** У Telegram ключ, который сервер признавал в последние сутки, не может разлогинить инцидент на стороне
сервера («иммунитет»).
**Применимость.** частично — отдельного механизма иммунитета нам не нужно: явный конвертный отказ refresh строже;
переносится принцип.
*Источник: `submodules/MTProtoRustEngine/CLAUDE.md` («…within the last day… This is tdlib's immunity»)*

#### 10.1.6 Серверное завершение не стирает данные, явный «Выйти» — стирает
**Правило.** Держи разделение: сессию закрыл сервер (`AppSessionModel.sessionDidEnd`) — данные остаются; войдёт тот же
человек — пригодятся, другой — их сотрёт `LocalData.claim(for:)`. Явный «Выйти» (`AppSessionModel.signOut`) — стирает
(`LocalData.erase()`). Не переносить `LocalData.erase()` в путь серверного завершения.
**Почему.** Цена ложного выхода у Telegram высока именно потому, что выход стирает локальные данные.
**Сейчас у нас.** соблюдено.
*Источник: `submodules/MTProtoRustEngine/CLAUDE.md` («a logout wipes local data»)*

#### 10.1.7 Пропавший обязательный секрет — ошибка, а не «начать заново»
**Правило.** Если `hasStoredSession` есть, а refresh-токен не читается, сначала проверь `isLocked` (заперта — ждать
разблокировки), затем `restoreRefreshCookieIfNeeded`; молча считать человека «не входившим» нельзя.
**Почему.** У Telegram отсутствие записи, существование которой уже установлено, — ошибка, а не разрешение создать
новую незащищённую.
**Сейчас у нас.** соблюдено в `SessionStore`; сохраняй.
*Источник: `docs/passcode.md` («Once a `.secured` challenge has established that a credential must exist…»)*

#### 10.1.8 Запоздавший успех применяется, только если поток ещё актуален
**Правило.** После каждого `await` в потоках входа проверяй, что поток ещё текущий (`Task.isCancelled`, экран ещё
показан, это тот же запрос), и только потом зови `session.adopt`. Отмена пользователем (закрыл лист, «Назад») — не
ошибка и не неверная попытка. Главный случай — продление сессии: результат, пришедший после смены эпохи, отбрасывается.
**Почему.** У Telegram синхронная проверка может закончиться после отмены вызывающим, и потребитель обязан отбросить
поздний успех; отмена биометрии не идёт по пути «неверный PIN».
**Сейчас у нас.** соблюдено (#499): после claim QR и ответов входа/2FA проверяется, что поток ещё текущий.
*Источник: `docs/passcode.md` («Biometric failures and cancellations do not run the incorrect-PIN path…»; «rejecting a
result made stale while the OS prompt was outstanding»)*

#### 10.1.9 Смена учётных данных гасит сессии, клиент сверяется с итогом
**Правило.** Смена пароля: сервер гасит все сессии, клиент сразу выходит (`SecuritySettings.save` →
`session.signOut()`) — так держать. Включение/выключение 2FA меняет claim `tfa` — после ответа продли сессию, чтобы
токен отразил новое состояние. Ответ на такую операцию потерян (`isUndecided`) — не считай, что она не прошла:
перечитай состояние с сервера.
**Почему.** У Telegram прерванная операция с учётными данными сверяется с тем, что реально записано; отмена не делает
старые данные снова авторитетными.
*Источник: `docs/passcode.md` («Credential mutations invalidate local sessions»; «…callers reconcile the committed
result»)*

#### 10.1.10 Выход и смена аккаунта останавливают всю работу прежнего человека
**Правило.** При выходе и смене аккаунта останавливай работу прежнего человека — outbox (`OutboxService`), загрузки,
`RealtimeCoordinator`, предзагрузки, живые трансляции геопозиции (`LiveLocationSharing`) — и отбрасывай её результаты,
пришедшие после (`AppSessionModel.signOut`, `LocalData.erase`, `AppServices.router.reset()`).
**Почему.** У Telegram локальные полномочия узкие, короткие и отзываются при смене учётных данных и аккаунта.
**Сейчас у нас.** соблюдено (#499): выход останавливает трансляции геопозиции.
**Применимость.** частично — локальных полномочий со сроком у нас нет (права в JWT); переносится «смена аккаунта
отзывает всё».
*Источник: `docs/passcode.md` («Sessions and authorization checks»; «Credential changes, account changes… revoke
authorization»)*

#### 10.1.11 Любое локальное хранилище стирается вместе с аккаунтом
**Правило.** Каждое новое локальное хранилище (ключ `UserDefaults`, кеш в памяти, файл) регистрируется в
`LocalData.erase()` (`App/AppSessionModel.swift`) в том же PR.
**Почему.** У Telegram хранилище виджета лежит в производных атрибутах сообщения и уходит вместе с сообщением, чатом и
аккаунтом; превью держит его только в памяти.
**Сейчас у нас.** соблюдено (#499): выход чистит `chats.liveLocations` и кеш `MessageCodeBlocks`.
*Источник: `docs/message-widgets-native-runtime.md` («Storage»); `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` (§4 п. 7)*

#### 10.1.12 Связка ключей переживает удаление приложения
**Правило.** Реши (владелец), сбрасывать ли сессию после переустановки. Если да: признак установки в `UserDefaults`
(он удаляется с приложением); нет признака и есть `sessionPresent` → сначала попытаться погасить сессию на сервере (как
отложенный выход), затем стереть записи `SecretKey`, и только потом всё остальное.
**Почему.** Записи связки ключей переживают удаление; Telegram при подтверждённой свежей установке стирает их до всего
остального. Люди часто удаляют приложение, чтобы «выйти».
**Сейчас у нас.** соблюдено (волна 5): первый запуск новой установки (`InstallationMarker`, отличие от обновления — по `AppDatabase.storeExists`) стирает сессию из Keychain, refresh гасится на сервере через `completePendingLogouts`, запуск не ждёт.
*Источник: `docs/passcode.md` («Destructive reset and fresh installations»)*

#### 10.1.13 Сроки — на монотонных часах; попытки считает сервер
**Правило.** Попытки входа и 2FA считает сервер (`LOGIN_LOCKED`, `BACKEND_RULES §6.3`) — своего счётчика на клиенте не
заводи, показывай ответ сервера. Локальные сроки (истечение QR, пауза «отправить код ещё раз») считай по
`ContinuousClock`/`SuspendingClock`, а не по `Date()`, чтобы перевод часов их не сбивал.
**Почему.** У Telegram сроки блокировки меряются по аптайму, и перезагрузка их не снимает.
**Сейчас у нас.** соблюдено (#499): срок QR считается по `ContinuousClock`.
*Источник: `docs/passcode.md` («Verification, attempts, and locking»)*

### 10.2 Секреты, логи и телеметрия

#### 10.2.1 Связка ключей: явный адрес и только это устройство
**Правило.** Каждый запрос `Keychain` (`Core/Session/SecretStore.swift`) задаёт `kSecAttrService` и `kSecAttrAccount`;
доступность — `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (обоснование — тихий пуш после перезагрузки). Не
добавляй запросов без service, не меняй на `Always` и на варианты без `ThisDeviceOnly` (refresh уехал бы в резервную
копию). Появится App Group — секреты сессии в общую группу не кладутся.
**Почему.** У Telegram синхронизация явно выключена, у каждого запроса задана группа, и без конфигурации запрос не
уходит вовсе — никакого «запроса без адреса».
**Сейчас у нас.** соблюдено.
*Источник: `docs/passcode.md` («All new Keychain records are generic-password items with synchronization explicitly
disabled…»)*

#### 10.2.2 Записанный секрет проверяется
**Правило.** Проверяй статус `SecItemUpdate`/`SecItemAdd`. Неудачную запись refresh-токена логируй (без значения) и
повторяй при следующем `adopt`.
**Почему.** Если ротированный refresh-токен не записался, после выгрузки приложения в связке останется старый, уже
погашенный: следующий запуск пошлёт его вне окна грации, и сервер порвёт цепочку. Telegram открывает новую обёртку и
сверяет её с ключом до того, как сделать единственной.
**Сейчас у нас.** соблюдено (#499): `Keychain.set` проверяет результат записи в связку ключей.
*Источник: `docs/passcode.md` («A newly created wrapper is opened and compared with the original key before being
committed»)*

#### 10.2.3 Многошаговая запись секретов упорядочена на случай обрыва
**Правило.** Связка ключей не даёт транзакций между записями — порядок выбирай так, чтобы обрыв оставлял безопасное
состояние, и пиши порядок в комментарии. Образец: `SessionStore.adopt` пишет `lastAccessToken`, refresh, затем
`sessionPresent` последним; `forgetSession` убирает refresh раньше `sessionPresent` (обрыв даёт «признак без токена»,
который следующий запуск закроет отказом refresh).
**Почему.** У Telegram «атомарна» только замена одной записи; остальные шаги — отдельные операции с повтором.
**Сейчас у нас.** соблюдено.
*Источник: `docs/passcode.md` («“Atomic” refers to replacing the credential Keychain item…»)*

#### 10.2.4 Миграция хранения секретов: новое, потом стереть старое, повторять до конца
**Правило.** Переезд хранения — идемпотентно и при каждом запуске до готовности: сначала авторитетная новая запись,
потом стирание старой; старую копию не читать как источник истины. Образцы: `RefreshCookieJar.purgeSystemStorage()` на
каждом запуске, перевод записей на `ThisDeviceOnly` в `Keychain.set`.
**Почему.** У Telegram незавершённая очистка повторяется при следующей инициализации, пока не записан маркер.
**Сейчас у нас.** соблюдено.
*Источник: `docs/passcode.md` («AccountManager migration and metadata cleanup»)*

#### 10.2.5 Пароль и коды на клиенте не хранятся нигде
**Правило.** Пароль, код 2FA, резервные коды, токены сброса и инвайта не кладутся в `UserDefaults`, черновики,
восстановление состояния сцены, кеш экранов (список исключений `excludedRoots`/`excludedSegments` в
`Core/Cache/ScreenCache.swift` держи актуальным) и логи. Резервные коды показываются один раз и не кешируются.
**Почему.** У Telegram код-пароль не хранится и не сравнивается в открытом виде.
*Источник: `docs/passcode.md` («The passcode is neither stored nor compared to a plaintext verifier»)*

#### 10.2.6 Типы с секретами печатаются без секретов
**Правило.** Типам, несущим токены, дай `CustomStringConvertible`, `CustomDebugStringConvertible` и `CustomReflectable`
без секретов (роль, `sub`, срок — можно). Значения в `Logger` — с `privacy: .private`, кроме исхода.
**Почему.** Синтезированное описание обходит любое редактирование логгера: `"\(state)"`, `dump`, `print`, хлебная
крошка Sentry выдадут JWT или refresh-токен. У Telegram `Api`-перечисления печатают только имя конструктора.
**Сейчас у нас.** соблюдено (#499): типы с токенами описывают себя без секретов.
*Источник: `submodules/TelegramApi/CLAUDE.md` («`Api` enums print their constructor name only… `"\(value)"` bypasses
the logger's redaction»)*

#### 10.2.7 В логах и ошибках — тип и код, не содержимое
**Правило.** Токены, пароли, refresh-cookie, тексты сообщений — никогда в логи, `Signposts`, Sentry. Не интерполируй
`error`, тело ответа, URL с `?token=`/`?t=` (HLS, presigned) и заголовки в `Logger`/Sentry; новая ошибка в трекер —
только код и идентификаторы. Образцы: `Observability.unexpectedResponse(statusCode:kind:)`, интервалы `Signposts`
(«только исход, без токена»). `beforeSend` в `Observability.start()` (стирает email/username/IP;
`sendDefaultPii = false`, без скриншотов и дерева вью) не ослабляй. Корневой `AGENTS.md`: токены в логах — абсолютный
запрет.
**Почему.** У Telegram логгер записывает тип, домен, код и класс ошибки, а не её содержимое; секретов нет ни в ошибках,
ни в контексте лога.
**Сейчас у нас.** соблюдено (#499): в крошку идут только домен и код ошибки, без `localizedDescription`.
*Источник: `CLAUDE.md` (Code Style Guidelines — Error Handling); `docs/passcode.md` («WalletLogger records error type,
domain, code, and classified kind…»)*

#### 10.2.8 Наружу — только разрешённые ключи; адрес — шаблоном маршрута
**Правило.** У каждой хлебной крошки и события телеметрии — фиксированный список ключей; адреса — шаблоном маршрута
(`chats/:id/messages`), без id, query и токенов. Сетевые крошки Sentry выключи (`enableNetworkBreadcrumbs = false`) или
зачищай в `beforeBreadcrumb`. Закрепи тестом: ключи каждой крошки — из белого списка.
**Почему.** У Telegram всё, что уходит в телеметрию, проходит белый список, закреплённый тестом
(`testReportedFieldsAreAllowlisted`): имена методов — из описания функции, тексты ошибок — константы, числа и токены
вырезаны, размеры округлены.
**Сейчас у нас.** соблюдено (#499): сетевые крошки Sentry без адресов.
*Источник: `submodules/TelegramCore/Sources/Network/CLAUDE.md` («Anonymization is enforced by tests»)*

#### 10.2.9 Секрет не пересекает границу
**Правило.** Токены сессии не попадают в URL (кроме выданных для этого медиатокенов `?t=`), в
`SFSafariViewController`, веб-страницы, аналитику; refresh-cookie уходит только на `auth/*` (`APIClient.request`).
**Почему.** У Telegram ключ шифрования остаётся в хосте, модуль в песочнице его не получает.
*Источник: `docs/superpowers/plans/2026-09-16-tgcalls-mtproto-dtls-slot.md` (Task 3: «EncryptionKey is a secret and must
not cross into the wasm module»)*

#### 10.2.10 Модель угроз названа честно
**Правило.** В доках и комментариях пиши, от чего защита не спасает: сессия держится на связке ключей `ThisDeviceOnly`
и сервере; от взломанного устройства и от того, кто держит разблокированный телефон, она не защищает. Затирание
секретов в памяти Swift — не гарантия.
**Почему.** Telegram прямо пишет, что модель опирается на доступ к связке ключей и доверенный код приложения, а
очистка буферов — «по возможности».
*Источник: `docs/passcode.md` («The protection model relies on Keychain access controls… explicit buffer clearing is best
effort»)*

### 10.3 Ссылки

#### 10.3.1 Ссылка снаружи разбирается одним строгим разборщиком на все входы
**Правило.** Ссылки входа и сброса — только через `AuthLink(url:)` (с `isWellFormed`: токен встаёт в путь запроса,
`../` увёл бы его) — для `onOpenURL` в `RootView` и вставки в `PasteLinkView`; принимать только свою схему и домен и
не логировать такую ссылку целиком. Разделы приложения — через `DeepLink`/`CommunityDeepLink`/`AreaDeepLink` (для
`AppShellView.onOpenURL`, пушей `PushRouting` и ленты). Новый вход (сканер QR, Spotlight, виджет) идёт через тот же
разборщик. Новую форму адреса вводи так, чтобы старая сборка вернула `nil` и открыла браузер, а не «съела» ссылку.
**Почему.** У Telegram все входы ссылок (QR, буфер, `tg://`/`t.me`) идут через один строгий разбор, а новая форма
устроена так, чтобы старый клиент её отверг, а не понял неправильно; ручной ввод мягче нарочно. Ссылки с частью входа —
отдельная подсистема.
**Сейчас у нас.** соблюдено: требование про старую сборку уже записано в комментарии `DeepLink`
(`Core/Navigation/DeepLink.swift:138`).
*Источник: `submodules/WebProxyTransport/CLAUDE.md` («`parseWebProxyLinkComponents`, which every link entry point… goes
through»; «The `0x70` marked secret…»); `CLAUDE.md` (Subsystem guides, «Smaller ones»: links with a login part)*

#### 10.3.2 Путь и токены регистр сохраняют
**Правило.** При разборе и сравнении адресов к нижнему регистру приводи только схему и хост (`DeepLink`,
`ProfileShare.isOurWeb`); путь, query и токены (`token`, `k`, коды QR) — никогда.
**Почему.** У Telegram путь чувствителен к регистру и никогда не сворачивается, в отличие от хоста.
**Сейчас у нас.** соблюдено в `ProfileShare.isOurWeb` (`Features/Chats/Thread/MessageCards.swift:26–30`).
*Источник: `submodules/WebProxyTransport/CLAUDE.md` («The path is case-sensitive and never folded, unlike the host»)*

#### 10.3.3 «Своя или чужая ссылка» решает одна функция; свои открываются внутри
**Правило.** Решение «ссылка на наш веб / на профиль / внешняя» принимай одной функцией (сейчас `ProfileShare.isOurWeb`
и `profileID` в `MessageCards.swift`) и зови её из текста сообщения, превью, карточки профиля, диплинков пушей
(`Core/Navigation`). Свои адреса (`AppConfiguration.webBaseURL`, `/chats/…`, `/articles/…`) перехватывай через
`OpenURLAction` и открывай в приложении. Второй разбор URL в другом файле не заводи.
**Почему.** У Telegram каждое решение — одна функция, которую читают все пути; ссылка-фрагмент `#…` всегда
перехватывается и никогда не открывается как внешний адрес.
*Источник: `docs/message-widgets-native-runtime.md` («Profile enforcement (V4)», «The agreement points»);
`docs/instantpage-richtext.md` (Anchor navigation)*

#### 10.3.4 Все внешние ссылки уходят через один открыватель
**Правило.** Сделай один открыватель (расширить `ChatInAppBrowser`), поставь `.environment(\.openURL, OpenURLAction {…})`
в корне и пропускай через него все пользовательские ссылки: внешние http(s) — в `SFSafariViewController`; не-http(s)
схемы из содержимого — не молча (отказ или подтверждение с полным адресом); адрес с `user`/`password` в URL или с
похожими на `/` символами в authority (например, `∕` U+2215) — только после подтверждения. Одновременно висит одно
подтверждение. Любой новый путь открытия ссылок — через этот открыватель.
**Почему.** В `https://telegram.org∕test∕@evil.org` знак `∕` — не слэш, ссылка ведёт на evil.org. Telegram ставит
проверку в единственную точку, через которую уходит каждая внешняя ссылка.
**Сейчас у нас.** соблюдено (#499): все ссылки — через единый `ExternalLinkOpener` (`openURL` в корне приложения),
контакт и встреча тоже.
*Источник: `submodules/UrlWhitelist/CLAUDE.md` («Links with a login part»; «The check runs in the external-URL opener…»);
`docs/message-widgets-native-runtime.md` («The SDK… Links»: `checkLink`, одна confirmation за раз);
`docs/superpowers/specs/2026-10-13-message-widgets-design.md` (§5 «openLink»)*

#### 10.3.5 Человеку показывается настоящий адрес
**Правило.** В подписи превью ссылки, в подтверждении и в заголовке меню долгого нажатия показывай хост из самого URL
(`url.host()`, без `user@`); `preview.siteName` — только дополнительно. «Копировать» копирует исходную строку как
написана. Согласие на адрес запоминай на время сессии.
**Почему.** `og:site_name` пишет чужой сайт и может назваться кем угодно («StudentHub», «Kaspi»). Telegram в каждом
подтверждении и меню показывает адрес без «логина», а подтверждённый адрес не спрашивает дважды.
**Сейчас у нас.** соблюдено (#499): подпись превью ссылки — хост из самого адреса, а не `og:site_name`.
*Источник: `submodules/UrlWhitelist/CLAUDE.md` («Every prompt, and the title of every long-press link menu…»);
`docs/message-widgets-native-runtime.md` («The SDK… Links»)*

#### 10.3.6 Ссылка, чей текст не совпадает с адресом, — с подтверждением
**Правило.** Markdown-ссылка `[текст](url)` в сообщении или посте, где видимый текст сам похож на адрес/домен и его хост
не совпадает с хостом назначения, открывается только после подтверждения с показом настоящего адреса.
**Почему.** Видимый текст может быть «studenthub.kz», а адрес — чужим. Telegram помечает такие ссылки и всегда
спрашивает «Открыть ссылку?» для ссылок из чужого содержимого (флаг `forceConcealed`, который обязан уважать любой новый
открыватель).
**Сейчас у нас.** соблюдено (#499): markdown-ссылка, чей текст похож на другой адрес, открывается после подтверждения с
настоящим адресом.
*Источник: `submodules/UrlWhitelist/CLAUDE.md` («The prompts in `openUserGeneratedUrl` and `TextLinkHandling` also flag
such links»); `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («The prompt»)*

#### 10.3.7 Внутренний адрес не показывается и не пересылается
**Правило.** Ссылки, которые человек видит или пересылает («Поделиться профилем», `ProfileShare`), строй от
`AppConfiguration.webBaseURL` — никогда от адреса API, MinIO, presigned-ссылки или Wi‑Fi-адреса компьютера
(`scripts/device.sh --local`).
**Почему.** У Telegram подставной `127.0.0.1` живёт только внутри транспорта; везде видно публичное имя.
*Источник: `submodules/WebProxyTransport/CLAUDE.md` («The loopback address never leaves MtProtoKit…»)*

### 10.4 Недоверенное содержимое сообщений

#### 10.4.1 Разбор данных из сети и из сообщения никогда не падает
**Правило.** Всё, что разбирает данные с сервера или из сообщения (LQIP data-URI, `MessageCodeBlocks.parse`, превью
ссылок, волна голосового, JSON-расширения сообщения), пиши без `!`, `fatalError`/`precondition`, с ограничением длины и
числа элементов и с проверкой арифметики на переполнение; сбой — пустой результат или запасной путь.
**Почему.** У Telegram парсер сегментов видео проверяет каждый размер и время на переполнение, ограничивает число
элементов и отдаёт непонятное запасному пути; это закреплено тестом `testCorruptedBoxesNeverTrap`.
*Источник: `submodules/HLSPlayback/CLAUDE.md` («A part's timing comes from its boxes»); `docs/native-hls-player.md`
(«A part's timing is read from its boxes»)*

#### 10.4.2 Враждебное сообщение не роняет, не морозит и не истощает приложение
**Правило.** Текст сообщения или поста — от другого человека. Любой его разбор (`RichText`, упоминания, markdown через
`AttributedString(markdown:)`, `NSDataDetector`, регэкспы, будущая подсветка кода) — без неограниченной рекурсии, с
пределом глубины и объёма (длина — лимит сервера, для превью — срез), тяжёлое — вне главного потока; на пределе —
показать простым текстом. Размер декодируемых картинок ограничен (`maxPixelSize`). Тест на злонамеренный ввод: текст
100 КБ, тысячи ```` ``` ````, глубокая вложенность `>`/`*`/скобок, «залго».
**Почему.** У Telegram рекурсивная подсветка с циклом в грамматике переполняла стек — удалённое падение от одного
сообщения; глубину ограничили (`kMaxTokenizeDepth` 128). Виджеты ограничены по CPU на шаг, памяти и числу операций,
потому что нативный вызов не прервать.
**Сейчас у нас.** соблюдено частично: подсветки нет, `MessageCodeBlocks.parse` линейный.
*Источник: `third-party/libprisma/CLAUDE.md` («the recursion bound»); `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md`
(«A hostile message must not crash, freeze or exhaust the app»)*

#### 10.4.3 Строгий разбор там, где отказ должен быть виден
**Правило.** Данные, целостность которых важна (подписи, токены, QR-нагрузка, `DataURL.data(from:)`, бинарные ответы),
декодируй строго: `String(data:encoding: .utf8)` → `nil` = ошибка; не `String(decoding:as:)`. Терпимость к неизвестному
(`ChatKind.unknown`, папка с цветом вне палитры) — про новые значения перечислений, а не про битые данные.
**Почему.** `String(decoding:)` подставляет U+FFFD и прячет отказ; у Telegram состояние бота декодируется строго, и
«мягкое» декодирование записано в анти-цели.
*Источник: `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§4 «My calls» п. 2, анти-цели)*

#### 10.4.4 Содержимое сообщения не делает запросов к чужим хостам
**Правило.** Всё, что пришло в сообщении (текст, превью ссылки, карточки, стикеры, Markdown), может порождать запросы
только к нашему API и нашему хранилищу (MinIO по подписанным ссылкам). Картинку превью ссылки, если понадобится, —
только через прокси или копию в нашем хранилище, никогда `AsyncImage(url: preview.image)`. Внешние `![](url)`
автоматически не грузить; никаких внешних шрифтов, CSS, картинок по URL из содержимого.
**Почему.** Запрос к чужому хосту раскрывает IP получателя. Это главное требование Telegram к виджетам: никаких сетевых
вызовов с устройства, единственный выход — контейнер, принимающий только `data:`-картинки.
**Сейчас у нас.** соблюдено: сервер отдаёт в `linkPreview` поле `image` с чужим URL
(`apps/api/src/common/link-preview/link-preview.service.ts`), а клиент его сознательно не читает (`MessageExtras.LinkPreview`
в `Core/Chats/ChatDTO.swift` без поля `image`); разбор `inlineOnlyPreservingWhitespace` картинок не создаёт.
*Источник: `docs/superpowers/specs/2026-10-13-message-widgets-design.md` («Goal», Hard requirement);
`docs/message-widgets-native-runtime.md` («The container is the only way out»);
`submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («The runtime opens nothing», «Loads»)*

#### 10.4.5 Загрузка из содержимого — через одну точку, закреплено тестом
**Правило.** Картинки карточек грузятся только нашими загрузчиками (`Core/Images/*`, `AppServices.attachmentURLs`), не
через `AsyncImage`/`URLSession` по строке из DTO. Для новой карточки — юнит-тест в `Tests/StudentHubTests`, который
прогоняет враждебные DTO (чужой хост, `javascript:`, `file:`, огромный `data:`) через построение модели карточки и
проверяет, что ни один URL вне нашего API/хранилища не попал в загрузчик.
**Почему.** У Telegram сканирование исходников на I/O и прогон 110 атакующих документов держат счётчик внешних запросов
на нуле (`testNoIOInTheRuntime`, `testAttackCorpusLoadsNothing`).
**Применимость.** частично — сканера исходников у нас нет; переносится единая точка и тест на враждебный набор.
*Источник: `docs/message-widgets-native-runtime.md` («The container is the only way out»)*

#### 10.4.6 Очистка — на копии для отрисовки, а не в хранимых данных
**Правило.** `content` и `extras` сообщения в GRDB (`MessageRecord`) храни как пришли с сервера; срез управляющих и
двунаправленных символов, ограничение длины, подмену недоступного делай при построении модели для экрана.
**Почему.** Следующая версия правил должна иметь исходник; у Telegram DOM виджета хранит всё написанное, а профиль
безопасности применяется к копии для рендера.
*Источник: `docs/message-widgets-native-runtime.md` («Profile 1 is the renderer's, never the DOM's», Divergences v0.4.0
п. 11)*

#### 10.4.7 Защита в глубину: клиент перепроверяет то, что сервер уже отфильтровал
**Правило.** Схемы ссылок, размеры, mime вложений, уже проверенные сервером, клиент перед открытием или загрузкой
проверяет снова своей функцией; тест кормит клиенту DTO в обход серверных правил.
**Почему.** У Telegram контейнер отказывает в не-`data:` URL сам, даже если валидатор что-то пропустил; тест нарочно
подаёт невалидированные операции.
*Источник: `docs/superpowers/specs/2026-10-13-message-widgets-design.md` (§3); `docs/superpowers/plans/2026-10-13-message-widgets.md`
(Task 5)*

#### 10.4.8 Ограничения клиента не мягче серверных
**Правило.** Лимиты длины (сообщение, подпись, статья) проверяй на клиенте теми же или более строгими правилами, что
`apps/api`, с теми же ключами `validation.*` (`Core/Network/ValidationMessage.swift`).
**Почему.** У Telegram клиентский лимит цитаты строже серверного и считает разделители — иначе сервер отклонит то, что
клиент разрешил.
*Источник: `docs/instantpage-richtext.md` (Rich reply quotes, вступление)*

#### 10.4.9 Текстовые функции — чистые
**Правило.** `RichText.parse`/`decorate` — чистые функции текста (результат кешируется по строке): без логирования
событий, обращений к модели или сети, зависимости от времени.
**Почему.** У Telegram ответы текстовых хуков кешируются по тексту, поэтому хуки обязаны быть чистыми и ничего не
сообщать наружу.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Profile 1 is enforced on the renderer's copy…»)*

#### 10.4.10 Локаль из данных — только после проверки; форматирование — Foundation
**Правило.** Форматирование дат и чисел — только Foundation (`DisplayFormat`, `formatted()`), язык — язык приложения
(ru/kk/en из `Localizable.xcstrings`). Не строй `Locale` из строки, пришедшей с сервера или из содержимого, через
`Locale(identifier:)` без проверки по списку (если понадобится тег — `Locale(components: Locale.Components(identifier:))`).
Результаты `DateFormatter`/`NumberFormatter` не разворачивай через `!`.
**Почему.** Измерено у Telegram: `Locale(identifier: "ar-EG-u-nu-arab")` теряет расширение и даёт сломанную локаль, у
форматтеров `dateFormat` и символы становятся `nil`, а неизвестная система счисления (`en-u-nu-bogus`) роняет
`RelativeDateTimeFormatter` внутри Foundation.
**Сейчас у нас.** соблюдено: `Locale(identifier:)` используется только с `en_US_POSIX` для машинных форматов.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Intl's locale data is widget-sandbox's iOS
glue…»); `docs/message-widgets-native-runtime.md` («Intl»)*

#### 10.4.11 Не захватывать то, чего сборка не понимает
**Правило.** Действия по содержимому (цитата, копирование, пересылка фрагмента) не включают неизвестные этой сборке
части сообщения.
**Почему.** У Telegram цитата обрывается перед нераспознанным блоком: он может содержать текст, который учитывает
сервер.
**Применимость.** частично — цитат-фрагментов у нас нет.
*Источник: `docs/instantpage-richtext.md` (Rich reply quotes: «No quote crosses content this build cannot read»)*

#### 10.4.12 Запрос на переписку: до принятия входящее — без активных ссылок
**Правило.** Пока `ChatRecord.requestIncoming == true` (панель `ChatRequestBar` «Принять/Отклонить» в
`ChatThreadView`), входящие сообщения рисуй без активных ссылок и упоминаний и без перехода из превью; после «Принять»
(флаг сбрасывается локально) — как обычно. Поведение утверждает владелец (меняет UX).
**Почему.** У Telegram, пока в личном чате с не-контактом висит панель «пожаловаться/заблокировать», входящие
недоверенные: ссылки, упоминания, почта — простым текстом, превью ничего не открывает, кнопки скрыты; своё сообщение
снимает состояние локально.
**Сейчас у нас.** решение владельца: `MessageBubbleView` флаг не читает — в сообщениях запроса ссылки и упоминания
активны (панель — `Features/Chats/Thread/ChatThreadView.swift:413`).
*Источник: `submodules/TelegramUI/Sources/CLAUDE.md` (A non-contact's chat before it is accepted)*

### 10.5 Права и действия в сообщениях

#### 10.5.1 Клиентская проверка — не граница безопасности
**Правило.** Скрытие разделов по роли, проверка формы, `AuthLink.isWellFormed` — удобство и защита от случайностей;
граница — guard'ы и проверки сервиса на сервере (`BACKEND_RULES §6.1`). В комментариях и доках не называй клиентскую
проверку защитой.
**Почему.** Telegram в документации называет границей только то, что ею является.
*Источник: `submodules/WebProxyTransport/CLAUDE.md` («Do not describe the shims as the boundary anywhere else — here they
are it»)*

#### 10.5.2 Флаги прав — с сервера как есть
**Правило.** Права действий над карточкой (закрыть опрос, добавить пункт `othersCanAdd`, отметить `othersCanMark`,
остановить трансляцию) бери из полей ответа, а не вычисляй по роли или автору; поля нет — действие скрыть, а не
догадываться. Клиентские проверки — только чтобы не показать заведомо запрещённое.
**Почему.** У Telegram флаги `is_copy`, `can_query`, `background_query` передаются как прислал сервер; вычислять их на
клиенте — провал даже при работающем результате.
*Источник: `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§3, анти-цели)*

#### 10.5.3 Изменяемое состояние перечитывается при каждой конфигурации
**Правило.** Права в чате (может ли писать, роль, закрепление, будущий запрет копирования) читай из текущей модели при
каждой конфигурации ячейки, а не захватывай при создании.
**Почему.** У Telegram защита — настройка чата, переключаемая при открытом сообщении; снимок при создании оставлял
сообщение незащищённым до переиспользования ячейки.
**Применимость.** частично — защиты от скриншотов нет; принцип общий.
*Источник: `docs/instantpage-richtext.md` (Copy protection: «The flag is mutable state on the render context, not a
constructor snapshot»)*

#### 10.5.4 Интерактивность — только для того, что можно изменить
**Правило.** Интерактивные элементы сообщения (отметка чек-листа, голос) включай по правам из `MessageCapabilities`; в
недоступных состояниях (отправляется, удалено) они инертны.
**Почему.** У Telegram галочки переключаются только при праве на правку и только в оригинале — в переводе и в правке «в
полёте» они инертны.
*Источник: `docs/instantpage-richtext.md` (Task-list checkboxes)*

#### 10.5.5 Оптимистичная копия консервативна в правах
**Правило.** Неотправленное сообщение из `OutboxService` (нет `remoteId`) рисует карточку неинтерактивной: голосовать,
отмечать пункты, открывать результаты нельзя, запросов по нему нет. После подтверждения сервером карточка
пересобирается с серверными данными.
**Почему.** У Telegram локальное эхо стартует без прав и без состояния, запросы локальных сообщений сразу «failed»; с
серверным сообщением виджет перезапускается один раз.
**Сейчас у нас.** соблюдено частично: `MessageBubbleView` уже гасит двойной тап при `remoteId == nil`
(`Features/Chats/Thread/MessageBubbleView.swift:154`) — то же нужно для карточек.
*Источник: `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§4 п. 8–10)*

#### 10.5.6 Действие от имени человека — только от его касания, одно на касание
**Правило.** Голос в опросе, отметка в чек-листе, «Остановить» трансляцию, открытие ссылки из карточки выполняются
только из `Button`/жеста и блокируются на время запроса (как `isVoting` в `ChatPollView`); повторное нажатие до ответа
ничего не шлёт. Никогда не отправляй действие карточки из `.task`, `onAppear`, обработчика WS или таймера.
**Почему.** У Telegram ссылка, `copyText`, запрос к боту допускаются, только пока диспетчеризуется настоящее нажатие;
из таймера, кадра или отложенной задачи — отказ.
*Источник: `docs/message-widgets-native-runtime.md` («User activation is the runtime's (V2a)»);
`docs/superpowers/specs/2026-10-13-message-widgets-design.md` (§5); `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§4.A)*

#### 10.5.7 Разрушительное подтверждение не ловит второй тап
**Правило.** Подтверждения, появляющиеся под пальцем (удалить чат/сообщение у всех, выйти), не размещай так, чтобы
кнопка оказалась там, куда придёт второй тап двойного касания, или игнорируй касания ~0,5 с после показа.
**Почему.** У Telegram окно оплаты 0,8 с после показа глотает касания — второй тап двойного тапа не подтверждает платёж.
**Применимость.** частично — платежей нет; переносится на разрушительные действия.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («The wallet», `ignoresTouchesFor`)*

#### 10.5.8 Копирование показывает, что скопировано
**Правило.** «Скопировать код» (`MessageCodeBlockView`) и копирование сообщения подтверждаются тостом «Скопировано»;
в буфер попадает ровно видимое.
**Почему.** У Telegram копирование всегда говорит, что скопировано, — нельзя показать одно, а скопировать другое; где
копирование запрещено, в буфер не попадает ничего.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («copyText copies only where… and always says what
it copied»)*

#### 10.5.9 Копирование из карточки — по тем же правилам, что текст
**Правило.** «Копировать» из карточки (вопрос, пункт, адрес) идёт тем же путём и с теми же ограничениями, что пункт меню
для текста; появится запрет копирования/пересылки в чате — он распространяется и на карточки.
**Почему.** У Telegram `copyText` виджета подчиняется защите чата так же, как выделение текста.
**Применимость.** частично — запрета копирования в чатах сейчас нет.
*Источник: `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§4 п. 6)*

### 10.6 Только публичный API и отладочное вне релиза

#### 10.6.1 Только публичный API системы
**Правило.** Никаких приватных классов UIKit/Core Animation, приватных селекторов, KVC по приватным ключам
(`value(forKey: "_…")`), `dlsym`, ручных `@_silgen_name`/объявлений системных функций (в том числе ICU), обфускации
имён — даже если «работает на телефоне». Нужен эффект, которого нет в публичном API (морф меню, спойлер-пыль, свой
спелл-чекер), — делай публичными средствами или не делай. Системные эффекты iOS 26 — через `#available` с запасным видом.
**Почему.** Непубличные функции линкуются (их экспортирует `.tbd`), но ревью App Store (2.5.1) отклоняет сборку. Telegram
идёт на этот риск сознательно — с шифрованием имён, сканером бинаря, тестами-канарейками и запасным путём, когда
приватный фильтр вернул `nil`.
**Сейчас у нас.** соблюдено: grep по `Sources` не находит `@_silgen_name`, `value(forKey`, `dlsym`.
*Источник: `CLAUDE.md` («The system ICU: only the SDK's headers are public»); `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` («Private UIKit names are
not in the binary»); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Text checking, `SpoilerDustView`);
`docs/context-menu-liquid-morph.md` («Runtime identifiers», «ABI and lifecycle»); `docs/instantpage-richtext.md`
(Tearing the bubble). `submodules/TelegramUI/Components/RichTextEditor/` = `submodules/TelegramUI/Components/RichTextEditor/`*

#### 10.6.2 Отладочные возможности вырезаются из релиза компилятором
**Правило.** Режим UI-тестов (`SH_UITEST_*`, mock API, фикстуры) — только под `#if DEBUG`: в Release окружение процесса
не читается (`App/UITesting/UITestEnvironment.swift`), `MockFixtures.swift` целиком в `#if DEBUG`. Новые отладочные
переключатели — так же; никакой загрузки кода или конфигурации извне в Release. Проверка (предложение): `strings` по
бинарнику из архива `ios-release.yml` не находит `SH_UITEST_`.
**Почему.** У Telegram загрузка внешнего ядра с диска скомпилирована только в тестовый инструмент, и этот флаг в
приложение не добавляется никогда.
**Сейчас у нас.** соблюдено.
*Источник: `CLAUDE.md` (tgcalls Testbench: `TGCALLS_ALLOW_EXTERNAL_WASM_CORE`)*

### 10.7 Проверки на живых аккаунтах и тестовые учётки

#### 10.7.1 На живом аккаунте — только чтение
**Правило.** На iPhone владельца и на Railway (тестовая среда с develop, общие данные вуза) агентская проверка не шлёт
сообщений, не публикует посты и истории, не меняет профиль и настройки без явной просьбы. Разрушительные и массовые
действия (удаление чатов, рассылки) — только на тестовых учётках (mock API, `security.0@`/`librarian.0@` на Railway), не
на личном аккаунте владельца. Отправку проверяют UI-тесты на mock. Что можно и как вернуть изменённое — §15.3.5.
**Почему.** У Telegram проверка в приложении с вошедшим аккаунтом — только чтение, а стенд гоняют на выделенном
симуляторе, не там, где вошёл пользователь.
*Источник: `docs/superpowers/plans/2026-10-28-shared-media-grid-stage1.md` (Global Constraints); `Tests/WidgetHarness/CLAUDE.md`
(Build, test, run: «…never K3 (the user's logged-in Telegram)»)*

#### 10.7.2 Тестовые учётки: без важного, секреты — только из окружения
**Правило.** Учётка mock (`student@test.local`/`Test1234!`) живёт в фикстурах и секретом не является. Живые учётки для
`ChatFlowsUITests` — только через окружение раннера (`SH_UITEST_LOGIN`), не в коде и не в истории; учётку с личными
данными не использовать. Сервер троттлит — живые сценарии запускай умеренно.
**Почему.** У Telegram в тестовые аккаунты может войти любой, поэтому там не хранят ничего важного; есть флуд-лимиты, а
тесты, создавшие аккаунт, удаляют его перед повтором.
**Применимость.** частично — регистрация у нас только по инвайтам, «удалить аккаунт перед тестом» не переносится.
*Источник: `docs/ui-testing.md` («Telegram Test Servers», «Security»)*

### 10.8 Когда появится: расширения, веб-вид, биометрия, исполняемое содержимое

#### 10.8.1 Расширениям — только то, что им нужно, отдельной записью
**Правило.** Появится расширение (уведомлений, шаринга): refresh-токен и `pendingLogouts` — только основному
приложению; расширению — ровно нужное ему (например, ключ расшифровки превью пуша) отдельной записью.
**Почему.** У Telegram общая и частная группы связки ключей — разные границы: доступ к одному не означает доступ к
другому.
**Применимость.** частично — расширений сейчас нет.
*Источник: `docs/passcode.md` («The shared credential, device secret, and attempts are intentionally accessible to
extensions… These are distinct boundaries»)*

#### 10.8.2 Коммуникационные уведомления: заголовок — имя отправителя
**Правило.** Если будем делать коммуникационные уведомления (аватар отправителя через Notification Service Extension +
`INSendMessageIntent`), всё, что должен показать заголовок, клади в имя отправителя: `subtitle` система скроет.
**Почему.** С iOS 15 заголовок коммуникационного уведомления — `INPerson.displayName`, `subtitle` не показывается
(закреплено `NotificationServiceTests`).
**Применимость.** частично — расширения уведомлений в `project.yml` нет; правило на будущее.
*Источник: `docs/app-unit-tests.md` (`NotificationServiceTests`)*

#### 10.8.3 Встроенный веб-вид изолирован и закрыт по умолчанию
**Правило.** Понадобится `WKWebView` — `WKWebsiteDataStore.nonPersistent()`, никаких cookie и токенов приложения, свой
`WKUserContentController`, геолокация запрещена делегатом; сбой настройки — страницу не загружать. До тех пор внешние
ссылки — `SFSafariViewController` (`ChatInAppBrowser`), его изолирует система. Сообщения как HTML не рендерить.
**Почему.** У Telegram чужой документ получает отдельную нестойкую конфигурацию и политику во все фреймы, а при сбое
установки политики навигации нет вовсе; геолокацию ниже iOS 27 публично не отклонить.
**Применимость.** частично — `WKWebView` у нас не используется.
*Источник: `submodules/WebProxyTransport/CLAUDE.md` («The carrier's `WKWebView` is hardened on its own…», «The meta
CSP…», «Geolocation has no public refusal below iOS 27»)*

#### 10.8.4 Биометрия — чтение защищённой записи, а не булев ответ
**Правило.** Появится блокировка по Face ID — секрет за `SecAccessControl` с `.biometryCurrentSet`, доступ — через
`SecItemCopyMatching` с `LAContext`. Булев `evaluatePolicy` защиты не даёт.
**Почему.** У Telegram доступ по биометрии — настоящее чтение записи с ACL; результат `LocalAuthentication` сам по себе
ничего не открывает.
**Применимость.** частично — `LocalAuthentication` у нас не используется.
*Источник: `docs/passcode.md` («Wallet biometrics release the access key through an actual protected Keychain read…»)*

#### 10.8.5 Исполняемое содержимое по умолчанию ничего не умеет
**Правило.** Если появится размеченное или исполняемое содержимое от бота или вуза (шаблоны, формы, «виджеты»),
разрешай ему только явный белый список действий; отправка сообщений от имени человека и любые сетевые вызовы — запрещены
по умолчанию.
**Почему.** У Telegram сетевые API песочницы бросают ошибку, диалоги — no-op, буфер и «Поделиться» отказывают; даже уже
реализованный `sendMessage` от имени пользователя из SDK убрали.
**Применимость.** частично — исполняемого содержимого у нас нет.
*Источник: `docs/message-widgets-native-runtime.md` («Inert»); `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` (§4, V2)*

### 10.9 Неприменимо к нам
- Флаги защиты от записи экрана при передаче плеера из пузыря в галерею (`captureProtected` у `HLSVideoContent`) — защиты
  контента от захвата в продукте нет. *`submodules/HLSPlayback/CLAUDE.md`; `docs/native-hls-player.md`*
- Защищённый от снимка слой исключается из снимков переходов; размытая обложка спойлера защищается отдельно — скриншот-
  защиты нет. *`docs/instantpage-richtext.md` (Copy protection)*
- Криптография кошелька: иерархия ключей, конверты AES-GCM, деление фразы на доли — клиентского шифрования секретов и
  кошелька нет, пароли хешируются на сервере (`BACKEND_RULES §14`). *`docs/passcode.md` (Credential format, Wallet
  envelope encryption, backup codec)*

---
## §11. Доступность

VoiceOver, Dynamic Type и «Уменьшение движения» в iOS-клиенте. Главное: экран, размеченный для
VoiceOver, ничего не меняет для зрячих и ничего не стоит, когда VoiceOver выключен. Разметку задают
компоненты `DesignSystem`, а не отдельные экраны. Результат проверяют деревом доступности, а не на глаз.

### 11.1 Что считается готовым

#### 11.1.1 Каждый видимый смысловой элемент имеет метку, черты, значение, действие и место в порядке
**Правило.** Экран готов для VoiceOver, когда выполнено всё ниже.
- **Метка** на языке интерфейса.
- **Черты:** кнопка, заголовок, вкладка/выбрано, регулируемый, статический текст. Черта «картинка» —
  только если картинка что-то значит.
- **Значение и состояние:** выбрано, вкл/выкл, бейдж, прогресс.
- **Действия:** активация, increment/decrement, пользовательские действия вместо жестов.
- **Порядок:** сверху вниз, от начала строки к концу, навбар первым, таббар последним.
- **Ничего невидимого:** скрытое, `alpha 0`, строки за экраном сверх нужного для прокрутки, соседние
  страницы пейджера, декор, дубли.

Инструменты:
- для строки — `.accessibilityElement(children: .combine)`;
- для заголовков — `.accessibilityAddTraits(.isHeader)`;
- для декора — `.accessibilityHidden(true)`.

**Почему.** Это определение готовности из спецификации доступности Telegram, по которой размечали все
экраны.
*Источник: `docs/superpowers/specs/2026-10-27-voiceover-design.md` («Goals», п. 1–2)*

#### 11.1.2 Без изменений для зрячих и без цены при выключенном VoiceOver
**Правило.**
- Правки доступности не меняют снимки `StudentHubSnapshotTests`.
- Тяжёлые метки (например, сборку описания пузыря) вычислять лениво.
- После правок дерева ленты XCUITest-наборы и замер `perf` не должны дать регрессии
  (`Tests/perf-baseline.json`).
- Не придумывать строку, если у элемента есть свой текст.
- `bench` нарочно запускается без XCUITest: раннер XCUITest включает доступность и искажает замер.

**Почему.** Антицели Telegram: никаких визуальных и поведенческих изменений, нет измеримой цены без
клиента доступности, XCUITest не ломать и не замедлять (он читает то же дерево).
*Источник: `docs/superpowers/specs/2026-10-27-voiceover-design.md` («Anti-goals»)*

#### 11.1.3 Доступность размечается в компонентах дизайн-системы
**Правило.** Метку, черты и значение задаёт компонент `DesignSystem` (`Toolkit`, `Rows.swift`, кнопки,
стекло, сегменты), а вызывающему достаточно передать строку. Кнопка с текстом берёт метку из заголовка.
Кнопка-значок получает метку обязательным параметром: без неё код не компилируется или падает тест.
Строка списка — один элемент. Если ошибка повторяется на разных экранах, чинить компонент, а не каждый
экран.
**Почему.** По конвенции Telegram (ComponentFlow) компонент, размеченный один раз, верен на всех экранах.
*Источник: `docs/superpowers/specs/2026-10-27-voiceover-design.md` («Infrastructure decisions», п. 2); `docs/superpowers/plans/2026-10-27-voiceover.md` (Tasks 5–8)*

#### 11.1.4 Метка — ровно видимый текст и его ключ; новый ключ — только для элемента без текста
**Правило.** Если у элемента есть видимый текст, метка равна ему и берётся по тому же ключу
`Localizable.xcstrings`. Новый ключ заводить только для значков, бейджей и картинок, в своей области и в
нашем стиле (как `chats.voice.play`). Литералы строк в `accessibilityLabel` запрещены: это запрет
хардкода из корневого `AGENTS.md`. Новые ключи переводятся на kk, и Android их сверяет на CI.
**Почему.** У Telegram новый ключ `VoiceOver.<Area>.<Name>` разрешён только для элементов без текста, а
захардкоженный английский («Selected») заменили ключом.
*Источник: `docs/superpowers/specs/2026-10-27-voiceover-design.md` («Strings»); `docs/superpowers/plans/2026-10-27-voiceover.md` (Global Constraints)*

### 11.2 Разметка элементов

#### 11.2.1 Вкладки и сегменты: кнопка-вкладка, черта «выбрано», бейдж как значение
**Правило.** Каждая вкладка — кнопка с названием, у текущей черта `.selected`. Бейдж читается значением
(«1 непрочитанное»), а не отдельным «1». Панель вкладок читается один раз. Системный `TabView` даёт это
сам. Свои полоски вкладок (папки чатов `ChatFoldersModel`/`ChatFoldersView`, сегменты) размечать вручную.
**Почему.** Так у Telegram размечены таббар и папки списка чатов. «!» у них — состояние «требует
внимания», а не текст.
**Сейчас у нас.** Оболочка на системном `TabView` с `Tab(…)` (`App/AppShellView.swift:110`). Полоску
папок чатов проверить.
*Источник: `docs/superpowers/specs/2026-10-27-voiceover-design.md` («Tab bar»); `docs/accessibility/voiceover-inventory.md` (`tab-bar`, `chatlist-folders`); `docs/superpowers/plans/2026-10-27-voiceover.md` (Tasks 7–8)*

#### 11.2.2 Выбранное состояние — чертой или значением, а не только галочкой
**Правило.** В режиме выбора сообщений (кружки слева, `SlideSelection`), при выборе получателей и в
радио-строках настроек «выбрано» передавать через `.accessibilityAddTraits(.isSelected)` или значение, а не
только картинкой-галочкой.
**Почему.** Так Telegram размечает режимы выбора и правки.
**Сейчас у нас.** `.isSelected` встречается часто (87 мест), например `ChatFoldersView.swift:594`.
*Источник: `docs/superpowers/plans/2026-10-27-voiceover.md` (Review Focus 5); `docs/accessibility/voiceover-inventory.md` (`contacts-selection`, `new-group`, `settings-privacy-rule`)*

#### 11.2.3 Переключатель и ползунок — один элемент со значением словами
**Правило.** Строка с `Toggle` — один элемент «Название = Вкл/Выкл», без отдельного безымянного
переключателя. Свой ползунок — регулируемый элемент: `.accessibilityValue` словами экрана и
`.accessibilityAdjustableAction`. Подписи делений отдельно не читаются.
**Почему.** Так Telegram размечает настройки и ползунки («Когда ниже 15 %»).
**Сейчас у нас.** Соблюдено для голосовых: скорость и позиция (`chats.voice.speed`,
`chats.voice.position`), `accessibilityAdjustableAction` в `Thread/VoicePlayback.swift:128,272` и
`Voice/VoiceRecordingViews.swift:471`.
*Источник: `docs/accessibility/voiceover-inventory.md` (`settings-recent-calls`, `settings-power-saving`, `settings-auto-download`, `profile-permissions`, `profile-invite-links`)*

#### 11.2.4 Декор и превью скрывать, заголовки размечать
**Правило.** Иллюстрации и анимации пустых состояний, превью темы или пузыря и фоновые градиенты (в том
числе `ChatWallpaper`) ставить с `.accessibilityHidden(true)`. Крупные заголовки и заголовки, которые
нарисовал сам экран, а не навбар (экраны входа в `AuthDesign.swift`), размечать `.isHeader`.
**Почему.** У Telegram иллюстрации, 3D-звезда и превью чата в настройках скрыты, а заголовки, нарисованные
экраном, размечены отдельно.
**Сейчас у нас.** На экранах входа соблюдено: `Features/Auth/AuthDesign.swift:237,419`.
*Источник: `docs/accessibility/voiceover-inventory.md` (`settings-appearance`, `settings-text-size`, `premium`, `phone-entry`, `code-entry`, screen-drawn titles)*

#### 11.2.5 Поле ввода подписано меткой, а не только плейсхолдером
**Правило.**
- Поля входа (`auth.identifier`, пароль), поиск и формы получают метку из видимой подписи.
- Поле кода 2FA поверх ячеек — один элемент со значением введённых цифр, а сами ячейки скрыты.
- Кнопка показа пароля — с меткой (`auth.showPassword`) и состоянием.
- Кнопка очистки называется «Очистить» и видна, только пока есть текст.

**Почему.** У Telegram подсказка поля стала меткой. Поле кода — настоящее поле 1 pt с alpha 0,01; поверх
ячеек VoiceOver видит одно поле «Код» со значением.
**Сейчас у нас.** Ячейки кода скрыты (`Features/Auth/OneTimeCodeField.swift:35`). Метка кнопки пароля —
`AuthDesign.swift:514`.
*Источник: `docs/accessibility/voiceover-inventory.md` (`contacts-add`, `settings-edit-profile`, `phone-entry`, `code-entry`, `two-factor`)*

#### 11.2.6 Доступность поля — на том виде, который фокусирует VoiceOver
**Правило.** Метку поля чата («Сообщение») держать на самом `UITextView`, а надпись-оверлей скрывать от
VoiceOver. Значение поля не подменять: это сломает правку. VoiceOver читает markdown-маркеры буквально
(«звёздочка звёздочка»); это принятое ограничение не-WYSIWYG поля.
**Почему.** У Telegram подсказку и метку пересылают на вид, который реально получает фокус, а значение
читает содержимое по-человечески (эмодзи — текстом).
**Сейчас у нас.** Соблюдено: оверлей подсказки скрыт (`Composer/ComposerEditorView.swift:61`).
**Применимость.** Частично: своего движка текста, который отдал бы «человеческое» значение, у нас нет.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` («Accessibility»)*

#### 11.2.7 График — описанием или явным пробелом
**Правило.** Графикам в дашбордах (Swift Charts в `Admin/AdminDashboardViews.swift`,
`UniversityAdmin/UAdminDashboardView.swift`, `Dean/DeanDashboardView.swift`,
`Career/CareerStaffViews.swift`) давать `accessibilityChartDescriptor` или текстовую сводку рядом. Если
не сделано — записать пробел в инвентарь (11.5.5) с причиной.
**Почему.** У Telegram графики статистики не читаются, и это записано как открытый пробел.
**Сейчас у нас.** `accessibilityChartDescriptor` не используется нигде. Swift Charts даёт только базовое
описание — проверить на iPhone.
**Применимость.** Частично.
*Источник: `docs/accessibility/voiceover-inventory.md` («Open gaps»: Charts, `stars-stats`)*

### 11.3 Жесты, модальность, объявления, авто-движение

#### 11.3.1 Каждый жест продублирован пользовательским действием
**Правило.** Меню сообщения по долгому нажатию, свайп ответа (`SwipeToReply`), свайпы в списке чатов и
выделение скольжением (`SlideSelection`) доступны и через `.accessibilityAction(named:)`, тем же кодом, что
и жест. Если эквивалента нет, записать пробел с причиной.
**Почему.** У Telegram меню по долгому нажатию — действие «Ещё», свайп-удаление — действие «Удалить».
Перетаскивание без эквивалента записано как обоснованный пробел.
**Сейчас у нас.** У пузыря есть действие «Действия» (`chats.menu.actions`, `MessageBubbleView.swift:161`):
оно открывает меню, и «Ответить» доступно через него. Системные `.swipeActions` дают действия сами.
*Источник: `docs/superpowers/specs/2026-10-27-voiceover-design.md` («Goals», custom actions); `docs/accessibility/voiceover-inventory.md` (строки чатов «More», `calls`, `settings-devices`, `chatlist-edit`)*

#### 11.3.2 Модальное: читается только верхнее, «escape» действует как тап мимо
**Правило.** Свои оверлеи и листы помечать `.accessibilityAddTraits(.isModal)` /
`accessibilityViewIsModal` и вешать на них `.accessibilityAction(.escape)` тем же путём, что тап по
подложке. Если тап мимо ничего не закрывает, escape поглощается. Системные `.sheet` и `.fullScreenCover`
дают это сами.
**Почему.** У Telegram под листом или алертом экран не читается. Жест «escape» (двумя пальцами «Z»)
закрывает так же, как тап снаружи, и поглощается во время закрытия.
**Сейчас у нас.** Соблюдено: `MessageMenuOverlay` показан через `.fullScreenCover`
(`ChatThreadView.swift:766`) и закрывается по escape (`Menu/MessageMenuOverlay.swift:177`).
*Источник: `docs/accessibility/voiceover-inventory.md` (`contacts-add`, `phone-confirm`, `terms`, `settings-help`)*

#### 11.3.3 Кратковременное объявлять голосом
**Правило.** Тосты и баннеры, «скопировано», ошибку входа (`auth.error.*`) и ошибку, которую показывают
только тряской поля, объявлять через `UIAccessibility.post(notification: .announcement, …)` или
`AccessibilityNotification.Announcement`.
**Почему.** У Telegram «Загрузка…», «Готово», текст тоста и неверный код объявляются голосом: тряску
незрячий не видит.
**Сейчас у нас.** Тосты объявляются (`DesignSystem/ActionToast.swift:40`, `ChatThreadView.swift:243`).
Ошибки на экранах входа — проверить.
*Источник: `docs/accessibility/voiceover-inventory.md` (`overlay-status-hud`, `passcode-lock`, `code-entry`)*

#### 11.3.4 Под VoiceOver автоматически переключаемое содержимое стоит на месте
**Правило.** Просмотр историй (`Features/Feed/StoriesViews.swift`) при включённом VoiceOver не переключать
по таймеру. Страница — регулируемый элемент «История N из M», а «Следующий/Предыдущий автор» — действия,
которые есть, только когда переход возможен.
**Почему.** У Telegram история под VoiceOver в конце не уходит сама. Навигация — свайпом вверх и вниз по
регулируемому элементу.
**Сейчас у нас.** соблюдено (#499): под VoiceOver таймер историй стоит; страница — регулируемый элемент «История N из
M», переход к автору — действия.
*Источник: `docs/accessibility/voiceover-inventory.md` (`story-viewer`)*

#### 11.3.5 В пейджерах и списках читается только текущее
**Правило.** Невидимые страницы `TabView(.page)` и своих пейджеров (просмотр медиа, истории, карусели)
скрывать через `.accessibilityHidden`, в том числе посреди свайпа. Для ленты `UICollectionView` проверять,
что свайп VoiceOver за последнюю видимую строку прокручивает её.
**Почему.** У Telegram соседние страницы скрыты, а список отдаёт видимые строки плюс одну загруженную за
каждым краем. VoiceOver доходит до следующих, прокручивая.
*Источник: `docs/superpowers/specs/2026-10-27-voiceover-design.md` («Goals», п. 2); `docs/superpowers/plans/2026-10-27-voiceover.md` (Review Focus 1–2); `docs/accessibility/voiceover-inventory.md` (`premium-features`, `profile-shared-media`)*

### 11.4 Движение, размер текста, тема

#### 11.4.1 «Уменьшение движения» читается из одного источника и доходит до каждой анимации
**Правило.** В SwiftUI читать `\.motionReduced`: его раздаёт `motionPolicy()` из
`DesignSystem/Motion.swift`, следя за системной настройкой. В UIKit читать `Motion.isReducedNow`. Не
читать `accessibilityReduceMotion` и `UIAccessibility.isReduceMotionEnabled` напрямую: тогда не работает
тестовая подмена `SH_UITEST_REDUCE_MOTION`. Анимации пузыря, ленты и карточек (полоски голосов, отметка
пункта) учитывают настройку с первого кадра и реагируют на её смену без перезапуска.
**Почему.** У Telegram «Уменьшение движения» системное: его читают при создании и по уведомлению, и
учитывают до первой раскладки. У виджетов `prefers-reduced-motion` и `prefers-color-scheme` отвечают из
одного источника.
**Сейчас у нас.** Источник один (`Motion.swift:109`, `:128-143`). В одной из записей упомянуты токены
`--motion-*`/`MOTION` — это веб-клиент, к iOS они не относятся.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Reduce Motion is the system's»); `docs/message-widgets-native-runtime.md` («matchMedia»)*

#### 11.4.2 Смена размера текста — это перекладка, а не игнор
**Правило.** Текст пузырей и карточек задавать через `Typography` (Dynamic Type). При смене размера шрифта
высота пересчитывается, а категория размера входит в ключ кеша высот. Фиксированные размеры (карта
240×140) допустимы только для картинок.
**Почему.** Telegram сначала игнорировал размер текста в виджетах, потом решил, что он часть темы, и
смена размера стала перекладывать виджет.
**Сейчас у нас.** Соблюдено: `preferredContentSizeCategory` входит в ключ кеша высот
(`MessageListView.swift:618`), а метрики оценки строятся из `UIFont.preferredFont` (`:706`).
*Источник: `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` §8; `docs/superpowers/specs/2026-10-13-message-widgets-design.md` («Defaults»)*

#### 11.4.3 Цвета карточки берутся из палитры своего пузыря
**Правило.** Карточки в пузыре берут цвета из `Palette` по `isOwn` (как `ChatPollView` и
`LocationMessageView`: `Palette.primaryForeground` у своих, `Palette.foreground` у чужих). Литералов цвета
в карточке нет. Смена светлой или тёмной темы перекрашивает без перезагрузки данных. См. также 5.7.9.
**Почему.** У Telegram тема виджета — цвета пузыря, в котором он стоит, а смена схемы — одна смена темы
целиком.
**Сейчас у нас.** Соблюдено: `ChatPollView.swift:79,92`.
*Источник: `docs/message-widgets-native-runtime.md` («Theme», `messageWidgetTheme`)*

#### 11.4.4 Дерево доступности не зависит от темы
**Правило.** В тёмной теме дерево доступности (метки и порядок) совпадает со светлой. Проверять сравнением
дампов (11.5.2).
**Почему.** У Telegram метки и порядок не зависят от темы, а в RTL порядок следует экрану.
**Применимость.** Частично: RTL-языков у нас нет (ru, kk, en), поэтому часть про RTL не переносится.
*Источник: `docs/superpowers/plans/2026-10-27-voiceover.md` (Review Focus 4); `docs/accessibility/voiceover-inventory.md` (`chatlist-dark`, `chatlist-rtl-he`)*

### 11.5 Проверка

#### 11.5.1 Раскладку «как при VoiceOver» проверять отладочной подменой
**Правило.** Все ветвления по VoiceOver читать из одной точки, а не из разбросанных
`UIAccessibility.isVoiceOverRunning`. Для UI-тестов завести подмену по образцу `SH_UITEST_REDUCE_MOTION`
(например, `SH_UITEST_VOICEOVER=1`), только в DEBUG, и проверить, что в release её строки нет. На iPhone
владелец может включить настоящий VoiceOver.
**Почему.** Симулятор не запускает VoiceOver, а часть экранов раскладывается под ним иначе (у Telegram
около 90 файлов ветвятся на `inVoiceOver`). Отладочный флаг Telegram ведёт себя «как при VoiceOver»,
включая прямые проверки, и шлёт те же уведомления. В Release строки флага нет (проверено `strings`/`nm`).
**Сейчас у нас.** Ветвление есть в одном месте: `MessageListView.swift:1171` (под VoiceOver нет плавающей
даты). Подмены нет.
**Применимость.** Частично: это предложение.
*Источник: `docs/accessibility/voiceover-inventory.md` («How to check a screen», `--force-voiceover-layout`); `docs/superpowers/specs/2026-10-27-voiceover-design.md` («Verification»); `docs/superpowers/plans/2026-10-27-voiceover.md` (Task 2)*

#### 11.5.2 Сравнивать экран с деревом доступности, с автоматическими флагами
**Правило.** На CI в UI-тестах на ключевых экранах mock-сценария вызывать
`XCUIApplication().performAccessibilityAudit()` (XCTest, iOS 17+). Рядом со скриншотом прикладывать
`app.debugDescription` (`attachScreenshot` уже делается в `tearDown`, `MockUITestCase.swift`). Проверять
классы ошибок:
- интерактивный элемент без метки;
- элемент вне экрана;
- элемент нулевого размера;
- дубль;
- «голая» картинка;
- голый текст внутри контрола.

Флаги — только подсказки: отсутствующий элемент видно лишь по снимку.
**Почему.** Telegram снимает экран и дамп дерева, а скрипт плоско печатает элементы с флагами механических
проблем. Две записи сравнивают `diff` строк элементов.
**Сейчас у нас.** `performAccessibilityAudit` не используется.
**Применимость.** Частично: инструментов Telegram (AXe) у нас нет, но есть на что опереться.
*Источник: `docs/accessibility/voiceover-inventory.md` («Capture», «Reading the result»); `docs/superpowers/plans/2026-10-27-voiceover.md` (Task 1)*

#### 11.5.3 Перед изменением общей инфраструктуры — базовая запись, после — сравнение
**Правило.** Меняя доступность в `MessageListView` или пузырях:
1. До правки снять дерево (`debugDescription` в UI-тесте) на 3–5 типах сообщений: текст, медиа,
   голосовое, служебное, с реакциями.
2. До правки сделать замер `perf`/`scroll`.
3. После правки повторить оба шага.

Регрессию (потерян элемент или метка, порядок стал хуже, появились дубли) лечить отключением нового
поведения для наименьшего поддерева. Сравнение записывать.
**Почему.** Telegram перед сменой сборщика элементов снимал дампы пяти представительных чатов. Порог —
дамп не медленнее чем на 20 %.
*Источник: `docs/superpowers/specs/2026-10-27-voiceover-design.md` («The chat screen must not get worse»); `docs/superpowers/plans/2026-10-27-voiceover.md` (Task 3 Step 1, Task 4); `docs/accessibility/voiceover-inventory.md` («Chat non-regression»)*

#### 11.5.4 Обход экранов — по диплинкам, тапы по одному со свежим снимком
**Правило.** В UI-тестах переходить к экрану диплинком, где он есть (`Core/Navigation/DeepLink.swift`,
схема `studenthub`). Иначе — тапом с ожиданием элемента, перед каждым тапом свежий снимок. Для автотестов
диплинк передавать через `launchEnvironment` или аргумент запуска: `simctl openurl` упирается в системный
вопрос «Открыть в…» (`scripts/test.sh:239`).
**Почему.** У Telegram тап AXe не доставляет касаний, поэтому до экранов идут ссылками `tg://…`, а тапы
делают по одному.
**Применимость.** Частично.
*Источник: `docs/accessibility/voiceover-inventory.md` («Reading the result»); `docs/iphone-duo-layout.md` («Reach screens with deep links, not taps»)*

#### 11.5.5 Инвентарь экранов со статусами
**Правило.** При проходе по доступности iOS вести инвентарь. Для каждого экрана:
- путь: диплинк `studenthub://…` или вкладка;
- статус: `clean` / `partly` / `justified: <причина>` / `open gap`;
- изменённые файлы.

Экраны, связанные с чатом, — отдельной секцией, внизу — сводка открытых пробелов. Место в `docs/`
согласовать с владельцем: `docs/*` правятся только по просьбе.
**Почему.** Telegram так ведёт `docs/accessibility/voiceover-inventory.md`: по нему видно, что пройдено, а
что осталось.
*Источник: `docs/superpowers/specs/2026-10-27-voiceover-design.md` («Verification»); `docs/superpowers/plans/2026-10-27-voiceover.md` («Screen sweep procedure», п. 5); `docs/accessibility/voiceover-inventory.md`*

### 11.6 Неприменимо к нам
- Целиком неприменимых записей нет. Не переносится только RTL-часть правила 11.4.4 (порядок чтения
  в RTL): у нас нет RTL-языков.

---
## §12. Раскладка под устройства и безопасные зоны

Отступы, системные зоны, узкие экраны и пиксельная точность. Клиент у нас только для iPhone и только
портретный (`TARGETED_DEVICE_FAMILY: "1"`, `UISupportedInterfaceOrientations` в `project.yml`). Поэтому
главная опасность — ошибки, которые на нашем устройстве невидимы и копятся молча. Размеры берутся из
раскладки, отступы пишутся честно по сторонам, а исправление частного случая не меняет остальные.

### 12.1 Системные зоны и отступы

#### 12.1.1 Размеры системных зон не хардкодить — читать из раскладки
**Правило.** Отступы брать только из `safeAreaInsets`, `GeometryReader`/`onGeometryChange` и
`safeAreaInset`. Никаких констант «47», «59», «34» под остров или полоску «Домой». `UIScreen.main` для
раскладки не использовать: он устарел с iOS 16, и на многоэкранных конфигурациях это не тот экран. В новых
местах брать `window?.windowScene?.screen` или `traitCollection.displayScale`.
**Почему.** Telegram никогда не хардкодит размер острова или угла, а читает его из
`reservedCorners`/`safeInsets`. Цифры в их таблицах сняты с симулятора и нужны только для понимания.
**Сейчас у нас.** Расходится, `UIScreen.main` используется в трёх местах:
- `Thread/Menu/KeyboardFrame.swift:27` — высота экрана для рамки клавиатуры;
- `Feed/StoriesViews.swift:321` — ширина для выбора размера медиа;
- `Thread/Attach/PhotoAssets.swift:187` — масштаб.

**Применимость.** Частично: iPhone Duo и iPad у нас нет, но правило защищает от тех же ошибок на iPhone.
*Источник: `CLAUDE.md` («iPhone Duo layout (reserved corners)»); `docs/iphone-duo-layout.md` («The device»)*

#### 12.1.2 Ошибки в отступах, невидимые при равных отступах
**Правило.** Отступы в новой раскладке задавать отдельно по сторонам (`leading` и `trailing`), а не
«левый с обеих сторон». Центрировать в той же области, по которой считали ширину. Правый контрол
отсчитывать от правого края. Использовать одну высоту статус-бара на экран. Не путать размерный класс
(`horizontalSizeClass == .regular`) с типом устройства, а «альбомную» — со «слишком низкой». Не подбирать
константу подъёма под кнопку «Домой». Посчитанное значение должно где-то применяться.
**Почему.** Аудит Telegram нашёл 13 классов таких ошибок:
- симметричный отступ `X + left`;
- ширина по полосе, а центр по экрану;
- правый контрол от левого отступа;
- две высоты статус-бара вперемешку;
- `UIScreen.main` для раскладки;
- `.regular` как «iPad»;
- превью 9:16 выше экрана;
- элемент за краем, видимый в полосе;
- верное значение, которое нигде не применяется;
- и другие.

Все они невидимы, пока левый и правый отступы равны.
**Применимость.** Частично: в портрете iPhone боковые отступы нулевые, поэтому у нас эти ошибки невидимы
и копятся молча. Правило про то, как писать, а не про то, что сломано.
*Источник: `docs/iphone-duo-layout.md` («Bug shapes»); `docs/superpowers/duo-screen-audit-2026-10.md` («Bug classes» B1–B13)*

#### 12.1.3 Исправление частного случая даёт прежний результат во всех остальных
**Правило.** Правку под частный случай (iOS 26 против 17, Liquid Glass или без него, крупный шрифт,
«Уменьшение движения», флаг из `App/PerformanceFlags.swift`) писать так, чтобы в остальных условиях
результат был ровно прежним. Проверять снимками (`StudentHubSnapshotTests`: темы, устройства `se`,
`regular`, `max`, крупный шрифт) и сравнением «с флагом и без».
**Почему.** Любое исправление Telegram под Duo при равных отступах и без углов обязано давать прежнее
выражение, чтобы другие устройства остались байт-в-байт. Поэтому и каждая такая ошибка на них невидима.
*Источник: `CLAUDE.md` («iPhone Duo layout», третий пункт); `docs/iphone-duo-layout.md` (последний абзац «Bug shapes»); `docs/superpowers/duo-screen-audit-2026-10.md` («Method»)*

### 12.2 Маленькие экраны и листы

#### 12.2.1 Лист выше экрана открывается шапкой вверх и не прыгает от клавиатуры
**Правило.** Длинные листы (`AttachmentSendSheet`, создание опроса в `ChatPollCreatorView.swift`, формы
заявок) проверять на маленьком iPhone (`se`, 375×667) и с крупным шрифтом:
- при открытии видна шапка;
- показ и скрытие клавиатуры не перебрасывают прокрутку;
- с поднятой клавиатурой лист стоит низом, а после её скрытия остаётся, где был.

**Почему.** У Telegram такой лист после поворота, смены содержимого или клавиатуры прыгал к низу, и шапка
уходила за экран (#79).
**Применимость.** Частично: поворотов у нас нет, остаются клавиатура и смена содержимого.
*Источник: `docs/iphone-duo-layout.md` («Layout API», `sheetRestingScrollOffset`)*

#### 12.2.2 Кнопки на плитках не налезают на соседние; проверять на самой узкой ширине
**Правило.** Элементы поверх плиток (бейдж длительности, «…», отметка выбора в листе вложений)
раскладывать чистой функцией с тестом. Проверять на самой узкой поддерживаемой ширине (375 pt) и на
типичных альбомах.
**Почему.** У Telegram геометрия кнопок — чистая функция с тестами на реальных раскладках альбомов. На
320 pt доля перекрытий сведена с 7,5 % до 0,2 %.
**Применимость.** Частично.
*Источник: `submodules/TelegramUI/Components/RichTextEditorMediaView/CLAUDE.md` («Button layout (`MediaChromeLayout`)»)*

### 12.3 Пиксельная точность

#### 12.3.1 Раскладку медиа вести в целых пикселях, пропорции зажимать
**Правило.** Сетки `LazyVGrid`/`HStack` (`RecentMediaGrid`, `ChatContentList.mediaGrid`) считает
система. В своей раскладке (кеш высот `MessageStackLayout`, альбомы в пузыре) копить позиции в целых
пикселях (`(points * scale).rounded() / scale`), а не суммой дробных точек. Ширины колонок различаются
максимум на пиксель, ряд заполняет ширину точно. Крайние пропорции снимков зажимать, как `tileContentMode`
для вытянутых снимков.
**Почему.** У Telegram высоты рядов округляются вниз до целых пикселей, смещения копятся в целых пикселях,
и в глубине сетки нет дрожи. Пропорция снимка зажата в 0,5…2.
**Применимость.** Частично: своей сеточной раскладки у нас нет.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Level 1», «Uniform levels»)*

#### 12.3.2 Дробная высота оставляет шов фона
**Правило.** Если карточка с фоном вложена в пузырь другого цвета, округлять стыки согласованно: фон от
`floor`, размер `ceil`. Либо выравнивать по пикселям через `displayScale`. Проверять на @3x.
**Почему.** У Telegram фон под документом, который начинали с высоты, округлённой вверх, оставлял полосу
цвета пузыря. Это закреплено тестом `testTheCanvasHasNoSeamUnderAFractionalDocument`.
*Источник: `docs/message-widgets-native-runtime.md` («The tree carries the canvas colour»)*

### 12.4 Карточки внутри пузыря

#### 12.4.1 Ширину карточки задаёт контейнер, а не естественная ширина содержимого
**Правило.** Ширину карточки задаёт пузырь или лента: фиксированные 240 у карты и профиля или `maxWidth`
пузыря. Не `fixedSize` по содержимому.
**Почему.** Иначе короткий вопрос опроса даст узкую карточку, а длинный вылезет за пузырь. У Telegram
ширина снимка виджета — ширина раскладки, а не `contentSize.width`, которая сжимала каждый виджет.
*Источник: `docs/message-widgets-native-runtime.md` («The size is the layout width»)*

#### 12.4.2 Высота карточки ограничена, лишнее сворачивается
**Правило.** У карточек с растущим списком (чек-лист, варианты опроса, пересланный пост) задать предел
видимых строк и «Показать всё» или переход на отдельный экран. Пузырь не должен вырастать на несколько
экранов из-за чужого содержимого.
**Почему.** У Telegram высота виджета зажата в 50…600 pt (в спецификации 24…900), а сверх неё работает
жёсткая обрезка по высоте пузыря.
**Сейчас у нас.** соблюдено (#499): в пузыре видно первые 10 пунктов чек-листа и «Показать все (N)» / «Свернуть».
*Источник: `docs/message-widgets-native-runtime.md` («The size is the layout width»); `docs/superpowers/specs/2026-10-13-message-widgets-design.md` §3*

#### 12.4.3 Краевая карточка обрезается формой пузыря, без своих отступов и своего скругления
**Правило.** Карточки «от края до края» (карта, медиа поста) не получают своих отступов и обрезаются формой
самого пузыря (`ChatBubbleShape`), а не отдельным скруглением. Тогда у хвоста не будет двойного края. См.
также 5.6.12.
**Почему.** У Telegram краевой виджет без отступов, обрезан по радиусам пузыря и квадратный у хвоста, а
хвост продолжает цвет угла.
**Сейчас у нас.** Хвост у пузыря есть: `ChatBubbleShape` (`MessageBubbleView.swift:712`) рисует хвостик
у последнего сообщения группы и малые углы внутри группы. Отметка в одной из записей «хвостов у нас может
не быть» неверна.
*Источник: `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` §8*

#### 12.4.4 Время поверх карточки занимает свой угол
**Правило.** Если время или статус рисуются поверх карточки (медиа, карта), интерактивные элементы карточки
в этот угол не ставить. Касание по плашке времени не должно нажимать карточку. Зону касания брать с
запасом около 8 pt: нажатие сжимает пузырь и смещает точку. См. также 5.2.9.
**Почему.** Виджету Telegram сообщают полосу и угол, которые заняты временем. Касания в этом углу
принадлежат пузырю.
**Применимость.** Частично.
*Источник: `docs/message-widgets-native-runtime.md` («The content safe area (v0.4.0)»; Divergences v0.4.0, п. 12)*

### 12.5 Неприменимо к нам
- **Ориентация и боковые вырезы в сетке медиа.** У Telegram уровень сетки не выводится из размеров,
  решение `isLandscape` принимает хозяин, а боковые отступы применяются раздельно (iPhone Duo #83). У нас
  только портретный iPhone. Принцип раздельных отступов перенесён в 12.1.2.
  *`submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («Rotation and width changes»)*
- **Разрыв фона пузыря под плашкой, сквозь который видны обои.** Обои у нас есть (`ChatWallpaper`), но
  разрывов пузыря и порталов обоев нет. *`docs/instantpage-richtext.md` (Tearing the bubble across a pill)*
- **Указатели iPad и мультитач до пяти пальцев.** У нас только iPhone и нет интерактивного содержимого для
  нескольких пальцев. *`submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («iPad pointers», «Several fingers»)*

---
## §13. Производительность

Раздел про то, что можно и чего нельзя на главном потоке, как держать кадры, фоновые задачи и кеши в узде и как мерить, чтобы цифрам можно было верить. Главная мысль: главный поток делает только то, что нужно для ближайшего кадра; невидимое не работает; рискованное живёт под флагом `PerformanceFlags`, а любое ускорение подтверждается замером на iPhone в записанных условиях. Пути источников даны относительно `telegram-ios-rules/`.

### 13.1 Главный поток

#### 13.1.1 Главный поток: без диска, декодирования и кодирования; поиск в кеше — O(1)
**Правило.** На главном потоке — только поиск в памяти за O(1) (`ImageMemoryCache.image(for:)`). `ImageDiskCache`, декодирование и `Data(contentsOf:)` — в фоне. Не вызывайте `UIImage(contentsOfFile:)`, `UIImage(data:)` для крупных картинок и `FileManager` в `body` и при конфигурации ячейки.
**Почему.** У Telegram поиск миниатюры на главном — O(1) в памяти и никогда не трогает диск.
*Источник: `docs/superpowers/plans/2026-10-27-media-grid-thumbnail-store.md` (Global Constraints); `docs/superpowers/specs/2026-10-27-media-picker-grid-design.md` («Looking up a thumbnail is O(1) on main and never touches the disk»)*

#### 13.1.2 В проходе раскладки — только то, что нужно для размера
**Правило.** В `configure` ячейки и в `body` карточки не декодируйте картинки, не снимайте карты синхронно, не разбирайте длинный текст без кеша. `RichText.attributed` при промахе кеша разбирает синхронно — это допустимо только для коротких текстов; длинные готовьте заранее через `RichText.prepare`. Ячейка никогда не ждёт фон. Отложенная работа ключуется по id и заменяет устаревшую; повторные запросы того же ключа (предзагрузка) заменяйте или отменяйте, а не копите.
**Почему.** У Telegram JS и раскладка виджетов сначала шли синхронно на главном. После переноса в пул из двух потоков главный ждёт только размер, не больше 20 мс за оборот, а тайлы рисуются задачей, которую никто не ждёт. Ожидание главного упало в 2–3 раза (5,8/20,2/49,5 мс → 2,6/8,9/17,0 мс). Задачи с ключом заменяют ещё не начатые.
**Сейчас у нас.** Снимок карты уже асинхронный (`MKMapSnapshotter` в `MessageKindViews.swift:142`).
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` (Off main, on a pool of two threads); `docs/superpowers/specs/2026-10-13-message-widgets-design.md` (§2); `docs/message-widgets-native-runtime.md` (The app's half (M1d); Only the size is critical; Measured… After M1d)*

#### 13.1.3 Синхронная выдача картинок — свойство прохода, а не ячейки
**Правило.** При въезде ячейки допустима только синхронная выдача уже декодированного из `Core/Images/ImageMemoryCache`. Чтение с диска и декодирование — вне главного потока. Синхронно, чтобы не мигнуло, — только первая расстановка ленты (`positionInitiallyIfPossible`) и своя отправка. Не делайте «синхронно всегда» ради красоты одного сценария.
**Почему.** У Telegram синхронная загрузка нужна только первому кадру открытого без анимации чата и анимации отправки. В прототипе она была включена всегда, и каждая въезжающая картинка и аватар декодировались на главном посреди взмаха.
*Источник: `docs/chat/corelist-chat-history-backend.md` (`synchronousLoads` is a property of the pass)*

#### 13.1.4 Крупную картинку готовить к показу вне главного потока
**Правило.** Всё, что отдаётся в `Image(uiImage:)` крупнее примерно 512×512, предварительно прогоняйте через `byPreparingForDisplay()`/`preparingForDisplay()` вне главного. Это касается картинок из PhotoKit (`AssetTile`), кадров видео (`ChatVideoFrames`, `ChatMediaThumbnails.firstFrame` на `AVAssetImageGenerator`) и всего нового.
**Почему.** У Telegram картинки от 512×512 перерисовываются вне главного до выдачи, иначе первая отрисовка стоила около 7 мс на каждую.
**Сейчас у нас.** соблюдено (#499): кадры видео и точные миниатюры PhotoKit готовятся к показу вне главного.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («redraws images of 512×512 px or more off the main thread … ~7 ms each on main»)*

#### 13.1.5 Ничего пропорционального медиатеке — на главном потоке
**Правило.** Всё, что растёт с размером медиатеки (счёт альбомов, выборка ассетов, разбор изменений), выполняйте в `Task.detached` или на фоновой очереди. На главный — только готовый результат.
**Почему.** У Telegram чтение пропорций, префиксные суммы и разбор изменений идут вне главного; на главном — O(1).
**Сейчас у нас.** соблюдено (#499): альбомы и выборка снимков считаются вне главного потока.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` (Level 1); `docs/superpowers/specs/2026-10-27-media-picker-grid-design.md` (Success measures)*

#### 13.1.6 Работа «после первого кадра»: `DispatchQueue.main.async` не выносит её из коммита
**Правило.** Если откладываете тяжёлое (загрузки, декодирование, построение невидимых строк) на «после первого кадра» открытия чата, листа или просмотра, `DispatchQueue.main.async` и `Task { @MainActor }` не помогут — работа попадёт в тот же коммит. Используйте одноразовый `CFRunLoopObserver` на `.afterWaiting` (с `CFRunLoopWakeUp`) или следующий тик `CADisplayLink`. Проверяйте по signpost, что первый оборот стал короче.
**Почему.** У Telegram `main.async` выполнялся до `beforeWaiting` того же оборота. С наблюдателем `afterWaiting` первый оборот поворота сократился с 18–22 до 9–15 мс.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` (Rotation and width changes)*

#### 13.1.7 Не перестраивать большие списки во время анимации показа
**Правило.** Открытие листа, чата или просмотра показывает первый кадр с тем, что уже есть. Полный список подставляйте без дифф-пересборки посреди анимации — после её окончания или готовым из фона.
**Почему.** У Telegram открытие пикера строило 13 элементов, через 0,5 с — массив всех N и дифф 13 → N во время анимации листа, да ещё с выборкой на главном.
*Источник: `docs/superpowers/specs/2026-10-27-media-picker-grid-design.md` (Opening)*

#### 13.1.8 Разбор ответов сети — вне общего актора
**Правило.** В акторе `APIClient` оставьте только отправку и учёт токена. Разбор JSON выносите в `nonisolated` функцию над `Data`.
**Почему.** У Telegram на последовательной очереди сетевого движка — только короткая запись под блокировкой, подсчёт — пачками на служебной очереди. Лишняя работа на этой очереди стоила −33 %, −13 % и −10 % в разных замерах.
**Сейчас у нас.** соблюдено (#499): `send(_:as:)` и `page(_:of:)` разбирают JSON вне актора `APIClient` (`nonisolated`).
*Источник: `submodules/TelegramCore/Sources/Network/CLAUDE.md` (Keep per-request work off the engines' serial queues)*

#### 13.1.9 Разбор событий realtime — не на главном потоке
**Правило.** Задайте `SocketManager` в `RealtimeTransport` опцию `.handleQueue` с фоновой очередью. На главный передавайте только готовое событие.
**Почему.** У Telegram весь разбор обновлений шёл на общей очереди, которую главный поток ждал синхронно, и большие пачки давали рывки.
**Сейчас у нас.** соблюдено (#499): `SocketManager` с `.handleQueue`: события разбираются на своей очереди, на главный
уходит готовое.
*Источник: `docs/state-sync-audit-2026-10.md` (G7)*

#### 13.1.10 Бюджет работы за один ход главного цикла
**Правило.** Пачку событий realtime (после переподключения, массовые реакции) применяйте порциями и отдавайте ход главному циклу. Длинный цикл по сообщениям в `@MainActor` — с `await Task.yield()` или вне главного актора.
**Почему.** У Telegram один дренаж задач виджета ограничен по шагам (не больше 256) и CPU, остаток переносится на следующий раз, чтобы цепочка задач не держала поток.
*Источник: `docs/message-widgets-native-runtime.md` (A core task is bounded); `docs/superpowers/specs/2026-10-29-message-widgets-cpu-clock-limits-design.md` (Mapping onto this client)*

#### 13.1.11 Цикл по элементам не задаёт вопросов, которые сами обходят все элементы
**Правило.** В обработке ленты (`MessageTimeline`, `MessageStackGeometry`) и в будущей подсветке поля не вызывайте `firstIndex(of:)` или `filter` внутри цикла по элементам — берите кеш индексов или идите смещением рядом. Атрибуты в `textStorage` меняйте одним `beginEditing/endEditing`.
**Почему.** У Telegram O(N)-поиск внутри цикла по блокам давал квадратичный проход. Все проходы оформления собирают правки и применяют их одним пакетом.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (Presentation changes re-render in place)*

#### 13.1.12 Дорогие решения — раз на событие, а не на кадр
**Правило.** В `scrollViewDidScroll` и `MessageListGlide.tick` только читайте готовую раскладку (как `updateFloatingDate`). Обходы дерева видов, `systemLayoutSizeFitting` и поиск первого ответчика — один раз на событие. Стоимость покадрового пути смотрите в `ScrollJankMonitor` (`measure(.scrollHandler)`).
**Почему.** У Telegram проход по дереву видов на каждой выборке анимации (63 обхода) стоил 3,7–4,2 мс на старте перехода. Решение вынесли на одну «выпечку» — 0,1–0,2 мс.
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` (Resolved after the keyframes review; Rulings)*

#### 13.1.13 Объекты, привязанные к главному потоку, создаются только на нём
**Правило.** Модели экранов — `@MainActor`, кеш высот — на главном потоке. Фоновая подготовка (`RichText.prepare`, `MessageCodeBlocks`) производит только чистые значения и пишет в потокобезопасные кеши (`NSCache`). Вид или модель вне главного не создавайте.
**Почему.** У Telegram экземпляр виджета и кеш высот существуют только на главном; в списке, раскладывающем вне главного, пузырь держит заглушку.
**Сейчас у нас.** Соблюдено (комментарий в `MessageHeightCache`).
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` (Widgets exist only where the bubble lays out on main)*

### 13.2 Кадры, анимации и display link

#### 13.2.1 Ключ `CADisableMinimumFrameDurationOnPhone` обязателен
**Правило.** Не удаляйте ключ `CADisableMinimumFrameDurationOnPhone = true` ни из `project.yml`, ни из `scripts/device_bundle.py`, который генерирует `.device/Info.plist` для xtool.
**Почему.** У Telegram ключ обязателен: без него iPhone с ProMotion отдаёт приложению не больше 60 Гц.
**Сейчас у нас.** Соблюдено (`project.yml:122`, `scripts/device_bundle.py:77`).
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Core Animation output)*

#### 13.2.2 Частота своих display link — заявка на 120 Гц, ограниченная по времени
**Правило.** Каждый свой `CADisplayLink` создавайте с `preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)`, как в `MessageListGlide.start()`. Для пружины ленты попробуйте `minimum = maximum = preferred = 120` при `UIScreen.maximumFramesPerSecond >= 120` и снимайте заявку по завершении движения или через 1 с. Решайте по сравнению на iPhone (Instruments → Animation Hitches), под флагом `PerformanceFlags`.
**Почему.** У Telegram заявку с диапазоном и низким полом система опускала примерно до 80 Гц — движение на глаз медленнее. На экранах от 120 Гц они закрепляют ровно 120. Симулятор показывает 60 и этого не видит.
**Сейчас у нас.** Диапазон 60…120 стоит у `MessageListGlide.swift:43`, `ScrollJankMonitor.swift:125`, `ScrollBenchmark.swift:82`. Фиксированные 120 — проверить на iPhone.
*Источник: `docs/context-menu-liquid-morph.md` (Frame rate (2026-10-02)); `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Core Animation output); `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` (Rulings: 80–120 Hz gated on `maximumFramesPerSecond`)*

#### 13.2.3 `CADisplayLink` останавливается, когда вид уходит из окна
**Правило.** `MessageListGlide`, `ScrollJankMonitor`, `ScrollBenchmark` и любой новый держатель `CADisplayLink` инвалидируют ссылку при уходе с экрана или из окна и при деинициализации владельца. Цель держите слабой ссылкой. Проверка: уйти из чата во время пружины — CPU в покое.
**Почему.** У Telegram после отсоединения окна редактор продолжал крутить display link, а транзиентная каретка переживала разбор вида. 2350 UIKit-тестов этого не видели.
**Сейчас у нас.** `MessageListGlide` держит цель слабой ссылкой (`MessageListGlide.swift:18`, `:90`). Проверить на iPhone сценарий «ушёл посреди пружины».
*Источник: `docs/superpowers/phase6-manual-checklist-record.md` (п. 20; «Three checks owed», Task 42)*

#### 13.2.4 Не интерактивное движение — анимацией рендер-сервера
**Правило.** Не интерактивные движения делайте через `UIView.animate` или анимации SwiftUI, которые исполняет рендер-сервер. Свой display link — только для живой цели. `MessageListGlide` (CADisplayLink на главном) оправдан тем, что низ ленты меняется по ходу движения, и он подвиснет при занятом главном — это записано.
**Почему.** Telegram перевёл переходы на keyframe-анимации Core Animation: с приложением, остановленным в lldb на 0,3 с, экраны продолжали ехать, а покадровая выборка на главном подвисала.
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` (Rulings: Transition clock)*

#### 13.2.5 Не переобъявлять края прокрутки на каждом кадре инерции
**Правило.** В `scrollViewDidScroll` не трогайте `contentInset` и `contentSize`: это пересчитывает пределы инерции `UIScrollView`. Края меняйте по событию (клавиатура, панели, срез), а не покадрово.
**Почему.** У Telegram списывание запаса удержания на кадрах полёта каждый раз объявляло новый край и заново пересчитывало полёт (`KeyframeFlight`).
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (The scroll hold, «Never on a flight's ticks…»)*

#### 13.2.6 Свойства поля присваивать только при изменении
**Правило.** В `ComposerTextView.updateUIView` пишите `textColor` и `tintColor` только при смене значения (`isMuted`, тема).
**Почему.** У Telegram переприсваивание строки отображения на каждом проходе вызывало бесконечный цикл раскладки. Смена оформления у них — правка атрибутов, сохраняющая выделение и marked text. Переприсваивание цвета перекрашивает весь `textStorage` и может оборвать IME-составление.
**Сейчас у нас.** Расходится: `textColor`, `tintColor`, `accessibilityLabel` пишутся на каждом проходе (`Composer/ComposerTextView.swift:63-65`). Проверить на iPhone японской или китайской раскладкой.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Render-only attributes, the `U+FFFC` atom, repainting); `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` (Presentation changes re-render in place)*

#### 13.2.7 Лишние уведомления о выделении стоят кадров клавиатуры
**Правило.** Программно пишите `selectedRange` только после своей команды и только если значение отличается. Не пишите его, пока `markedTextRange != nil`.
**Почему.** У Telegram каждый `selectionDidChange` — около 25 мс синхронной работы клавиатуры. Лишние уведомления во время составления сбивают автокоррекцию и предиктивный ввод, поэтому на жест — одна скобка уведомлений.
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` (Selection notifications and the caret reveal); `docs/superpowers/richtext-stock-divergences-followups.md` (§1)*

#### 13.2.8 Тени и размытие: без пересчёта на каждом сдвиге
**Правило.** Тени и размытия пузырей и карточек дорогие. Ключ любого своего кеша отрисовки не должен содержать дробную позицию. Тени — через `shadowPath` или растр (флаг `chatBubbleFlatShadow`), а не пересчитываемые при каждом сдвиге.
**Почему.** У Telegram ключ кеша тени содержал субпиксельную фазу, и движущаяся тень промахивалась мимо кеша каждый кадр. Одна тень в 55 px стоила 44 мс на кадр; после правок кадр упал со 137 мс до 6–18 мс.
*Источник: `docs/message-widgets-native-runtime.md` (Paint cost per frame)*

### 13.3 Фоновые задачи, очереди и видимость

#### 13.3.1 Невидимое не работает
**Правило.** Анимированные GIF и стикеры (`AnimatedGIF`, `UIImageView.animatedImage`), прогресс голосовых, таймеры «печатает…», живую геопозицию и опрос превью останавливайте при уходе ячейки с экрана, при открытии экрана поверх (`didMoveToWindow`, `onDisappear`) и при уходе приложения в фон (`scenePhase`). «Видим» = строка на экране ∧ вид в окне ∧ приложение активно.
**Почему.** У Telegram зацикленные эмодзи играют только в видимом прямоугольнике (`nil` — «не видно»). Видимость списка геометрическая — чат под открытым экраном её сохраняет, — а приложение живёт в фоне при звонках и аудио, поэтому учитываются и окно, и активность. Скрытое получает таймеры 1 Гц и не получает кадров.
*Источник: `docs/instantpage-richtext.md` (Inline custom emoji, «visibilityRect gates looping»); `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` (Visible = bubble visible ∧ view in a window ∧ app active)*

#### 13.3.2 «Выключено» значит остановлено, а не «работает с нулями»
**Правило.** Скрытый экран не опрашивает сервер, невидимая анимация не крутится, пауза голосового отпускает аудиосессию, свёрнутое видео не декодирует. Проверяйте по факту работы (Instruments, журнал запросов), а не по тому, что на экране ничего не видно.
**Почему.** У Telegram заглушённый трек продолжал кодировать и слать нулевой Opus — работу, невидимую для проверок по уровню звука.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («Mute must stop the stream, not silence it»)*

#### 13.3.3 Не делать работу для ушедшего потребителя
**Правило.** Каждый фоновый шаг (декод кадра видео, размытие, ресайз) перед дорогой частью проверяет отмену (`Task.isCancelled`).
**Почему.** У Telegram отложенная перерисовка пропускается, если у задачи не осталось потребителей.
**Сейчас у нас.** Соблюдено: `ImageMemoryCache.load` проверяет отмену перед декодированием (`Core/Images/ImageMemoryCache.swift:120`), `ImageDownloads` снимает загрузку, когда ушли все ждущие (`Core/Images/ImageDownloads.swift:95`).
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` («The queued redraw is skipped when the job has meanwhile lost its consumers»)*

#### 13.3.4 Ограниченный параллелизм и приоритет видимого в общих очередях
**Правило.** Параллельные загрузки миниатюр и снимков ограничивайте (образец — `ChatMediaThumbnails.maxConcurrent = 4` в `ChatSharedContentView.swift:692`) и отдавайте приоритет видимым ячейкам. Задачи ушедших с экрана отменяйте: `.task` отменяется сам, не отвязывайте его от вида через `Task.detached`.
**Почему.** У Telegram два потока пула брали задачи по порядку, и первые кадры тяжёлых виджетов задерживали лёгкий на 213–519 мс — блокировка «в голове очереди».
*Источник: `docs/message-widgets-native-runtime.md` (Pool contention (V6))*

#### 13.3.5 Фоновое заполнение уступает, пока человек двигает экран; повторы — с паузой
**Правило.** Фоновая работа с медиа (предзагрузка ленты и переписки, `ChatMediaThumbnails`) не отнимает полосу у видимого: на ходу — меньше параллельных задач и приоритет `.utility`. Промахи повторяйте с растущей паузой, а не сразу.
**Почему.** Заполнитель Telegram держит 16 запросов в покое и 4 на быстром ходу, промахи повторяет через 30 с, 2 мин, 10 мин и затем при следующем запуске.
**Применимость.** Частично: своего заполнителя миниатюр у нас нет.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` (Filler); `docs/superpowers/plans/2026-10-27-media-grid-thumbnail-store.md` (Task 4, Throttling)*

#### 13.3.6 Покадровые и пакетные циклы — в `autoreleasepool`, с ограниченной очередью
**Правило.** Тело циклов над кадрами и картинками (кадры GIF, пакетная подготовка выбранных снимков, генерация превью) оборачивайте в `autoreleasepool { }`. Несколько роликов из выбора экспортируйте не все разом, а ограниченным числом параллельно (как 4 слота `ChatMediaThumbnails`).
**Почему.** У Telegram без пула авто-освобождаемые кадры жили до конца экспорта, без ограничения очереди память росла до jetsam. Слишком низкий фиксированный предел (ниже задержки кодера) давал взаимную блокировку, поэтому предел у них адаптивный.
*Источник: `submodules/TelegramUI/Components/MediaEditor/CLAUDE.md` (The encoder queue is capped, adaptively; Every data callback runs in an `autoreleasepool`)*

#### 13.3.7 Дросселирование откладывает, но не теряет; ввод человека — всегда сразу
**Правило.** Шумные события (набор текста, присутствие, `chat:activity`) можно схлопывать и откладывать. События, меняющие данные (`message:*`, `poll:updated`, `checklist:updated`), не теряются и применяются по порядку. Касание никогда не ждёт очереди фоновых обновлений.
**Почему.** Перегруженный виджет Telegram анимируется реже, но работает: отложенные задачи ждут, кадры схлопываются в один, по одному срабатыванию на таймер, а события ввода и видимость идут всегда.
*Источник: `docs/superpowers/specs/2026-10-29-message-widgets-cpu-clock-limits-design.md` (What upstream's native glue does); `docs/message-widgets-native-runtime.md` (Limits, «JS quota»)*

#### 13.3.8 Единый вход в транспорт; после фатальной ошибки — безопасное умолчание
**Правило.** `RealtimeTransport` и `APIClient` — единственные входы в сокет и сеть. После фатальной ошибки транспорта последующие вызовы безопасны и возвращают умолчание, а не падают.
**Почему.** У Telegram Swift зовёт рантайм виджетов только через фасад `WRSession` на очереди виджета. Ошибка C++ ловится и фиксируется, дальнейшие вызовы отвечают умолчанием, а остановленный виджет становится неподвижной картинкой.
**Применимость.** Частично: рантайма виджетов у нас нет, переносится принцип фасада.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` (Swift reaches the runtime only through WRSession)*

#### 13.3.9 Рефакторинг не удлиняет жизнь захваченных объектов
**Правило.** В долгоживущих замыканиях (наблюдения GRDB, подписки realtime, `Task` в моделях) не меняйте захват конкретного хранилища на `AppServices` или модель экрана целиком.
**Почему.** У Telegram замену узкого захвата (`StorageBox`) на широкий (весь `Account`) признали изменением времени жизни и отложили, хотя это «просто рефакторинг».
*Источник: `docs/superpowers/postbox-refactor-log.md` (Deferred: `AccountContext.swift:387`)*

#### 13.3.10 Частоту keepalive и присутствия не менять без замера
**Правило.** Ping и переподключение socket.io (`RealtimeTransport`, `RealtimeCoordinator.scheduleReconnect`) и частоту присутствия в сети не меняйте «на глаз». Сначала замер расхода батареи и трафика на iPhone, изменение — под флагом.
**Почему.** У Telegram новая частота keepalive включается только на той платформе, где она измерена; macOS осталась на старой до замера.
**Применимость.** Частично: своего сетевого движка нет, переносится принцип.
*Источник: `submodules/MTProtoRustEngine/CLAUDE.md` («the Rust engine then uses tdlib's online keepalive timing…»)*

### 13.4 Кеши и память

#### 13.4.1 Каждый кеш — с пределами по числу и объёму
**Правило.** Каждый кеш — `NSCache` с `countLimit` и `totalCostLimit` или с явной политикой вытеснения. Никаких статических словарей, растущих от серверных строк. Поднимать пределы для замеров допустимо только в тестовой сборке.
**Почему.** У Telegram лимиты виджетов — счётчики, и строгая политика останавливает виджет при превышении; мягкая — только для замеров стресс-набором. После каждой публикации кеши шрифтов и картинок подрезаются до того, что на экране, а исключения из учёта ограничены и закреплены тестом.
**Сейчас у нас.** Соблюдено: `RichText` — 3000 / 4 МБ (`FeedComponents.swift:326-327`), `MessageCodeBlocks` — 500 / 1 МБ (`MessageCodeBlocks.swift:108-109`), кеш высот — 4000 с полной очисткой при переполнении (`MessageStackGeometry.swift:22`, `:35`).
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` (widget-sandbox v0.3.0's limits are counts…); `docs/message-widgets-native-runtime.md` (Rendering (M1c); Memory)*

#### 13.4.2 Недоверенные строки не растят глобальные таблицы
**Правило.** Ключи из содержимого (тексты, emoji, URL) не кладите в бессрочные статические словари или `Set` уровня процесса — только в ограниченные кеши.
**Почему.** У Telegram имя из содержимого виджета ищется без добавления в процессную таблицу интернированных строк: иначе чужой контент растит память процесса без предела.
*Источник: `docs/message-widgets-native-runtime.md` (getComputedStyle; matchMedia)*

#### 13.4.3 Подсветка синтаксиса — фоном, из кеша; промах рисует простой текст
**Правило.** Если появится подсветка, считайте её в фоне при сборке ленты по образцу `RichText.prepare`, а в ячейке только читайте кеш. Промах кеша рисует простой текст, цвета приходят следующим проходом.
**Почему.** У Telegram подсветка считается вне главной очереди, а проход раскладки только читает кеш.
**Применимость.** Частично: подсветки нет, схема кеша уже наша.
*Источник: `docs/instantpage-richtext.md` (Syntax highlighting)*

#### 13.4.4 Утечки мерить в приложении, после того как переход завершился
**Правило.** Утечки ленты (`ChatThreadModel`, `MessageListViewController`, плееры) проверяйте в приложении на iPhone (Instruments → Leaks / Memory Graph) после нескольких открытий и закрытий чата. Считайте только после окончания перехода назад.
**Почему.** У Telegram перезагрузка тестового стенда оставляла старый чат живым — особенность стенда, а не утечка. В приложении утечки нет: измерено `heap` после трёх открытий и закрытий, с подсчётом после конца анимации закрытия.
*Источник: `Tests/WidgetHarness/CLAUDE.md` (A reload does not free the previous chat)*

### 13.5 Флаги, откат и приёмка изменений

#### 13.5.1 Положение механизма читается из одного места
**Правило.** Положение рискованного механизма читайте только через `PerformanceFlags.<флаг>` или `PerformanceFlags.isOn(_:)` (`App/PerformanceFlags.swift`). Не дублируйте условие в другом виде. Новый код, завязанный на флаг, — тоже через это свойство, без локальных копий.
**Почему.** У Telegram выбор бэкенда ленты публикуется одним свойством `usesCoreListBackend`. Одно место, выводившее политику заново, разъехалось при смене значения по умолчанию.
**Сейчас у нас.** Соблюдено: `MessageCell.fit` и `configureCollectionView` оба читают `PerformanceFlags.chatHeightCache`.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Selection)*

#### 13.5.2 Рискованное — под выключателем, с записанной причиной положения
**Правило.** Всё рискованное в ленте держите за флагом второй волны, выключенным, пока его не проверили на iPhone и `PerformanceFlagUITests` не сравнил оба положения. Откат — одна строка `defaultValue` в `PerformanceFlags.Switch`, без удаления кода. Рядом с флагом пишите комментарий с причиной текущего положения. Удалённый выключатель не заводите без согласия владельца: это новый контракт с API.
**Почему.** У Telegram новый бэкенд включён по умолчанию, но серверный kill switch гарантированно его выключает и перекрывает отладочный переключатель. Открытые дефекты перечислены рядом — ради них выключатель и существует.
**Сейчас у нас.** Соблюдено: «Дыры между пузырями у верха ленты — `testHeightCacheKeepsChatTheSame`» у `chatHeightCache` (`App/PerformanceFlags.swift:66-67`).
**Применимость.** Частично: удалённой конфигурации нет, переносится принцип «флаг + записанная причина».
*Источник: `docs/chat/corelist-chat-history-backend.md` (Selection; Deferred items / known limitations)*

#### 13.5.3 Один флаг откатывает связное изменение целиком; ремонт — без флага
**Правило.** В `PerformanceFlags` — один флаг на связную часть: `false` возвращает прежнее поведение целиком. Исправление пути отказа, не меняющее обычный путь, флагом не обвешивайте.
**Почему.** У Telegram связанные изменения откатываются вместе одним серверным ключом, а правки учёта, сохраняющие поведение на старом пути, не прячутся.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («All of the above is on by default and reverts as a unit under the server killswitch…»)*

#### 13.5.4 Приёмка по записи с покадровым счётом и сравнением «флаг вкл/выкл»
**Правило.** Визуальную правку медиа и ленты принимайте по кадрам записи (видео UI-тестов в `build/test-output/` на CI или запись экрана iPhone от владельца) и сравнением обоих положений флага (`PerformanceFlagUITests`). Механизм не должен добавлять пропущенных кадров к тому же сценарию без него.
**Почему.** У Telegram сценарии записываются `simctl io recordVideo`, кадры разбираются скриптом, считаются пустые ячейки, и сравнение идёт с выключенным механизмом.
*Источник: `docs/superpowers/plans/2026-10-27-media-grid-thumbnail-store.md` (Task 5); `docs/superpowers/specs/2026-10-27-media-picker-grid-design.md` (Verification)*

#### 13.5.5 Изменения загрузок и кеша — не хуже базовой линии
**Правило.** Правка очередей загрузки картинок и видео, предзагрузки и кеша проходит perf-набор (`StudentHubPerfTests` против `Tests/perf-baseline.json` в `ios-nightly.yml`). Базовую линию обновляйте только осознанно, с объяснением в PR.
**Почему.** У Telegram любой профиль лаборатории воспроизведения, ставший хуже `LabBaseline` (больше зависаний или позже старт), роняет тест.
*Источник: `submodules/HLSPlayback/CLAUDE.md` (Changes to the scheduler go through the playback lab); `docs/native-hls-player.md` (The playback lab)*

#### 13.5.6 Новые ограничения проверяются на «честных» данных
**Правило.** Новые дроссели, лимиты загрузок и кеши проверяйте на честных данных (`SH_UITEST_LARGE=1`, реальные чаты на Railway). Если ограничение портит нормальный сценарий — откатывайте и сообщайте владельцу, а не подгоняйте тест.
**Почему.** У Telegram учёт отрисовки троттлил около 60 честных виджетов, и пункт спецификации отменили: анти-цель («честный виджет не тормозится на текущем iPhone») главнее, решение — за владельцем.
*Источник: `docs/superpowers/specs/2026-10-29-message-widgets-cpu-clock-limits-design.md` (анти-цели; Revised Task 6 ruling)*

### 13.6 Как мерить честно

#### 13.6.1 Мерить на той оптимизации, на которой код реально собран
**Правило.** Помните:
1. Приложение на iPhone владельца через xtool собрано в Debug, `-Onone`. Плавность на нём хуже релизной; рывок на отладочной копии не обязательно есть в TestFlight, и «быстро на телефоне» ничего не говорит о Release.
2. `StudentHubPerfTests`, `perf-baseline.json` и `bench` гоняются в Debug (`project.yml:200-201`, `test: config: Debug`) — их цифры сравнимы только между собой.
3. Попиксельных циклов и SIMD у нас нет. Если появятся — CoreGraphics, vImage или Core Image, а не ручной цикл на Swift, и замер в обеих конфигурациях.
**Почему.** У Telegram почти все модули в debug собраны `-Onone`, а два — `-O`, и по месту вызова не видно, где код. Попиксельная работа на Swift: 3,4 мс на `-O` против 1083 мс на `-Onone` (×300). Широкий SIMD на `-Onone` медленнее скаляра. Ручной цикл может быть намного быстрее в релизе и намного медленнее в отладке — эту сторону релизный замер не покажет.
*Источник: `CLAUDE.md` (Per-module -O and pixel loops)*

#### 13.6.2 Окно замера не крутит run loop; берётся минимум из N; проверяется отношение
**Правило.** В `StudentHubPerfTests` и `ScrollBenchmark` мерьте шаг плюс синхронный `layoutIfNeeded()`, а `CATransaction.flush()` делайте вне окна замера. Прогрев, затем минимум из нескольких прогонов. Против `perf-baseline.json` сравнивайте отношения («2× данных → не больше k× времени»), а не абсолютные миллисекунды симулятора. Сверхлинейный кусок ищите пробами по фазам.
**Почему.** У Telegram `RunLoop.run(until: now)` внутри окна иногда выполнял отложенный коммит Core Animation, и замеры становились двухмодальными.
*Источник: `Tests/ComposerHarness/CLAUDE.md` (A timed window never spins the run loop; Find the superlinear piece with probes)*

#### 13.6.3 Бюджеты — по CPU потока, а не по стенным часам; одинаковые числа в Debug и Release
**Правило.** Перф-тесты сравнивайте по CPU-метрикам (`XCTCPUMetric`), а не по стене на загруженном раннере CI. Пороги и флаги (`PerformanceFlags`) одинаковы в Debug и Release; отличия — явные и записанные.
**Почему.** У Telegram на нагруженной машине лимиты по стенному времени убивали виджеты, потратившие лишь долю бюджета. Поэтому они меряют CPU-время потока со стенной страховкой и держат одни числа во всех сборках, чтобы тесты в debug судили по настоящим.
**Сейчас у нас.** `StudentHubPerfTests` уже собирают `XCTCPUMetric` (`Tests/StudentHubPerfTests/PerformanceTests.swift:66`, `:92`).
*Источник: `docs/superpowers/specs/2026-10-29-message-widgets-cpu-clock-limits-design.md` (What upstream's native glue does; «Debug builds… this client keeps the product numbers in every build»)*

#### 13.6.4 «Не хуже прежнего» — по многим прогонам в равных условиях
**Правило.** Замеры `StudentHubPerfTests` против `Tests/perf-baseline.json` (`scripts/perf_check.py`) сравнивайте только в одинаковых условиях: тот же раннер, тот же симулятор или устройство. Один прогон — не вывод. Цифры с загруженного CI помечайте как несравнимые.
**Почему.** У Telegram паритет меряется статистикой по многим прогонам (с p-значением Фишера), а прогоны на перегруженной машине выброшены как несравнимые.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («The target is "compat + 8.0.0 no worse than 8.0.0 + 8.0.0"…»)*

#### 13.6.5 Замеры на устройстве — без отладчика, без энергосбережения, на холодном телефоне
**Правило.** Замеры на iPhone владельца (Instruments → Animation Hitches, `ScrollJankMonitor`) делайте на release-подобной сборке без подключённого отладчика, с выключенным режимом энергосбережения, на остывшем телефоне. Условия записывайте в отчёт.
**Почему.** Сопровождающие Telegram принимают файлы прогонов только с таких устройств: отладчик, энергосбережение и нагрев искажают цифры.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` (The stress kit)*

#### 13.6.6 Цифры симулятора — не мера успеха
**Правило.** Критерии успеха проверяйте на устройстве. В отчёте медиа- и перф-задачи пишите отдельно «на CI-симуляторе» и «на iPhone — не проверено / цифры». Промах по цели сообщайте, а не прячьте.
**Почему.** У Telegram замеры симулятора — только функциональная проверка; незаполненная таблица устройства висит в гайде до следующего этапа.
**Сейчас у нас.** Соблюдено в README: 120 Гц и подвисания — только на телефоне (`apps/ios/README.md`, «Что тесты не заменяют»).
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` (Measured results (simulator only); Device (pending)); `docs/superpowers/plans/2026-10-27-media-grid-stage1.md` (Task 13, «a miss is reported, not hidden»)*

#### 13.6.7 Каждое число — с датой, устройством, сборкой и условиями
**Правило.** В PR и документах пишите замеры iOS с датой, устройством (iPhone владельца на iOS 27 или симулятор CI), конфигурацией (debug через xtool или release на CI) и условиями. Числа симулятора не выдавайте за числа телефона. Устаревшие числа помечайте как историю и ничего к ним не привязывайте.
**Почему.** У Telegram каждое число снабжено датой, машиной, конфигурацией и нагрузкой («loaded host», «debug build», «printed and not asserted»), а устаревшие помечены как история.
*Источник: `docs/message-widgets-native-runtime.md` (Measured)*

#### 13.6.8 Стоимость стекла, размытия и теней — только в процессе приложения
**Правило.** Стоимость Liquid Glass, размытий и теней не мерьте юнит-тестом. Мерьте в приложении на iPhone или в UI-тестах, где `StudentHubPerfTests` запускает приложение. Цифры симулятора по эффектам — не про телефон.
**Почему.** У Telegram тестовые процессы без хоста не имеют Metal-устройства и не рисуют фильтры, поэтому их замеры занижены. Core Image в симуляторе считает на GPU Mac.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` (Tile rule); `docs/message-widgets-native-runtime.md` (Paint cost)*

#### 13.6.9 Первый display link в тестовом процессе — прогревать
**Правило.** В перф- и UI-тестах прогревайте первый кадр и первый `CADisplayLink` до начала замера.
**Почему.** У Telegram первый `CADisplayLink` процесса в безголовом симуляторе стоил 5014 мс, и тест его прогревает.
*Источник: `docs/message-widgets-native-runtime.md` (Measured… After M1d)*

#### 13.6.10 Цикл оптимизации: замер → одна правка → все тесты → замер → оставить или откатить
**Правило.** Оптимизируйте по одной правке за коммит, с цифрами до и после в одном режиме сборки. После правки — весь набор тестов. Не сработало — откат, а не «оставим на всякий случай». Instruments доступен только на Mac или CI, локально замер — `StudentHubPerfTests` и signposts. В выгрузке `xctrace` считайте число сэмплов, а не суммируйте веса.
**Почему.** Telegram профилирует только Release (с LTO), одной целевой правкой за раз, с полным набором тестов и повторным профилем после каждой.
**Применимость.** Частично: профилировщика локально нет.
*Источник: `third-party/subcodec/CLAUDE.md` (Profile-optimize loop; Build note; Parsing xctrace XML)*

### 13.7 Средства замера, бюджеты и нагрузочные тесты

#### 13.7.1 Новая оптимизация приходит со способом её измерить и с базовой линией
**Правило.** Новую оптимизацию (особенно медиа) сопровождайте способом измерения — signpost или perf-тест — и выключателем-базовой линией в `PerformanceFlags`. Пользуйтесь существующими средствами: переменными запуска mock (`SH_UITEST_LARGE`, `SH_UITEST_HISTORY_DELAY_MS`, `SH_PERF_FLAGS`), `StudentHubPerfTests` с `Tests/perf-baseline.json`, интервалами `Signposts.images` (`ImageFetch`, `ImageDecode`, `ImageDiskHit`).
**Почему.** Демо-приложение Telegram принимает флаги запуска (`-autoScrub`, `-frameLog`, `-noThumbnails` как базовая линия, `-startAt`, `-autoRotate`) и печатает по каждому кадру интервал, пустые ячейки и задержки запросов.
**Применимость.** Частично: своего демо-приложения у нас нет.
*Источник: `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` (Measuring image loading in the demo)*

#### 13.7.2 Выключенное измерение ничего не стоит
**Правило.** На горячих путях (приход сообщения, прокрутка) держите signposts (`Signposts`), а не логирование строк: без записи Instruments они дёшевы. Новое измерение на пути запроса или события сравните в `StudentHubPerfTests` в трёх положениях: без него, выключенным и включённым.
**Почему.** У Telegram обёртка телеметрии ставится только при записи, а любая правка пути запроса меряется трижды (baseline, off, on).
*Источник: `submodules/TelegramCore/Sources/Network/CLAUDE.md` («Recording off must cost nothing… A/B every request-path change three ways»)*

#### 13.7.3 Каждый шаг открытия чата размечен по времени
**Правило.** Держите signposts на каждом шаге открытия чата: база → первая страница → догон → прочтение. Добавьте отладочный переключатель «принудительный overflow» догона для проверки редкого пути. Воспроизводимость холодного открытия — через `SH_UITEST_*`.
**Почему.** У Telegram в debug есть три средства: аргумент сброса кеша на запуске, открытие ссылки аргументом и тег лога со временем каждого шага открытия.
**Сейчас у нас.** Частично есть: интервалы `ChatOpen`, `ThreadSnapshotRead`, `TimelineBuild`, `SnapshotApply`, переменные `SH_UITEST_*`. Переключателя overflow нет: mock всегда отдаёт `overflow: false` (`App/UITesting/MockAPIProtocol.swift:346`), ветка обработки — `ChatThreadModel.swift:1479`.
**Применимость.** Частично.
*Источник: `submodules/TelegramCore/Sources/TelegramEngine/Messages/CLAUDE.md` (Debug builds have three measurement aids)*

#### 13.7.4 Считается только активное ожидание
**Правило.** Замеры длительности (signposts `SessionRestore`, `TokenRefresh`, будущие метрики сети) не должны включать время в фоне. Для таймаутов, которые должны стоять во сне, — `SuspendingClock`; для тех, что идут всегда, — `ContinuousClock` (`Task.sleep(for:)`). Свежесть данных (`AppLifecycle.staleAfter`) правильно считать по стенным часам.
**Почему.** У Telegram запрос считается медленным или зависшим только по времени активного ожидания с момента, когда связь поднялась; приостановка и ожидание по требованию сервера не считаются (часы `CLOCK_UPTIME_RAW`).
*Источник: `submodules/TelegramCore/Sources/Network/CLAUDE.md` (Only active waiting counts)*

#### 13.7.5 Метрики воспроизведения видео: строка на первом кадре и строка на закрытии
**Правило.** Добавляя наблюдение за видео, ставьте signpost-интервал «открыл → первый кадр» (`timeControlStatus`/`isReadyForDisplay`) и итог по `AVPlayerItem.accessLog()`/`errorLog()` при закрытии. Подписанные ссылки в журнал не пишите (`privacy: .private`).
**Почему.** У Telegram одна строка лога пишется при первом кадре (время до кадра, источник первого сегмента, качество), другая — при уходе плеера (зависания, ожидание после перемотки, уровни, байты сети и диска).
**Сейчас у нас.** Видео в журнал не пишется — это рекомендация.
*Источник: `docs/native-hls-player.md` (Logs, `HLSStart`, `HLSSession`)*

#### 13.7.6 Таблица цены сценариев синхронизации
**Правило.** В карте синхронизации держите таблицу: открытие чата (холодное и из базы), переподключение (догон открытого чата + первая страница списка на 50), тихий пуш (страница списка + счётчик), отправка (1 запрос + эхо). Утверждайте её тестами по журналу запросов дублёра.
**Почему.** У Telegram для каждого сценария записано число запросов и транзакций, взятое из кода и из имён запросов в тестах. Рычаги: перепроверять дыру вместо фиксированного ожидания, объединять запросы, параллелить независимые этапы, не писать пустой ответ.
*Источник: `docs/state-sync.md` (Cost model); `docs/state-sync-audit-2026-10.md` (§11)*

#### 13.7.7 Лимиты синхронизации — по замерам; длинный догон не разворачивать целиком
**Правило.** `CHAT_UPDATES_LIMIT = 200` (сервер, `apps/api/src/modules/chats/chats.service.ts:73`) и страницу списка 50 при переподключении пересматривайте по замерам: размер разрыва, время догона. При длинном догоне не стройте баннеры и уведомления на каждое сообщение — только на то, что покажется.
**Почему.** Telegram выбирает порог разницы только после замера по срезам. События длинного догона у них копились в памяти и разворачивались целиком, хотя нужно последнее.
**Применимость.** Частично.
*Источник: `docs/superpowers/reports/2026-10-15-difference-too-long-exploration.md` (pts-limit)*

#### 13.7.8 Разборщики содержимого линейны, и это проверяет тест
**Правило.** Разбор текста сообщения (`MessageCodeBlocks.parse`, `RichText`, `ProfileShare.parse`) — без рекурсии по входу и без квадратичных проходов (поиск подстроки внутри цикла по той же строке). Юнит-тест на враждебные входы — сотни незакрытых ```` ``` ````, мегабайт текста, глубокая вложенность разметки — проверяет отношение времени на размерах N и 8N.
**Почему.** У Telegram обходы итеративные, рекурсия — только до фиксированных пределов, глубокие входы проверены на стеке 512 KiB. Линейность проверяется отношением CPU (8× текста — меньше чем за 24× CPU), а исходный gumbo оказался квадратичным на восьми классах входа.
*Источник: `docs/message-widgets-native-runtime.md` (Stack; The selectable text, `testTheSelectableExportIsLinear`; «Pristine gumbo was quadratic on eight input classes»)*

#### 13.7.9 Корпус сообщений с бюджетом времени разбора
**Правило.** Заведите набор фикстур сообщений (обычные, длинные, с кодом, враждебные) и тест в `StudentHubPerfTests`, проверяющий время разбора `RichText` и `MessageCodeBlocks` против `perf-baseline.json`. Атаки — отдельным тестом. Исключения — поимённым списком с причиной.
**Почему.** У Telegram тест загружает весь корпус, кроме атак, и падает, если честный шаг дороже четверти лимита.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` (Corpus check)*

#### 13.7.10 Стресс-набор — долгий прогон в отдельном режиме
**Правило.** `scripts/test.sh full` (с замерами) гоняйте в nightly (`ios-nightly.yml`), а не на PR. В результатах фиксируйте условия: флаги и устройство.
**Почему.** Стресс-набор Telegram — 127 виджетов, около 35 минут на симуляторе, с отдельными режимами замера и продакшн-лимитов; применённые лимиты записываются.
**Сейчас у нас.** Соблюдено (`.github/workflows/ios-nightly.yml:67`).
*Источник: `Tests/WidgetHarness/CLAUDE.md` (The stress kit)*

#### 13.7.11 Проверка на каждой сборке — быстрая, а ускорение подтверждено сравнением
**Правило.** Проверка, идущая на каждом CI-прогоне, укладывается в секунды. Переписанный скрипт проверки сверяйте со старым на всём дереве: вывод должен совпасть.
**Почему.** Telegram ускорил свой страж с 6,6 с до 0,58 с и доказал тождество побайтным сравнением выхода старого и нового на всех 5954 Swift-файлах.
*Источник: `docs/superpowers/postbox-refactor-log.md` (Pre-merge review fixes)*

### 13.8 Неприменимо к нам
- Механика потокового раскрытия ответа ИИ (маска по контурам глифов, стоимость в пунктах ширины, тик display link, рост пузыря на лету) — потокового текста в сообщениях у нас нет. *`docs/instantpage-richtext.md` (AI streaming animation)*
- Нулевая стоимость блоков размышлений в темпе раскрытия — потоковых ответов нет. *`docs/instantpage-richtext.md` (InstantPage thinking blocks)*
- Освобождение буферов `CTRunDelegate` в `dealloc` — Core Text напрямую мы не используем. *`docs/instantpage-richtext.md` (Inline custom emoji, «CTRunDelegate extent buffers must be freed»)*

---
## §14. CI, зависимости, внешние загрузки

Как держать сборку воспроизводимой, CI быстрым и честным, а чужой код — под контролем. Главная мысль: всё, что сборка
берёт снаружи, фиксируется версией или контрольной суммой. Всё, что может разойтись молча (два манифеста,
сгенерированные файлы, списки исключений), проверяет автомат, а не память.

### 14.1 Воспроизводимость сборки и версии

#### 14.1.1 Каждая внешняя загрузка — с контрольной суммой или точной версией
**Правило.** Всё, что CI скачивает, фиксировать точной версией, а где возможно — проверкой sha256 скачанного:
- XcodeGen ставить фиксированной версией, с проверкой суммы архива;
- пакеты Xcode-сборки фиксировать `exactVersion` или закоммиченным resolved-файлом.

Бинарный `Sentry` SPM сам сверяет checksum из своего манифеста — это не трогать. Смена политики версий — стоп-точка
«зависимости» из `AGENTS.md`, только по согласованию с владельцем.
**Почему.** У Telegram кеш отдаёт архив только по его sha256. Без суммы каждая эфемерная VM качает заново из интернета
и не укладывается в таймаут. Новая версия инструмента без фиксации может молча поменять результат.
**Сейчас у нас.** частично (#499): XcodeGen ставится точной версии с проверкой sha256
(`.github/actions/setup-xcodegen`); пакеты по-прежнему через `from:`, `Package.resolved` не коммитится — решение
владельца (14.1.2).
**Применимость.** частично: Bazel-кеша у нас нет, переносится требование фиксации.
*Источник: `CLAUDE.md` («CI builds and external downloads»); `build-system/Make/CLAUDE.md` («CI builds in tart VMs»)*

#### 14.1.2 Обновлять одну зависимость за раз; версии фиксировать
**Правило.** Обновлять одну зависимость (`swift package update GRDB`), а не всё дерево. Вопрос владельцу: коммитить ли
`Package.resolved`. Новая зависимость и смена политики — стоп-точка `AGENTS.md`.
**Почему.** У Telegram перефиксация затрагивает только нужный набор пакетов. Голый `CARGO_BAZEL_REPIN=1` заново
разрешает и чужие, слабо зафиксированные пакеты, и их версии молча уезжают.
**Сейчас у нас.** расходится: `Package.resolved` в `.gitignore`. Версии GRDB и socket.io-client-swift на CI и
локально разрешаются заново в пределах диапазона, поэтому сборки невоспроизводимы.
*Источник: «Repin only the engine's crates… A bare `CARGO_BAZEL_REPIN=1` also re-resolves…»*

#### 14.1.3 Два манифеста — правка в обоих, версия одна
**Правило.** Любую зависимость, флаг, ресурс или таргет вносить сразу в оба манифеста: `Package.swift` (xtool, Linux)
и `project.yml` (XcodeGen, CI). Версию зависимости указывать одинаково в обоих. Исключение — Sentry: он есть только в
Xcode-сборке (`project.yml:41-58`). Новая зависимость — только с согласия владельца.
**Почему.** Расхождение проявится только на одной из сборок. У Telegram обязательные определения SQLCipher стоят в
`BUILD` и `Package.swift` и должны совпадать. Версия FFmpeg задана одной переменной `FFMPEG_VERSION`.
*Источник: `ffmpeg/CLAUDE.md` (пункт 1); `sqlcipher/CLAUDE.md` («`BUILD` and `Package.swift` carry them; keep the two
in sync»)*

#### 14.1.4 После обновления проверять фактическую версию по артефакту
**Правило.** После смены версии пакета сверить `Package.resolved` и разрешённую версию в логе CI. Где важно — в
рантайме, например `sqlite3_libversion()` через GRDB. Если локально происходят странности, почистить `.build` и кеш
`~/.swiftpm` xtool, а не верить, что пакет обновился.
**Почему.** У Telegram удалённый заголовок продолжал лежать в выходах `bazel-bin`. Версию SQLite проверяют по
`#define SQLITE_VERSION` внутри файла, а не по имени архива.
*Источник: `ffmpeg/CLAUDE.md` (последний абзац); `sqlcipher/CLAUDE.md` («check `sqlite3.c` for `#define
SQLITE_VERSION`… rather than trusting the archive name»)*

#### 14.1.5 Подъём версии инструмента — обновить всё, что к ней привязано
**Правило.** Подъём Xcode на CI делать одной правкой `DEVELOPER_DIR` во всех iOS-workflow (`ios.yml`,
`ios-nightly.yml`, `ios-snapshots.yml`, `ios-release.yml`). В той же задаче переснять эталоны снимков (метка
`ios-record-snapshots`), обновить README («Xcode 26.6, iPhone 17 Pro, iOS 26.5») и при необходимости
`perf-baseline.json`. Подъём Swift на Linux (swiftly) сверять с версией Xcode на CI: известные баги Swift 6.4 — в
§4.1.
**Почему.** У Telegram подъём Rust означает обновить словарь сумм в `MODULE.bazel`: rules_rust знает суммы только до
своей версии.
**Сейчас у нас.** частично (#499): `ios-release.yml` собирает на `macos-26` с тем же `Xcode_26.6`, что тесты; локальный
Swift 6.4.2 новее, чем в Xcode CI, — решение владельца (4.1.1).
*Источник: `CLAUDE.md` («CI builds…», Rust 1.98.1)*

### 14.2 Кеш и прогоны CI

#### 14.2.1 Изменчивое — вне ключа кеша дорогих шагов
**Правило.** Ключ кеша SPM строить от того, что реально определяет пакеты: resolved-файла или блока `packages`. Номер
сборки на релизе подставлять параметром `xcodebuild`, а не правкой `project.yml`.
**Почему.** У Telegram номер сборки меняется каждый конвейер. Вшитый в шаг компиляции, он перезапускал бы его каждый
раз (~4 мин). Поэтому версию подставляют отдельным дешёвым шагом и проверяют, что ключ компиляции не изменился.
**Сейчас у нас.** соблюдено (#499): ключ кеша SPM — только блок `packages` из `project.yml`.
**Применимость.** частично: раздельной компиляции Bazel у нас нет, переносится принцип ключа кеша.
*Источник: `Telegram/CLAUDE.md` («Keep the version out of the compile action; that is the split's whole value»)*

#### 14.2.2 Подписанное не кешировать между машинами
**Правило.** Подписанное (сборка `xtool` с личным Apple ID, архив `ios-release.yml`) не класть в `actions/cache`.
Кешировать только входы: пакеты и DerivedData без подписи. `CODE_SIGNING_ALLOWED=NO` в `scripts/test.sh:122` уже это
обеспечивает.
**Почему.** Шаг подписи зависит от машинного пути профиля, а содержимое профиля не входит во входы кеша. Общий кеш
отдал бы неверно подписанные бандлы. И наоборот: то, что можно кешировать, без нужды не помечают «только локально».
**Применимость.** частично: удалённого кеша сборки у нас нет, есть только `actions/cache`.
*Источник: `Telegram/CLAUDE.md` («The patch+sign action does keep local + no-remote, deliberately…»)*

#### 14.2.3 Длинный прогон не запускать параллельно с пушами в ту же ветку
**Правило.** Ручной или ночной прогон с длинными наборами (`perf`, `ui-extended`) не запускать одновременно с пушами в
ту же ветку: его отменят. Учитывать это при `scripts/ci-results.sh --wait`.
**Почему.** У Telegram вторая сборка на хосте встаёт в очередь (`flock`, `--waitForLock`), а не падает.
**Сейчас у нас.** `ios.yml:37-39` — `concurrency: group: ios-${{ github.ref }}-${{ github.event_name }},
cancel-in-progress: true`. Новый пуш в ту же ветку отменяет идущий прогон. Для PR это нормально.
**Применимость.** частично: своих машин у нас нет, раннеры GitHub; переносится учёт отмен.
*Источник: `build-system/Make/CLAUDE.md` («CI builds in tart VMs»)*

#### 14.2.4 Сначала подтвердить диагноз, потом делать вывод
**Правило.** Если CI-шаг медленный или упал (кеш SPM, `brew install`, симулятор), сначала прямо подтвердить
гипотезу: время шага в логе, `cache-hit`, наличие сети. Только потом делать вывод. Не писать «раннер тормозит», не
посмотрев, что именно ждало.
**Почему.** У Telegram лог, полный `DEADLINE_EXCEEDED`, выглядел как недоступность кеша. Настоящей причиной была
загрузка без суммы по медленному каналу. Гипотезу проверили прямым запросом к кешу (`curl …/status`).
*Источник: `build-system/Make/CLAUDE.md` («Every external download must carry a checksum»)*

#### 14.2.5 Тихие настройки сборки проверять по результату
**Правило.** То, что ломается молча, проверять по результату сборки (CI «iOS — итог», `scripts/xcresult_summary.py`),
а не чтением конфигов. Сюда относятся флаги `-Xlinker -platform_version` в `Package.swift:37`, `SWIFT_*` в
`project.yml`, наличие или отсутствие Sentry в двух системах сборки.
**Почему.** Некоторые ошибки в настройках не дают ошибки сборки. У Telegram это дубли std и криптография без
аппаратного ускорения (~15× медленнее). Их ловит отдельный скрипт `verify-ios-link.sh` по готовому бинарнику.
**Применимость.** частично: своего бинарного аудита у нас нет.
*Источник: «No `-Clto`…», «Hardware crypto is re-applied by hand…», `verify-ios-link.sh`*

### 14.3 Сторонний код и лицензии

#### 14.3.1 Код Telegram не копировать; перенесённый код — с лицензией в заголовке
**Правило.** Из Telegram-iOS переносим только идеи и правила, не код: исходники Telegram-iOS под GPL v2, и копирование
кода обяжет открыть приложение (`apps/ios/README.md`, «Чего в этом репозитории не бывает»). Код из открытых библиотек
с совместимой лицензией (MIT, Apache) переносить с заголовком об источнике и лицензии. Новая библиотека — только с
согласия владельца.
**Почему.** У Telegram заголовок перенесённого файла (порт hls.js, Apache 2.0) — единственная запись о лицензии.
*Источник: `docs/native-hls-player.md` («Licence»)*

#### 14.3.2 Чужой код не патчить; если пришлось — только добавочным «швом»
**Правило.** SPM-зависимости (GRDB, socket.io-client-swift, Sentry) не патчить и не форкать. Если форк станет
неизбежен, допустима только добавочная точка входа, выключенная по умолчанию. Её помечать комментарием
`// STUDENTHUB SEAM (<кто пользуется>)` и записывать в README и в историю, объяснив, почему это не поведенческий
патч. При обновлении такую точку переносить или убирать, как только у апстрима появится эквивалент. Иногда лучше
скопировать один класс с маленькой правкой, чем патчить библиотеку.
**Почему.** У Telegram вендорный SQLite не правится руками: предупреждения глушат флагами. В форке WebRTC разрешены
только помеченные швы `TGCALLS SEAM (<consumer>)`, поведенческие патчи запрещены и записаны в историю, чтобы их не
вернули. Пример — `CustomDcSctpSocket`: копия класса с правкой в 6 строк вместо патча.
**Применимость.** частично: форков у нас нет.
*Источник: `sqlcipher/CLAUDE.md` («Keep the amalgamation pristine»); `TgVoipWebrtc/CLAUDE.md` («Vendored webrtc seams for
tgcalls (no behaviour patches)»)*

#### 14.3.3 Вендоренный код — с `VENDOR.md`: происхождение и нумерованные правки
**Правило.** Сторонний код в `apps/ios` не вендорим, только SPM. Если придётся форкнуть пакет или скопировать
исходник, рядом положить `VENDOR.md`: источник, версия или коммит, лицензия, пронумерованные локальные правки. Каждая
правка — со ссылкой на код и тестом, который падал до неё. Пересинхронизация: скопировать заново, применить правки
по списку, прогнать оба набора тестов. Код из Telegram-iOS — никогда (§14.3.1).
**Почему.** У Telegram у каждой чужой копии записано, откуда она, какой коммит и что изменено. Иначе после обновления
нельзя понять, какие правки потерялись.
**Применимость.** частично: вендоренного кода у нас нет.
*Источник: `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` («Every local edit is numbered in VENDOR.md»); P (Task 1–2, 5: `VENDOR.md`,
`PROVENANCE.md`); R («The fork keeps its discipline»)*

#### 14.3.4 При обновлении библиотеки сверять поведение с прежней версией
**Правило.** Обновляя SPM-пакет, читать changelog между версиями и сравнивать то поведение, которым пользуемся:
миграции GRDB, переподключение socket.io. Одного «собралось» мало.
**Почему.** У Telegram состав компонентов FFmpeg сверяют контрольным сравнением с уходящей версией: часть флагов
оказалась инертной всегда, хотя grep по `configure` их находил.
**Применимость.** частично: вендорного C-кода у нас нет.
*Источник: `ffmpeg/CLAUDE.md` («Don't validate configure component names by grepping `configure`»)*

#### 14.3.5 Свой обход бага поверх библиотеки закреплять тестом
**Правило.** Если в ответ на баг что-то обходится поверх библиотеки (GRDB, Socket.IO), закрепить обход тестом.
Иначе обновление пакета его молча сотрёт. Не заменять свой обход «обновлением сверху», пока не проверено, что апстрим
закрыл ту же проблему.
**Почему.** У Telegram апстрим libprisma шёл без ограничения и с той же грамматикой: обновление вернуло бы
уязвимость. Ограничение закреплено тестом на реальном файле грамматик.
**Применимость.** частично: таких обходов у нас пока нет.
*Источник: `third-party/libprisma/CLAUDE.md` («Don't pull upstream… as a substitute for the cap»)*

#### 14.3.6 Нижняя граница SQLite — с исправлением порчи при сбросе WAL
**Правило.** SQLite у нас системный (GRDB без SQLCipher), его версию задаёт iOS. Если появится расширение или второй
процесс, пишущий в ту же базу, минимальная версия SQLite с исправлением порчи WAL (3.51.3+) станет обязательным
условием. Его надо проверить и записать.
**Почему.** Telegram держит SQLite ≥ 3.51.3: там исправлена порча WAL при записи в одну базу двумя процессами.
**Сейчас у нас.** процесс один, но `DatabasePool` держит несколько соединений. Затрагивает ли ошибка соединения
одного процесса, не проверено.
**Применимость.** частично: второго процесса у нас нет.
*Источник: `sqlcipher/CLAUDE.md` («Keep SQLite at 3.51.3 or later: it carries the WAL-reset corruption fix»)*

### 14.4 Автоматические стражи и сгенерированное

#### 14.4.1 Страж со списком исключений, который только сокращается
**Правило.** Для каждого долгого перевода кода заводить скрипт-проверку со списком исключений, который только
уменьшается: `apps/ios/scripts/check_<что>.py` и `scripts/<что>-allowlist.txt`, запуск в CI «iOS — итог». Ошибкой
считается и новый нарушитель вне списка, и устаревшая запись: файл в списке больше не нарушает. Освобождённые файлы
удалять из списка в том же коммите. Добавление в список — осознанное исключение на ревью. У самого стража должны быть
тесты. Кандидаты:
- `import GRDB` только в `Core/` плюс разрешённые (сейчас он есть ещё в `Features/Chats/*`, `Features/Study/…`,
  `Features/Settings/…` — это стартовый список);
- `UIScreen.main` и `import UIKit` в `Core/` не растут;
- `UIApplication.shared.open`/`Link` только через единый открыватель;
- `URLSession` только в разрешённых файлах;
- `APIClient(authorization:` только в `App/AppServices.swift` (сейчас ещё `Core/Session/*API.swift` и
  `Core/Version/ClientVersionAPI.swift` — стартовый список);
- экраны переходят на `RemoteValue`.

Временные игноры аудита тоже должны только убывать. Новый скрипт и CI-шаг — с согласия владельца.
**Почему.** У Telegram `PostboxImportCheck.py` перед каждой сборкой валит её, если файл вне списка импортирует Postbox
или файл из списка больше не импортирует. То же для `.postbox`. Без автомата список растёт незаметно.
**Сейчас у нас.** решение владельца: стражей нет.
**Применимость.** частично: инструмента нет, принцип применим.
*Источник: корневой `CLAUDE.md` («Postbox → TelegramEngine», правило 12: «The guard only shrinks…»); «Wave 439 (W2): the
guard», «Wave P1: the `.postbox` access guard»*

#### 14.4.2 Страж читает код, а не текст; известные дыры записаны
**Правило.** Grep-стражи по Swift пропускают комментарии (включая вложенные `/* */`) и строки (включая многострочные
`"""`). Код внутри интерполяции `\(…)` при этом учитывается. Что не поддержано (сырые строки `#"…"#`,
regex-литералы), записать в шапке скрипта.
**Почему.** У Telegram `strip_comments_and_strings` стирает комментарии и строковые литералы, но сохраняет код внутри
интерполяции. Известные дыры стража названы явно.
*Источник: «Detection. `strip_comments_and_strings`…»; «Known guard gaps: … raw strings… or regex literals»*

#### 14.4.3 Сгенерированное и парное — одним коммитом, генерация скриптом
**Правило.** Сгенерированные артефакты руками не править. Перегенерировать скриптом целиком, в том же коммите, что и
источник. Связанные файлы меняются вместе:
- `Resources/Localizable.xcstrings` и Android-строки (`apps/android/scripts/import_ios_strings.py`, CI сверяет);
- новый эндпоинт и `apps/api/openapi.json`;
- `project.yml` и `Package.swift` (§14.1.3);
- DTO и mock-фикстуры UI-тестов.
**Почему.** Части, сгенерированные разными прогонами, молча расходятся. У Telegram это смещения в памяти и тихая порча.
Байткод `.qbc` от другой сборки отвергается, поэтому исходник и байткод копируются одним шагом.
*Источник: `TelegramApi/CLAUDE.md` («Only ever regenerate all three directories together…»; «Nothing generated is checked
in»); P (Task 7 Step 1: «Each `.js` is copied together with its `.qbc`»; Task 1 VENDOR)*

### 14.5 Выключатели рискованного

#### 14.5.1 Рискованная функция — с выключателем: локальным сейчас, удалённым по согласию
**Правило.** Рискованную новую функцию (медиа, полный Markdown в пузыре, превью ссылок) держать за выключателем в
`App/PerformanceFlags.swift`, в тестах — через `SH_PERF_FLAGS`. Решение принимать чистой функцией с юнит-тестом.
Независимые части (например, лента и чаты) выключать раздельно. Удалённый выключатель через конфиг с сервера
(например, рядом с `UpdateGate`) — с запасным видом, значение читать один раз на получение конфига, при переключении
перераскладывать открытые экраны. Это новая часть контракта API, только с согласия владельца.
**Почему.** У Telegram новое включено по умолчанию, но выключается ключом app-config `ios_killswitch_disable_*` (само
присутствие ключа = старый путь) и пунктом в Debug Settings. Решение принимает чистая функция
`…Enabled(legacyOverride:killswitchPresent:)` с тестом. Дорогой геттер читается один раз на конфигурацию.
**Сейчас у нас.** решение владельца: `PerformanceFlags` — константы сборки, откатить можно только выпуском;
удалённого выключателя нет.
**Применимость.** частично: удалённой конфигурации флагов нет.
*Источник: `MediaPickerUI/CLAUDE.md` («Routing»); `docs/superpowers/specs/2026-10-27-media-picker-grid-stage2-design.md`
(Decisions/Killswitch); `PeerInfoVisualMediaPaneNode/CLAUDE.md`; `MediaEditor/CLAUDE.md` («Turning it off»);
`submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` (вступление: `ios_killswitch_disable_message_widgets`)*

### 14.6 Неприменимо к нам
- Сборка и особенности SQLCipher (генерация амальгамы, `#error` без нужных `-D`, `PRAGMA cipher_memory_security`,
  `PRAGMA key` после расшифровки, `cipher_plaintext_header_size`, проверка `clang -fsyntax-only`) — SQLCipher у нас нет.
  Шифрование базы — новая зависимость, только с согласия владельца. Быстрая проверка у нас — `swiftc -typecheck`
  против собранного модуля.
- Без Swift concurrency в общем ядре (TelegramCore делится с Telegram-Mac под macOS 10.13) — ядро у нас не делится,
  минимальная iOS 17, async/await и акторы — основа.
- Неэкспортируемые символы TelegramApi, MRC, запрет внешних ссылочных типов вместо `TLObject`, неспециализированная
  `tlFunction`, 24-байтный заголовок — у нас один Swift-модуль, без ObjC/C-слоя, MRC и списков экспорта.

---
## §15. Документация, процесс, работа агентов

Как вести знания о коде, как работать с git, сборками и агентами, как рефакторить и как отчитываться. Главная мысль:
каждое утверждение в отчёте подкреплено командой или замером, а непроверенное названо прямо; решения владельца
записаны и не переоткрываются. Процессные правила репозитория — корневой `AGENTS.md` (коммиты по-русски, проверки
только по просьбе, стоп-точки, без следов агента); где практика Telegram с ним расходится, правило ниже написано по
`AGENTS.md`, а расхождение помечено «согласовать с AGENTS.md».

### 15.1 Где живут правила и знания

#### 15.1.1 Общее — в корневом документе, тонкое о подсистеме — рядом с её кодом
**Правило.** Корень правил iOS — `docs/IOS_RULES.md` и `apps/ios/README.md`. Тонкие инварианты подсистемы держи рядом
с кодом: шапки-комментарии файлов (как в `SessionStore.swift`, `MessageTimeline.swift`, `PerformanceFlags.swift`), а
если заметок набирается на страницу — `AGENTS.md`/`CLAUDE.md` в каталоге подсистемы (например,
`Sources/Features/Chats/Thread/`). Новые заметки подсистемы — туда, не в корень.
**Почему.** У Telegram корень держит то, что действует везде, а `CLAUDE.md` подсистемы подгружается при чтении файлов её
каталога — правило оказывается там, где его нарушат.
**Применимость.** частично — вложенных гайдов у нас пока нет; переносится принцип размещения.
*Источник: `CLAUDE.md` (вводный абзац; Subsystem guides)*

#### 15.1.2 Перед правкой подсистемы — прочитать её шапку и заметки
**Правило.** Перед правкой ленты читай шапки `MessageListView.swift`, `MessageTimeline.swift`, `PerformanceFlags.swift`;
сессии — `SessionStore.swift` и §10.1; realtime — `RealtimeCoordinator.swift`; поля ввода — `Composer/ComposerFormatting.swift`;
а также записи памяти владельца по iOS-эпикам.
**Почему.** У Telegram гайд подсистемы грузится сам, но при планировании правки извне его читают первым.
*Источник: `CLAUDE.md` (Subsystem guides, вводный абзац)*

#### 15.1.3 Записка подсистемы — карта текущего контракта
**Правило.** Для сложных подсистем (лента чата, outbox, realtime, карточки) держи раздел в `docs/IOS_RULES.md` или
`apps/ios/README.md`: карта файлов, инварианты, которые не ловит компилятор, лимиты, и в конце каждого раздела — список
«прочитать перед правкой». Для ленты: `MessageListView.swift` (комментарии к `apply`, `viewDidLayoutSubviews`),
`MessageListGlide.swift`, `MessageStackGeometry.swift` + `MessageStackGeometryTests`, `PerformanceFlags.swift`,
`PERFORMANCE_AUDIT.md`. Записка — текущий контракт, а не история: устаревшее удаляй, «было/стало» не копи; планы лежат
отдельно и действующими правилами не считаются.
**Почему.** У Telegram такой файл — карта, а не замена исходникам; история остаётся в git, вытесненное не хранится.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (How to use this file; Documentation authority);
`docs/message-widgets-native-runtime.md` (вступление, «Where things are», «Invariants»)*

#### 15.1.4 Короткий список «что кусается сильнее всего»
**Правило.** Для чата и пузыря держи в `docs/IOS_RULES.md` короткий список самых опасных инвариантов со ссылками на
файлы: `metaPlaceholder` ↔ `meta()`, ключ высот, два разбора ```` ``` ```` (`MessageCodeBlocks`), `RichText` без цвета
темы.
**Почему.** Локальный гайд Telegram — указатель на полный документ плюс десяток инвариантов, о которые спотыкаются
чаще всего.
*Источник: `submodules/InstantPageUI/CLAUDE.md` («The ones that bite hardest»)*

#### 15.1.5 Живая карта синхронизации; инвариант записан полностью
**Правило.** Заведи раздел синхронизации (в `docs/IOS_RULES.md` или отдельный документ — решает владелец): входы данных,
позиции (`lastSeq`, `sinceTs`), пути догона (`GET /chats/:id/updates`), инварианты, цена, открытые проблемы. Правка
синхронизации обновляет его в том же коммите. Каждый инвариант: правило; зачем; где обеспечено; что его держит (тест
или честно «тестом не закреплено»). Открытые проблемы — с id и местом в коде, исправленные — отдельно. Датированный
аудит — отдельный документ, не карта.
**Почему.** У Telegram карта описывает код как он есть и правится вместе с ним; иначе она врёт уже через неделю.
**Сейчас у нас.** карта — отдельный документ [`docs/IOS_SYNC_MAP.md`](IOS_SYNC_MAP.md) (решение владельца). Правило:
правка синхронизации (`RealtimeCoordinator`, `MessageStore`, `ChatStore`, `OutboxService`, `MessageOutbox`,
`SyncPosition`, догон и страницы `ChatThreadModel`, выход и `SessionStore.restore`) обновляет карту в том же коммите.
*Источник: `submodules/TelegramCore/Sources/State/CLAUDE.md` (карта и аудит); `docs/state-sync.md` (вводная, «Pointers»,
«Invariants», «Open issues», «Fixed»)*

#### 15.1.6 Известные ограничения и открытые проблемы записаны
**Правило.** Каждое известное ограничение — с причиной и тем, что нужно для починки — пиши в `apps/ios/README.md`, в
раздел «Открыто» документа правил или в комментарий у кода, а не держи в голове. Примеры: поле ввода без счётчика,
markdown-маркеры видны в поле, нет автопродолжения списков, история отмены теряется при развороте редактора; iOS-пузырь
не рисует заголовки/списки/таблицы/формулы, которые рисует веб; `@упоминания` не нажимаются.
**Почему.** У Telegram каждое принятое ограничение и неудачное имя записаны в справочнике, а не только в задачах.
*Источник: `docs/richtext-composer.md` (§8 «Accepted limitations & deferred work»); `submodules/InstantPageUI/CLAUDE.md`
(«Open: …»)*

#### 15.1.7 Ограничение записывается с соседним путём, где оно уже есть
**Правило.** Известную потерю записывай с указанием, где она уже наблюдается так же (например, «правка теряет X — как и
обычные сообщения»).
**Почему.** У Telegram потеря формата даты при правке записана вместе с тем, что обычные сообщения теряют его так же, —
это сразу отвечает, баг ли это нового кода.
*Источник: `docs/instantpage-richtext.md` (Inline custom emoji: «Known limitation…»)*

#### 15.1.8 Неочевидный, но несущий нагрузку код помечен «почему»
**Правило.** «Странные» места (`httpCookieStorage = nil`, порядок записей в `adopt`, `purgeSystemStorage` на каждом
запуске, задержка повтора продления) и сознательные исключения из общего правила (экран, нарочно не следующий Dynamic
Type или общему стилю; моноширинный код статьи меньше тела) несут комментарий с причиной на месте, как в
`MessageCodeBlocks.swift`. Правя рядом, не убирай такое без замены доказательства.
**Почему.** У Telegram неочевидное решение сопровождается запретом «упрощать» и причиной, иначе его «починят».
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («Do not "clean this up"…»); `CLAUDE.md` (`composeSoftLightOverBackground`:
«The function comment says so; keep it»); `docs/instantpage-richtext.md` (Text Size: «Two layoutInstantPageV2 callers
stay at 1.0 on purpose»)*

#### 15.1.9 Расхождения с образцом — списком, с причиной
**Правило.** Перенося приём из Telegram, веба или Android, пиши в комментарии, где сделано иначе и почему (как
`MessageListGlide` — «без отскока»); подозрительное место образца не воспроизводи молча. Отличия iOS от веба/Android и
от контракта держи списком в документе, по строке с причиной; найденные расхождения документации API — отдельным пунктом
в отчёте человеку.
**Почему.** Telegram у себя сделал симметричной асимметричную границу из `ListViewImpl`, похожую на опечатку, и записал
«осознанное расхождение»; все отличия от эталона перечислены.
*Источник: `docs/chat/corelist-chat-history-backend.md` (`immediateDisplayedItemRange()`, Deliberate divergences);
`docs/message-widgets-native-runtime.md` («Divergences», «What still differs»); `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md`
(§8)*

#### 15.1.10 Источник истины — файл или команда; числа пересчитываются
**Правило.** Не держи в документах ручных перечней того, что получается командой (экраны на `RemoteValue`, флаги,
число тестов), — дай команду. Счётчик в README/отчёте — с командой, которой он получен; при обновлении заменяй, а не
дописывай рядом. Устаревший раздел помечай «устарело с …, источник истины — …».
**Почему.** У Telegram ручной список устарел за сотни волн, а строка документа одновременно держала три «текущих»
значения.
*Источник: `docs/superpowers/richtext-seam-stage2-inheritance.md` (D27: «REGENERATE, do not copy»);
`docs/superpowers/postbox-refactor-log.md` («Stale since wave 105…», «Regenerate with…»)*

#### 15.1.11 Удаляя понятие — обновить все места, где оно названо
**Правило.** Выпиливая механизм (флаг `PerformanceFlags`, эндпоинт, вид карточки), grep'ом пройди `apps/ios`, `docs/`,
README и память агента; порядок удаления выбирай так, чтобы каждый локальный коммит оставался собираемым.
**Почему.** Telegram, удаляя механизм, правит гид, запись рантайма, харнесс, корневой `CLAUDE.md` и заметки памяти, и
требует, чтобы каждый коммит собирался.
**Применимость.** согласовать с AGENTS.md: сборку агент сам не запускает — «собираемость» каждого коммита закладывается
порядком правок, а проверяется сборкой только по просьбе человека.
*Источник: `docs/superpowers/specs/2026-10-29-message-widgets-cpu-clock-limits-design.md` («Docs», «Left to the
builder»)*

#### 15.1.12 Сгенерированное руками не правят
**Правило.** Не правь вручную: `StudentHub.xcodeproj` (из `project.yml`, не коммитится), Android-строки (из
`Localizable.xcstrings` скриптом `apps/android/scripts/import_ios_strings.py`, CI сверяет), `.device/` (пересобирает
`device.sh`), `apps/api/openapi.json`. Правится источник, затем генерация.
**Почему.** У Telegram встроенное watch-приложение — снимок другого репозитория: правят источник и пересинхронизируют
скриптом.
*Источник: `CLAUDE.md` (Subsystem guides: WatchApp); `Telegram/CLAUDE.md` («Embedded watch app»)*

#### 15.1.13 Где что лежит
**Правило.** `Sources/App` — вход, оболочка, флаги, режим UI-тестов; `Sources/Core` — сеть, сессия, база, чаты,
realtime, пуши, навигация; `Sources/Features` — экраны; `Sources/DesignSystem` — токены и контролы; дальше `Resources`,
`Config`, `Tests/*`, `scripts/` (README, «Структура»). Внешнего кода в дереве нет — только SPM.
**Почему.** У Telegram структура описана в корневом гайде, чтобы новая правка не гадала, куда класть код.
*Источник: `CLAUDE.md` («Project Structure»)*

#### 15.1.14 Стиль: имена и импорты
**Правило.** PascalCase для типов, camelCase для переменных и методов. Импорты — вверху файла: системные (`Foundation`,
`UIKit`, `SwiftUI`), затем сторонние (`GRDB`, `SocketIO`), условный `#if canImport(Sentry)` — как в `Observability.swift`.
**Почему.** Единый стиль — часть правил Telegram, о которые спотыкается любая правка.
**Сейчас у нас.** соблюдено.
*Источник: `CLAUDE.md` (Code Style Guidelines: Naming, Imports, Formatting)*

#### 15.1.15 Строгие типы и комментарии «почему» по-русски
**Правило.** Состояния и коды — перечисления, а не строки (`APIErrorCode` с `.unknown(raw)`); `///`-комментарии
по-русски на типах и неочевидных функциях объясняют «почему», а не «что» (стиль `MessageTimeline`, `SessionStore`).
**Почему.** Telegram предпочитает строгую типизацию и документирует публичные API.
*Источник: `CLAUDE.md` (Code Style Guidelines: Types, Documentation)*

### 15.2 Git и границы задачи

#### 15.2.1 Своя ветка от develop
**Правило.** Агент работает в своей ветке от `develop` (`feat/…`, `fix/…`, `refactor/…`, `chore/…`); `develop` и `main`
напрямую не трогает. Worktree агента (`isolation: worktree`) стартует от `origin/main` — ветку от `develop` указывай
явно.
**Почему.** У Telegram проект ведётся в отдельном worktree, основная копия не трогается.
*Источник: `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§3)*

#### 15.2.2 Коммиты локально по шагам, влитие в локальный `develop`; push и PR — только по просьбе
**Правило.** Коммить каждый завершённый шаг локально. Закончив задачу, влей рабочую ветку в ЛОКАЛЬНЫЙ `develop`
(`git merge --no-ff <ветка>`; при конфликте — остановиться и показать человеку). `git push`, PR и любые действия с
удалённым `develop`/`main` — только когда человек прямо попросил. Никаких `git reset --hard`, `git checkout -- <файл>`,
`git restore` поверх незакоммиченных изменений.
**Почему.** У Telegram: коммит после каждой задачи, никогда не пушить, в конце предложить «влить в локальный master»
или «оставить ветку»; чужую незакоммиченную работу не трогать. У нас владелец решил вливать в локальный `develop`
всегда (готовое копится в одном месте, публикацию решает он).
**Применимость.** частично — вместо «предложить влить» у нас влитие в локальный `develop` по постоянному решению
владельца от 02.11.2026; оно снимает стоп-точку 6 AGENTS.md только для локального `develop`.
*Источник: `docs/superpowers/plans/2026-09-25-reserved-corners.md` (Global Constraints); `docs/superpowers/2026-10-14-navbar-transitions-handoff.md`
(Ground rules); `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md`, `…/2026-10-26-message-widgets-v0.2-design.md`
(§6 Process)*

#### 15.2.3 В коммит — только свои файлы, явными путями, после сверки с HEAD
**Правило.** Перед волной — `git status --short`: чужие правки (сейчас в корне лежат запись экрана и
`telegram-ios-rules/`) не коммить и не удаляй; места в файлах с чужими правками отложи и запиши. Перед `git add` смотри
`git diff <файл>`; индексируй только `git add <файлы>` (никогда `-A`, `.`, `commit -a`); проверяй
`git diff --cached --stat`. Ошибки сборки вне списка файлов волны — не твои, но и полной проверки типов волны они не
дают: так и пиши.
**Почему.** У Telegram владелец правит ту же рабочую копию одновременно; чужой WIP маскирует статус сборки волны.
*Источник: `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (Project conventions); `docs/superpowers/plans/2026-10-27-media-picker-grid-stage2.md`,
`…/2026-10-28-shared-media-grid-stage1.md` (Global Constraints); `docs/superpowers/postbox-refactor-log.md` («WIP
interference check…», «never use bulk-stage commands»)*

#### 15.2.4 Один пишущий в рабочей копии
**Правило.** В одной рабочей копии — один агент-исполнитель; параллельные ревьюеры читают зафиксированное
(`git show <коммит>:<путь>`), а не рабочее дерево.
**Почему.** У Telegram ревью воспроизводили каждый коммит байт в байт — это возможно, только если читают коммиты.
*Источник: `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§7)*

#### 15.2.5 Параллельные ветки: общие файлы назвать заранее
**Правило.** При параллельных ветках или агентах по iOS заранее назови общие файлы (`Localizable.xcstrings`,
`project.yml`, README, `RealtimeCoordinator.swift`) и кто вливается первым.
**Почему.** У Telegram код параллельных работ не пересекался, а доки конфликтовали — это отметили заранее вместе с
порядком перебазирования.
*Источник: `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§6 «Coordination»)*

#### 15.2.6 Хеши в документах переживают переписывание истории
**Правило.** История уже переписывалась (23.09.2026, все хеши сменились): хеши в документах давай только с архивным
тегом `archive/*`, иначе ссылайся на PR. Слияние с разрешёнными конфликтами проверяй `git show --remerge-diff`.
**Почему.** У Telegram после сжатия ветки старые хеши живут на сохранённой ветке, а слияние вместо перебазирования
сохраняет хеши, которые цитируют доки.
*Источник: `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (Commit SHAs…; §6d)*

#### 15.2.7 Нельзя без нарушения — остановиться, а не подменить задачу
**Правило.** Если задачу можно сделать, только выйдя за её границы (чужой модуль, новая зависимость, контракт API) или
нарушив правило, — остановись, запиши причину и спроси владельца (стоп-точки `AGENTS.md`). Похожую соседнюю задачу на
ходу не подставляй. Волну, чистый эффект которой хуже обещанного, откати (своими локальными коммитами, без потери
работы) и запиши в журнал «брошено: причина».
**Почему.** У Telegram такая задача помечается «Abandoned» с причиной; брошенная волна 103 стоила бы +74 новых моста —
её откатили и записали урок.
*Источник: `CLAUDE.md` (Postbox → TelegramEngine, правило 5); `docs/superpowers/postbox-refactor-log.md` («Wave 103
outcome: ABANDONED…»)*

#### 15.2.8 Нужное изменение контракта — стоп-точка
**Правило.** Смена DTO, формата ответа, общих схем (`packages/shared-schemas`) ради экрана iOS — не удобство задачи, а
стоп-точка `AGENTS.md`: спроси человека; при согласии обнови `docs/PROJECT.md`.
**Почему.** У Telegram расширять общий протокол ради этапа нельзя: если он нужен, меняется контракт — явно и
решением.
*Источник: `docs/superpowers/richtext-seam-stage2-inheritance.md` (вступление, D36)*

### 15.3 Сборки, проверки, устройство и агенты

#### 15.3.1 Сборки и тесты — только по просьбе человека, ведёт основной агент
**Правило.** `xtool dev build`, `swiftc -typecheck`, `scripts/test.sh`, ожидание CI — только по прямой просьбе
человека или при подготовке коммита/PR, который он попросил. Подагент сборку не запускает (тем более в фоне): он пишет
код и отчитывается; сборку и её код выхода читает основной агент.
**Почему.** У Telegram фоновую сборку подагента рвут при его возврате, поэтому сборки и тесты гоняет только управляющая
сессия.
**Применимость.** согласовать с AGENTS.md: Telegram предполагает, что управляющая сессия собирает сама после каждого
шага; у нас и она собирает только по просьбе («Проверки и сборка — только по команде человека»).
*Источник: `Tests/ComposerHarness/CLAUDE.md` («If you are a dispatched subagent»); `docs/superpowers/plans/2026-10-13-message-widgets.md`
(Global Constraints)*

#### 15.3.2 Успех — по коду выхода самой команды
**Правило.** Запуская сборку или тесты, суди по коду выхода самой команды: пайп `| tee | grep` его теряет (в
`scripts/test.sh` правильно взят `PIPESTATUS[0]`), `; echo $?` не дописывай; успех по последней строке вывода не
объявляй.
**Почему.** У Telegram полную сборку запускают из управляющей сессии и читают её собственный статус.
*Источник: `docs/superpowers/plans/2026-09-25-reserved-corners.md` (Global Constraints)*

#### 15.3.3 «Запущено на iPhone» — только после проверки
**Правило.** После `./scripts/device.sh` пиши «установлено и запущено на iPhone», только если `xtool dev` дошёл до
запуска без ошибки; остановилось на шаге «Доверять», «Режим разработчика», «Ненадёжный разработчик» (README) — назови
шаг. Что приложение видно на экране, подтверждает владелец.
**Почему.** У Telegram сначала все сборки и тесты, запуск — последним; «запущено» пишут, только проверив, что процесс
жив и что симулятор показывает именно его, иначе называют точную проблему.
*Источник: `submodules/TelegramUI/Components/CoreList/AGENTS.md` (третий абзац)*

#### 15.3.4 На iPhone ставит владелец или агент по его просьбе
**Правило.** Ставить сборку на iPhone владельца (`scripts/device.sh`) — только когда он подключил телефон и согласен;
сервер (Railway или `--local`) выбирает владелец.
**Почему.** У Telegram агент сам на симулятор не ставит и перед проверкой спрашивает, какой симулятор можно занять.
**Применимость.** согласовать с AGENTS.md: `device.sh` собирает приложение — это сборка, она только по просьбе.
*Источник: `docs/superpowers/plans/2026-09-25-reserved-corners.md` (Global Constraints); `docs/superpowers/plans/2026-10-27-media-picker-grid-stage2.md`
(Global Constraints, Task 3)*

#### 15.3.5 Живая учётка: что можно, чего нельзя, вернуть как было
**Правило.** На Railway и телефоне владельца сообщения — только в тестовый чат или себе; никаких заявок и документов от
имени реальных людей; изменённые для проверки настройки (язык, тема, 2FA) вернуть и записать, что и когда менял; выход
из аккаунта на телефоне владельца — только по его просьбе. Разлогиненные сценарии — на mock (UI-тесты), не на основной
учётке. См. также §10.7.1.
**Почему.** У Telegram на основной учётке писать можно одному тестовому контакту, покупки открывать, но не
подтверждать, а всё изменённое — вернуть и записать время.
*Источник: `docs/superpowers/specs/2026-10-27-voiceover-design.md` («Verification»); `docs/accessibility/voiceover-inventory.md`
(восстановленные настройки)*

#### 15.3.6 Агенты: не больше пяти, отчёт текстом, длинная оболочка — скриптом
**Правило.** Не больше пяти агентов на один запуск; отчёт агент возвращает текстом, а не файлом; многошаговую оболочку
кладёт в скрипт и запускает `bash <путь>`; при нехватке места кеши не удаляет; провал на исходном состоянии записывает,
а не чинит попутно.
**Почему.** У Telegram запись отчётов подагентами в файлы обычно отклонялась, диск однажды заполнился, а сборка падала
уже на исходной ветке.
*Источник: `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§2, §9)*

#### 15.3.7 Журнал длинной работы и восстановление после обрыва
**Правило.** У длинного эпика агентами — журнал (в scratchpad или памяти): каждое поручение, коммит, итог ревью и
решение в формате «что — почему — цена, если неверно». После обрыва верь журналу и `git status`/`git log`; задачу, у
которой уже есть коммит, повторно не запускай.
**Почему.** У Telegram агенты умирали посреди работы; продолжать можно было только по журналу и истории git.
*Источник: `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§7, §9)*

### 15.4 Рефакторинг и замены: эквивалентность и швы

#### 15.4.1 Рефакторинг не меняет поведения; зелёная сборка — не доказательство
**Правило.** При переводах вроде «экраны на `RemoteValue`», «окно наблюдения ленты» проверь по diff: `==` и идентичность
(`struct` → `class` меняет семантику копии и `===`), `Hashable` (перенастройка ячеек), разрешение перегрузок после
снятия импорта, значения по умолчанию, `[weak self]` и время жизни задач, первое значение, дубликаты, число и порядок
эмиссий наблюдения (`ValueObservation`, `AsyncStream`, `@Observable` — какие свойства теперь перерисовывают). В коммите
или описании PR — абзац «эквивалентность: как проверена».
**Почему.** У Telegram менять типы можно, поведение — нет; сборка зелёная и при сломанной идентичности, хешировании или
эмиссии сигналов (optional vs `.never()`).
*Источник: `CLAUDE.md` (Postbox → TelegramEngine, правило 9); `docs/superpowers/postbox-refactor-log.md`*

#### 15.4.2 Изменение поведения — отдельно от переноса; найденное по пути — доложить
**Правило.** «Вынести в утилиту»/`refactor(...)` коммитом не меняет поведения. Дефект или «улучшение», найденное
посреди рефакторинга, — в отчёт; чинится отдельным `fix(...)` коммитом с тестом, а не внутри переноса.
**Почему.** У Telegram этапы рефакторинга доказуемо эквивалентны, а изменение поведения, найденное в середине этапа,
записывается, а не делается.
**Применимость.** согласовать с AGENTS.md: «не рефактори чужие модули попутно» — найденное в чужом модуле только
докладывается.
*Источник: `docs/superpowers/richtext-seam-stage2-inheritance.md` (D27, D36, «Global Constraint 17»);
`docs/superpowers/richtext-stock-divergences-followups.md` («The distinction that decides all four»);
`docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§1, §2)*

#### 15.4.3 Перед новым помощником — поиск существующего
**Правило.** Перед новым помощником или обёрткой в `DesignSystem` или `Core` — grep по `DesignSystem/` (`Toolkit`,
`Rows`, `ActionRunner`, `RemoteContent`, `Glass`) и `Core/`; в отчёте или теле коммита строка «искал: <что>, нашёл:
<что>».
**Почему.** У Telegram новых обёрток без разрешения спецификации нет, а результат поиска эквивалента записывается в
коммит. У нас то же — правило владельца «брать shared UI, не изобретать своё».
*Источник: `CLAUDE.md` (Postbox → TelegramEngine, правила 3–4)*

#### 15.4.4 Переносишь вход — проверь четыре оси расхождения
**Правило.** Перенося логику (например, `send` → общая функция), сверь старый и новый путь по четырём осям: зажим или
отказ при выходе за границы; обработка `nil` и неверного ввода; какое хранилище читается (свежее или устаревший кеш);
какой объект владеет флагом или решением. Вывод — в описании коммита.
**Почему.** У Telegram аудит по одной оси объявил «расхождений нет» и ошибся.
*Источник: `docs/superpowers/richtext-seam-stage2-inheritance.md` (D27: «DIVERGENCE AUDIT … on FOUR axes»)*

#### 15.4.5 Проверка, которая не может сработать, — декоративна
**Правило.** `guard`/`assert` без сценария срабатывания (сравнение с собственной копией, проверка того, что уже
гарантирует тип) удали или перепиши на реальный источник; решение запиши в коммит.
**Почему.** У Telegram страж непрерывности ревизий сравнивал значение с самим собой и выглядел живым, не умея сработать.
*Источник: `docs/superpowers/richtext-seam-stage2-inheritance.md` (§1 «gate item 23», D38)*

#### 15.4.6 Крупная замена — за швом; старый путь дословный; выбор один раз
**Правило.** Крупную замену (сетка вложений на UIKit, новый плеер, новая раскладка ленты) делай как `PerformanceFlags`:
протокол или две ветки, старая — без изменения поведения, выбор читается один раз при создании экрана и не меняется,
пока он открыт; откат — одной строкой.
**Почему.** У Telegram экран говорит с сеткой только через протокол, у старой реализации каждый новый член равен
выражению, которое он заменил, выбор делается в `init`.
*Источник: `submodules/MediaPickerUI/CLAUDE.md` («Grid seam and MediaGrid v2»); `docs/superpowers/plans/2026-10-27-media-picker-grid-stage2.md`
(Global Constraints, Task 3); `submodules/TelegramUI/Components/PeerInfo/PeerInfoVisualMediaPaneNode/CLAUDE.md`*

#### 15.4.7 Новое поведение общего компонента — сначала в одной точке входа
**Правило.** Общий компонент (`MediaViewer`, `RemoteImage`, `RecentMediaGrid`) открывается из ленты, профиля, чата,
историй. Новую возможность включай параметром в одном месте (обычно чат), остальным вызовам — прежнее поведение по
умолчанию.
**Почему.** У Telegram масштабирование новой сетки включено только в листе вложений чата, остальные режимы получили её
без зума и с прежней геометрией.
*Источник: `submodules/MediaPickerUI/CLAUDE.md` (режимы `.chatAttachment`/`.story`/`.other`);
`docs/superpowers/specs/2026-10-27-media-picker-grid-stage2-design.md` («Scope of v1»)*

#### 15.4.8 Заготовка без вызова в проде закреплена тестом
**Правило.** Заготовки (выключенные флаги `PerformanceFlags`, неиспользуемые методы) помечай комментарием «нет вызова в
проде» и тестом или `XCTExpectFailure`, который покраснеет при подключении; при подключении тест удаляется, а не
обходится.
**Почему.** У Telegram шов без вызывающих закреплён тестом с указанием удалить его при подключении.
**Сейчас у нас.** соблюдено для кеша высот 2.5 (`Tests/StudentHubUITests/PerformanceFlagUITests.swift:33`).
*Источник: `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/InputBackend/CLAUDE.md` («The responder hand-off has no production caller»).
`submodules/TelegramUI/Components/RichTextEditor/` = `submodules/TelegramUI/Components/RichTextEditor/`*

#### 15.4.9 Выключенная функция компилируется: предикат, а не `#if`
**Правило.** Функции, зависящие от вуза, роли или сервера (библиотека, сторис, модули), выключай предикатом
(инжектируемый параметр, фича-флаг из ответа API), а не `#if`, чтобы код собирался и тесты закрепляли оба положения.
**Почему.** У Telegram вкладка новостей без API выключена параметром `apiIsAvailable`, код без `#if` компилируется и
тестируется.
*Источник: `submodules/TelegramUI/Components/News/CLAUDE.md` (Parked: News is off while the feed API is)*

#### 15.4.10 Половину функции, показывающую неработающее, не вливать
**Правило.** Карточка или кнопка, чей серверный путь не готов (миграция не применена на Railway, эндпоинта нет), не
вливается в `develop` видимой: либо под выключенным флагом, либо вместе с серверной частью.
**Почему.** У Telegram первую половину не влили отдельно: она показала бы элемент, все запросы которого падают.
*Источник: `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` (§5)*

#### 15.4.11 Правка общего — опись затронутых экранов
**Правило.** Правя общий компонент (`DesignSystem/*`, `MessageBubbleView`, стили тулбара), найди grep'ом все
использования и дай владельцу список экранов, чей вид меняется; для ключевых (чаты, лента) явный критерий — «как было».
**Почему.** У Telegram смена правила для всех экранов сопровождается grep'ом, снимками и таблицей; «Чаты выглядят как
прежде» — критерий регрессии.
*Источник: `docs/superpowers/specs/2026-10-15-navbar-split-right-buttons-design.md` (Testing, Results);
`docs/superpowers/plans/2026-10-15-navbar-split-right-buttons.md` (Task 6 Step 3)*

#### 15.4.12 «Мёртвый» код удаляй, проверив косвенные чтения
**Правило.** Перед удалением «неиспользуемого» проверь косвенные чтения: `Equatable`/`removeDuplicates`, `Codable` в
кеше экранов, столбцы GRDB, сравнения снимков ленты. Сохраняемое и публичное — не удалять без миграции.
**Почему.** У Telegram поле, которое никто не читал напрямую, участвовало в `isEmpty`; его удаление меняло, ставится ли
операция в очередь.
*Источник: `docs/state-sync-audit-2026-10.md` (§10)*

#### 15.4.13 Мёртвую ветку — убрать или записать кандидатом
**Правило.** Убирая последний вызов, который передавал параметр, убери параметр в том же PR или запиши в бэклог;
«инертные» аргументы без пометки не оставляй.
**Почему.** У Telegram ветка `flush == false` записана как мёртвая и кандидат на чистку.
*Источник: `docs/instantpage-richtext.md` (InstantPage V2 block media)*

### 15.5 Долгие переводы волнами

#### 15.5.1 Волна — один шаблон, атомарный коммит, запись в журнал
**Правило.** Долгие переводы (экраны на `RemoteValue`, итерации `PerformanceFlags`, будущий единый открыватель ссылок)
идут волнами: одна волна — один шаблон целиком, атомарный коммит в рабочей ветке; итог — в журнал отдельным коммитом:
что сделано, счётчики до/после, как проверена эквивалентность, что отложено и почему. Журналы iOS:
`apps/ios/MOTION_TESTING_REPORT.md`, `docs/IOS_IMPLEMENTATION_REPORT.md`, `docs/PERF_BASELINE.md`, `CHANGELOG-PERF.md`.
**Почему.** У Telegram волна меняет одно семейство мест целиком, а журнал рефакторинга дописывается каждой волной.
**Применимость.** согласовать с AGENTS.md: `docs/*` правятся только по просьбе владельца (кроме обязательного обновления
`docs/PROJECT.md` при смене контракта); без просьбы журнал волн ведётся в отчёте, scratchpad или памяти, а в `docs/` —
когда владелец попросил.
*Источник: `CLAUDE.md` (Postbox → TelegramEngine, правило 11); `docs/superpowers/postbox-refactor-log.md` («Where to pick
up»)*

#### 15.5.2 Инвентаризация — на этапе плана и снова при исполнении
**Правило.** Перед волной grep'ом по полному набору признаков, а не только по целевому имени: все конструкции и разборы
случаев enum, доступ к полям через любые имена переменных, внутренние вызовы соседних методов, неявные чтения через
`self`, функции ниже по течению, принимающие старый тип. Перечень мест — в плане; в начале исполнения — повтор; при
недосчёте — остановиться рано.
**Почему.** У Telegram план по узкому grep систематически недосчитывал места.
*Источник: `docs/superpowers/postbox-refactor-log.md` («Inventory at execution time…», «Enum-payload migrations need a
full case-site grep», «Plan-time inventory undercount…»)*

#### 15.5.3 Строка grep — не вывод о коде
**Правило.** Каждое найденное место классифицируй по 5–10 строкам вокруг (поле, локальная, параметр, захват). Прежде чем
писать «X задаётся только в …», проверь тип и владельца каждой находки (свойство модели vs параметр функции vs ключ
локализации) и замечай условия-константы, выключающие код целиком.
**Почему.** У Telegram одинаковая строка означала разные случаи; поле структуры и параметр с одним именем — два разных
поля, а блок под `!"".isEmpty` мёртв на обоих бэкендах.
*Источник: `docs/superpowers/postbox-refactor-log.md` («Shape-B/C classification requires read, not grep»);
`docs/chat/corelist-chat-history-backend.md` (Deferred items п. 2, п. 4)*

#### 15.5.4 Массовые правки — скриптом с утверждениями и сверкой diff
**Правило.** Массовую замену делай скриптом, который падает при неожиданном числе совпадений (одна замена на строку);
после — `git diff --numstat` против ожидаемого. `replace_all` — только после grep, что контекст везде одинаков. Следи,
чтобы вставка не попала внутрь `#if canImport(Sentry)`/`#if DEBUG`. Diff «1+/1−» без смысла — откатить.
**Почему.** У Telegram механическая правка проверяла себя сама; вставка импорта однажды попала внутрь `#if`, а скрипт
остановился на неверном номере строки.
*Источник: `docs/superpowers/postbox-refactor-log.md` («A script made the edits only on lines containing the call…»,
«Restore-script bug», «Spurious-diff cleanup step»)*

#### 15.5.5 Итерации сборки — в бюджете плана
**Правило.** На большую волну закладывай несколько итераций `xtool dev build`/`swiftc -typecheck`; собирай все ошибки
прохода, а не первую; итерация, вышедшая за список файлов волны, — стоп.
**Почему.** У Telegram недосчёт инвентаря добирался итерациями сборки (план — 5, исполнение — 18); сборка шла с
`--continueOnError`.
**Применимость.** согласовать с AGENTS.md: каждая итерация сборки — по просьбе человека; бюджет итераций обсуждается с
ним при утверждении плана.
*Источник: `docs/superpowers/postbox-refactor-log.md` («Build iteration = inventory completion…», «Deviation from plan»)*

#### 15.5.6 Нельзя перевести — отложить с причиной
**Правило.** В журнале волны — таблица «переведено / отложено (причина) / пропущено (внутри комментария)»; этап
завершён, когда каждое место в одной из колонок, а не когда «ничего не осталось».
**Почему.** У Telegram вызов, результат которого питает код старого типа, откладывается и записывается, а не
переводится силой.
*Источник: `docs/superpowers/postbox-refactor-log.md` («…deferred and recorded, not converted»)*

#### 15.5.7 Каждая волна записывает числа до и после
**Правило.** Прогресс волны — числа из скрипта-стража или команды (`--report`), в журнале «было → стало», а не
впечатление.
**Почему.** У Telegram каждая волна записывает показатели отчёта стража («access files 252 → 251»).
*Источник: `docs/superpowers/postbox-refactor-log.md` («`--report` prints the measures every wave records»)*

#### 15.5.8 Заметки о следующей волне — обязательный вход плана
**Правило.** Перед планированием волны прочитай журнал эпика, заметку памяти по нему и отложенные места прошлой волны.
**Почему.** У Telegram недочитанная заметка о кандидатах стоила лишней итерации.
*Источник: `docs/superpowers/postbox-refactor-log.md` («Treat the wave-N+1 candidate notes in memory as a load-bearing
input»)*

#### 15.5.9 Ограниченные волны дешевле миграции типа
**Правило.** Для ровного прогресса выбирай волны «заменить вызов X на Y» (ограниченные); смену типа модели или поля —
только с отдельным бюджетом на каскад. После провальной волны — дешёвая; периодические чистки повторяй реже, когда
отдача падает.
**Почему.** У Telegram замена по точному шаблону ограничена, а смена типа поля каскадирует непредсказуемо.
*Источник: `docs/superpowers/postbox-refactor-log.md` («Wave-shape-G drain…», «Drains have bounded scope…», «Re-run
cadence lesson»)*

### 15.6 Диагностика и замеры

#### 15.6.1 Гипотезу о причине подтверждает или отбрасывает замер
**Правило.** Разбирая рывки ленты, опирайся на цифры `ScrollProbe`/`ScrollJankMonitor`/`ScrollSmoothnessTests`; «похоже,
что…» без замера причиной не называй. Проверенное и отброшенное — с числами — в отчёт и комментарий, чтобы не
проверяли снова.
**Почему.** У Telegram подозрение на сдвиг фаз анимаций замерили (медиана 4,5 мс при 150 мс — меньше 1 pt) и отбросили;
настоящая причина нашлась в другом месте.
*Источник: `docs/chat/corelist-chat-history-backend.md` («Also ruled out as the cause…», «What DID matter…»);
`docs/superpowers/specs/2026-10-15-navbar-split-right-buttons-design.md` (Results: «Measured why»)*

#### 15.6.2 Решение, зависящее от стоимости на iPhone, — по замеру с телефона
**Правило.** Когда выбор подхода зависит от поведения iPhone (скорость PhotoKit, память, 120 Гц, декодирование, длина
GRDB-запроса), остановись: дай владельцу сборку с signpost или логом, команду (`scripts/device.sh`) и порог решения; жди
цифр. «На глаз» не выбирай.
**Почему.** У Telegram перед кодом раскладки — замер чтения пропорций всей медиатеки на устройстве владельца; «решает
замер».
*Источник: `docs/superpowers/plans/2026-10-27-media-grid-stage1.md` (Task 10 Step 2); `docs/superpowers/specs/2026-10-27-media-picker-grid-design.md`
(Layout: «Measure first»)*

#### 15.6.3 Невидимое из кода — маленькой пробой, с записью условий
**Правило.** Поведение UIKit/SwiftUI, которое не понять из кода, мерь временным отладочным кодом (`#if DEBUG`, вывод в
лог), сборкой на iPhone через `device.sh` и логом через `idevicesyslog` (libimobiledevice-utils по README) или с экрана
владельца. Измеренный факт — в документ с условиями (ОС, устройство, сборка). Эмуляция доставки касаний через `hitTest`
не воспроизводит фильтр по рендеру — только настоящие касания.
**Почему.** У Telegram всё в документе про окна и касания iOS 27 измерено (декомпиляция и пробные приложения ~50 строк)
и записано именно потому, что противоречит правдоподобной догадке.
**Применимость.** частично — пробного приложения и симулятора у нас нет; метод переносится.
*Источник: `docs/ios27-windows-and-touches.md` (шапка; «Reproducing this kind of finding»)*

#### 15.6.4 Временный лог — удалить до коммита
**Правило.** Временные `print`/`ScrollProbe.note` для проверки помечай `// ВРЕМЕННО` и удаляй до коммита; лог, полезный
навсегда, переводи в `Logger`/`Signposts` без персональных данных.
**Почему.** У Telegram временный лог печатает значение только при изменении, служит проверкой сходимости и удаляется
отдельным шагом плана.
*Источник: `docs/superpowers/plans/2026-09-25-reserved-corners.md` (Task 4 Step 4, Task 5 Step 2)*

#### 15.6.5 Сначала дешёвая предпосылка
**Правило.** «Не приходят сообщения» — сначала подключён ли сокет и с каким токеном, потом логика `seq`; «пустой экран» —
сначала ответ сети и кеш экрана, потом вёрстка.
**Почему.** У Telegram молчание в звонке выглядело как сбой шифрования, а причиной был незапустившийся аудиоблок.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («…check the device start before suspecting crypto»)*

#### 15.6.6 Логи и телеметрия действительно пишутся — проверено
**Правило.** Новую телеметрию (хлебные крошки, `Signposts`, MetricKit) подтверждай увиденным событием в Sentry или
Instruments со сборки CI, а не наличием вызова в коде. В сборке через xtool Sentry нет (`#if canImport(Sentry)`, DSN
пуст) — оттуда события не приходят by design.
**Почему.** У Telegram логи эталонного движка месяцами были пустыми: никто не вызывал `AddLogToStream`.
*Источник: `submodules/TgVoipWebrtc/CLAUDE.md` («Reference-engine calls wrote EMPTY log files until 2026-09-08…»)*

#### 15.6.7 Отсутствие признака — не доказательство
**Правило.** «Нет лога `ScrollProbe` — значит, ничего не двигалось» — не вывод: сначала проверь, что сборка Debug и что
поток логов действительно подключён.
**Почему.** У Telegram стриминговый чат сбрасывал снимок UI быстрее следующего вызова XcodeBuildMCP, и отсутствие рамок
отладки не доказывало, что бэкенд выключен.
**Применимость.** частично — XcodeBuildMCP и симулятора у нас нет; переносится принцип.
*Источник: `docs/chat/corelist-chat-history-backend.md` (Pin to bottom edge)*

#### 15.6.8 Что дошло целым — подсказывает, где потеря
**Правило.** Ища потерю данных, сравни, какие виды содержимого проходят тот же путь целыми, — это сужает место.
**Почему.** У Telegram эмодзи доезжали, а заголовки нет при общем пути — значит, потеря не в буфере и не в мосте, а в
склейке блоков.
*Источник: `docs/instantpage-richtext.md` (Custom emoji in markdown messages: «Debugging lesson»)*

#### 15.6.9 Откат записывается с причиной; без понятого механизма — «не повторять»
**Правило.** Откат неудачного исправления записывай с причиной в отчёт эпика или комментарий у флага (как
`PerformanceFlags.swift` и выключенный кеш высот 2.5). Если механизм не понят — пометка «не применять снова без
механизма», что пробовали, что сломалось, с чего начинать.
**Почему.** У Telegram очевидная починка вернула покачивание; её откатили, механизм не установлен — записано «не
повторять» и где искать; откат с причиной остаётся и в журнале аудита (`REVERTED`).
*Источник: `docs/chat/corelist-chat-history-backend.md` (Deferred items п. 5); `docs/superpowers/duo-screen-audit-2026-10.md`
(строка `REVERTED`)*

#### 15.6.10 Диагноз «почему медленно» — по коду, с местом и коммитом
**Правило.** Аудит скорости — с путями `файл:строка` и хешем коммита `develop`, на котором читали код.
**Почему.** У Telegram причины тормозов перечислены со ссылками на строки и коммит, чтобы через месяц было понятно, о
каком коде речь.
*Источник: `docs/superpowers/specs/2026-10-27-media-picker-grid-design.md` («Why it is slow today (measured by reading the
code, 2026-10-26)»)*

#### 15.6.11 Замеры — с условиями и оговорками
**Правило.** В отчёте и PR о скорости — устройство, сборка (debug/release), сеть, состояние кеша, число прогонов, что с
чем сравнивалось. Отвергнутые варианты — см. 15.8.7.
**Почему.** У Telegram таблица замеров плеера идёт с условиями (кеш, позиции, нагрузка Mac) и оговорками.
*Источник: `docs/native-hls-player.md` («Measurements», Caveats)*

### 15.7 Отчёты: честно о проверенном

#### 15.7.1 Каждая цифра отчёта — вывод собственной команды
**Правило.** Числа тестов, кадров, времени в отчёте — только из реально запущенных команд с указанием коммита. Команда
из плана не работает — напиши об этом как о находке, а не заменяй молча другой.
**Почему.** У Telegram отчёт о готовности — только цифры, полученные командой пункта на этом дереве.
**Применимость.** согласовать с AGENTS.md: команды проверок запускаются по просьбе; не запускал — так и пиши («проверки
не запускал»), без «тесты должны проходить».
*Источник: `docs/superpowers/phase6-gate-record-2026-08-24.md` (шапка)*

#### 15.7.2 Grep-подсчёт — без комментариев, с описанием, что посчитано
**Правило.** Подсчёты grep'ом в отчётах (`UIScreen.main`, `import GRDB`, `accessibilityLabel`) исключают комментарии и
строки (`grep -v '^\s*//'` или глазами); пиши, что именно посчитано.
**Почему.** У Telegram grep по `@available(iOS 1[4-9]…` нашёл две «находки» — обе в `///`, настоящих объявлений ноль.
*Источник: `docs/superpowers/phase6-gate-record-2026-08-24.md` («Item 10's grep over-reports»)*

#### 15.7.3 «Автоматическое прошло» ≠ «закрыто»
**Правило.** В итоге задачи разделяй: «проверено автоматически», «требует владельца на iPhone», «частично — что
осталось». Называй ограничения своих проверок (например, `swiftc -typecheck` не ловит ошибок линковки и
Release-оптимизатора).
**Почему.** У Telegram все автоматизируемые пункты прошли, но ворота этим не закрылись: ручная половина за человеком,
частичные пункты помечены с остатком, дыры проверки названы.
*Источник: `docs/superpowers/phase6-gate-record-2026-08-24.md` (VERDICT; «Completion definition»; «Outstanding»)*

#### 15.7.4 «Поддерживает X» — только если X выполнялся
**Правило.** Пиши «поддерживает X», только если X был выполнен; иначе «код есть, ни разу не выполнялся». Если проверен
единственный порядок выполнения — так и скажи.
**Почему.** У Telegram две возможности ни разу не выполнились в корпусе, и это названо.
*Источник: `docs/superpowers/phase6-gate-record-2026-08-24.md` (Outstanding п. 4)*

#### 15.7.5 Невыполненная строка чек-листа — пустая
**Правило.** «Владелец посмотрел — нормально» записывай как дымовую проверку; пункты чек-листа, которые никто не
выполнял, оставляй пустыми; в отчёте назови 1–2 самых ценных невыполненных.
**Почему.** У Telegram общее «всё вроде работает» — настоящий дымовой тест, но не доказательство «Undo после
двухшаговой вставки».
*Источник: `docs/superpowers/phase6-manual-checklist-record.md` (шапка; «Result so far — recorded honestly»)*

#### 15.7.6 В каждом отчёте — раздел «Не проверено»
**Правило.** В отчёте задачи и в комментарии к типу — что сознательно не сделано и что не проверено, с причиной: нет
iPhone под рукой, нет роли или данных на Railway, только `swiftc -typecheck`, тёмная тема, крупный шрифт, iOS 17 без
стекла, VoiceOver, медленная сеть, нет iCloud-медиатеки.
**Почему.** У Telegram итог перечисляет и то, что не снято (экраны без нужного состояния аккаунта, iPhone Duo, тёмная
тема), и то, что проверено «только кодом».
**Применимость.** дополняет правило `AGENTS.md` «нельзя утверждать, что проверки прошли, если не запускал».
*Источник: `docs/superpowers/duo-screen-audit-2026-10.md` («Known gaps»); `docs/superpowers/specs/2026-10-15-navbar-split-right-buttons-design.md`
(Results: «Not filmed…»); `submodules/MediaPickerUI/CLAUDE.md` («Known limits»);
`submodules/TelegramUI/Components/PeerInfo/PeerInfoVisualMediaPaneNode/CLAUDE.md` («Not verified in the app»);
`docs/superpowers/plans/2026-10-28-shared-media-grid-stage1.md` (Task 9 Step 4)*

#### 15.7.7 Отказ от пункта задачи — с причиной
**Правило.** Не сделал что-то из задачи сознательно — скажи в отчёте и в описании коммита/PR, почему.
**Почему.** У Telegram невыполненный пункт брифа без записи читается как недосмотр.
*Источник: `docs/superpowers/richtext-seam-stage2-inheritance.md` (D39, D36/D37)*

#### 15.7.8 Что открыто до выпуска — списком
**Правило.** Держи в `docs/RELEASE_IOS.md` список «открыто до TestFlight/App Store»: заглушка `api.example.invalid` в
Release, иконки нет, `Package.resolved` не закреплён, пуши и Sentry не проверяются отладочной копией.
**Почему.** У Telegram статус подсистемы перечисляет непроверенное до App Store (подпись, профиль распространения,
release-сборка, `--validate-app`, закоммиченный `Package.resolved`).
**Сейчас у нас.** соблюдено: в `docs/RELEASE_IOS.md` раздел «Что открыто до выпуска» (адрес API, `Package.resolved`,
пуши, Sentry, иконка, подпись); закреплять ли `Package.resolved` — решение владельца (14.1.2).
*Источник: `Telegram/CLAUDE.md` («Status: verified only with development signing… Open before App Store shipping»)*

#### 15.7.9 Записка о передаче долгой задачи
**Правило.** Для многошаговой iOS-задачи пиши передачу, которую читают сверху вниз один раз: ветка и последний коммит;
что собрано (`xtool dev build`, CI — номер прогона); что проверено на iPhone; правила и решения владельца; карта кода;
что осталось по порядку; известные мелочи; ловушки. Писать так, чтобы следующий агент начал без памяти прошлых сессий.
**Почему.** У Telegram такая записка позволяла продолжить работу после смены сессии без потерь.
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` (Status at a glance; What is left; Deferred minors;
Pitfalls)*

### 15.8 Планы, решения владельца, аудиты и ревью

#### 15.8.1 Спецификация и план крупной задачи — на утверждение владельцу
**Правило.** Большой рефакторинг или новая подсистема iOS: спецификация и план — владельцу до первой волны. Его решения
записываются в журнал эпика дословно с датой; рабочие документы можно не хранить, решения — обязательно.
**Почему.** У Telegram каждый подпроект — спецификация, план, волны; владелец утверждает спецификацию и план.
*Источник: `docs/superpowers/postbox-refactor-log.md` («Each sub-project is brainstormed into a spec, then a plan, then
waves…»)*

#### 15.8.2 Цели, не-цели, анти-цели и «вне объёма»
**Правило.** В плане и описании крупной задачи — цели, не-цели, анти-цели («провал, даже если работает»: «карточка
делает запрос к чужому хосту», «голос уходит без касания», «смена аккаунта показывает чужие данные», пропуск кадров) и
«вне объёма»/«не подтверждено» с причиной. Конфликт пункта плана с анти-целью — стоп-точка: побеждает анти-цель, решение
выносится владельцу и вносится в спецификацию.
**Почему.** У Telegram у каждой спецификации есть анти-цели; когда пункт плана им противоречит, анти-цель побеждает, а
необъяснённое и непроверенное записано, а не замолчано.
*Источник: `docs/superpowers/specs/2026-10-27-media-picker-grid-design.md` (Goals / Non-goals / Anti-goals);
`docs/superpowers/specs/2026-10-27-media-grid-thumbnail-store-design.md`, `…/2026-10-28-shared-media-grid-design.md` (Anti-goals);
`docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` (§3), `…/2026-10-26-message-widgets-v0.2-design.md` (§3),
`…/2026-10-29-message-widgets-cpu-clock-limits-design.md` («Anti-goals», «Mapping»);
`docs/superpowers/specs/2026-09-16-tgcalls-mtproto-dtls-slot-design.md` («Out of scope»);
`docs/superpowers/specs/2026-10-11-tgcalls-compatimpl-v2-protocol-design.md` («Not exercised»)*

#### 15.8.3 Фокус ревью: риск → чем закрыт
**Правило.** В плане крупной iOS-задачи и в описании PR — блок «Что проверить на ревью»: рискованные случаи (пустой и
крошечный список, прокрутка до самого конца, жест во время анимации, изменение, удаляющее якорь) и для каждого — где
проверен (юнит, UI-тест на mock, кадр, iPhone владельца) или что не проверен.
**Почему.** У Telegram план перечисляет 4–5 рискованных инвариантов и задачу, которая закрывает каждый; что не проверить
тестом — проверяется по записи.
*Источник: `docs/superpowers/plans/2026-09-25-reserved-corners.md`, `docs/superpowers/plans/2026-10-27-voiceover.md`,
`docs/superpowers/plans/2026-10-27-media-grid-stage1.md`, `…/2026-10-27-media-grid-thumbnail-store.md`,
`…/2026-10-28-shared-media-grid-stage1.md` («Review Focus»)*

#### 15.8.4 Предположения о платформе — «проверить на iPhone первым делом»
**Правило.** Предположения о поведении iOS 17…27 (стекло iOS 26 и касания, PhotosPicker, клавиатура) записывай в план
как «проверить на iPhone первым делом» с логом или признаком, по которому человек подтвердит.
**Почему.** У Telegram спецификация перечисляет предположения (размер стека главного потока, жесты, нижняя версия iOS),
которые надо подтвердить на устройстве первыми, и даёт строку лога.
*Источник: `docs/superpowers/specs/2026-10-13-message-widgets-design.md` («Open items to verify early»);
`docs/superpowers/plans/2026-10-13-message-widgets.md` (Task 12)*

#### 15.8.5 Решения владельца записаны с датой и не переоткрываются
**Правило.** Решения владельца по iOS (значки меню слева, только системные индикаторы, только мягкие края и т. п.)
записывай в память (`MEMORY.md`) и в документ правил: что решено, почему, во что обойдётся ошибка, дата. Отменённое
не стирай — помечай «заменено … (кем, когда)». Отклонённое владельцем не предлагай снова и не пересматривай без новых
данных. Останавливайся только на нерешённом, необратимом, связанном с безопасностью или вне рабочей копии (стоп-точки
`AGENTS.md`).
**Почему.** У Telegram правила владельца цитируются дословно, отклонённые варианты не предлагаются повторно, а
отменённое правило помечено датой и автором отмены.
**Применимость.** согласовать с AGENTS.md: запись в `docs/IOS_RULES.md` — по просьбе владельца (`docs/*` без просьбы не
переписываем); по умолчанию решение фиксируется в памяти и в отчёте.
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` (Ground rules, Rulings already made);
`docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§2, §6h, §7); `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md`
(§4, §10); `docs/superpowers/specs/2026-10-29-message-widgets-cpu-clock-limits-design.md` (вступление)*

#### 15.8.6 «Решение владельца» и «моё решение» различимы
**Правило.** В планах и отчётах помечай, что решил владелец, а что принято тобой и может быть изменено; что ты сказал
владельцу и не получил возражения — тоже отдельно.
**Почему.** У Telegram в спецификациях видно «Decisions (Ilya)» и «*My call*».
*Источник: `docs/superpowers/specs/2026-10-27-media-picker-grid-design.md` («Behaviour (decided with Ilya)», «*My call*»)*

#### 15.8.7 Отвергнутые варианты записаны с причиной
**Правило.** В комментарии, плане или `docs` — «почему не очевидный путь» (для сессии: почему не системные cookie, почему
актор, почему повтор один) и что рассмотрели и не стали делать, одной строкой на вариант, чтобы его не предлагали
заново.
**Почему.** У Telegram каждый «очевидный» путь в звонках уже выпускали или пробовали, и каждый стоил регрессии; это
записано.
*Источник: `docs/superpowers/specs/2026-09-16-tgcalls-mtproto-dtls-slot-design.md` («Background»);
`submodules/TgVoipWebrtc/CLAUDE.md` («Why not the obvious routes»); `docs/native-hls-player.md` («Considered and not
built»)*

#### 15.8.8 Исследование до проектирования: факты с якорем, вопросы — по адресатам
**Правило.** Перед правкой синхронизации сверь, как сделано в вебе (`apps/web`) и Android (`apps/android`), а контракт —
с сервером (`apps/api/src/modules/chats/chats.service.ts`, например `getUpdates`). Каждый факт — с `файл:строка` и
коммитом; «выведено, не воспроизведено» помечено; открытые вопросы — отдельно серверу и владельцу.
**Почему.** У Telegram исследователи с непересекающимися вопросами сначала смотрят, как делают tdlib/Desktop/Android, и
разделяют вопросы серверной команде и владельцу.
*Источник: `docs/superpowers/reports/2026-10-15-difference-too-long-exploration.md` (структура разделов, «other-clients»,
«server-api»)*

#### 15.8.9 Аудит экранов — строка на каждый, без пропусков
**Правило.** iOS-аудиты (Telegram-аудит, VoiceOver, раскладка) ведутся таблицей «экран | файл:строка | условие | класс |
доказательство | статус»; «н/п» — с причиной. Исправитель трогает только свои файлы; отдельный ревью-проход по дифам
до коммита.
**Почему.** У Telegram 298 экранов проверены по брифу, у каждого — находка или «n/a» с причиной; три ревьюера ловили
правки, сводящиеся к старому выражению.
*Источник: `docs/superpowers/duo-screen-audit-2026-10.md` («Method»)*

#### 15.8.10 Находка аудита — после попытки её опровергнуть
**Правило.** В аудитах агентами на каждую находку — отдельный проверяющий, который пытается её опровергнуть; ссылки на
строки — с хешем коммита; «выведено из кода» и «воспроизведено» различаются явно; для каждой — серьёзность и меняет ли
исправление поведение.
**Почему.** У Telegram из 45 подозрений 29 подтверждены, 16 сужены, 0 опровергнуто — подозрение становится проблемой
только после проверки.
*Источник: `docs/state-sync-audit-2026-10.md` (вступление, §9)*

#### 15.8.11 Перед влитием — свежий взгляд на всю ветку и релизная сборка
**Правило.** Эпик или пачку волн перед слиянием смотрит свежий ревьюер (отдельный агент без контекста автора,
`/code-review`) по всему диффу ветки; критичное чинится с тестом, мелочи — списком с местом в отчёте или памяти. Релизная
сборка у нас только на CI (`ios-release.yml`): PR с большим рефакторингом не вливать без зелёной релизной сборки.
**Почему.** У Telegram свежий ревьюер нашёл критический дефект, пропущенный автором, а его главное замечание было, что
release-сборка не запускалась.
**Применимость.** согласовать с AGENTS.md: слияние и запуск CI/PR — по просьбе человека; без релизной сборки в отчёте
прямо писать «релизная сборка не прогонялась».
*Источник: `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` (Resolved after the whole-branch review);
`docs/superpowers/specs/2026-10-15-navbar-split-right-buttons-design.md` (Results: whole-branch review);
`docs/superpowers/postbox-refactor-log.md` («Run a fresh reviewer over each batch, and a `release_arm64` build…»)*

#### 15.8.12 Ревью исправлений ревью
**Правило.** После исправлений по замечаниям ревью — отдельный просмотр самих исправлений; незакрытое — явным списком в
отчёте, а не «потом».
**Почему.** У Telegram в волне исправлений после ревью ветки нашли три новые дыры; незакрытое переносится файлом.
*Источник: `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` (§5)*

### 15.9 Неприменимо к нам
- Подпись агента `Co-Authored-By: Claude…` в коммитах плана и handoff — у нас прямо запрещено (`AGENTS.md`, «Без следов
  агента в истории и в PR»). *`docs/superpowers/plans/2026-10-15-navbar-split-right-buttons.md` (Global Constraints);
  `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` (§2)*
- `git add -A <каталог>` в шагах «Commit» плана — запрещено (`AGENTS.md`: только `git add <файлы>`); сообщения
  коммитов у нас по-русски, Conventional Commits. *`docs/superpowers/plans/2026-10-15-navbar-split-right-buttons.md`
  (Task 3/4/5)*
- «Без комментариев в новом коде» (предпочтение владельца Telegram) — у нас обратное: `///`-комментарии по-русски
  объясняют «почему» (15.1.15). *`docs/superpowers/plans/2026-10-27-media-grid-stage1.md`, `…/2026-10-27-media-picker-grid-stage2.md`,
  `…/2026-10-28-shared-media-grid-stage1.md` (Global Constraints)*
- Перевод с Postbox на TelegramEngine: шпаргалки типов, обёртки, исходы волн, P1–P7 — Postbox и TelegramEngine у нас
  нет; общие уроки вынесены в 15.4–15.5. *`docs/superpowers/postbox-refactor-log.md`*
- Остальное из `submodules/TelegramUI/Components/CoreList/CLAUDE.md` (своя физика, keyframe-полёты, призрачные блоки,
  карусели, тонкости `beginTime`) — процессных правил там нет, механика списка — в §6.
- Механика стеклянных капсул панели, переходов push/pop, свайпа назад, тени карточек, клавиатуры при переходе из
  `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` — процессных правил нет, механика — в §3/§5.

---

---

## Приложение А. Расхождения кода с правилами

Всё ниже — выводы из чтения кода `develop` (`1f595d20`, 14.11.2026). На iPhone не воспроизводилось. Пометки:
**расходится** — код противоречит правилу; **проверить на iPhone** — по коду не решить; **решение владельца** — выбор
продуктовый. Пока владелец не решил, ничего из этого не чинится. **[исправлено, #499]** — пункт исправлен волнами 1–3
(PR #499), строка оставлена для истории; статус в теле правила — «соблюдено (#499)».

### А.1 Сначала — то, что грозит потерей данных или ложным выходом

Эти пункты независимо нашли несколько агентов.

1. **Продление токена, начатое до «Выйти», воскрешает сессию.** `Core/Session/SessionStore.swift:314`: `adopt`
   без сверки. Следующий холодный старт откроет сессию вышедшего человека. Правило 9.7.1. [исправлено, #499]
2. **Повтор продления не укладывается в окно грации сервера.** Таймаут 60 с (`Core/Session/AuthAPI.swift:90`)
   плюс пауза 2,5 с (`SessionStore.swift:50`) против окна 10 с на сервере. Сервер сочтёт повтор кражей и выкинет
   пользователя со всех устройств. Правило 9.7.2. [исправлено, #499]
3. **`Keychain.set` не проверяет результат `SecItemAdd`.** `Core/Session/SecretStore.swift:80–86`. Если
   ротированный refresh-токен не записался, после перезапуска уйдёт погашенный, и это ложный выход. Правило 10.2.2. [исправлено, #499]
4. **Догон теряет сообщения.** Найдено четыре причины:
   - `lastSeq` поднимается без проверки непрерывности (`Core/Realtime/RealtimeCoordinator.swift:361`), правило 9.3.2;
   - страница списка чатов двигает позицию догона (`Core/Chats/ChatStore.swift:265`), правило 9.3.4;
   - `sinceTs` берётся с часов телефона, `syncedAt` сервера не декодируется, правило 9.3.5;
   - `catchUp` сдаётся после первой ошибки (`ChatThreadModel.swift:1472–1495`), правило 9.3.1. [исправлено, #499]
5. **Поздний ответ откатывает правку и воскрешает удалённое.** `Core/Chats/MessageStore.swift:183–190, 214–216`.
   Правила 9.5.1 и 9.5.2. На `overflow` история к тому же стирается раньше, чем скачана новая (правила 9.3.10 и 9.3.13). [исправлено, #499]
6. **База откладывается в резервную копию на любую ошибку открытия, прежняя копия удаляется.**
   `Core/Storage/DatabaseHolder.swift:66–78`. Две временные ошибки подряд — черновики и неотправленное потеряны.
   Правило 9.5.10. [исправлено, #499]
7. **Без соединения отметка прочтения и правка сообщения пропадают.** socket.io-client-swift отбрасывает `emit`
   без соединения (`Core/Realtime/RealtimeTransport.swift:86`). Правило 9.4.16. [исправлено, #499]
8. **Выход не останавливает трансляцию геопозиции.** Не чистятся `chats.liveLocations` и кеш `MessageCodeBlocks`,
   а `StudentHubApp` на старте возобновляет трансляцию — уже под следующим пользователем. Правило 10.1.11. [исправлено, #499]
9. **Типы с токенами печатаются вместе с токенами, а сетевые следы Sentry пишут полные адреса.** Описания
   синтезированы автоматически. Правила 10.2.6 и 10.2.8. [исправлено, #499]
10. **Ссылки открываются без проверки.** Нет единой точки открытия ссылок. Ссылки не на http(s) уходят системе без
    вопроса. Подпись превью берётся из `og:site_name` чужого сайта. Скрытые markdown-ссылки открываются без
    подтверждения. Правила 10.3.4 и 10.3.5. [исправлено, #499]
11. **Правка сообщения затирает черновик чата.** `ChatThreadModel.swift:487–506`. Правило 9.8.6. [исправлено, #499]
12. **В поле ввода нет лимита в 4000 символов и счётчика**, хотя сервер принимает не больше. Правило 7.1.7. [исправлено, #499]
13. **Прочитанным отмечается последнее сообщение, даже если его не видно на экране.**
    `ChatThreadModel.swift:1247`. Правила 6.6.1 и 9.4.17. [исправлено, #499]
14. **Release-сборка невоспроизводима и собирается другим Xcode, чем тесты.** `ios-release.yml` работает на
    `macos-15` без `DEVELOPER_DIR`. XcodeGen ставится без версии, `Package.resolved` в `.gitignore`. Правила
    14.1.1 и 14.1.2. [частично исправлено, #499: XcodeGen и Xcode релиза; `Package.resolved` — решено: закреплён в git, волна 5]

### А.2 Полный список по разделам

#### §1. Сборка и окружение

- **Номер сборки постоянный — свежую установку на iPhone не отличить от старой** — `apps/ios/project.yml:133` (`CURRENT_PROJECT_VERSION: "1"`), `apps/ios/scripts/device_bundle.py:61`, `apps/ios/Sources/Features/Settings/SettingsView.swift:168` (показывает `0.1.0 (1)`) — правило 1.4.1. Проверка «исправлено/не исправлено» на телефоне может идти на вчерашней сборке, а метки коммита или времени сборки нет. [расходится] [исправлено, #499]
- **`run_bench` берёт первое найденное приложение** — `apps/ios/scripts/test.sh:220` (`find … | head -1`) — правило 1.4.4. Если в DerivedData несколько конфигураций, замер плавности может пойти не на той сборке. [расходится] [исправлено, #499]
#### §2. Тесты

- **Нет `-collect-test-diagnostics never`** — `apps/ios/scripts/test.sh:173` (`run_suite`, `xcodebuild test-without-building`) — правило 2.1.6. Упавший ui/perf-набор может висеть до 10 минут в `simctl diagnose`, съедая лимит `timeout-minutes` (75 в `ios.yml`, 120 в `ios-nightly.yml`). [расходится] [исправлено, #499]
- **Нет явного `-parallel-testing-enabled NO`** — `apps/ios/scripts/test.sh:173` — правило 2.1.7. Сейчас держится на умолчании схемы XcodeGen: смена умолчания или ручной `-parallel-testing-enabled YES` даст взаимные убийства прогонов на одном симуляторе. [расходится] [исправлено, #499]
- **`SH_PERF_FLAGS` с опечаткой молча игнорируется** — `apps/ios/Sources/App/PerformanceFlags.swift:89`, `:92` — правило 2.7.9. Матрица «оба положения флага» (2.4.8) тихо прогоняет положение «как в коде». [расходится] [исправлено, #499]
- **Неизвестный `SH_UITEST_SCENARIO` молча становится `.signedOut`** — `apps/ios/Sources/App/UITesting/UITestEnvironment.swift:35` — правило 2.7.8. Опечатка в сценарии даёт тест экрана входа вместо нужного, и падение выглядит как баг продукта. [расходится] [исправлено, #499]
- **Дублёры сети в тестах синхронизации без журнала запросов и удержания ответа** — `apps/ios/Tests/StudentHubTests/RealtimeCoordinatorTests.swift:270`, `apps/ios/Tests/StudentHubTests/OptimisticSyncTests.swift:333` (только счётчик `calls`) — правило 2.5.1. Гонки «событие сокета пришло, пока запрос в пути» тестом не закрепить. [расходится] [исправлено, волна 4]
#### §3. Визуальная проверка и анимации

- **Запись видео на CI стартует по `sleep 1`, а не по «Recording started»** — `apps/ios/scripts/test.sh:158-160` — правило 3.2.5. При медленном старте записи первые движения теста не попадают в `run.mp4`. [расходится] [исправлено, #499]
- **Нет своего инструмента листов кадров и метрик** — `apps/ios/scripts/` — правила 3.3.1–3.3.2. Анимации разбираются вручную, без `gap`/`jump`/треков, поэтому вывод «едут вместе» не подкреплён числом. [расходится] [исправлено, волна 4]
- **README не отсылает к процедуре визуальной проверки** — `apps/ios/README.md:106` — правило 3.1.9. Агенты, начинающие с README, не найдут требование «кадры, а не сборка». [расходится] [исправлено, волна 4]
- **Меню сообщения пересчитывает место по живой клавиатуре** — `apps/ios/Sources/Features/Chats/Thread/Menu/MessageMenuOverlay.swift:213` — правило 3.7.1. Уход клавиатуры при открытом меню сдвигает меню. [расходится] [исправлено, #499]
- **Источник меню не скрыт: под копией пузыря виден размытый двойник** — `apps/ios/Sources/Features/Chats/Thread/ChatThreadView.swift:854-893`, `Menu/MessageMenuOverlay.swift:270` — правило 3.7.3. Когда меню сдвигает пузырь, на экране два пузыря. [расходится] [исправлено, волна 4]
- **Оверлей меню снимается по таймеру 230 мс, раньше конца пружины** — `apps/ios/Sources/Features/Chats/Thread/Menu/MessageMenuOverlay.swift:450` — правило 3.5.5. Видимое затухание обрывается на последнем кадре. [расходится] [исправлено, #499]
- **Переход к сообщению завершается по таймерам 300/450/30 мс** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:783,801,808` — правило 3.5.5. Подсветка цели может прийти до конца прокрутки или после неё. [расходится] [исправлено, #499]
- **`RemoteImage` растворяет заглушку и картинку навстречу** — `apps/ios/Sources/Features/Feed/FeedComponents.swift:54` — правило 3.8.2. В середине перехода проступает фон (у Telegram это давало +17–23 яркости). [расходится] [исправлено, волна 4]
- **PiP включён без фонового режима `audio`** — `apps/ios/Sources/Features/Feed/MediaViewer.swift:912`, `apps/ios/project.yml:83-87` — правило 3.4.7. Картинка в картинке и звук в фоне, вероятно, не работают. [проверить на iPhone]
- **Нулевая длительность вместо прямого присваивания** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:829` (`flash`), `apps/ios/Sources/Features/Chats/Thread/SwipeToReply.swift:79` — правило 3.5.1. Асинхронное завершение может перебить следующее состояние при «Уменьшении движения». [проверить на iPhone]
- **Отложенное гашение подсветки `flash` может попасть в переиспользованную ячейку** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:841-848` — правило 3.6.3. Через 0,8 с анимация фона применится к ячейке с другим сообщением. [проверить на iPhone]
- **Новые ячейки раскладываются внутри пружины `animateLayout()`** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:964` — правило 3.6.4. Ячейка, впервые появившаяся в этом проходе, может «вырасти из угла». [проверить на iPhone]
- **Растущий пузырь может налезать на нижний** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:964` — правило 3.6.5. Содержимое уже новой высоты, а рамка ещё едет пружиной. [проверить на iPhone]
- **Въезд своего сообщения и лента к низу на разных кривых** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:1025-1040`, `MessageListGlide.swift` — правило 3.6.6. Пузырь может дрейфовать относительно соседей при отправке. [проверить на iPhone]
- **`crossfade` растворяет снимок, в котором замирает анимированное содержимое** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:895` — правило 3.6.8. Голосовое с волной, видео или GIF на время перехода замирают. [проверить на iPhone]
- **Два `Menu` в одной стеклянной капсуле морфят всю капсулу** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerEditorView.swift:159-214` — правило 3.7.5. Меню может «вырасти» из всей панели, а не из кнопки. [проверить на iPhone]
#### §4. Компилятор, Swift, оптимизация

- **Предупреждения не считаются ошибками** — `apps/ios/project.yml:26` (`SWIFT_TREAT_WARNINGS_AS_ERRORS: "NO"`) — правила 4.2.1, 4.2.2. Предупреждения «приведение всегда неуспешно» и предупреждения конкурентности после ретипизации проходят молча. [решено: страж числа предупреждений в ios.yml, база scripts/warnings-baseline.txt только сужается, волна 5]
- **Устройство владельца собирается более новым Swift, чем CI** — локальный Swift 6.4.2 против Xcode 26.6 на CI (`.github/workflows/ios.yml:85`) — правило 4.1.1. Известный баг Swift 6.4 с `[weak]` в локальном замыкании проявится только на iPhone, а CI будет зелёным. Сейчас таких мест нет. [решено: принято как есть до Xcode 27 на CI, волна 5]
- **Release собирается только при выпуске** — `.github/workflows/ios-release.yml` (ручной запуск) — правило 4.1.2. Падения компилятора, которые бывают только в Release (`SimplifyCFG`, `-Osize`), всплывут в день отправки. [решено: ночной ios-nightly собирает Release без подписи, волна 5]
#### §5. UIKit и SwiftUI

- **Превью чата регистрирует якоря пузырей под настоящими id** — `apps/ios/Sources/Features/Chats/ChatListView.swift:1084` — правило 5.7.7. `ChatPeekView` создаёт `MessageBubbleView` без `isMenuPreview: true`, поэтому его копия может перехватить якорь `BubbleAnchors` у пузыря в ленте, и меню вырастет не из того места. [расходится] [исправлено, #499]
- **Двойной тап-реакция висит на всём пузыре** — `apps/ios/Sources/Features/Chats/Thread/MessageBubbleView.swift:153` — правило 5.4.1. Двойной тап по варианту опроса или пункту чек-листа может поставить реакцию, а одиночный тап по кнопке ждёт второго. [расходится] [исправлено, #499]
- **`ChatFlowLayout` мерит детей без ограничения ширины** — `apps/ios/Sources/Features/Chats/ChatChrome.swift:327,344` — правило 5.6.3. `sizeThatFits(.unspecified)` даёт элементу, который шире пузыря, вылезти за край. [расходится] [исправлено, #499]
- **Оценка высоты пузыря дублирует отступы числами** — `apps/ios/Sources/Features/Chats/Thread/MessageStackGeometry.swift:74-78` — правило 5.6.4. Литералы 14/18/44/30/52 разойдутся с видом при правке дизайна, и кеш высот ленты начнёт ошибаться (прыжки). [расходится] [исправлено, #499]
- **Прокрутка ленты ждёт отказа свайпа «ответить»** — `apps/ios/Sources/Features/Chats/Thread/SwipeToReply.swift:32` — правило 5.3.1. `require(toFail:)` на панораму ленты может задерживать касание и давать «лимб» долгого нажатия. [проверить на iPhone]
- **Старт свайпа не отменяет меню явно** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:553` (`menuPress`) и `SwipeToReply.swift` — правило 5.3.2. У Telegram меню открывалось на 0,23 с каждого свайпа; у нас это держится только на умолчаниях UIKit. [проверить на iPhone]
- **Свои распознаватели ленты с `delaysTouchesEnded = true`** — `apps/ios/Sources/Features/Chats/Thread/SwipeToReply.swift` (`pan`), `MessageListView.swift:553` (`menuPress`) — правило 5.3.4. Кнопки в пузырях могут получать отпускание с задержкой. [проверить на iPhone]
- **Сдвиг ленты при смене высоты не смотрит на `isTracking`** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:208-216` — правило 5.1.9. При интерактивном скрытии клавиатуры лента может ехать вдвое быстрее пальца. [проверить на iPhone]
- **Стеклянная плавающая дата гаснет через `alpha`** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:572,1128,1146` — правило 5.7.1. На iOS 26+ стекло при `alpha < 1` пропадает сразу, без затухания. [проверить на iPhone]
- **Поле редактора с `.automatic` отступом под клавиатуру** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerTextView.swift` (у `ComposerUITextView` не задан `contentInsetAdjustmentBehavior`) — правило 5.1.8. Возможен двойной отступ под клавиатурой в полноэкранном редакторе. [проверить на iPhone]
- **Лёгкий свайп по плавающей дате может открыть календарь** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift` (`FloatingDateView`, `DaySeparatorView`, `onDayTap`) — правило 5.3.7. Чат прыгает к дате вместо прокрутки. [проверить на iPhone]
- **Касание катящейся ленты может нажать кнопку в пузыре** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift` (SwiftUI-кнопки в `UIHostingConfiguration`) — правило 5.3.5. Остановка ленты пальцем открывает вложение или ссылку. [проверить на iPhone]
- **Ручка выделения у края экрана** — поле чата и листы (`ComposerTextView`, `.sheet`) — правило 5.5.3. Перетаскивание левой ручки может увести экран назад или потянуть лист. [проверить на iPhone]
#### §6. Списки и лента чата

- **Прочтение отмечается без учёта видимости** — `apps/ios/Sources/Features/Chats/Thread/ChatThreadModel.swift:1247` — правило 6.6.1. `markRead()` отмечает последнее чужое сообщение, пока чат открыт, даже если человек читает середину или оно под полем ввода: собеседник видит «прочитано» раньше времени. [расходится] [исправлено, #499]
- **Невидимая копия времени не совпадает с видимой меткой** — `apps/ios/Sources/Features/Chats/Thread/MessageBubbleView.swift:577` (видимая — `stateMark`, `:678`) — правило 6.7.2. Для `.pending/.failed` копия держит место под две галочки, а рисуются часы или «!»: резерв не совпадает с меткой, и в последней строке остаётся лишний зазор или перенос не там. [расходится] [исправлено, #499]
- **Поправка смещения при перемере строки во время инерции** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:1512`, `apps/ios/Sources/Features/Chats/Thread/MessageStackLayout.swift:111` — правило 6.4.4. `contentOffsetAdjustment` ставится без проверки `isTracking`/`isDecelerating`; если это гасит бросок — рывки и возможная причина проблем флага `chatHeightCache`. [проверить на iPhone]
- **Удалённый верхний якорь заменяется грубой компенсацией** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:486` — правило 6.4.9. `restore(pinned)` возвращает `false`, и лента сдвигается по росту высоты, а не держит соседнее сообщение: при удалении сообщения на экране текст под глазами уезжает. [расходится] [исправлено, #499]
- **Первое непрочитанное может уйти под появившиеся панели** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:241` (`applyTopInset`) — правило 6.4.11. При открытии чата с непрочитанным и закреплённым `applyTopInset` держит только низ; разделитель непрочитанного может оказаться под плашкой закрепа. [проверить на iPhone]
- **Кнопка «вниз» может мигать во время своей прокрутки** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:910` (`reportBottom`) — правило 6.5.9. Считает по текущему смещению посреди пружины `MessageListGlide`; сценарии: своя отправка, нажатие «вниз», открытие клавиатуры у низа. [проверить на iPhone]
- **Нет закрытия «листается» при программной остановке инерции** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:1303` — правило 6.5.3. Если `scrollToBottom`/`crossfade`/`restore` прерывают инерцию, `scrollViewDidEndDecelerating` может не прийти: плавающая дата не гаснет, `ScrollJankMonitor` не закрывает замер. [проверить на iPhone]
- **Пружина ленты останавливается только после ухода экрана** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:188` — правило 6.5.14. `glide.stop()` в `viewDidDisappear`: во время свайпа назад лента ещё может ехать сама. [расходится] [исправлено, #499]
- **Открытый свайп в списке чатов при перестановке строк** — `apps/ios/Sources/Features/Chats/ChatListView.swift:539` — правило 6.5.15. Новое сообщение переставляет чаты; открытые кнопки могут остаться над чужой строкой или сработать не для того чата. [проверить на iPhone]
- **Раскрытие длинного поста в ленте** — `apps/ios/Sources/Features/Feed/PostCardView.swift:254` (`PostTextView`) — правило 6.4.15. Нижние посты `LazyVStack` могут мигнуть или пропасть на кадр, верх поста — сдвинуться. [проверить на iPhone]
#### §7. Поле ввода и текст

- **Нет лимита и счётчика длины в поле** — `apps/ios/Sources/Features/Chats/Thread/MessageComposerView.swift:588` (и `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerEditorView.swift:264`) — правило 7.1.7. Текст длиннее 4000 UTF-16 отклоняет сервер после нажатия «Отправить», черновик длиннее 4000 молча не сохраняется. [расходится] [исправлено, #499]
- **«Можно отправить» и обрезка продублированы в трёх местах, невидимые символы не снимаются** — `apps/ios/Sources/Features/Chats/Thread/ChatThreadModel.swift:285` (`:318`, `:681`), `apps/ios/Sources/Features/Chats/Thread/MessageComposerView.swift:588`, `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerEditorView.swift:264` — правило 7.1.6. Кнопка может быть активна для текста из одних `U+200B`, который сервер отклонит; копии разъедутся. [расходится] [исправлено, #499]
- **Ссылка без выделения вставляется как `[адрес](адрес)`** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerFormatting.swift:62-63` — правило 7.4.4. Лишняя разметка вместо голого URL, который получатель распознал бы сам. [расходится] [исправлено, #499]
- **Подпись и адрес ссылки не экранируются, переводы строк не схлопываются** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerFormatting.swift:61-64`, `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerTextView.swift:379` — правило 7.2.5. Выделение с `\n` или `]`, адрес с пробелом или `)` ломают Markdown в пузыре и на вебе. [расходится] [исправлено, #499]
- **Форматирование применяется внутри кода, автокоррекция в коде включена** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerFormatting.swift:50-59`, `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerTextView.swift:339-350` — правило 7.4.3. Маркеры `**` и `_` внутри блока кода видны получателю буквально; автокоррекция портит код. [расходится] [исправлено, #499]
- **Нет нормализатора переводов строк** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerTextView.swift:206-213` (`paste`), `:70-71` (внешняя установка) — правило 7.2.2. CRLF, `U+2028`/`U+2029` из чужих приложений уходят на сервер как есть и по-разному рисуются на трёх клиентах. [расходится] [исправлено, #499]
- **`U+FFFC` может уйти на сервер** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerTextView.swift:206-213`; `packages/shared-schemas/src/chats.ts:37` (`INVISIBLE_RE` его не содержит) — правило 7.2.3. Мусорный символ-заглушка в сообщении после вставки RTFD с картинкой. [расходится] [исправлено, #499]
- **Нет единого шлюза ввода (`shouldChangeTextIn`)** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerTextView.swift:123-164` (`Coordinator`) — правило 7.2.1. Нормализацию, лимит и продолжение списков некуда поставить, кроме как размазать по дверям. [расходится] [исправлено, #499]
- **Выделение не расширяется до границ графем перед форматированием** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerTextView.swift:341` — правило 7.4.2. Разрезанная суррогатная пара или ZWJ-последовательность превращается в мусорный код. [расходится] [исправлено, #499]
- **Внешняя установка текста во время IME-составления теряется** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerTextView.swift:70` (+ `textViewDidChange` → `pushText`, `:141-143`) — правило 7.3.3. Очистка поля после «Отправить» посреди японского или китайского набора может вернуть отправленный текст в черновик. [проверить на iPhone]
- **Отмена посреди IME-составления в полноэкранном редакторе** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerTextView.swift:312-320` — правило 7.3.4. Возможен сбой или порча текста при ⌘Z/«Отменить» поверх marked text. [проверить на iPhone]
- **Изоляция `undoManager` поля и полноэкранного редактора не проверена** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerTextView.swift:255`, `:313`, `:324` — правило 7.3.1. При общем менеджере «Отменить» в редакторе может откатить правку другого поля. [проверить на iPhone]
- **`onChange` вызывается дважды на одну правку** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerTextView.swift:277`, `:286`, `:309`, `:349` — правило 7.3.5. Пока безвредно; любая неидемпотентная работа в `pushText` (счётчик, запрос) выполнится дважды. [расходится] [исправлено, #499]
- **Число строк поля считается делением высоты на `lineHeight`** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerTextView.swift:335`, `:107` — правило 7.5.5. На строках из emoji или арабского счёт строк и порог кнопки ⛶ ошибаются. [проверить на iPhone]
- **Снятие цитаты не узнаёт строку `">"` без пробела** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerFormatting.swift:67` — правило 7.4.6. Повторное нажатие «Цитата» на такой цитате добавит второй уровень вместо снятия. [расходится] [исправлено, #499]
- **Код 2FA не приводится к ASCII-цифрам** — `apps/ios/Sources/Features/Auth/LoginModel.swift:81` — правило 7.2.12. Код, набранный арабскими или полноширинными цифрами, сервер отклонит как неверный. [расходится] [исправлено, волна 4]
- **Упоминание `@login` выглядит ссылкой, но не нажимается** — `apps/ios/Sources/Features/Feed/FeedComponents.swift:429-432` — правило 7.6.5. Человек жмёт на «ссылку», и ничего не происходит. [расходится] [исправлено, #499]
- **Превью в списке чатов показывает сырой Markdown** — `apps/ios/Sources/Core/Chats/ChatListQuery.swift:130-135` — правило 7.7.1. В списке видны `**`, `` ` ``, ```` ``` ````; превью в ответе, закрепе и пушах может разойтись. [расходится] [исправлено, #499]
- **«Редактировать» доступно для опроса, чек-листа, стикера и геопозиции** — `apps/ios/Sources/Features/Chats/Thread/ChatThreadModel.swift:473-480`; `apps/ios/Sources/Features/Chats/Thread/Menu/MessageMenuOverlay.swift:94`; сервер `apps/api/src/modules/chats/chats.service.ts:3332` — правило 7.7.13. Правка затрагивает только `content` и может испортить сообщение особого вида. [расходится] [исправлено, #499]
- **Два разборщика ```` ``` ```` с разными правилами** — `apps/ios/Sources/Features/Chats/Thread/MessageCodeBlocks.swift` (`parse`) и `apps/ios/Sources/Features/Community/CommunityCommon.swift:373` — правило 7.6.2. Один и тот же код по-разному выглядит в пузыре и в статье. [расходится] [исправлено, #499]
- **Стили кода и заголовков заданы литералами в видах** — `apps/ios/Sources/Features/Chats/Thread/MessageCodeBlocks.swift:188`, `:197`, `:210`; `apps/ios/Sources/Features/Community/CommunityCommon.swift:423`, `:474` — правило 7.5.12. Поле, предпросмотр и пузырь разойдутся при первой правке типографики. [расходится] [исправлено, #499]
- **Язык блока кода не нормализуется при разборе** — `apps/ios/Sources/Features/Chats/Thread/MessageCodeBlocks.swift:81` — правило 7.6.15. `Swift` и `swift` — разные ключи для будущей подсветки и кешей. [расходится] [исправлено, #499]
- **Веб распознаёт формулы грубой эвристикой** — `apps/web/src/entities/chat/ui/message-content-markdown.tsx:56` — правило 7.6.8. Цены вида `$5-$10` превращаются в формулы. [расходится]
- **iOS-пузырь рисует только строчный Markdown, веб — полный GFM** — `apps/ios/Sources/Features/Feed/FeedComponents.swift:400`; `apps/web/src/entities/chat/ui/message-content-markdown.tsx` — правило 7.6.1. Таблица или заголовок с веба на iPhone видны сырой разметкой; контракт не записан в `docs/PROJECT.md`. [решено: контракт — набор Telegram в `docs/PROJECT.md` §3.6, веб рисует только его, прочее текстом; iOS-пузырь рисует цитаты и списки (`MessageTextBlocks`), волна 5]
- **«Копировать» кладёт исходный Markdown** — `apps/ios/Sources/Features/Chats/Thread/ChatThreadView.swift:810` — правило 7.7.8. В буфер попадают `**` и ```` ``` ````; нужно решить, исходник или видимый текст. [решено: в буфер видимый текст (`MessagePreview.visibleText`), исходник — типом `kz.studenthub.message-markdown`, его берёт вставка в поле ввода (`MessageClipboard`), волна 5]
#### §8. Медиа

- **Плитки пикера качают оригиналы из iCloud** — `apps/ios/Sources/Features/Chats/Thread/Attach/RecentMediaGrid.swift:284-287` — правило 8.4.3. `AssetTile.thumbnail()` просит `.highQualityFormat` с `isNetworkAccessAllowed = true` на каждую плитку: при медиатеке в iCloud прокрутка листа вложений гонит сеть и батарею, плитки долго пустые. [расходится] [исправлено, #499]
- **`PHCachingImageManager` без прогрева** — `apps/ios/Sources/Features/Chats/Thread/Attach/RecentMediaGrid.swift:25` — правило 8.4.4. `startCachingImages` нигде не вызывается: кеширующий менеджер работает как обычный, предзагрузки плиток нет. [расходится] [исправлено, #499]
- **Лист вложений не видит изменений медиатеки** — `apps/ios/Sources/Features/Chats/Thread/Attach/RecentMediaGrid.swift` — правило 8.4.6. Нет `PHPhotoLibraryChangeObserver`: снятый из листа или удалённый в «Фото» снимок появится или пропадёт только при следующем открытии; удалённый может остаться в выборе. [расходится] [исправлено, #499]
- **Выбор снимков сравнивается по объекту `PHAsset`** — `apps/ios/Sources/Features/Chats/Thread/Attach/AttachmentMenuSheet.swift:95`, `RecentMediaGrid.swift:94, 201` — правило 8.4.7. `firstIndex(of:)` по экземпляру: после перевыборки альбома номер на плитке и снятие выбора могут не сработать. [расходится] [исправлено, #499]
- **Живое размытие на каждой плитке «Медиа»** — `apps/ios/Sources/Features/Chats/ChatSharedContentView.swift:645-649` — правило 8.2.6. `LQIP.image(from:)` + `.blur(radius: 12)` вместо `LQIP.blurred(from:)`: лишний проход вне экрана на каждом кадре прокрутки сетки. [расходится] [исправлено, #499]
- **Просмотр не берёт уже загруженную картинку плитки** — `apps/ios/Sources/Features/Feed/MediaViewer.swift:822` — правило 8.5.1. `ZoomableImage` ищет только `media.cacheKey(840)`, а плитка чата лежит под `att:<id>:<points>`/`chatmedia:<id>`: при открытии первым кадром — размытое LQIP вместо чёткой картинки. [расходится] [исправлено, #499]
- **Встроенное видео и просмотр — разные плееры** — `apps/ios/Sources/Features/Feed/MediaViewer.swift:900`, `apps/ios/Sources/Features/Feed/PostMediaView.swift:240` — правило 8.5.2. `ViewerVideo` создаёт новый `AVPlayer(url:)`: ролик грузится заново и стартует с нуля, возможен чёрный кадр. [расходится] [исправлено, #499]
- **Предзагрузка читает оригинал видео без постера** — `apps/ios/Sources/Features/Chats/Thread/AttachmentView.swift:1011` (через `ChatMediaPrefetcher.swift`) — правило 8.6.1. Для видео без постера `ChatMediaImages.load` берёт первый кадр из самого файла по сети ради невидимой плитки — лишний трафик и нагрузка на MinIO. [расходится] [исправлено, #499]
- **«Змейка» при открытии вкладки «Медиа»** — `apps/ios/Sources/Features/Chats/ChatSharedContentView.swift:759-760` — правило 8.3.7. Очередь `ChatMediaThumbnails` — LIFO на 4 слота, плитки встают в порядке появления: экран может заполняться снизу вверх. [проверить на iPhone]
#### §9. Данные, синхронизация, сеть, realtime

Пути — от `apps/ios/Sources` (кроме `apps/api/…`). Всё ниже выведено чтением кода ветки develop на 14.11.2026; тестами и
на устройстве не подтверждалось, если не сказано иное.

- **Догон чата сдаётся на первой ошибке** — `Features/Chats/Thread/ChatThreadModel.swift:1472–1495` — правило 9.3.1. После сбоя `catchUp` ставит `failure` и не повторяет до переподключения или повторного входа в чат: чат «замерзает». [расходится] [исправлено, #499]
- **Обновление списка после переподключения глотает ошибку** — `Core/Realtime/RealtimeCoordinator.swift:379–388` — правило 9.3.1. `try?` без повтора: счётчики и порядок списка остаются устаревшими до следующего события. [расходится] [исправлено, #499]
- **Outbox бесконечно повторяет отказ по существу и блокирует очередь чата** — `Core/Chats/MessageSender.swift:134,162–181` — правило 9.3.1. 403/422 становятся `.failed` и повторяются вечно, а `flush` встаёт на первой неудаче — одно отвергнутое сообщение держит все следующие в этом чате. [расходится] [исправлено, #499]
- **`lastSeq` поднимается без проверки непрерывности** — `Core/Realtime/RealtimeCoordinator.swift:361` (также `Core/Chats/MessageStore.swift:296`) — правило 9.3.2. Пропуск между упавшим догоном и новым сообщением по сокету теряется навсегда. [расходится] [исправлено, #499]
- **Позиция догона читается после того, как насос мог её сдвинуть** — `Features/Chats/Thread/ChatThreadView.swift:545`, `ChatThreadModel.swift:205` — правило 9.3.3. Гонка: сообщения, пропущенные за обрыв, могут не догнаться никогда. [расходится] [исправлено, #499]
- **Страница списка чатов двигает позицию догона** — `Core/Chats/ChatStore.swift:265` — правило 9.3.4. Офлайн-пропуск между старой позицией и превью списка не скачивается; лента разрыв не видит. [расходится] [исправлено, #499]
- **`sinceTs` берётся с часов телефона, `syncedAt` сервера не декодируется** — `Core/Chats/ChatMessagesAPI.swift:7–13`, `ChatThreadModel.swift:1477` (сервер отдаёт `syncedAt`: `apps/api/src/modules/chats/chats.service.ts:1745–1822`) — правило 9.3.5. Правки и удаления в окне расхождения часов пропадают; плюс `take: 200` у `mutated`/`deletedIds` без признака переполнения — вопрос к серверу. [расходится] [исправлено, #499]
- **На overflow история стирается до скачивания новой** — `ChatThreadModel.swift:1479–1486` — правило 9.3.10. Без сети человек остаётся с пустым чатом без офлайн-истории. [расходится] [исправлено, #499]
- **Страница истории только дописывает** — `Core/Chats/MessageStore.swift:17–25` — правило 9.3.12. Удалённое за непокрытое догоном время остаётся в ленте навсегда. [расходится] [исправлено, #499]
- **Стирать или помечать «требует сверки» на overflow** — `ChatThreadModel.swift:1479` — правило 9.3.13. Выбор между стиранием (сейчас) и ленивой сверкой видимого окна. [решено: не стирать, граница `unsyncedBelow` и сверка страниц при прокрутке вверх, волна 5]

- **Непрочитанное растёт на повторное событие** — `Core/Realtime/RealtimeCoordinator.swift:367–370` — правило 9.4.8. Повтор `message:new` после переподключения или после догона завышает счётчик. [расходится] [исправлено, #499]
- **«Печатает» выбирается из словаря случайно** — `Core/Realtime/RealtimeCoordinator.swift:419,468` — правило 9.4.10. При двух печатающих подпись может мигать между ними. [расходится] [исправлено, #499]
- **Отметка прочтения и правка теряются без соединения** — `ChatThreadModel.swift:1264`, `ChatThreadModel.swift:503–516`, `Core/Realtime/RealtimeTransport.swift:86` (socket.io-client-swift отбрасывает `emit` без соединения: `SocketIOClient.swift:309–312`) — правило 9.4.16. Чат возвращается непрочитанным; правка видна только локально и не уходит на сервер. [расходится] [исправлено, #499]
- **Прочтение шлётся из окна истории** — `ChatThreadModel.swift:1247` — правило 9.4.17. В `markRead` нет проверки `isDetached`; последствия зависят от того, двигает ли сервер отметку назад — проверить. [расходится] [исправлено, #499]
- **Смена членства обновляет только первую страницу списка** — `Core/Realtime/RealtimeCoordinator.swift:313` — правило 9.4.18. Чат за пределами первой страницы не обновится. [расходится] [исправлено, волна 4]

- **Поздний ответ откатывает правку** — `Core/Chats/MessageStore.swift:183–190, 214–216` — правило 9.5.1. Страница или догон, ушедшие до `message:updated`, возвращают старый текст. [расходится] [исправлено, #499]
- **Поздний ответ воскрешает удалённое** — `Core/Chats/MessageStore.swift:186, 214–216` — правило 9.5.2. `deletedAt = message.deletedAt` (всегда `nil` в ответах) снимает удаление до следующего догона. [расходится] [исправлено, #499]
- **База откладывается на любую ошибку открытия, прежняя копия удаляется** — `Core/Storage/DatabaseHolder.swift:66–78`, `Core/Storage/AppDatabase.swift:62–70` — правило 9.5.10. `SQLITE_FULL`/`BUSY`/`IOERR` дважды подряд — черновики и неотправленное потеряны навсегда. [расходится] [исправлено, #499]
- **Ключ вложения — только `id` медиа** — `Core/Storage/AppDatabase+Migrations.swift:127–129` — правило 9.5.12. Если сервер повторяет id медиа в пересланной копии, `saveAttachments` упрётся в уникальность и сорвёт запись — проверить на сервере. [расходится]
- **На диск кеша кладётся непроверенный ответ** — `Core/Images/ImageDownloads.swift:99–102` — правило 9.5.16. Не-картинка с правильным `Content-Type` живёт на диске до 7 дней. [расходится] [исправлено, #499]
- **`import GRDB` в 11 файлах `Features`, включая view** — `Features/Chats/ChatListView.swift:1`, `ChatFoldersView.swift:1`, `ChatSearchViews.swift:1`, `Settings/AccountSupportViews.swift:1`, `Study/LessonDetailView.swift:1` и 6 моделей — правило 9.1.2. Слой хранения протекает в UI; запись в черновике правил («один файл») была неверной. [расходится] [исправлено, #499]
- **`UIKit`/`SwiftUI` в `Core`** — `Core/Observability/Observability.swift`, `Core/Push/PushRegistrar.swift`, `Core/Images/DataURLImage.swift`, `Core/Images/ImageDecoding.swift`, `Core/Images/ImageMemoryCache.swift`, `Core/Navigation/Workspace.swift` — правило 9.1.3. Наследие; новых не добавлять. [расходится] [исправлено, #499]

- **Подгрузка страницы повторяется только по кнопке** — `Core/Network/PagedLoader.swift:150` — правило 9.6.9. В тихом экране дыра после сбоя остаётся, пока человек не нажмёт «Повторить». [расходится] [исправлено, #499]
- **Видео не повторяет загрузку и не переподписывает ссылку** — `Features/Feed/PostMediaView.swift:181–240` (`InlineVideoView`), `Features/Feed/MediaViewer.swift:891–900` (`ViewerVideo`) — правило 9.6.13. Истёкший токен `?t=` или обрыв — вечная ошибка воспроизведения. [расходится] [исправлено, волна 4]

- **Продление в полёте переживает выход и вход другого человека** — `Core/Session/SessionStore.swift:314` (`adopt` без сверки), `237–254`, `342–349` — правило 9.7.1. Следующий холодный старт откроет сессию вышедшего; вошедший после него может получить чужой токен. [расходится] [исправлено, #499]
- **Повтор продления не укладывается в окно грации** — `Core/Session/AuthAPI.swift:90` (60 с), `Core/Session/SessionStore.swift:50` (2,5 с), окно 10 с — `apps/api/src/config/env.schema.ts:66` — правило 9.7.2. «Повисший» ответ после ротации даёт ложную «кражу»: выход на всех устройствах. [расходится] [исправлено, #499]

- **Пустое сообщение неизвестного вида — пустой пузырь** — `Core/Chats/ChatListQuery.swift:113`, `Features/Chats/Thread/MessageBubbleView.swift:992` — правило 9.2.8. Старая сборка покажет пустой пузырь и пустое превью вместо «обновите приложение». [расходится] [исправлено, волна 4]
- **Правка затирает черновик чата** — `Features/Chats/Thread/ChatThreadModel.swift:487–506, 1304–1312`, `Features/Chats/Thread/MessageComposerView.swift:150` — правило 9.8.6. Текст правки уходит черновиком на сервер (виден в вебе), исходный черновик теряется. [расходится] [исправлено, #499]
- **Состояние чек-листа из сокета не сохраняется** — `Core/Realtime/RealtimeCoordinator.swift:208–211, 340–341` — правило 9.8.17. После перезапуска пузырь покажет устаревший список из базы. [расходится] [исправлено, #499]
- **Переиспользованная ячейка опроса может показать чужие результаты** — `Features/Chats/Thread/ChatPollView.swift:95` — правило 9.8.18. `task(id:)` по версии сигнала (обычно 0 у всех) не различает опросы. [проверить на iPhone]
- **Результаты опроса перечитываются на каждом появлении** — `Features/Chats/Thread/ChatPollView.swift:95` — правило 9.8.22. Лишние запросы при прокрутке и двойная загрузка одного опроса в двух пузырях. [расходится] [исправлено, волна 4]
#### §10. Безопасность, приватность, вход и выход, ссылки

- **Принятие сессии после QR и пароля без проверки, что поток ещё актуален** — `apps/ios/Sources/Features/Auth/QRSignInView.swift:198–201`, `apps/ios/Sources/Features/Auth/LoginModel.swift:62, 92` — правило 10.1.8. Закрытый лист или «Назад» не мешают позднему `session.adopt`: человек окажется внутри после отмены. [расходится] [исправлено, #499]
- **Выход не останавливает трансляции геопозиции, старт их возобновляет** — `apps/ios/Sources/App/StudentHubApp.swift:23` — правило 10.1.10. Трансляция прежнего человека может продолжиться под следующим аккаунтом. [расходится] [исправлено, #499]
- **`LocalData.erase()` не чистит `chats.liveLocations` и кеш `MessageCodeBlocks`** — `apps/ios/Sources/App/AppSessionModel.swift:162`, `apps/ios/Sources/Features/Chats/Thread/Attach/LiveLocationSharing.swift:33`, `apps/ios/Sources/Features/Chats/Thread/MessageCodeBlocks.swift:106` — правило 10.1.11. Данные и тексты прежнего человека переживают явный выход. [расходится] [исправлено, #499]
- **Сессия переживает удаление и переустановку приложения** — `apps/ios/Sources/Core/Session/SessionStore.swift:89` — правило 10.1.12. Человек, удаливший приложение «чтобы выйти», после установки снова внутри. [решено: признак установки в `UserDefaults`, первый запуск стирает сессию и гасит refresh отложенным выходом, волна 5]
- **Срок QR-входа считается по `Date()`** — `apps/ios/Sources/Features/Auth/QRSignInView.swift:186, 193` — правило 10.1.13. Перевод часов сдвигает истечение кода. [расходится] [исправлено, #499]
- **`Keychain.set` игнорирует результат `SecItemAdd`** — `apps/ios/Sources/Core/Session/SecretStore.swift:80–86` — правило 10.2.2. Незаписанный ротированный refresh-токен → следующий запуск пошлёт погашенный, сервер порвёт цепочку (ложный выход). [расходится] [исправлено, #499]
- **Синтезированное описание у типов с токенами** — `apps/ios/Sources/Core/Session/AccessToken.swift:8`, `apps/ios/Sources/Core/Session/AuthAPI.swift:8`, `apps/ios/Sources/Core/Session/SessionStore.swift:353, 363`, `apps/ios/Sources/App/AppSessionModel.swift:17` — правило 10.2.6. Любой `"\(state)"`, `dump`, `print` или крошка Sentry выдаст JWT/refresh-токен. [расходится] [исправлено, #499]
- **Свободный текст ошибки в хлебной крошке** — `apps/ios/Sources/Core/Observability/Observability.swift:84` — правило 10.2.7. `error.localizedDescription` может нести адрес и детали, уходит в Sentry. [расходится] [исправлено, #499]
- **Сетевые крошки Sentry не выключены, нет `beforeBreadcrumb`** — `apps/ios/Sources/Core/Observability/Observability.swift:28–47` — правило 10.2.8. Sentry Cocoa по умолчанию пишет полные URL запросов (id чатов, поисковые строки) — утечка в трекер. [расходится] [исправлено, #499]
- **Нет единого открывателя ссылок; не-http(s) схемы уходят системе без вопроса** — `apps/ios/Sources/Features/Chats/Thread/MessageBubbleView.swift:854`, `apps/ios/Sources/Features/Feed/FeedComponents.swift` (`RichText`), `apps/ios/Sources/Features/Chats/ChatSharedContentView.swift:775–777` — правило 10.3.4. Проверку «логина» в адресе и подтверждение негде поставить; ссылка из сообщения может молча открыть чужое приложение. [расходится] [исправлено, #499]
- **Подпись превью ссылки берётся из `og:site_name`** — `apps/ios/Sources/Features/Chats/Thread/MessageBubbleView.swift:860` — правило 10.3.5. Чужой сайт может назваться «StudentHub» или банком — фишинг. [расходится] [исправлено, #499]
- **Скрытые markdown-ссылки открываются без подтверждения** — `apps/ios/Sources/Features/Feed/FeedComponents.swift:393–406` — правило 10.3.6. Текст «studenthub.kz» может вести на чужой адрес. [расходится] [исправлено, #499]
- **Сообщения запроса на переписку рисуются с активными ссылками и упоминаниями** — `apps/ios/Sources/Features/Chats/Thread/ChatThreadView.swift:413` (флаг читает только панель, `MessageBubbleView` — нет) — правило 10.4.12. Незнакомец получает кликабельные ссылки до принятия запроса. [решено: `BubbleContext.requestIncoming`: в чужих пузырях ссылки и упоминания — простой текст, без превью ссылок и карточки профиля, волна 5]
#### §11. Доступность

- **Истории переключаются по таймеру и под VoiceOver** — `apps/ios/Sources/Features/Feed/StoriesViews.swift:192` (`paused` без учёта VoiceOver), `:305` — правило 11.3.4. Незрячий не успевает дослушать историю, и её уносит таймер. [расходится] [исправлено, #499]
- **Графики дашбордов без описания для VoiceOver** — `apps/ios/Sources/Features/Admin/AdminDashboardViews.swift:387,414`, `UniversityAdmin/UAdminDashboardView.swift:332,508`, `Dean/DeanDashboardView.swift`, `Career/CareerStaffViews.swift` — правило 11.2.7. `accessibilityChartDescriptor` нигде не задан, и смысл графика может не читаться. [проверить на iPhone]
- **Ошибки входа, возможно, не объявляются** — `apps/ios/Sources/Features/Auth/` (объявления есть только в `DesignSystem/ActionToast.swift:40` и `Chats/Thread/ChatThreadView.swift:243`) — правило 11.3.3. Ошибку, показанную текстом или тряской, VoiceOver может не произнести. [проверить на iPhone]
- **Полоска папок чатов** — `apps/ios/Sources/Features/Chats/ChatListView.swift` / `ChatFoldersModel.swift` — правило 11.2.1. Бейдж непрочитанных может читаться отдельным числом, а не значением вкладки. [проверить на iPhone]
- **Нет подмены VoiceOver для UI-тестов и аудита дерева** — `apps/ios/Sources/Features/Chats/Thread/MessageListView.swift:1171`, `Tests/StudentHubUITests/MockUITestCase.swift` — правила 11.5.1, 11.5.2. Ветку «под VoiceOver» и механические ошибки разметки (элемент без метки, дубль) CI не проверяет. [расходится] [исправлено, волна 4; аудит на mock в ios-nightly мягко (continue-on-error), волна 5]
#### §12. Раскладка под устройства

- **`UIScreen.main` в раскладке** — `apps/ios/Sources/Features/Chats/Thread/Menu/KeyboardFrame.swift:27`, `apps/ios/Sources/Features/Feed/StoriesViews.swift:321`, `apps/ios/Sources/Features/Chats/Thread/Attach/PhotoAssets.swift:187` — правило 12.1.1. API устарел с iOS 16; на внешнем экране или в другой сцене рамка клавиатуры и размер медиа посчитаются не для того экрана. [расходится] [исправлено, волна 4]
- **Чек-лист в пузыре без предела высоты** — `apps/ios/Sources/Features/Chats/Thread/MessageKindViews.swift:265` (сервер допускает 50 пунктов: `packages/shared-schemas/src/chats.ts:670`) — правило 12.4.2. Один чек-лист растягивает пузырь на несколько экранов и раздувает ленту. [расходится] [исправлено, #499]
#### §13. Производительность

- **Счёт альбомов и выборка снимков на главном потоке** — `apps/ios/Sources/Features/Chats/Thread/Attach/PhotoAssets.swift:114-132`, `:177-181` (`PhotoAlbumsModel.load` под `@MainActor`); `apps/ios/Sources/Features/Chats/Thread/Attach/RecentMediaGrid.swift:214-216` (`reloadAssets` → `PhotoAssets.recent()`, до 300 объектов) — правило 13.1.5. При большой медиатеке и множестве альбомов открытие листа вложений подвисает. [расходится] [исправлено, #499]
- **Разбор JSON внутри актора `APIClient`** — `apps/ios/Sources/Core/Network/APIClient.swift:25`, `:66`, `:78` — правило 13.1.8. Большая страница (история, список чатов) задерживает все остальные запросы приложения; влияние не замерено. [расходится] [исправлено, #499]
- **События socket.io обрабатываются на главной очереди** — `apps/ios/Sources/Core/Realtime/RealtimeTransport.swift:52-54` (`config` без `.handleQueue`) — правило 13.1.9. После переподключения пачка событий разбирается на главном и может давать рывки ленты. [расходится, проверить замером] [исправлено, #499]
- **Кадры видео и PhotoKit-плитки отдаются в `Image` без `preparingForDisplay`** — `apps/ios/Sources/Features/Chats/ChatSharedContentView.swift:743`, `apps/ios/Sources/Features/Chats/Thread/AttachmentView.swift:1096`, `apps/ios/Sources/Features/Chats/Thread/Attach/RecentMediaGrid.swift:291` — правило 13.1.4. Первая отрисовка крупного кадра декодирует его на главном (у Telegram ~7 мс на картинку). [расходится] [исправлено, #499]
- **Цвета поля ввода переприсваиваются на каждом проходе SwiftUI** — `apps/ios/Sources/Features/Chats/Thread/Composer/ComposerTextView.swift:63-65` — правило 13.2.6. Лишняя перекраска `textStorage` на каждом обновлении панели, риск оборвать IME-составление. [расходится, проверить на iPhone]
- **Остановка `CADisplayLink` при уходе из чата посреди пружины не проверена** — `apps/ios/Sources/Features/Chats/Thread/MessageListGlide.swift:18`, `:43-49`, `:90-98` — правило 13.2.3. Убегающий display link держит CPU и батарею после закрытия экрана. [проверить на iPhone]
- **Фиксированные 120 Гц для пружины ленты не опробованы** — `apps/ios/Sources/Features/Chats/Thread/MessageListGlide.swift:43` — правило 13.2.2. С диапазоном 60…120 система может опускать частоту примерно до 80 Гц, и пружина на глаз медленнее. [проверить на iPhone]
- **Нет переключателя «принудительный overflow» догона** — `apps/ios/Sources/App/UITesting/MockAPIProtocol.swift:346` (mock всегда отдаёт `overflow: false`); ветка обработки — `apps/ios/Sources/Features/Chats/Thread/ChatThreadModel.swift:1479` — правило 13.7.3. Редкий путь переполнения догона нельзя воспроизвести в приложении по требованию. [расходится]
#### §14. CI, зависимости, внешние загрузки

- **XcodeGen ставится без версии и суммы** — `.github/workflows/ios.yml:98`, `ios-nightly.yml:52`, `ios-snapshots.yml:42`, `ios-release.yml:35` — правило 14.1.1. Новая версия XcodeGen может молча изменить сгенерированный проект. [расходится] [исправлено, #499]
- **Версии SPM-пакетов не зафиксированы** — `apps/ios/.gitignore` (`Package.resolved`), `apps/ios/project.yml:31-43`, `apps/ios/Package.swift:21-22` (`from:`) — правила 14.1.1, 14.1.2. CI и локальная сборка берут свежие миноры GRDB, Socket.IO и Sentry, поэтому сборки невоспроизводимы. [решено: exact/exactVersion, Package.resolved в git, scripts/check_packages.py, Dependabot swift, волна 5]
- **Release собирается другим Xcode, чем тесты** — `.github/workflows/ios-release.yml:24` (`macos-15`, без `DEVELOPER_DIR`) против `Xcode_26.6` в `ios.yml:85`, `ios-nightly.yml:37`, `ios-snapshots.yml:29` — правило 14.1.5. TestFlight-сборка не проходила тот компилятор и SDK, на которых прошли тесты, а для стекла iOS 26 нужен SDK Xcode 26. [расходится] [исправлено, #499]
- **Ключ кеша SPM зависит от всего `project.yml`** — `.github/workflows/ios.yml:106`, `ios-nightly.yml:58`, `ios-snapshots.yml:48` — правило 14.2.1. Любая правка версии или номера сборки зря сбрасывает кеш пакетов. [расходится] [исправлено, #499]
- **Нет стражей со списками исключений** — `apps/ios/scripts/` — правило 14.4.1. Переводы кода (GRDB вне `Core/`, `URLSession`, открытие ссылок) могут незаметно откатываться назад. [решено: check_layers.sh — URLSession и открытие ссылок по allowlist, только сужается, волна 5]
- **Нет удалённого выключателя рискованных функций** — `apps/ios/Sources/App/PerformanceFlags.swift` — правило 14.5.1. Откатить сломанную функцию у пользователей можно только новым выпуском. [решено: `disabledFeatures` в `GET /client-version` из env, `RemoteFeatures` с кешем, видео/трансляция/GIF/стикеры, волна 5]
#### §15. Документация, процесс, работа агентов

- **Список «открыто до выпуска» неполный, `Package.resolved` не закреплён** — `docs/RELEASE_IOS.md:12`, `apps/ios/.gitignore:35`, `apps/ios/README.md:246` — правило 15.7.8. В релизном документе только заглушка `api.example.invalid`; незакреплённые версии SPM и отсутствие иконки всплывут при первой выкладке. [расходится] [список дополнен; `Package.resolved` — решено: закреплён в git, волна 5]
- **Нет карты синхронизации** — `apps/ios/Sources/Core/Realtime/RealtimeCoordinator.swift`, `apps/ios/Sources/Core/Chats/MessageStore.swift`, `apps/ios/Sources/Core/Chats/OutboxService.swift` — правило 15.1.5. Инварианты догона (`lastSeq`, `sinceTs`) размазаны по комментариям, правка синхронизации не обязана их обновлять. [решено: карта `docs/IOS_SYNC_MAP.md`, правка синхронизации обновляет её, волна 5]

---

## Приложение Б. Неприменимое целиком

Блоки и файлы Telegram, в которых правил для нас нет вообще. Общие принципы из них, если были, вынесены в разделы выше. Сгруппировано по тому, какой агент читал файлы.
### Сборка, тесты, окна, безопасные зоны, VoiceOver

- `CLAUDE.md` — «Build» (команда `Make.py`, codesigning-репозиторий, `debug_sim_arm64`): Bazel и их подпись; принцип вынесен в §1.
- `CLAUDE.md` — «Running tests», абзацы про host `cc_test`/`swift_test`, tgcalls `CHECK_TRUE`, `exclude:` в `tgcalls/Package.swift`, перечень ~30 целей `ios_unit_test`: специфика их модулей/Bazel; общий урок «чистые решения тестируются» вынесен.
- `CLAUDE.md` — «Updating the running simulator…», K1/K2/K3 UDID, `md5 -q` фреймворка: симуляторов и фреймворков у нас нет; принципы свежести вынесены.
- `CLAUDE.md` — «Subsystem guides»: InputDec engine, News, InstantPage V2, Message widgets, HLS player, Rust MTProto engine (кроме принципа ложного выхода), Network telemetry, WEB proxy carrier, Postbox self-heal, SQLCipher/FFmpeg, Composer harness, MediaGrid, Profile Media tab, Photo picker grid, libprisma, MetalEngine, GradientBackground soft light: таких подсистем у нас нет.
- `CLAUDE.md` — «Postbox → TelegramEngine»: конкретные таблицы псевдонимов (`PeerId → EnginePeer.Id`, `EngineRaw*`, `MediaResource → EngineMediaResource`), `PostboxImportCheck.py --report`, `AllowedImporters.txt`: Postbox у нас нет; принципы 1–12 перенесены.
- `CLAUDE.md` — «tgcalls Testbench» (Go/Pion SFU, CLI, WAMR, версии звонков 18/19): звонков нет; принцип «отладочное вырезано из релиза» перенесён.
- `Telegram/CLAUDE.md` — «Embedded watch app» (xcodebuild внутри Bazel, `AppleBundleInfo`, `watch_application`, версии часов = версии хоста, bundle id `.watchkitapp`, `"local": "1"`): часов и расширений у нас нет; принципы снимка/кеша/подписи перенесены.
- `build-system/Make/CLAUDE.md` — tart VM, bazel-remote, `TART_PATH`, gRPC-кеш, Rust-суммы: инфраструктура Bazel/GitLab; принципы перенесены.
- `docs/app-unit-tests.md` — описания конкретных целей: TextFormat, Postbox, TelegramCallsUI, маршруты аудио (Headphones/Bluetooth), ChatTextInputPanel Text Size, PeerInfoPaneNode (куда ведёт «View in Chat» — монофорумы), TranslateUI (перевод по пиру/топику), ChatTitleView (замок секретного чата), VideoMessageCamera, UndoUI (тост на Duo), ChatSendStars (топ донатеров), ReactionContextGeometry (стекло хвоста), EntityKeyboard/PasswordSetup (Duo), RichTextEditorMediaView, `dataSizeString` compact, MtProtoKit `swift test`: доменная логика Telegram без аналогов у нас; переносимые уроки вынесены отдельными записями.
- `docs/ui-testing.md` — формат номеров `99966XYYYY`, коды DC, `--delete-test-account`, «OS Environment» тестовых серверов: MTProto-специфика.
- `docs/iphone-duo-layout.md` — таблица поз FP/FL/FR/UP/UL, весь «Layout API» (`reservedCorners`, `sideStrip`, `bottomEdgeSideInsets`, `sideColumnNavigationButtonFrame`, острова, `screenCornerRadii`, `division`, `screenPortraitDeviceOrientation`, камеры), «The rules» 1–8 и 10: устройства iPhone Duo и альбомной ориентации у нас нет (`TARGETED_DEVICE_FAMILY: 1`, только портрет); общие принципы вынесены в §12/§5.
- `docs/superpowers/duo-screen-audit-2026-10.md` — таблица F1–F65, «Bottom buttons and panels span the strip», «Deliberately not changed»: конкретные экраны Telegram на Duo; уроки процесса вынесены.
- `docs/superpowers/specs/2026-09-25-reserved-corners-design.md` — `resolveReservedArea`, правила углов, раскладка панелей, роллаут шагов 1–3: Duo-специфика; урок «обязательный параметр без умолчания» и «переходные системные данные» вынесены.
- `docs/superpowers/plans/2026-09-25-reserved-corners.md` — Tasks 1–5 (BUILD-файлы, код `ReservedArea.swift`, тесты `ReservedAreaTests`, `WindowContent.swift`): реализация под Bazel/Display; уроки процесса вынесены.
- `docs/superpowers/phase6-gate-record-2026-08-24.md` — пункты 1–12, 23, C1–C9 (TK1/TK2, InputDec, `func legacy` residue, D27/D33/D38, дифференциальный корпус): специфика их текстового движка; уроки отчётности вынесены.
- `docs/superpowers/phase6-manual-checklist-record.md` — «Force Text Field v2», установка на K1, таблицы в документе (пункт 9 — таблицы, 7 — цитаты как структура): для нашего простого `UITextView` переложено частично.
- `submodules/TelegramUI/Components/CoreList/AGENTS.md` — «Demo on K2», `org.telegram.CoreListDemo`: демо-приложения нет; принцип «не говорить запущено без проверки» перенесён.
- `docs/accessibility/voiceover-inventory.md` — построчные статусы ~150 экранов Telegram (Premium, Stars, Wallet/TON, Business, истории-камера, QR-студия, прокси, каналы, админы): экранов-аналогов нет; переносимые решения сведены в §11.
- `docs/superpowers/specs/2026-10-27-voiceover-design.md` — «What is wrong today» (ASDK forwarding отключён в `_ASDisplayViewAccessiblity.mm`, `TabBarComponent`), «Infrastructure decisions» п. 1 (переписанный ASDK-сборщик, кеш на оборот run loop): AsyncDisplayKit у нас нет; «Non-goals», «Delivery» (ветка `accessibility`, не трогать `WalletTonConnect.swift`) — их процесс.
- `docs/superpowers/plans/2026-10-27-voiceover.md` — Tasks 3–8 (ASDK collector, `accessibilityUsesViewElements`, `ComponentAccessibility` API, тест-таргеты Bazel), Task 18 (Make.py): реализация под их стек; принципы вынесены.
### Поле ввода, редактор текста, контекстные меню

- `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` — «Core model» (структура `Document`, блоки кода как контейнеры, удаление текста блока,
  отчёт о месте вставки, свежие идентичности фрагментов), «Fragments, paste and RTF» (кроме U+FFFC и
  самоссылок), «Checklist external share», «RTF import», TECH DEBT про `fontSize`, «Private UIKit names» в части
  механизма шифрования — у нас нет своей модели документа и RTF, поле — строка markdown.
- `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` — K-симуляторы, `Scripts/iostest.sh`, `LegacyDifferentialTests`, явные PCM-модули,
  `stat -f %SB`, `sysctlbyname` в симуляторе, `axe`/lldb-приёмы — нет Mac, симулятора и Bazel у нас локально.
- `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` — TextKit 1/2 двойной движок, базовые линии, зазоры блоков,
  код-блоки как полосы, таблицы, медиа-блоки, свёрнутые цитаты, чек-листы в редакторе, свой `UITextInput`,
  подсветка выделения, ручки, лупа, плавающий курсор, свой токенайзер, приватная проверка орфографии, DEBUG-
  оверлей, долг `resolveBox`, порядковый номер `10F` — всё это механика собственного холста; у нас стоковый
  `UITextView`.
- `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/InputBackend/CLAUDE.md` — выбор бэкенда ввода InputDec и передача первого
  ответчика (кроме двух записанных правил) — второго бэкенда ввода нет.
- `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextInputDecObjC/CLAUDE.md` — ядро на приватном UIKit, охранник `NSException`, сертификация
  под одну сборку ОС, сгенерированные таблицы — приватный API у нас запрещён.
- `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextInputDecUpstream/CLAUDE.md` — провенанс вендорного движка, запрет `+load`, наборы
  `InputDecEngine` — нет вендорного кода и Objective-C.
- `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` — роли/формы блоков, мост к движку, ритм и пиксельная сетка,
  правила Backspace по двум дверям, settle, контейнеры/цитаты/details/авторы, таблицы и их хром, медиа-атомы,
  маркеры списков, атомы (emoji, кнопки, формулы), геометрия выделения, перетаскивание как Cut+Paste — всё
  завязано на собственный движок текста.
- `Tests/ComposerHarness/CLAUDE.md` — Bazel-цели, K1/K3, `simctl`, `axe`, переиспользование `BAZEL_TEST_*`,
  ротация через `requestGeometryUpdate` на стенде, конкретные операции фаззера (`keyWalk`, `line`, `move` …),
  генератор заглушек `SharedAccountContext`, кэш `coresymbolicationd` — инструменты Telegram без аналога у нас.
- `docs/richtext-composer.md` — переключатель legacy↔native, InstantPage/`RichTextMessageAttribute`, превью
  долгого нажатия «Отправить» с морфом снимка, отправка/правка «богатых» сообщений, кастомные emoji/упоминания/
  даты как маркеры `tg://`, инлайн-медиа/альбомы/спойлеры/карты/аудио/документы в поле, `MessageMediaPreuploadManager`,
  облачные черновики MTProto, вложенные списки при вставке — у нас нет богатых сообщений и инлайн-медиа в поле.
- `docs/superpowers/richtext-seam-stage2-inheritance.md` — пункт ворот 23, таблица отклонений D11–D39 как
  конкретика шва бэкенда ввода (переносимые уроки записаны выше).
- `docs/context-menu-liquid-morph.md` — разбор UIKitCore в Hopper, `_UIContextMenuLiquidMorphPresentationAnimation`,
  адаптер Objective-C, порталы `_UIReparentingView`, перенос живых видов ASDisplayKit, утверждения видимости через
  приватные селекторы — приватный UIKit и AsyncDisplayKit у нас не используются.
- `submodules/TelegramUI/Components/RichTextEditorMediaView/CLAUDE.md` — переключатель мозаика↔слайдшоу,
  кнопка «+» в редакторе статей, аудио/документ/карта как вложенные виды редактора, история модуля — в нашем
  поле нет медиа-блоков.
### Лента чата, списки, навигационная панель

- `docs/chat/corelist-chat-history-backend.md` — Selection (`ios_killswitch_…`, Debug Settings), From a device
  (`devicectl … flight-trace.txt`): серверного выключателя и файловой трассы у нас нет; принцип перенесён выше.
- `docs/chat/corelist-chat-history-backend.md` — Rotation invariant, Horizontal insets are mirrored (π-зеркалирование
  отступов), `ChatMessageItemView` π, header π: наша лента не перевёрнута.
- `docs/chat/corelist-chat-history-backend.md` — Node hosting (`ListViewItemNode` в `CoreListNodeHostView`,
  `hostOwnsFrame`, `transitionOffset`, порядок `contentSize/insets/apparentHeight`), Deferred items п. 4–5: узлы
  AsyncDisplayKit и хост-виды CoreList; общий принцип (геометрия до кода, меряющего экран) перенесён.
- `docs/chat/corelist-chat-history-backend.md` — Overscroll actions (next-channel control, `holdOverscrollAction`,
  `reanchorDragToCurrentOffset`, `RubberBand.inverse`): у нас нет перехода к следующему каналу оттяжкой; уроки про
  пороги и сообщения о смещении перенесены.
- `docs/chat/corelist-chat-history-backend.md` — Floating headers: `.reservesSpace`, stick factor, `stackingGroup`/
  `stackingYield`, `attachedHeaderNodes`, band trim, `.topEdge`; Pin to bottom edge (стриминг ответа бота,
  `TypingDraftMessageAttribute`, `bottomEdgePinSlack`); Trailing item space (`ChatBotInfoItemNode`); Holding a
  scrolled-to message (рекламные сообщения, `yieldingToNewestEdge` для ленты-канала): у нас нет тем-форумов,
  стриминговых ботов, рекламы; общий принцип защёлок перенесён.
- `docs/chat/corelist-chat-history-backend.md` — Scroll to item: карусель полной замены и `initialGhostWitness`
  (призрачные блоки CoreList); у нас далёкий переход — `crossfade`.
- `submodules/TelegramUI/Components/CoreList/CLAUDE.md` — Scroll-engine seam (`UIKitScrollEngine` на холсте
  10 000 000 pt, `PhysicsScrollEngine`, `KeyframeFlight`), Scroll physics replica (`ReleaseDecision`, `PanRecognizer`,
  формулы из ассемблера), Scroll engine and physics (захват рендер-серверного полёта «подменой», `brakeStopTime`,
  одно-кадровая передача при отпускании, мёртвая ось, множитель повторных взмахов, колесо мыши/трекпад iPad): у нас
  системный `UIScrollView` и только iPhone.
- `submodules/TelegramUI/Components/CoreList/CLAUDE.md` — Virtual content and settled window (`activeWindow`,
  контейнер, `applyShift`), Granular animation contract (`ListAnimationModel`, треки на владельца, ghost blocks,
  carousel exit overlay, viewport mirrors), CoreListTransition (`.customSpring`, `_solveForInput:`, `Curve.solve`
  без зажима 0.997), Resuming from the screen (`resumeValue`, committed base, список откатов), Core Animation output,
  Clocks (`beginTime` неявный/явный, `rebind`, остаток δ, `InsetRectOverlayAnimator`): внутренности собственного
  виртуального списка; у нас `UICollectionView`. Принципы (одна анимация на свойство, старт с экрана, одно «сейчас»)
  перенесены.
- `submodules/TelegramUI/Components/CoreList/CLAUDE.md` — Build/Test (`CoreListDemo.xcodeproj`, симулятор K2), Demo app,
  Attachments (`AttachmentOffsetMap`, кадр и stick-distance на разных смещениях): демо-проект и механизм прикреплённых
  видов CoreList; у нас их нет.
- `submodules/TelegramUI/Sources/CLAUDE.md` — `ChatHistoryListViewBackend`, `ListViewImpl`-расширение, `stationaryItemRange`,
  `scrollGestureHostView` двумя уровнями ниже, Duo/π на обёртке; `.bezier`/`.spring` пресеты `ChatMessageTransitionNode`,
  `ContainedViewLayoutTransitionCurve.customSpring` → CoreList; обратный мост к ComponentFlow: AsyncDisplayKit,
  Display, ComponentFlow у нас не используются.
- `submodules/TelegramUI/Components/News/CLAUDE.md` — Compact/Expanded посты (морф миниатюры в фото галереи, «▶ 0:12»,
  пузырь чата в ленте, `hasTails: false`, константы 20/6/40, вынос фото в галерею, плавающий аватар канала с дырой в
  мягком крае шапки), локальная лента из 40 каналов через Postbox, `dev`/`news_feed_enabled`, щипок для смены режима
  (масштаб `sublayerTransform`, щипок сильнее долгого нажатия), свайп Expand/Collapse, серый цвет компактного текста:
  у нас нет вкладки «Новости» с режимами и каналов; переносимые принципы выписаны выше.
- `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` — механика `NavigationBarComponent`/`NavigationBarNode`:
  стеклянные капсулы, рисуемые над обоими экранами, keyframe-переходы push/pop, `NavigationTransitionSpring`
  (ζ 1/0.85, r 0.3/0.08), правила свайпа назад (зажим 0…1, без перелёта, перехват идущего перехода), карточки с тенью и
  затемнением, перенос нажатия/свечения (`pressRelease`, BigGlow/LittleGlow), пульс (L+16)/L ≤ 1.2, тон 0.3/0.1 с,
  прозрачность фона по долям 0.3, клавиатура при переходе, iPhone Duo-колонка, `NavigationBarNodeLoan`, отложенные
  мелочи этих веток, AXe/zsh/Pillow: у нас системная `NavigationStack` и системный тулбар iOS 26 — переходы, капсулы и
  свайп назад рисует UIKit.
- `docs/superpowers/specs/2026-10-15-navbar-split-right-buttons-design.md` — своя реализация слияния капсул
  (`navigationBarRightSections`, `lendGlass/reclaimGlass`, `GlassBackgroundContainerView` smoothness 12, kick/anchor,
  `renewNativeView`, порядок и тайминги native-сцены Administrators): у нас это делает системный тулбар; перенесены
  измеренное правило группировки и уроки про стекло.
- `docs/superpowers/plans/2026-10-15-navbar-split-right-buttons.md` — шаги Task 0–6 (подмодули из основной копии,
  флаги эталонного приложения, код `NavigationBarRightPill`, `Role.trailing(Int)`, команды `Make.py`, пути
  `/Users/isaac/…`, ссылка на тестовый канал): пересказ плана не переносится; уроки (база до правок, число тестов,
  условные ветки по наблюдению, вспомогательный вид вне поиска по типу, не прочитывать чужое) выписаны выше.
### Медиа, видео, графика

- `third-party/subcodec/CLAUDE.md` — почти весь файл (сборка CMake/SwiftPM, MBS-формат, CAVLC, MuxSurface, патчи
  OpenH264, NEON/EBSP, профилирование `bench_profile`): у нас нет своего H.264-мультиплексора спрайтов; перенесены
  только два общих принципа (цикл профилирования, строгость аппаратного декодера).
- `submodules/MetalEngine/CLAUDE.md` — `MTLBinaryArchive` и тесты на GPU Mac: Metal не используем; перенесён только
  принцип «обход бага Apple закрепляется тестом».
- `submodules/HLSPlayback/CLAUDE.md` + `docs/native-hls-player.md` — разделы D1–D14, «Facts the code depends on» про
  уровни, ABR, abandon, `startNotBefore`, тайминг частей, поиск по опорному кадру, AAC-приминг, лаборатория плеера,
  таблицы замеров: своего HLS-плеера нет, играет `AVPlayer` (одна сводная запись «неприменимо»).
- `submodules/TelegramUI/Components/MediaEditor/CLAUDE.md` — детали видеописателя (VideoToolbox, mp4-муксер FFmpeg,
  DTS, пачки по 0,5 с, резерв `moov`): экспорт делает `AVAssetExportSession`.
- `submodules/ffmpeg/CLAUDE.md` — конкретика сборки FFmpeg (genrule, `ffmpeg_header_paths`, pkg-config-заглушка):
  FFmpeg не вендорим; перенесены принципы обновления зависимостей.
- `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` — разделы «Zoom crossfade» в части уровней 1/3/5/15/31,
  «Rotation» (портрет-только приложение), команды xcodegen/xcodebuild и UDID симулятора, таблица демо-флагов: у нас
  нет масштабируемой сетки, поворота и симулятора; общие уроки перенесены отдельными записями.
### Состояние, синхронизация, локальная БД

- `submodules/TelegramCore/Sources/Network/CLAUDE.md`, «Network telemetry» — отчёт через `help.saveAppLog`, A/B по
  `network_telemetry_variant`, `mtproto-bench replay`, `dropped` для Rust-движка: MTProto-движков и серверной
  телеметрии запросов у нас нет (общие принципы перенесены в §10, §13).
- `docs/state-sync.md` — устройство `AccountStateManager` (8 видов операций, `stateBarrier`/`help.test`, qts и секретные
  чаты, `ChannelResetCoordinator`, `pollChannel`, `invalidatedPts` каналов, `pts_total_limit` и его отладочная
  настройка): MTProto-специфика; общие принципы вынесены в §9.
- `docs/state-sync-audit-2026-10.md` — таблицы конкретных дефектов (C1–C11, R1–R8, D4, G2–G9) и строки кода на
  `171825ce49`: про код Telegram; перенесены только уроки (Q4, Q5, Q13, G1, G7, мёртвый код).
- `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` — §3, §5, §6–§6k (журнал этапов, SHA, счётчики тестов,
  слияния с их master), §6a (план этапа 4), §8 (их команды Bazel): история их проекта; уроки процесса — в §15.
- `docs/superpowers/reports/2026-10-15-difference-too-long-exploration.md` — разбор `pts_total_limit`, хеша `getHistory`
  для пользователей и групп, общего ящика 5 млн, поведения tdlib/Desktop/Android на `differenceTooLong`, памяти
  расширения 24 МБ: протокол MTProto; перенесены принципы (§9, §13, §15).
- `docs/superpowers/reports/2026-10-25-state-sync-truth-run.md` — §6 (порт стенда на их master) и конкретные сиды:
  про их стенд; принцип модели сервера — в §2.
- `submodules/Postbox/CLAUDE.md` — ссылка на правила импорта Postbox (рефакторинг Postbox → TelegramEngine): Postbox у
  нас нет.
- `submodules/sqlcipher/CLAUDE.md` — сборка амальгамы SQLCipher и её `PRAGMA`: SQLCipher нет.
### Безопасность, вход, сеть, звонки, рефакторинг

- `submodules/TgVoipWebrtc/CLAUDE.md` — разделы «SCTP Signaling», «InstanceV2CompatImpl», «GroupInstanceCustomImpl», «GroupInstanceReferenceImpl», «Video Support Pitfalls», «macOS/Linux Build Support»: звонков, WebRTC и SFU нет (общие уроки вынесены в раздел F).
- `docs/superpowers/plans/2026-09-16-tgcalls-mtproto-dtls-slot.md` — Tasks 1–5 (код швов WebRTC, транспорт DTLS, BUILD, команды CLI): звонков нет; уроки процесса вынесены в раздел G.
- `docs/superpowers/specs/2026-10-11-tgcalls-compatimpl-v2-protocol-design.md` — описание протокола 13.0.0 и трансляции в JSEP: звонков нет; уроки вынесены в раздел H.
- `docs/passcode.md` — «Credential format and key hierarchy» (PBKDF2/AES-GCM), «Wallet envelope encryption», «Wallet secret storage lifecycle», «Wallet operations, Rust callbacks», кодек резервной копии фразы: клиентской криптографии и кошелька нет.
- `submodules/TelegramApi/CLAUDE.md` — устройство `TLObject` (MRC, заголовок 24 байта, таблица схемы, списки экспорта, `@_semantics` против специализации): ObjC/C-рантайма и фреймворков у нас нет.
- `submodules/MTProtoRustEngine/CLAUDE.md` — Bazel/Rust-сборка движка (`-Clto`, `crate.annotation`, `-Copt-level=3`), `SwitchingNetworkEngine` macOS: Rust, Bazel и macOS-клиента нет (принципы вынесены в раздел A).
- `submodules/WebProxyTransport/CLAUDE.md` — CSP в `document.head`, геолокация `WKWebView` ниже iOS 27, `_t = 3`/`0x70`-кодирование ссылок прокси: `WKWebView` и прокси нет (принципы — в разделе C).
- `docs/superpowers/postbox-refactor-log.md` — шпаргалки алиасов/обёрток Engine, исходы конкретных волн, перечень модулей без Postbox: Postbox нет (общие правила — в разделе I).
### Отрисовка богатого текста

- `docs/instantpage-richtext.md` — AI streaming animation (маска глифов, стоимость в пунктах ширины, тик display link,
  снипеты): потоковых ответов ИИ в чате нет.
- `docs/instantpage-richtext.md` — Tearing the bubble across a pill (маски `luminanceToAlpha`, порталы обоев,
  `ChatMessageBubbleBackdrop`): нет обоев чата и разрывов фона пузыря.
- `docs/instantpage-richtext.md` — Copy protection (скриншот-защита слоёв, защищённая галерея): защиты содержимого от
  снимков экрана нет; общий принцип «перечитывать изменяемое состояние» вынесен отдельно.
- `docs/instantpage-richtext.md` — FlatBuffers/Postbox-кодеки, `TelegramApi`, конструкторы TL, include-цикл `.fbs`: нет
  FlatBuffers/Postbox/MTProto; общий принцип «туда-обратно» вынесен отдельно.
- `docs/instantpage-richtext.md` — Inline buttons: геометрия пилюль, иконки типов действий, `ReplyMarkupButtonAction`,
  shimmer `.custom`-действий, `performMessageButtonAction`: встроенных кнопок ботов в сообщениях нет; общие
  UIKit/жестовые принципы вынесены.
- `docs/instantpage-richtext.md` — Rich reply quotes: серверный контракт `quote_rich` (слой 232, флаги, коды
  `QUOTE_TEXT_INVALID`): своего сервера с такими цитатами нет; общие принципы (графемы, ось смещений) вынесены.
- `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` — рантайм виджетов (QuickJS, gumbo, LiteHTML-форк,
  профиль CSS, WebIDL, слои UA, бюджеты CPU QuickJS), кошелёк TON, iPad-указатели, мультитач, опрос `widget_id`,
  инлайн-превью ботов: нет HTML-виджетов, платежей и iPad; переносимые принципы (песочница, лимиты, видимость,
  фасад, арбитраж жестов) вынесены отдельными записями.
- `Tests/WidgetHarness/CLAUDE.md` — сборка Bazel, K1/K3-симуляторы, `simctl`, `performFingers`, фикстуры
  `Fixtures/resize`/`wallet`/`preview`: нет Bazel, симуляторов локально и виджетов; принципы стенда вынесены.
### Рантайм виджетов-сообщений

- R — «How it works»: узлы как объекты QuickJS, генератор привязок WebIDL, селекторы, `RenderTree`/`LayerMirror` — свой движок DOM/HTML; у нас нет JS-рантайма и HTML-рендера (общие принципы вынесены в §9/§13).
- R — «Two depth counters», «Stops are final» в части QuickJS (некатчабельная остановка, `wr::Aborted`), правки форка quickjs-ng 1–12 — устройство интерпретатора JS.
- R — «The built-ins», «Intl» (кроме ловушки Foundation-локали), «Canvas 2D», «Web Animations», «CSS animations and transitions», «getComputedStyle», «SVG geometry», «The `CSS` namespace» — реализация веб-стандартов в песочнице; у нас нет.
- R — «Profile enforcement (V4)» в деталях (таблицы профиля, вердикты CSS, хуки twidget edit 29), «Rendering fidelity», «The gumbo fork», WPT-раннер — движок HTML/CSS (принцип «одна функция решения» перенесён).
- R — «The wallet (v0.5.0)» — TON-кошелёк и подпись транзакций; платежей в сообщениях у нас нет (принцип «неизвестный исход — не успех» учтён в §9 «ровно один исход»).
- R — «Limits» строки про парсер/litehtml/QuickJS (глубина билдера, атрибуты gumbo, селекторы, стиль-байты, `<use>`, математика CSS) и «resulting transient-heap bounds» — пределы чужого движка.
- S13 §1, §4 — интеграция в InstantPage V2/`ChatMessageRichDataBubbleContentNode`, Bazel-цели, `-stack_size` главного потока для QuickJS — структура Telegram и JS-стек.
- S19 §4 п. 1, §5 V1 — слой TL 233, `messageMediaWidget`, Postbox-кодирование, `generate-swiftpm.sh` — MTProto/Postbox.
- S26 §5 W2–W3 — `updateMessageWidgetData` в pts-ящике, inline-результаты ботов, `ChatContextResultMessage` — MTProto и боты.
- S29 — правки QuickJS (`JS_INTERRUPT_COUNTER_INIT`, удаление work units), `CpuBudget` апстрима в деталях — лимиты интерпретатора JS (принципы CPU-часов и дросселя перенесены в §13).
- P — Tasks 1–6, 8–13 (пошаговое вендорение quickjs-ng/litehtml, правки flex `gap`, draw token, C API `mwc_*`, порт `SandboxEngine`, InstantPage V2 item, `DebugController` `stableId` по порядку добавления в ItemList) — конкретные шаги плана для чужого движка и UI-фреймворка Telegram (ItemList/AsyncDisplayKit у нас нет).

---

## Приложение В. Покрытие первоисточника

Каждый из 90 файлов правил Telegram-iOS прочитан целиком. «Разделы» — где на него ссылаются правила; «Б» — файл или его часть попали в приложение Б.

| Файл Telegram-iOS | Разделы | Б |
|---|---|---|
| `AGENTS.md` | §1, §2, §3, §9, §10, §11, §14, §15 | да |
| `CLAUDE.md` | §1, §2, §3, §4, §5, §6, §7, §8, §9, §10, §11, §12, §13, §14, §15 | да |
| `Telegram/CLAUDE.md` | §1, §5, §14, §15 | да |
| `Tests/ComposerHarness/CLAUDE.md` | §1, §2, §7, §13, §15 | да |
| `Tests/WidgetHarness/CLAUDE.md` | §1, §2, §10, §13 | да |
| `build-system/Make/CLAUDE.md` | §1, §4, §14 | да |
| `build-system/bazel-patches/CLAUDE.md` | §2 | да |
| `docs/accessibility/voiceover-inventory.md` | §11, §15 | да |
| `docs/app-unit-tests.md` | §2, §5, §6, §7, §8, §9, §10 | да |
| `docs/chat/corelist-chat-history-backend.md` | §2, §3, §5, §6, §13, §15 | да |
| `docs/context-menu-liquid-morph.md` | §3, §10, §13 | да |
| `docs/instantpage-richtext.md` | §2, §3, §4, §5, §6, §7, §8, §9, §10, §12, §13, §15 | да |
| `docs/ios27-windows-and-touches.md` | §5, §15 | да |
| `docs/iphone-duo-layout.md` | §2, §5, §11, §12 | да |
| `docs/message-widgets-native-runtime.md` | §2, §5, §7, §9, §10, §11, §12, §13, §15 | да |
| `docs/native-hls-player.md` | §2, §3, §5, §8, §9, §10, §13, §14, §15 | да |
| `docs/passcode.md` | §2, §7, §9, §10 | да |
| `docs/richtext-composer.md` | §5, §7, §8, §9, §15 | да |
| `docs/state-sync-audit-2026-10.md` | §9, §13, §15 | да |
| `docs/state-sync.md` | §2, §4, §9, §13, §15 | да |
| `docs/superpowers/2026-10-14-navbar-transitions-handoff.md` | §1, §2, §5, §13, §15 | да |
| `docs/superpowers/duo-screen-audit-2026-10.md` | §5, §12, §15 | да |
| `docs/superpowers/handoffs/2026-10-16-state-sync-handoff.md` | §2, §9, §15 | да |
| `docs/superpowers/phase6-gate-record-2026-08-24.md` | §2, §15 | да |
| `docs/superpowers/phase6-manual-checklist-record.md` | §1, §7, §13, §15 | да |
| `docs/superpowers/plans/2026-09-16-tgcalls-mtproto-dtls-slot.md` | §1, §2, §9, §10 | да |
| `docs/superpowers/plans/2026-09-25-reserved-corners.md` | §2, §5, §15 | да |
| `docs/superpowers/plans/2026-10-13-message-widgets.md` | §1, §2, §5, §10, §15 | да |
| `docs/superpowers/plans/2026-10-15-navbar-split-right-buttons.md` | §1, §2, §5, §15 | да |
| `docs/superpowers/plans/2026-10-27-media-grid-stage1.md` | §2, §5, §6, §8, §13, §15 | да |
| `docs/superpowers/plans/2026-10-27-media-grid-thumbnail-store.md` | §2, §8, §9, §13 | да |
| `docs/superpowers/plans/2026-10-27-media-picker-grid-stage2.md` | §2, §4, §5, §8, §15 | да |
| `docs/superpowers/plans/2026-10-27-voiceover.md` | §11, §15 | да |
| `docs/superpowers/plans/2026-10-28-shared-media-grid-stage1.md` | §2, §6, §10, §15 | да |
| `docs/superpowers/postbox-refactor-log.md` | §2, §9, §13, §15 | да |
| `docs/superpowers/reports/2026-10-15-difference-too-long-exploration.md` | §9, §13, §15 | да |
| `docs/superpowers/reports/2026-10-15-state-sync-q13-poll-result-loss.md` | §2, §9 | да |
| `docs/superpowers/reports/2026-10-25-state-sync-truth-run.md` | §2, §9 | да |
| `docs/superpowers/richtext-seam-stage2-inheritance.md` | §4, §7, §9, §15 | да |
| `docs/superpowers/richtext-stock-divergences-followups.md` | §2, §7, §13, §15 | да |
| `docs/superpowers/specs/2026-09-16-tgcalls-mtproto-dtls-slot-design.md` | §2, §9, §15 | да |
| `docs/superpowers/specs/2026-09-25-reserved-corners-design.md` | §4, §5 | да |
| `docs/superpowers/specs/2026-10-11-tgcalls-compatimpl-v2-protocol-design.md` | §2, §9, §15 | да |
| `docs/superpowers/specs/2026-10-13-message-widgets-design.md` | §1, §2, §5, §9, §10, §11, §12, §13, §15 | да |
| `docs/superpowers/specs/2026-10-15-navbar-split-right-buttons-design.md` | §1, §2, §5, §15 | да |
| `docs/superpowers/specs/2026-10-19-message-widgets-v0.1.0-client-design.md` | §2, §5, §7, §9, §10, §11, §12, §15 | да |
| `docs/superpowers/specs/2026-10-26-message-widgets-v0.2-design.md` | §2, §9, §10, §15 | да |
| `docs/superpowers/specs/2026-10-27-media-grid-thumbnail-store-design.md` | §8, §9, §15 | да |
| `docs/superpowers/specs/2026-10-27-media-picker-grid-design.md` | §6, §8, §13, §15 | да |
| `docs/superpowers/specs/2026-10-27-media-picker-grid-stage2-design.md` | §2, §5, §14, §15 | да |
| `docs/superpowers/specs/2026-10-27-voiceover-design.md` | §11, §15 | да |
| `docs/superpowers/specs/2026-10-28-shared-media-grid-design.md` | §6, §8, §9 | да |
| `docs/superpowers/specs/2026-10-29-message-widgets-cpu-clock-limits-design.md` | §1, §2, §9, §13, §15 | да |
| `docs/ui-testing.md` | §2, §10 | да |
| `submodules/GradientBackground/CLAUDE.md` | — | да |
| `submodules/HLSPlayback/CLAUDE.md` | §2, §8, §9, §10, §13 | да |
| `submodules/InstantPageUI/CLAUDE.md` | §7, §9, §15 | да |
| `submodules/MTProtoRustEngine/CLAUDE.md` | §1, §9, §10, §13 | да |
| `submodules/MediaPickerUI/CLAUDE.md` | §2, §5, §8, §9, §15 | да |
| `submodules/MetalEngine/CLAUDE.md` | §2 | да |
| `submodules/Postbox/CLAUDE.md` | §9 | да |
| `submodules/TelegramApi/CLAUDE.md` | §1, §2, §9, §10 | да |
| `submodules/TelegramCore/Sources/Network/CLAUDE.md` | §10, §13 | да |
| `submodules/TelegramCore/Sources/State/CLAUDE.md` | §2, §4, §9, §15 | да |
| `submodules/TelegramCore/Sources/TelegramEngine/Messages/CLAUDE.md` | §9, §13 | да |
| `submodules/TelegramUI/Components/CoreList/AGENTS.md` | §3, §15 | да |
| `submodules/TelegramUI/Components/CoreList/CLAUDE.md` | §2, §3, §5, §6, §13, §15 | да |
| `submodules/TelegramUI/Components/MediaEditor/CLAUDE.md` | §9, §13 | да |
| `submodules/TelegramUI/Components/MediaGrid/CLAUDE.md` | §1, §2, §5, §6, §8, §9, §12, §13 | да |
| `submodules/TelegramUI/Components/MessageWidget/CLAUDE.md` | §2, §3, §5, §6, §7, §8, §9, §10, §11, §12, §13, §14 | да |
| `submodules/TelegramUI/Components/News/CLAUDE.md` | §2, §5, §9, §15 | да |
| `submodules/TelegramUI/Components/PeerInfo/PeerInfoVisualMediaPaneNode/CLAUDE.md` | §2, §5, §9, §15 | да |
| `submodules/TelegramUI/Components/RichTextEditor/CLAUDE.md` | §1, §2, §5, §7, §10 | да |
| `submodules/TelegramUI/Components/RichTextEditor/Host/Engine/AGENTS.md` | §2 | да |
| `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/CLAUDE.md` | §4, §5, §7, §10, §13 | да |
| `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEditorUIKit/InputBackend/CLAUDE.md` | §2, §15 | да |
| `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextEngineEditor/CLAUDE.md` | §2, §5, §7, §11, §13 | да |
| `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextInputDecObjC/CLAUDE.md` | §1 | да |
| `submodules/TelegramUI/Components/RichTextEditor/Sources/RichTextInputDecUpstream/CLAUDE.md` | §1 | да |
| `submodules/TelegramUI/Components/RichTextEditorMediaView/CLAUDE.md` | §5, §6, §8, §12 | да |
| `submodules/TelegramUI/Sources/CLAUDE.md` | §5, §6, §10 | да |
| `submodules/TelegramUIPreferences/CLAUDE.md` | §9 | да |
| `submodules/TgVoipWebrtc/CLAUDE.md` | §1, §2, §5, §8, §9, §13, §15 | да |
| `submodules/UrlWhitelist/CLAUDE.md` | §2, §10 | да |
| `submodules/WebProxyTransport/CLAUDE.md` | §5, §9, §10 | да |
| `submodules/ffmpeg/CLAUDE.md` | — | да |
| `submodules/sqlcipher/CLAUDE.md` | — | да |
| `third-party/libprisma/CLAUDE.md` | §10, §14 | да |
| `third-party/subcodec/CLAUDE.md` | §8, §13 | да |
| `tools/animation_sheet.py` | §3 | да |
