# Реестр бизнес-процессов StudentHub

Собирается из разделов по группам (`.audit/processes/<группа>.md`). Шаблон записи:

```
### <ID> Название
- Бизнес-цель:
- Роли:
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук):
- Завершение:
- Шаги и файлы:
- Данные на входе / выходе:
- Внешние зависимости:
- Тесты: unit (spec) / e2e api / web unit / web e2e / нет
```

## Оглавление

| Группа                                    | Процессов | Файл                    |
| ----------------------------------------- | --------- | ----------------------- |
| A — Учётки и доступ                       | 28        | `.audit/processes/A.md` |
| B — Структура вуза и платформа            | 22        | `.audit/processes/B.md` |
| C — Учебный процесс                       | 20        | `.audit/processes/C.md` |
| D — Услуги, документы, карьера, модерация | 26        | `.audit/processes/D.md` |
| E — Соцчасть и контент                    | 23        | `.audit/processes/E.md` |
| F — Коммуникации и инфраструктура         | 29        | `.audit/processes/F.md` |
| **Всего**                                 | **148**   |                         |

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

## Группа B — Структура вуза и платформа

### B-01 Заявка вуза на подключение (демо) и одобрение платформой

- Бизнес-цель: дать вузу без аккаунта попросить подключение, не нарушая правило «доступ только по инвайту»; одобрение создаёт вуз и инвайт UNIVERSITY_ADMIN.
- Роли: аноним (заявитель), PLATFORM_ADMIN (модерация).
- Вход: UI `/demo` (лендинг → кнопка «Заявка»), `/demo/verify?token=`, `/platform-admin/demo-requests`; cron `purgeUnconfirmedDemoRequests` (04:30).
- Завершение: заявка APPROVED (вуз PENDING + UniversityOnboarding + инвайт, письмо со ссылкой `/register?token=`) или REJECTED (письмо с отказом); неподтверждённые PENDING_EMAIL удаляются cron-ом.
- Шаги и файлы: `POST /demo-requests` (@Public, 5/15мин) → письмо подтверждения (TTL 24ч) → `POST /demo-requests/verify` (@Public) → статус NEW → `GET /demo-requests`, `GET /demo-requests/:id` → `POST /demo-requests/:id/approve|reject`. API: apps/api/src/modules/onboarding/demo-requests.{controller,service}.ts, apps/api/src/modules/cleanup/cleanup.service.ts (cron), apps/api/src/modules/email/email.processor.ts. Web: apps/web/src/views/demo/ui/{demo-request-view,demo-verify-view}.tsx, apps/web/src/views/platform-admin/ui/{demo-requests-view,demo-request-modal}.tsx, apps/web/src/entities/onboarding/api/onboarding-api.ts; лендинг apps/landing/src/ui/{hero,cta}.tsx.
- Данные на входе / выходе: название вуза, город (свободный текст), сайт, оценка числа студентов, контакт, email, телефон, согласие (consentAt/consentVersion, IP, UA) / `UniversityDemoRequest` (PENDING_EMAIL→NEW→APPROVED|REJECTED), `University`, `Invite`, `AuditLog` (`demo_request_*`).
- Внешние зависимости: BullMQ (очередь EMAIL: SEND_DEMO_VERIFICATION/APPROVED/REJECTED), SMTP, Redis (throttler), модуль invites.
- Тесты: apps/api/src/modules/onboarding/demo-requests.service.spec.ts; web/e2e — нет.
- Замечено: approve не атомарен — вуз создаётся транзакцией, а инвайт и смена статуса после неё; сбой инвайта или две параллельные кнопки «Одобрить» (проверка `status !== 'NEW'` до транзакции) дают вуз-дубликат.

### B-02 Создание вуза и управление им со стороны платформы

