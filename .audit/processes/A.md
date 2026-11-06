## Группа A — Учётки и доступ

### A-01 Вход по логину и паролю

- Бизнес-цель: пустить пользователя в платформу по email/username и паролю, не раскрывая, какие учётки существуют, и защитив от подбора.
- Роли: все 8 ролей (+ EMPLOYER); гость до входа.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /login (features/login/ui/login-form.tsx) → POST /auth/login (@Public, LocalAuthGuard, throttle 5/15 мин с IP).
- Завершение: access в JSON → Redux (память), refresh `<id>.<secret>` в httpOnly cookie на auth-пути + нечувствительная sh_role-cookie; редирект на ?next= или ROLE_HOME[role] (middleware.ts). При 2FA — challenge вместо сессии (см. A-02).
- Шаги и файлы: apps/api/src/modules/auth/auth.controller.ts (login, setAuthCookies); strategies/local.strategy.ts → auth.service.ts validateUser (холостой bcrypt для несуществующего, isBlocked → 403); login-attempts.service.ts (счётчик по хэшу идентификатора: 10 неудач/15 мин → блок 5→15→60 мин, LOGIN_LOCKED); issueSession (RefreshToken, familyId); apps/web/src/shared/session/session.ts establishSession; apps/web/src/middleware.ts (PUBLIC_PATHS, sh_role).
- Данные на входе / выходе: { identifier, password } → { accessToken } | { twoFactorRequired, challengeToken }; запись RefreshToken (bcrypt-хэш секрета), AuditLog action=login.
- Внешние зависимости: PostgreSQL, Redis (login-attempts; при сбое пропускается), throttler storage.
- Тесты: apps/api/test/auth.e2e-spec.ts (POST /auth/login); apps/api/src/modules/auth/login-attempts.service.spec.ts; apps/api/src/common/guards/user-throttler.guard.spec.ts; apps/web/e2e/login.e2e.ts; apps/web/e2e/access.e2e.ts.
- Замечено: §7.1 PROJECT.md описывает payload `{sub, role, universityId, facultyId, groupId}`, а фактически в токене ещё companyId, tfa, client — doc устарел.

### A-02 Второй шаг входа по 2FA (TOTP / backup-код)

- Бизнес-цель: для учёток с включённой 2FA выдавать сессию только после кода из аутентификатора или одноразового backup-кода.
- Роли: любой пользователь с twoFactorEnabled (обязательно для PLATFORM_ADMIN/MODERATOR, UNIVERSITY_ADMIN/MODERATOR, DEAN).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /login (шаг кода в login-form.tsx) → POST /auth/login/2fa (@Public, throttle 5/15 мин).
- Завершение: challenge погашен (Redis SET NX `2fa:challenge:<jti>`), выдана сессия + cookie, audit login.
- Шаги и файлы: auth.service.ts signTwoFactorChallenge (JWT typ=TWO_FACTOR, 5 мин, jti) → loginVerifyTwoFactor → two-factor.service.ts verifyCode (TOTP ±1 шаг, одноразовый шаг `2fa:used-step`, backup — bcrypt + users.consumeBackupCode) → countFailedTwoFactorAttempt (3 промаха сжигают challenge); strategies/jwt.strategy.ts отвергает токены с typ.
- Данные на входе / выходе: { challengeToken, code } → { accessToken }; INVALID_2FA_CODE / UNAUTHORIZED.
- Внешние зависимости: Redis (одноразовость и счётчик; при сбое — пропуск с warn), CryptoService (шифрование TOTP-секрета, TOTP_ENCRYPTION_KEY).
- Тесты: apps/api/test/auth.e2e-spec.ts (2FA TOTP); apps/api/src/modules/auth/two-factor-attempts.spec.ts; two-factor.service.spec.ts; strategies/jwt.strategy.spec.ts.
- Замечено: users.service.ts getTwoFactorForLogin не выбирает companyMembership → после входа через 2FA у EMPLOYER в access-токене companyId=null до первого refresh.

### A-03 Настройка, включение и отключение 2FA (+ принудительная 2FA для привилегированных ролей)

- Бизнес-цель: дать пользователю включить TOTP-2FA и заставить привилегированные роли включить её до работы в системе.
- Роли: все вошедшие (по желанию); обязательно PLATFORM_ADMIN, PLATFORM_MODERATOR, UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR, DEAN.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /settings → вкладка «Безопасность» (TwoFactorManager); /setup-2fa (features/setup-2fa/ui/setup-2fa-gate.tsx) по 403 TWO_FACTOR_SETUP_REQUIRED (shared/api/instance.ts); POST /auth/2fa/setup, /auth/2fa/enable, /auth/2fa/disable (@TwoFactorExempt, @MaintenanceExempt).
- Завершение: twoFactorEnabled=true + 10 backup-кодов (показ один раз); блок снимается после следующего refresh (tfa в JWT) — гейт делает жёсткий переход на «/».
- Шаги и файлы: apps/api/src/modules/auth/two-factor.controller.ts; two-factor.service.ts (pending-секрет переиспользуется, шифрование CryptoService, verifyWithLimit 5 промахов/15 мин); users.service.ts (setPendingTwoFactorSecret/enableTwoFactor/disableTwoFactor); apps/api/src/common/guards/two-factor.guard.ts (TWO_FACTOR_ENFORCE); apps/web/src/widgets/account-settings/ui/account-settings-panels.tsx (TwoFactorManager).
- Данные на входе / выходе: setup → { secret, otpauthUrl, qr }; enable { code } → { backupCodes[] }; disable { code } → null.
- Внешние зависимости: Redis (счётчик промахов), otplib, генерация QR (common/qr).
- Тесты: apps/api/src/modules/auth/two-factor.service.spec.ts; apps/api/src/common/guards/two-factor.guard.spec.ts; apps/api/test/auth.e2e-spec.ts (disable); web — нет.
- Замечено: включение/отключение 2FA и генерация backup-кодов не пишутся в аудит (two-factor.service.ts, users.service.ts enable/disableTwoFactor).

