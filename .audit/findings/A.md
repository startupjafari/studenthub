## Группа A — аудит

> Фаза 2, только чтение кода. Тесты и сборки не запускались. Каждая P1 подтверждена чтением
> указанных строк; оценки нагрузки (F02, F08, F09) — расчёт по коду, не замер.

### Статусы процессов

| Процесс                       | Статус                       | Коротко                                                                                                                                                                       |
| ----------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-01 Вход по логину и паролю  | работает с проблемами        | email сравнивается с учётом регистра вопреки PROJECT.md (F01); IP-лимит 5/15 мин общий на кампус за NAT (F02)                                                                 |
| A-02 Второй шаг 2FA           | работает с проблемами        | у EMPLOYER после входа с 2FA в токене `companyId=null` (F05); сгоревший challenge продолжает проверять коды и списывает backup-код (F11)                                      |
| A-03 Настройка и форс 2FA     | работает с проблемами        | нет восстановления доступа при потере аутентификатора (F07); включение/отключение не в аудите (F12)                                                                           |
| A-04 Вход по QR               | работает с проблемами        | повторный approve перезаписывает userId; QR превращает 15-минутный access в 30-дневную сессию (F10)                                                                           |
| A-05 Refresh и выход          | работает с проблемами        | `refresh_tokens` никто не чистит (F08); два bcrypt(12) на каждый refresh (F09); refresh 100/мин с IP на NAT (F02); гонка вкладок (F30)                                        |
| A-06 Сброс пароля             | работает с проблемами        | для адреса с заглавными буквами письмо не уходит никогда (F01)                                                                                                                |
| A-07 Выдача инвайта           | работает с проблемами        | регистр email (F01); декан выдаёт TEACHER на чужой факультет (F17); ссылка из сырого CORS_ORIGIN (F18)                                                                        |
| A-08 Массовый импорт          | работает с проблемами        | дубли по регистру email (F01); XLSX разбирается целиком без потолка, построчные запросы (F20)                                                                                 |
| A-09 Отзыв и истечение        | работает с проблемами        | админ вуза не видит чужие инвайты; отзыв без условного UPDATE; истечение без аудита (F19)                                                                                     |
| A-10 Регистрация по инвайту   | работает с проблемами        | 3/час и превью 10/час с IP ломают регистрацию в аудитории (F02); староста по инвайту не становится `Group.starostaId` (F21); email ссылочного инвайта не подтверждается (F22) |
| A-11 Смена пароля             | работает с проблемами        | нет аудита и счётчика перебора текущего пароля (F12)                                                                                                                          |
| A-12 Профиль, username        | работает с проблемами        | `dormitory`/`birthDate` правит сам студент, а они в «проверенном» студбилете (F06); username раскрывается поиском (F16)                                                       |
| A-13 Аватар и обложка         | работает с проблемами        | прежний аватар удаляется до проверки нового файла; гонка превью (F14)                                                                                                         |
| A-14 Удаление аккаунта        | работает с проблемами        | Telegram-привязка и уведомления переживают удаление (F04); без повторной аутентификации и аудита (F12, F13)                                                                   |
| A-15 Блокировка               | работает с проблемами        | в вебе — одним кликом без подтверждения и без срока (F24)                                                                                                                     |
| A-16 Завершение сессий        | работает с проблемами        | только мини-апп; в вебе нет ни кнопки админа, ни «выйти на всех устройствах» (F24)                                                                                            |
| A-17 Список и выгрузка        | работает                     | замечания по производительности (F27)                                                                                                                                         |
| A-18 Чужой профиль            | работает с проблемами        | в полной карточке уходит `locale` владельца (F15)                                                                                                                             |
| A-19 Справочник людей         | работает                     | тестов нет (F32)                                                                                                                                                              |
| A-20 Учебные данные деканатом | работает                     | см. F06: не все поля студбилета в STAFF_MANAGED                                                                                                                               |
| A-21 Экран «Сегодня»          | работает                     | используется только преподавателем; `StudentToday` мёртв (F26)                                                                                                                |
| A-22 Лента активности         | работает, но без потребителя | веб эндпоинт не вызывает; сервис читает чужие таблицы мимо модулей (F26)                                                                                                      |
| A-23 Студбилет                | работает с проблемами        | самодекларируемые поля в проверенной карте (F06); проверка не аудируется (F25)                                                                                                |
| A-24 Привязка Telegram        | работает с проблемами        | не отзывается при удалении (F04); Telegram, отозванный у другого админа, привязать нельзя — 409 (F23)                                                                         |
| A-25 Мини-апп                 | работает с проблемами        | мини-токен проходит в WebSocket мимо белого списка (F03); нет проверки `deletedAt` (F04)                                                                                      |
| A-26 Telegram-бот             | работает с проблемами        | удалённый сотрудник берёт жалобы и читает /queue; 2FA не требуется (F04)                                                                                                      |
| A-27 Барьеры доступа          | работает с проблемами        | WS не знает о `client='mini'` (F03) и о техработах (F28); публичные auth-маршруты считаются по IP (F02)                                                                       |
| A-28 Правовые документы       | работает с проблемами        | нет повторного согласия при смене `LEGAL_VERSION` (F29)                                                                                                                       |

### Проблемы

#### A-F01 [P1] Email сравнивается с учётом регистра: сброс пароля недоступен, вход по email ломается, возможны дубли учёток

