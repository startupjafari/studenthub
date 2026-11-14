# Карта синхронизации iOS

Живой документ (`docs/IOS_RULES.md` 15.1.5): описывает код синхронизации переписки iOS-клиента
**как он есть сейчас**. Правка синхронизации обновляет эту карту в том же коммите. Датированные
аудиты — отдельными документами, не здесь.

Пути ниже — от `apps/ios/Sources/`, тесты — от `apps/ios/Tests/StudentHubTests/`.

## 1. Источники правды

| Что | Где правда | Где копия на устройстве |
|---|---|---|
| Сообщения, правки, удаления | сервер (`Message`, `seq` по чату) | GRDB `message` — `Core/Storage/Records.swift` (`MessageRecord`) |
| Строка чата, превью, счётчик | сервер (`GET /chats`, `GET /chats/:id`) | GRDB `chat` (`ChatRecord`) |
| Неотправленное | устройство (до подтверждения) | `message` с `sendState = pending/failed`, `remoteId = nil` |
| Сессия | сервер (refresh-токен) | связка ключей — `Core/Session/SessionStore.swift` |

Экраны читают **только базу**: лента — `Core/Chats/ChatThreadQueries.swift`, список —
`Core/Chats/ChatListQueries.swift`. В базу пишут только хранилища: `Core/Chats/MessageStore.swift`
(история и догон), `Core/Chats/ChatStore.swift` (список), `Core/Realtime/RealtimeCoordinator.swift`
(сокет), `Core/Chats/MessageSender.swift` (`MessageOutbox`, своё неотправленное). Страж слоёв —
`apps/ios/scripts/check_layers.sh`.

## 2. Позиции

| Поле `ChatRecord` | Смысл | Кто двигает |
|---|---|---|
| `lastSeq` | номер последнего известного сообщения — превью и границы окна ленты | список (только вверх), сокет, страницы, догон |
| `syncSeq` | до какого номера переписка в базе **непрерывна** — `?since=` догона | только `SyncPosition` (`Core/Chats/SyncPosition.swift`): догон, непрерывная страница, сообщение строго по порядку |
| `syncedAt` | серверный момент прошлого догона — `?sinceTs=` следующего | ответ догона (`syncedAt`), первая страница несверенного чата |
| `unsyncedBelow` | граница «несверенного» после `overflow`: подтверждённое ниже неё может быть удалено на сервере | `MessageStore.resetAfterOverflow` ставит, `revalidate` опускает и снимает, `clearHistory`/`replaceHistory` снимают |

`syncSeq = 0` — чат ни разу не сверялся: открытие скачает последнюю страницу, и позиция начнётся с неё
(`isHead`).

## 3. Входы данных и пути догона

1. **Сокет** (`RealtimeCoordinator.handle`): `message:new` / `message:updated` → `save` — позиция
   двигается только по порядку; сообщение через разрыв сохраняется, но позицию не двигает и поднимает
   `ChatSignals.gapVersion` — открытый чат догоняет (`ChatThreadView` → `ChatThreadModel.catchUp`).
   `message:deleted` — мягкое удаление (`deletedAt`). `messages:hidden` — `MessageStore.removeHidden`.
2. **Переподключение** (`.connected`): вход в комнату заново, досылка несделанного (§6), обновление
   первой страницы списка (`scheduleListRefresh`). Открытый чат догоняет себя сам
   (`ChatThreadModel.catchUpAfterReconnect`).
3. **Открытие чата** (`ChatThreadModel.open` → `syncOnOpen`): позиции нет или истории меньше страницы —
   последняя страница (`fetchLatest`, со сверкой 9.3.12), иначе догон.
4. **Догон** (`ChatThreadModel.catchUp` → `catchUpPass`): `GET /chats/:id/updates?since=syncSeq&sinceTs=syncedAt`
   (`Core/Chats/ChatMessagesAPI.swift`). Ответ — `created`, `mutated`, `deletedIds`, `latestSeq`,
   `syncedAt`, `overflow`. Применяется одной транзакцией `MessageStore.apply`: сначала правки и новые,
   потом удаления; позиция — на `latestSeq`, отметка — на `syncedAt`. Повторный вызов во время прохода
   ставит ещё один проход (`catchUpAgain`).
5. **Страницы истории**: вверх — `loadOlder` (сначала база, `lowerFloorFromDatabase`, потом сеть),
   вниз из окна истории — `loadNewer`, переход к дате/сообщению — `replaceHistory` (окно вместо истории,
   `DetachedWindows`).
6. **Список чатов** (`ChatStore`): строки и превью; `lastSeq` только растёт, `syncSeq`, `syncedAt`,
   `unsyncedBelow` список не трогает.
7. **Пуш** (`Core/Push`): тихий пуш догоняет список; переписку догоняет открытие чата.

## 4. Разрыв и `overflow`