### A-04 Вход по QR-коду (десктоп ↔ телефон)

- Бизнес-цель: войти на компьютере, отсканировав QR телефоном, где сессия уже есть, с показом, какое устройство просит вход (защита от QRLjacking).
- Роли: гость на десктопе; любой вошедший пользователь на телефоне.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /login → features/login/ui/qr-login-panel.tsx → POST /auth/qr/create (@Public); WS namespace /qr-login (qr:subscribe); телефон: /qr?t=<approveToken> (app/qr/page.tsx) → POST /auth/qr/preview, POST /auth/qr/approve (JWT); десктоп: POST /auth/qr/claim (@Public).
- Завершение: событие qr:approved → claim с claimSecret → сессия + cookie на десктопе; ключ Redis удалён (одноразово), audit qr_approve + login.
- Шаги и файлы: apps/api/src/modules/auth/qr-login.service.ts (Redis `qrlogin:*`, TTL 120 с, describeRequester/maskIp); qr-login.gateway.ts; auth.controller.ts qrCreate/qrPreview/qrApprove/qrClaim → auth.service.ts issueSessionForUser (проверка isBlocked).
- Данные на входе / выходе: create → { qrId, qr, claimSecret, expiresIn }; preview { approveToken } → { requester{browser,os,ip}, createdAt }; claim { qrId, claimSecret } → { accessToken }.
- Внешние зависимости: Redis, Socket.IO (namespace /qr-login без токена).
- Тесты: apps/api/src/modules/auth/qr-login.service.spec.ts; e2e api/web — нет.
- Замечено: approve не проверяет status==='pending' (в отличие от preview) — повторный approve другим пользователем до claim перезапишет userId; ссылка в QR строится от CORS_ORIGIN, а не от webBaseUrl, как в письмах.

### A-05 Обновление сессии (ротация refresh) и выход

- Бизнес-цель: держать короткоживущий access (15 мин) и длинную сессию (30 дней) с ротацией refresh и детектом кражи; корректно завершать сессию.
- Роли: все вошедшие.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): холодная загрузка/401 TOKEN_EXPIRED → apps/web/src/shared/api/instance.ts refreshAccessToken (дедупликация) → POST /auth/refresh (@Public, cookie); выход: endSession (shared/session/session.ts) → POST /auth/logout.
- Завершение: refresh — старый токен revoked, новый в той же familyId, обе cookie обновлены; при отказе гасятся refresh- и sh_role-cookie; logout — гасится вся цепочка, cookie очищены, Redux/кэш очищены → /login.
- Шаги и файлы: apps/api/src/modules/auth/auth.controller.ts refresh/logout/clearAuthCookies; auth.service.ts refresh (окно грации REFRESH_REUSE_GRACE_MS до bcrypt, реюз вне окна → revokeFamily + audit refresh_reuse_detected; isBlocked → revokeFamily), logout (только с верным секретом); apps/web/src/shared/api/auth-retry.ts; shared/session/session-initializer.tsx.
- Данные на входе / выходе: cookie sh_refresh → { accessToken }; RefreshToken (revokedAt), AuditLog refresh/logout.
- Внешние зависимости: PostgreSQL; на клиенте Socket.IO отключается при выходе.
- Тесты: apps/api/test/auth.e2e-spec.ts (refresh: ротация, грация, разрыв); apps/api/src/modules/auth/refresh-secret.spec.ts; auth.controller.spec.ts; apps/web/src/shared/api/auth-retry.test.ts.
- Замечено: истёкшие/отозванные RefreshToken никто не удаляет (ни auth, ни modules/cleanup/cleanup.service.ts) — таблица refresh_tokens растёт с каждой ротацией.

### A-06 Восстановление пароля по ссылке из письма

- Бизнес-цель: дать забывшему пароль задать новый, не раскрывая, зарегистрирован ли адрес.
- Роли: гость (любой пользователь без сессии).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /forgot-password → POST /auth/password/forgot (202, throttle 3/15 мин, обработка fire-and-forget); письмо → /reset-password?token=… → POST /auth/password/reset (204, throttle 5/15 мин).
- Завершение: пароль сменён, все сессии отозваны (refresh + метка отзыва access + разрыв WS), блок подбора снят по email и username; сессия НЕ выдаётся — вход заново.
- Шаги и файлы: apps/api/src/modules/auth/password-reset.service.ts (requestReset: заблокированным не шлём, старые токены гасятся, SHA-256 в PasswordResetToken, TTL 1 ч; reset: условный updateMany); users.service.ts findForPasswordReset/setPasswordAfterReset; apps/web/src/features/password-reset/ui/{forgot-password-form,reset-password-form}.tsx.
- Данные на входе / выходе: { email } → 202 null; { token, password } → 204; AuditLog password_reset_requested / password_reset.
- Внешние зависимости: BullMQ очередь EMAIL (job SEND_PASSWORD_RESET, jobId по хэшу), SMTP, Redis (login-attempts.unlock).
- Тесты: apps/api/src/modules/auth/password-reset.service.spec.ts; e2e api/web — нет.