- Бизнес-цель: завести вуз (тенант) на платформе, вести реестр вузов, менять статус, удалять пустые.
- Роли: PLATFORM_ADMIN (создание/правка/статус/удаление), PLATFORM_MODERATOR (просмотр), UNIVERSITY_ADMIN/MODERATOR (свой профиль и статистика).
- Вход: UI `/platform-admin/universities`; эндпоинты `/universities*`.
- Завершение: вуз создан в статусе PENDING (дальше — инвайт UNIVERSITY_ADMIN через модуль invites и мастер B-03); статус ACTIVE/BLOCKED; удаление возможно только без факультетов/аудиторий/пользователей (FK → 409).
- Шаги и файлы: `POST /universities`, `GET /universities` (page/limit/search/status/sort), `GET /universities/:id`, `GET /universities/:id/stats` (Redis-кэш 5 мин), `PATCH /universities/:id`, `PATCH /universities/:id/status`, `DELETE /universities/:id`. API: apps/api/src/modules/universities/universities.{controller,service}.ts, dto/*. Web: apps/web/src/views/platform-admin/ui/{universities-admin-view,create-university-modal}.tsx, apps/web/src/entities/university/api/university-api.ts, apps/web/src/entities/kato/ui/kato-select.tsx.
- Данные на входе / выходе: name, shortName, country, city (код КАТО или текст), timezone / `University`, счётчики {faculties, groups, rooms, students, teachers}, `AuditLog` (`university_*`).
- Внешние зависимости: Redis (кэш статистики), справочник КАТО (B-08).
- Тесты: apps/api/src/modules/universities/universities.service.spec.ts; web/e2e — нет.
- Замечено: статус вуза BLOCKED нигде не применяется (ни в логине, ни в guard'ах — grep по `university.status` находит только онбординг); в вебе нет UI для `PATCH /universities/:id` и `DELETE`.

### B-03 Мастер настройки вуза (онбординг) и запуск

- Бизнес-цель: провести нового админа вуза по шагам заполнения структуры и перевести вуз из PENDING в ACTIVE.
- Роли: UNIVERSITY_ADMIN.
- Вход: UI `/university-admin/setup`, баннер на `/university-admin`; эндпоинты `/onboarding*`.
- Завершение: `POST /onboarding/launch` переводит вуз в ACTIVE (только если все обязательные шаги выполнены и не пропущены); либо баннер скрыт (`dismiss`).
- Шаги и файлы: `GET /onboarding` (шаги profile/faculties/specialties/groups/rooms/terms/subjects/deans/launch, done считается по count-ам, `canLaunch`) → `POST /onboarding/confirm-profile` → `POST /onboarding/skip` (только specialties/rooms/subjects) → `POST /onboarding/dismiss` → `POST /onboarding/launch`. API: apps/api/src/modules/onboarding/onboarding.{controller,service}.ts, packages/shared-schemas/src/onboarding.ts. Web: apps/web/src/views/onboarding/ui/{setup-view,setup-banner,step-body,quick-add}.tsx, apps/web/src/entities/onboarding/api/onboarding-api.ts.
- Данные на входе / выходе: шаг для пропуска / `UniversityOnboarding` (profileConfirmedAt, skippedSteps, dismissedAt), `University.status`, `AuditLog` (`onboarding_*`).
- Внешние зависимости: Redis (сброс кэша статистики вуза при запуске).
- Тесты: apps/api/src/modules/onboarding/onboarding.service.spec.ts; web/e2e — нет.
- Замечено: шаг «О вузе» показывает `university.city` как есть — для вуза, созданного через KatoSelect, это 9-значный код КАТО, а не название (apps/web/src/views/onboarding/ui/step-body.tsx:85); у вуза из демо-заявки город — свободный текст.

### B-04 Факультеты вуза: создание, переименование, удаление

- Бизнес-цель: завести верхний уровень академической структуры вуза, к которому привязываются группы, деканы и заявки.
- Роли: UNIVERSITY_ADMIN (свой вуз), PLATFORM_ADMIN (любой); чтение — все по scope.
- Вход: UI `/university-admin/faculties`, быстрый ввод в мастере `/university-admin/setup`; эндпоинты `/faculties*`.
- Завершение: факультет создан/переименован; удаление — только пустого (FK Restrict → 409 CONFLICT).
- Шаги и файлы: `POST /faculties` (scope по `universityId` в теле), `GET /faculties`, `GET /faculties/:id`, `PATCH /faculties/:id`, `DELETE /faculties/:id`. API: apps/api/src/modules/faculties/faculties.{controller,service}.ts. Web: apps/web/src/views/university-admin/ui/{faculties-view,create-faculty-modal,rename-button}.tsx, apps/web/src/views/onboarding/ui/quick-add.tsx, apps/web/src/entities/faculty/api/faculty-api.ts.
- Данные на входе / выходе: name, universityId / `Faculty`, `AuditLog` (`faculty_*`), сброс кэша статистики вуза.
- Внешние зависимости: Redis (инвалидация `universities/:id/stats`).
- Тесты: apps/api/src/modules/faculties/faculties.service.spec.ts, apps/api/test/cross-tenant.e2e-spec.ts (чтение/правка/удаление чужого факультета, списки); web/e2e — нет.
- Замечено: нет уникальности названия факультета в пределах вуза (у `Faculty` нет `@@unique([universityId, name])`, в отличие от `Specialty`).

### B-05 Справочник специальностей вуза

- Бизнес-цель: вести список специальностей вуза для выбора в профиле студента и в мастере.
- Роли: UNIVERSITY_ADMIN (CRUD в своём вузе; вуз из JWT); чтение — пользователи вуза.
- Вход: UI `/university-admin/specialties`, шаг мастера «Специальности» (пропускаемый); эндпоинты `/specialties*`.
- Завершение: специальность создана/переименована/удалена; дубль названия → 409.
- Шаги и файлы: `GET /specialties`, `POST /specialties`, `PATCH /specialties/:id`, `DELETE /specialties/:id`. API: apps/api/src/modules/specialties/specialties.{controller,service}.ts. Web: apps/web/src/views/university-admin/ui/{specialties-view,create-specialty-modal}.tsx, apps/web/src/entities/specialty/api/specialty-api.ts.
- Данные на входе / выходе: name / `Specialty` (`@@unique([universityId, name])`), `AuditLog` (`specialty_*`).
- Внешние зависимости: нет.
- Тесты: apps/api/src/modules/specialties/specialties.service.spec.ts (3 кейса); web/e2e — нет.
- Замечено: `User.specialty` — свободная строка без FK, поэтому переименование/удаление специальности в справочнике не доходит до профилей студентов.

### B-06 Учебные группы, состав и назначение старосты

- Бизнес-цель: завести группы факультета, показывать состав и назначать старосту (смена роли STUDENT↔STAROSTA).
- Роли: UNIVERSITY_ADMIN/PLATFORM_ADMIN (CRUD), DEAN (староста своего факультета, просмотр), STAROSTA/STUDENT (своя группа).
- Вход: UI `/university-admin/groups`, `/dean/groups`, `/starosta/group`, `/starosta/classmates`, мастер `/university-admin/setup`; эндпоинты `/groups*`.
- Завершение: группа создана/изменена/удалена; староста назначен или снят (роль сменена в транзакции, разжалованному гасятся сессии).
- Шаги и файлы: `POST /groups`, `GET /groups` (scope смотрящего), `GET /groups/:id`, `GET /groups/:id/members` (take 500), `PATCH /groups/:id`, `PATCH /groups/:id/starosta`, `DELETE /groups/:id`. API: apps/api/src/modules/groups/groups.{controller,service}.ts, apps/api/src/modules/users/users.service.ts (`syncGroupStarosta`, `afterStarostaChange`). Web: apps/web/src/views/university-admin/ui/{groups-view,create-group-modal,edit-group-modal}.tsx, apps/web/src/widgets/{groups-list,group-members}, apps/web/src/features/assign-starosta/ui/assign-starosta.tsx, apps/web/src/views/people/ui/own-group-view.tsx, apps/web/src/entities/group/api/group-api.ts.
- Данные на входе / выходе: name, year, facultyId, starostaId|null / `Group`, `User.role`, `AuditLog` (`group_*`, `user_role_changed`).
- Внешние зависимости: Redis (кэш статистики вуза, сессии).
- Тесты: apps/api/src/modules/groups/groups.service.spec.ts, apps/api/src/modules/users/users.service.spec.ts (syncGroupStarosta), apps/api/test/cross-tenant.e2e-spec.ts; web/e2e — нет.
- Замечено: веб грузит только первую страницу (`fetchGroups` с `limit: 100`, без пагинации) — у вуза с >100 группами экран `/university-admin/groups` молча обрезается; удаление группы без студентов каскадно сносит её курсы, экзамены и материалы (onDelete: Cascade).

### B-07 Помещения вуза: справочник аудиторий и выпуск QR-наклеек

- Бизнес-цель: вести реестр помещений (учебных и служебных) для расписания и печатать над дверью QR с коротким кодом; уметь обесценить утёкшую распечатку.
- Роли: UNIVERSITY_ADMIN (свой вуз), PLATFORM_ADMIN; чтение — пользователи вуза по scope.
- Вход: UI `/university-admin/rooms`, шаг мастера «Аудитории» (пропускаемый); эндпоинты `/rooms*`.
- Завершение: помещение создано/изменено/удалено (удаление запрещено, если на него есть пары → 409); выданы коды и готов лист печати, либо код перевыпущен (старая наклейка даёт 404).
- Шаги и файлы: `POST /rooms`, `GET /rooms`, `GET /rooms/:id`, `PATCH /rooms/:id`, `DELETE /rooms/:id`, `POST /rooms/qr/batch` (идемпотентно), `POST /rooms/:id/qr/rotate`. API: apps/api/src/modules/rooms/{rooms.controller,rooms.service,room-qr.service,room-code}.ts, apps/api/src/common/crypto/readable-code.ts. Web: apps/web/src/views/rooms/ui/{rooms-admin-view,create-room-modal,room-qr-sheet}.tsx, apps/web/src/views/rooms/lib/format-code.ts, apps/web/src/entities/room/api/room-api.ts.
- Данные на входе / выходе: name, kind, building, floor, capacity, openHours, phone, info / `Room` (+`qrCode` 8 символов, `qrIssuedAt`), PNG/data-URL QR для печати, `AuditLog`.
- Внешние зависимости: библиотека `qrcode` (генерация изображения на сервере).
- Тесты: apps/api/src/modules/rooms/room-qr.service.spec.ts, apps/api/test/cross-tenant.e2e-spec.ts (чтение/удаление чужой аудитории), apps/web/src/views/rooms/lib/format-code.test.ts; unit-спеки на `rooms.service.ts` (CRUD) — нет.
- Замечено: создание/удаление помещения не сбрасывает Redis-кэш статистики вуза (счётчик `rooms` отстаёт до 5 мин), в отличие от факультетов и групп.

### B-08 Сканирование QR над дверью: статус помещения «сейчас»

- Бизнес-цель: студент или сотрудник по QR в коридоре видит, свободна ли аудитория, какая пара идёт и что дальше; у служебных помещений — часы работы и телефон.
- Роли: любой аутентифицированный пользователь вуза помещения (платформа — любой); аноним уводится на `/login?next=/r/<код>`.
- Вход: UI `/r/[code]` (переход по QR), `/r` (ручной ввод кода); `GET /rooms/qr/:code`.
- Завершение: показан статус помещения в таймзоне вуза; неизвестный код и чужой вуз — одинаковый 404.
- Шаги и файлы: apps/web/src/app/r/page.tsx, apps/web/src/app/r/[code]/page.tsx, apps/web/src/views/rooms/ui/{room-code-entry-view,room-status-view}.tsx, apps/web/src/entities/room/lib/room-day.ts, apps/web/src/entities/schedule (`buildDayPairs`); API: apps/api/src/modules/rooms/room-qr.service.ts (`statusByCode`, `dayInRoom` — пары дня с наложением `ScheduleChange`).
- Данные на входе / выходе: код из QR / помещение, флаг `academic`, `now` (серверное время вуза), пары дня, изменения.
- Внешние зависимости: middleware Next.js (редирект на логин), модуль расписания (Pair, ScheduleChange).
- Тесты: apps/api/src/modules/rooms/room-qr.service.spec.ts, apps/web/src/entities/room/lib/room-day.test.ts; web/e2e — нет.

### B-09 Справочник КАТО: выбор города вуза и показ названий

- Бизнес-цель: хранить город вуза кодом КАТО (устойчиво к переименованиям, двуязычно ru/kk) и давать комбобокс поиска.
- Роли: любой аутентифицированный (без @Roles и scope); фактически используют PLATFORM_ADMIN/MODERATOR.
- Вход: комбобокс в `/platform-admin/universities` (создание вуза), колонки города в реестре вузов и `/platform-admin/stats`; `GET /kato`, `GET /kato/resolve`; заливка — сид `pnpm db:seed:kato`.
- Завершение: код выбран и сохранён в `University.city`; коды в таблицах заменены названиями на языке интерфейса.
- Шаги и файлы: `GET /kato?search=&scope=places|regions|all&limit=`, `GET /kato/resolve?codes=` (≤100). API: apps/api/src/modules/kato/kato.{controller,service}.ts. Сид: prisma/seed/steps/00-kato.mjs, prisma/seed/data/kato.json, scripts/gen-kato.mjs. Web: apps/web/src/entities/kato/{ui/kato-select.tsx,lib/use-kato-names.ts,lib/kato-name.ts,api/kato-api.ts}, apps/web/src/views/platform-admin/ui/{create-university-modal,universities-admin-view,platform-stats-view}.tsx.
- Данные на входе / выходе: строка поиска, scope, коды / `KatoUnit` (code, kind, nameRu/nameKk, parentCode, regionCode), 16 205 записей.
- Внешние зависимости: выгрузка stat.gov.kz (офлайн, через скрипт генерации).
- Тесты: apps/api/src/modules/kato/kato.service.spec.ts; web — нет.
- Замечено: КАТО не используется ни в форме демо-заявки, ни в одобрении (город — свободный текст), ни на шаге «О вузе» мастера — город вуза хранится в двух форматах вперемешку.

### B-10 Режим техработ (немедленный и плановый)

- Бизнес-цель: остановить платформу для всех, кроме платформенной команды, без деплоя; предупредить заранее о плановом окне; снять режим можно всегда и быстро.
- Роли: PLATFORM_ADMIN (включение/снятие); все пользователи и анонимы (видят экран/предупреждение); PLATFORM_ADMIN/MODERATOR проходят сквозь режим.
- Вход: Telegram мини-апп (экран «Управление»); `PATCH /platform/maintenance` (5/мин); чтение — `GET /platform/state` (@Public).
- Завершение: режим действует до `maintenance_until` (≤12 ч) и снимается сам; либо снят `minutes: null`; все прочие запросы получают 503 MAINTENANCE.
- Шаги и файлы: включение требует кода 2FA (`TwoFactorService.verifyForUser`, иначе 401 INVALID_2FA_CODE), `startsInMinutes` → плановое окно. API: apps/api/src/modules/platform/platform.{controller,service}.ts, apps/api/src/common/guards/maintenance.guard.ts (`@MaintenanceExempt` на auth/2FA/mini/platform/health/client-version/telegram-hook). Клиенты: apps/mini-app/src/screens/control.tsx, apps/mini-app/src/api/platform.ts; web apps/web/src/widgets/platform-gate/ui/platform-gate.tsx, apps/web/src/entities/platform/model/use-platform-state.ts, apps/web/src/app/providers.tsx.
- Данные на входе / выходе: minutes, startsInMinutes, тексты ru/kk/en, code (2FA) / `PlatformState` (singleton: maintenance_from/until), Redis-кэш 60 с + память процесса 5 с, `AuditLog` (`platform.maintenance.on|off`).
- Внешние зависимости: Redis, Telegram (мини-апп, initData), TOTP.
- Тесты: apps/api/src/modules/platform/platform.service.spec.ts, apps/api/src/common/guards/maintenance.guard.spec.ts, apps/web/src/widgets/platform-gate/ui/platform-gate.test.tsx; e2e — нет.
- Замечено: в веб-админке платформы нет UI для рычагов — управлять режимом можно только из Telegram мини-аппа (или прямым API-вызовом).

### B-11 Оперативные рычаги платформы: баннер, погашение разделов, сезон, откат

- Бизнес-цель: без деплоя показать объявление (адресно по ролям/вузам), спрятать сломанный раздел у всех, выключить/подменить праздничное оформление и отменить последнее нажатие.
- Роли: PLATFORM_ADMIN (запись); все (чтение публичного состояния).
- Вход: Telegram мини-апп; `PATCH /platform/banner`, `PATCH /platform/sections`, `PATCH /platform/season`, `POST /platform/undo`; чтение — `GET /platform/state`.
- Завершение: баннер висит до `banner_until` (≤30 сут), раздел убран из навигации и закрыт по прямой ссылке, сезон выключен/подменён; undo возвращает только переписанные поля (не старше 30 мин, иначе 409).
- Шаги и файлы: apps/api/src/modules/platform/platform.service.ts (`setBanner`, `setSections`, `setSeason`, `undoLast`, `write`/`snapshot`), dto/{set-banner,set-sections,set-season}.dto.ts. Web: apps/web/src/widgets/platform-gate/ui/platform-gate.tsx (`disabledSectionForPath`), apps/web/src/entities/platform/lib/{sections,pick-text}.ts, apps/web/src/widgets/app-shell/ui/app-shell.tsx (баннер, `isNavKeyDisabled`), apps/web/src/shared/config/holidays.ts, apps/web/src/shared/ui/{season-icon.ts,season-decor.tsx,season-greeting.tsx}. Мини-апп: apps/mini-app/src/screens/control.tsx.
- Данные на входе / выходе: текст ru/kk/en, level, minutes, roles[], universityIds[], disabled[], {off, override} / `PlatformState`, `AuditLog` (`platform.banner.*`, `platform.sections.set`, `platform.season.set`, снимок «как было» в metadata).
- Внешние зависимости: Redis (кэш состояния), Telegram (мини-апп).
- Тесты: apps/api/src/modules/platform/platform.service.spec.ts, apps/web/src/widgets/platform-gate/ui/platform-gate.test.tsx, apps/web/src/shared/config/holidays.test.ts, apps/web/src/shared/ui/season-icon.test.ts; тестов экрана мини-аппа control.tsx — нет.

### B-12 Дежурство команды платформы и уведомления (тихие часы, суточная сводка)

- Бизнес-цель: направлять сигналы о жалобах/обращениях одному дежурному по очереди, не будить в тихие часы и ежедневно присылать сводку очереди.
- Роли: PLATFORM_ADMIN (настройка); система (cron); дежурный/команда (получатели в Telegram).
- Вход: мини-апп (экран «Управление»); `GET|PATCH /platform/duty`, `PATCH /platform/notifications`; cron `rotateDuty` (пн 09:00), cron `sendDailyDigest` (ежечасно, отправка в выбранный час).
- Завершение: дежурство переходит к следующему в `rotation`; сводка отправлена (даже при пустой очереди).
- Шаги и файлы: apps/api/src/modules/platform/platform.service.ts (`duty`, `setDuty`, `rotateDuty`, `setNotifications`, `notificationPolicy`), apps/api/src/modules/cleanup/cleanup.service.ts (cron + Redis-лок), apps/api/src/common/telegram/telegram-notify.service.ts, apps/mini-app/src/screens/control.tsx, apps/mini-app/src/api/platform.ts (`/mini/links` — пул дежурных).
- Данные на входе / выходе: rotation (≤10 id), quiet from/to, muted[], dutyUserId, digestHour / `PlatformState`, сообщения Telegram, `AuditLog`.
- Внешние зависимости: Telegram Bot API, Redis (локи cron).
- Тесты: apps/api/src/modules/platform/platform.service.spec.ts, apps/api/src/modules/cleanup/cleanup.service.spec.ts, apps/api/src/common/telegram/telegram-notify.service.spec.ts.

### B-13 Наблюдение за платформой: очереди, хранилище, журнал изменений

- Бизнес-цель: видеть с телефона, не отстаёт ли воркер (ждущие/упавшие задачи BullMQ), сколько занимают файлы и кто последним трогал рычаги.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR.
- Вход: мини-апп, экран «Обзор»; `GET /platform/queues`, `GET /platform/storage`, `GET /platform/changes`.
- Завершение: показаны счётчики очередей, объём файлов по таблице `File`, последние записи `platform.*` аудита.
- Шаги и файлы: apps/api/src/modules/platform/platform.controller.ts (`queues` → `QueueService.counts`), apps/api/src/modules/platform/platform.service.ts (`storageUsage`, `recentChanges`), apps/api/src/common/queue/queue.service.ts; apps/mini-app/src/screens/overview.tsx, apps/mini-app/src/api/overview.ts.
- Данные на входе / выходе: — / {queue, waiting, failed}[], {files, bytes}, список изменений с автором.
- Внешние зависимости: Redis/BullMQ.
- Тесты: apps/api/src/modules/platform/platform.service.spec.ts («наблюдение»); тестов на `queues` и экран overview — нет.
- Замечено: в веб-панели `/platform-admin` эти данные не выводятся — только в мини-аппе.

### B-14 Релизы «Что нового»: объявление версии и показ ноты

- Бизнес-цель: после релиза один раз показать пользователю ноту об изменениях, не обгоняя сборку, которая у него реально загружена (PWA живёт неделями).
- Роли: PLATFORM_ADMIN (объявляет номер версии); все аутентифицированные (читают и отмечают прочитанным).
- Вход: мини-апп (`PATCH /platform/release`); диалог в вебе при старте приложения; `GET /releases/me`, `POST /releases/seen`.
- Завершение: нота показана и отмечена (`ReleaseView.version`); если объявленная версия выше собственной сборки клиента или аккаунт создан после релиза — промолчать.
- Шаги и файлы: API apps/api/src/modules/platform/platform.service.ts (`announceRelease` → `PlatformState.announced_version`), apps/api/src/modules/releases/releases.{controller,service}.ts. Web: apps/web/src/widgets/whats-new/ui/whats-new-dialog.tsx, apps/web/src/entities/release/{api/releases-api.ts,model/notes.json,model/notes.ts,lib/pick-note.ts,lib/compare-versions.ts,ui/release-note-modal.tsx}, apps/web/src/app/providers.tsx; тексты нот — в бандле web, не в БД; регламент docs/RELEASE.md.
- Данные на входе / выходе: version / `{ version, seenAt, accountCreatedAt }`, `ReleaseView` (одна строка на пользователя), `AuditLog` (`platform.release.announce`).
- Внешние зависимости: Redis (кэш `GET /platform/state`), Telegram (мини-апп).
- Тесты: apps/api/src/modules/releases/releases.service.spec.ts, apps/api/src/modules/platform/platform.service.spec.ts (объявление версии), apps/web/src/entities/release/lib/pick-note.test.ts, apps/web/src/entities/release/model/notes.test.ts; тестов диалога whats-new — нет.
- Замечено: `announcedVersion` (рычаг `PATCH /platform/release`) веб нигде не читает — диалог решает только по `notes.json` бандла и `GET /releases/me`, так что объявление из мини-аппа ни на что не влияет.

### B-15 Проверка версии клиента (мобильные приложения) и обновление PWA

- Бизнес-цель: не пускать устаревшие сборки iOS/Android в неработающий API — показать экран «Обновите приложение» со ссылкой на магазин; в вебе — предложить перезагрузку на новый бандл.
- Роли: любой клиент до входа (эндпоинт публичный, не закрывается техработами).
- Вход: `GET /client-version?platform=ios|android` при запуске приложения; заголовок `X-Client-Version` на каждом запросе; в вебе — событие нового service worker.
- Завершение: клиент сравнивает свою версию с `minimumVersion` и при отставании блокирует работу (кнопка «Обновить» только при наличии `storeUrl`); веб показывает тост «Обновить».
- Шаги и файлы: API apps/api/src/modules/client-version/client-version.{controller,service}.ts (ENV `IOS_/ANDROID_MIN_SUPPORTED_VERSION`, `*_STORE_URL`), apps/api/src/common/logging/client-version.ts, apps/api/src/common/monitoring/sentry.ts (тег `client_version`). Клиенты: apps/ios/Sources/Core/Version/ClientVersionAPI.swift, apps/ios/Sources/Features/Update/UpdateGateModel.swift, apps/android/app/src/main/kotlin/kz/studenthub/app/features/update/UpdateGateModel.kt; web apps/web/src/shared/lib/use-sw-update.ts (`BUILD_ID`, `useAppUpdate`, восстановление после ChunkLoadError).
- Данные на входе / выходе: platform, X-Client-Version / `{ platform, minimumVersion, storeUrl? }`.
- Внешние зависимости: переменные окружения, App Store / Google Play, Sentry.
- Тесты: apps/api/src/modules/client-version/client-version.service.spec.ts, apps/ios/Tests/StudentHubTests/UpdateGateTests.swift, apps/android/app/src/test/kotlin/kz/studenthub/app/core/VersionAndQrTest.kt, apps/web/src/shared/lib/chunk-error.test.ts.

### B-16 Health-check API и мониторинг доступности

- Бизнес-цель: давать хостингу и CI сигнал живости API и его зависимостей (PostgreSQL, Redis, MinIO).
- Роли: система (Railway, GitHub Actions), аноним.
- Вход: `GET /api/v1/health` (@Public, @MaintenanceExempt); Railway `healthcheckPath`; workflow `uptime.yml` (cron каждые 10 мин), `smoke.yml` (после деплоя).
- Завершение: 200 со статусами индикаторов либо 503, если любой из трёх недоступен.
- Шаги и файлы: apps/api/src/modules/health/health.controller.ts, apps/api/src/modules/health/indicators/{prisma,redis,minio}.health.ts, apps/api/railway.json, .github/workflows/{uptime,smoke}.yml, docker/docker-compose.prod.yml (там намеренно TCP-проверка вместо /health).
- Данные на входе / выходе: — / отчёт @nestjs/terminus `{ status, info, error, details }`.
- Внешние зависимости: PostgreSQL, Redis, MinIO, @nestjs/terminus.
- Тесты: нет unit/e2e-спеков модуля health (проверяется только workflow-ами smoke/uptime).
- Замечено: Railway использует как healthcheck тот же `/health`, что падает в 503 при сбое MinIO или Redis — прод-compose от этого сознательно отказался (TCP-проверка), а Railway нет.

### B-17 Дашборд и аналитика платформы

- Бизнес-цель: дать команде платформы картину по всем вузам — вузы по статусам, рост и активность пользователей (DAU/WAU), поток и скорость разбора жалоб, воронка инвайтов, тепловая карта активности.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR.
- Вход: UI `/platform-admin` (дашборд), `/platform-admin/stats` (таблица вузов); мини-апп «Обзор»; `GET /analytics/platform/*`.
- Завершение: показаны плитки, ряды с полными корзинами (`from`/`to`/`interval`) и таблица размеров вузов.
- Шаги и файлы: `GET /analytics/platform/{overview,users-growth,active-users,universities-size,complaints-flow,complaints-latency,invites-funnel,activity-heatmap,top-actions}`. API: apps/api/src/modules/analytics/platform-analytics.{controller,service}.ts, dto/platform-*.dto.ts. Web: apps/web/src/views/platform-admin/ui/{platform-dashboard-view,platform-stats-view}.tsx, apps/web/src/widgets/platform-dashboard/ui/{platform-dashboard,primitives,sparkline,use-in-view}.tsx, apps/web/src/entities/analytics/api/analytics-api.ts; мини-апп apps/mini-app/src/api/overview.ts.
- Данные на входе / выходе: from, to, interval, tz, limit / агрегаты поверх User/University/Complaint/Invite/AuditLog, Redis-кэш 300 с.
- Внешние зависимости: Redis, PostgreSQL (`percentile_cont`, groupBy по `audit_logs`).
- Тесты: apps/api/src/modules/analytics/platform-analytics.service.spec.ts, apps/web/src/widgets/platform-dashboard/ui/{primitives,use-in-view}.test.tsx.
- Замечено: `/platform-admin/stats` делает N+1 — по запросу `GET /universities/:id/stats` на каждый вуз (до 200, сверх — молча обрезается), хотя для этого есть `GET /analytics/platform/universities-size`.

### B-18 Дашборд и аналитика вуза

- Бизнес-цель: показать админу вуза счётчики структуры и динамику: посещаемость по неделям/факультетам, загрузку аудиторий 7×24, итоги экзаменов, поток заявок, воронку приглашений.
- Роли: UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR (вуз — только из JWT).
- Вход: UI `/university-admin` (StatsDashboard + баннер мастера), `/university-admin/analytics` (обзор факультета на выбор); `GET /analytics/university/*`, `GET /universities/:id/stats`, `GET /analytics/faculty?facultyId=`.
- Завершение: дашборд построен; данные из кэша Redis 5 мин.
- Шаги и файлы: `GET /analytics/university/{attendance-trend,attendance-breakdown,room-load,exam-results,applications-flow,invites-funnel}`. API: apps/api/src/modules/analytics/university-analytics.{controller,service}.ts, apps/api/src/modules/universities/universities.service.ts (`getStats`). Web: apps/web/src/widgets/stats-dashboard/ui/stats-dashboard.tsx, apps/web/src/app/university-admin/{page,analytics/page}.tsx, apps/web/src/views/dean-analytics/ui/dean-analytics-view.tsx, apps/web/src/entities/analytics/api/analytics-api.ts.
- Данные на входе / выходе: weeks / ряды по факультетам, сетка 7×24, воронка статусов.
- Внешние зависимости: Redis.
- Тесты: нет спеков на apps/api/src/modules/analytics/university-analytics.service.ts; web — нет.

### B-19 Дашборд и аналитика декана (факультет, группы, «требует внимания»)

- Бизнес-цель: декану видеть показатели факультета, посещаемость по группам с проваливанием до студентов и список студентов в зоне риска с явными причинами.
- Роли: DEAN (свой факультет из JWT); UNIVERSITY_ADMIN/MODERATOR и PLATFORM_ADMIN (факультет параметром).
- Вход: UI `/dean` (DeanDashboard), `/dean/analytics` (+ drill-down по группе); `GET /analytics/faculty`, `GET /analytics/group/:id/attendance`, `GET /analytics/at-risk`.
- Завершение: показаны плитки, группы < 60% посещаемости, студенты с причинами LOW_ATTENDANCE / OVERDUE_ASSIGNMENTS / LOW_GRADES.
- Шаги и файлы: API apps/api/src/modules/analytics/analytics.{controller,service}.ts (`facultyOverview`, `groupAttendance`, `atRiskStudents`, `resolveFaculty`, `assertGroupScope`), dto/faculty-analytics-query.dto.ts. Web: apps/web/src/views/dean-dashboard/ui/dean-dashboard.tsx (плюс очередь заявок `fetchQueueStats`), apps/web/src/views/dean-analytics/ui/{dean-analytics-view,group-drilldown}.tsx, apps/web/src/entities/analytics.
- Данные на входе / выходе: facultyId? / показатели, посещаемость по группам/студентам, at-risk список.
- Внешние зависимости: нет (прямые агрегаты Prisma, без кэша).
- Тесты: apps/api/src/modules/analytics/analytics.service.spec.ts (5 кейсов: facultyOverview, atRiskStudents); groupAttendance и web — нет.

### B-20 Обзоры преподавателя и старосты (API-агрегаты)

- Бизнес-цель: дать преподавателю сводку нагрузки/очереди проверки/консультаций, а старосте — агрегаты своей группы без персональных срезов.
- Роли: TEACHER, STAROSTA.
- Вход: `GET /analytics/teacher`, `GET /analytics/my-group`.
- Завершение: возвращён агрегат по пользователю из JWT.
- Шаги и файлы: apps/api/src/modules/analytics/analytics.controller.ts, apps/api/src/modules/analytics/analytics.service.ts (`teacherOverview`, `myGroupOverview`).
- Данные на входе / выходе: — / сводные счётчики.
- Внешние зависимости: нет.
- Тесты: нет.
- Замечено: ни веб, ни iOS/Android, ни мини-апп эти эндпоинты не вызывают — мёртвый API (~280 строк сервиса без тестов).

### B-21 Наполнение вуза людьми из админки: приглашения, массовый импорт CSV/XLSX, списки

- Бизнес-цель: после создания структуры завести в вуз деканов, преподавателей и студентов — по одному или файлом — и видеть списки людей по ролям. Ядро процесса — модуль invites/users (группа A), здесь — входы из админок вуза и деканата.
- Роли: UNIVERSITY_ADMIN, DEAN, STAROSTA (роль строго ниже своей, в своём scope), PLATFORM_ADMIN.
- Вход: UI `/university-admin/invites`, `/dean/invites`, `/starosta/invites`, списки `/university-admin/{students,teachers,deans}`, `/dean/{students,teachers,starostas}`; шаг мастера «Деканы»; эндпоинты `POST /invites`, `POST /invites/bulk/preview`, `POST /invites/bulk`, `GET /users`.
- Завершение: инвайты созданы (письма уходят через очередь EMAIL), строки с ошибками показаны в предпросмотре; шаг мастера «Деканы» закрывается уже выписанным PENDING-инвайтом.
- Шаги и файлы: apps/web/src/views/university-admin/ui/invites-view.tsx → apps/web/src/features/create-invite/ui/{create-invite,create-invite-modal,bulk-invite}.tsx; apps/web/src/widgets/users-table/ui/users-table.tsx; API apps/api/src/modules/invites/{invites.controller,invites.service,bulk-parse,invite-hierarchy}.ts.
- Данные на входе / выходе: роль, email, факультет/группа; файл CSV/XLSX / `Invite[]`, отчёт предпросмотра по строкам.
- Внешние зависимости: xlsx (SheetJS, тарбол с CDN), BullMQ + SMTP.
- Тесты: apps/api/src/modules/invites/{bulk-invite,invite-hierarchy,invites.service}.spec.ts, apps/web/e2e/register.e2e.ts (регистрация по инвайту); e2e импорта файла — нет.

### B-22 Стартовые экраны ролей: ролевой редирект, главная студента, заглушки разделов

- Бизнес-цель: после входа отправить каждого на «дом» своей роли и показать стартовый экран; несуществующие разделы роли — аккуратная заглушка «в разработке» вместо 404.
- Роли: все 8 ролей (STUDENT/STAROSTA → `/`, PLATFORM_ADMIN → `/platform-admin`, UNIVERSITY_ADMIN → `/university-admin`, DEAN → `/dean`, TEACHER → `/teacher`, модераторы → `/moderator/*`, EMPLOYER → `/employer`).
- Вход: middleware Next.js и формы входа/регистрации (`ROLE_HOME`); UI `/` (главная студента), catch-all `[...section]` в `/platform-admin`, `/dean`, `/teacher`, `/starosta`, `/moderator/*`.
- Завершение: пользователь на своей главной; для студента — лента, сторисы, пары на сегодня, ближайшие события, друзья.
- Шаги и файлы: apps/web/src/shared/config/routes.ts (`ROLE_HOME`), apps/web/src/middleware.ts, apps/web/src/shared/session/server.ts, apps/web/src/app/(student)/page.tsx → apps/web/src/views/home/ui/{home-view,home-sidebar}.tsx (FeedList, StoriesRail, FriendsPanel, `fetchSchedule`, `fetchEvents`), apps/web/src/views/role-landing/ui/{section-stub,role-landing}.tsx, apps/web/src/widgets/app-shell/model/nav.ts.
- Данные на входе / выходе: роль из сессии / редирект, данные ленты/расписания/событий.
- Внешние зависимости: нет.
- Тесты: apps/web/e2e/{login,access,feed}.e2e.ts; unit — нет.
- Замечено: `RoleLanding` (apps/web/src/views/role-landing/ui/role-landing.tsx) экспортируется, но нигде не используется — мёртвый код.

## Группа C — Учебный процесс

### C-01 Справочники вуза: дисциплины, семестры, курсы групп

- Бизнес-цель: завести академический каркас вуза — справочник предметов (`Subject`), семестры (`Term`) и курсы «предмет × группа × семестр» с преподавателем (`Course`), на которые опираются задания, журнал и экзамены.
- Роли: UNIVERSITY_ADMIN, PLATFORM_ADMIN (предметы/семестры/курсы); DEAN (только курсы своего факультета); чтение — все роли вуза по scope.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/university-admin/courses`, `/dean/courses` (вкладки «Курсы / Предметы / Семестры»).
- Завершение: курс создан/удалён, запись в аудит; удаление курса с оценками/работами/результатами — `409 CONFLICT`, предмета/семестра, на которые ссылаются курсы, — тоже `CONFLICT`.
- Шаги и файлы: `apps/api/src/modules/courses/{courses,subjects,terms}.controller.ts`, `courses.service.ts` (scope-гейты, `handleUnique`, аудит); `GET|POST /subjects`, `PATCH|DELETE /subjects/:id`, `GET|POST /terms`, `PATCH|DELETE /terms/:id`, `GET|POST /courses`, `GET|PATCH|DELETE /courses/:id`; web `apps/web/src/views/course-admin/ui/{course-admin-view,create-course-modal,create-subject-modal,create-term-modal}.tsx`, `apps/web/src/entities/course/api/course-api.ts`; схема `prisma/schema/17-courses.prisma`.
- Данные на входе / выходе: `{name}` / `{name,number,startsOn,endsOn,isActive}` / `{subjectId,groupId,teacherId?,termId?,credits?}` → строки справочников; уникальности `[universityId,name]`, `[subjectId,groupId,termId]`.
- Внешние зависимости: PostgreSQL; `AuditService`.
- Тесты: `apps/api/src/modules/courses/courses.service.spec.ts` (удаление с записями, кого можно назначить преподавателем); `apps/api/test/cross-tenant.e2e-spec.ts` (чужой курс → 403/404).
- Замечено: в вебе нет редактирования — `updateCourseRequest` экспортирован, но не вызывается; PATCH предметов/семестров на клиенте не реализован вовсе.

### C-02 Дисциплины студента: список и рабочее место курса

- Бизнес-цель: дать студенту единый экран по каждой дисциплине — ближайшие пары, преподаватель, материалы, задания, оценки, посещаемость, участники.
- Роли: STUDENT, STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/courses`, `/courses/[subject]` (ключ — строка `subject`, закодирована в URL).
- Завершение: экран отрисован (только чтение).
- Шаги и файлы: `apps/web/src/app/(student)/courses/page.tsx`, `apps/web/src/app/(student)/courses/[subject]/page.tsx`, `apps/web/src/views/courses/ui/{courses-view,course-view,material-row}.tsx`, `apps/web/src/views/courses/lib/build-courses.ts` (агрегация пар расписания + материалов + курсов); API: `GET /schedule`, `GET /materials`, `GET /courses`, `GET /assignments?courseId=`, `GET /gradebook/me`, `GET /attendance/me`.
- Данные на входе / выходе: группа из JWT → карточки дисциплин (ближайшая пара, число материалов, статусы заданий, % оценок).
- Внешние зависимости: нет (только API).
- Тесты: нет.
- Замечено: дисциплина склеивается по строке `Pair.subject`/`Material.subject` с `Course.subject.name` — FK `Pair→Course` нет (`prisma/schema/03-schedule.prisma`), переименование предмета рвёт связку.

### C-03 Учебный план и академический профиль студента

- Бизнес-цель: показать студенту траекторию обучения — дисциплины по семестрам, кредиты, прогресс, итоги (учебный план) и сводку успеваемости/посещаемости/экзаменов/долгов (академический профиль).
- Роли: STUDENT, STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/study-plan`, `/academic`.
- Завершение: экран отрисован (только чтение); статус дисциплины вычисляется на клиенте (`term.isActive` → «изучается», % по опубликованным оценкам).
- Шаги и файлы: `apps/web/src/views/study-plan/ui/study-plan-view.tsx` (`GET /courses` + `GET /gradebook/me`), `apps/web/src/views/academic/ui/academic-view.tsx` (`GET /users/me`, `GET /gradebook/me`, `GET /attendance/me`, `GET /exams`, `GET /assignments`).
- Данные на входе / выходе: курсы группы с семестром/кредитами + опубликованные оценки → таблица плана, метрики (кредиты, средний %).
- Внешние зависимости: нет.
- Тесты: нет.
- Замечено: отдельной модели ИУП/учебного плана нет — план = курсы группы; выбор элективов и индивидуальная траектория не поддерживаются.

### C-04 Составление и публикация расписания группы (версии, пары, конфликты)

- Бизнес-цель: собрать недельную сетку пар группы с учётом чётности недели и опубликовать её как единственную активную версию без пересечений по группе, преподавателю и аудитории.
- Роли: DEAN, UNIVERSITY_ADMIN, PLATFORM_ADMIN (версии и любые пары в scope); TEACHER (только свои пары в группах, где ведёт курс).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/dean/schedule`, `/university-admin/schedule`, `/teacher/schedule` (`ScheduleManageView mode="teacher"`).
- Завершение: версия создана/активирована (прочие версии группы деактивируются в транзакции), пара сохранена; при пересечении — `409 CONFLICT` с `details[]` по полям `groupId/teacherId/roomId`; аудит.
- Шаги и файлы: `apps/api/src/modules/schedules/{schedules,pairs}.controller.ts`, `schedules.service.ts` (`createSchedule/updateSchedule/removeSchedule`, `createPair/updatePair/removePair`, `assertNoConflict`, `assertTeacherPairScope`, `assertTeachesGroup`); `GET|POST /schedules`, `GET|PATCH|DELETE /schedules/:id`, `POST /pairs`, `PATCH|DELETE /pairs/:id`; web `apps/web/src/views/schedule/ui/schedule-manage-view.tsx`, `apps/web/src/features/manage-schedule/ui/{manage-schedule,schedule-editor,add-pair-modal,create-version-modal,schedule-day-list}.tsx`, `apps/web/src/entities/schedule/api/schedule-api.ts`; схема `prisma/schema/03-schedule.prisma`.
- Данные на входе / выходе: `{groupId,name,isActive}`; пара `{scheduleId,groupId,subject,teacherId?,roomId?,dayOfWeek,startTime,endTime,weekType ODD|EVEN|BOTH}` → `Schedule`, `Pair`.
- Внешние зависимости: PostgreSQL; `AuditService`; `RoomService` (аудитория своего вуза).
- Тесты: `apps/api/src/modules/schedules/schedules.service.spec.ts` (конфликты, чётность, scope преподавателя); `apps/web/e2e/schedule.e2e.ts` (декан добавляет пару).
- Замечено: правка/удаление самих пар не шлёт ни WS, ни уведомлений — студенты узнают о перестройке сетки только при перезагрузке.

### C-05 Разовые изменения расписания: перенос, замена, смена аудитории, отмена

- Бизнес-цель: оперативно сообщить группе и преподавателям об изменении конкретного занятия на конкретную дату, не трогая базовую сетку.
- Роли: DEAN, UNIVERSITY_ADMIN, PLATFORM_ADMIN (создают); получатели — студенты группы, преподаватель пары и заменяющий.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI модалка пары в `/dean/schedule`, `/university-admin/schedule` → `POST /schedule/changes`; очередь `notifications`, job `schedule-changed`.
- Завершение: запись `ScheduleChange`, аудит `schedule_change_created`, WS `schedule:changed` + конверт `schedule.lesson.updated` в комнату `group:<id>`, in-app/push-уведомление `SCHEDULE_CHANGE` (dedupe `schedule-changed:<changeId>`).
- Шаги и файлы: `apps/api/src/modules/schedules/schedule-view.controller.ts`, `schedules.service.ts` (`createChange`, `enqueueChangeNotification`, `listChanges`); `apps/api/src/modules/notifications/notifications.processor.ts`; web `apps/web/src/features/manage-schedule/ui/pair-details-modal.tsx`, наложение в `apps/web/src/widgets/schedule-grid/ui/schedule-grid.tsx`, `apps/web/src/widgets/today/ui/{student,teacher,dean}-today.tsx`.
- Данные на входе / выходе: `{pairId,date,type MOVED|ROOM_CHANGED|CANCELLED|SUBSTITUTED,newRoomId?,newTeacherId?,newStartTime?,newEndTime?,note?}` → `ScheduleChange`, `GET /schedule/changes?from=&to=`.
- Внешние зависимости: Redis/BullMQ (очередь уведомлений), Socket.IO (`RealtimeGateway`), push-провайдеры через модуль уведомлений.
- Тесты: `apps/api/src/modules/schedules/schedules.service.spec.ts` (createChange: БД + WS + job); `apps/api/src/modules/notifications/notifications.processor.spec.ts` (общая обработка очереди).
- Замечено: WS уходит только в `group:<id>`, а преподаватель в JWT не несёт groupId — `teacher-today.tsx` подписан на `schedule:changed`, но живого обновления не получит; изменение нельзя отменить/исправить (нет PATCH/DELETE `/schedule/changes/:id`).

### C-06 Просмотр расписания по роли

- Бизнес-цель: показать каждому «своё» расписание в таймзоне вуза: студенту/старосте — группы, преподавателю — свои пары, декану — факультет, админу — вуз; с учётом чётности недели и наложенных изменений.
- Роли: STUDENT, STAROSTA, TEACHER, DEAN, UNIVERSITY_ADMIN/MODERATOR, PLATFORM_ADMIN.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/schedule`, `/starosta/schedule` (`ScheduleView`), сетка в `ScheduleManageView` для персонала; `GET /schedule`, `GET /schedule/changes`, `GET /me/today` (BFF «Сегодня»).
- Завершение: сетка отрисована; при WS `schedule:changed` перезапрашиваются только изменения.
- Шаги и файлы: `apps/api/src/modules/schedules/schedules.service.ts` (`getSchedule` + `buildReadWhere` — scope из JWT, `take: 500`, `resolveViewerTimezone`); `apps/api/src/modules/me/me.service.ts`; web `apps/web/src/views/schedule/ui/schedule-view.tsx`, `apps/web/src/widgets/schedule-grid/ui/schedule-grid.tsx`, `apps/web/src/entities/schedule/lib/{day,layout-columns}.ts`, `apps/web/src/widgets/today/`.
- Данные на входе / выходе: фильтры `groupId/teacherId/roomId/dayOfWeek/weekType/subject` → `{timezone, pairs[]}` + список `ScheduleChange`.
- Внешние зависимости: Socket.IO (живое обновление).
- Тесты: `apps/api/src/modules/schedules/schedules.service.spec.ts` (ролевая выборка, подмена groupId студентом, чётность); `apps/web/src/widgets/today/lib/schedule-day.test.ts`, `apps/web/src/widgets/today/ui/next-pair-card.test.tsx`, `apps/web/src/widgets/today/lib/attention.test.ts`; `apps/web/e2e/a11y.e2e.ts` (доступность `/schedule`, `/dean/schedule`).
- Замечено: `isoWeekParity` (`apps/web/src/shared/lib/tz-date.ts`) считает неделю от 4 января без поправки на его день недели — номер недели расходится с ISO 8601 (известный открытый вопрос).

### C-07 Календарь и «Дела» студента

- Бизнес-цель: свести в одну ленту времени пары (с изменениями), дедлайны заданий, события вуза и заявки — чтобы студент видел, что и когда ему нужно сделать.
- Роли: STUDENT, STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/calendar`, `/tasks`.
- Завершение: экран отрисован (только чтение, агрегация на клиенте).
- Шаги и файлы: `apps/web/src/views/calendar/ui/calendar-view.tsx` + `lib/calendar-events.ts` (`GET /schedule`, `GET /schedule/changes`, `GET /events`, `GET /assignments`); `apps/web/src/views/tasks/ui/tasks-view.tsx` + `lib/tasks.ts` (`GET /schedule`, заявки, `GET /events`, `GET /assignments`).
- Данные на входе / выходе: ответы доменных API → события календаря / список дел с приоритетом по сроку.
- Внешние зависимости: нет.
- Тесты: `apps/web/src/views/calendar/lib/calendar-events.test.ts`, `apps/web/src/views/tasks/lib/tasks.test.ts`.
- Замечено: календарь не тянет экзамены и консультации, хотя PROJECT.md §3.1 называет их «особыми событиями» расписания.

### C-08 Отметка посещаемости преподавателем (журнал занятия)

- Бизнес-цель: зафиксировать присутствие студентов на конкретном занятии в конкретную дату (PRESENT/LATE/ABSENT/EXCUSED) и подсветить преподавателю ещё не отмеченные пары.
- Роли: TEACHER (только свои пары), DEAN (факультет), UNIVERSITY_ADMIN, PLATFORM_ADMIN; STAROSTA отмечать не может.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/teacher/attendance`, карточка «Отметить посещаемость» на главной преподавателя (`widgets/today/ui/teacher-actions.tsx`).
- Завершение: upsert отметок в транзакции (`markedById` = актор), аудит; повторное сохранение перезаписывает статус.
- Шаги и файлы: `apps/api/src/modules/attendance/attendance.controller.ts`, `attendance.service.ts` (`roster`, `marked`, `mark`, `assertManagePair`); `GET /attendance/roster?pairId=&date=`, `GET /attendance/marked?date=&pairIds=`, `PUT /attendance`; web `apps/web/src/views/attendance/ui/{teacher-attendance-view,attendance-roster}.tsx`, `apps/web/src/views/attendance/lib/status-visuals.ts`, `apps/web/src/entities/attendance/api/attendance-api.ts`; схема `prisma/schema/19-attendance.prisma`.
- Данные на входе / выходе: `{pairId,date,entries:[{studentId,status,note?}]}` → строки `Attendance` (`@@unique([pairId,date,studentId])`); ростер — студенты группы + текущие отметки.
- Внешние зависимости: PostgreSQL; `AuditService`.
- Тесты: нет (у модуля `attendance` нет ни одного spec; косвенно — `apps/api/src/modules/analytics/analytics.service.spec.ts`).
- Замечено: `GET /attendance/marked` не проверяет scope пар (сознательно, отдаёт лишь факт отметки); дата не сверяется с днём недели пары и отменами из `ScheduleChange`.

### C-09 QR-самоотметка студента на занятии

- Бизнес-цель: ускорить перекличку — преподаватель показывает QR, студенты сами отмечаются как присутствующие.
- Роли: TEACHER/DEAN/UNIVERSITY_ADMIN/PLATFORM_ADMIN (выдают QR); STUDENT, STAROSTA (сканируют).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI модалка QR в `/teacher/attendance` → `GET /attendance/qr?pairId=&date=`; студент открывает ссылку `/checkin?t=<token>` → `POST /attendance/check-in`.
- Завершение: создана отметка `PRESENT` (`markedById = null`) или возвращена существующая (`already: true`, без перезаписи); аудит; истёкший токен → `400`, подделанный → `401`.
- Шаги и файлы: `apps/api/src/modules/attendance/attendance.service.ts` (`createQrToken`, `checkIn`, `verifyQrToken`, ключ = sha256(`JWT_ACCESS_SECRET` + `:attendance-qr:v1`), TTL 90 с), `apps/api/src/common/crypto/signed-token.ts`; web `apps/web/src/views/attendance/ui/{attendance-qr-modal,checkin-view}.tsx`, `apps/web/src/app/(student)/checkin/page.tsx`.
- Данные на входе / выходе: `{pairId,date}` → `{token, qr (data-URL), checkinUrl, ttlSeconds}`; `{token}` → `{status, subject, date, already}`.
- Внешние зависимости: генерация QR-картинки на сервере; `CORS_ORIGIN` (база ссылки в QR).
- Тесты: `apps/api/src/common/crypto/signed-token.spec.ts` (подпись/истечение токена); сценарий check-in не покрыт.
- Замечено: токен stateless и без привязки к устройству/месту — в пределах 90 с скрин QR можно переслать отсутствующему одногруппнику.

### C-10 Сводка посещаемости студента

- Бизнес-цель: показать студенту его посещаемость (процент, пропуски, опоздания) по периоду и по дисциплинам.
- Роли: STUDENT, STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/attendance`, блоки на `/academic` и `/courses/[subject]`; `GET /attendance/me?from=&to=`.
- Завершение: экран отрисован (только чтение).
- Шаги и файлы: `apps/api/src/modules/attendance/attendance.service.ts` (`studentSummary`); web `apps/web/src/views/attendance/ui/student-attendance-view.tsx`, `apps/web/src/app/(student)/attendance/page.tsx`.
- Данные на входе / выходе: период → `{total,present,late,absent,excused,rate,recent[≤100]}`.
- Внешние зависимости: нет.
- Тесты: нет.
- Замечено: счётчики строятся по `findMany(..., take: 2000)` вместо `groupBy` — за несколько лет учёбы без фильтра периода статистика молча обрежется.

### C-11 Ведение журнала оценок: контрольные точки и выставление баллов

- Бизнес-цель: преподаватель ведёт по курсу журнал из колонок (лабораторные, контрольные, экзамен) и выставляет баллы; студенты видят оценку только после публикации колонки.
- Роли: TEACHER (только свои курсы), DEAN (факультет), UNIVERSITY_ADMIN, PLATFORM_ADMIN (через API; UI — только у преподавателя).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/teacher/gradebook`.
- Завершение: оценки сохранены (upsert, `score=null` удаляет); колонка опубликована → WS-конверт `grade.published` каждому студенту с оценкой в ней; удаление опубликованной колонки с оценками — `409 CONFLICT`; аудит.
- Шаги и файлы: `apps/api/src/modules/gradebook/gradebook.controller.ts`, `gradebook.service.ts` (`gradebook`, `createColumn/updateColumn/deleteColumn`, `setPublished`, `saveGrades`, `assertManage`); `GET /gradebook/course/:courseId`, `POST /gradebook/columns`, `PATCH|DELETE /gradebook/columns/:id`, `POST /gradebook/columns/:id/publish|unpublish`, `PUT /gradebook/grades`; web `apps/web/src/views/gradebook/ui/{gradebook-view,gradebook-table,add-column-modal}.tsx`, `apps/web/src/entities/gradebook/api/gradebook-api.ts`; схемы `prisma/schema/20-gradebook.prisma`, `packages/shared-schemas/src/gradebook.ts`.
- Данные на входе / выходе: колонка `{courseId,title,kind LAB|CONTROL|EXAM|OTHER,maxScore?,position}`; `{columnId,entries:[{studentId,score|null}]}` → матрица «студенты × колонки».
- Внешние зависимости: Socket.IO (`RealtimeGateway.emitEventToUser`); `AuditService`.
- Тесты: `apps/api/src/modules/gradebook/gradebook.service.spec.ts` (только `deleteColumn`); `apps/web/src/shared/realtime/realtime-context.test.tsx` (доставка `grade.published`).
- Замечено: сервер не сверяет балл с `maxScore` колонки (схема пропускает 0..1000); правка оценок в уже опубликованной колонке студенту ни WS, ни уведомлением не сообщается.

### C-12 Оценки студента

- Бизнес-цель: студент видит свои опубликованные оценки по дисциплинам и средний процент, вживую обновляемые при публикации.
- Роли: STUDENT, STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/grades`, блоки на `/academic`, `/study-plan`, `/courses/[subject]`; `GET /gradebook/me`; WS `grade.published`.
- Завершение: экран отрисован; при `grade.published` запрос перезапрашивается.
- Шаги и файлы: `apps/api/src/modules/gradebook/gradebook.service.ts` (`myGrades` — только `published` колонки); web `apps/web/src/views/student-grades/ui/student-grades-view.tsx`, `apps/web/src/app/(student)/grades/page.tsx`.
- Данные на входе / выходе: JWT студента → `MyGradesCourse[]` (курс, колонки, балл/макс).
- Внешние зависимости: Socket.IO.
- Тесты: `apps/web/src/shared/realtime/realtime-context.test.tsx` (косвенно); на `myGrades` — нет.

### C-13 Задание: создание, публикация, закрытие

- Бизнес-цель: преподаватель ставит группе задание по курсу (тип, формат сдачи, макс. балл, попытки, срок, поздняя сдача), публикует его и закрывает приём.
- Роли: TEACHER (свой курс), DEAN (факультет), UNIVERSITY_ADMIN, PLATFORM_ADMIN; получатели — студенты/староста группы курса.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/teacher/assignments` (модалка создания); очередь `notifications`, job `ASSIGNMENT_PUBLISHED`.
- Завершение: `Assignment` в статусе DRAFT → PUBLISHED (`publishAt = now`, уведомление группе, dedupe `assignment-published:<id>`) → CLOSED; удаление каскадом сносит сдачи; аудит.
- Шаги и файлы: `apps/api/src/modules/assignments/assignments.controller.ts`, `assignments.service.ts` (`create`, `update`, `setStatus`, `notifyPublished`, `remove`, `scopeWhere`, `assertManageCourse`); `GET|POST /assignments`, `GET|PATCH|DELETE /assignments/:id`, `POST /assignments/:id/publish|close`; web `apps/web/src/views/assignments/ui/{teacher-assignments-view,create-assignment-modal}.tsx`, `apps/web/src/entities/assignment/api/assignment-api.ts`; схемы `prisma/schema/18-assignments.prisma`, `packages/shared-schemas/src/assignments.ts`.
- Данные на входе / выходе: `{courseId,title,description?,type,submissionType,maxScore?,maxAttempts?,allowLate?,publishAt?,dueAt?}` → `Assignment`; студенту в списке видны только PUBLISHED/CLOSED своей группы + `mySubmission`.
- Внешние зависимости: Redis/BullMQ (уведомления); `AuditService`.
- Тесты: нет (на создание/публикацию; см. C-14/C-15).
- Замечено: поле `publishAt` только хранится — отложенной публикации нет (ни cron, ни фильтра по времени), задание публикуется лишь кнопкой.

### C-14 Сдача работы студентом

- Бизнес-цель: студент готовит черновик ответа (текст/ссылка) и отправляет его на проверку в срок; после возврата — дорабатывает и пересдаёт.
- Роли: STUDENT, STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/assignments` (список + карточка задания), дедлайны также в `/calendar`, `/tasks`, `/courses/[subject]`.
- Завершение: `Submission` DRAFT/RETURNED → SUBMITTED (`submittedAt`, `attemptNumber+1` после возврата); пустая работа → `VALIDATION_ERROR`; после срока без `allowLate` → `409 CONFLICT` (возвращённую можно сдать и после срока).
- Шаги и файлы: `apps/api/src/modules/assignments/assignments.service.ts` (`saveDraft`, `submit`, `assertStudentCanSubmit`); `PUT /assignments/:id/submission`, `POST /assignments/:id/submit`; web `apps/web/src/views/assignments/ui/{student-assignments-view,student-assignment-detail}.tsx`, `apps/web/src/views/assignments/lib/assignment-status.ts`, `apps/web/src/entities/assignment/lib/status.ts`.
- Данные на входе / выходе: `{text?,linkUrl?}` → `Submission` (`@@unique([assignmentId,studentId])`).
- Внешние зависимости: нет.
- Тесты: `apps/api/src/modules/assignments/submit-deadline.spec.ts`; `apps/web/src/entities/assignment/lib/status.test.ts`.
- Замечено: `maxAttempts` нигде не проверяется — пересдавать после возврата можно бесконечно; файловых вложений у сдачи нет (только текст и ссылка), преподавателю о новой сдаче не сообщается.

### C-15 Проверка работ: очередь, оценка, возврат на доработку

- Бизнес-цель: преподаватель видит, сколько работ ждёт проверки, оценивает их с отзывом или возвращает на доработку; студент получает уведомление.
- Роли: TEACHER, DEAN, UNIVERSITY_ADMIN, PLATFORM_ADMIN (scope как у списка заданий).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/teacher/assignments` (рабочее место проверки), карточка «На проверке» на главной преподавателя; очередь `notifications`, job `ASSIGNMENT_GRADED`.
- Завершение: SUBMITTED → GRADED (`score`, `feedback`, `gradedById`) или → RETURNED (`feedback`); уведомление студенту (dedupe по `submissionId:attemptNumber`); аудит; повторная проверка не SUBMITTED-работы → `409`.
- Шаги и файлы: `apps/api/src/modules/assignments/{assignments,submissions}.controller.ts`, `assignments.service.ts` (`reviewQueue`, `submissions`, `grade`, `returnForFix`, `notifyStudent`); `GET /assignments/review-queue?limit=`, `GET /assignments/:id/submissions`, `POST /submissions/:id/grade`, `POST /submissions/:id/return`; web `apps/web/src/views/assignments/ui/{grading-workspace,grade-submission-modal}.tsx`, `apps/web/src/widgets/today/ui/teacher-actions.tsx`.
- Данные на входе / выходе: `{score 0..1000, feedback?}` / `{feedback}` → обновлённый `Submission`; очередь → `{total, items[{id,title,subject,dueAt,pending}]}`.
- Внешние зависимости: Redis/BullMQ (уведомления); `AuditService`.
- Тесты: `apps/api/src/modules/assignments/review-queue.spec.ts` (роли и порядок маршрутов).
- Замечено: балл не сверяется с `Assignment.maxScore`; оценка за задание не попадает в журнал (`GradeColumn`/`Grade`) — два независимых контура оценивания.

### C-16 Экзаменационная сессия: планирование экзаменов

- Бизнес-цель: назначить группе экзамены по курсам — дата, формат, аудитория, экзаменатор, макс. балл — и показать студентам их сессию.
- Роли: DEAN, TEACHER (ведущий курс), UNIVERSITY_ADMIN, PLATFORM_ADMIN — создают/правят; экзаменатор править экзамен не может; STUDENT/STAROSTA — смотрят.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/dean/exams`, `/teacher/exams` (`ExamManagementView`), студент — `/exams`, блок на `/academic`.
- Завершение: `Exam` создан/изменён; удаление экзамена с результатами — `409 CONFLICT`; аудит; студент видит экзамен с полем `myResult`.
- Шаги и файлы: `apps/api/src/modules/exams/exams.controller.ts`, `exams.service.ts` (`list` take 200, `getById`, `create`, `update`, `remove`, `scopeWhere`, `assertManageCourse`, проверки экзаменатора/аудитории своего вуза); `GET|POST /exams`, `GET|PATCH|DELETE /exams/:id`; web `apps/web/src/views/exams/ui/{exam-management-view,create-exam-modal,student-exams-view}.tsx`, `apps/web/src/views/exams/lib/visuals.ts`, `apps/web/src/entities/exam/api/exam-api.ts`; схема `prisma/schema/21-exams.prisma`.
- Данные на входе / выходе: `{courseId,groupId,date,format ORAL|WRITTEN|TEST|PROJECT|OTHER,roomId?,examinerId?,maxScore?,note?}` → `Exam`.
- Внешние зависимости: PostgreSQL; `AuditService`; `RoomService`/таблица аудиторий.
- Тесты: `apps/api/src/modules/exams/exams-remove.spec.ts`, `apps/api/src/modules/exams/exams-room.spec.ts`, `apps/api/src/modules/exams/exams.service.spec.ts` (права экзаменатора).
- Замечено: ни назначение, ни перенос экзамена не шлют студентам уведомлений/WS; экзамены не попадают в `/calendar` и сетку расписания (возможен конфликт аудитории с парой — проверки нет).

### C-17 Ведомость экзамена: допуск, результаты, пересдачи

- Бизнес-цель: экзаменатор или ведущий курс заполняет ведомость группы — допуск, статус (сдал/не сдал/неявка/пересдача), балл, примечание; студент видит свой результат.
- Роли: TEACHER (ведущий курс или назначенный экзаменатор), DEAN, UNIVERSITY_ADMIN, PLATFORM_ADMIN; STUDENT/STAROSTA — чтение своего `myResult`.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI ведомость в `/dean/exams`, `/teacher/exams`; `GET /exams/:id/results`, `PUT /exams/results`.
- Завершение: upsert `ExamResult` по каждому студенту в транзакции, аудит `exam_results_set`, ответ — обновлённая ведомость.
- Шаги и файлы: `apps/api/src/modules/exams/exams.service.ts` (`results`, `setResults`, `findManageable(..., {examiner:true})`); web `apps/web/src/views/exams/ui/exam-results-roster.tsx`, `student-exams-view.tsx`; схема `packages/shared-schemas/src/exams.ts`.
- Данные на входе / выходе: `{examId, entries:[{studentId,admitted,status SCHEDULED|PASSED|FAILED|ABSENT|RETAKE,score?,note?}]}` → строки `ExamResult` (`@@unique([examId,studentId])`).
- Внешние зависимости: `AuditService`.
- Тесты: `apps/api/src/modules/exams/exams.service.spec.ts` (экзаменатор открывает и заполняет ведомость, посторонний — нет).
- Замечено: поле `ExamResult.attempt` никогда не пишется (всегда 1) — бейдж «попытка N» в `student-exams-view.tsx` недостижим, история пересдач затирается upsert'ом; балл не сверяется с `Exam.maxScore`, `admitted=false` + `PASSED` не запрещено; студенту о результате не сообщается.

### C-18 Консультации: слоты преподавателя и запись студентов

- Бизнес-цель: преподаватель публикует окна приёма, студент своего вуза выбирает преподавателя и записывается в свободный слот с темой; обе стороны могут отменить.
- Роли: TEACHER, DEAN (создают/удаляют/отменяют свои слоты; UI — только у преподавателя); STUDENT, STAROSTA (запись/снятие записи).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/teacher/consultations`, `/consultations`; очередь `notifications`, jobs `CONSULTATION_BOOKED`, `CONSULTATION_CANCELLED`.
- Завершение: слот OPEN → BOOKED (условный `updateMany` только из OPEN, гонка → `409`) (уведомление преподавателю) → отмена студентом возвращает OPEN, отмена/удаление преподавателем → CANCELLED + уведомление записанному студенту; прошедший слот записать нельзя; аудит.
- Шаги и файлы: `apps/api/src/modules/consultations/consultations.controller.ts`, `consultations.service.ts` (`createSlot`, `deleteSlot`, `listMine` + `slotOrderBy`, `listTeachers`, `listTeacherSlots`, `book`, `cancel`); `GET /consultations/mine`, `GET /consultations/teachers`, `GET /consultations/slots?teacherId=`, `POST /consultations/slots`, `DELETE /consultations/slots/:id`, `POST /consultations/slots/:id/book|cancel`; web `apps/web/src/views/consultations/ui/{teacher-consultations-view,create-slot-modal,student-consultations-view,book-slot-modal}.tsx`, `apps/web/src/entities/consultation/api/consultation-api.ts`; схема `prisma/schema/22-consultations.prisma`.
- Данные на входе / выходе: `{startsAt,endsAt,location?,isOnline?}`; `{topic?}` → `ConsultationSlot` (OPEN|BOOKED|CANCELLED); `mine` — `Paginated` с серверной сортировкой `startsAt|status|student`.
- Внешние зависимости: Redis/BullMQ (уведомления, время в таймзоне вуза); `AuditService`.
- Тесты: `apps/api/src/modules/consultations/consultations.service.spec.ts` (сортировка, гонка записи, удалённый преподаватель, отмена отменённого).
- Замечено: при создании слота не проверяются пересечения с другими слотами и парами преподавателя и дата в прошлом (схема сверяет только `endsAt > startsAt`); напоминаний перед консультацией нет.

### C-19 Запись в деканат (очередь приёма)

- Бизнес-цель: студент просит приём в деканате (консультация, документы, учебный вопрос) на желаемое время; сотрудник деканата подтверждает/переносит с точным временем, завершает или отменяет приём.
- Роли: STUDENT, STAROSTA (заявка, отмена своей); DEAN (UI), UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR, PLATFORM_ADMIN (через API).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/appointments` (студент), `/dean/appointments` (очередь факультета); очередь `notifications`, job `APPOINTMENT_UPDATED`.
- Завершение: статусы по таблице `TRANSITIONS` — REQUESTED → CONFIRMED/RESCHEDULED → COMPLETED, отмена из любого незавершённого; COMPLETED/CANCELLED конечные (иначе `409`); при подтверждении назначается `assignedToId`, студенту — уведомление со временем в поясе вуза; аудит.
- Шаги и файлы: `apps/api/src/modules/appointments/appointments.controller.ts`, `appointments.service.ts` (`create` — факультет из JWT, `listMine` take 200, `cancelMine`, `listQueue` take 300, `confirm`, `setStatus`, `assertTransition`, `scopeWhere`); `POST /deanery-appointments`, `GET /deanery-appointments/mine`, `POST /deanery-appointments/:id/cancel`, `GET /deanery-appointments/queue`, `POST /deanery-appointments/:id/{confirm,reschedule,complete,staff-cancel}`; web `apps/web/src/views/appointments/ui/{student-appointments-view,create-appointment-modal,dean-appointments-view,confirm-appointment-modal}.tsx`, `apps/web/src/entities/appointment/api/appointment-api.ts`; схема `prisma/schema/23-appointments.prisma`.
- Данные на входе / выходе: `{type CONSULTATION|DOCUMENT|ACADEMIC|OTHER,requestedAt,topic?,applicationId?}`; `{scheduledAt,staffNote?}` → `DeaneryAppointment`.
- Внешние зависимости: Redis/BullMQ (уведомления); `AuditService`.
- Тесты: `apps/api/src/modules/appointments/appointments.service.spec.ts` (переходы статусов, условное подтверждение, пояс вуза).
- Замечено: о новой заявке деканат не уведомляется (только опрос очереди); `applicationId` — мягкая ссылка без FK и без проверки, что заявка принадлежит студенту, а в UI создания поле не передаётся.

### C-20 Учебные материалы курса: публикация и скачивание

- Бизнес-цель: преподаватель выкладывает группе материалы (описание, внешняя ссылка, файлы), студенты группы видят их на странице дисциплины и скачивают по подписанной ссылке.
- Роли: TEACHER (свои материалы, группы своего вуза), DEAN (факультет), UNIVERSITY_ADMIN, PLATFORM_ADMIN — публикуют/удаляют; STUDENT, STAROSTA — читают материалы своей группы.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): UI `/teacher/materials` (создание, загрузка файлов, удаление), студент — вкладка «Материалы» в `/courses/[subject]`; cron `CleanupService` чистит файлы без материала.
- Завершение: `Material` создан, файлы привязаны (`File.materialId`, бакет `MINIO_BUCKET_MATERIALS`); удаление материала → у файлов `materialId = null`, объекты удаляет cron; аудит.
- Шаги и файлы: `apps/api/src/modules/materials/materials.controller.ts`, `materials.service.ts` (`create`, `list` take 200 + `scopeWhere`, `presignFile`, `confirmFile`, `addFile`, `getFileUrl` + `MediaService.describeOne`, `remove`); `GET|POST /materials`, `POST /materials/:id/files/presign`, `POST /materials/:id/files/confirm`, `POST /materials/:id/files` (multipart), `GET /materials/:id/files/:fileId/presigned`, `DELETE /materials/:id`; `apps/api/src/modules/files/file.service.ts`, `apps/api/src/modules/cleanup/cleanup.service.ts`; web `apps/web/src/views/materials/ui/{materials-view,create-material-modal,material-detail-modal}.tsx`, `apps/web/src/views/courses/ui/material-row.tsx`, `apps/web/src/entities/material/api/material-api.ts`; схема `prisma/schema/12-materials.prisma`.
- Данные на входе / выходе: `{groupId,title,description?,subject?,url?}` + файлы (presign `{mime}` → PUT в MinIO → confirm) → `Material` с `media[]`; выдача — подписанный URL + описание медиа.
- Внешние зависимости: MinIO (presigned PUT/GET), медиа-система (`MediaService`, варианты/превью), cron очистки.
- Тесты: `apps/api/src/modules/materials/materials.service.spec.ts` (scope чтения, создание в чужом вузе, удаление чужого, `getFileUrl`); `apps/api/src/modules/files/file.service.spec.ts` (привязка файла к материалу).
- Замечено: материал привязан к группе и свободной строке `subject`, а не к `Course` — на странице дисциплины склейка по названию; редактирования материала (PATCH) нет; группа о новом материале не уведомляется.

## Группа D — Услуги, документы, карьера, модерация

### D-01 Каталог услуг вуза и шаблоны платформы

- Бизнес-цель: дать вузу настраиваемый каталог услуг (категория → услуга → чек-лист документов + динамическая форма), а платформе — глобальные шаблоны, которые вуз может «настроить под себя» копией.
- Роли: UNIVERSITY_ADMIN (услуги своего вуза, customize шаблона), PLATFORM_ADMIN (глобальные шаблоны universityId=null); чтение каталога — любой вошедший.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /university-admin/services, /platform-admin/services (views/service-catalog); GET /application-categories, GET /application-categories/manage, GET /application-services/manage(/:id), POST /application-services, PUT /application-services/:id, POST /application-services/:id/customize, GET /application-services/:id.
- Завершение: услуга сохранена (убранные требования/поля выключаются active=false, не удаляются); копия шаблона с тем же code скрывает шаблон для студентов вуза; AuditLog.
- Шаги и файлы: apps/api/src/modules/application-services/application-services.controller.ts; catalog.service.ts (listCategories/getService); catalog-admin.service.ts (create/update/customize, syncRequirements/syncFormFields, assertCodeFree); service-visibility.ts (visibleServicesWhere — затенение шаблона кодом); application.policy.ts ('manage-services'); web: apps/web/src/views/service-catalog/ui/{service-catalog-view,service-editor-modal,requirements-editor,form-fields-editor}.tsx; entities/application-service/api/catalog-admin-api.ts.
- Данные на входе / выходе: UpsertApplicationServiceDto (code, nameRu/Kk/En, slaHours, deliveryModes, requiresPickup, processingMode, requirements[], formFields[]) → { id }; ApplicationCategory/ApplicationService/ServiceRequirement/ServiceFormField.
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/application-services/catalog-admin.service.spec.ts; service-visibility.spec.ts; apps/web/src/entities/application-service/lib/localize.test.ts.
- Замечено: catalog.service.ts listCategories — вложенная выборка services без take (потолок только на категории).

### D-02 Подача заявки студентом: черновик, форма, документы, отправка, отзыв, повторная отправка

- Бизнес-цель: студент заказывает услугу онлайн и приходит в деканат только за готовым результатом.
- Роли: STUDENT, STAROSTA (те же права студента).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /applications, /applications/[id], /starosta/applications (widgets/applications: create-wizard, student-applications-view, application-detail, document-checklist); POST /applications, PATCH /applications/:id, POST /applications/:id/documents, DELETE /applications/:id/documents/:requirementId, POST /applications/:id/submit, POST /applications/:id/cancel, POST /applications/:id/resubmit, GET /applications, GET /applications/:id, GET /applications/:id/documents/:docId/url, GET /applications/:id/results/:resultId/url.
- Завершение: DRAFT → SUBMITTED с номером SH-YYYY-NNNNNN (год по таймзоне вуза) и dueAt = now + slaHours; либо CANCELLED (до подготовки); NEEDS_CORRECTION → RESUBMITTED после замены всех REPLACEMENT_REQUIRED документов.
- Шаги и файлы: apps/api/src/modules/application-services/applications.controller.ts; applications.service.ts (createDraft с visibleServicesWhere и facultyScoped→facultyId, updateDraft, submit: assertDeliveryAllowed/assertFormValid/assertRequiredDocuments + withNumberRetry, cancel, resubmit, list/getById со scopeWhere); application-documents.service.ts (attach документа из хранилища «Документы», remove, presignedUrl, resultUrl); application.policy.ts; переходы — @studenthub/shared-schemas APPLICATION_TRANSITIONS; web: apps/web/src/widgets/applications/ui/*.tsx, entities/application-service/api/application-service-api.ts.
- Данные на входе / выходе: serviceId, deliveryType (ELECTRONIC|PAPER), formData(Json), documentId на requirementId → Application + ApplicationDocument + ApplicationEvent (timeline).
- Внешние зависимости: PostgreSQL; MinIO (presigned через FilesModule).
- Тесты: apps/api/src/modules/application-services/applications.service.spec.ts; application-documents.service.spec.ts; application.policy.spec.ts; apps/web/e2e/applications.e2e.ts (подача студентом).
- Замечено: submit/resubmit обновляют заявку `where: { id }` без статуса (в отличие от cancel/transition с rethrowStaleStatus) и не уведомляют обработчиков о новой заявке.

### D-03 Обработка заявки деканатом/администрацией вуза

- Бизнес-цель: сотрудник в своей области (факультет/вуз) берёт заявку, проверяет документы, запрашивает исправление или отклоняет, готовит и выдаёт результат в срок SLA.
- Роли: DEAN (scope факультета), UNIVERSITY_MODERATOR и UNIVERSITY_ADMIN (scope вуза); PLATFORM_ADMIN — только чтение всех; студент получает уведомления.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /dean/applications, /university-admin/applications (widgets/applications: dean-applications-view, staff-workspace, result-modal); GET /applications/queue-stats, POST /applications/:id/{take,assign,request-correction,start-preparation,reject,results,mark-ready,issue,deliver}, GET /applications/:id/assignees, POST /applications/:id/documents/:docId/{accept,request-replacement}.
- Завершение: READY/READY_FOR_PICKUP → DELIVERED/ISSUED либо REJECTED; результат-документ выдан в кабинет студента (Document issuedByUniversity).
- Шаги и файлы: apps/api/src/modules/application-services/application-process.service.ts (take/assign/assignees, transition с оптимистичной блокировкой по статусу + ApplicationEvent, addResult → documents.issueToOwner с проверкой isOwnedBy, markReady/issue/deliver, queueStats); application-documents.service.ts (review accept/request-replacement → NEEDS_CORRECTION); application.policy.ts (canProcess); уведомления — очередь notifications, job APPLICATION_UPDATED (type APP_UPDATE, dedupeKey по id события) + realtime applicationStatusChanged владельцу.
- Данные на входе / выходе: комментарий/причина, AddResultDto (type, documentId | fileId+documentType, documentNumber, note), MarkReadyDto → Application (startedAt/readyAt/issuedAt, assignedToId), ApplicationResult, ApplicationEvent.
- Внешние зависимости: PostgreSQL, BullMQ/Redis (notifications), WebSocket (RealtimeGateway), MinIO (файл результата).
- Тесты: apps/api/src/modules/application-services/application-process.service.spec.ts; application-documents.service.spec.ts; application.policy.spec.ts; apps/web/e2e/applications.e2e.ts (декан «Взять в работу»).
- Замечено: у UNIVERSITY_MODERATOR по ApplicationPolicy есть право process, но в UNIVERSITY_MODERATOR_NAV и под /moderator/university нет экрана заявок; просрочка SLA только фильтр/счётчик, без уведомлений/cron.

### D-04 Справка об обучении: выпуск с кодом проверки и отзыв

- Бизнес-цель: платформа сама формирует PDF-справку из данных студента с QR/кодом проверки вместо загрузки скана сотрудником; при ошибке — отзыв, после которого проверка показывает «отозван».
- Роли: DEAN, UNIVERSITY_MODERATOR, UNIVERSITY_ADMIN (право process на заявку); STUDENT получает документ.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): result-modal / staff-workspace в /dean/applications, /university-admin/applications; POST /applications/:id/results/certificate?locale=, POST /applications/:id/results/certificate/revoke.
- Завершение: запись DocumentExport (kind=certificate, shortId) → PDF → Document студента + ApplicationResult; отзыв — revokedAt в журнале + ApplicationEvent RESULT_REVOKED (файл у студента остаётся).
- Шаги и файлы: apps/api/src/modules/application-services/application-process.service.ts (issueStudyCertificate: проверка IN_PREPARATION и hasActiveDocument → users.academicSubject → exports.register (сбой журнала отменяет выдачу) → renderAndIssue; при ошибке рендера revokeByShortId; revokeStudyCertificate → revokeByDocumentNumber); study-certificate-pdf.ts, study-certificate-labels.ts; apps/api/src/common/export/export-registry.service.ts; export-branding.service.ts; apps/api/src/common/qr/qr-raster.ts.
- Данные на входе / выходе: id заявки, locale (ru/kk/en), reason → { documentId, verificationCode } / { revoked }.
- Внешние зависимости: PostgreSQL, MinIO (файл PDF), генерация PDF/QR, APP_PUBLIC_URL (ссылка в бланке).
- Тесты: apps/api/src/modules/application-services/application-process.service.spec.ts (issueStudyCertificate); apps/api/src/common/export/export-registry.service.spec.ts; revokeStudyCertificate тестами не покрыт.
- Замечено: revokeStudyCertificate не пишет уведомление студенту и не проверяет статус заявки (можно отозвать после DELIVERED — вероятно, намеренно).

### D-05 Обращения группы для старосты (только чтение)

- Бизнес-цель: староста видит заявки студентов своей группы, чтобы напоминать и помогать, без права обработки.
- Роли: STAROSTA.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /starosta/group-requests (widgets/applications/ui/starosta-group-requests-view.tsx); GET /applications/group-requests (@Roles STAROSTA).
- Завершение: отображён список заявок группы с фильтрами.
- Шаги и файлы: apps/api/src/modules/application-services/applications.controller.ts (groupRequests); applications.service.ts listGroupRequests; apps/web/src/entities/application-service/api/application-service-api.ts.
- Данные на входе / выходе: ApplicationQueryDto (фильтры, пагинация) → ApplicationListItem[] без черновиков (where student.groupId = groupId из JWT).
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/application-services/applications.service.spec.ts (describe listGroupRequests).

### D-06 Проверка подлинности документа по QR/коду

- Бизнес-цель: третья сторона (банк, работодатель, посольство) без аккаунта сверяет справку по короткому коду из бланка: действительна / отозвана / не официальный документ.
- Роли: гость (публично); любой вошедший.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /verify/[code] (публичный путь в apps/web/src/middleware.ts) → views/verify-document/ui/verify-document-view.tsx; GET /verify/:code (@Public, throttle 20/мин).
- Завершение: показаны тип (certificate или «не официальный документ»), номер, выдавший вуз, ФИО в маске, дата, статус VALID/REVOKED; иначе 404 одинаковый для любых «чужих» кодов.
- Шаги и файлы: apps/api/src/common/export/export-verify.controller.ts; apps/api/src/common/export/export-registry.service.ts (findByShortId, maskName); apps/web/src/app/verify/[code]/page.tsx.
- Данные на входе / выходе: code (8 символов без похожих) → { code, kind, number, issuer, subject(маска), issuedAt, revokedAt, status }.
- Внешние зависимости: PostgreSQL (DocumentExport).
- Тесты: apps/api/src/common/export/export-registry.service.spec.ts (генерация кода, без findByShortId); контроллер и страница проверки — нет.
- Замечено: в журнале DocumentExport лежат и рабочие выгрузки (резюме, отчёты, чаты, данные пользователя) — их коды тоже резолвятся публично (скупо, с пометкой «не официальный»).

### D-07 Личное хранилище документов: загрузка, страницы, правка, архив, удаление

- Бизнес-цель: защищённое хранилище личных документов (паспорт, дипломы, справки) для переиспользования в заявках и ответах на запросы вуза; полный номер наружу не отдаётся.
- Роли: все вошедшие (основной пользователь — STUDENT/STAROSTA; пункт «Документы» в навигации у всех ролей).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /documents (views/documents: documents-view → overview-panel, documents-list, upload-wizard, doc-modal, document-actions); POST /documents/upload (multipart), POST /documents/upload/presign + PUT в MinIO + POST /documents/upload/confirm, POST /documents, POST /documents/:id/files, PATCH /documents/:id/files/order, GET /documents, GET /documents/overview, GET/PATCH /documents/:id, POST /documents/:id/{archive,unarchive}, DELETE /documents/:id.
- Завершение: Document (status UPLOADED…) с прикреплёнными File (страницы), маска номера numberMasked; архив/мягкое удаление с DocumentEvent.
- Шаги и файлы: apps/api/src/modules/documents/documents.controller.ts; documents.service.ts (uploadFile/presignFile/confirmFile — только PDF/JPG/PNG, attachFiles, reorderFiles, create с assertType → DocumentTypesService.resolveUsable, mask/last4, list/overview, setArchived, remove, logEvent); apps/web/src/entities/document/api/document-api.ts; entities/document/ui/document-file-viewer.tsx.
- Данные на входе / выходе: файл (PDF/JPG/PNG), CreateDocumentDto (category, type, title, number, issuedAt, expiresAt) → DocumentDto (numberMasked, files, status).
- Внешние зависимости: MinIO (бакет documents, presigned PUT/GET), PostgreSQL.
- Тесты: apps/api/src/modules/documents/documents.service.spec.ts; apps/web/e2e/applications.e2e.ts (загрузка удостоверения через мастер).
- Замечено: upload-wizard.tsx берёт типы из статического DOCUMENT_TYPES — выключенные вузом типы падают на сервере BAD_REQUEST, а custom-типы вуза студенту недоступны (GET /document-types только UNIVERSITY_ADMIN).

### D-08 Доступ к документу третьим лицам и журнал просмотров

- Бизнес-цель: владелец открывает документ деканату/вузу/конкретному человеку на срок и с причиной, может отозвать; каждое открытие файла фиксируется.
- Роли: владелец (выдаёт/отзывает); получатели — USER (любой пользователь), DEPARTMENT (только DEAN этого факультета), UNIVERSITY (UNIVERSITY_ADMIN/MODERATOR, DEAN того же вуза).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /documents (вкладка «Управление доступом» = DocumentsList preset="shared"; AccessModal в document-actions.tsx); GET/POST /documents/:id/access, DELETE /documents/:id/access/:accessId, GET /documents/:id/events, GET /documents/:id/files/:fileId/url?download=1.
- Завершение: DocumentAccess создан/отозван (revokedAt); presigned-URL выдан владельцу (событие DOWNLOAD) или держателю активного гранта (событие VIEW); чужому — 404.
- Шаги и файлы: apps/api/src/modules/documents/documents.service.ts (grantAccess, listAccess, revokeAccess, getFileUrl, hasActiveGrant, listEvents); apps/web/src/views/documents/ui/{document-actions,documents-list}.tsx.
- Данные на входе / выходе: GrantAccessDto (granteeType UNIVERSITY|DEPARTMENT|USER, granteeId, reason, expiresAt) → список грантов с active; DocumentEvent (GRANT/REVOKE/VIEW/DOWNLOAD).
- Внешние зависимости: MinIO (presigned GET), PostgreSQL.
- Тесты: apps/api/src/modules/documents/documents.service.spec.ts (describe «доступ (15.11)»).
- Замечено: у получателя гранта нет ни эндпоинта, ни экрана «документы, открытые мне» — воспользоваться грантом можно только зная id документа и файла; уведомления о выдаче гранта нет.

### D-09 Запросы документов от вуза: адресация, ответ студента, проверка комплекта

- Бизнес-цель: деканат/студофис/преподаватель запрашивают у студентов комплект документов (чек-лист), студенты отвечают из своего хранилища, сотрудник проверяет по позициям.
- Роли: DEAN (свой факультет/группы/студенты), UNIVERSITY_MODERATOR (весь вуз), TEACHER (группы своих дисциплин, только ACADEMIC-типы) — создают и проверяют; STUDENT/STAROSTA — отвечают.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /documents (вкладка «Запросы университета»: requests-panel → staff-requests / student-requests); POST /document-requests, GET /document-requests/authored, GET /document-requests/manage/:id, GET /document-requests/submissions/:submissionId, GET /document-requests/submission-items/:itemId/files/:fileId/url, PATCH /document-requests/submission-items/:itemId/review, POST /document-requests/submissions/:submissionId/finalize, GET /document-requests, GET /document-requests/:id, PUT /document-requests/:id/submission, POST /document-requests/:id/submit.
- Завершение: DocumentSubmission → SUBMITTED → ACCEPTED | REJECTED | PARTIAL; студент уведомлён о результате.
- Шаги и файлы: apps/api/src/modules/documents/document-requests.controller.ts; document-requests.service.ts (createRequest + assertTargetsInScope (WRONG_SCOPE) + resolveTargetStudentIds → очередь DOCUMENT_REQUEST; saveSubmission (документы только свои), submitSubmission (все обязательные позиции), reviewItem, finalizeSubmission → DOCUMENT_RESULT; getSubmissionFileUrl с событием VIEW); apps/web/src/entities/document-request/api/document-request-api.ts.
- Данные на входе / выходе: title, dueAt, items[{documentType, required}], targets[{UNIVERSITY|FACULTY|GROUP|USER, targetId}] → DocumentRequest(+Item/Target); ответ items[{requestItemId, documentId}] → DocumentSubmission(+Item), вердикт ACCEPTED|REJECTED + rejectionReason.
- Внешние зависимости: PostgreSQL, BullMQ/Redis (notifications), MinIO (presigned).
- Тесты: apps/api/src/modules/documents/document-requests.service.spec.ts.
- Замечено: статус запроса CLOSED нигде не выставляется и dueAt не применяется; saveSubmission не проверяет статус комплекта — после ACCEPTED студент может подменить документ, а комплект останется ACCEPTED; о сдаче комплекта сотрудник не уведомляется.

### D-10 Каталог типов документов вуза

- Бизнес-цель: вуз поверх 25 статических типов из @studenthub/shared-config включает/выключает типы, задаёт срок хранения (retentionDays) и добавляет собственные типы.
- Роли: UNIVERSITY_ADMIN.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /university-admin/document-types (views/document-types: document-types-admin-view, create-document-type-modal); GET /document-types, POST /document-types, PATCH /document-types/:typeId, DELETE /document-types/:typeId.
- Завершение: эффективный каталог (статика + правки DocumentType) возвращён и используется при создании документов/запросов (resolveUsable) и архивации (retentionDays).
- Шаги и файлы: apps/api/src/modules/documents/document-types.controller.ts (@Roles UNIVERSITY_ADMIN); document-types.service.ts (effective, resolveUsable, retentionDays, updateType, addCustom, remove); apps/web/src/entities/document-type/api/document-type-api.ts.
- Данные на входе / выходе: { code, category, name } / { enabled, retentionDays } → EffectiveDocumentType[].
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/documents/document-types.service.spec.ts.
- Замечено: эффективный каталог не отдаётся студентам и сотрудникам (см. D-07) — UI загрузки его не учитывает.

### D-11 Истечение срока документов и архивирование по сроку хранения

- Бизнес-цель: предупредить владельца о скором истечении документа, пометить просроченные и убрать их в архив по retentionDays вуза.
- Роли: система; уведомления — владелец документа.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): cron sweepDocumentExpiry ('30 3 * * *') в apps/api/src/modules/cleanup/cleanup.service.ts под cron-lock.
- Завершение: status → EXPIRING / EXPIRED, затем ARCHIVED (archivedAt) при expiresAt + retentionDays; DocumentEvent EXPIRE/ARCHIVE; уведомление DOCUMENT_EXPIRING.
- Шаги и файлы: apps/api/src/modules/documents/documents.service.ts (sweepExpiry → sweepStage, sweepRetention — одна пачка за прогон); document-types.service.ts retentionDays; apps/api/src/common/redis/cron-lock.service.ts.
- Данные на входе / выходе: Document.expiresAt, DocumentType.retentionDays → статусы, события, задачи в очереди notifications.
- Внешние зависимости: PostgreSQL, Redis (cron-lock, BullMQ).
- Тесты: apps/api/src/modules/documents/documents.service.spec.ts (sweepExpiry); apps/api/src/modules/cleanup/cleanup.service.spec.ts.

### D-12 Спец-режим доступа платформенного админа к документу

- Бизнес-цель: по обоснованному поводу (жалоба, запрос органов) админ платформы открывает чужой документ только с обязательной причиной и полным следом в аудите.
- Роли: PLATFORM_ADMIN.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /platform-admin/document-access (views/platform-documents/ui/platform-documents-view.tsx); GET /documents/:id/platform, POST /documents/:id/platform-access.
- Завершение: метаданные документа / пачка presigned-URL (1..50 файлов) выданы; DocumentEvent VIEW (platformMode) + AuditLog DOCUMENT_PLATFORM_VIEW / DOCUMENT_PLATFORM_DOWNLOAD (одна запись на пачку с metadata.fileIds).
- Шаги и файлы: apps/api/src/modules/documents/documents.controller.ts (@Roles PLATFORM_ADMIN); documents.service.ts (platformGet, platformFileUrls — чужой файл в пачке = отказ целиком); dto/platform-access.dto.ts; apps/api/src/common/audit/audit.service.ts.
- Данные на входе / выходе: docId, { fileIds[], reason } → DocumentDto / { urls: Record<fileId, url> }.
- Внешние зависимости: MinIO (presigned), PostgreSQL.
- Тесты: apps/api/src/modules/documents/documents.service.spec.ts (platformFileUrls).
- Замечено: GET /documents/:id/platform открывает метаданные без причины (причина обязательна только для файлов).

### D-13 Выгрузка своих персональных данных

- Бизнес-цель: по праву субъекта ПДн дать человеку машиночитаемый архив всего, что о нём хранит платформа (без ключей доступа и чужих данных).
- Роли: любой вошедший пользователь (все роли, включая EMPLOYER).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /settings → блок «Приватность» (widgets/account-settings/ui/account-settings-panels.tsx, mutation exportMyData); GET /me/export?locale= (throttle 3/час).
- Завершение: JSON-файл отдан с Content-Disposition; AuditLog personal_data_export + запись DocumentExport (kind=my-data, shortId).
- Шаги и файлы: apps/api/src/modules/data-export/data-export.controller.ts; data-export.service.ts (exportPersonalData → collect: ~20 разделов по userId, потолок SECTION_LIMIT=5000 + флаг truncated, AUDIT_LIMIT=2000; маска номера документа; без passwordHash/2FA/refresh/инвайт-токенов); apps/api/src/common/export/{export-branding,export-registry}.service.ts; apps/web/src/entities/user/api/user-api.ts exportMyData (requestFile).
- Данные на входе / выходе: locale → { generatedAt, platform, subject, notice, account, sections{rows,count,truncated} }.
- Внешние зависимости: PostgreSQL; throttler storage (Redis).
- Тесты: apps/api/src/modules/data-export/data-export.service.spec.ts.
- Замечено: выгрузка собирается синхронно в памяти запроса (до 5000 строк × ~20 разделов) — без очереди и фоновой сборки.

### D-14 Подача жалобы на контент или пользователя

- Бизнес-цель: участник сообщества сообщает о нарушении (пост, комментарий, сторис, сообщение, человек); срочные жалобы сразу доходят до команды платформы.
- Роли: STUDENT, STAROSTA, TEACHER (@Roles на POST /complaints); получатели сигнала — команда платформы в Telegram.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): лента — features/report-content/ui/report-modal.tsx из widgets/feed-list/ui/post-tile-menu.tsx (POST) и post-lightbox.tsx (COMMENT); POST /complaints (throttle 10/час).
- Завершение: Complaint PENDING с priority, выведенным из типа цели (USER — HIGH), и universityId цели; AuditLog complaint_created; при HIGH — TelegramNotifyService.notifyStaff с кнопкой «беру».
- Шаги и файлы: apps/api/src/modules/complaints/complaints.controller.ts; complaints.service.ts (create → getTarget (истёкшая сторис = NOT_FOUND; на сообщение — только участник чата, иначе 404), complaintPriorityFor из @studenthub/shared-schemas, announceIfUrgent); apps/api/src/common/telegram/telegram-notify.service.ts; apps/web/src/entities/complaint/api/complaint-api.ts.
- Данные на входе / выходе: CreateComplaintSchema { targetType, targetId, reason } → Complaint.
- Внешние зависимости: PostgreSQL, Telegram Bot API, throttler storage.
- Тесты: apps/api/src/modules/complaints/complaints.service.spec.ts (create, приоритет, жалоба на сообщение, уведомление команды).
- Замечено: веб даёт пожаловаться только на POST и COMMENT (MESSAGE/USER/STORY — ни в вебе, ни в iOS/Android), а пункт «Пожаловаться» показывается любой роли, хотя DEAN/админам/EMPLOYER сервер ответит 403.

### D-15 Разбор жалоб модератором: решение, блокировка, предупреждение, повторный разбор

- Бизнес-цель: модерация в своём scope разбирает очередь жалоб и применяет меру: снять контент, заблокировать (со сроком или бессрочно), предупредить автора или отклонить; автор жалобы узнаёт итог.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR (все вузы), UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR (свой вуз); снимать контент можно только у автора ниже по роли.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /moderator/university/complaints, /moderator/platform/complaints, /university-admin/complaints, /platform-admin/complaints (views/moderation: complaints-queue-view, complaint-detail-modal); мини-апп screens/complaints.tsx; GET /complaints, GET /complaints/:id, GET /complaints/:id/messages, PATCH /complaints/:id/{take,resolve,reopen}.
- Завершение: Complaint RESOLVED/DISMISSED (resolvedById, resolution); побочный эффект (soft delete поста/комментария/сообщения, физическое удаление сторис через StoriesService.removeByModeration, users.setBlocked с разрывом сессий, ModerationWarning + уведомление MODERATION_WARNING); уведомление автору COMPLAINT_RESOLVED; опционально закрытие дублей; AuditLog.
- Шаги и файлы: apps/api/src/modules/complaints/complaints.service.ts (list/getById со scopeWhere и findScoped → WRONG_SCOPE, take — атомарно по reviewingById: null, resolve, closeDuplicates, reopen (побочные действия не откатываются), getMessageContext — чат по жалобе с аудитом moderator_chat_access, softDeleteTarget, ownerOf c includeDeleted); apps/api/src/modules/users/users.service.ts (setBlocked, warn); cron liftExpiredBlocks в apps/api/src/modules/cleanup/cleanup.service.ts снимает временные блокировки.
- Данные на входе / выходе: ResolveComplaintSchema { action DELETE_CONTENT|BLOCK_USER|WARN_USER|DISMISS, comment, blockDays, applyToDuplicates } → Complaint; ComplaintListQuery (status, priority, sort) → Paginated.
- Внешние зависимости: PostgreSQL, BullMQ/Redis (notifications), Telegram (квитирование из уведомления).
- Тесты: apps/api/src/modules/complaints/complaints.service.spec.ts (scope, resolve, reopen, take, getMessageContext); apps/api/test/complaints.e2e-spec.ts (доступ к чату по жалобе, чужой вуз); apps/api/src/modules/users/users.service.spec.ts (warn).
- Замечено: resolve проверяет статус чтением, а пишет `update where: { id }` без статуса — два одновременных решения выполнят меру (блок/предупреждение) дважды; resolve не проверяет, кто взял жалобу через take.

### D-16 Разбор обращений в поддержку платформы и заведение жалобы из обращения

- Бизнес-цель: команда платформы отвечает на обращения пользователей (текст/голос), тегирует, склеивает, эскалирует и закрывает их; из обращения можно завести жалобу от имени автора.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR (разбор); любой пользователь — автор обращения.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /platform-admin/support, /moderator/platform/support (views/support-desk: support-desk-view, support-thread-modal); мини-апп screens/support.tsx; GET /support, GET /support/tags, GET /support/:id, POST /support/:id/{reply,voice,merge,escalate}, PATCH /support/:id/{assign,tags,close}; POST /complaints/from-support; cron closeStaleTickets ('0 5 * * *').
- Завершение: обращение закрыто (переписка остаётся) или жалоба заведена с автором = автор обращения и текстом из первого сообщения.
- Шаги и файлы: API живёт в модуле chats — apps/api/src/modules/chats/support.controller.ts, support.service.ts; apps/api/src/modules/complaints/complaints.service.ts createFromSupport; apps/web/src/entities/support-ticket/api/support-ticket-api.ts; apps/web/src/views/support-desk/ui/tag-label.ts.
- Данные на входе / выходе: text / audio multipart / tags[≤3] / intoId → SupportThread, SupportMessage; { chatId, targetId } → Complaint.
- Внешние зависимости: PostgreSQL, MinIO (голосовые), Telegram (дежурство/эскалация).
- Тесты: apps/api/src/modules/chats/support.service.spec.ts; apps/api/src/modules/complaints/complaints.service.spec.ts (createFromSupport).
- Замечено: POST /complaints/from-support вызывается только из мини-аппа (apps/mini-app/src/api/complaints.ts) — в веб-support-desk такого действия нет.

### D-17 Дашборд модератора вуза и журнал действий модерации

- Бизнес-цель: модератор вуза видит состояние очереди (сколько ждёт, что горит, на что жалуются, что сделано) и журнал своих действий.
- Роли: UNIVERSITY_MODERATOR (дашборд); журнал — PLATFORM_ADMIN, PLATFORM_MODERATOR, UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR (по scope).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /moderator/university (views/moderator-dashboard/ui/university-moderator-dashboard.tsx), /moderator/university/audit, /moderator/platform/audit (views/moderation/ui/audit-view.tsx); GET /complaints, GET /users, GET /audit.
- Завершение: отрисованы счётчики очереди, разбивка по типам цели, график по дням и лента действий.
- Шаги и файлы: apps/web/src/views/moderator-dashboard/ui/university-moderator-dashboard.tsx (агрегаты считаются на клиенте по первым 200 записям); apps/web/src/entities/audit/api/audit-api.ts; apps/api/src/common/audit/audit.controller.ts (API не из группы D).
- Данные на входе / выходе: страницы жалоб/пользователей/аудита → клиентские агрегаты.
- Внешние зависимости: PostgreSQL.
- Тесты: нет.
- Замечено: отдельного агрегирующего эндпоинта нет — при очереди больше 200 записей цифры дашборда неполные.

### D-18 Саморегистрация работодателя, подтверждение email и профиль компании

- Бизнес-цель: внешняя компания сама заводит аккаунт (единственное исключение из «только по инвайтам»), подтверждает корпоративный email и ведёт профиль компании.
- Роли: гость → EMPLOYER (владелец компании).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /employer/signup, /employer/verify?token= (views/employer: employer-signup-view, employer-verify-view; публичные пути в middleware.ts), /employer/company (employer-company-view); POST /career/companies/signup (@Public, 5/15 мин), POST /career/companies/verify-email (@Public, 10/15 мин), POST /career/companies/resend-verification (@Public, 3/15 мин), GET|PATCH /career/companies/me (EMPLOYER).
- Завершение: Company PENDING_EMAIL + User EMPLOYER (без scope вуза, profileVisibility=PRIVATE) → после перехода по ссылке Company ACTIVE, токен погашен; AuditLog.
- Шаги и файлы: apps/api/src/modules/career/companies.controller.ts; companies.service.ts (signup — занятый email даёт тот же ответ без создания, токен 32 байта хранится хэшем, срок сутки → очередь EMAIL job SEND_COMPANY_VERIFICATION; resendVerification — одинаковый 202 для любого адреса; verifyEmail; myCompany/updateMyCompany с assertOwner; uniqueSlug); apps/web/src/entities/company/api/*.
- Данные на входе / выходе: EmployerSignupDto (email, password, firstName, lastName, companyName, website) → { email }; { token } → { companyId }; UpdateCompanyDto → карточка компании.
- Внешние зависимости: PostgreSQL, BullMQ/Redis (очередь email), SMTP (письмо со ссылкой), throttler storage.
- Тесты: apps/api/src/modules/career/companies.service.spec.ts; apps/api/test/career.e2e-spec.ts («регистрация и подтверждение email»).

### D-19 Допуск компании к студентам вуза: заявка, решение, отзыв с каскадом

- Бизнес-цель: компания получает доступ к студентам конкретного вуза только с его одобрения; отзыв действует немедленно и снимает её вакансии в этом вузе.
- Роли: EMPLOYER (заявка); UNIVERSITY_ADMIN, PLATFORM_ADMIN (решение); UNIVERSITY_MODERATOR, PLATFORM_MODERATOR, DEAN (только чтение очереди).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /employer/access (employer-access-view); /career/companies (views/career/ui/career-companies-view.tsx, вуз — query-параметр для платформенных ролей); GET /career/companies/me/access, GET /career/companies/me/universities, POST /career/companies/me/access, GET /career/university/companies, PATCH /career/university/companies/:id.
- Завершение: CompanyUniversityAccess REQUESTED → APPROVED (опц. expiresAt) | REJECTED | REVOKED; при REVOKED в той же транзакции все VacancyUniversityReview компании в этом вузе (PENDING/APPROVED) → REJECTED с причиной; кэш допусков сброшен; AuditLog company_access_*.
- Шаги и файлы: apps/api/src/modules/career/companies.service.ts (requestAccess — только ACTIVE-компания и ACTIVE-вуз, повтор из REJECTED/REVOKED; universityAccessList; decideAccess с canTransitionAccess и resolveUniversityScope); university-companies.controller.ts; career-access.service.ts (allowedUniversityIds из БД на каждый запрос + Redis-кэш 60 с, invalidate); career-scope.ts.
- Данные на входе / выходе: { universityId, message } → заявка; DecideCompanyAccessDto { status, reason, expiresAt, universityId? } → решение.
- Внешние зависимости: PostgreSQL, Redis (кэш допусков).
- Тесты: apps/api/src/modules/career/companies.service.spec.ts; career-access.service.spec.ts; career-scope.spec.ts; career-roles.spec.ts; apps/api/test/career.e2e-spec.ts («допуск компании к вузу», «отзыв допуска закрывает вакансии»).
- Замечено: ни заявка компании, ни решение вуза никого не уведомляют (нет enqueue — ни админу вуза, ни работодателю); истечение expiresAt не каскадирует на одобренные вакансии (см. D-20).

### D-20 Вакансии: создание, публикация на модерацию вузам, витрина студенту

- Бизнес-цель: компания публикует вакансию, каждый допустивший вуз модерирует её отдельно; студент видит только одобренные своим вузом вакансии с процентом совпадения с профилем.
- Роли: EMPLOYER (CRUD и переходы); UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR, PLATFORM_ADMIN, PLATFORM_MODERATOR (решение), DEAN (чтение очереди); STUDENT/STAROSTA/TEACHER/DEAN/админы вуза/платформенные роли — витрина.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /employer/vacancies (employer-vacancies-view); /career/vacancy-review (career-vacancy-review-view); /career/vacancies (career-vacancies-view, vacancy-detail-modal); GET|POST /career/employer/vacancies, PATCH /career/employer/vacancies/:id, POST /career/employer/vacancies/:id/{publish,pause,close}; GET /career/university/vacancies, PATCH /career/university/vacancies/:id; GET /career/vacancies, GET /career/vacancies/:id.
- Завершение: Vacancy DRAFT → PUBLISHED (ревью PENDING по каждому вузу с активным допуском; повторная публикация сбрасывает решения) → PAUSED/CLOSED; VacancyUniversityReview APPROVED|REJECTED; на витрине — PUBLISHED + APPROVED этим вузом + дедлайн не истёк.
- Шаги и файлы: apps/api/src/modules/career/vacancies.controller.ts; vacancies.service.ts (create/update/assertSalaryRange, publish, setStatus, search с resolveUniversityScope, byIdForStudent, reviewQueue, decide, matchProfile/matchVacancy); apps/web/src/entities/vacancy/api/*; apps/web/src/views/career/lib/salary-text.ts.
- Данные на входе / выходе: VacancyInput (title, description, employmentType, workFormat, experienceLevel, city, salaryMin/Max, skills, deadline) → Vacancy; DecideVacancyDto { status, reason } → ревью; VacancySearchDto → Paginated с match%.
- Внешние зависимости: PostgreSQL, Redis (кэш допусков).
- Тесты: apps/api/src/modules/career/vacancies.service.spec.ts; apps/api/test/career.e2e-spec.ts («публикация и модерация вакансии»).
- Замечено: PATCH опубликованной и одобренной вакансии не сбрасывает ревью в PENDING — новый текст сразу виден студентам без модерации; search/apply не проверяют активность допуска, поэтому после истечения expiresAt одобренные вакансии остаются на витрине; о решении вуза компания не уведомляется.

### D-21 Отклики на вакансии и воронка кандидатов

- Бизнес-цель: студент откликается на одобренную вакансию, компания ведёт его по воронке, студент видит каждый шаг и может отозвать отклик.
- Роли: STUDENT, STAROSTA (отклик, отзыв, история); EMPLOYER (воронка, смена статуса, история).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /career/applications (career-applications-view), /career/vacancies (кнопка отклика); /employer/candidates (employer-candidates-view); GET|POST /career/applications, GET /career/applications/:id/history, POST /career/applications/:id/withdraw; GET /career/employer/applications, PATCH /career/employer/applications/:id.
- Завершение: CareerApplication SUBMITTED → VIEWED → SHORTLISTED → INTERVIEW → OFFER → HIRED | REJECTED | WITHDRAWN; каждый переход — CareerApplicationEvent; студенту уведомление APPLICATION_UPDATED (с причиной отказа).
- Шаги и файлы: apps/api/src/modules/career/applications.controller.ts; applications.service.ts (apply — только PUBLISHED+APPROVED вузом студента и до дедлайна, один отклик на вакансию, universityId фиксируется; listMine; withdraw; history для автора/компании; pipeline; changeStatus с правилами переходов); apps/web/src/entities/career-application/api/*.
- Данные на входе / выходе: { vacancyId, coverLetter } → { id }; ChangeApplicationStatusDto { status, reason } → событие + уведомление.
- Внешние зависимости: PostgreSQL, BullMQ/Redis (notifications).
- Тесты: apps/api/src/modules/career/applications.service.spec.ts; apps/api/test/career.e2e-spec.ts («отклики и воронка», «отзыв допуска закрывает вакансии, но не отклики»).
- Замечено: pipeline/changeStatus не проверяют активный допуск вуза — после отзыва компания по-прежнему видит ФИО, аватар и навыки кандидатов этого вуза, что расходится с «ключевым правилом» Карьеры в PROJECT.md §8.3; о новом отклике компания не уведомляется.

### D-22 Карьерный профиль студента, согласия на передачу данных и карточка кандидата

- Бизнес-цель: студент заполняет карьерный профиль (видимость, статус поиска, ожидания), видит готовность и сам решает, какие поля (GPA, телефон, email) можно отдать всем или конкретной компании; работодатель видит только разрешённое.
- Роли: STUDENT, STAROSTA (профиль и согласия); EMPLOYER (карточка кандидата при активном допуске).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /career/profile (career-profile-view), /career (career-view — готовность); GET|PATCH /career/profile, POST /career/profile/consents, GET /career/profile/candidates/:id (EMPLOYER).
- Завершение: CareerProfile сохранён (смена видимости — отдельное событие аудита); CareerConsent выдано/погашено (не удаляется, повтор не плодит записи); карточка отдана с gpa/phone/email только при согласии, иначе null; каждое открытие — AuditLog.
- Шаги и файлы: apps/api/src/modules/career/career-profile.controller.ts; career-profile.service.ts (myProfile + careerReadiness, updateMyProfile, setConsent, cardForEmployer → CareerAccessService.assertCanAccessUniversity, allowedFields); apps/web/src/entities/career-profile/api/*.
- Данные на входе / выходе: UpdateCareerProfileDto (visibility HIDDEN|EMPLOYERS, employmentStatus, desiredPositions, employmentTypes, workFormats, relocationReady, desiredSalaryMin/Max, about) → профиль + readiness; SetCareerConsentDto { field GPA|PHONE|EMAIL, companyId?, granted } → список согласий.
- Внешние зависимости: PostgreSQL, Redis (кэш допусков).
- Тесты: apps/api/src/modules/career/career-profile.service.spec.ts; apps/api/test/career.e2e-spec.ts («карточка кандидата и согласия»).
- Замечено: GET /career/profile/candidates/:id не вызывается ни одним клиентом (web, iOS, Android, мини-апп) — согласия студент выдаёт, но работодательский экран карточки кандидата их не использует.

### D-23 Резюме из профиля: PDF и публичная ссылка

- Бизнес-цель: собрать резюме из профиля, портфолио и подтверждённых вузом сертификатов; скачать PDF или опубликовать по ссылке (с контактами по желанию).
- Роли: STUDENT, STAROSTA; гость — просмотр по ссылке.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /career/resume (career-resume-view), /r/resume/[slug] (public-resume-view, публичный путь в middleware.ts); GET|PATCH /career/resume, GET /career/resume/pdf, GET /career/resume/public/:slug (@Public, 30/мин).
- Завершение: Resume (title, includeContacts, publicSlug 9 байт base64url + publishedAt либо снят); PDF отдан и зарегистрирован в DocumentExport; публичный JSON без таймзоны.
- Шаги и файлы: apps/api/src/modules/career/resume.controller.ts; resume.service.ts (mine, update, pdf → exports.register, publicBySlug, assemble: User + careerProfile.about + portfolioItems (take 50) + documents CERTIFICATE/VERIFIED (take 30)); resume-pdf.ts; apps/web/src/entities/resume/api/*.
- Данные на входе / выходе: UpdateResumeDto { title, published, includeContacts } → настройки; slug → собранное резюме; locale → PDF.
- Внешние зависимости: PostgreSQL, генерация PDF (export-branding).
- Тесты: apps/api/src/modules/career/resume.service.spec.ts.

### D-24 Карьерные мероприятия вуза

- Бизнес-цель: показать студентам и сотрудникам ярмарки, воркшопы, дни собеседований, презентации компаний и хакатоны своего вуза с отметкой об участии.
- Роли: STUDENT, STAROSTA, TEACHER, DEAN, UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR, PLATFORM_ADMIN, PLATFORM_MODERATOR.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /career/events (views/career/ui/career-events-view.tsx); GET /career/events.
- Завершение: список Event с careerKind ≠ null и признаком участия; регистрация — общим модулем событий.
- Шаги и файлы: apps/api/src/modules/career/career-events.controller.ts; career-events.service.ts (list по universityId, фильтр kind); apps/web/src/entities/career-event/api/*.
- Данные на входе / выходе: CareerEventListQuery { kind, page, limit } → Paginated событий.
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/career/career-events.service.spec.ts.
- Замечено: Event.careerKind выставляет только сид (prisma/seed/steps/80-career.mjs) — ни API модуля events, ни UI не позволяют создать карьерное мероприятие.

### D-25 Карьерная аналитика и отчёт карьерного центра

- Бизнес-цель: вуз видит воронку трудоустройства, очередь модерации, разрыв навыков и периодический отчёт (выгрузка XLSX/CSV); компания — метрики своего подбора.
- Роли: PLATFORM_ADMIN, PLATFORM_MODERATOR, UNIVERSITY_ADMIN, UNIVERSITY_MODERATOR, DEAN (вуз, только агрегаты); EMPLOYER (своя компания).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /career/analytics (views/career/ui/career-analytics-view.tsx); GET /career/analytics/university, GET /career/analytics/university/report, GET /career/analytics/university/report/export?format=xlsx|csv, GET /career/analytics/company.
- Завершение: агрегаты (из Redis-кэша или пересчитаны); файл отчёта с записью в DocumentExport.
- Шаги и файлы: apps/api/src/modules/career/career-analytics.controller.ts; career-analytics.service.ts (computeUniversity, reachedStages, queue, weekly, skillsGap, forCompany, cached); career-report.service.ts (totals, timing, stages, outcomes, faculties, graduates (take 10 000), companies, vacancyCuts, salary, deadVacancies, students, exportReport); career-report.export.ts; apps/api/src/common/export/spreadsheet.builder.ts.
- Данные на входе / выходе: universityId (для платформенных ролей), period → агрегаты/строки отчёта.
- Внешние зависимости: PostgreSQL, Redis (кэш), генерация XLSX.
- Тесты: apps/api/src/modules/career/career-analytics.service.spec.ts; career-report.service.spec.ts; apps/api/src/common/export/spreadsheet.builder.spec.ts.
- Замечено: GET /career/analytics/company реализован (fetchCompanyCareerAnalytics в entities/career-event), но ни один экран его не вызывает — у работодателя метрик подбора в UI нет.

### D-26 Рабочее место модератора: зона /moderator и смежные разделы

- Бизнес-цель: дать модераторам платформы и вуза отдельную оболочку с их разделами (жалобы, поддержка, посты, люди, статистика, журнал, чаты) без доступа к остальным зонам.
- Роли: PLATFORM_MODERATOR (/moderator/platform), UNIVERSITY_MODERATOR (/moderator/university).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): apps/web/src/app/moderator/{platform,university}/layout.tsx (RoleGuard + AppShell); страницы complaints, audit, support (только platform), stats (только platform), posts (views/feed FeedView), users (widgets/users-table: блокировка/разблокировка — PATCH /users/:id/block|unblock), chats (views/chats), [...section] → views/role-landing SectionStub.
- Завершение: модератор работает в своём сайдбаре (UNIVERSITY_MODERATOR_NAV / PLATFORM_MODERATOR_NAV в widgets/app-shell/model/nav.ts); неизвестный раздел — заглушка.
- Шаги и файлы: apps/web/src/app/moderator/**; apps/web/src/widgets/app-shell/model/nav.ts; apps/web/src/shared/session/role-guard.tsx; API разделов — модули других групп (posts, users, chats, audit, platform stats).
- Данные на входе / выходе: см. D-15, D-16, D-17; остальное — в группах соответствующих модулей.
- Внешние зависимости: нет собственных.
- Тесты: нет (apps/web/e2e/access.e2e.ts зону /moderator не проверяет).
- Замечено: у UNIVERSITY_MODERATOR в оболочке нет раздела «Заявки», хотя ApplicationPolicy даёт ему право process (см. D-03).

## Группа E — Соцчасть и контент

### E-01 Публикация поста (аудитории, черновики, отложенные, медиа)

- Бизнес-цель: дать автору опубликовать объявление/пост ровно той аудитории, которая разрешена его роли, сразу, черновиком или по расписанию, с фото/видео.
- Роли: PLATFORM_ADMIN (ALL/PERSONAL), UNIVERSITY_ADMIN (UNIVERSITY/FACULTY/GROUP/TEACHERS/PERSONAL), DEAN (FACULTY/GROUP/PERSONAL), TEACHER (GROUP/SUBJECT/PERSONAL), STAROSTA и STUDENT (GROUP/PERSONAL); модераторы и EMPLOYER не публикуют.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /dean/posts, /teacher/posts, /university-admin/posts, /moderator/*/posts (views/feed) и модалка «Создать» в профиле (widgets/user-profile/ui/post-create-modal.tsx) → POST /posts (@Roles AUTHOR_ROLES); cron `publishScheduledPosts` (каждую минуту).
- Завершение: Post status=PUBLISHED (publishedAt) | DRAFT | SCHEDULED (scheduledAt); медиа привязаны к посту; AuditLog post_created; крон переводит SCHEDULED→PUBLISHED под Redis-локом.
- Шаги и файлы: apps/web/src/features/create-post/ui/create-post-form.tsx (uploadFileRequest('POSTS') → mediaIds, кнопки «Черновик»/«Опубликовать», scheduleAt); entities/post/model/audiences.ts (AUDIENCES_BY_ROLE); apps/api/src/modules/posts/posts.controller.ts → posts.service.ts create → resolveTarget (ALLOWED_AUDIENCES, assertFacultyInScope/assertGroupInScope/assertTargetUser — scope из JWT) → resolvePublishState → $transaction(post.create + linkMedia updateMany postId:null) → priorityFor (AUDIENCE_PRIORITY + 2 для сотрудников); apps/api/src/modules/cleanup/cleanup.service.ts publishScheduledPosts → posts.service.ts publishDueScheduled.
- Данные на входе / выходе: CreatePostSchema (packages/shared-schemas/src/posts.ts: audience, title?, content, facultyId?/groupId?/subject?/targetUserId?, mediaIds?, status?, scheduledAt?) → PostRow (POST_SELECT) с bookmarked; FORBIDDEN/WRONG_SCOPE/BAD_REQUEST/NOT_FOUND.
- Внешние зависимости: PostgreSQL, MinIO (бакет MINIO_BUCKET_POSTS через files-модуль), MediaService (варианты/постеры), Redis (CronLockService).
- Тесты: apps/api/src/modules/posts/posts.service.spec.ts (create — аудитория по роли; черновики и отложенная публикация; create — медиа); apps/api/src/modules/cleanup/cleanup.service.spec.ts (мок publishDueScheduled); apps/web/src/entities/post/model/audiences.test.ts; apps/web/e2e/posts.e2e.ts (декан публикует, пост в ленте).
- Замечено: лента сортирует по createdAt, а не publishedAt — отложенный пост после публикации кроном встаёт в ленту на дату создания, а не наверх.

