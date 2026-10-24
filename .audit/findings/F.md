## Группа F — аудит

### Статусы процессов

| Процесс                                       | Статус                | Коротко                                                                                                                                                                                                                          |
| --------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 Личный чат и запрос на переписку         | работает с проблемами | Дубль личного чата и «Сохранённых» при гонке (F-F05); квота запроса обходится удалением, PRIVATE «с собой», 500 у платформенной роли (F-F24)                                                                                     |
| F-02 Пользовательские группы                  | работает с проблемами | Бан не закрывает глобальный поиск (F-F01); удаление группы и бан без живых сигналов (F-F17); правка после исключения (F-F16); аватар удаляется до проверки нового (F-F21)                                                        |
| F-03 Вступление по ссылке                     | работает с проблемами | Нет `member_added`/сигналов участникам, двойной вход → 500 (F-F17)                                                                                                                                                               |
| F-04 Официальные авто-чаты                    | работает с проблемами | Дубли чатов группы/факультета при одновременной первой загрузке (F-F05); «удалить» официальный чат бесполезно — вернётся через 10 мин (F-F17)                                                                                    |
| F-05 Отправка, ответ, правка, удаление        | работает с проблемами | На каждое сообщение — `chat:activity` всем и полный перезапрос списка (F-F02), строка уведомления и письмо каждому (F-F07, F-F08); правка без членства (F-F16); накладные расходы в больших чатах (F-F22); превью ссылок (F-F29) |
| F-06 Вложения                                 | работает с проблемами | Отказ вложения оставляет пустое сообщение с seq (F-F04); вложения удалённых сообщений хранятся вечно (F-F21)                                                                                                                     |
| F-07 Прочтение и догон                        | работает с проблемами | Отметка по `createdAt`, не по `seq` (F-F14); реконнект сбрасывает историю (F-F13); поток прочтений → N×M перезапросов (F-F22)                                                                                                    |
| F-08 Реакции, опросы, закреп, пересылка, пост | работает с проблемами | Гонка реакции → 500, голос в удалённом опросе, закрыть опрос нечем, карточка поста шире его аудитории (F-F24, F-F19)                                                                                                             |
| F-09 Отложенные сообщения                     | работает с проблемами | Клиента нет ни на одной платформе; при сбое текст уходит в push/почту (F-F19)                                                                                                                                                    |
| F-10 Список чатов, папки, архив, мьют         | работает с проблемами | Запрос списка читает ВСЕ сообщения чатов страницы (нет LIMIT) и повторяется целиком на каждое событие (F-F02); заглушённые чаты в бейдже (F-F14)                                                                                 |
| F-11 Поиск, медиа, выдача, экспорт            | работает с проблемами | Забаненный читает группу глобальным поиском (F-F01, P0); ILIKE без индекса, экспорт — старейшие 5 000 и без учёта очистки (F-F23)                                                                                                |
| F-12 Блокировки, очистка, удаление у себя     | работает              | Мелкое: вырезанные периоды не учитываются в счётчике и в выдаче вложения (F-F14, F-F23)                                                                                                                                          |
| F-13 «Печатает» и присутствие                 | работает с проблемами | Присутствие веером на весь вуз (F-F12); `chat:action` без членства в больших чатах и без лимита (F-F15); «вечный онлайн» при гонке (F-F18)                                                                                       |
| F-14 Поддержка платформы                      | работает с проблемами | Дописка автора из «Чатов» не переоткрывает обращение и не будит команду (F-F03); склеенная ветка (F-F27); очередь читает все сообщения обращений (F-F02)                                                                         |
| F-15 Конвейер уведомлений                     | работает с проблемами | Строка на каждое сообщение без чистки (F-F07); письма на каждое сообщение (F-F08); зависший push стопорит очередь (F-F10); упавшие job'ы вечно в Redis (F-F20)                                                                   |
| F-16 Колокольчик                              | работает с проблемами | Засыпан уведомлениями о сообщениях, прочтение чата их не гасит, тост на каждое (F-F07)                                                                                                                                           |
| F-17 Настройки уведомлений                    | работает с проблемами | iOS не может изменить ни одной настройки (F-F09); email по умолчанию на всё (F-F08); `systemEnabled` пустой (F-F25)                                                                                                              |
| F-18 Web Push                                 | работает с проблемами | Без таймаутов отправки (F-F10); без группировки, открытая вкладка гасит пуш (F-F25); тестов нет (F-F28)                                                                                                                          |
| F-19 Мобильные пуши                           | сломан                | По умолчанию выключены, на iOS включить нельзя — контракт настроек расходится (F-F09, P0); APNs/FCM без таймаутов (F-F10); токены не чистятся (F-F25)                                                                            |
| F-20 Email                                    | работает с проблемами | Однопоточная очередь, транзакционные письма за зеркалами сообщений (F-F08); короткий backoff и вечные упавшие job'ы с токенами (F-F20); мёртвые шаблоны (F-F19)                                                                  |
| F-21 Telegram команде                         | работает              | Замечаний уровня P0/P1 нет; при падении Redis сигнал повторяется каждые 5 мин (F-F26)                                                                                                                                            |
| F-22 Файлы /files                             | работает с проблемами | `DELETE /files/:id` снимает вложение с любой сущности (F-F06); брошенные загрузки постов/сторис/заявок не чистятся (F-F21)                                                                                                       |
| F-23 Медиа-обработка                          | работает              | Мелкое: ffmpeg без белого списка протоколов, `PROCESSING` не догоняется (F-F26)                                                                                                                                                  |
| F-24 HLS-воспроизведение                      | работает              | Замечаний нет                                                                                                                                                                                                                    |
| F-25 Cron и локи                              | работает              | Очередь `cleanup` мёртвая, §10.2 PROJECT.md описывает 10 из 21 задачи (F-F19)                                                                                                                                                    |
| F-26 Уборка хранилища                         | работает с проблемами | Весь листинг бакета в память API (F-F11); вложения удалённых сообщений, отчёт без вариантов (F-F21)                                                                                                                              |
| F-27 Догонялка медиа и самоконтроль           | работает с проблемами | «Не отвечает: Redis» каждые 5 минут при падении Redis (F-F26)                                                                                                                                                                    |
| F-28 Realtime-подключение                     | работает с проблемами | Присутствие на весь вуз (F-F12); реконнект инвалидирует весь кэш (F-F13); состояние в памяти, `auth:refresh` с чужим `sub` (F-F18); нет лимита WS-событий (F-F15)                                                                |
| F-29 PWA                                      | работает              | Существенных проблем не найдено; `use-sw-update` и `worker/index.ts` без тестов (F-F28)                                                                                                                                          |

Итого: P0 — 2, P1 — 10, P2 — 17. Юнит-тесты модулей группы F (23 набора, 370 тестов) проходят; e2e, lint, build не запускались. SQL вложенного `take` (F-F02) проверен логом запросов Prisma на локальной БД (только SELECT).

### Проблемы

#### F-F01 [P0] Забаненный участник группы продолжает читать её переписку через глобальный поиск по сообщениям