### A-07 Выдача инвайта (одиночная) и письмо-приглашение

- Бизнес-цель: завести нового участника только по приглашению, с ролью строго ниже своей и в своей области (scope).
- Роли: PLATFORM_ADMIN, UNIVERSITY_ADMIN, DEAN, STAROSTA (кому кого — ALLOWED_ISSUERS); системно — одобрение заявки вуза (onboarding/demo-requests.service.ts, notify:false).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /platform-admin/invites, /university-admin/invites, /dean/invites, /starosta/invites (features/create-invite/ui/create-invite.tsx, create-invite-modal.tsx) → POST /invites; список своих — GET /invites (offset-пагинация).
- Завершение: Invite PENDING, срок 48 ч (TTL.INVITE_HOURS), в БД sha256 токена; сырой токен возвращается создателю один раз; при наличии email — письмо со ссылкой /register?token=…; audit invite_created.
- Шаги и файлы: apps/api/src/modules/invites/invites.controller.ts; invites.service.ts create → invite-hierarchy.ts resolveInviteTarget (роль ниже, scope из JWT) → assertScopeExists (группа∈факультет∈вуз) → invite-token.ts hashInviteToken → enqueueInviteEmail (best-effort, язык приглашающего); apps/web/src/entities/invite/api/invite-api.ts.
- Данные на входе / выходе: { role, email?, groupId?, facultyId?, universityId? } → { id, token, role, scope, expiresAt, status }.
- Внешние зависимости: BullMQ очередь EMAIL (SEND_INVITE, jobId по хэшу), SMTP; Redis.
- Тесты: apps/api/src/modules/invites/invites.service.spec.ts; invite-hierarchy.spec.ts; invite-token.spec.ts; web — нет.
- Замечено: invite-token.ts — переходный фолбэк поиска по открытому токену всё ещё в коде, а коммент обещал убрать «через месяц» и называет срок 30 дней при фактических 48 ч.

### A-08 Массовый импорт инвайтов из CSV/XLSX

- Бизнес-цель: пригласить много студентов/преподавателей/деканов одним файлом с предпросмотром ошибок до записи.
- Роли: PLATFORM_ADMIN, UNIVERSITY_ADMIN, DEAN, STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): те же страницы инвайтов → features/create-invite/ui/bulk-invite.tsx → POST /invites/bulk/preview (multipart) → POST /invites/bulk.
- Завершение: созданы инвайты по READY-строкам, дубли пропущены, письма поставлены в очередь; ответ { created, skipped, failed }; audit одной записью со счётчиками.
- Шаги и файлы: invites.controller.ts (разбор файла) → bulk-parse.ts (CSV/XLSX, колонки email/role/group/faculty) → invites.service.ts bulkPreview (loadScopedGroups/Faculties, loadTakenEmails, лимит 500 строк) → bulkCreate (повторная проверка scope через resolveInviteTarget, построчный create) → enqueueInviteEmail.
- Данные на входе / выходе: файл → { rows[{line,email,role,groupId,facultyId,status READY|DUPLICATE|ERROR,error}], summary }; rows[{email,groupId?,facultyId?,role?}] → { created, skipped, failed }.
- Внешние зависимости: xlsx (тарбол с cdn.sheetjs.com), BullMQ EMAIL, SMTP.
- Тесты: apps/api/src/modules/invites/bulk-invite.spec.ts; web — нет.

### A-09 Отзыв и истечение инвайта

- Бизнес-цель: аннулировать выданное приглашение вручную или по сроку, чтобы по старой ссылке нельзя было зарегистрироваться.
- Роли: создатель инвайта, PLATFORM_ADMIN, UNIVERSITY_ADMIN (в своём вузе); система (cron).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): таблица инвайтов (create-invite.tsx) → PATCH /invites/:id/revoke; cron `expireInvites` ('0 * * * *') в apps/api/src/modules/cleanup/cleanup.service.ts.
- Завершение: статус REVOKED (только из PENDING, иначе CONFLICT) + audit invite_revoked; cron — PENDING с истёкшим expiresAt → EXPIRED батчами.
- Шаги и файлы: invites.service.ts revoke / assertUsable; cleanup.service.ts expireInvitesTask.
- Данные на входе / выходе: id → { id, status: REVOKED }.
- Внешние зависимости: @nestjs/schedule (cron).
- Тесты: apps/api/src/modules/invites/invites.service.spec.ts (revoke); cron expireInvites — проверить спеки cleanup (группа F).
- Замечено: GET /invites отдаёт только инвайты, созданные самим пользователем, — UNIVERSITY_ADMIN может отозвать инвайт декана своего вуза, но в списке его не видит.

### A-10 Регистрация по инвайту (превью ссылки → создание учётки → авто-вход)