### E-02 Лента: видимость, табы и порядок

- Бизнес-цель: показать каждому только посты его аудиторий (ALL, свой вуз/факультет/группа, адресованные лично, свои) в порядке «закреплённые → приоритет → свежесть», с бесконечной прокруткой.
- Роли: все вошедшие (8 ролей + EMPLOYER — видит только ALL и свои).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): / (views/home → widgets/feed-list + stories-rail), /<роль>/posts (views/feed/ui/feed-view.tsx, табы ALL/GROUP/UNIVERSITY/TEACHERS/IMPORTANT/SAVED); вкладка «Посты» профиля (widgets/user-profile/ui/profile-posts.tsx, authorId) → GET /posts?limit&cursor&filter&authorId.
- Завершение: страница постов + meta {cursor, hasNext, total — только для authorId}.
- Шаги и файлы: apps/web/src/entities/post/api/post-api.ts (fetchFeed/fetchAuthorPosts); widgets/feed-list/ui/feed-list.tsx, post-card.tsx, post-grid.tsx; apps/api/src/modules/posts/posts.service.ts feed → visibilityWhere (TEACHERS-аудитория только преподавателям; не-PUBLISHED только автору) → feedFilterWhere (AND поверх видимости) → findMany orderBy [pinnedAt desc nulls last, priority, createdAt, id] take limit+1 → decorateFeed (groupBy комментариев без удалённых + закладки зрителя).
- Данные на входе / выходе: FeedQuerySchema (limit, cursor, filter, authorId) → Paginated<ViewerPost> (_count.comments, bookmarked).
- Внешние зависимости: PostgreSQL (составной индекс порядка ленты в prisma/schema/05-posts.prisma).
- Тесты: apps/api/src/modules/posts/posts.service.spec.ts (feed — видимость; feed — cursor; счётчик комментариев ленты; избранное); apps/web/e2e/feed.e2e.ts.
- Замечено: §3.3 PROJECT.md обещает в ленте срочные уведомления, изменения расписания, ответы по заявкам и события — лента отдаёт только посты.