- Процесс: A-01, A-06, A-07, A-08, A-10
- Где: packages/shared-schemas/src/invites.ts:26 и packages/shared-schemas/src/auth.ts:74 (`email: z.string().email()` — без trim/lowercase); apps/api/src/modules/invites/invites.service.ts:101, 371, 406 (email пишется как пришёл); apps/api/src/modules/users/users.service.ts:1863-1869 (`createInvitedUser` нормализует только username); packages/shared-schemas/src/auth.ts:152-153 (`ForgotPasswordSchema` приводит к нижнему регистру); apps/api/src/modules/users/users.service.ts:1347-1348 (`findForPasswordReset` — точное равенство); apps/api/src/modules/users/users.service.ts:280 (`email: identifier.trim()` — точное равенство); apps/api/src/modules/invites/invites.service.ts:496-506 (`loadTakenEmails` — `in` с учётом регистра, lower только после выборки); prisma/schema/01-users.prisma:7 (`email String @unique`, не citext). Контракт: docs/PROJECT.md:643 «identifier — email ИЛИ username, регистронезависимо».
- Суть: инвайт выдан на `Ivanov@Uni.kz` (из таблицы деканата, руками). Пользователь создаётся с этим же написанием. (1) «Забыли пароль»: форма приводит адрес к `ivanov@uni.kz`, поиск точный → учётка не найдена, ответ 202, письма нет — сбросить пароль человек не может никогда, при любом написании. (2) Вход по email работает только при точном совпадении регистра, хотя документ обещает регистронезависимость. (3) Массовый импорт и одиночный инвайт не видят `ivanov@uni.kz` как занятый, если в базе `Ivanov@Uni.kz` → второй инвайт, вторая учётка того же человека (уникальный индекс регистрозависим).
- Решение: нормализовать email на входе — `z.string().trim().toLowerCase().email()` в `CreateInviteSchema`, `BulkInviteCommitRowSchema`, `RegisterByInviteSchema`; в `bulkPreview/bulkCreate` lowercase до `loadTakenEmails`; в `findByLoginIdentifierForAuth`/`findForPasswordReset` сравнивать `mode: 'insensitive'` (или lower). Миграцией данных привести существующие `users.email`/`invites.email` к нижнему регистру (с предварительной проверкой коллизий) и заменить уникальный индекс на `lower(email)` либо тип citext.
- Файлы для правки: packages/shared-schemas/src/{auth.ts,invites.ts}; apps/api/src/modules/users/users.service.ts; apps/api/src/modules/invites/invites.service.ts; prisma/schema/01-users.prisma + новая миграция; тесты users/invites/auth.
- Стоп-точки: миграция (данные + индекс), контракт API/shared-schemas

#### A-F02 [P1] Лимиты публичных auth-маршрутов считаются по IP: кампус за NAT упирается в 429 на входе, регистрации и refresh

- Процесс: A-01, A-02, A-05, A-06, A-10, A-27
- Где: apps/api/src/common/guards/user-throttler.guard.ts:35-38 (без валидного Bearer трекер = `req.ip`); apps/api/src/modules/auth/auth.controller.ts:52 (login 5/15 мин), :70 (login/2fa 5/15 мин), :139 (register-by-invite 3/час), :158 (forgot 3/15 мин), :181 (reset 5/15 мин), :193-195 (refresh без `@Throttle` → общий 100/мин, apps/api/src/app.module.ts:109); apps/api/src/modules/invites/invites.controller.ts:68 (preview 10/час); apps/web/src/shared/api/instance.ts:41-43, 82-89 (refresh уходит без Bearer; любой отказ refresh → `clearAuth` + уход на /login).
- Суть: сам `UserThrottlerGuard` признаёт, что «вуз за NAT делит один адрес на весь кампус», но публичные маршруты по-прежнему считаются по IP. Сценарий онбординга: декан раздал 30 инвайтов на паре, студенты регистрируются с вузовского Wi-Fi — превью ссылки открывается 10 раз в час, регистрация проходит у троих, остальные получают 429. Вход: 5 входов за 15 минут на весь кампус (лаборатории, начало семестра). Refresh: refresh-запрос идёт без Authorization, поэтому все студенты за одним адресом делят 100 обменов в минуту; при ~2000 активных вкладок (обмен раз в 15 мин ≈ 130/мин) часть refresh получает 429, клиент считает сессию мёртвой и выбрасывает человека на /login. Защиту от подбора уже даёт счётчик по учётке (`LoginAttemptsService`, 10/15 мин), а токены инвайта/refresh/сброса — 122+ бит, IP-лимит здесь мало что добавляет.
- Решение: refresh — трекер по id refresh-токена из cookie (часть до точки) или исключить refresh из IP-лимита; register-by-invite и preview — трекер по хэшу токена инвайта (токен одноразовый) с мягким IP-потолком (например 100/час); login/login-2fa — составной ключ IP+identifier (или IP-лимит порядка 50/15 мин при сохранении счётчика по учётке); на клиенте отличать 429 refresh от отказа сессии и повторять с бэкоффом, не выкидывая на /login.
- Файлы для правки: apps/api/src/common/guards/user-throttler.guard.ts; apps/api/src/modules/auth/auth.controller.ts; apps/api/src/modules/invites/invites.controller.ts; apps/web/src/shared/api/instance.ts; docs/BACKEND_RULES.md §6.3 (таблица лимитов).
- Стоп-точки: нет (но меняется правило BACKEND_RULES §6.3 — согласовать с человеком)

#### A-F03 [P1] Токен мини-аппа открывает WebSocket без ограничений белого списка

- Процесс: A-25, A-27
- Где: apps/api/src/common/realtime/realtime.gateway.ts:42-61 и :160-169 (`isUsableAccessToken` проверяет только `typ` и `tfa`, поле `client` не смотрит; в `client.data` оно не сохраняется); apps/api/src/common/guards/mini-app.guard.ts:20-37 (ограничение `client:'mini'` — только HTTP-guard); apps/api/src/modules/chats/chats.gateway.ts:71-110 (chat:join, message:send/edit/delete работают от `client.data.userId`); apps/api/src/modules/mini/mini.service.ts:323-334 (мини-токен подписан тем же секретом, `client:'mini'`).
- Суть: замысел §8.3 — «токен из Telegram пускает ТОЛЬКО на @MiniAllowed, телефон теряют». Но тем же токеном можно подключиться к Socket.IO: handshake его принимает, человек попадает в комнаты `user:`/`university:`, получает уведомления и сообщения в реальном времени, заходит в свои чаты и отправляет/правит/удаляет сообщения от имени администратора платформы. Потерянный телефон с открытым Telegram даёт больше, чем задумано.
- Решение: в `isUsableAccessToken` (и в обработчике `auth:refresh`) отклонять `payload.client === 'mini'`; добавить спеку на это. Если мини-аппу WS когда-нибудь понадобится — отдельный namespace с белым списком событий.
- Файлы для правки: apps/api/src/common/realtime/realtime.gateway.ts (+ spec).
- Стоп-точки: нет

#### A-F04 [P1] Удалённый аккаунт сотрудника платформы сохраняет доступ через Telegram (бот, уведомления, мини-апп)