- Бизнес-цель: единственный путь создать пользователя: роль и scope строго из инвайта, согласие на обработку ПДн (за несовершеннолетнего — законного представителя).
- Роли: гость с действующей ссылкой-приглашением.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /register?token=… (features/auth-invite/ui/register-form.tsx) → GET /invites/:token/preview (@Public, 10/час) → POST /auth/register-by-invite (@Public, 3/час с IP); после — опционально загрузка аватара (uploadAvatarRequest).
- Завершение: в одной транзакции инвайт PENDING→USED (условный updateMany) + User создан (consentAt/consentVersion=LEGAL_VERSION/consentByGuardian) + invite.usedById; audit register_by_invite + login; сессия и редирект на ROLE_HOME[role].
- Шаги и файлы: invites.service.ts preview (emailRequired, email не раскрывается) / claimInvite / markUsed; apps/api/src/modules/auth/auth.service.ts registerByInvite (isAdult из shared-schemas, повторная проверка guardianConsent); users.service.ts createInvitedUser (P2002 → конфликт email/username); apps/web/src/app/(auth)/register/page.tsx; /legal/terms, /legal/privacy (views/legal).
- Данные на входе / выходе: { token, username, firstName, lastName, password, email?, birthDate, consent, guardianConsent? } → { accessToken } + cookie; коды INVITE_USED/INVITE_REVOKED/INVITE_EXPIRED/NOT_FOUND.
- Внешние зависимости: PostgreSQL; MinIO (аватар после регистрации).
- Тесты: apps/api/test/auth.e2e-spec.ts (register-by-invite: успех, несовершеннолетний, инвайт без email, повтор → 410); apps/web/e2e/register.e2e.ts; invites.service.spec.ts (preview).

### A-11 Смена пароля вошедшим пользователем

- Бизнес-цель: сменить пароль, зная текущий, и выкинуть все прочие устройства.
- Роли: все вошедшие.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /settings → «Безопасность» (widgets/account-settings/ui/account-settings-panels.tsx SecuritySection) → PATCH /users/me/password.
- Завершение: новый bcrypt-хэш, все сессии отозваны (refresh + метка отзыва access + разрыв WS); клиент делает endSession → /login?reason=password-changed.
- Шаги и файлы: apps/api/src/modules/users/users.controller.ts changePassword → users.service.ts changePassword (неверный текущий → 400, не 401) → auth.service.ts revokeAllUserSessions → common/redis/session-revocation.service.ts.
- Данные на входе / выходе: { currentPassword, newPassword } (ChangePasswordSchema) → null.
- Внешние зависимости: Redis (метка отзыва), Socket.IO (disconnectUser).
- Тесты: apps/api/test/users-notifications.e2e-spec.ts (старый refresh не работает); apps/api/src/modules/users/users.service.spec.ts (changePassword); web — нет.
- Замечено: смена пароля не пишется в аудит (в отличие от change_username и password_reset); перебор текущего пароля ограничен только общим лимитом 100/мин.

### A-12 Редактирование профиля, имени пользователя, языка и приватности

- Бизнес-цель: человек сам ведёт свои личные данные, логин (username), язык писем/интерфейса и видимость профиля; учебные поля ВУЗа ему недоступны.
- Роли: все вошедшие (набор полей по роли — PROFILE_FIELD_ROLES).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /settings (вкладки «Личные данные», «Внешний вид», «Приватность»), /profile (widgets/user-profile) → PATCH /users/me, PATCH /users/me/username; GET /users/me, GET /auth/me.
- Завершение: поля User обновлены; username нормализован в нижний регистр, занято → 409 USERNAME_TAKEN; audit change_username.
- Шаги и файлы: users.controller.ts updateMe/updateUsername → users.service.ts updateProfile (disallowedProfileFields → profileFieldSelfEditable, STAFF_MANAGED_STUDENT_FIELDS запрещены) / updateUsername (P2002); packages/shared-schemas/src/users.ts (UpdateProfileSchema, UpdateUsernameSchema); apps/web/src/widgets/account-settings/ui/account-settings-panels.tsx (PersonalSection, PrivacySection, AppearanceSection).
- Данные на входе / выходе: частичный UpdateProfileInput → UserProfile.
- Внешние зависимости: нет (PostgreSQL).
- Тесты: apps/api/src/modules/users/users.service.spec.ts (updateProfile по ролям, updateUsername); locale-contract.spec.ts; apps/web/src/widgets/account-settings/ui/personal-section.test.tsx.
- Замечено: процесса смены email нет вовсе (ни эндпоинта, ни подтверждения нового адреса) — email задаётся только инвайтом; изменения профиля, кроме username, не аудируются.

### A-13 Аватар и обложка профиля

- Бизнес-цель: загрузить/удалить фото профиля и обложку, с превью для списков и без сирот в хранилище.
- Роли: все вошедшие; также сразу после регистрации (register-form.tsx).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /settings, /profile, /register → POST /users/me/avatar, DELETE /users/me/avatar, POST /users/me/cover, DELETE /users/me/cover (multipart ≤10 МБ); очередь FILE_PROCESSING job GENERATE_THUMBNAIL.
- Завершение: файл в публичном бакете avatars, avatarUrl в User; прежние объекты удалены; превью (~128px) проставляется воркером в avatarThumbUrl.
- Шаги и файлы: users.controller.ts (readSingleUpload) → users.service.ts setAvatar/removeAvatar/setCover/removeCover/deleteExistingAvatars → FileService.upload; apps/api/src/modules/users/avatar-thumbnail.processor.ts → generateAvatarThumbnail; apps/web/src/entities/user/api/user-api.ts.
- Данные на входе / выходе: multipart file → UserProfile (avatarUrl, avatarThumbUrl=null до воркера).
- Внешние зависимости: MinIO (MINIO_BUCKET_AVATARS), BullMQ FILE_PROCESSING, обработка изображений.
- Тесты: apps/api/src/modules/users/users.service.spec.ts (avatar); процессор и web — нет.

### A-14 Удаление собственного аккаунта (soft delete + анонимизация)

