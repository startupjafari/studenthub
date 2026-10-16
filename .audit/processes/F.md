## Группа F — Коммуникации и инфраструктура

### F-01 Личный чат и запрос на переписку (§50)

- Бизнес-цель: дать написать человеку своего вуза один-на-один; незнакомцу — только через «запрос», без уведомлений до согласия.
- Роли: все, кроме EMPLOYER (FORBIDDEN); платформенные роли — без ограничения «свой вуз»; друзья — сразу без запроса.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): кнопка «Написать» (профиль, участники группы) → POST /chats {type:PRIVATE}; вкладка «Запросы» в /chats (и <role>/chats) → POST /chats/:id/request/accept|decline.
- Завершение: существующий чат пары переиспользован (включая скрытый hiddenAt) или создан новый с requestPendingForId; accept — пометка снята, decline — чат удаляется каскадом, инициатору не сообщается.
- Шаги и файлы: apps/api/src/modules/chats/chats.service.ts createChat → findPrivateChat → areFriends/assertCanStartPrivate/isBlockedBetween; resolveChatRequest/notifyChatRequest (первое сообщение → job CHAT_REQUEST, dedupeKey chat-request:<id>); assertCanSend (квота REQUEST_MESSAGE_QUOTA=5 до ответа); ответ адресата = согласие; web: apps/web/src/entities/chat/api/chat-api.ts, apps/web/src/widgets/chat-window/ui/conversation-list.tsx (folderRequests, requestIncoming).
- Данные на входе / выходе: {type, memberIds[]} → {id,type,title,requestPendingForId}; Chat+ChatMember; Notification SYSTEM chats.request.*; непринятые запросы не идут в GET /chats/unread.
- Внешние зависимости: PostgreSQL, Redis (антифлуд), BullMQ notifications, WS chat:activity.
- Тесты: apps/api/src/modules/chats/chats.service.spec.ts («createChat — один личный чат на пару», «запрос на переписку (§50)», «assertCanSend»).
- Замечено: дубль личного чата при гонке двух одновременных createChat не исключён — уникального ограничения на пару нет (findFirst → create).

### F-02 Пользовательские группы: состав, админы, владелец, бан, аватар, выход/удаление

- Бизнес-цель: самоорганизованные групповые чаты с модерацией силами создателя и назначенных админов.
- Роли: создатель/владелец (createdById), админы группы (ChatMember.isAdmin), участники; EMPLOYER нельзя добавить.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /chats → create-group-panel, chat-details-panel, edit-group-dialog, member-actions-menu; POST /chats {type:GROUP}, POST|DELETE /chats/:id/members[/:userId], POST|DELETE /chats/:id/members/:userId/ban, POST|DELETE /chats/:id/members/:userId/admin, POST /chats/:id/transfer/:userId, PATCH /chats/:id, POST|DELETE /chats/:id/avatar, DELETE /chats/:id.
- Завершение: состав/права изменены, системное сообщение (member_added/removed/left, admin_granted, owner_changed, title_changed, avatar_changed) в ленте; при исключении/бане сокеты выведены из комнаты, код приглашения ротирован.
- Шаги и файлы: chats.service.ts assertCanAddToGroup, addMember, removeMember, banMember/unbanMember, setAdmin/transferOwnership (assertGroupOwner), editChat, setChatAvatar/removeChatAvatar (FileService, бакет аватаров), deleteOrLeaveChat, emitSystemMessage; chats.controller.ts; apps/web/src/widgets/chat-window/ui/{create-group-panel,chat-details-panel,edit-group-dialog,member-actions-menu}.tsx.
- Данные на входе / выходе: memberIds/title/description/файл аватара → Chat/ChatMember (isAdmin, bannedAt), Message.systemType+systemMeta; WS chat:member-added/removed, chat:updated, chat:activity.
- Внешние зависимости: PostgreSQL, MinIO (аватар группы), WS RealtimeGateway.leaveRoom.
- Тесты: chats.service.spec.ts («группа не обходит правила личной переписки», «deleteOrLeaveChat», «членство»); apps/api/test/chats.e2e-spec.ts («не участник не видит список участников»).
- Замечено: удаление группы владельцем (deleteOrLeaveChat → chat.delete) не шлёт остальным chat:activity — у них чат висит в списке до рефетча; выход последнего участника из любого не-PRIVATE чата (в т.ч. официального/SAVED) удаляет чат целиком.

### F-03 Вступление в группу по ссылке-приглашению

- Бизнес-цель: пригласить в группу ссылкой, которую админ может отозвать и которая гаснет при исключении/бане.
- Роли: админы группы (выдают/сбрасывают код); любой авторизованный, кроме EMPLOYER и забаненных в этой группе (вступает).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /join-chat/[id]?k=<code> → POST /chats/:id/join; GET /chats/:id/invite, POST /chats/:id/invite/reset (админ).
- Завершение: ChatMember создан с lastReadAt=now (история не «непрочитанная»), редирект на <ROLE_HOME>/chats; неверный код = 404 «Приглашение недействительно».
- Шаги и файлы: apps/web/src/app/join-chat/[id]/page.tsx (роль из sh_role cookie → путь к чатам); chats.service.ts joinByInvite, getInviteCode, resetInviteCode, rotateInviteCode (randomBytes 18 base64url); Chat.inviteCode @unique (миграция 20261014140000_add_chat_invite_code).
- Данные на входе / выходе: {code} → {id,type,title}.
- Внешние зависимости: PostgreSQL.
- Тесты: chats.service.spec.ts («вступление по ссылке-приглашению»).
- Замечено: joinByInvite не шлёт ни системного сообщения member_added, ни chat:activity/chat:member-added — участники не видят вступившего вживую (в отличие от addMember).

### F-04 Официальные авто-чаты (группа, факультет, деканат, поддержка вуза, предметы, «Сохранённые»)

- Бизнес-цель: у каждого пользователя без ручной настройки есть положенные по роли и scope чаты.
- Роли: STUDENT/STAROSTA (группа, факультет, деканат, поддержка вуза, предметы группы), TEACHER (факультет, деканат, поддержка, свои предметы), DEAN, UNIVERSITY_ADMIN/MODERATOR (поддержка), платформенные и EMPLOYER — только SAVED.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): ленивый провижининг на первой странице GET /chats (ensureOfficialChatsThrottled, Redis-флаг chat:ensured:<uid> NX EX); GET /chats/saved.
- Завершение: чат нужного типа/scope найден или создан, пользователь добавлен участником с lastReadAt=now.
- Шаги и файлы: chats.service.ts AUTO_CHATS_BY_ROLE, ensureOfficialChatsForUser, ensureSubjectChats (pair distinct groupId×subject из активного расписания, take 100), ensureOfficialChat, getSavedChat; listChats.
- Данные на входе / выходе: JWT scope (groupId/facultyId/universityId) → Chat type GROUP_OFFICIAL/FACULTY/DEAN/SUPPORT/SUBJECT/SAVED + ChatMember.
- Внешние зависимости: PostgreSQL, Redis (fail-open: без Redis провижинит на каждом запросе).
- Тесты: chats.service.spec.ts («официальные чаты (9.6)»); apps/api/test/chats.e2e-spec.ts («Кросс-вузовая изоляция официальных чатов»).
- Замечено: ensureOfficialChat делает findFirst→create без уникального индекса на (type, scope) — параллельная первая загрузка двух участников может создать дубли официального чата; членство только добавляется (смена группы/ухода с предмета не снимает).