- Процесс: F-11 (и F-02 — бан)
- Где: apps/api/src/modules/chats/chats.service.ts:2481-2499 (`searchMessages`: без `chatId` фильтр `chatFilter = { chat: { members: { some: { userId: viewer.sub } } } }` — нет `bannedAt: null`); бан оставляет строку членства (chats.service.ts:3071-3074 `bannedAt: new Date()`); веб вызывает глобальный поиск из списка чатов (apps/web/src/widgets/chat-window/ui/chat-window.tsx:597 `searchMessages(listSearchTerm)`); `q` от 2 символов (packages/shared-schemas/src/chats.ts:185)
- Суть: бан в группе должен отрезать доступ к чату (assertMembership отвечает FORBIDDEN, список чатов его скрывает, сокет выводится из комнаты). Но глобальный поиск по сообщениям проверяет только наличие строки членства, а у забаненного она остаётся. Запрос `GET /chats/search?q=ов` (или любой частой парой букв) отдаёт и новые сообщения группы, написанные после бана, с отправителями и вложениями (MESSAGE_SELECT). Для сравнения: поиск по названиям чатов в search.service.ts:80 `bannedAt: null` учитывает.
- Решение: в `searchMessages` фильтровать `chat: { members: { some: { userId, bannedAt: null } } }`; очищенное «у себя» (`clearedAt`) находить или нет — решение продукта, сейчас находится намеренно. Добавить юнит-тест «забаненный не находит сообщения группы глобальным поиском».
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts, apps/api/src/modules/chats/chats.service.spec.ts
- Стоп-точки: нет

#### F-F02 [P1] Каждое событие в чате стоит N полных перезапросов списка, а каждый запрос списка читает ВСЕ сообщения чатов страницы

- Процесс: F-10, F-05, F-07
- Где:
  - apps/api/src/modules/chats/chats.service.ts:476-481 — в `listChats` последнее сообщение берётся вложенным `messages: { where, orderBy: { createdAt: 'desc' }, take: 1, select: MESSAGE_SELECT }` на `findMany` по 100 чатам. Prisma 6.19 без `relationJoins` применяет вложенный `take` при нескольких родителях в памяти: проверено логом запросов на локальной БД — уходит `SELECT … FROM messages WHERE deleted_at IS NULL AND chat_id IN (…) ORDER BY created_at DESC OFFSET $4` **без LIMIT**, затем по тем же id подтягиваются sender/media/replyTo/reactions/poll/sharedPost. То же в support.service.ts:38-43 (TICKET_SELECT) и support.service.ts:518-531 (`closeStale`).
  - apps/api/src/modules/chats/chats.service.ts:2198-2200 и 1727-1731, 2150-2155 — `chat:activity` уходит каждому участнику чата на каждое сообщение, системное событие, вступление.
  - apps/web/src/entities/chat/api/chat-api.ts:74-87 — `fetchChats` выкачивает список целиком (до 15 страниц по 100); apps/web/src/widgets/chat-window/ui/chat-window.tsx:1595-1597, 1587-1589 — `chat:activity` и `notification:new` инвалидируют весь список (онлайн-получатель не в комнате получает оба события → два перезапроса); apps/web/src/entities/chat/lib/use-chats-unread.ts:26-28 — плюс `GET /chats/unread` (groupBy по OR-веткам до 500 чатов) на каждое событие.
- Суть: в чате факультета на 1–3 тыс. человек одно сообщение порождает тысячи `GET /chats`, и каждый из них читает всю историю официальных чатов пользователя (факультет, деканат, поддержка вуза, группа — десятки тысяч строк с отношениями), чтобы показать по одному превью. На стенде (`/chats?limit=20`, 10 мс в docs/PERF_BASELINE.md) это не видно, потому что в сид-чатах мало сообщений; на живом вузе после нескольких месяцев переписки список чатов и бейдж станут самыми дорогими запросами API. Пункт известен частично («полный рефетч списка на каждое событие»), но корень на сервере — отсутствие LIMIT.
- Решение: (1) последнее сообщение брать отдельным запросом `DISTINCT ON (chat_id) … ORDER BY chat_id, seq DESC` (или LATERAL … LIMIT 1) по id страницы, либо денормализовать `Chat.lastMessageId`; то же для очереди поддержки и `closeStale`; (2) на клиенте вместо инвалидации всего списка — точечное обновление строки по `chatId` (превью/счётчик из payload `chat:activity` или запрос одной строки), троттлинг перезапроса бейджа; (3) не инвалидировать список на `notification:new` для MESSAGE, если пришёл `chat:activity`.
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts, apps/api/src/modules/chats/support.service.ts, apps/web/src/widgets/chat-window/ui/chat-window.tsx, apps/web/src/entities/chat/lib/use-chats-unread.ts, apps/web/src/entities/chat/api/chat-api.ts
- Стоп-точки: нет (если денормализация `Chat.lastMessageId` — «миграция»; если в payload `chat:activity` добавляются поля — «контракт API/shared-schemas»)

#### F-F03 [P1] Дописка автора обращения из окна чата не открывает закрытое обращение и не будит команду

- Процесс: F-14
- Где: apps/web/messages/ru.json:4027 (`answerWhere`: «Ответ придёт в „Чаты“ — там же можно дослать скриншот или файл»); переоткрытие и Telegram есть только в apps/api/src/modules/chats/support.service.ts:291-334 (`reply`) и `open`; путь чата — chats.gateway.ts:100 → chats.service.ts:1794-1825 (`createMessage`) и `sendMessageRest`/`sendMessageFromUploads` — о `SUPPORT_PLATFORM` ничего не знают (`grep SUPPORT_PLATFORM chats.service.ts` — только комментарий в строке 337); веб для автора вызывает только `POST /support` (apps/web/src/features/contact-support/api/support-api.ts)
- Суть: человек открывает обращение формой, получает ответ, команда закрывает (или cron `closeStale` закрывает через N дней с последним словом команды). Дальше человек, как ему сказано, пишет уточнение или шлёт скриншот в «Чатах» — это обычный `message:send`/multipart. `supportClosedAt` остаётся заполненным → обращение висит во вкладке «закрытые», в очереди «открытых» его нет, Telegram-уведомления «Ответ в обращении» нет. Вопрос теряется до тех пор, пока кто-то случайно не откроет закрытую ветку. Одновременно каждое такое сообщение создаёт MESSAGE-уведомление (in-app/push/email) всем участникам-сотрудникам (до 100, support.service.ts:585-596), то есть шум есть, а сигнала в очереди нет.
- Решение: вынести «побочные эффекты обращения» (переоткрыть закрытое, `notifyStaff('reply')` для автора, `supportFirstReplyAt` для команды) в метод SupportService и вызывать его из общей точки `notifyNewMessage`/`createMessage` для чатов типа `SUPPORT_PLATFORM` (или хук-событие); для сотрудников подавить MESSAGE-уведомления в обращениях, где они не назначены.
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts, apps/api/src/modules/chats/support.service.ts, apps/api/src/modules/chats/support.service.spec.ts
- Стоп-точки: нет

#### F-F04 [P1] Пустое «сообщение-призрак» с занятым seq при отказе загрузки вложения