- Бизнес-цель: право человека удалить аккаунт: ПДн затираются, учебные записи остаются привязанными к анонимной учётке.
- Роли: все вошедшие.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /settings → «Опасная зона» (DangerSection, AlertDialog) → DELETE /users/me.
- Завершение: deletedAt, email=deleted+<id>@studenthub.invalid, username=null, groupId=null, ~60 полей профиля обнулены, 2FA сброшена, староста понижен и снят с группы, медиа удалены из MinIO, все сессии отозваны.
- Шаги и файлы: users.controller.ts deleteMe → users.service.ts softDeleteSelf / deleteUserMedia → auth.service.ts revokeAllUserSessions.
- Данные на входе / выходе: — → null.
- Внешние зависимости: MinIO (best-effort снос аватара/обложки), Redis, Socket.IO.
- Тесты: apps/api/test/users-notifications.e2e-spec.ts (анонимизация); apps/api/src/modules/users/users.service.spec.ts (softDeleteSelf); web — нет.
- Замечено: ни пароля, ни 2FA для удаления не спрашивается (только диалог в UI) и аудит не пишется; привязка TelegramAccount (telegramId) не отзывается и не затирается.

### A-15 Блокировка и разблокировка пользователя (в т.ч. временная)

- Бизнес-цель: модерация доступа: отключить нарушителя от платформы немедленно (бессрочно или на N дней) и вернуть доступ.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR, UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR — только над ролью строго ниже и (для вузовских) в своём вузе; система (cron).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): users-table (/platform-admin/users, /moderator/_/users, /university-admin/_, /dean/_) и мини-апп (apps/mini-app/src/api/people.ts) → PATCH /users/:id/block { blockDays? } (@MiniAllowed, @RequiresConfirmation — из мини-аппа нужен код 2FA), PATCH /users/:id/unblock; cron liftExpiredBlocks ('_/5 * * * *').
- Завершение: isBlocked/blockedUntil; при блокировке — revokeAllUserSessions; audit user_blocked/user_unblocked/user_unblocked_expired. Вход, refresh, сброс пароля и проверка студбилета для заблокированного закрыты.
- Шаги и файлы: users.controller.ts block/unblock → users.service.ts setBlocked → assertModeratable (isHigherRole); apps/api/src/common/guards/action-confirm.guard.ts; apps/api/src/modules/cleanup/cleanup.service.ts (liftExpiredBlocks); apps/web/src/widgets/users-table/ui/users-table.tsx.
- Данные на входе / выходе: id, { blockDays?, code? } → null.
- Внешние зависимости: Redis (метка отзыва), Socket.IO, @nestjs/schedule.
- Тесты: apps/api/src/modules/users/users.service.spec.ts (setBlocked, ранг, временная блокировка); apps/api/src/common/guards/action-confirm.guard.spec.ts; e2e — нет.
- Замечено: веб-клиент (user-api.ts blockUserRequest) не передаёт blockDays — временная блокировка доступна только из мини-аппа.

### A-16 Принудительное завершение всех сессий пользователя

- Бизнес-цель: выгнать злоумышленника из угнанного аккаунта, не наказывая владельца блокировкой.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR, UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR (над ролью ниже, в своём scope); свои сессии — без проверки ранга.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): мини-апп (apps/mini-app/src/api/people.ts) → PATCH /users/:id/logout (@MiniAllowed).
- Завершение: все RefreshToken отозваны, метка отзыва access, WS разорваны; audit user_sessions_revoked.
- Шаги и файлы: users.controller.ts logout → users.service.ts revokeSessions → auth.service.ts revokeAllUserSessions.
- Данные на входе / выходе: id → null.
- Внешние зависимости: Redis, Socket.IO.
- Тесты: нет отдельных (revokeAllUserSessions косвенно — users.service.spec.ts).
- Замечено: в вебе кнопки нет — функция есть только в мини-аппе; пользователь не может сам «выйти на всех устройствах», кроме смены пароля.

### A-17 Список пользователей в scope и выгрузка в XLSX/CSV

- Бизнес-цель: администраторы и деканы видят людей своей области с фильтрами и могут выгрузить список в файл.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR, UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR, DEAN (список — также в мини-аппе).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /platform-admin/users, /moderator/platform/users, /moderator/university/users, /university-admin/{students,deans,teachers}, /dean/{students,starostas,teachers} (widgets/users-table) → GET /users (offset-пагинация, role/faculty/group/search/sort), GET /users/export?format=xlsx|csv&locale=.
- Завершение: страница списка; файл с брендингом вуза (ExportBrandingService), предел EXPORT_MAX_ROWS (иначе ошибка «сузьте фильтр»); audit users_export.
- Шаги и файлы: apps/api/src/modules/users/users.controller.ts list/export → users.service.ts list/listWhere/listScope/exportList (постраничная выборка EXPORT_PAGE_SIZE); apps/web/src/widgets/users-table/ui/users-table.tsx; apps/web/src/entities/user/api/user-api.ts.
- Данные на входе / выходе: UserListQuery → Paginated<AdminUser>; файл (content-disposition).
- Внешние зависимости: xlsx (генерация файла).
- Тесты: apps/api/src/modules/users/users.service.spec.ts (list — scope, сортировка; выгрузка); e2e — нет.

### A-18 Просмотр профиля другого пользователя по правам видимости