### E-03 Правка своего поста и публикация черновика

- Бизнес-цель: автор исправляет заголовок/текст своей публикации и вручную выпускает черновик к читателям (модератор чужой текст не правит).
- Роли: только автор поста.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): меню карточки поста (widgets/feed-list/ui/post-tile-menu.tsx — «Опубликовать»), features/edit-post/ui/edit-post-modal.tsx → PATCH /posts/:id, POST /posts/:id/publish.
- Завершение: title/content обновлены (AuditLog post_updated) | DRAFT → PUBLISHED, publishedAt=now, scheduledAt=null (AuditLog post_published).
- Шаги и файлы: apps/api/src/modules/posts/posts.service.ts update (authorId === actor, иначе FORBIDDEN) и publish (только status=DRAFT — отложенный досрочно не выпускается); apps/web/src/entities/post/api/post-api.ts updatePostRequest/publishPostRequest.
- Данные на входе / выходе: UpdatePostSchema {title?, content?} → PostRow; ошибки NOT_FOUND/FORBIDDEN/BAD_REQUEST.
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/posts/posts.service.spec.ts (update — правка только своей; черновики и отложенная публикация).
- Замечено: правка/отмена отложенного поста (смена scheduledAt) не предусмотрена — только удалить.

### E-04 Реакции и комментарии к посту