### F-05 Отправка текстового сообщения, ответ, правка, удаление, превью ссылки

- Бизнес-цель: обмен сообщениями в реальном времени с гарантией «сначала БД, потом рассылка».
- Роли: участники чата (не забаненные); в PRIVATE — без взаимной блокировки.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /chats (chat-composer) → WS message:send {chatId, content, replyToId, replyQuote, silent, nonce}; WS message:edit, message:delete; очередь link-preview.
- Завершение: Message с монотонным seq сохранено, message:new (с nonce) в комнату chat:<id>, chat:activity участникам, job new-message в notifications; правка — в окне MESSAGE_EDIT_WINDOW_MS (10 мин), удаление — soft (deletedAt).
- Шаги и файлы: apps/api/src/modules/chats/chats.gateway.ts onMessageSend/onMessageEdit/onMessageDelete; chats.service.ts createMessage → assertCanSend (assertNotFlooding: Redis INCR 20/10 c, fail-open) → allocateSeq (UPDATE chats.last_seq RETURNING в транзакции) → bumpChat → enqueueLinkPreview → notifyNewMessage (снимает hiddenAt, исключает смотрящих в комнате, заглушённых кроме «важных», адресата запроса, silent); apps/api/src/modules/chats/link-preview.processor.ts (OG → Message.linkPreview → message:updated); web apps/web/src/widgets/chat-window/ui/chat-window.tsx (оптимистичный пузырь, nonce), chat-composer.tsx.
- Данные на входе / выходе: MessageSendSchema (shared-schemas) → MessageRow; ошибки WS {event, code} (VALIDATION_ERROR, WRONG_SCOPE, RATE_LIMIT, FORBIDDEN).
- Внешние зависимости: PostgreSQL, Redis, BullMQ (notifications, link-preview), внешние сайты (OG, SSRF-фильтр LinkPreviewService).
- Тесты: chats.gateway.spec.ts; chats.service.spec.ts («createMessage», «editMessage / deleteMessage — только автор», «seq сообщений», «setMuted / notifyNewMessage»); apps/api/src/common/link-preview/link-preview.service.spec.ts; apps/api/test/chats.e2e-spec.ts («Доставка и персистентность»); apps/web/e2e/chat.e2e.ts; apps/web/src/entities/chat/ui/message-content.test.tsx.
- Замечено: editMessage/deleteMessage не проверяют текущее членство — исключённый/забаненный автор может править и удалять свои старые сообщения через WS.

### F-06 Отправка вложений в чат: multipart через API, presign PUT, S3-multipart

- Бизнес-цель: слать фото/видео/документы/голосовые/архивы до лимита категории, не пропуская крупные байты через API-процесс.
- Роли: участники чата с правом писать (assertCanSend: антифлуд, блокировка, квота запроса).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /chats → attachment-dialog, chat-composer, голосовое (use-voice-recorder); POST /chats/:id/messages (multipart/form-data, мелкие файлы); POST /chats/:id/attachments/presign → PUT в MinIO → POST /chats/:id/messages/uploaded; для крупных POST /chats/:id/attachments/multipart/start → /multipart/urls → PUT частей → /messages/uploaded с parts.
- Завершение: Message + File (bucket chat-media, messageId, spoiler/asDocument), message:new в комнату один раз, media.schedule ставит обработку; оптимистичный пузырь заменён реальным.
- Шаги и файлы: chats.controller.ts sendWithAttachments/presignAttachment/startAttachmentMultipart/attachmentPartUrls/sendUploaded; chats.service.ts sendMessageRest, sendMessageFromUploads; apps/api/src/modules/files/file.service.ts upload/presignPut/startMultipart/presignParts/completeMultipart/confirmDirectUpload (ключ с префиксом ownerId, magic bytes, лимит категории, перезапись Content-Type); web chat-window.tsx (needsDirectUpload → uploadDirectAttachments), apps/web/src/entities/chat/lib/compress-image.ts, apps/web/src/shared/api/{direct-upload,multipart-upload,resumable-upload}.ts.
- Данные на входе / выходе: поля сообщения + файлы | {attachments:[{key,uploadId?,parts?,name,spoiler}]} → MessageRow с media; ошибки FILE_TYPE_NOT_ALLOWED, FILE_TOO_LARGE, FILE_DIRECT_UPLOAD_REQUIRED.
- Внешние зависимости: MinIO (публичный клиент для подписей), BullMQ media-image/media-video, Redis.
- Тесты: apps/api/test/chats.e2e-spec.ts («Прямая загрузка вложений»); chats.service.spec.ts («sendMessageRest»); apps/api/src/modules/files/file.service.spec.ts; apps/web/src/shared/api/{direct-upload,multipart-upload,resumable-upload}.test.ts; apps/web/src/entities/chat/lib/{compress-image,attachment-kind,voice-profile}.test.ts.
- Замечено: sendMessageFromUploads создаёт Message до подтверждения файлов; если confirmDirectUpload/completeMultipart бросит (тип/размер/чужой ключ), пустое сообщение с занятым seq остаётся в БД — удаляется только при attached===0 без исключения.

### F-07 Прочтение, непрочитанное, статусы прочтения и догон после обрыва

- Бизнес-цель: точные счётчики непрочитанного «как в Telegram» и непрерывная лента без дублей после переподключения.
- Роли: участники чата.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): WS message:read {chatId, messageId}; GET /chats/unread (бейдж); GET /chats/:id/reads (группы); GET /chats/:id/messages (cursor/around/aroundDate); GET /chats/:id/updates?since=<seq>&sinceTs=.
- Завершение: ChatMember.lastReadAt сдвинут только вперёд до времени сообщения; message:read в комнату, chat:read в user-комнату; клиент склеил дельту или сделал полный рефетч при overflow (>200).
- Шаги и файлы: chats.gateway.ts onMessageRead; chats.service.ts markRead → advanceReadMark, getUnreadSummary (groupBy по OR-веткам, без архива и входящих запросов), getReadReceipts, getMessages, getUpdates (created/edited/pinned/deleted, CHAT_UPDATES_LIMIT=200); отправка = прочтение (notifyNewMessage); web apps/web/src/widgets/chat-window/lib/{read-tracking,merge-updates}.ts, chat-window.tsx catchUp на connect, apps/web/src/entities/chat/lib/use-chats-unread.ts.
- Данные на входе / выходе: messageId/seq → {chatId, messageId, userId, readAt}; {chats, messages}; {created, edited, deleted, latestSeq, overflow}.
- Внешние зависимости: PostgreSQL, WS.
- Тесты: chats.service.spec.ts («markRead», «getUpdates — дельта догона», «getMessages — cursor + членство»); apps/api/test/chats.e2e-spec.ts («Непрочитанные в списке чатов», «Статусы прочтения в группах», «Стабильность истории»); apps/web/src/widgets/chat-window/lib/{read-tracking,merge-updates}.test.ts.