- Бизнес-цель: показать карточку человека в объёме, который смотрящему положен (видимость профиля, дружба, надзорная роль), не раскрывая лишних ПДн.
- Роли: все вошедшие; надзорные роли видят PRIVATE-профили с записью в аудит; модераторы — отдельная карточка.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /profile/[id] (widgets/user-profile, подробнее — группа E) → GET /users/:id (@MiniAllowed); GET /users/:id/moderation (модераторы, мини-апп); GET /users/:id/presence.
- Завершение: полный или ограниченный (toLimitedProfile) профиль; email/телефон — по canSeeEmail/приватности; audit PROFILE_VIEW_PRIVATE при доступе к закрытому профилю силой роли.
- Шаги и файлы: users.service.ts getProfileForViewer → resolveAccessWithFriendship/resolveAccess/hasAuthorityOver/isInVisibilityAudience; moderationCard; getPresenceFor (свой вуз или друг).
- Данные на входе / выходе: id → PublicProfile | { online }.
- Внешние зависимости: Socket.IO-реестр присутствия (RealtimeGateway).
- Тесты: apps/api/src/modules/users/users.service.spec.ts (приватность, закрытый профиль, moderationCard, присутствие); apps/api/test/users-notifications.e2e-spec.ts (приватность); apps/api/test/cross-tenant.e2e-spec.ts (GET /users/:id чужого вуза).

### A-19 Справочник людей своего вуза

- Бизнес-цель: найти человека для чата, группы или упоминания — визитки без email и служебных полей.
- Роли: все вошедшие.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): entities/user/ui/user-picker.tsx, widgets/chat-window (create-group-panel, blocked-users-panel) → GET /users/directory (секции друзья/группа/вуз, курсор hasMore).
- Завершение: список визиток с учётом блокировок и дружбы.
- Шаги и файлы: users.controller.ts directory → users.service.ts directory/directoryScope (FRIENDS_SCAN_LIMIT, BLOCKS_SCAN_LIMIT).
- Данные на входе / выходе: UserDirectoryQuery → { items: DirectoryUser[], hasMore }.
- Внешние зависимости: нет.
- Тесты: нет отдельных describe для directory в users.service.spec.ts; e2e — нет.

### A-20 Ведение учебных данных студента деканатом

- Бизнес-цель: курс, форма обучения, финансирование, номер билета, статус, GPA ведёт вуз, а не студент — от них зависят справки и цифровой студенческий.
- Роли: DEAN (свой факультет), UNIVERSITY_ADMIN (свой вуз).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): widgets/users-table → features/edit-academic-record (AcademicRecordModal) → PATCH /users/:id/academic.
- Завершение: поля STAFF_MANAGED_STUDENT_FIELDS обновлены у STUDENT/STAROSTA; audit с ip/userAgent.
- Шаги и файлы: users.controller.ts updateAcademic → users.service.ts updateAcademicRecord (только студенческие роли, scope факультет/вуз); packages/shared-schemas/src/users.ts UpdateAcademicRecordSchema, STAFF_MANAGED_STUDENT_FIELDS.
- Данные на входе / выходе: { course?, enrollmentYear?, graduationYear?, educationLevel?, studyForm?, fundingType?, specialty?, studentCardNumber?, academicStatus?, gpa? } → профиль.
- Внешние зависимости: нет.
- Тесты: apps/api/src/modules/users/users.service.spec.ts («учебные данные ведёт вуз»); web — нет.

### A-21 Экран «Сегодня» (BFF-агрегат дня по роли)

- Бизнес-цель: одним запросом собрать для человека день: расписание и его изменения, заявки, ближайшие события, задания, уведомления.
- Роли: все вошедшие (заявки — только STUDENT/STAROSTA); фактически в вебе используется только преподавателем.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /teacher (apps/web/src/widgets/today/ui/teacher-today.tsx) → GET /me/today.
- Завершение: ответ MeTodayResponse; сбой одного источника заменяется дефолтом с warn (safe()).
- Шаги и файлы: apps/api/src/modules/me/me.controller.ts → me.service.ts today → SchedulesService.getSchedule/listChanges, ApplicationsService.list, EventsService.list, AssignmentsService.list, NotificationsService.list; apps/web/src/entities/me/api/me-api.ts.
- Данные на входе / выходе: JWT → { role, schedule, changes, applications, events, assignments, notifications }.
- Внешние зависимости: нет (только доменные сервисы).
- Тесты: apps/api/src/modules/me/me.service.spec.ts (today); web — нет.
- Замечено: widgets/today StudentToday экспортируется, но нигде не подключён — студенческий «Сегодня» на этом BFF не используется.

### A-22 Лента моей активности (заявки, документы, аудит)

- Бизнес-цель: показать пользователю единую историю его действий и событий по его заявкам и документам.
- Роли: все вошедшие (только свои события).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): GET /me/activity?limit=1..100; клиент — apps/web/src/entities/activity/api/activity-api.ts fetchMyActivity.
- Завершение: слитый и отсортированный по времени список Activity с общим лимитом.
- Шаги и файлы: me.service.ts activity (applicationEvent + documentEvent + auditLog с take=limit, merge/sort).
- Данные на входе / выходе: limit → Activity[] { id, source, ... }.
- Внешние зависимости: нет.
- Тесты: apps/api/src/modules/me/me.service.spec.ts (activity).
- Замечено: fetchMyActivity/activityKeys нигде в вебе не используются — эндпоинт без потребителя (мёртвый код или недоделанный экран).

### A-23 Цифровой студенческий билет и его проверка по QR