- Процесс: A-14, A-24, A-25, A-26
- Где: apps/api/src/modules/users/users.service.ts:1550-1638 (`softDeleteSelf` не трогает `TelegramAccount`, роль платформенного сотрудника сохраняется — понижается только STAROSTA, :1560); apps/api/src/modules/telegram-hook/telegram-hook.service.ts:453-479 (`actorFor`: нет `deletedAt`, нет требования 2FA); apps/api/src/common/telegram/telegram-notify.service.ts:85-97 (рассылка по привязкам без `deletedAt`); apps/api/src/modules/mini/mini.service.ts:171-211 (`session` без `deletedAt`).
- Суть: модератор платформы удаляет свой аккаунт (ПДн затёрты, сессии погашены), но привязка Telegram остаётся `revokedAt=null`. Дальше: (1) он продолжает получать в Telegram уведомления о новых жалобах и обращениях; (2) кнопкой «Беру в работу» назначает на себя обращения и берёт жалобы (`support.assign`/`complaints.take` от имени «Удалённого пользователя»); (3) командами /queue /digest /duty /status читает состояние платформы. Мини-апп спасает только форс 2FA (удаление сбрасывает `twoFactorEnabled`), но при `TWO_FACTOR_ENFORCE=false` (аварийный тумблер) выдаётся и рабочий токен. Бот вообще не требует 2FA, хотя для веба платформенным ролям она обязательна.
- Решение: в `softDeleteSelf` в той же транзакции `telegramAccount.updateMany({ where: { userId }, data: { revokedAt: now } })`; во всех трёх местах добавить `user: { deletedAt: null }` в выборку; в `actorFor` требовать `twoFactorEnabled` (как веб и мини-апп). Тесты на удалённого актёра в telegram-hook и mini.
- Файлы для правки: apps/api/src/modules/users/users.service.ts; apps/api/src/modules/telegram-hook/telegram-hook.service.ts; apps/api/src/common/telegram/telegram-notify.service.ts; apps/api/src/modules/mini/mini.service.ts (+ specs).
- Стоп-точки: нет

#### A-F05 [P1] После входа с 2FA у работодателя в токене нет companyId — экраны карьеры сломаны до первого refresh

- Процесс: A-02
- Где: apps/api/src/modules/users/users.service.ts:1250-1265 (`getTwoFactorForLogin` не выбирает `companyMembership`); apps/api/src/modules/auth/auth.service.ts:230 (`toPayload(rec)`) и :522 (`companyId: user.companyMembership?.companyId ?? null`); apps/api/src/modules/auth/strategies/jwt.strategy.ts:34-38 (комментарий: без companyId работодатель получает «аккаунт не привязан к компании» на всех экранах).
- Суть: EMPLOYER включил 2FA (она доступна любой роли). Пароль → challenge → код → access-токен с `companyId: null`. Все запросы работодателя к своей компании до истечения access (до 15 мин) или перезагрузки страницы отвечают «не привязан к компании». Вход без 2FA и refresh используют `findBy*ForAuth`, где `companyMembership` есть, — поэтому на тестах без 2FA ошибка не видна.
- Решение: добавить `companyMembership: { select: { companyId: true } }` в select `getTwoFactorForLogin` и в тип `TwoFactorLoginRecord`; тест «вход с 2FA сохраняет companyId».
- Файлы для правки: apps/api/src/modules/users/users.service.ts; apps/api/src/modules/auth/auth.service.ts (тип); apps/api/test/auth.e2e-spec.ts или two-factor-attempts.spec.ts.
- Стоп-точки: нет

#### A-F06 [P1] Студент сам задаёт «общежитие» и дату рождения, а сотрудник видит их в проверенном студбилете

- Процесс: A-12, A-20, A-23
- Где: packages/shared-schemas/src/users.ts:216 (`dormitory: STUDENT_ROLES` — редактирует владелец), :199 (`birthDate: PERSONAL_ROLES`), :264-275 (`STAFF_MANAGED_STUDENT_FIELDS` — без `dormitory` и `birthDate`); apps/api/src/modules/student-id/student-id.service.ts:40-46 (комментарий: специальность, финансирование и общежитие — «реквизиты, по которым сотрудник на вахте опознаёт студента»), :96-119 (`verify` отдаёт их с `valid: true`); apps/web/src/views/student-id/ui/student-id-card.tsx:82-93 (поля показываются наравне с вузовскими, без пометки).
- Суть: курс, форму оплаты и статус уже вывели из-под самостоятельной правки именно потому, что студент «сам ставил себе грант» в официальном документе. Общежитие и дату рождения — нет: студент через PATCH /users/me пишет `dormitory: "Общежитие №3"`, сканирует свой QR на вахте, охранник видит «Билет действителен» и строку общежития. Дата рождения в карте (проверка возраста) так же самодекларируема; её правка после регистрации к тому же не пересматривает основание согласия (см. F29).
- Решение: добавить `dormitory` (и, по решению владельца продукта, `birthDate`) в `STAFF_MANAGED_STUDENT_FIELDS` и `UpdateAcademicRecordSchema`; либо не показывать в результате проверки поля, которые студент правит сам, либо явно маркировать их «со слов студента».
- Файлы для правки: packages/shared-schemas/src/users.ts; apps/api/src/modules/student-id/student-id.service.ts; apps/web/src/views/student-id/ui/student-id-card.tsx; apps/web (форма профиля — поле станет read-only, AcademicRecordModal — новое поле); тесты users.service.spec / student-id.service.spec.
- Стоп-точки: контракт API/shared-schemas

#### A-F07 [P1] Нет процесса восстановления доступа при потере аутентификатора 2FA