- **Разрыв** (сообщение через пропуск по `seq`): см. §3.1 — позиция стоит, догон идёт с неё.
- **`overflow`** — разрыв больше серверного лимита, поштучно не догнать (`catchUpPass`):
  1. Скачивается последняя страница. Не вышло — база не тронута, человек видит свою офлайн-историю
     (9.3.10).
  2. `MessageStore.resetAfterOverflow` одной транзакцией: страница ложится поверх; подтверждённое в
     диапазоне `[низ страницы, max(верх страницы, latestSeq)]`, лежавшее в базе до запроса и не
     пришедшее, помечается удалённым; позиция — на верх, `syncedAt` — из ответа догона.
  3. Ниже страницы история **не стирается** (9.3.13): `unsyncedBelow` = низ страницы. Страница — вся
     переписка (`hasNext = false`) — сверено всё, граница не ставится.
  4. Окно ленты поднимается до границы: несверенное не показывается, пока его не сверят.
- **Ленивая сверка несверенного** (`ChatThreadModel.revalidateOlder` → `MessageStore.revalidate`):
  прокрутка вверх при наличии границы сначала просит страницу **под границей** (курсор — id сообщения
  на границе, `MessageStore.unsyncedBoundary`). Сверяется весь промежуток `[низ страницы, граница)`, не
  только min…max страницы; граница опускается до низа страницы, на начале переписки снимается.
  Окно опускается вслед. Сети нет — окно опускается по базе, и несверенное показывается как есть.
  Ответ, пришедший после нового `overflow`, чужую границу не двигает.
- **Явная очистка истории** (меню чата, `ChatListModel` / `ChatInfoView` → `MessageStore.clearHistory`)
  стирает отправленное и сбрасывает позиции и границу — это не `overflow`.
- При повторном открытии (`initialFloor`) окно тоже не опускается ниже `unsyncedBelow`.

## 5. Своё неотправленное (outbox) и отказы

- Отправка пишет строку `pending` с локальным id и `nonce` (`MessageOutbox`, `Core/Chats/MessageSender.swift`).
  Подтверждение — по ответу или по эху сокета с тем же `nonce` (`MessageStore.confirm`).
- Досылка — `Core/Chats/OutboxService.swift`: по подключению сокета, возврату на передний план и смене
  сети; пауза 2 → 60 с с разбросом ±20 %. Чаты независимы; внутри чата порядок сохраняется (`flush`
  останавливается на первой временной неудаче). Повтор безопасен: тот же `nonce`.
- Отказ по существу (4xx) — `sendRejected = true`: очередь его пропускает и сама не повторяет, человеку —
  «Повторить». Вложения сервис не досылает (только «Повторить»).
- Неотправленное не трогают ни сверка страниц, ни `overflow`, ни очистка истории, ни окно истории.

## 6. Досылка прочтений, правок и удалений

- Без соединения socket.io событие молча теряет, а база уже изменена. `RealtimeCoordinator` копит
  `unsentReads` (последнее на чат), `unsentEdits` (последний текст), `unsentDeletes` и досылает на
  `.connected` (`flushUnsent`): сначала правки и удаления, потом прочтения.
- Прочтение — до последнего видимого чужого (`ReadVisibility`), не чаще раза в 800 мс, хвост пачки
  досылается после паузы (`ChatThreadModel.markRead`, `markReadRetry`). Из окна истории не шлётся.
- Поздний ответ не откатывает свежее: правка — по `editedAt` (`MessageStore.isEdit`), удалённое не
  воскресает (`keepFresherState`).

## 7. Выход из аккаунта и переустановка

- **Выход** (`App/AppSessionModel.signOut`): сначала `RealtimeCoordinator.stop()` (рвёт сокет, забывает
  несделанное прежнего человека и всё в памяти), трансляции геопозиции, пуши, затем
  `SessionStore.signOut` (без сети — отложенный выход, `completePendingLogouts`), затем
  `LocalData.erase()` — база, кеши, файлы outbox.
- **Сессия кончилась** (отказ продления): сокет и память гасятся, база остаётся — её сотрёт
  `LocalData.claim`, если войдёт другой человек.
- **Переустановка** (10.1.12): связка ключей переживает удаление приложения. Признак установки —
  `Core/Session/InstallationMarker.swift` (`UserDefaults`, отличает новую установку от обновления по
  каталогу базы). Первый запуск новой установки в `SessionStore.restore` стирает сессию до продления, а
  refresh-токен гасит отложенным выходом фоном.

## 8. Инварианты