- Процесс: F-06, F-08 (пересылка)
- Где: apps/api/src/modules/chats/chats.service.ts:1913-1928 (сообщение создаётся до файлов), 1930-1963 (`completeMultipart`/`confirmDirectUpload` бросают FILE_TYPE_NOT_ALLOWED/FILE_TOO_LARGE/FORBIDDEN/NOT_FOUND), 1965-1968 (удаление только при `attached === 0` без исключения); `sendMessageRest` 2010-2040 (тот же порядок, `files.upload` бросает на неразрешённом типе — проверка типа идёт ПОСЛЕ создания сообщения); `forwardMessage` 2584-2602 (сбой `copyToMessage` оставляет копию без вложений)
- Суть: пользователь отправляет `.exe`/слишком большой файл или второй файл альбома не прошёл проверку — клиент получает ошибку, но в БД остаётся сообщение с пустым `content` (или с частью вложений), занятым `seq`, без `message:new` и без уведомлений. Остальные участники увидят пустой пузырь при следующей загрузке истории или догоне `getUpdates` (seq > since), отправитель — «ошибку», но и пузырь. Уже прикреплённые файлы первой части альбома остаются привязанными к «призраку». Известный пункт, подтверждён по коду.
- Решение: сначала проверять/подтверждать все вложения (без `messageId`), затем в одной транзакции создать сообщение и привязать файлы (`file.updateMany({ id: in, messageId })`); при сбое — `discard` уже подтверждённых объектов. Для multipart-пути — проверять тип буферов до `message.create`. Тест «отказ второго вложения не оставляет сообщения».
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts, apps/api/src/modules/files/file.service.ts, apps/api/src/modules/chats/chats.service.spec.ts
- Стоп-точки: нет

#### F-F05 [P1] Дубли официальных чатов при одновременной первой загрузке: уникального ограничения на (тип, scope) нет

- Процесс: F-04 (также F-01 — личный чат, «Сохранённые»)
- Где: apps/api/src/modules/chats/chats.service.ts:3571-3593 (`ensureOfficialChat`: `findFirst` без `orderBy` → `create`), prisma/schema/06-chats.prisma:83-95 (только обычные индексы `type/groupId/facultyId/universityId`); `getSavedChat` 1496-1506 (findFirst → create, вызывается и из ensure, и из `GET /chats/saved`); `findPrivateChat`+`create` 733-759
- Суть: на запуске вуза группа из 25–30 студентов открывает «Чаты» в одну минуту; Redis-флаг `chat:ensured:<uid>` пер-пользовательский и гонку между разными пользователями не закрывает. Два параллельных `ensureOfficialChat` видят «чата нет» и создают два GROUP_OFFICIAL / FACULTY / DEAN / SUPPORT / SUBJECT на один scope. Дальше `findFirst` без сортировки раскладывает людей по двум чатам — половина группы пишет в один, половина в другой, и никто этого не видит. Для личных чатов и «Сохранённых» то же при двойном клике/двух вкладках.
- Решение: частичные уникальные индексы (`UNIQUE (type, group_id, subject) WHERE type IN ('GROUP_OFFICIAL','SUBJECT')`, `(type, faculty_id)` для FACULTY/DEAN, `(type, university_id)` для SUPPORT, `(created_by_id) WHERE type='SAVED'`), создание через `INSERT … ON CONFLICT DO NOTHING` + повторное чтение; `orderBy: { createdAt: 'asc' }` в `findFirst`. Перед индексом — разовая склейка существующих дублей (перенос членств, сообщений с пересчётом seq).
- Файлы для правки: prisma/schema/06-chats.prisma (новая миграция), apps/api/src/modules/chats/chats.service.ts, apps/api/src/modules/chats/chats.service.spec.ts
- Стоп-точки: миграция

#### F-F06 [P1] `DELETE /files/:id` снимает вложение с любой сущности: сообщения, документа на проверке, материала, сториса

- Процесс: F-22 (затрагивает F-06, документы, материалы)
- Где: apps/api/src/modules/files/files.controller.ts:190-195 (`remove` → `files.delete(id, user.sub)`), apps/api/src/modules/files/file.service.ts:657-679 (`delete` проверяет только `ownerId`, не смотрит `messageId/documentId/materialId/postId/albumId/stories`); связи File в prisma/schema/08-files.prisma:55-66 (`onDelete: SetNull` со стороны сущности — сущность не узнаёт о пропаже)
- Суть: владелец файла может удалить его мимо правил модуля-владельца: снять скан с документа, который деканат уже проверил или проверяет; убрать вложение из сообщения в чате, где он забанен, или спустя окно правки; удалить файл материала, минуя права/аудит модуля materials; оставить пост или сторис без медиа. Сущности остаются «битыми» (запись без файла), аудита нет. Веб этим маршрутом для привязанных файлов не пользуется, поэтому это обход через API, но последствия — потеря данных у других ролей.
- Решение: в общем `DELETE /files/:id` разрешать удаление только непривязанных файлов (все FK null и нет Story/Album-обложки), иначе `CONFLICT` «файл используется — удалите через раздел»; удаление привязанных — только из модулей-владельцев с их проверками. Тест на каждый тип привязки.
- Файлы для правки: apps/api/src/modules/files/file.service.ts, apps/api/src/modules/files/files.controller.ts, apps/api/src/modules/files/file.service.spec.ts
- Стоп-точки: «контракт API/shared-schemas» (новый отказ на существующем эндпоинте)

#### F-F07 [P1] Каждое сообщение чата — строка Notification для каждого участника, которая не гасится прочтением чата и никогда не удаляется

- Процесс: F-15, F-16, F-05
- Где: apps/api/src/modules/chats/chats.service.ts:2215-2241 (`notifyNewMessage` ставит `new-message` на всех незаглушённых участников, кто не в комнате `chat:<id>` — включая онлайн-пользователей с закрытым чатом); apps/api/src/modules/notifications/notifications.processor.ts:105-121 (`createMany` на каждого адресата), 146-153 (онлайн → `notification:new`); прочтение чата (`markRead`, chats.service.ts:2297-2311) уведомления MESSAGE не трогает — в chats.service.ts `prisma.notification` встречается только для `chat-request` (905, 960); apps/api/src/modules/cleanup/cleanup.service.ts:301-313 удаляет только `isRead: true` старше 30 дней
- Суть: в чате факультета на 2 000 человек 50 сообщений в день — это 100 000 строк `notifications` в день на один чат, и почти все они навсегда остаются `isRead=false`: человек читает переписку в чате, а колокольчик об этом не знает. Колокольчик (счётчик `notif:unread`, apps/web/src/widgets/app-shell/ui/app-shell.tsx:108-110) засыпан «Новое сообщение от …», тост и системное уведомление браузера всплывают на каждое сообщение каждого незаглушённого чата (apps/web/src/widgets/notifications-bell/ui/notifications-bell.tsx:104-109), а таблица растёт без границы — ночная чистка её не трогает. Индекс `[userId, isRead]` помогает счётчику, но `count` по сотням тысяч непрочитанных на пользователя (кэш 300 с) и бейдж телефона (push.service.ts:127) тоже будут дорожать.
- Решение: для `MESSAGE` хранить одно «свёрнутое» уведомление на чат (`dedupeKey: new-message:<chatId>` с upsert текста/счётчика) либо вовсе не писать MESSAGE в ленту колокольчика, оставив push/email офлайн-адресатам; при `markRead`/`advanceReadMark` помечать прочитанными MESSAGE-уведомления этого чата (`data.chatId`) и сбрасывать кэш счётчика; в `cleanOldNotifications` добавить удаление непрочитанных старше N дней (90). Онлайн-получателю вне чата не слать `notification:new` для MESSAGE — список и бейдж и так обновит `chat:activity`.
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts, apps/api/src/modules/notifications/notifications.processor.ts, apps/api/src/modules/notifications/notifications.service.ts, apps/api/src/modules/cleanup/cleanup.service.ts, apps/web/src/widgets/notifications-bell/ui/notifications-bell.tsx
- Стоп-точки: нет (если меняется форма Notification/индекс по `data->chatId` — «миграция»)

#### F-F08 [P1] Письмо на каждое сообщение чата каждому офлайн-участнику; транзакционные письма стоят в той же однопоточной очереди