- Процесс: A-03
- Где: apps/api/src/modules/auth/two-factor.service.ts:101-111 (отключить 2FA можно только действующим кодом самого владельца); apps/api/src/modules/users/users.service.ts:1284-1289 (`disableTwoFactor` вызывается только оттуда — других путей сброса в API нет, проверено поиском по `twoFactorSecret: null`/`disableTwoFactor`); apps/api/src/modules/auth/password-reset.service.ts:96-131 (сброс пароля 2FA не трогает — правильно, но и альтернативы нет); apps/api/src/common/guards/two-factor.guard.ts:13-19 (для пяти ролей 2FA обязательна).
- Суть: декан или админ вуза потерял телефон и не сохранил backup-коды (их показывают один раз). Войти он не может, отключить 2FA без кода нельзя, ни у админа вуза, ни у админа платформы нет кнопки «сбросить 2FA». Единственный выход — ручная правка БД разработчиком. При тысячах обязательных 2FA-учёток это регулярный сценарий, а не исключение.
- Решение: эндпоинт `POST /users/:id/2fa/reset` для роли строго выше в своём scope (как `assertModeratable`), с подтверждением кодом 2FA самого администратора, `revokeAllUserSessions` цели, записью в аудит и уведомлением владельцу на почту; кнопка в users-table. Плюс «перевыпустить backup-коды» для владельца (метод `setBackupCodes` уже есть и не используется).
- Файлы для правки: apps/api/src/modules/users/{users.controller.ts,users.service.ts}; apps/api/src/modules/auth/two-factor.service.ts; apps/web/src/widgets/users-table; apps/web/src/widgets/account-settings (перевыпуск кодов); docs/PROJECT.md (новый эндпоинт).
- Стоп-точки: контракт API/shared-schemas (новый эндпоинт), изменение guard-логики — согласовать

#### A-F08 [P1] Таблица refresh_tokens растёт без очистки, а каждый refresh пишет строку в AuditLog

- Процесс: A-05
- Где: apps/api/src/modules/auth/auth.service.ts:396-403 (каждый refresh — новая строка RefreshToken, старая лишь помечается `revokedAt`), :405 (`audit.record({ action: 'refresh' })` на каждый обмен); apps/api/src/modules/cleanup/cleanup.service.ts (задачи для `refreshToken` нет — поиск по модулю находит только `passwordResetToken`, :282-287); prisma/schema/01-users.prisma:240-258 (индекс по `expiresAt` есть, но им никто не пользуется).
- Суть: активная вкладка делает refresh каждые 15 минут плюс на каждой холодной загрузке. Строки RefreshToken не удаляются никогда (ни истёкшие, ни отозванные). При ~20 тыс. активных в день и ~10 обменах на человека — ~200 тыс. строк в день в `refresh_tokens` навсегда и столько же в `audit_logs` (живут 90 дней, ~18 млн строк только «refresh»). Индексы `userId`/`familyId` распухают, `revokeAllUserSessions` и `withinReuseGrace` (count по familyId) дорожают, журнал аудита на 90% состоит из шума.
- Решение: cron `purgeRefreshTokens` в CleanupService (батчами по 500, как `purgePasswordResetTokens`): удалять `expiresAt < now - 1 день` и `revokedAt < now - 1 день` (окно грации и разбор инцидентов укладываются). Аудит `refresh` убрать (оставить login/logout/refresh_reuse_detected) или писать только при смене IP/UA.
- Файлы для правки: apps/api/src/modules/cleanup/cleanup.service.ts (+ spec); apps/api/src/modules/auth/auth.service.ts; docs/BACKEND_RULES.md §9.3 (таблица cron).
- Стоп-точки: нет (удаление только мёртвых токенов; согласовать срок хранения)

#### A-F09 [P1] Два bcrypt cost 12 на каждый refresh — узкое место пула потоков при утреннем пике

- Процесс: A-05
- Где: apps/api/src/common/security/password.service.ts:7 (`BCRYPT_ROUNDS = 12`, комментарий: ~250 мс); apps/api/src/modules/auth/auth.service.ts:346 (`passwords.compare` секрета refresh), :479 (`passwords.hash` нового секрета в `issueSession`), :418 (то же в logout).
- Суть: секрет refresh — `randomUUID()` (122 бита), перебирать нечего; медленный хэш тут не защищает, а только стоит ~0,5 с работы пула libuv на каждый обмен (bcrypt выполняется в пуле из 4 потоков по умолчанию). Это ≈8 refresh/с на инстанс в лучшем случае, причём в тот же пул ходят вход (bcrypt пароля), DNS link-preview, fs и zlib. Утром, когда тысячи людей открывают приложение (каждая вкладка — refresh), ответы refresh растягиваются на секунды, а остальные операции пула встают в очередь. Сам проект для такого же 122-битного токена инвайта осознанно выбрал SHA-256 (apps/api/src/modules/invites/invite-token.ts:11-13).
- Решение: хранить SHA-256 секрета refresh и сравнивать за постоянное время; переходный период — распознавать старые записи по префиксу `$2` и проверять bcrypt, новые писать SHA-256 (через 30 дней ветку удалить). Изменение без миграции схемы (`tokenHash` — строка).
- Файлы для правки: apps/api/src/modules/auth/auth.service.ts; apps/api/src/modules/auth/refresh-secret.spec.ts; docs/BACKEND_RULES.md §6.2 («в БД хранится только bcrypt-хэш» → «хэш»).
- Стоп-точки: нет (но меняется правило BACKEND_RULES §6.2 — согласовать)

#### A-F10 [P2] QR-вход: повторный approve перезаписывает пользователя; QR превращает украденный access в 30-дневную сессию

- Процесс: A-04
- Где: apps/api/src/modules/auth/qr-login.service.ts:89-104 (`approve` не проверяет `status === 'pending'`, в отличие от `preview` :79; read-modify-write без атомарности); apps/api/src/modules/auth/auth.controller.ts:106-136 (approve по обычному access без повторной проверки, claim выдаёт полноценную refresh-цепочку).
- Суть: (1) Пока десктоп не забрал сессию, второй человек, видевший QR, может сделать approve — `userId` перезапишется, и десктоп войдёт под чужим аккаунтом (подмена сессии: жертва пишет личное в аккаунт злоумышленника). Окно короткое (WS-событие мгновенно), поэтому P2. (2) Тот, кто получил чужой access-токен (XSS, 15 минут), сам создаёт QR, подтверждает его этим токеном и забирает независимую 30-дневную refresh-цепочку — компрометация access-токена становится долгой.
- Решение: в `approve` отказывать, если `status !== 'pending'`, и делать переход атомарно (Lua/`WATCH` или `SET ... XX` с проверкой); для approve требовать свежесть сессии (например, access выдан не раньше N минут назад или повторный ввод 2FA для привилегированных ролей).
- Файлы для правки: apps/api/src/modules/auth/qr-login.service.ts (+ spec); apps/api/src/modules/auth/auth.controller.ts.
- Стоп-точки: нет

#### A-F11 [P2] Сгоревший challenge 2FA продолжает проверять коды и списывает backup-код