- Бизнес-цель: обратная связь на пост — эмодзи-реакции и обсуждение с одним уровнем ответов.
- Роли: все, кому пост виден; удаление чужого комментария — модератор scope строго выше автора.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): карточка поста и лайтбокс (widgets/feed-list/ui/post-card.tsx, post-lightbox.tsx, mention-suggest.tsx) → POST /posts/:id/reactions, DELETE /posts/:id/reactions/:emoji, GET|POST /posts/:id/comments, DELETE /posts/:id/comments/:commentId.
- Завершение: Reaction upsert (unique postId+userId+emoji) / deleteMany; Comment создан (ответ на ответ прицепляется к корню ветки) / мягко удалён (deletedAt, AuditLog comment_deleted).
- Шаги и файлы: apps/api/src/modules/posts/posts.service.ts addReaction/removeReaction/listComments (take 200, asc)/addComment/removeComment → assertModerator; apps/web/src/entities/post/api/post-api.ts.
- Данные на входе / выходе: ReactionSchema {emoji}, CreateCommentSchema {content, parentId?} → 204 / COMMENT_SELECT.
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/posts/posts.service.spec.ts (addComment — вложенность 1); apps/web/src/widgets/feed-list/ui/mention-suggest.test.ts.
- Замечено: removeReaction не проверяет видимость поста; автору поста не уходит уведомление о комментарии/реакции; список комментариев обрезается на 200 без пагинации.