- Процесс: F-15, F-20, F-17
- Где: apps/api/src/modules/notifications/notifications.processor.ts:137 (`wantEmail = data.emailFallback ?? true`), 165-180 (email-job на каждого офлайн-адресата, `jobId notif-email:<dedupeKey>:<userId>`); `emailFallback` не выставляет ни один продюсер (`grep -rn emailFallback apps/api/src --include=*.service.ts` — пусто), в т.ч. chats.service.ts:2223-2239; apps/api/src/modules/notifications/notifications.service.ts:34-43 (`DEFAULT_SETTINGS.emailEnabled: true`), processor.ts:228-230 (нет строки настроек → email включён); apps/api/src/modules/email/email.processor.ts:37 (`@Processor(QUEUES.EMAIL)` без `concurrency` и лимитера — 1 письмо за раз), apps/api/src/modules/email/mailer.service.ts:34-39 (транспорт без `pool`, без таймаутов — новое SMTP-соединение на письмо, дефолтный socketTimeout nodemailer 10 мин)
- Суть: «офлайн» — это любой человек без открытого сокета, то есть большинство в любой момент. Одно сообщение в официальном чате группы (25–30 человек) — два десятка писем, в чате факультета — тысячи. Письма идут по одному: тысяча писем — это минуты–десятки минут, и всё это время письмо «сброс пароля» и инвайт (тот же FIFO) ждут в хвосте. Параллельно платформа быстро упрётся в лимиты SMTP-провайдера и попадёт в спам-листы — и тогда перестанут доходить и инвайты. Письма о сообщениях дублируют друг друга (одно на сообщение, без группировки).
- Решение: (1) для `MESSAGE` не слать email вовсе или слать дайджест «у вас N непрочитанных в M чатах» не чаще раза в несколько часов (отдельная cron-задача по непрочитанному), `emailFallback: false` в `notifyNewMessage`; (2) транзакционные письма (invite, password-reset, verification) — в отдельную очередь или с `priority` выше уведомлений; (3) `concurrency` + `limiter` у EmailProcessor и `pool: true`, `connectionTimeout/socketTimeout` у транспорта.
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts, apps/api/src/modules/notifications/notifications.processor.ts, apps/api/src/modules/email/email.processor.ts, apps/api/src/modules/email/mailer.service.ts, apps/api/src/common/queue/queue.constants.ts, apps/api/src/modules/cleanup/cleanup.service.ts (если дайджест)
- Стоп-точки: нет

#### F-F09 [P0] Мобильные пуши по умолчанию выключены, а iOS-клиент не может их включить — контракт настроек расходится

- Процесс: F-19, F-17
- Где: apps/api/src/modules/notifications/notifications.processor.ts:232-235 (`pushEnabled`: нет строки настроек → false), notifications.service.ts:34-43 (`pushEnabled: false`); регистрация устройства не трогает настройки (apps/api/src/modules/push/push.service.ts:86-97); iOS: apps/ios/Sources/Core/Feed/FeedAPI.swift:64-68 (`NotificationSettingsDTO { push, email, inApp }`), 179-187 (PATCH этим телом), apps/ios/Sources/Features/Feed/FeedModel.swift:239-247; API принимает только `emailEnabled/pushEnabled/…` со `.strict()` (packages/shared-schemas/src/notifications.ts:12-23) — PATCH с iOS отвечает 400, GET декодируется в `nil`
- Суть: приложение на iOS регистрирует APNs-токен (PushRegistrar.swift:38), но `sendToDevices` вызывается только при `pushEnabled=true`, а включить его с iPhone невозможно: экран настроек шлёт поля, которых у API нет, и получает ошибку. Пользователь iOS, не заходивший в веб-настройки, не получит ни одного пуша. На Android тумблер рабочий, но тоже выключен по умолчанию — человек ставит приложение, разрешает уведомления системному диалогу и ничего не получает. Итог: в конфигурации по умолчанию ни один телефон пушей не получает; единственный обходной путь — включить «Push» в веб-настройках (флаг общий на пользователя), о чём мобильный пользователь не знает. Поэтому P0 — основной сценарий F-19 не работает.
- Решение: на iOS привести DTO к контракту (`pushEnabled`, `emailEnabled`, тип-тумблеры) или добавить в API алиасы; при первой регистрации устройства (`registerDevice` создаёт запись) включать `pushEnabled` (устройство зарегистрировано = человек разрешил уведомления в ОС), либо разделить «push в браузере» и «push на телефон»; e2e-тест на PATCH настроек с телом iOS.
- Файлы для правки: apps/ios/Sources/Core/Feed/FeedAPI.swift, apps/ios/Sources/Features/Feed/FeedModel.swift (+ экран настроек), apps/api/src/modules/push/push.service.ts, apps/api/src/modules/notifications/notifications.service.ts
- Стоп-точки: «контракт API/shared-schemas» (если меняется схема настроек или дефолт)

#### F-F10 [P1] Зависший push-провайдер останавливает всю очередь уведомлений