- Процесс: A-02
- Где: apps/api/src/modules/auth/auth.service.ts:219-229 (`verifyCode` вызывается до проверки, не сожжён ли challenge; сожжённость видна только в `consumeChallengeId` после верного кода); apps/api/src/modules/auth/two-factor.service.ts:166-169 (backup-код списывается внутри `verifyCode`).
- Суть: после трёх промахов человек вводит верный backup-код: код списывается навсегда, а вход отвечает «Этот код входа уже использован — войдите заново». Верный TOTP на сожжённом challenge так же «тратит» шаг. Для атакующего сожжённый challenge — оракул «код верен/неверен» без счётчика (ценность низкая, код одноразовый), но смысл лимита «три попытки на challenge» теряется.
- Решение: в начале `loginVerifyTwoFactor` проверять `EXISTS 2fa:challenge:<jti>` и сразу отвечать UNAUTHORIZED; в `verifyCode` сначала проверять, потом списывать backup после успешного `consumeChallengeId` (или в одной Lua-операции).
- Файлы для правки: apps/api/src/modules/auth/auth.service.ts; apps/api/src/modules/auth/two-factor-attempts.spec.ts.
- Стоп-точки: нет

#### A-F12 [P2] Чувствительные операции учётки без аудита; перебор текущего пароля ограничен только общим лимитом

- Процесс: A-03, A-11, A-14
- Где: apps/api/src/modules/auth/two-factor.service.ts:82-111 (enable/disable — без `audit.record`); apps/api/src/modules/users/users.service.ts:1313-1333 (`changePassword` — без аудита и без счётчика промахов), :1550-1638 (`softDeleteSelf` — без аудита); docs/BACKEND_RULES.md §13 (аудит входа/выхода есть, а эти события равного веса — нет).
- Суть: по журналу нельзя восстановить, кто и когда отключил 2FA, сменил пароль или удалил аккаунт — ровно то, что спрашивают при разборе угона. `PATCH /users/me/password` с украденным access-токеном перебирает текущий пароль со скоростью 100/мин (общий лимит), успешный подбор = смена пароля и захват учётки.
- Решение: аудит `2fa_enabled`, `2fa_disabled`, `password_changed`, `account_deleted` (без ПДн); для `changePassword` счётчик промахов по пользователю (как `verifyWithLimit`, 5/15 мин) с ответом RATE_LIMIT.
- Файлы для правки: apps/api/src/modules/auth/two-factor.service.ts; apps/api/src/modules/users/users.service.ts (+ specs).
- Стоп-точки: нет

#### A-F13 [P2] Удаление аккаунта без повторной аутентификации; можно удалить последнего администратора платформы

- Процесс: A-14
- Где: apps/api/src/modules/users/users.controller.ts:102-107 (`DELETE /users/me` — только JWT, тела нет); apps/api/src/modules/users/users.service.ts:1550-1638.
- Суть: необратимое действие (анонимизация ~60 полей, снос медиа) доступно любому, у кого в руках открытая вкладка или access-токен: ни пароля, ни 2FA не спрашивается, защита — только диалог в UI. Отдельно: единственный `PLATFORM_ADMIN` (создаётся только сидом, выдать инвайтом нельзя) может удалить себя, и платформа останется без администратора.
- Решение: принимать `{ password }` (и код 2FA, если включена) в теле `DELETE /users/me`; запрет удаления последнего активного `PLATFORM_ADMIN` (и, по решению, последнего `UNIVERSITY_ADMIN` вуза).
- Файлы для правки: apps/api/src/modules/users/{users.controller.ts,users.service.ts}; packages/shared-schemas/src/users.ts (новая схема); apps/web/src/widgets/account-settings (DangerSection).
- Стоп-точки: контракт API/shared-schemas

#### A-F14 [P2] Смена аватара удаляет прежний до проверки нового файла; превью может прилипнуть к чужому аватару

- Процесс: A-13
- Где: apps/api/src/modules/users/users.service.ts:760-783 (`deleteExistingAvatars` на :762 до `files.upload` на :763, где проверяется тип и размер), :803-825 (`generateAvatarThumbnail` пишет `avatarThumbUrl` без сверки, что `avatarUrl` всё ещё тот же); для сравнения обложка сделана правильно — :839-842.
- Суть: файл с подменённым расширением, неподдерживаемый формат или сбой MinIO на `putObject` → `FILE_TYPE_NOT_ALLOWED`, но старые объекты уже удалены, а `avatarUrl` в БД указывает на несуществующий файл — у человека «битая» аватарка. Гонка: превью старого аватара, сгенерированное после смены, перезапишет `avatarThumbUrl` нового (в списках будет старое лицо).
- Решение: сначала `upload`, потом `update`, потом удаление прежних (кроме только что загруженного) — как в `setCover`; в `generateAvatarThumbnail` — `updateMany where { id, avatarUrl: <url оригинала> }`.
- Файлы для правки: apps/api/src/modules/users/users.service.ts (+ spec «avatar»).
- Стоп-точки: нет

#### A-F15 [P2] В полной чужой карточке уходит язык интерфейса владельца

- Процесс: A-18
- Где: apps/api/src/modules/users/users.service.ts:134 (`locale` в `PROFILE_SELECT`), :935-974 (`locale` не вынимается из `rest`), :175-190 (тип `PublicProfile` его исключает — TS не ловит лишнее поле при spread).
- Суть: контракт («язык — настройка владельца, наружу только в /users/me») нарушен: `GET /users/:id` при `access: 'full'` возвращает `locale`. Утечка мелкая, но показывает, что белый список полей держится на ручном destructuring.
- Решение: собирать публичную карточку из явного белого списка (отдельный `PUBLIC_PROFILE_SELECT` или `pick`), добавить `locale` в вычитаемые поля; тест «чужой профиль не содержит locale/username/twoFactorEnabled».
- Файлы для правки: apps/api/src/modules/users/users.service.ts (+ spec «приватность профиля»).
- Стоп-точки: нет

#### A-F16 [P2] username, объявленный «половиной учётных данных», раскрывается глобальным поиском