### E-05 Избранное (закладки постов)

- Бизнес-цель: личная полка сохранённых постов, невидимая другим (счётчик сохранений не раскрывается).
- Роли: все вошедшие (только видимые им посты).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): кнопка закладки на карточке (features/bookmark-post/model/use-bookmark.ts), таб «Сохранённое» в views/feed → POST /posts/:id/bookmark (переключатель), GET /posts?filter=SAVED.
- Завершение: PostBookmark создан/удалён, ответ {bookmarked}; в SAVED пост виден, пока зритель сохраняет право его видеть.
- Шаги и файлы: apps/api/src/modules/posts/posts.service.ts toggleBookmark (findVisibleOrThrow — защита от проверки существования чужого поста) и feedFilterWhere('SAVED'); prisma/schema/05-posts.prisma PostBookmark.
- Данные на входе / выходе: postId → { bookmarked: boolean }.
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/posts/posts.service.spec.ts (избранное).
- Замечено: toggle — findUnique + create без транзакции: два параллельных нажатия дают 409 CONFLICT (P2002) вместо идемпотентного ответа.

### E-06 Репост и «Поделиться» (в чат, ссылкой, системным share)

- Бизнес-цель: распространить опубликованный пост в свою аудиторию (репост со ссылкой на первоисточник) или переслать его в чаты/наружу ссылкой.
- Роли: репост — AUTHOR_ROLES в пределах своих аудиторий; «поделиться» — все, кому пост виден.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): features/repost-post (repost-dialog.tsx, use-repost.ts) → POST /posts/:id/repost; features/share-post/ui/share-post-menu.tsx → POST /chats/:chatId/share-post (ChatsService → PostsService.assertVisibleToViewer), копирование /posts/:id, navigator.share.
- Завершение: новый Post с originalPostId (репост репоста указывает на первоисточник), AuditLog post_reposted | сообщение-карточка поста в выбранных чатах.
- Шаги и файлы: apps/api/src/modules/posts/posts.service.ts repost (PERSONAL → FORBIDDEN, status≠PUBLISHED → BAD_REQUEST, resolveTarget); apps/web/src/widgets/feed-list/ui/repost-banner.tsx, lib/use-repost-source.ts; apps/web/src/entities/chat/api/chat-api.ts sharePostRequest; widgets/chat-window/ui/shared-cards.tsx.
- Данные на входе / выходе: RepostSchema {audience, content?, facultyId?/groupId?/...} → PostRow; share: {postId} → ChatMessage.
- Внешние зависимости: PostgreSQL, socket.io (доставка сообщения в чат).
- Тесты: apps/api/src/modules/posts/posts.service.spec.ts (repost — что репостить нельзя); apps/web/src/features/repost-post/ui/repost-dialog.test.tsx.
- Замечено: repost не проставляет publishedAt (status берётся дефолтом PUBLISHED, publishedAt=null) — расходится с create.