### F-08 Реакции, опросы, закрепление, пересылка, «поделиться постом»

- Бизнес-цель: богатое взаимодействие с сообщениями внутри и между чатами.
- Роли: участники чата (закреплять может любой участник); пересылка — участник обоих чатов; пост — только видимый отправителю.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): message-context-menu, reaction-bar, poll-creator, forward-dialog; POST /chats/messages/:messageId/reactions; POST /chats/:id/poll, GET /chats/polls/:pollId, POST /chats/polls/:pollId/vote; GET /chats/:id/pinned, POST|DELETE /chats/messages/:messageId/pin; POST /chats/:id/forward; POST /chats/:id/share-post.
- Завершение: одна реакция на пользователя (повтор снимает), голос учтён, закреп/откреп, копия сообщения с новыми File на тот же объект; WS message:reaction / chat:pinned / message:new.
- Шаги и файлы: chats.service.ts toggleReaction, createPoll/getPollResults/votePoll (ChatPoll/Option/Vote, неанонимные — имена до 300), setPinned/listPinned, forwardMessage (FileService.copyToMessage + MediaService.scheduleCopy), sharePost (PostsService.assertVisibleToViewer); web apps/web/src/entities/chat/ui/{reaction-bar,chat-poll,forward-dialog,message-context-menu}.tsx, apps/web/src/widgets/chat-window/ui/{poll-creator,shared-cards}.tsx.
- Данные на входе / выходе: emoji | {question, options, anonymous, multiple} | {optionIds} | {messageId} | {postId} → MessageRow / PollResults.
- Внешние зависимости: PostgreSQL, MinIO (копирование объектов), BullMQ media-image (copy-media-variants), link-preview.
- Тесты: chats.service.spec.ts («toggleReaction», «опросы (§38–39)», «setPinned — закрепление», «forwardMessage», «общие условия отправки (assertCanSend)» — sharePost при блокировке).

### F-09 Отложенные сообщения

- Бизнес-цель: отправить сообщение в заданное время без занятия seq заранее.
- Роли: участник чата с правом писать (до 50 отложенных на чат).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): GET|POST /chats/:id/scheduled, PATCH|DELETE /chats/scheduled/:scheduledId; cron deliverScheduledMessages `* * * * *` (CleanupService, Redis-лок).
- Завершение: строка ScheduledMessage «забрана» deleteMany и отправлена createMessage (skipFlood) + message:new; при ошибке — уведомление автору SCHEDULED_FAILED с превью.
- Шаги и файлы: chats.service.ts scheduleMessage/listScheduled/updateScheduled/cancelScheduled/ownScheduled/deliverDueScheduled/notifyScheduleFailed; apps/api/src/modules/cleanup/cleanup.service.ts deliverScheduledMessages; prisma/schema/06-chats.prisma ScheduledMessage.
- Данные на входе / выходе: {content, scheduledAt, replyToId?, replyQuote?, silent?} → ScheduledMessage; партия до 500 за тик.
- Внешние зависимости: PostgreSQL, Redis (CronLockService), BullMQ notifications.
- Тесты: chats.service.spec.ts («доставка отложенных»); apps/api/src/modules/cleanup/cleanup.service.spec.ts (только общий тест локов).
- Замечено: клиента нет — ни apps/web, ни apps/ios, ни apps/android не вызывают /chats/:id/scheduled; функция доступна только через API.

### F-10 Список чатов: папки, архив, закрепление, заглушение, черновики, «Сохранённые»