- Процесс: A-01, A-12, A-19
- Где: apps/api/src/modules/search/search.service.ts:36, 42 (поиск людей по `username` и возврат `username` любому в вузе, платформенным — всех); docs/PROJECT.md:643 («username отдаётся только владельцу»); apps/api/src/modules/users/users.service.ts:958-960 (вырезается из карточки), :605 (справочник ищет по username — оракул по подстроке).
- Суть: два решения противоречат друг другу: карточка прячет логин как секрет, а поиск (для @упоминаний) отдаёт его всему вузу. В итоге список логинов вуза — готовый перечень целей для подбора пароля (защищает только счётчик по учётке).
- Решение: определиться с моделью. Либо username публичен (как @handle) — тогда снять «тайну» из документации и карточки и полагаться на счётчик входа; либо оставить секретным — тогда упоминания делать по id, а поиск по username разрешать только точным совпадением без возврата поля.
- Файлы для правки: apps/api/src/modules/search/search.service.ts или docs/PROJECT.md + users.service.ts.
- Стоп-точки: контракт API (если меняется выдача поиска)

#### A-F17 [P2] Декан может выдать инвайт преподавателя на чужой факультет своего вуза

- Процесс: A-07
- Где: apps/api/src/modules/invites/invite-hierarchy.ts:72-77 (`facultyId: input.facultyId ?? issuer.facultyId` — для TEACHER приоритет у тела запроса); apps/api/src/modules/invites/invites.service.ts:232-240 (`assertScopeExists` проверяет только «факультет в этом вузе»).
- Суть: для STUDENT/STAROSTA факультет берётся из токена декана, для TEACHER — из тела. Прямым POST /invites декан A заводит преподавателя с `facultyId` факультета B. Комментарий к `assertScopeExists` прямо называет такие выходы за scope уязвимостью.
- Решение: для `issuer.role === DEAN` фиксировать `facultyId = issuer.facultyId` (или требовать равенства), UNIVERSITY_ADMIN — свободный выбор в своём вузе; тест в invite-hierarchy.spec.
- Файлы для правки: apps/api/src/modules/invites/invite-hierarchy.ts (+ spec).
- Стоп-точки: нет

#### A-F18 [P2] Ссылка в письме-приглашении строится из всей строки CORS_ORIGIN; переходный фолбэк токена не удалён

- Процесс: A-07, A-10
- Где: apps/api/src/modules/invites/invites.service.ts:178-179 (`CORS_ORIGIN.replace(...)` без `split(',')`, тогда как всё остальное — `webBaseUrl()`/`pickWebBase`, apps/api/src/config/web-base.ts:9-19); apps/api/src/modules/invites/invite-token.ts:19-32 (фолбэк поиска по открытому токену «убрать через месяц», в комментарии срок 30 дней при фактических 48 ч — packages/shared-config/src/constants.ts:15).
- Суть: стоит добавить второй origin в CORS_ORIGIN (переезд на поддомен — docs/LANDING.md:50-52), и все письма-приглашения уйдут со ссылкой `https://a,https://b/register?...`. Фолбэк по открытому токену — мёртвый код безопасности, расширяющий поиск.
- Решение: `webBaseUrl(this.config)`; фолбэк удалить, если сиды больше не пишут открытые токены (проверить prisma/seed).
- Файлы для правки: apps/api/src/modules/invites/{invites.service.ts,invite-token.ts} (+ specs).
- Стоп-точки: нет

#### A-F19 [P2] Инвайты: админ вуза не видит чужие инвайты, отзыв без условной записи, истечение без аудита

- Процесс: A-09
- Где: apps/api/src/modules/invites/invites.service.ts:587-590 (`list` — только `createdById = issuer.sub`), :555-583 (`revoke`: проверка статуса и `update` раздельно), apps/api/src/modules/cleanup/cleanup.service.ts:248-267 (`expireInvitesTask` — без аудита и без повторной проверки статуса в `updateMany`); docs/BACKEND_RULES.md §7 («каждое … истечение инвайта → AuditLog»).
- Суть: (1) UNIVERSITY_ADMIN вправе отозвать инвайт декана своего вуза, но в UI его не найти. (2) Регистрация между проверкой и `update` → инвайт USED перезаписывается в REVOKED при живом пользователе. (3) Нарушено правило §7 об аудите истечения.
- Решение: в `list` для UNIVERSITY_ADMIN — фильтр «мои | все в вузе»; `revoke` через `updateMany where { id, status: PENDING }` с проверкой `count`; в cron — `where: { id: { in }, status: PENDING }` и одна сводная запись аудита на батч.
- Файлы для правки: apps/api/src/modules/invites/invites.service.ts; apps/api/src/modules/cleanup/cleanup.service.ts; packages/shared-schemas/src/invites.ts (фильтр списка).
- Стоп-точки: контракт API/shared-schemas (новый фильтр списка)

#### A-F20 [P2] Массовый импорт: XLSX разбирается целиком без потолка, по строке на запрос, без защиты от двойной отправки

- Процесс: A-08
- Где: apps/api/src/modules/invites/bulk-parse.ts:106-112 (`XLSX.read` и `sheet_to_json` по всему листу; лимит 500 строк проверяется уже после разбора, invites.service.ts:260); apps/api/src/modules/invites/invites.service.ts:370-422 (на строку — `assertScopeExists` + `invite.create` последовательно), :437-439 (письма — по одному `await`).
- Суть: файл до 10 МБ (сжатый XLSX) с огромным диапазоном листа синхронно разворачивается в памяти и держит event loop — загрузить такой может и староста. 500 строк = ~1000 последовательных запросов. Две вкладки с одним файлом создают дубли (обе видят адреса свободными).
- Решение: `XLSX.read(buffer, { type: 'buffer', sheetRows: BULK_INVITE_MAX_ROWS + 2, dense: true })`; группы/факультеты уже загружены в `loadScoped*` — проверять связность по ним без запросов; `createMany` в транзакции; идемпотентность по `(createdById, lower(email), PENDING)`.
- Файлы для правки: apps/api/src/modules/invites/{bulk-parse.ts,invites.service.ts} (+ bulk-invite.spec).
- Стоп-точки: нет

#### A-F21 [P2] Староста, пришедший по инвайту, не становится старостой группы — в группе два старосты