- Процесс: F-15, F-18, F-19
- Где: apps/api/src/modules/notifications/notifications.processor.ts:34 (`@Processor(QUEUES.NOTIFICATIONS)` без `concurrency` — один job за раз), 157-163 (`await this.push.sendToUser(...)` последовательно для каждого офлайн-адресата внутри job'а); apps/api/src/modules/push/apns.service.ts (`send`: HTTP/2-запрос без `setTimeout`/дедлайна — промис резолвится только по `end`/`error`), apps/api/src/modules/push/fcm.service.ts:46, 81 (`fetch` без `AbortSignal.timeout`), push.service.ts:151 (`webpush.sendNotification` без опции `timeout`)
- Суть: если APNs/FCM/push-сервис браузера не отвечает (полуоткрытое HTTP/2-соединение после сетевого сбоя — типичный случай), `sendToUser` не завершается, job не завершается, а BullMQ продолжает продлевать его лок (event loop жив), так что зависание не превращается в stalled-retry. Очередь `notifications` с единственным обработчиком встаёт целиком: ни уведомлений в колокольчик, ни WS `notification:new`, ни писем — до рестарта процесса. Плюс последовательный обход адресатов делает job большой рассылки долгим даже без зависаний.
- Решение: таймауты на все три транспорта (`AbortSignal.timeout(10_000)` для fetch, `timeout` для web-push, `request.setTimeout` + `close` для HTTP/2 и сброс сессии на `goaway`); вынести push в отдельную очередь `push` (job на пользователя или пачку) с собственной конкурентностью; поставить `concurrency` процессору уведомлений.
- Файлы для правки: apps/api/src/modules/push/apns.service.ts, apps/api/src/modules/push/fcm.service.ts, apps/api/src/modules/push/push.service.ts, apps/api/src/modules/notifications/notifications.processor.ts, apps/api/src/common/queue/queue.constants.ts
- Стоп-точки: нет

#### F-F11 [P1] Ночная чистка сирот читает весь листинг бакета в память API-процесса

- Процесс: F-26
- Где: apps/api/src/modules/cleanup/cleanup.service.ts:825-835 (`listObjects` складывает ВСЕ объекты бакета рекурсивно в массив), 399-400 (вызов на каждый из 9 бакетов), 401-418 (дальше пачками по 500 — уже после полной загрузки списка, удаление по одному `removeObject`)
- Суть: в `chat-media`, `posts-media`, `profile-media` лежат не только оригиналы, но и варианты: каждое видео — постер + 3–4 рендишна HLS по сотне–другой сегментов. Тысяча видео — сотни тысяч объектов, десять тысяч — миллионы; массив `{name, lastModified}` на миллионы записей — сотни мегабайт–гигабайты кучи в процессе, который в это время обслуживает HTTP и WS (cron живёт в API, воркер его не запускает). Итог — OOM/долгие GC-паузы раз в сутки в 04:00 и рост времени задачи за пределы `LOCK_TTL_MS.cleanOrphanFiles` (1 ч).
- Решение: обрабатывать поток `listObjectsV2` порциями по 500 по мере чтения (async-итератор, как в `purgeVariants`), удалять `removeObjects` пачкой; для префикса `variants/` проверять владельца один раз на `fileId`, а не на каждый сегмент; по возможности вынести задачу в воркер.
- Файлы для правки: apps/api/src/modules/cleanup/cleanup.service.ts, apps/api/src/modules/cleanup/cleanup.service.spec.ts
- Стоп-точки: нет

#### F-F12 [P1] Присутствие рассылается на весь вуз при каждом подключении/отключении, а веб перерисовывает окно чатов на каждое событие

- Процесс: F-28, F-13
- Где: apps/api/src/common/realtime/realtime.gateway.ts:78-105 (`trackOnline`/`trackOffline` → `server.to('university:<id>').emit('presence:changed')` на каждый переход онлайн↔офлайн), 58-61 (каждый сокет вуза сидит в комнате `university:<id>`); apps/web/src/widgets/chat-window/ui/chat-window.tsx:1649-1654 (`setPresence((prev) => … { ...prev, [userId]: online })` — новый объект состояния и перерисовка всего ChatWindow для любого человека вуза, даже не связанного ни с одним открытым чатом), apps/web/src/widgets/user-profile/ui/public-user-profile.tsx:89, мобильные клиенты (apps/ios/Sources/Core/Realtime/RealtimeEvent.swift:38, apps/android/.../RealtimeEvent.kt:56)
- Суть: в вузе с 5 000 одновременно подключённых каждое открытие/закрытие вкладки, сворачивание мобильного приложения, обрыв Wi-Fi рассылается всем 5 000 сокетам. При среднем сеансе ~10 минут это порядка 8 переходов в секунду × 5 000 адресатов ≈ 40 тыс. WS-сообщений в секунду только на присутствие; после деплоя/рестарта API все переподключаются разом — квадратичный всплеск (N² событий). На клиенте карта `presence` копится на всех людей вуза, и каждое новое имя в ней перерисовывает тяжёлый компонент окна чатов.
- Решение: не вещать присутствие на весь вуз — отдавать его адресно: собеседникам личных чатов (их немного) через `user:<id>` или по подписке открытого чата (`chat:<id>`), остальное — запросом `GET /chats/:id/presence`; на клиенте игнорировать `presence:changed` для userId, которых нет в текущем списке/окне, и хранить присутствие вне состояния ChatWindow (store/selector), чтобы событие не перерисовывало ленту.
- Файлы для правки: apps/api/src/common/realtime/realtime.gateway.ts, apps/api/src/modules/chats/chats.service.ts, apps/web/src/widgets/chat-window/ui/chat-window.tsx, apps/web/src/widgets/user-profile/ui/public-user-profile.tsx
- Стоп-точки: «контракт API/shared-schemas» (меняется адресация WS-события `presence:changed`, затрагивает iOS/Android)

#### F-F13 [P2] Реконнект сокета инвалидирует весь кэш react-query и сбрасывает подгруженную историю

- Процесс: F-28, F-07
- Где: apps/web/src/shared/realtime/realtime-context.tsx:93-99 (`onConnect` → `queryClientRef.current.invalidateQueries()` без фильтра); дельта-догон в apps/web/src/widgets/chat-window/ui/chat-window.tsx:1489-1517 при этом перекрывается — `chatKeys.messages(chatId)` перезапрашивается целиком
- Суть: после любого обрыва (сон ноутбука, смена сети, деплой) клиент заново тянет все активные запросы, включая список чатов всеми страницами (F-F02) и первую страницу истории открытого чата — подгруженные вверх страницы и позиция чтения теряются, а аккуратный `getUpdates` по seq работает вхолостую. На деплое это всплеск от всех клиентов одновременно. Известный пункт, подтверждён.
- Решение: на реконнекте инвалидировать выборочно (уведомления, бейджи, «Сегодня»), чаты оставить на `catchUp` по seq; разнести по времени (jitter) перезапрос тяжёлых ключей.
- Файлы для правки: apps/web/src/shared/realtime/realtime-context.tsx, apps/web/src/widgets/chat-window/ui/chat-window.tsx
- Стоп-точки: нет

#### F-F14 [P2] Отметка прочтения — по `createdAt`, а не по `seq`; заглушённые чаты идут в бейдж; очищенные периоды не учитываются в счётчике

- Процесс: F-07, F-10
- Где: apps/api/src/modules/chats/chats.service.ts:2297-2311 (`markRead` берёт `message.createdAt`), 2131-2146 (`advanceReadMark` по времени), 165-169 (`unreadFloor` учитывает только `clearedAt`, не `clearedRanges`), 669-700 (`getUnreadSummary` не фильтрует `mutedAt/mutedUntil`); apps/web/src/entities/chat/lib/use-chats-unread.ts:34
- Суть: время сообщения ставит Prisma на стороне процесса (`@default(now())`), а порядок задаёт `seq`; при одинаковых миллисекундах, смещении часов между инстансами или долгой загрузке вложения (сообщение с ранним `createdAt` появляется в ленте позже — F-F04) отметка «прочитано до» пропускает или съедает сообщения. Бейдж в навигации считает заглушённые чаты — человек, заглушивший чат факультета, всё равно видит десятки «непрочитанных». Известные пункты, подтверждены.
- Решение: хранить `ChatMember.lastReadSeq` и считать непрочитанное по `seq > lastReadSeq`; в `getUnreadSummary` исключать заглушённые (как Telegram — серым числом отдельно); учесть `clearedRanges` в счётчике.
- Файлы для правки: prisma/schema/06-chats.prisma, apps/api/src/modules/chats/chats.service.ts, apps/web/src/widgets/chat-window/lib/read-tracking.ts, apps/web/src/entities/chat/lib/use-chats-unread.ts
- Стоп-точки: миграция

#### F-F15 [P2] `chat:action` в больших чатах без проверки членства и без ограничения частоты WS-событий

- Процесс: F-13, F-28
- Где: apps/api/src/modules/chats/chats.service.ts:426-440 (`actionAudience`: при > 64 участниках возвращает `room` без проверки, что отправитель — участник), apps/api/src/modules/chats/chats.gateway.ts:228-233 (`client.to('chat:<id>')` не требует, чтобы сокет был в комнате); на `chat:action`, `typing:*`, `chat:join`, `message:read`, `message:edit/delete` нет лимита частоты (антифлуд есть только у отправки, chats.service.ts:2941-2959)
- Суть: любой авторизованный пользователь (в т.ч. другого вуза или забаненный) может показывать «X печатает…» в чате факультета, зная его id; каждое событие — запрос в БД и веерная рассылка до 64 сокетов. Без лимита один клиент генерирует тысячи запросов `chatMember.findMany`/`findUnique` в секунду.
- Решение: в ветке `room` проверять `isMember` (одним `findUnique` по уникальному ключу); общий per-socket лимит событий (token bucket в памяти сокета, `client.data`) для всех `@SubscribeMessage`.
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts, apps/api/src/modules/chats/chats.gateway.ts, apps/api/src/modules/chats/chats.gateway.spec.ts
- Стоп-точки: нет

#### F-F16 [P2] Правка и удаление своих сообщений без проверки текущего членства

- Процесс: F-05, F-02
- Где: apps/api/src/modules/chats/chats.service.ts:2244-2266 (`editMessage`), 2268-2280 (`deleteMessage`) — нет `assertMembership`; gateway рассылает `message:updated` в комнату (chats.gateway.ts:120-123)
- Суть: исключённый или забаненный автор в течение 10 минут может переписать своё сообщение (например, на оскорбление после бана) и в любое время удалить свои сообщения из группы, где его уже нет. Известный пункт, подтверждён.
- Решение: `assertMembership(senderId, msg.chatId)` в обоих методах (удаление своих после выхода — решение продукта; бан — запрещать).
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts, apps/api/src/modules/chats/chats.service.spec.ts
- Стоп-точки: нет

#### F-F17 [P2] Жизненный цикл группы и официальных чатов: удаление/бан/вступление без живых сигналов, «удалить чат» для официальных и «Сохранённых»

- Процесс: F-02, F-03, F-04, F-12
- Где: apps/api/src/modules/chats/chats.service.ts:3246-3250 (владелец удаляет группу — ни `chat:activity`, ни `leaveRoom` участникам), 3061-3079 (`banMember` — без системного сообщения и без пинга забаненному), 1742-1766 (`joinByInvite` — ни `member_added`, ни `chat:member-added`/`chat:activity`; параллельный двойной вход → P2002 → 500), 3262-3271 (выход из не-PRIVATE: для официальных чатов членство вернёт `ensureOfficialChat` через ≤10 мин, chats.service.ts:3584-3591; последний участник `SAVED` удаляет чат со всеми сохранёнными сообщениями), 3240 (`deleteOrLeaveChat` читает всех участников чата без `take` ради проверки членства); веб даёт «Удалить чат» для любого типа (apps/web/src/widgets/chat-window/ui/chat-window.tsx:3106-3112, 3680-3699)
- Суть: участники удалённой группы видят её в списке до случайного рефетча и получают ошибки при отправке; вступивший по ссылке невидим для группы до перезагрузки; «удалить» официальный чат группы/факультета бесполезно (вернётся сам), а «удалить» «Сохранённые» безвозвратно стирает заметки (чат пересоздастся пустым).
- Решение: перед `chat.delete` собрать участников и разослать `chat:activity` + `leaveRoom`; в `banMember`/`joinByInvite` — `emitSystemMessage` и `pingChatList`, P2002 в `joinByInvite` считать успехом; для официальных типов и SAVED на сервере запретить выход (`BAD_REQUEST`) или трактовать как «скрыть у себя» (`hiddenAt`), в вебе показывать «Очистить историю»/«Архив» вместо «Удалить».
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts, apps/web/src/widgets/chat-window/ui/chat-window.tsx, apps/web/src/widgets/chat-window/ui/conversation-list.tsx
- Стоп-точки: «контракт API/shared-schemas» (новый отказ на DELETE /chats/:id для официальных)

#### F-F18 [P2] Realtime держит состояние в памяти процесса: без Redis-адаптера, «вечный онлайн» при гонке подключения, `auth:refresh` с чужим токеном

- Процесс: F-28, F-13, F-15
- Где: apps/api/src/main.ts:123 (`new IoAdapter(app)` — без `@socket.io/redis-adapter`); apps/api/src/common/realtime/realtime.gateway.ts:33 (`connections = new Map`), 42-67 (`trackOnline` вызывается после нескольких `await`; если клиент отвалился раньше, `handleDisconnect` уже отработал — счётчик уходит в +1 навсегда, человек «онлайн» до рестарта, `lastSeenAt` не пишется), 119-139 (`auth:refresh` подменяет `client.data.userId` на `sub` нового токена без сверки с прежним — комнаты остаются старого пользователя, а `trackOffline` при разрыве уменьшит счётчик другого человека; просроченный токен связь не рвёт — сокет живёт до явного `disconnectUser`), 240-250 (`getOnlineUserIds` — `fetchSockets()` по ВСЕМ сокетам сервера на каждый job уведомлений)
- Суть: сейчас прод — один инстанс (docker/docker-compose.prod.yml:91), поэтому это ограничение масштабирования, а не авария: при втором инстансе события, рождённые в другом процессе (процессор уведомлений, cron отложенных, link-preview), не дойдут до сокетов, «онлайн» и выбор канала доставки разойдутся, `leaveRoom`/`disconnectUser` затронут только свой процесс (исключённый из группы продолжит получать её события). Гонка с «вечным онлайном» и подмена пользователя в `auth:refresh` — дефекты уже сейчас.
- Решение: Redis-адаптер socket.io (новая зависимость) и счётчик присутствия в Redis (INCR/DECR с TTL-heartbeat); в `handleConnection` отмечать онлайн только если `client.connected` после всех `await`; в `auth:refresh` разрывать сокет при `p.sub !== client.data.userId`; для `getOnlineUserIds` — `server.in(user:<id>).fetchSockets()` по адресатам или общий Redis-счётчик.
- Файлы для правки: apps/api/src/main.ts, apps/api/src/common/realtime/realtime.gateway.ts, apps/api/src/common/realtime/realtime.gateway.spec.ts
- Стоп-точки: «новая зависимость» (redis-adapter)

#### F-F19 [P2] Мёртвый код и расхождение с документацией: отложенные сообщения без клиента, неиспользуемые job'ы, шаблоны и очередь

- Процесс: F-09, F-15, F-20, F-25, F-08
- Где: `GET|POST /chats/:id/scheduled`, `PATCH|DELETE /chats/scheduled/:id` (apps/api/src/modules/chats/chats.controller.ts:458-497) и cron `deliverScheduledMessages` — ни apps/web, ни apps/ios, ни apps/android, ни apps/mini-app их не вызывают; при сбое доставки `notifyScheduleFailed` кладёт в тело уведомления текст сообщения (chats.service.ts:3427 `body: content.slice(0, 140)`) — он уйдёт в push и почту вопреки правилу «без текста ЛС в чужой инфраструктуре» (chats.service.ts:2226-2229); EMAIL_JOBS SEND_WELCOME/SEND_APPLICATION_STATUS/SEND_SCHEDULE_CHANGE/SEND_EVENT_REMINDER (apps/api/src/common/queue/queue.constants.ts:27-30) и NOTIFICATION_JOBS NEW_POST/NEW_STORY/EVENT_CREATED (49-51) никто не ставит; FILE_JOBS COMPRESS_VIDEO/SCAN_FILE (75-76) и очередь `cleanup` (10) без продюсеров и процессоров; `ChatPoll.closed` только читается (chats.service.ts:1460) — закрыть опрос нечем; docs/PROJECT.md §10.2 описывает 10 из 21 cron-задачи
- Суть: поддерживаемая поверхность API и cron-тик раз в минуту без единого пользователя; отложенное сообщение, если им воспользуются через API, утечёт текстом в уведомление.
- Решение: либо сделать клиент отложенных (веб: «Отправить позже» в композере), либо убрать API и cron; в `notifyScheduleFailed` — нейтральный `bodyKey`; удалить неиспользуемые job-имена/шаблоны/очередь или пометить как план; обновить §10.1–10.2 PROJECT.md.
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts, apps/api/src/modules/chats/chats.controller.ts, apps/api/src/common/queue/queue.constants.ts, apps/api/src/modules/email/email.processor.ts, apps/api/src/modules/email/templates.ts, docs/PROJECT.md
- Стоп-точки: «контракт API/shared-schemas» (если удаляются эндпоинты)

#### F-F20 [P2] Очереди: упавшие job'ы хранятся в Redis вечно вместе с ПДн и сырыми токенами, короткий backoff теряет письма при сбое SMTP

- Процесс: F-15, F-20, F-23
- Где: apps/api/src/common/queue/queue.constants.ts:93-98 (`attempts: 3`, `backoff exponential 5000` ≈ 15 с до окончательного провала, `removeOnFail: false`); payload писем содержит адрес и сырые ссылки — apps/api/src/modules/auth/password-reset.service.ts:77 (`resetUrl …?token=${rawToken}`), invites.service.ts (ссылка-инвайт)
- Суть: SMTP недоступен минуту — все письма этой минуты (сброс пароля, инвайты, зеркала уведомлений) окончательно падают и больше не отправятся. Упавшие job'ы копятся в Redis без срока: память растёт с каждым сбоем медиа/почты, а в payload лежат e-mail, имена и действующие токены инвайтов/сброса — Redis становится хранилищем ПДн без ретеншна.
- Решение: `removeOnFail: { age: 7 дней, count: 1000 }`, для email — `attempts` 8–10 с backoff до десятков минут; не класть сырые токены в payload (передавать id инвайта/токена и собирать ссылку в процессоре) — либо хотя бы чистить упавшие email-job'ы быстро.
- Файлы для правки: apps/api/src/common/queue/queue.constants.ts, apps/api/src/modules/email/email.processor.ts, apps/api/src/modules/auth/password-reset.service.ts, apps/api/src/modules/invites/invites.service.ts
- Стоп-точки: нет

#### F-F21 [P2] Хранилище: вложения удалённых сообщений и брошенные загрузки живут вечно, отчёт о месте не видит вариантов, аватар группы удаляется до проверки нового

- Процесс: F-26, F-22, F-06, F-02
- Где: soft delete сообщения не трогает файлы (apps/api/src/modules/chats/chats.service.ts:2277), `cleanDetachedFiles` чистит только `chat-media`/`materials` с `messageId/materialId = null` (apps/api/src/modules/cleanup/cleanup.service.ts:362-385) — непривязанные File в `posts-media`/`stories-media`/`applications` (загрузили, пост не создали) остаются навсегда; `reportStorageUsageTask` суммирует только `File.size` (cleanup.service.ts:771-776) — HLS-рендишны, постеры и WebP-варианты не учтены; `setChatAvatar` сначала удаляет старый файл, потом грузит новый (chats.service.ts:3008-3015) — отказ по типу оставляет `avatarUrl` на удалённый объект
- Суть: «удалить для всех» скрывает вложение, но байты (до 500 МБ на файл) хранятся бессрочно; порог `STORAGE_ALERT_GB` срабатывает позже реального заполнения тома (варианты видео сопоставимы по объёму с оригиналом).
- Решение: cron «вложения сообщений, удалённых > 30 дней назад» → `FileService.delete`; в `cleanDetachedFiles` добавить бакеты постов/сторис/заявок с окном (например, сутки) и проверкой всех FK; учитывать `FileVariant.size` в отчёте; в `setChatAvatar` грузить новый файл до удаления старого.
- Файлы для правки: apps/api/src/modules/cleanup/cleanup.service.ts, apps/api/src/modules/chats/chats.service.ts, apps/api/src/modules/cleanup/cleanup.service.spec.ts
- Стоп-точки: нет

#### F-F22 [P2] Накладные расходы на каждое сообщение и чтение в больших чатах

- Процесс: F-05, F-07, F-13, F-02
- Где: apps/api/src/modules/chats/chats.service.ts:2899-2907 (`assertCanSend` для любого чата читает ВСЕХ участников, кроме отправителя, хотя нужен только собеседник PRIVATE), 2190-2200 + 2208 (`notifyNewMessage`: `allMembers` пачками по 500 и `usersInRoom` на каждое сообщение), 2819-2829 (`getPresence` — все участники), 1511-1533 и 1553-1567 (`listMembers`/`getReadReceipts` обрезаны `take: 500` — в чате факультета панель участников и «кто прочитал» неполные); веб на каждое `message:read` чужого участника перезапрашивает `GET /chats/:id/reads` до 500 строк у всех, кто держит чат открытым (apps/web/src/widgets/chat-window/ui/chat-window.tsx:1656-1666)
- Суть: в чате на 2 000 человек отправка одного сообщения — несколько тысяч прочитанных строк участников, а поток прочтений во время пары превращается в N×M перезапросов статусов прочтения.
- Решение: в `assertCanSend` выбирать участников только для `type = PRIVATE` (`take: 2`); кэшировать состав больших чатов (Redis set с инвалидацией на вступление/выход); статусы прочтения в группах считать агрегатом (`count lastReadAt >= createdAt`) и обновлять дебаунсом; пагинация участников.
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts, apps/web/src/widgets/chat-window/ui/chat-window.tsx
- Стоп-точки: нет

#### F-F23 [P2] Поиск и выгрузка переписки: ILIKE без индекса, старейшие 5 000 сообщений, игнор очистки

- Процесс: F-11
- Где: apps/api/src/modules/chats/chats.service.ts:2489-2500 (`content: { contains, mode: 'insensitive' }` по всем чатам пользователя + курсор Prisma по `createdAt,id` — тот самый OR-курсор, который планировщик применяет фильтром, docs/PERF_BASELINE.md:200-205; триграммного индекса в prisma/ нет), 2668-2682 (`exportMessages`: `orderBy createdAt asc, take 5000` — в длинном чате выгружается начало истории без конца; `clearedAt/clearedRanges` не учитываются — в файл попадает очищенное «у себя»), 2371-2392 (`getAttachmentUrl` проверяет `clearedAt`, но не `clearedRanges`)
- Решение: pg_trgm GIN-индекс по `messages.content` и курсор по `seq` внутри чата; выгрузку делать потоково по `seq` с `clearedWhere(mem)` и без потолка (или с потолком на «последние N» и явной пометкой в шапке); в `getAttachmentUrl` применить `clearedWhere`.
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts, prisma/schema/06-chats.prisma (индекс)
- Стоп-точки: миграция (индекс)

#### F-F24 [P2] Мелкие дефекты переписки: обход квоты запроса удалением, личный чат «с собой», гонки реакций и опросов, «поделиться» шире аудитории поста

- Процесс: F-01, F-08
- Где: apps/api/src/modules/chats/chats.service.ts:2918-2928 (квота непринятого запроса считает `deletedAt: null` — удалил свои 5 сообщений и пишешь снова, без ограничения); 709-759 (`memberIds: [actor.sub]` при `type: PRIVATE` проходит схему и создаёт PRIVATE-чат с одним участником; для платформенной роли `assertCanStartPrivate` не проверяет существование собеседника → FK-ошибка → 500); 2515-2537 (`toggleReaction` без транзакции: двойной клик → `P2002` на `@@unique([messageId,userId,emoji])` → 500); 1446-1480 (`votePoll`/`getPollResults` не проверяют `message.deletedAt` — голосовать можно в удалённом опросе); 2630-2662 (`sharePost` проверяет видимость поста только отправителю, а `MESSAGE_SELECT.sharedPost` отдаёт заголовок и текст всем участникам чата — пост аудитории TEACHERS/GROUP/PERSONAL читают те, кому он не адресован; решение продукта)
- Решение: считать квоту по всем сообщениям отправителя (включая удалённые) или хранить счётчик на чате; в `createChat` требовать `other` для PRIVATE и проверять существование для всех ролей; `toggleReaction` — `upsert`/ловить P2002; в опросах фильтровать `message.deletedAt: null`; для `sharePost` — отдавать карточку только тем, кому пост виден (или запретить шаринг не-ALL постов в чаты с посторонними).
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts, apps/api/src/modules/chats/chats.service.spec.ts
- Стоп-точки: нет

#### F-F25 [P2] Push/уведомления: тумблер `systemEnabled` ничего не делает, нет группировки системных уведомлений, «онлайн» где угодно гасит пуш на телефон, токены устройств не чистятся

- Процесс: F-17, F-18, F-19
- Где: apps/api/src/modules/notifications/notifications.processor.ts:221-222 (`SYSTEM` → всегда true, `systemEnabled` хранится и отдаётся, notifications.service.ts:42, но не читается); apps/web/worker/index.ts:30-37 (`showNotification` без `tag`/`renotify` — десять сообщений чата = десять системных уведомлений); processor.ts:146-154 («онлайн» = хоть один сокет: забытая вкладка на рабочем компьютере отключает пуши на телефон и письма); prisma/schema/10-notifications.prisma:109-111 обещает чистку DeviceToken по `lastSeenAt`, но ни одна cron-задача её не делает (apps/api/src/modules/cleanup/cleanup.service.ts — нет `deviceToken`); push.service.ts:86-97 (`registerDevice` переписывает владельца токена любому вызывающему — нужен сам токен, но проверки нет)
- Решение: убрать `systemEnabled` из настроек/UI или применять его к некритичным SYSTEM; `tag: chat:<id>` + `renotify` в SW; считать «онлайн» по активности за последние N секунд (heartbeat видимой вкладки), а не по наличию сокета, или слать пуш на мобильные устройства независимо от веб-сокета; cron чистки DeviceToken старше 90 дней.
- Файлы для правки: apps/api/src/modules/notifications/notifications.processor.ts, apps/api/src/modules/notifications/notifications.service.ts, apps/web/worker/index.ts, apps/api/src/modules/cleanup/cleanup.service.ts, apps/web/src/widgets/account-settings/ui/account-settings-panels.tsx
- Стоп-точки: «контракт API/shared-schemas» (если убирается `systemEnabled`)

#### F-F26 [P2] Самоконтроль и медиа: сигнал «Redis не отвечает» каждые 5 минут, ffmpeg без белого списка протоколов, `PROCESSING` не догоняется

- Процесс: F-27, F-23
- Где: apps/api/src/modules/cleanup/cleanup.service.ts:716-734 (`wasDown` читается из того же Redis; при его падении `get` → null → «не отвечает: Redis» уходит каждый тик, `set` тоже падает); apps/api/src/modules/media/ffmpeg.ts:76-88 (вход — URL, без `-protocol_whitelist` и без принудительного `-f` по определённому mime; защита держится на дефолтах демультиплексоров ffmpeg); apps/api/src/modules/media/media.service.ts:157-189 (`resumeAndBackfill` догоняет только `PENDING` и `NONE` — файл, чей job потерян при статусе `PROCESSING` (сброс Redis, ручная чистка очереди), навсегда остаётся «в обработке»)
- Решение: хранить признак «упало» в памяти процесса как запасной вариант при недоступном Redis; добавить `-protocol_whitelist file,http,https,tcp,tls` и `-f` по mime; в догонялку включить `PROCESSING` старше часа.
- Файлы для правки: apps/api/src/modules/cleanup/cleanup.service.ts, apps/api/src/modules/media/ffmpeg.ts, apps/api/src/modules/media/media.service.ts
- Стоп-точки: нет

#### F-F27 [P2] Поддержка: ответ в склеенную ветку открывает «невидимое» обращение; команда — фиксированные 100 человек

- Процесс: F-14
- Где: apps/api/src/modules/chats/support.service.ts:305-308 и 362-365 (`reply`/`voiceReply` снимают `supportClosedAt` и у склеенной ветки — она открыта, но очередь фильтрует `supportMergedIntoId: null`, support.service.ts:127, а `open()` для автора найдёт именно её, support.service.ts:68-75, и новые обращения человека уйдут в ветку, которой нет в очереди); 585-596 (`createTicket` берёт первых 100 сотрудников без сортировки)
- Решение: в `reply` не переоткрывать склеенную ветку (писать в целевую) и в `open` исключать `supportMergedIntoId != null`; сотрудников добавлять через `joinOpenTickets`, а не фиксированным списком.
- Файлы для правки: apps/api/src/modules/chats/support.service.ts, apps/api/src/modules/chats/support.service.spec.ts
- Стоп-точки: нет

#### F-F28 [P2] Пробелы в тестах

- Процесс: F-01, F-04, F-11, F-14, F-18, F-19, F-28, F-29
- Где: нет тестов у apps/api/src/modules/push/push.service.ts, apns.service.ts, fcm.service.ts (только сборка payload), apps/web/src/shared/lib/push.ts, apps/web/worker/index.ts, apps/web/src/shared/lib/use-sw-update.ts; в chats.service.spec.ts нет случаев «забаненный и глобальный поиск» (F-F01), «отказ вложения не оставляет сообщения» (F-F04), «параллельный ensureOfficialChat» (F-F05); support.service.spec.ts не покрывает дописку автора из окна чата (F-F03); realtime.gateway.spec.ts — гонку `handleConnection`/`handleDisconnect` и `auth:refresh` с другим `sub` (F-F18). Юнит-тесты модулей группы (23 набора, 370 тестов) проходят — прогон `pnpm --filter api test -- src/modules/{chats,notifications,push,files,media,cleanup,email} src/common/{realtime,queue,redis}`; e2e, lint, build не запускались.
- Решение: добавить перечисленные кейсы вместе с исправлениями соответствующих находок; для транспортов пушей — тесты на таймаут и `gone`.
- Файлы для правки: перечисленные *.spec.ts / *.test.ts
- Стоп-точки: нет

#### F-F29 [P2] Превью ссылок: DNS-rebinding между проверкой и запросом, чтение тела без своего таймаута, картинка OG грузится у читателей напрямую

- Процесс: F-05
- Где: apps/api/src/common/link-preview/link-preview.service.ts:169-180 (`hostAllowed` резолвит имя через `lookup`, затем 182-191 `fetch(url)` резолвит его заново — между проверкой и запросом адрес может смениться на внутренний), 182-191 (`clearTimeout` срабатывает по приходу заголовков — `readCapped` читает тело уже без таймаута сервиса, остаётся только `bodyTimeout` undici ≈ 5 мин; очередь `link-preview` без `concurrency`, apps/api/src/modules/chats/link-preview.processor.ts:20), `parse` сохраняет `image` как внешний URL — клиенты грузят его напрямую, раскрывая IP читателей стороннему сайту
- Суть: злоумышленник с собственным DNS (TTL 0) может получить `<title>`/OG-мета внутреннего HTTP-сервиса в карточке своего сообщения; «медленный» сайт держит единственный обработчик превью до 5 минут на ссылку, превью у всех остальных встают в очередь.
- Решение: подключаться к уже проверенному IP (свой `lookup` в `dispatcher`/agent undici), таймаут на всё чтение тела, `concurrency` 4–8 для очереди; картинку превью проксировать/копировать в своё хранилище или не показывать без клика.
- Файлы для правки: apps/api/src/common/link-preview/link-preview.service.ts, apps/api/src/modules/chats/link-preview.processor.ts
- Стоп-точки: нет (изменение SSRF-гарда — согласовать с человеком)