- Бизнес-цель: организовать мессенджер под себя и управлять шумом уведомлений.
- Роли: любой пользователь (для своих членств).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /chats, /teacher/chats, /starosta/chats, /dean/chats, /university-admin/chats, /moderator/*/chats, /platform-admin/chats → GET /chats (cursor; официальные чаты провижинятся на 1-й странице); GET|POST|PATCH|DELETE /chats/folders[/:id]; POST|DELETE /chats/:id/archive, /pin, /mute {until, importantOnly}; PUT /chats/:id/draft; GET /chats/saved.
- Завершение: состояние на ChatMember (archivedAt, pinnedAt, mutedAt/mutedUntil/muteImportantOnly, draft) или ChatFolder/ChatFolderItem; список перерисован по chat:activity.
- Шаги и файлы: chats.service.ts listChats, setChatArchived, setChatPinned, setMuted, saveDraft, getSavedChat, importantRecipients (ответ/упоминание пробивают «только важные»); apps/api/src/modules/chats/chat-folders.{controller,service}.ts; web apps/web/src/views/chats/ui/chats-view.tsx, apps/web/src/widgets/chat-window/ui/{conversation-list,chat-folders-panel}.tsx, lib/folders.ts, apps/web/src/entities/chat/lib/sort-chats.ts.
- Данные на входе / выходе: ChatListQuery (cursor, фильтры) → Paginated чатов с превью/непрочитанным/черновиком; папки {name, chatIds}.
- Внешние зависимости: PostgreSQL, Redis (флаг провижининга), WS.
- Тесты: apps/api/src/modules/chats/chat-folders.service.spec.ts; chats.service.spec.ts («setMuted / notifyNewMessage»); apps/api/test/chats.e2e-spec.ts («Серверные черновики»); apps/web/src/widgets/chat-window/lib/folders.test.ts.

### F-11 Поиск, медиа/ссылки/календарь чата, выдача вложений и экспорт переписки

- Бизнес-цель: найти сообщение или файл, открыть вложение по защищённой ссылке, выгрузить историю с указанием происхождения.
- Роли: участники чата.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): chat-details-panel, media-viewer; GET /chats/search, GET /chats/:id/media, /media/calendar, /links; GET /chats/attachments/:fileId/url; GET /chats/:id/export (JSON), GET /chats/:id/export/file?format=txt|json&locale=.
- Завершение: выдача с учётом clearedAt/вырезанных периодов; presigned-ссылка со стабильной подписью (+описание вариантов/HLS); файл выгрузки с шапкой «кто/когда/откуда».
- Шаги и файлы: chats.service.ts searchMessages, listChatMedia, getMediaCalendar, listChatLinks, getAttachmentUrl (членство + MediaService.describeOne), exportMessages/exportActor/exportFile; apps/api/src/common/export/export-registry.service.ts; apps/api/src/common/minio/stable-sign.ts; web apps/web/src/entities/chat/ui/{media-viewer,message-attachments}.tsx, apps/web/src/shared/lib/{file-download,media-source}.ts.
- Данные на входе / выходе: q/cursor/kind/month → сообщения/медиа/ссылки; fileId → {url, variants, hls?}; txt/json-файл.
- Внешние зависимости: PostgreSQL, MinIO.
- Тесты: chats.service.spec.ts («searchMessages — область поиска», «getAttachmentUrl — доступ по членству», «exportMessages», «общие материалы (§23)» — listChatMedia/listChatLinks); apps/web/src/shared/lib/{file-download.test.tsx,media-source.test.ts}.

### F-12 Блокировка пользователей, очистка истории и удаление чата «у себя»

- Бизнес-цель: личная защита от нежелательной переписки и контроль своей истории.
- Роли: любой пользователь.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): peer-profile-tab, blocked-users-panel; POST|DELETE /chats/blocks/:userId, GET /chats/blocks; POST /chats/:id/clear {всё | период}; DELETE /chats/:id (PRIVATE — скрыть у себя).
- Завершение: UserBlock создан/снят, обеим сторонам WS chat:block; ChatMember.clearedAt/clearedRanges; PRIVATE — hiddenAt+clearedAt, чат вернётся при новом сообщении.
- Шаги и файлы: chats.service.ts blockUser/unblockUser/emitBlockChanged/listBlocked/isBlockedBetween (проверяется в createChat, assertCanSend, assertCanAddToGroup), clearChat (CLEARED_RANGES_MAX), deleteOrLeaveChat; web apps/web/src/widgets/chat-window/ui/{blocked-users-panel,peer-profile-tab}.tsx.
- Данные на входе / выходе: userId | {from?, to?} → UserBlock (prisma/schema/14-blocks.prisma), ChatMember поля.
- Внешние зависимости: PostgreSQL, WS.
- Тесты: chats.service.spec.ts («deleteOrLeaveChat», «assertCanSend»).

### F-13 Индикаторы действий («печатает», «записывает голосовое») и присутствие в чате

- Бизнес-цель: показывать живую активность собеседников в окне чата и в строке списка.
- Роли: участники чата; присутствие — пользователи одного вуза.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): WS chat:action {chatId, action|null}, legacy typing:start/stop; GET /chats/:id/presence; серверное presence:changed в university-комнату.
- Завершение: chat:action (+ typing:started/stopped) в user-комнаты участников (≤64) или в комнату chat:<id> для больших чатов; онлайн-статус/lastSeenAt.
- Шаги и файлы: chats.gateway.ts onChatAction/onTypingStart/onTypingStop/relayAction; chats.service.ts actionAudience (TYPING_FANOUT_MAX=64), getPresence; apps/api/src/common/realtime/realtime.gateway.ts trackOnline/trackOffline/emitPresence; web apps/web/src/widgets/chat-window/lib/{use-chat-action,use-chat-action-label,chat-actions}.ts.
- Данные на входе / выходе: {chatId, action} → {chatId, userId, action}; [{userId, online}] (lastSeenAt пишется при уходе в офлайн и отдаётся в GET /chats/:id/members).
- Внешние зависимости: WS (socket.io), PostgreSQL (User.lastSeenAt).
- Тесты: chats.gateway.spec.ts («typing — только другим участникам», «onChatAction»); chats.service.spec.ts («getPresence»); apps/web/src/widgets/chat-window/lib/{use-chat-action,chat-actions}.test.ts.
- Замечено: для чатов >64 участников actionAudience возвращает room без проверки членства — не-участник может слать в чужую большую комнату подпись «X печатает» (client.to не требует членства в комнате).

### F-14 Обращения в поддержку платформы (support desk)

- Бизнес-цель: личная линия любого пользователя к команде платформы с очередью, назначением, тегами, метрикой первого ответа и авто-закрытием.
- Роли: любая роль открывает и дописывает; PLATFORM_ADMIN/PLATFORM_MODERATOR разбирают (очередь, ответ, голосовой ответ, назначение, теги, склейка, эскалация, закрытие; @MiniAllowed для мини-аппа).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): настройки аккаунта → apps/web/src/features/contact-support (POST /support, throttle 5/час); /platform-admin/support, /moderator/platform/support (views/support-desk) и мини-апп screens/support.tsx → GET /support, GET /support/tags, GET /support/:id, POST /support/:id/reply, /voice, /merge, /escalate, PATCH /support/:id/assign, /tags, /close; cron closeStaleTickets `0 5 * * *`.
- Завершение: Chat type SUPPORT_PLATFORM (автор + вся команда участниками), открытое обращение одно на человека; ответ открывает закрытое заново; supportFirstReplyAt ставится один раз; склеенная ветка закрыта и читается вместе с целевой; без движения с последним словом команды — закрыто cron-ом.
- Шаги и файлы: apps/api/src/modules/chats/support.{controller,service}.ts (open/createTicket/joinOpenTickets/queue/thread/reply/voiceReply/assign/setTags/tagCounts/merge/escalate/close/closeStale/queueStats/dayStats); chats.service.ts createMessage/publishNewMessage; apps/api/src/common/telegram/telegram-notify.service.ts notifyStaff; apps/web/src/entities/support-ticket/api/support-ticket-api.ts; apps/web/src/views/support-desk/ui/{support-desk-view,support-thread-modal}.tsx; apps/mini-app/src/screens/support.tsx.
- Данные на входе / выходе: {text} → {id, created}; очередь Paginated (status, tag, q, mine); AuditLog support.ticket.*; поля Chat.supportClosedAt/supportAssigneeId/supportTags/supportMergedIntoId/supportFirstReplyAt.
- Внешние зависимости: PostgreSQL, Telegram Bot API (уведомления команды с кнопкой «Беру в работу»), MinIO (голосовой ответ), BullMQ notifications.
- Тесты: apps/api/src/modules/chats/support.service.spec.ts (open, queue, reply, close, closeStale, escalate, assign, теги, merge, voiceReply).
- Замечено: ответ сотрудника идёт через ChatsService.createMessage → notifyNewMessage, поэтому in-app/push MESSAGE-уведомление получают и все остальные сотрудники-участники (антишум сделан только для Telegram); createTicket берёт команду take:100.

### F-15 Конвейер уведомлений: job → Notification → WS / push / email

- Бизнес-цель: единая доставка событий всех модулей на языке каждого получателя, без дублей и без текста ЛС в чужой инфраструктуре.
- Роли: все роли как получатели; продюсеры — сервисы chats, friends, schedules, events, documents, application-services, assignments, consultations, appointments, complaints, career, users.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): очередь BullMQ `notifications` (job'ы new-message, chat-request, schedule-changed, application-updated, document-_, friend-_, assignment-_, consultation-_, appointment-updated, event-reminder, complaint-resolved, moderation-warning, scheduled-message-failed).
- Завершение: Notification создана (createMany skipDuplicates, @@unique userId+dedupeKey), онлайн-адресатам WS notification:new + конверт notification.created, офлайн — web push/APNs/FCM (если pushEnabled) и job email send-notification (если emailEnabled).
- Шаги и файлы: apps/api/src/common/queue/{queue.service,queue.constants,queue.module}.ts (enqueue с таймаутом, ошибка не пробрасывается; attempts 3, backoff); apps/api/src/modules/notifications/notifications.processor.ts (чанки по 500, typeEnabled, render по titleKey/bodyKey+params через renderNotificationMessage из @studenthub/shared-config, getOnlineUserIds); notification-job.type.ts; notifications.service.ts invalidateUnread.
- Данные на входе / выходе: {recipientIds, type, titleKey/bodyKey|title/body, params, data{url,...}, dedupeKey, emailFallback?} → Notification(title, body, titleKey, bodyKey, params, data).
- Внешние зависимости: Redis (BullMQ, кэш счётчика), PostgreSQL, socket.io, web-push/APNs/FCM, SMTP через очередь email.
- Тесты: apps/api/src/modules/notifications/{notifications.processor,notification-messages}.spec.ts; apps/api/src/common/queue/queue.service.spec.ts.
- Замечено: emailFallback никто не выставляет в false, а emailEnabled по умолчанию true — каждое сообщение чата офлайн-участнику (dedupeKey на сообщение) порождает отдельное письмо; «офлайн» = нет ни одного сокета (fetchSockets по всему серверу на каждый job); job'ы new-post/new-story/event-created из PROJECT.md §10.1 никем не ставятся.

### F-16 Колокольчик уведомлений: лента, счётчик, прочтение, удаление

- Бизнес-цель: показать человеку, что произошло, и увести по ссылке к источнику; отдельной страницы нет (by design).
- Роли: все вошедшие.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): поповер колокольчика в сайдбаре (apps/web/src/widgets/notifications-bell/ui/notifications-bell.tsx, оверлей из app-shell); /notifications → redirect('/'); GET /notifications (cursor), GET /notifications/unread-count, PATCH /notifications/:id/read, PATCH /notifications/read-all, DELETE /notifications/:id; WS notification:new.
- Завершение: isRead/readAt проставлены, кэш notif:unread:<uid> сброшен, переход router.push(data.url); cron cleanOldNotifications `0 2 * * 0` удаляет прочитанные старше 30 дней.
- Шаги и файлы: apps/api/src/modules/notifications/notifications.{controller,service}.ts (unreadCount с Redis-кэшем TTL 300 c); apps/web/src/entities/notification/{api/notifications-api.ts,lib/categorize.ts,lib/localize.ts,lib/use-notification-mutations.ts}; apps/web/src/views/notifications/ui/notifications-view.tsx (рендерится в оверлее); apps/web/src/shared/lib/browser-notify.ts; realtime-context.tsx (подписка notification:new).
- Данные на входе / выходе: cursor/limit → Paginated Notification; {count}; {updated}.
- Внешние зависимости: PostgreSQL, Redis, WS.
- Тесты: apps/api/src/modules/notifications/notifications.service.spec.ts; apps/api/test/users-notifications.e2e-spec.ts («Уведомления: список / счётчик / прочтение / настройки»); apps/web/src/entities/notification/lib/{categorize,use-notification-mutations}.test.ts(x); apps/api/src/modules/cleanup/cleanup.service.spec.ts (cleanOldNotifications).

### F-17 Настройки уведомлений (каналы и типы)

- Бизнес-цель: дать человеку отключить шум по типу и выбрать каналы доставки.
- Роли: все вошедшие (веб, iOS, Android).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): настройки аккаунта (apps/web/src/widgets/account-settings/ui/account-settings-panels.tsx), экраны настроек iOS/Android → GET /notifications/settings, PATCH /notifications/settings.
- Завершение: строка NotificationSettings создана с дефолтами (email вкл, push выкл) или обновлена; процессор фильтрует по типу (SYSTEM — всегда) и каналу.
- Шаги и файлы: notifications.service.ts getSettings/updateSettings (DEFAULT_SETTINGS); notifications.processor.ts typeEnabled/emailEnabled/pushEnabled; prisma/schema/10-notifications.prisma NotificationSettings; заглушение отдельного чата — F-10.
- Данные на входе / выходе: {emailEnabled, pushEnabled, scheduleChangeEnabled, appUpdateEnabled, messageEnabled, postEnabled, eventEnabled, systemEnabled}.
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/test/users-notifications.e2e-spec.ts («settings: get создаёт дефолт, patch сохраняет»); notifications.processor.spec.ts.
- Замечено: поле systemEnabled хранится и отдаётся, но процессор его игнорирует (SYSTEM доставляется всегда) — тумблер ничего не делает.

### F-18 Web Push: подписка браузера и доставка через service worker

- Бизнес-цель: системные уведомления в браузере/PWA, когда вкладка закрыта.
- Роли: все вошедшие на вебе (с включённым pushEnabled).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): тумблер push в настройках → apps/web/src/shared/lib/push.ts (Notification.requestPermission, pushManager.subscribe с ключом из GET /push/public-key) → POST /push/subscribe; POST /push/unsubscribe; событие push в SW.
- Завершение: PushSubscription upsert по endpoint (перепривязка к новому пользователю); SW показывает уведомление и по клику фокусирует вкладку/открывает data.url; мёртвые подписки (404/410) удаляются при отправке.
- Шаги и файлы: apps/api/src/modules/push/{push.controller,push.service}.ts (VAPID, sendWebPush, take 20); apps/web/worker/index.ts (push, notificationclick, SKIP_WAITING); apps/web/next.config.* (customWorkerSrc 'worker'); apps/web/src/shared/session/device-data.ts.
- Данные на входе / выходе: {endpoint, keys{p256dh, auth}} → PushSubscription; payload {title, body, url}.
- Внешние зависимости: web-push (VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT), push-сервисы браузеров.
- Тесты: нет (PushService и apps/web/src/shared/lib/push.ts без тестов).

### F-19 Мобильные пуши iOS/Android (APNs, FCM)

- Бизнес-цель: доставлять уведомления на телефоны нативных приложений с бейджем непрочитанного.
- Роли: пользователи iOS/Android-приложений.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): apps/ios/Sources/Core/Push/PushRegistrar.swift, apps/android/app/src/main/kotlin/kz/studenthub/app/core/push/Push.kt → POST /push/devices {token, platform, appVersion}, POST /push/devices/remove (выход); вызов PushService.sendToUser из процессора уведомлений.
- Завершение: DeviceToken upsert по token (переезжает за новым владельцем), пуш отправлен по платформе записи; ответ «gone» удаляет токен.
- Шаги и файлы: apps/api/src/modules/push/push.service.ts registerDevice/unregisterDevice/sendToDevices (badge = count непрочитанных); apns.service.ts (node:http2 + ES256 JWT), apns.payload.ts; fcm.service.ts (OAuth service-account → FCM v1), fcm.payload.ts; prisma/schema/10-notifications.prisma DeviceToken (миграция 20261015130000_add_android_device_platform).
- Данные на входе / выходе: {token, platform IOS|ANDROID, appVersion} → DeviceToken; {title, body, url, badge}.
- Внешние зависимости: APNs (APNS_KEY_ID/TEAM_ID/PRIVATE_KEY/BUNDLE_ID/PRODUCTION), FCM (FCM_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY), Google OAuth.
- Тесты: apps/api/src/modules/push/{apns.payload,fcm.payload}.spec.ts (только сборка payload; ApnsService/FcmService/PushService без тестов).
- Замечено: регистрация устройства не включает pushEnabled (по умолчанию false) — без ручного тумблера телефон пушей не получает; обещанной в схеме чистки устаревших токенов по lastSeenAt нет ни в одном cron.

### F-20 Email: транзакционные письма и офлайн-зеркало уведомлений

- Бизнес-цель: письма-инвайты, сброс пароля, подтверждения компаний и заявок вузов, дубль уведомлений на почту офлайн-пользователям.
- Роли: приглашённые (ещё без аккаунта), пользователи, внешние адресаты (компании, заявители демо).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): очередь BullMQ `email`: send-invite (invites), send-password-reset (auth), send-company-verification (career), send-demo-verification/approved/rejected (onboarding), send-notification (процессор уведомлений).
- Завершение: письмо отрендерено (html+text) на locale из payload и отправлено через SMTP; без SMTP_HOST — jsonTransport (только лог); неизвестный job/без адресата — ошибка job'а.
- Шаги и файлы: apps/api/src/modules/email/{email.processor,mailer.service,templates,email-strings}.ts; продюсеры apps/api/src/modules/{invites/invites.service,auth/password-reset.service,career/companies.service,onboarding/demo-requests.service}.ts; идемпотентность — детерминированный jobId у продюсера.
- Данные на входе / выходе: {to, locale, firstName, ...поля шаблона} → письмо; адрес в лог не пишется.
- Внешние зависимости: SMTP (SMTP_HOST/PORT/USER/PASS/FROM), Redis (BullMQ).
- Тесты: apps/api/src/modules/email/{email.processor,templates}.spec.ts.
- Замечено: шаблоны send-welcome, send-application-status, send-schedule-change, send-event-reminder есть в процессоре, но ни один модуль эти job'ы не ставит (мёртвый код; эти события идут через send-notification).

### F-21 Telegram-уведомления команде платформы (обращения, жалобы, сводка)

- Бизнес-цель: быстро будить дежурных о новых обращениях/жалобах без пересылки содержимого в Telegram.
- Роли: PLATFORM_ADMIN/PLATFORM_MODERATOR с привязанным TelegramAccount.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): вызовы TelegramNotifyService.notifyStaff из support.service (новое обращение, ответ автора, эскалация), complaints.service; cron sendDailyDigest `5 * * * *` (час из политики платформы), alertQueueBacklog `15 * * * *`, watchServices `*/5 * * * *`, reportStorageUsage `45 4 * * *`.
- Завершение: сообщение ушло привязанным сотрудникам с учётом окна тишины (кроме срочных), с inline-кнопкой «Беру в работу»; ошибка отправки операцию не роняет.
- Шаги и файлы: apps/api/src/common/telegram/{telegram-notify.service,digest}.ts; apps/api/src/modules/cleanup/cleanup.service.ts sendDailyDigest/alertQueueBacklog/watchServices/reportStorageUsage; prisma/schema/29-telegram.prisma.
- Данные на входе / выходе: kind, text, ключ дедупликации, urgent, кнопка {kind,id} → Telegram sendMessage.
- Внешние зависимости: Telegram Bot API (токен бота), Redis (локи cron), PostgreSQL.
- Тесты: apps/api/src/common/telegram/{telegram-notify.service,digest}.spec.ts; cleanup.service.spec.ts («sendDailyDigest», «reportStorageUsage»).

### F-22 Загрузка, выдача и удаление файлов (общий /files: буфер, presign+confirm, S3-multipart)

- Бизнес-цель: безопасно принимать файлы для постов, сторис и заявок с проверкой типа по содержимому и лимитов категории.
- Роли: все вошедшие (владелец файла); бакеты POSTS, STORIES, APPLICATIONS (AVATARS через /files запрещён).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): apps/web/src/shared/api/files-api.ts, apps/web/src/entities/story/api/story-api.ts → POST /files/upload?bucket= (буфер ≤ DIRECT_UPLOAD_THRESHOLD), POST /files/presign → PUT в MinIO → POST /files/confirm; POST /files/multipart/start|urls|complete|abort (throttle 60/мин); GET /files/:id/presigned; DELETE /files/:id.
- Завершение: объект в MinIO под ключом `<ownerId>/<uuid>.<ext>`, Content-Type переписан по magic bytes, запись File (mediaStatus PENDING для медиа) и постановка медиа-обработки; presigned GET со стабильной подписью (кеш браузера); удаление — запись+варианты, объект — когда ссылок не осталось.
- Шаги и файлы: apps/api/src/modules/files/{files.controller,file.service,mime-detector}.ts (detectAllowedFileType, optInRefused для архивов, assertKeyOwner, discard); apps/api/src/common/minio/{minio.module,minio-buckets.service,public-url,stable-sign}.ts (бакеты и политики на старте, публичный клиент MINIO_PUBLIC_ENDPOINT); @studenthub/shared-config FILE_UPLOAD (MAX_BYTES по категории, пороги).
- Данные на входе / выходе: буфер | {bucket, mime} → {key, url, expiresAt} → {bucket, key, name} → File; ошибки FILE_TYPE_NOT_ALLOWED, FILE_TOO_LARGE, FILE_DIRECT_UPLOAD_REQUIRED, WRONG_SCOPE, NOT_FOUND.
- Внешние зависимости: MinIO/S3 (внутренний и публичный endpoint), PostgreSQL, BullMQ media-*.
- Тесты: apps/api/src/modules/files/file.service.spec.ts; apps/api/test/files.integration.e2e-spec.ts (реальный MinIO); apps/web/src/shared/api/{direct-upload,multipart-upload,resumable-upload}.test.ts; apps/web/src/shared/lib/file-limits.test.ts.
- Замечено: DELETE /files/:id проверяет только владельца — можно удалить свой файл, уже привязанный к сообщению, документу, материалу или поданной заявке, и сущность молча теряет вложение.

### F-23 Медиа-обработка: варианты изображений, постер и HLS видео (воркер)

- Бизнес-цель: лёгкие WebP-варианты и LQIP для картинок, постер и адаптивный HLS 360–1080 для видео, не нагружая API.
- Роли: системный процесс (все загрузки медиа в медиа-бакетах).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): MediaService.schedule из FileService (upload/confirm/complete) и scheduleCopy при пересылке → очереди `media-image` (process-media, copy-media-variants) и `media-video` (process-media, 2 попытки, lockDuration 5 мин); процесс `node dist/worker.js` при MEDIA_PROCESSING=worker, иначе inline в API.
- Завершение: FileVariant-строки и объекты `variants/<fileId>/…` записаны в одной транзакции со статусом READY; asDocument → NONE; без ffmpeg видео остаётся PENDING и играет оригиналом; исчерпанные попытки → FAILED.
- Шаги и файлы: apps/api/src/worker.ts, apps/api/src/worker.module.ts; apps/api/src/modules/media/{media.module,media.service,media-processing.service,media-image.processor,media-video.processor,media-job,image-pipeline,ffmpeg,media-plan,media-keys,media.constants}.ts (sweepStaleTmp в MEDIA_TMP_DIR, hasFfmpeg перепроверка раз в минуту, копия у «соседа» с тем же key); prisma/schema/08-files.prisma File.mediaStatus/FileVariant (миграция 20261016054626_add_media_processing).
- Данные на входе / выходе: {fileId} | {sourceId, fileId} → FileVariant(kind, width, key), File.width/height/durationMs/posterKey, HLS-плейлисты и сегменты.
- Внешние зависимости: sharp, ffmpeg/ffprobe, MinIO, Redis (BullMQ), конкурентность MEDIA_IMAGE_CONCURRENCY/MEDIA_VIDEO_CONCURRENCY.
- Тесты: apps/api/src/modules/media/{media.service,media-processing.service,media-plan,ffmpeg,image-pipeline}.spec.ts; apps/web/src/shared/api/media.test.ts.

### F-24 Воспроизведение видео: HLS-плейлисты и сегменты по подписанному токену

- Бизнес-цель: стримить видео из приватных бакетов без постоянных публичных ссылок и без обрыва длинных роликов.
- Роли: любой, кому модуль-владелец (чат, лента, сторис, профиль, материалы) выдал описание медиа; сами маршруты @Public.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): плеер медиа (apps/web/src/entities/chat/ui/media-viewer.tsx, apps/web/src/shared/lib/media-source.ts) → GET /media/:fileId/hls/master.m3u8?t=, GET /media/:fileId/hls/:rendition/index.m3u8?t=, GET /media/:fileId/hls/:rendition/:segment?t= (throttle 1200/мин).
- Завершение: master-токен (15 мин) обменян на play-токен на весь просмотр, плейлисты переписаны с токенами, сегмент — 302 на presigned URL (cache-control private 300 c).
- Шаги и файлы: apps/api/src/modules/media/media-hls.controller.ts; media.service.ts describe/describeOne/masterPath/issueToken/verifyToken (MEDIA_TOKEN_SECRET, иначе производный от JWT_ACCESS_SECRET), masterPlaylist/renditionPlaylist/segmentUrl (белый список имён сегментов); apps/api/src/common/minio/stable-sign.ts.
- Данные на входе / выходе: fileId + токен {fid, k} → m3u8 / 302 Location; 403 FORBIDDEN при неверном/истёкшем токене.
- Внешние зависимости: MinIO (presigned), JWT (@nestjs/jwt).
- Тесты: apps/api/src/modules/media/media.service.spec.ts; apps/web/src/shared/lib/media-source.test.ts.

### F-25 Cron-инфраструктура: расписание задач и распределённые локи

- Бизнес-цель: все периодические задачи платформы в одном месте, без двойного запуска на нескольких инстансах API.
- Роли: системный процесс (только API; воркер медиа cron не запускает).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): @nestjs/schedule в CleanupService — 21 задача: scheduleEventReminders `*/15`, publishScheduledPosts `* * * * *`, deleteExpiredStories `*/30`, deliverScheduledMessages `* * * * *`, sweepDocumentExpiry `30 3`, liftExpiredBlocks `*/5`, rotateDuty `0 9 * * 1`, expireInvites `0 *`, purgePasswordResetTokens `15 3`, cleanOldNotifications `0 2 * * 0`, cleanAuditLogs `0 1 1 * *`, cleanDetachedFiles `45 3`, cleanOrphanFiles `0 4`, sweepIncompleteUploads `30 4`, resumeMediaProcessing `*/10`, sendDailyDigest `5 *`, alertQueueBacklog `15 *`, purgeUnconfirmedDemoRequests `30 4`, closeStaleTickets `0 5`, watchServices `*/5`, reportStorageUsage `45 4`.
- Завершение: задача отработала под локом `cron:lock:<name>` (SET NX PX, снятие только своим токеном) либо вернула null — «идёт на другом инстансе»; при недоступном Redis — выполняется без лока (fail-open).
- Шаги и файлы: apps/api/src/modules/cleanup/{cleanup.module,cleanup.service}.ts (LOCK_TTL_MS, BATCH_SIZE 500, deleteInBatches; делегирование в events, posts, stories, chats, documents, platform, support, media, complaints, demo-requests); apps/api/src/common/redis/{cron-lock.service,redis.module}.ts.
- Данные на входе / выходе: нет входа; счётчики обработанных записей в лог.
- Внешние зависимости: Redis, PostgreSQL, MinIO, Telegram (сигналы).
- Тесты: apps/api/src/modules/cleanup/cleanup.service.spec.ts («Redis-лок задач (Ф13.9)» и по задачам); apps/api/src/common/redis/cron-lock.service.spec.ts.
- Замечено: таблица §10.2 PROJECT.md описывает 10 задач из 21 (нет publishScheduledPosts, deliverScheduledMessages, sweepIncompleteUploads, watchServices и др.); очередь `cleanup` зарегистрирована, но процессора и продюсеров у неё нет.

### F-26 Уборка хранилища: отвязанные записи, осиротевшие объекты, брошенные загрузки, учёт места

- Бизнес-цель: не платить за мусор в MinIO и не держать записи File без владельца.
- Роли: системный процесс; сигнал о переполнении — команде платформы.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): cron cleanDetachedFiles `45 3 * * *`, cleanOrphanFiles `0 4 * * *`, sweepIncompleteUploads `30 4 * * *`, reportStorageUsage `45 4 * * *`.
- Завершение: File-строки чат-/материал-бакетов с messageId/materialId=null удалены; объекты без File (с окном безопасности; живы варианты `variants/<fileId>/…`, постеры File.posterKey и обложки User.coverUrl в profile-covers) удалены; незавершённые multipart-загрузки отменены; при превышении порога — один сигнал в Telegram.
- Шаги и файлы: apps/api/src/modules/cleanup/cleanup.service.ts cleanDetachedFilesTask/cleanOrphanFilesTask/sweepIncompleteUploadsTask (listIncompleteUploadsQuery постранично)/reportStorageUsageTask; FileService.delete, MediaService.purgeVariants.
- Данные на входе / выходе: списки объектов 9 бакетов → удалённые объекты/записи, суммарный объём.
- Внешние зависимости: MinIO, PostgreSQL, Redis (лок, пауза сигнала), Telegram.
- Тесты: apps/api/src/modules/cleanup/cleanup.service.spec.ts («cleanDetachedFiles», «cleanOrphanFiles», «sweepIncompleteUploads», «reportStorageUsage»).

### F-27 Догонялка медиа-обработки и самоконтроль сервисов

- Бизнес-цель: ни одно медиа не застревает без вариантов, а падение БД/Redis/хранилища или всплеск ошибок сразу видны команде.
- Роли: системный процесс; получатели сигналов — команда платформы.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): cron resumeMediaProcessing `*/10 * * * *`, watchServices `*/5 * * * *`, alertQueueBacklog `15 * * * *`.
- Завершение: PENDING старше 10 мин и необработанные медиа (NONE, не asDocument, свежие первыми) снова в очереди, по 200 за проход (jobId детерминирован); смена «не отвечает ↔ снова отвечает» и всплеск ошибок за час — одно сообщение в Telegram.
- Шаги и файлы: apps/api/src/modules/media/media.service.ts resumeAndBackfill; cleanup.service.ts resumeMediaProcessing/watchTask (SELECT 1, redis.ping, bucketExists, countServerErrors)/alertQueueBacklogTask; apps/api/src/common/queue/queue.service.ts counts.
- Данные на входе / выходе: нет входа → {resumed, backfilled}; число недоступных сервисов.
- Внешние зависимости: PostgreSQL, Redis, MinIO, BullMQ, Telegram.
- Тесты: cleanup.service.spec.ts («resumeMediaProcessing»); apps/api/src/modules/media/media.service.spec.ts.
- Замечено: watchServices сам зависит от Redis (состояние «был down», лок) — при падении Redis сигнал «не отвечает: Redis» будет слаться каждые 5 минут, т.к. признак wasDown не читается.

### F-28 Realtime-подключение: аутентификация сокета, комнаты, ротация токена, мультивкладочность

- Бизнес-цель: одно WS-соединение на аккаунт в браузере, адресная доставка событий только по комнатам и мгновенное отключение при отзыве сессии.
- Роли: все вошедшие; привилегированные роли без 2FA при TWO_FACTOR_ENFORCE не подключаются.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): socket.io handshake (auth.token или Authorization: Bearer, transports websocket); WS auth:refresh {token}; chat:join/chat:leave; серверные события user-/group-/university-/chat-комнат и единый конверт REALTIME_CHANNEL.
- Завершение: сокет вошёл в user:<id>, group:<groupId>, university:<universityId>; онлайн-счётчик +1 и presence:changed в комнату вуза; при выходе/блокировке/смене пароля — disconnectUser; при обрыве клиент перевыпускает токен, переподключается, перезаходит в комнаты чатов и инвалидирует кэш react-query.
- Шаги и файлы: apps/api/src/common/realtime/{realtime.gateway,realtime.module}.ts (isUsableAccessToken отвергает typ=TWO_FACTOR, SessionRevocationService.isRevoked по iat, leaveRoom, emitToUser/emitToRoom/emitEventToUser, getOnlineUserIds, usersInRoom); apps/api/src/common/redis/session-revocation.service.ts; apps/api/src/main.ts (IoAdapter); web apps/web/src/shared/realtime/{realtime-context.tsx,realtime-client.ts,leader-election.ts,realtime-bus.ts} (лидер вкладок через BroadcastChannel, рефкаунт комнат chat:<id>, перевыборы при pagehide/молчании >3 c).
- Данные на входе / выходе: access JWT → client.data {userId, role, universityId}; события {chatId,…}, конверт {type, entityId, version, ts, data}.
- Внешние зависимости: socket.io, Redis (отзыв сессий), PostgreSQL (User.lastSeenAt), BroadcastChannel в браузере.
- Тесты: apps/api/src/common/realtime/realtime.gateway.spec.ts; apps/api/src/common/redis/session-revocation.service.spec.ts; apps/web/src/shared/realtime/{realtime-client,leader-election}.test.ts, {realtime-context,realtime-multitab}.test.tsx.
- Замечено: socket.io работает на стандартном IoAdapter без Redis-адаптера, а онлайн-счётчик — Map в памяти процесса: при >1 инстансе API события из другого инстанса (процессоры, cron) не дойдут до сокетов, а «онлайн/офлайн» и выбор канала уведомления будут неверны.

### F-29 PWA: установка, офлайн-режим и обновление версии

- Бизнес-цель: работать как приложение с домашнего экрана, показывать ключевые данные без сети и не застревать на старом бандле после деплоя.
- Роли: все пользователи веба (в т.ч. гость для офлайн-фолбэка).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): регистрация sw.js (@ducanh2912/next-pwa, register:true, отключён в dev/E2E); manifest.webmanifest; /offline (фолбэк документа); beforeinstallprompt/appinstalled и инструкция для iOS (pwa-install.ts) в настройках; тост «Доступна новая версия» / кнопка в настройках → postMessage SKIP_WAITING.
- Завершение: NetworkFirst-кэш только GET (schedule, student-id/me, me/today, materials, задания, часть истории сообщений); при новом SW — тост, по нажатию skipWaiting → controllerchange → перезагрузка; ChunkLoadError ведёт к перезагрузке; при выходе API-кэши SW удаляются.
- Шаги и файлы: apps/web/next.config.mjs (withPWAInit, skipWaiting:false, runtimeCaching, fallbacks.document, no-cache заголовки на sw.js/workbox/worker/fallback); apps/web/worker/index.ts; apps/web/src/shared/lib/{use-sw-update,pwa-install}.ts (BUILD_ID=NEXT_PUBLIC_BUILD_ID, isChunkLoadError); apps/web/src/app/offline/page.tsx; apps/web/src/shared/session/device-data.ts (очистка кэшей и push-подписки при выходе); apps/web/public/manifest.webmanifest; apps/web/src/widgets/whats-new/ui/whats-new-dialog.tsx.
- Данные на входе / выходе: GET-ответы API → Cache Storage (*-api); версия сборки → состояние update {version, state, check, apply}.
- Внешние зависимости: Service Worker API, Workbox, Cache Storage, BroadcastChannel.
- Тесты: apps/web/src/shared/lib/chunk-error.test.ts; apps/web/src/shared/session/device-data.test.ts (use-sw-update, pwa-install, worker/index.ts без тестов).