- Процесс: A-10
- Где: apps/api/src/modules/auth/auth.service.ts:131-156 (создание пользователя с `role: invite.role`, `Group.starostaId` не трогается); apps/api/src/modules/users/users.service.ts:1426-1465 (`syncGroupStarosta` сам описывает «пришедших по инвайту и к группе не привязанных» старост).
- Суть: декан выдаёт инвайт STAROSTA в группу, где староста уже есть. После регистрации — два пользователя с ролью STAROSTA, `Group.starostaId` указывает на старого; права старосты (инвайты, групповые заявки) есть у обоих, пока декан руками не переназначит.
- Решение: в транзакции регистрации для `invite.role === STAROSTA` вызывать `syncGroupStarosta(tx, groupId, created.sub)` + после коммита `afterStarostaChange`; либо запретить выдачу инвайта STAROSTA в группу с действующим старостой.
- Файлы для правки: apps/api/src/modules/auth/auth.service.ts; apps/api/src/modules/invites/invites.service.ts (+ specs).
- Стоп-точки: нет

#### A-F22 [P2] Email при регистрации по ссылочному инвайту не подтверждается

- Процесс: A-10, A-12
- Где: apps/api/src/modules/auth/auth.service.ts:133 (`invite.email ?? input.email`, адрес не проверяется письмом); смены email в системе нет вовсе (A-12).
- Суть: по инвайту без адреса человек вписывает любой email — в том числе чужой (тогда настоящий владелец адреса уже не сможет зарегистрироваться: P2002 «email уже существует») или с опечаткой (сброс пароля уйдёт в никуда, исправить адрес нельзя).
- Решение: письмо подтверждения для адресов, введённых вручную (флаг `emailVerifiedAt`), и процесс смены email с подтверждением нового адреса.
- Файлы для правки: apps/api/src/modules/auth/auth.service.ts; apps/api/src/modules/users; prisma/schema/01-users.prisma; web — регистрация и настройки.
- Стоп-точки: миграция, контракт API/shared-schemas

#### A-F23 [P2] Telegram, когда-то привязанный к другому админу, привязать нельзя — 409 навсегда

- Процесс: A-24
- Где: apps/api/src/modules/mini/mini.service.ts:125-141 (проверка пропускает отозванную чужую привязку, затем `upsert where { userId }` создаёт строку с тем же `telegramId`); prisma/schema/29-telegram.prisma:23 (`telegramId @unique`); apps/api/src/common/filters/http-exception.filter.ts:127-131 (P2002 → CONFLICT).
- Суть: админ A отозвал привязку, админ B пытается привязать тот же Telegram — уникальный индекс даёт 409 «Запись с такими данными уже существует», одноразовый код при этом уже сожжён. Обойти без правки БД нельзя, хотя модель обещает «перепривязку после явного отзыва».
- Решение: при `existing.revokedAt` и чужом `userId` — в транзакции удалить/переписать отозванную строку на нового владельца (история отзыва остаётся в AuditLog).
- Файлы для правки: apps/api/src/modules/mini/mini.service.ts (+ spec).
- Стоп-точки: нет

#### A-F24 [P2] Веб: блокировка одним кликом и без срока; завершения сессий в вебе нет