| # | Правило | Зачем | Где | Что держит |
|---|---|---|---|---|
| I1 | `syncSeq` двигается только непрерывным куском | иначе пропущенное между позицией и куском не скачается никогда | `SyncPosition.step`, `MessageStore.advance`, `RealtimeCoordinator.save` | `ChatSyncIntegrityTests.testPositionAdvancesOnlyByContinuousPiece`, `RealtimeCoordinatorTests.testPositionMovesOnlyInOrderAndGapSignalsOpenChat` |
| I2 | Список не двигает `syncSeq` | превью — не история | `ChatStore` | `ChatSyncTests.testListPageDoesNotMoveSyncPosition` |
| I3 | Поздний ответ догона не откатывает позицию сокета | позиция только растёт | `MessageStore.apply` (`max`) | `RealtimeCoordinatorTests.testSocketAdvanceDuringCatchUpSurvivesStaleResponse` |
| I4 | `sinceTs` — по часам сервера | расхождение часов теряло бы правки | `MessageStore.catchUpMark` | `ChatSyncIntegrityTests.testCatchUpTakesPositionAndMarkFromResponse`, `testMarkFallsBackToNewestConfirmedMessage` |
| I5 | Удаление мягкое; удалённое не воскресает | позиции соседей не прыгают; поздняя страница не возвращает удалённое | `MessageStore.apply`, `upsert` | `MessageSyncTests.testUpdatesMarkDeletionInsteadOfErasing`, `ChatSyncIntegrityTests.testLateAnswerDoesNotResurrectDeleted` |
| I6 | Старая правка не откатывает свежую | порядок ответов не гарантирован | `MessageStore.isEdit` | `ChatSyncIntegrityTests.testLateAnswerDoesNotRollBackEdit` |
| I7 | Сверка страницы помечает только покрытый диапазон и только бывшее в базе до запроса, своё не трогает | иначе пришедшее во время запроса и своё неотправленное помечались бы удалёнными | `MessageStore.reconcile` | `ChatSyncIntegrityTests.testPageReconcilesOnlyCoveredRangeAndRowsKnownBeforeRequest`, `testPageReconcileSkipsOwnRows` |
| I8 | `overflow` не стирает историю; несверенное ниже границы сверяется страницами до границы | офлайн-история и прочитанное не пропадают, удалённое всё равно уходит | `MessageStore.resetAfterOverflow`, `revalidate`, `ChatThreadModel.revalidateOlder` | `ChatSyncIntegrityTests.testOverflowKeepsHistoryAndMarksItUnsynced`, `testRevalidationSweepsDownToBoundaryAndClearsAtStart`, `testRevalidationKeepsNewerBoundary`, `RealtimeCoordinatorTests.testOverflowKeepsHistoryAndRevalidatesOnScroll` |
| I9 | Явная очистка сервером стирает и снимает границу | человек просил стереть | `MessageStore.clearHistory` | `ChatSyncIntegrityTests.testServerClearStillErasesHistory`, `MessageSyncTests.testClearHistoryKeepsPendingMessages` |
| I10 | Outbox: порядок внутри чата, чаты независимы, отказ по существу не блокирует и не повторяется, повтор — тот же `nonce` | без дублей и без застрявшей очереди | `MessageOutbox.flush`, `OutboxService` | `OutboxServiceTests.testFailingChatDoesNotBlockOthers`, `MessageSyncTests.testRejectedMessageDoesNotBlockQueueAndIsNotRetriedAutomatically`, `testRetrySendsSameNonceAsFirstAttempt` |
| I11 | Сделанное без соединения досылается на подключении; после выхода — не досылается | socket.io без соединения теряет события; чужое следующему не шлём | `RealtimeCoordinator.flushUnsent`, `stop` | `RealtimeCoordinatorTests.testReadAndEditWithoutConnectionAreSentOnConnect`, `testSignOutDuringListRefreshDropsRequest` |
| I12 | Переустановка не открывает прежнюю сессию; обновление — открывает | «удалил, чтобы выйти» | `SessionStore.restore`, `InstallationMarker` | `SessionStoreTests.testFreshInstallForgetsKeychainSessionAndRevokesIt`, `testCheckedInstallKeepsSessionAndLockedKeychainDefersCheck`, `testDefaultsMarkerTellsFreshInstallFromUpdate` |
| I13 | Догон в окне истории не идёт; окно сменяется свежим только целиком | разница от верха окна — вся «дыра» до свежего | `ChatThreadModel.catchUpAfterReconnect`, `resetToLatest` | тестом не закреплено |

## 9. Цена

- Догон — один `GET …/updates` на открытие/переподключение открытого чата; ложная тревога разрыва
  (номер съели удалённые) стоит одного пустого ответа.
- `overflow` — плюс одна страница; ленивая сверка — по странице на каждую догрузку вверх, пока граница
  не дойдёт до начала переписки (страницы, которые всё равно грузились бы при прокрутке).
- Переподключение — одна первая страница списка, а не по запросу на чат.

## 10. Открытые проблемы

- **S1** — без оконного наблюдения (`PerformanceFlags.chatWindowedObservation = false`) несверенное
  видно сразу, а сверка идёт по странице на каждую догрузку вверх от верха загруженного
  (`ChatThreadModel.revalidateOlder`).
- **S2** — пропуск между соседними страницами истории без границы несверенного не сверяется: сверка
  9.3.12 покрывает только `min…max` страницы (`MessageStore.reconcile(chatID:with:upTo:in:)`).
- **S3** — журнала недавних удалений нет (9.5.2): удалённое, пока страница в пути, держится только
  отметкой `rowid` до запроса.

## 11. Исправлено

- `overflow` стирал историю до скачивания новой — теперь сначала страница, потом сверка (#499, 9.3.10).
- `overflow` стирал историю вовсе — теперь ленивая сверка (волна 5, 9.3.13).
- Сессия переживала переустановку (волна 5, 10.1.12).