### E-07 Закрепление и модерационное удаление поста

- Бизнес-цель: поднять важный пост наверх ленты (таб «Важное») и снять нарушающий контент — только ролью строго выше автора и в своём scope.
- Роли: закрепление — PLATFORM_ADMIN/MODERATOR, UNIVERSITY_ADMIN/MODERATOR, DEAN (DEAN — свой факультет, вуз — свой вуз); удаление — автор или те же модераторы.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): меню карточки (widgets/feed-list/ui/post-tile-menu.tsx, canModerate по MODERATOR_ROLES), /moderator/*/posts → PATCH /posts/:id/pin {pinned}, DELETE /posts/:id; жалоба — features/report-content/ui/report-modal.tsx (модуль complaints).
- Завершение: pinnedAt/pinnedById выставлены или сняты (AuditLog post_pinned/post_unpinned) | Post.deletedAt=now (AuditLog post_deleted).
- Шаги и файлы: apps/api/src/modules/posts/posts.service.ts setPinned (ROLE_RANK actor > автор) → assertModerator (isHigherRole, scope DEAN/вуз/платформа) и remove; posts.controller.ts @Roles для pin.
- Данные на входе / выходе: PinPostSchema {pinned} → PostRow; 204 на удаление; FORBIDDEN/WRONG_SCOPE.
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/posts/posts.service.spec.ts (setPinned — иерархия; remove — автор/модератор).
- Замечено: UI показывает «Закрепить/Удалить» всем MODERATOR_ROLES без проверки «роль выше автора» — сервер ответит 403.

### E-08 Просмотр поста: постоянная ссылка, лайтбокс, медиа, счётчик просмотров

- Бизнес-цель: открыть пост по ссылке /posts/:id или в лайтбоксе, отдать медиа (оригинал + варианты/HLS) по видимости поста и учесть просмотр.
- Роли: все, кому пост виден.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /posts/[id] (apps/web/src/views/post/ui/post-page-view.tsx, widgets/feed-list/ui/post-from-url.tsx), лайтбокс post-lightbox.tsx/post-media.tsx/media-frame.tsx → GET /posts/:id, GET /posts/:id/media/:fileId/url, POST /posts/:id/view.
- Завершение: карточка поста; presigned URL c expiresAt по окну подписи; views+1.
- Шаги и файлы: apps/api/src/modules/posts/posts.service.ts getById (findVisibleOrThrow + withBookmarks), getMediaUrl (file.postId === postId, FileService.getPresignedUrl, MediaService.describeOne, signingWindow), incrementView.
- Данные на входе / выходе: id/fileId → ViewerPost | {url, expiresAt, ...MediaInfo} | {views}.
- Внешние зависимости: PostgreSQL, MinIO (presigned GET), MediaService.
- Тесты: apps/api/src/modules/posts/posts.service.spec.ts (getMediaUrl; incrementView).
- Замечено: просмотр не дедуплицируется по зрителю — каждое открытие лайтбокса +1.

### E-09 Медиа профиля: фото/видео, обложка видео, альбомы

- Бизнес-цель: человек ведёт галерею фото и видео в своём профиле (ВК-стиль) и раскладывает фото по альбомам; чужим галерея видна только при полном доступе к профилю.
- Роли: владелец (загрузка/удаление/альбомы); смотрящие — по canViewProfileContent (profileVisibility, дружба, надзорные роли scope).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /profile и /profile/[id] → вкладки Фото/Видео (widgets/user-profile/ui/profile-content.tsx, profile-media-grid.tsx, media-lightbox.tsx, album-controls.tsx, video-cover-picker.tsx) → POST /profile/media (буфер), POST /profile/media/presign + /profile/media/confirm (крупные >10 МБ), POST /profile/media/:fileId/poster, DELETE /profile/media/:fileId, GET /profile/:userId/media; POST/PATCH/DELETE /profile/albums[/:id], POST /profile/albums/:id/media, DELETE /profile/albums/:id/media/:fileId, GET /profile/:userId/albums.
- Завершение: File в бакете MINIO_BUCKET_PROFILE_MEDIA (только image/video — иначе FILE_TYPE_NOT_ALLOWED и откат); постер видео в бакете обложек (posterKey); Album с обложкой из своих фото; удаление альбома оставляет фото.
- Шаги и файлы: apps/api/src/modules/profile-content/profile-content.controller.ts; profile-content.service.ts uploadMedia/presignMedia/confirmMedia (files.confirmDirectUpload — тип по magic bytes)/attachPoster/deleteMedia/listMedia (take 300)/createAlbum/listAlbums/updateAlbum/assignAlbumMedia/removeAlbumMedia/assertAlbumOwner; apps/api/src/modules/users/users.service.ts canViewProfileContent; apps/web/src/entities/profile-content/api/profile-content-api.ts.
- Данные на входе / выходе: multipart-файл | PresignProfileMediaSchema {mime} → {key,url,expiresAt} | ConfirmProfileMediaSchema {key}; ProfileMediaDto (публичный URL + варианты), AlbumDto {id,title,coverUrl,count}.
- Внешние зависимости: MinIO (profile-media, profile-covers; presigned PUT), MediaService (варианты, раскадровка), PostgreSQL.
- Тесты: apps/api/src/modules/profile-content/profile-content.service.spec.ts (медиа; альбомы; видимость контента профиля §14.7).
- Замечено: медиа отдаётся постоянным публичным URL бакета — закрытость профиля скрывает список, но не сами объекты по известной ссылке.

### E-10 Статьи профиля: черновики, видимость, обложка, просмотры, похожие

- Бизнес-цель: длинные публикации в профиле с обложкой, категорией/тегами, оценкой времени чтения и областью видимости (ALL/UNIVERSITY/FACULTY/GROUP).
- Роли: автор — любой вошедший; читатели — по visibility статьи относительно scope автора; платформенные роли видят всё, включая черновики.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): вкладка «Статьи» профиля (widgets/user-profile/ui/profile-articles.tsx, article-editor-modal.tsx, article-cover.tsx, content-modal.tsx) → POST /profile/articles, POST /profile/articles/cover, GET /profile/:userId/articles, PATCH|DELETE /profile/articles/:id, POST /profile/articles/:id/view, GET /profile/articles/:id/related.
- Завершение: ProfileArticle создан/изменён (status DRAFT|PUBLISHED, publishedAt при первой публикации, readingMinutes) / удалён; views+1.
- Шаги и файлы: apps/api/src/modules/profile-content/profile-content.service.ts createArticle → articleData (coverUrlOrThrow — только URL своих бакетов, защита от трекинг-пикселя) / listArticles (take 100, чужим — PUBLISHED + visibility по scope) / updateArticle / deleteArticle / incrementArticleView / relatedArticles → viewerVisibilityWhere / assertArticleVisible; uploadCover.
- Данные на входе / выходе: CreateProfileArticleSchema/UpdateProfileArticleSchema (packages/shared-schemas/src/profile.ts) → статья + commentCount/bookmarksCount/bookmarked.
- Внешние зависимости: PostgreSQL, MinIO (обложки).
- Тесты: apps/api/src/modules/profile-content/profile-content.service.spec.ts (статьи владение).
- Замечено: listArticles не учитывает profileVisibility (в отличие от медиа/альбомов) — статьи закрытого профиля с visibility=ALL видны всем.

### E-11 Комментарии и закладки статей профиля

- Бизнес-цель: обсуждение статьи (если автор не отключил комментарии) и личная полка статей «к прочтению».
- Роли: все, кому статья видна; удаление комментария — его автор или владелец статьи.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): читалка статьи (widgets/user-profile/ui/content-comments.tsx, content-modal.tsx) → GET|POST /profile/articles/:id/comments, DELETE /profile/articles/:id/comments/:commentId, POST /profile/articles/:id/bookmark, GET /profile/bookmarks.
- Завершение: ContentComment создан / физически удалён; Bookmark (unique userId+articleId) переключён.
- Шаги и файлы: apps/api/src/modules/profile-content/profile-content.service.ts listArticleComments (take 200) / addArticleComment (allowComments, иначе FORBIDDEN) / deleteArticleComment / toggleBookmark / listBookmarks (take 100).
- Данные на входе / выходе: ContentCommentSchema {content} → CONTENT_COMMENT_SELECT; → {bookmarked}.
- Внешние зависимости: PostgreSQL.
- Тесты: нет (в profile-content.service.spec.ts комментарии и закладки статей не покрыты).
- Замечено: GET /profile/bookmarks не перепроверяет видимость — статья, ставшая черновиком или сузившая visibility, продолжает отдаваться; в вебе эндпоинт не используется.

### E-12 Опросы профиля: создание, голосование, результаты, комментарии

- Бизнес-цель: автор публикует опрос в профиле (одиночный/множественный выбор, анонимность, переголосование, срок, правила показа итогов), видимая аудитория голосует и обсуждает.
- Роли: автор — любой вошедший; голосовать/комментировать — кому опрос виден по visibility (ALL/UNIVERSITY/FACULTY/GROUP относительно scope автора; платформа — всё); удалить комментарий — его автор или владелец опроса.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): вкладка «Опросы» профиля (widgets/user-profile/ui/profile-polls.tsx, poll-card.tsx, poll-create-modal.tsx, content-comments.tsx) → POST /polls, GET /polls/by-user/:userId, GET /polls/:id, POST|DELETE /polls/:id/vote, PATCH|DELETE /polls/:id, GET|POST /polls/:id/comments, DELETE /polls/:id/comments/:commentId.
- Завершение: Poll + PollOption; PollVote по вариантам (повтор без allowRevote → CONFLICT; после closesAt → CONFLICT «Опрос завершён»); правка только до первых голосов; ContentComment (pollId).
- Шаги и файлы: apps/api/src/modules/polls/polls.controller.ts; polls.service.ts create/listByUser (take 100, фильтр видимости в памяти)/get/vote ($transaction + advisoryXactLock poll-vote:<id>:<user>)/cancelVote/update/remove/visibleTo/toView (canSeeResults: владелец | AFTER_VOTE после голоса | AFTER_END после закрытия; явка скрывается вместе с итогами)/listComments/addComment/deleteComment; apps/web/src/entities/poll/api/poll-api.ts.
- Данные на входе / выходе: CreatePollSchema/UpdatePollSchema/VotePollSchema {optionIds} (packages/shared-schemas/src/profile.ts) → PollView {options[].votes, totalVotes, participants, myVotes, canVote, canSeeResults, closed}.
- Внешние зависимости: PostgreSQL (advisory lock).
- Тесты: apps/api/src/modules/polls/polls.service.spec.ts (только голосование: лок, повторный голос, отмена после закрытия).
- Замечено: cancelVote не проверяет видимость и статус опроса (в отличие от vote); видимость опросов, как и статей, не учитывает profileVisibility закрытого профиля.

### E-13 Сторисы: публикация на 24 часа (медиа, текст на фоне, ссылка, опрос)

- Бизнес-цель: короткий формат «на сутки» для своей аудитории без адресных и предметных сторис; раздел за флагом раскатки.
- Роли: публикуют AUTHOR_ROLES (PLATFORM_ADMIN, UNIVERSITY_ADMIN, DEAN, TEACHER, STAROSTA, STUDENT) по матрице аудиторий §2.2 (ALL/UNIVERSITY/FACULTY/GROUP/TEACHERS); модераторы и EMPLOYER — нет.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): кольца над лентой (widgets/stories-rail/ui/stories-rail.tsx, только при NEXT_PUBLIC_FEATURE_STORIES=1 — apps/web/src/shared/config/features.ts) → features/create-story/ui/create-story-form.tsx → uploadStoryMedia (файлы-модуль, бакет STORIES; крупные — прямой presigned) → POST /stories.
- Завершение: Story с expiresAt=now+STORY_TTL_HOURS (24 ч), scope из профиля автора; StoryPoll+опции в той же транзакции; AuditLog story_created.
- Шаги и файлы: apps/api/src/modules/stories/stories.controller.ts (@Roles AUTHOR_ROLES); stories.service.ts create → resolveTarget (assertFacultyInScope/assertGroupInScope) → assertOwnMedia (свой файл, не прикреплён к другой сторис — CONFLICT) → $transaction(story.create + storyPoll.create); apps/web/src/entities/story/api/story-api.ts, model/audiences.ts, backgrounds.ts.
- Данные на входе / выходе: CreateStorySchema (packages/shared-schemas/src/stories.ts: audience, fileId?, text?, background?, linkUrl?/linkLabel?, poll{question, options 2–4}?, facultyId?/groupId?) → StoryCard (presigned media 15 мин).
- Внешние зависимости: PostgreSQL, MinIO (бакет stories-media с TTL-политикой), MediaService.
- Тесты: apps/api/src/modules/stories/stories.service.spec.ts (StoriesService.create).

### E-14 Сторисы: лента колец, просмотры, реакции, голос, список зрителей

- Бизнес-цель: показать живые сторисы по видимости кольцами авторов (непросмотренные выделены), дать отреагировать/проголосовать, а автору — увидеть, кто смотрел.
- Роли: все вошедшие по видимости (ALL, свой вуз/факультет/группа, TEACHERS — только преподавателям, свои); список зрителей и viewsCount — только автор.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): / и /<роль>/posts (таб ALL) → widgets/stories-rail/ui/stories-rail.tsx, story-viewer.tsx, story-viewers-sheet.tsx → GET /stories?authorId, GET /stories/:id, POST /stories/:id/view, POST /stories/:id/reactions, DELETE /stories/:id/reactions/:emoji, POST /stories/:id/vote, GET /stories/:id/viewers?cursor&limit.
- Завершение: StoryView (unique storyId+userId, свой просмотр не пишется), StoryReaction upsert/deleteMany, StoryPollVote upsert (переголосование заменяет прежний голос), страница зрителей.
- Шаги и файлы: apps/api/src/modules/stories/stories.service.ts feed (visibilityWhere expiresAt>now, FEED_TAKE 200, desc) → decorate (просмотры/реакции/голоса батчами) → toRings; markViewed; addReaction/removeReaction; vote; viewers (FORBIDDEN не автору, cursor-пагинация).
- Данные на входе / выходе: StoriesFeedQuerySchema, StoryReactionSchema {emoji}, StoryVoteSchema {optionId}, StoryViewersQuerySchema → StoryRing[] {author, stories[], hasUnseen} / StoryCard / Paginated<viewer>.
- Внешние зависимости: PostgreSQL, MinIO (presigned GET), MediaService.
- Тесты: apps/api/src/modules/stories/stories.service.spec.ts (feed — видимость; feed — кольца авторов; просмотр и голос; viewers).
- Замечено: лента колец без пагинации — жёсткий потолок 200 сторис на зрителя; removeReaction не проверяет видимость.

### E-15 Сторисы: удаление автором/модератором и истечение по крону

- Бизнес-цель: снять сторис раньше срока (автор, модератор scope строго выше автора, решение по жалобе) и физически убрать истёкшие вместе с медиа.
- Роли: автор; PLATFORM_*, UNIVERSITY_ADMIN/MODERATOR (свой вуз), DEAN (свой факультет); модератор жалоб через ComplaintsService; система (cron).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): меню в story-viewer.tsx (canDelete) → DELETE /stories/:id; жалоба (features/report-content) → решение «удалить контент» в complaints → StoriesService.removeByModeration; cron `deleteExpiredStories` (*/30).
- Завершение: Story удалена физически (каскад опроса/просмотров/реакций), File снят через FileService (ошибка не откатывает удаление), AuditLog story_deleted; крон — батчами по 500.
- Шаги и файлы: apps/api/src/modules/stories/stories.service.ts remove → assertModerator/canModerate; removeByModeration; deleteExpired → deleteMedia; apps/api/src/modules/cleanup/cleanup.service.ts deleteExpiredStories (CronLockService); apps/api/src/modules/complaints/complaints.service.ts (вызов removeByModeration).
- Данные на входе / выходе: id → 204; счётчик удалённых для крона.
- Внешние зависимости: PostgreSQL, MinIO (удаление объектов + TTL бакета), Redis (крон-лок).
- Тесты: apps/api/src/modules/stories/stories.service.spec.ts (remove; deleteExpired); apps/api/src/modules/cleanup/cleanup.service.spec.ts (мок deleteExpired).