- Процесс: A-15, A-16
- Где: apps/web/src/widgets/users-table/ui/users-table.tsx:294-300 (кнопка сразу вызывает `blockMut.mutate`, диалога нет); apps/web/src/entities/user/api/user-api.ts:208-210 (`blockUserRequest` не передаёт `blockDays`); `PATCH /users/:id/logout` вызывается только из apps/mini-app/src/api/people.ts.
- Суть: блокировка мгновенно гасит все сессии человека, а в вебе её делает промах по иконке — ровно то, от чего в мини-аппе защищает код 2FA. Временная блокировка и «завершить сессии» (для угнанного аккаунта) есть в API, но в вебе недоступны; самому пользователю «выйти на всех устройствах» можно только сменой пароля.
- Решение: AlertDialog с выбором срока (бессрочно / N дней) и `blockDays` в запросе; пункт «Завершить сессии» в меню строки; в настройках безопасности — «Выйти на всех устройствах» (`PATCH /users/{me}/logout` уже разрешает свои сессии).
- Файлы для правки: apps/web/src/widgets/users-table/ui/users-table.tsx; apps/web/src/entities/user/api/user-api.ts; apps/web/src/widgets/account-settings; apps/web/messages/*.json.
- Стоп-точки: нет

#### A-F25 [P2] Проверка студбилета не пишется в аудит; QR действует как многоразовый пропуск в пределах TTL

- Процесс: A-23
- Где: apps/api/src/modules/student-id/student-id.service.ts:96-119 (нет `audit.record`; токен не помечается использованным), :16 (TTL 120 с).
- Суть: сотрудник вуза получает дату рождения, форму оплаты и общежитие студента — это доступ к ПДн без следа в журнале (в отличие от `PROFILE_VIEW_PRIVATE`). Скриншот QR пересылается и проходит проверку ещё до двух минут.
- Решение: аудит `student_id_verified` (verifier, target, без ПДн); при желании — одноразовость токена через Redis `SET NX` по nonce.
- Файлы для правки: apps/api/src/modules/student-id/student-id.service.ts (+ spec).
- Стоп-точки: нет

#### A-F26 [P2] Мёртвый код: /me/activity без потребителя, StudentToday не подключён; MeService читает чужие таблицы

- Процесс: A-21, A-22
- Где: apps/web/src/entities/activity/api/activity-api.ts:10 и apps/web/src/entities/activity/index.ts:1 (экспорт без импортёров); apps/web/src/widgets/today/ui/student-today.tsx:33 (не используется); apps/api/src/modules/me/me.service.ts:114-157 (прямые `prisma.applicationEvent/documentEvent/auditLog` из модуля me — BACKEND_RULES §2.1); apps/api/src/modules/me/me.controller.ts:22-27 (limit без Zod-схемы).
- Суть: эндпоинт поддерживается и тестируется, но не используется; при подключении он отдаст студенту `actorId` сотрудников и `comment` событий ASSIGNED, где лежит id назначенного (apps/api/src/modules/application-services/application-process.service.ts:125).
- Решение: либо удалить `/me/activity`, `entities/activity`, `StudentToday`, либо довести экран и перевести сбор на сервисы-владельцы с DTO без чужих id.
- Файлы для правки: apps/api/src/modules/me/_; apps/web/src/entities/activity/_; apps/web/src/widgets/today/*.
- Стоп-точки: контракт API (если эндпоинт удаляется)

#### A-F27 [P2] Список и выгрузка пользователей: синхронная сборка файла и поиск ILIKE без индекса

- Процесс: A-17
- Где: apps/api/src/modules/users/users.service.ts:450-533 (до 5000 строк, SheetJS собирает книгу синхронно в event loop; отдельного лимита на выгрузку нет — только общий 100/мин), :350-358 (`contains, mode: 'insensitive'` по email/имени — без trigram-индекса seq scan по `users`).
- Суть: несколько параллельных выгрузок блокируют процесс на время сборки; поиск в таблице админа платформы на 130 тыс. пользователей — полный проход на каждый ввод.
- Решение: `@Throttle` на export (например 5/мин с пользователя); pg_trgm-индексы на `lower(email)`, `lower(last_name)`, `lower(first_name)` или поиск по префиксу.
- Файлы для правки: apps/api/src/modules/users/users.controller.ts; prisma/schema/01-users.prisma + миграция.
- Стоп-точки: миграция (индексы)

#### A-F28 [P2] Режим техработ не останавливает запись через WebSocket (не подтверждено как требование)

- Процесс: A-27
- Где: apps/api/src/common/guards/maintenance.guard.ts:33 (`context.getType() !== 'http'` → пропуск); apps/api/src/modules/chats/chats.gateway.ts:91-110 (message:send пишет в БД).
- Суть: guard описан как «то, что делает рычаг настоящим», но сообщения в чатах во время техработ продолжают записываться. Если техработы включают ради миграции/восстановления данных — это запись в момент, когда её не ждут. В PROJECT.md (§Состояние платформы) про WS ничего не сказано, поэтому намерение не подтверждено.
- Решение: в `ChatGateway` перед записью проверять `PLATFORM_STATE.maintenanceActive()` для неплатформенных ролей и отвечать `error { code: 'MAINTENANCE' }`; зафиксировать решение в PROJECT.md.
- Файлы для правки: apps/api/src/modules/chats/chats.gateway.ts; docs/PROJECT.md.
- Стоп-точки: нет

#### A-F29 [P2] Нет повторного согласия при смене редакции документов; правка даты рождения не пересматривает основание согласия

- Процесс: A-28, A-12
- Где: apps/api/src/modules/auth/auth.service.ts:150-152 (consent пишется только при регистрации); `consentVersion` нигде не сверяется с `LEGAL_VERSION` (packages/shared-schemas/src/auth.ts:39); packages/shared-schemas/src/users.ts:68, 199 (`birthDate` правится в профиле).
- Суть: после смены `LEGAL_VERSION` все прежние пользователи формально живут на старой редакции без механизма принять новую. Человек, зарегистрированный как совершеннолетний, может позже поставить дату рождения несовершеннолетнего (и наоборот) — `consentByGuardian` не пересматривается.
- Решение: сравнение `consentVersion !== LEGAL_VERSION` в `/auth/me` → флаг `consentRequired` и экран принятия; `POST /users/me/consent`; при правке `birthDate` пересчитывать требование согласия представителя (или сделать поле неизменяемым после регистрации, см. F06).
- Файлы для правки: apps/api/src/modules/users, apps/api/src/modules/auth; apps/web (гейт согласия); packages/shared-schemas.
- Стоп-точки: контракт API/shared-schemas

#### A-F30 [P2] Параллельный refresh из нескольких вкладок может закончиться ложным «Сессия скомпрометирована» (не подтверждено)

- Процесс: A-05
- Где: apps/web/src/shared/api/instance.ts:38-54 (дедупликация только внутри вкладки); apps/api/src/modules/auth/auth.service.ts:342-403 (окно грации 10 с выдаёт новую ротацию и гасит предыдущего преемника).
- Суть: браузер восстанавливает 5 вкладок — 5 обменов одной cookie. Сервер в окне грации каждый раз гасит предыдущего преемника; живым остаётся токен последней закоммиченной транзакции, а в cookie оказывается ответ, пришедший последним. Если порядок ответов не совпал с порядком коммитов, в cookie лежит отозванный токен, и следующий refresh через 15 минут (вне окна) рвёт всю цепочку с записью `refresh_reuse_detected`. Воспроизведения нет — вывод по коду.
- Решение: межвкладочная блокировка обмена (`navigator.locks.request('sh-refresh', …)` или BroadcastChannel с раздачей токена); на сервере в окне грации возвращать уже выданного преемника вместо новой ротации (хранить зашифрованный секрет последнего преемника 10 с в Redis).
- Файлы для правки: apps/web/src/shared/api/instance.ts; apps/api/src/modules/auth/auth.service.ts.
- Стоп-точки: нет

#### A-F31 [P2] Документация расходится с кодом: состав JWT

- Процесс: A-01, A-27
- Где: docs/BACKEND_RULES.md §6.2 (payload `{ sub, role, universityId, facultyId, groupId }`); apps/api/src/common/auth/jwt-payload.type.ts:5-26 (ещё `companyId`, `tfa`, `client`).
- Суть: при добавлении полей в токен легко повторить ошибку Ф18 (поле не добавили в белый список JwtStrategy) — документ не напоминает, что полей больше.
- Решение: обновить §6.2 и PROJECT.md §7.1 со ссылкой на белый список в jwt.strategy.ts.
- Файлы для правки: docs/BACKEND_RULES.md, docs/PROJECT.md.
- Стоп-точки: нет (правка docs — по просьбе человека)

#### A-F32 [P2] Пробелы в тестах

- Процесс: A-04, A-06, A-13, A-16, A-19, A-24, A-27, A-03 (web)
- Где: нет e2e QR-входа (create → approve → claim, повторный approve); нет e2e сброса пароля (в т.ч. email с заглавными буквами — F01); `directory` в users.service.spec.ts не покрыт; `avatar-thumbnail.processor.ts` и `generateAvatarThumbnail` без тестов; `revokeSessions` без отдельного теста; `mini.service.link` (конфликт, перепривязка — F23) не покрыт; realtime.gateway без теста на `client:'mini'` (F03); web: нет тестов setup-2fa-gate, TwoFactorManager, qr-login-panel, reset-password-form.
- Суть: именно в этих местах найдены F01, F03, F10, F14, F23 — тесты бы их поймали.
- Решение: добавить перечисленные спеки вместе с исправлениями соответствующих находок.
- Файлы для правки: apps/api/src/modules/{auth,users,mini}/_.spec.ts; apps/api/src/common/realtime/_.spec.ts; apps/api/test/auth.e2e-spec.ts; apps/web/src/features/{setup-2fa,login,password-reset}.
- Стоп-точки: нет