- Бизнес-цель: студент предъявляет динамический QR (зашифрованный токен с TTL 2 мин), сотрудник вуза сканирует и видит действительность билета и данные в объёме своей роли.
- Роли: STUDENT, STAROSTA (показ); TEACHER, DEAN, STAROSTA, UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR, PLATFORM_ADMIN, PLATFORM_MODERATOR (проверка).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /student-id (views/student-id/ui/student-id-view.tsx, student-id-card.tsx, ротация QR ~45 с) → GET /student-id/me; /verify-id?t=… (views/student-id/ui/verify-id-view.tsx; сканер features/verify-scan/ui/qr-scanner.tsx) → GET /student-id/verify?token=….
- Завершение: { valid: true, verifiedAt, карта }; староста/преподаватель — без birthDate, fundingType, dormitory; заблокированный/удалённый → NOT_FOUND; чужой вуз → WRONG_SCOPE.
- Шаги и файлы: apps/api/src/modules/student-id/student-id.controller.ts; student-id.service.ts myCard (AES-256-GCM CryptoService, typ='student-id', exp) / verify / verifyIdToken.
- Данные на входе / выходе: — → { карта, token, qr, expiresAt, ttlSeconds }; token → карта + valid/verifiedAt.
- Внешние зависимости: CryptoService (ключ шифрования), генерация QR (common/qr).
- Тесты: apps/api/src/modules/student-id/student-id.service.spec.ts; web/e2e — нет.
- Замечено: проверка студбилета не пишется в аудит (кто и когда сканировал чужой билет с ПДн); токен не одноразовый — скриншот QR действует до 2 мин.

### A-24 Привязка Telegram к аккаунту администратора платформы (и её отзыв)

- Бизнес-цель: один раз связать Telegram-аккаунт с админом платформы там, где он уже доказал личность (веб: пароль + 2FA), чтобы потом пускать его в мини-апп и бота.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR (список всех привязок — только PLATFORM_ADMIN).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /settings → «Безопасность» (features/link-telegram/ui/telegram-link-row.tsx) → POST /mini/link-code (10/час); мини-апп (apps/mini-app/src/api/client.ts) → POST /mini/link { initData, code } (@Public, 10/мин); GET /mini/link (статус), DELETE /mini/link (отзыв), GET /mini/links (@MiniAllowed; apps/mini-app/src/api/platform.ts).
- Завершение: TelegramAccount (userId↔telegramId, оба уникальны) создан/обновлён, revokedAt=null; код погашен (Redis MULTI get+del); подтверждение в Telegram; выдан мини-токен; audit telegram.link_code_issued / telegram.linked / mini.link.revoke.
- Шаги и файлы: apps/api/src/modules/mini/mini.controller.ts; mini.service.ts issueLinkCode (8 симв., TTL 5 мин) / link (verifyInitData, CONFLICT при чужой активной привязке) / linkStatus / revoke / listLinks; mini/init-data.ts; prisma/schema/29-telegram.prisma.
- Данные на входе / выходе: — → { code, expiresIn }; { initData, code } → { token, expiresIn, user }; статус → { linked, username, linkedAt, lastSeenAt }.
- Внешние зависимости: Redis (коды), Telegram Bot API (TELEGRAM_BOT_TOKEN, notifyOne).
- Тесты: apps/api/src/modules/mini/mini.service.spec.ts (отзыв); apps/api/src/modules/mini/init-data.spec.ts; web — нет.
- Замечено: при удалении аккаунта (A-14) и при понижении роли привязка не отзывается автоматически.

### A-25 Вход в админский мини-апп Telegram (сессия по initData) и ограничения мини-токена