### E-16 Друзья: заявка, встречная заявка, принятие, отклонение, удаление

- Бизнес-цель: социальная связь между людьми платформы (в т.ч. разных вузов) — даёт доступ к закрытому профилю и личной переписке без «запроса на переписку».
- Роли: все вошедшие, кроме EMPLOYER (ни отправить, ни получить заявку).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): кнопка в чужом профиле (widgets/user-profile/ui/public-user-profile.tsx), колокольчик с кнопками принять/отклонить (widgets/notifications-bell/ui/notifications-bell.tsx, data.kind=friend-request), widgets/friends-panel (friends-modal.tsx, model/use-friendship-mutations.ts) → POST /friends/requests {userId}, POST /friends/requests/:id/accept, DELETE /friends/:id; очередь notifications (friend-request / friend-accepted).
- Завершение: Friendship PENDING → ACCEPTED (respondedAt) или удалена; адресату — SYSTEM-уведомление (dedupeKey friend-request:<id>), инициатору при принятии — friend-accepted; при отклонении/отмене уведомление-заявка гасится, отправителю ничего.
- Шаги и файлы: apps/api/src/modules/friends/friends.controller.ts; friends.service.ts sendRequest (self → BAD_REQUEST, цель удалена/заблокирована/EMPLOYER → NOT_FOUND, UserBlock в любую сторону → FORBIDDEN, встречная заявка → acceptRow, P2002 → CONFLICT) / accept (только адресат, только PENDING) / remove (любой участник) / notify (QueueService) / clearRequestNotification; блокировка — apps/api/src/modules/chats/chats.service.ts blockUser/unblockUser (POST|DELETE /chats/blocks/:userId).
- Данные на входе / выходе: SendFriendRequestSchema {userId} (packages/shared-schemas/src/friends.ts) → {status: 'pending'|'accepted'}; 204.
- Внешние зависимости: PostgreSQL, BullMQ/Redis (очередь уведомлений), web-push/realtime через воркер уведомлений.
- Тесты: apps/api/src/modules/friends/friends.service.spec.ts (sendRequest; кому нельзя; accept/remove); apps/web/src/widgets/friends-panel/ui/friends-panel.test.tsx.
- Замечено: блокировка не разрывает уже принятую дружбу и не гасит висящую заявку, accept блок не проверяет; unique только (requester, addressee) — одновременные встречные заявки дают две строки.

### E-17 Друзья: список, входящие/исходящие заявки, счётчики, статус для кнопки

- Бизнес-цель: показать человеку его друзей и заявки (бейдж входящих) и правильное состояние кнопки дружбы в чужом профиле.
- Роли: все вошедшие (только свои связи).
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): правая колонка ленты и главной (views/feed/ui/feed-view.tsx, views/home/ui/home-sidebar.tsx → widgets/friends-panel/ui/friends-panel.tsx, model/use-friends-summary.ts), карточка entities/friendship/ui/friend-card.tsx → GET /friends?cursor&limit, GET /friends/requests?direction=incoming|outgoing, GET /friends/count, GET /friends/status/:userId.
- Завершение: Paginated {friendshipId, since|createdAt, user}; {friends, incomingRequests}; {status: NONE|ACCEPTED|PENDING_OUTGOING|PENDING_INCOMING, friendshipId?}.
- Шаги и файлы: apps/api/src/modules/friends/friends.service.ts listFriends (orderBy respondedAt desc, cursor по id связи) / listRequests / counts ($transaction двух count) / statusFor → findBetween; apps/web/src/entities/friendship/api/friendship-api.ts.
- Данные на входе / выходе: FriendsListQuerySchema, FriendRequestsQuerySchema → см. выше.
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/friends/friends.service.spec.ts (statusFor); apps/web/src/widgets/friends-panel/ui/friends-panel.test.tsx.
- Замечено: список друзей — только свой; заблокированные мной пользователи в списке друзей и заявок не отфильтровываются.

### E-18 Мероприятия: создание, правка, удаление (в т.ч. онлайн-встреча)

- Бизнес-цель: организатор заводит событие для разрешённой его роли аудитории (очное или онлайн со ссылкой на Zoom/Meet/Teams), может перенести или отменить его.
- Роли: создание — PLATFORM_ADMIN (ALL), UNIVERSITY_ADMIN (UNIVERSITY/FACULTY/GROUP/TEACHERS), DEAN (FACULTY/GROUP), TEACHER (GROUP/SUBJECT), STAROSTA и STUDENT (GROUP); правка/удаление — организатор, платформа, DEAN своего факультета, UNIVERSITY_ADMIN своего вуза.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /events, /dean/events, /teacher/events, /starosta/events, /university-admin/events (apps/web/src/views/events/ui/events-view.tsx, canCreate) → features/create-event/ui/create-event-modal.tsx → POST /events; event-detail-view.tsx → PATCH /events/:id, DELETE /events/:id.
- Завершение: Event (audience + scope, isOnline=true при meetingUrl, meetingProvider определяет сервер по хосту) создан/изменён (при переносе startsAt сбрасывается reminderSentAt)/удалён физически; AuditLog event_created/updated/deleted.
- Шаги и файлы: apps/api/src/modules/events/events.controller.ts (@Roles AUTHOR_ROLES на POST); events.service.ts create → resolveTarget (ALLOWED_AUDIENCES, assertFaculty/assertGroup) → meetingFields; update (endsAt > startsAt) / remove → findManageable; apps/web/src/entities/event/api/event-api.ts.
- Данные на входе / выходе: CreateEventSchema/UpdateEventSchema (packages/shared-schemas/src/events.ts: audience, title, description, location, startsAt, endsAt?, isOnline?, meetingUrl?, meetingPasscode?, facultyId?/groupId?) → EventRow (без meetingUrl).
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/events/events.service.spec.ts (create — аудитория по роли; управление и регистрация; create — встреча); apps/api/test/cross-tenant.e2e-spec.ts (событие чужого вуза закрыто).
- Замечено: перенос и удаление события не уведомляют зарегистрированных участников; модель «типов» события из §3.5 (учебное/социальное/…) сведена к аудитории.

### E-19 Мероприятия: лента событий, регистрация, участники, ссылка на встречу

- Бизнес-цель: человек видит предстоящие/прошедшие события своей аудитории, регистрируется и получает ссылку на онлайн-встречу в окне подключения; организатор видит список участников.
- Роли: все вошедшие по видимости (eventVisibilityWhere); ссылка — зарегистрированные и организатор; участники — организатор и админы scope.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /events и /events/[id] (views/events/ui/events-view.tsx, event-detail-view.tsx, features/join-meeting/ui/join-meeting-button.tsx) → GET /events?filter=upcoming|past&mine&page&limit, GET /events/:id, POST|DELETE /events/:id/register, GET /events/:id/participants, GET /events/:id/meeting.
- Завершение: страница событий с isRegistered и total; EventParticipant создан (повтор P2002 — идемпотентно) / удалён; {provider, url, passcode, joinableFrom, joinableUntil, joinable} (окно −15 мин … конец+30 мин, без endsAt — 2 ч).
- Шаги и файлы: apps/api/src/modules/events/event-visibility.ts eventVisibilityWhere; events.service.ts list (offset-пагинация + count в $transaction) / getById / register / cancelRegistration / listParticipants (take 1000) / meeting → joinWindow.
- Данные на входе / выходе: EventListQuerySchema → Paginated<Event & {isRegistered}>; EventMeeting.
- Внешние зависимости: PostgreSQL.
- Тесты: apps/api/src/modules/events/events.service.spec.ts (управление и регистрация; ссылка на встречу); apps/api/test/cross-tenant.e2e-spec.ts.
- Замечено: регистрация не проверяет, что событие ещё не началось/не прошло; участники обрезаются на 1000 без пагинации.

### E-20 Мероприятия: комментарии и напоминание за час

- Бизнес-цель: обсуждение под событием для всей его аудитории и автоматическое напоминание каждому участнику за час до начала.
- Роли: комментарии — все, кому событие видно; удаление чужих — организатор, админ scope, UNIVERSITY_MODERATOR своего вуза; напоминание — система.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): event-detail-view.tsx → GET|POST /events/:id/comments, DELETE /events/:id/comments/:commentId; cron `scheduleEventReminders` (*/15, apps/api/src/modules/cleanup/cleanup.service.ts) → очередь notifications (EVENT_REMINDER).
- Завершение: EventComment создан / мягко удалён (AuditLog event_comment_deleted при чужом); уведомление type=EVENT участникам (страницами по 500, dedupeKey event-reminder:<id>:<startsAt>), Event.reminderSentAt проставлен.
- Шаги и файлы: apps/api/src/modules/events/events.service.ts listComments (последние 100) / addComment / removeComment → canModerateComments → findManageable; remindDue (окно now+55…70 мин, батч 500 событий).
- Данные на входе / выходе: CreateEventCommentSchema {content} → COMMENT_SELECT; счётчик обработанных событий.
- Внешние зависимости: PostgreSQL, BullMQ/Redis (очередь уведомлений, крон-лок), воркер уведомлений (push/email).
- Тесты: apps/api/src/modules/events/events.service.spec.ts (remindDue — окно и дедуп; комментарии §3.5); apps/api/src/modules/cleanup/cleanup.service.spec.ts.
- Замечено: окно 55–70 мин при кроне раз в 15 мин даёт ровно одно попадание; если крон пропустил тик (рестарт/лок), напоминание о событии теряется навсегда.

### E-21 Глобальный поиск (Cmd+K / строка в шапке) и автодополнение упоминаний

- Бизнес-цель: найти человека, дисциплину, задание, материал, событие или свой чат одной строкой в пределах своего scope; подсказать @username при упоминании.
- Роли: все вошедшие; платформенные роли — без ограничения вуза; STUDENT/STAROSTA — своя группа; TEACHER — свои курсы для заданий.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): widgets/command-palette/ui/command-palette.tsx (десктоп), поиск в apps/web/src/widgets/app-shell/ui/app-shell.tsx (мобильный), widgets/feed-list/ui/mention-suggest.tsx → GET /search?q= (q 2…100 символов).
- Завершение: { people, courses, assignments, materials, events, chats } по 6 записей; упавший источник отдаёт пустой блок (Promise.allSettled).
- Шаги и файлы: apps/api/src/modules/search/search.controller.ts → search.service.ts search (ILIKE contains; courseScope/assignmentScope/materialScope/eventScope → events/event-visibility.ts; чаты — по членству и bannedAt=null); apps/web/src/entities/search/api/search-api.ts, model/use-search-items.ts (SEARCH_MIN_QUERY); widgets/command-palette/model/quick-actions.ts.
- Данные на входе / выходе: SearchQuerySchema {q} (packages/shared-schemas/src/search.ts) → объект из шести массивов.
- Внешние зависимости: PostgreSQL (ILIKE без полнотекстового индекса).
- Тесты: apps/api/src/modules/search/search.service.spec.ts (события по аудитории; чаты по членству); apps/web/src/widgets/command-palette/model/quick-actions.test.ts.
- Замечено: посты, статьи и опросы в поиск не входят; eventScope требует universityId=вуз зрителя, поэтому события с аудиторией ALL (universityId=null) не-платформенным ролям не находятся; поиск людей игнорирует profileVisibility.

### E-22 Портфолио: ведение записей и показ другим

- Бизнес-цель: человек собирает достижения (проекты, сертификаты, награды, опыт и т.п.) с приватностью записи PUBLIC/UNIVERSITY/PRIVATE; записи питают резюме карьерного раздела.
- Роли: владелец — любой вошедший (без @Roles); смотрящие — PUBLIC всем, UNIVERSITY — своему вузу, PRIVATE — только владельцу.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /portfolio (apps/web/src/views/portfolio/ui/portfolio-view.tsx, portfolio-item-modal.tsx, lib/visuals.ts; раздел скрывается флагом в entities/platform/lib/sections.ts) → GET /portfolio/mine, GET /portfolio/user/:id, POST /portfolio, PATCH /portfolio/:id, DELETE /portfolio/:id.
- Завершение: PortfolioItem создан (visibility по умолчанию UNIVERSITY)/изменён/удалён физически; AuditLog portfolio_item_created/updated/deleted.
- Шаги и файлы: apps/api/src/modules/portfolio/portfolio.controller.ts → portfolio.service.ts listMine (take 500) / listForUser (фильтр visibility по совпадению вуза) / create / update / remove → assertOwner; apps/web/src/entities/portfolio/api/portfolio-api.ts; потребитель — apps/api/src/modules/career/resume.service.ts assemble.
- Данные на входе / выходе: CreatePortfolioItemSchema/UpdatePortfolioItemSchema (packages/shared-schemas/src/portfolio.ts: kind, title, organization?, description?, url (httpUrl), startDate?/endDate?, visibility?) → ITEM_SELECT.
- Внешние зависимости: PostgreSQL.
- Тесты: нет (у модуля portfolio нет ни unit-, ни e2e-тестов).
- Замечено: публичное резюме по slug (resume.service.ts publicBySlug → assemble) включает портфолио без фильтра visibility — PRIVATE-записи уходят наружу; поле order нельзя изменить через API; GET /portfolio/user/:id в вебе не используется и не учитывает profileVisibility/deletedAt.

### E-23 Профиль как соцвитрина: вкладки контента, дружба, «Написать», «Поделиться»

- Бизнес-цель: страница человека (ВК-стиль) собирает его посты, фото, видео, статьи и опросы в вкладках с бейджами, даёт добавить в друзья, начать переписку и переслать профиль; свой профиль — ещё и точка создания контента и подсказка заполненности.
- Роли: все вошедшие; полнота анкеты и контента — по правам видимости (A-18), содержимое вкладок — по правилам E-02/E-09/E-10/E-12.
- Вход (UI-маршрут / эндпоинт / cron / очередь / вебхук): /profile (widgets/user-profile/ui/user-profile.tsx), /profile/[id] (public-user-profile.tsx) → GET /users/:id, GET /users/:id/presence, GET /friends/status/:userId, GET /posts?authorId, GET /profile/:userId/media|articles, GET /polls/by-user/:userId; POST /friends/requests, POST /chats {type: PRIVATE}, отправка ссылки в чат (share-profile-button.tsx → sendMessageWithAttachments) или копирование.
- Завершение: вкладки отрисованы с счётчиками; заявка в друзья/принятие, создан или открыт личный чат (с «запросом на переписку» для не-друзей), ссылка на профиль ушла в выбранные чаты.
- Шаги и файлы: apps/web/src/widgets/user-profile/ui/profile-tabs.tsx (posts/photos/videos/articles/polls), profile-content.tsx, profile-posts.tsx, profile-articles.tsx, profile-polls.tsx, profile-create-modals.tsx (post/poll/article/media), profile-completion.tsx + completion.ts (computeProfileCompletion), share-profile-button.tsx, use-progressive.ts, use-retry-on-error.ts.
- Данные на входе / выходе: userId → карточка (access full|limited) + списки контента.
- Внешние зависимости: API users/posts/profile-content/polls/friends/chats; socket.io (присутствие).
- Тесты: apps/web/src/widgets/user-profile/ui/completion.test.ts; apps/web/src/widgets/user-profile/ui/profile-edit-form.test.tsx (форма правки — см. A-12).
- Замечено: у «визитки» (access=limited) веб прячет вкладки, но GET /profile/:userId/articles и /polls/by-user/:userId отдают контент закрытого профиля по прямому запросу (profileVisibility не проверяется, в отличие от медиа).

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