- Бизнес-цель: при каждом открытии мини-аппа выдать короткий (15 мин) токен по подписи Telegram, только для привязанного, незаблокированного админа платформы, и пускать его лишь на белый список маршрутов.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR с активной привязкой.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): apps/mini-app (client.ts) → POST /mini/session { initData } (@Public, 30/мин); далее запросы с Bearer (client='mini').
- Завершение: JWT { sub, role, client:'mini', tfa из БД, scope=null } на 15 мин; lastSeenAt обновлён; MiniAppGuard пускает только на @MiniAllowed, ActionConfirmGuard требует код 2FA на @RequiresConfirmation (блокировка и т.п.).
- Шаги и файлы: apps/api/src/modules/mini/mini.service.ts session/issueSession (роль перечитывается из БД); mini/init-data.ts (HMAC WebAppData, constant-time, auth_date ±5 мин); apps/api/src/common/guards/mini-app.guard.ts, action-confirm.guard.ts, two-factor.guard.ts.
- Данные на входе / выходе: initData → { token, expiresIn, user{id, firstName, role} }; отказы — одинаковый UNAUTHORIZED.
- Внешние зависимости: Telegram (подпись initData, TELEGRAM_BOT_TOKEN).
- Тесты: apps/api/src/modules/mini/mini.service.spec.ts (tfa в токене); init-data.spec.ts; apps/api/src/common/guards/mini-app.guard.spec.ts; action-confirm.guard.spec.ts; apps/mini-app/src/screens/*.test.tsx (экраны, не вход).
- Замечено: mini.service.ts session() не проверяет user.deletedAt — удалённому админу с живой привязкой токен выдаётся (дальше спасает только TwoFactorGuard, т.к. удаление сбрасывает 2FA).

### A-26 Telegram-бот: квитирование «Беру в работу» и служебные команды (вебхук)

- Бизнес-цель: снять дубли работы команды (кнопка «Беру в работу» под уведомлением о жалобе/обращении) и отвечать в личке числами о состоянии платформы без открытия приложения.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR с активной привязкой Telegram; источник — Telegram.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): вебхук POST /telegram/webhook (@Public, @MaintenanceExempt, 120/мин, заголовок x-telegram-bot-api-secret-token, всегда 200); callback_data take:ticket:<id> | take:complaint:<id>; команды /queue /digest /duty /status /me /help (только private-чат); onModuleInit — setMyCommands/описание бота.
- Завершение: обращение назначено (SupportService.assign) или жалоба взята (ComplaintsService.take), всплывающий ответ + снятие кнопки; на команду — текстовый ответ без содержимого/имён третьих лиц.
- Шаги и файлы: apps/api/src/modules/telegram-hook/telegram-hook.controller.ts; telegram-hook.service.ts secretMatches / handleCallback / resolve / handleMessage / runCommand / actorFor (привязка по telegramId, не заблокирован, роль из БД); исходящие кнопки — apps/api/src/common/telegram/telegram-notify.service.ts.
- Данные на входе / выходе: Telegram Update { callback_query | message } → { ok: true }; вызовы Bot API answerCallbackQuery / editMessageReplyMarkup / sendMessage (таймаут 5 с).
- Внешние зависимости: Telegram Bot API (TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET), PostgreSQL; health-проверки для /status.
- Тесты: apps/api/src/modules/telegram-hook/telegram-hook.service.spec.ts; e2e — нет.
- Замечено: actorFor не проверяет user.deletedAt и не требует 2FA — удалённый платформенный сотрудник с неотозванной привязкой продолжает брать жалобы/обращения кнопкой и читать /queue.

### A-27 Проверка доступа к API и ролевая маршрутизация в вебе

- Бизнес-цель: каждый запрос проходит цепочку барьеров (токен → техработы → мини-апп → роль → подтверждение → scope → 2FA), а веб сразу ведёт человека в его зону и не пускает в чужие.
- Роли: все; гость — только @Public-маршруты и PUBLIC_PATHS веба.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): любой HTTP-запрос к /api/v1 (APP_GUARD в apps/api/src/modules/auth/auth.module.ts + UserThrottlerGuard в app.module.ts); любой переход в вебе (apps/web/src/middleware.ts по sh_role-cookie; shared/session/role-guard.tsx на клиенте).
- Завершение: запрос пропущен или отказ 401 UNAUTHORIZED/TOKEN_EXPIRED, 403 FORBIDDEN/WRONG_SCOPE/TWO_FACTOR_SETUP_REQUIRED, 429 RATE_LIMIT, 503 MAINTENANCE; в вебе — редирект гостя на /login?next=…, вошедшего с /login|/register — на ROLE_HOME, из чужой зоны — 403-экран.
- Шаги и файлы: apps/api/src/common/guards/{jwt-auth,maintenance,mini-app,roles,action-confirm,scope,two-factor,user-throttler}.guard.ts; modules/auth/strategies/jwt.strategy.ts (отказ typ-токенам, метка отзыва common/redis/session-revocation.service.ts); decorators @Public/@Roles/@Scope/@MiniAllowed/@TwoFactorExempt/@MaintenanceExempt/@RequiresConfirmation; apps/web/src/shared/config/routes.ts (ROLE_HOME, LEGAL_BASE).
- Данные на входе / выходе: Authorization: Bearer <access> → request.user (белый список полей JwtPayload).
- Внешние зависимости: Redis (метка отзыва, хранилище throttler с фолбэком в память).
- Тесты: apps/api/src/common/guards/{jwt-auth,maintenance,mini-app,roles,scope,two-factor,user-throttler,action-confirm}.guard.spec.ts; modules/auth/strategies/jwt.strategy.spec.ts; apps/api/test/cross-tenant.e2e-spec.ts; apps/web/e2e/access.e2e.ts.
- Замечено: sh_role-cookie не httpOnly и используется только для UX-редиректа — защита целиком на API (так задумано, §16.2).

### A-28 Публичные правовые документы и версия согласия

- Бизнес-цель: показать пользовательское соглашение и политику конфиденциальности до регистрации и зафиксировать, какую редакцию человек принял.
- Роли: гость и все вошедшие.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /legal/terms, /legal/privacy (apps/web/src/views/legal/ui/legal-document-view.tsx; публичные в middleware через LEGAL_BASE); ссылки из формы регистрации и входа.
- Завершение: при регистрации в User пишутся consentAt, consentVersion=LEGAL_VERSION ('2026-09-30', packages/shared-schemas/src/auth.ts), consentByGuardian.
- Шаги и файлы: apps/web/src/app/legal/{terms,privacy}/page.tsx; apps/api/src/modules/auth/auth.service.ts registerByInvite; выгрузка согласия — data-export.service.ts (группа D).
- Данные на входе / выходе: статичный текст (i18n) → —; consent/guardianConsent в теле регистрации.
- Внешние зависимости: нет.
- Тесты: косвенно apps/api/test/auth.e2e-spec.ts (согласие представителя); отдельных — нет.
- Замечено: механизма повторного согласия при смене LEGAL_VERSION нет — consentVersion пишется только при регистрации и нигде не сверяется.

> Смежные маршруты из зоны A, но процессы других групп: /verify/[code] — проверка выданного документа по коду (группа D, views/verify-document); /r и /r/[code] — вход в аудиторию по коду (группа B, views/rooms); /r/resume/[slug] — публичное резюме (группа D, career); саморегистрация работодателя POST /career/companies/signup и /employer/signup|verify — единственное задокументированное исключение из «только по инвайтам» (группа D, career); cron expireInvites/liftExpiredBlocks живут в modules/cleanup (группа F). Экран /onboarding (views/onboarding) — настройка вуза, к входу не относится (группа B).
