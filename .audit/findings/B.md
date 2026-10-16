## Группа B — аудит

(в работе — статусы процессов заполняются в конце)

### Проблемы

#### B-F01 [P1] Одобрение демо-заявки не атомарно: двойной клик или сбой инвайта даёт вуз-дубликат

- Процесс: B-01
- Где: apps/api/src/modules/onboarding/demo-requests.service.ts:406 (проверка `status !== 'NEW'` до транзакции), :410-426 (транзакция создаёт только вуз + онбординг), :431-436 (инвайт вне транзакции), :438-449 (смена статуса безусловным `update` по id)
- Суть: проверка статуса читается до транзакции, а инвайт и перевод заявки в APPROVED идут отдельными запросами после неё. Два параллельных «Одобрить» (две вкладки, повтор после таймаута) оба проходят проверку и создают два вуза PENDING с двумя онбордингами и двумя инвайтами UNIVERSITY_ADMIN на один адрес; заявка указывает на последний. Сбой между транзакцией и `update` (например, `invites.create` упал) оставляет заявку в NEW при уже созданном вузе — повторное нажатие создаёт второй. Аналогично `reject` (:484-498) — проверка и безусловный update: параллельные approve+reject дают REJECTED-письмо при уже заведённом вузе или наоборот.
- Решение: перенести всё в одну интерактивную транзакцию: первым шагом `updateMany({ where: { id, status: 'NEW' }, data: { status: 'APPROVED', ... } })` и при `count === 0` — CONFLICT; затем вуз, онбординг и инвайт через `tx` (у `InviteService.create` добавить вариант с переданным клиентом или вынести создание строки инвайта). Для `reject` — тот же условный `updateMany`.
- Файлы для правки: apps/api/src/modules/onboarding/demo-requests.service.ts, apps/api/src/modules/invites/invites.service.ts, apps/api/src/modules/onboarding/demo-requests.service.spec.ts
- Стоп-точки: нет

#### B-F02 [P1] Статус вуза BLOCKED ничего не блокирует

- Процесс: B-02
- Где: apps/api/src/modules/universities/universities.service.ts:247-268 (`setStatus` только пишет поле); apps/api/src/modules/auth/strategies/jwt.strategy.ts:42 и apps/api/src/modules/auth/auth.service.ts (вход) — статус вуза не читается; grep по `university.status`/`'BLOCKED'` в apps/api/src находит только онбординг (onboarding.service.ts:52,70,142,218)
- Суть: PLATFORM_ADMIN в `/platform-admin/universities` (universities-admin-view.tsx:118-123, 229-244) выбирает «Заблокирован», получает тост «статус изменён», но ни вход, ни refresh, ни guard'ы, ни регистрация по инвайту статус вуза не проверяют — пользователи заблокированного вуза продолжают работать, админ вуза продолжает выписывать инвайты. То же для PENDING: вуз до запуска мастера полностью рабочий для всех его пользователей.
- Решение: определить семантику (PROJECT.md §6.1 описывает только enum) и применить её: для BLOCKED — отказ во входе/refresh и регистрации по инвайту с отдельным кодом ошибки (например `UNIVERSITY_BLOCKED`), гашение сессий при переводе в BLOCKED; проверка в JwtStrategy через кэш статуса вуза в Redis, чтобы не ходить в БД на каждый запрос. Если блокировка не нужна — убрать BLOCKED из UI, чтобы не вводить админа в заблуждение.
- Файлы для правки: apps/api/src/modules/auth/auth.service.ts, apps/api/src/modules/auth/strategies/jwt.strategy.ts, apps/api/src/modules/universities/universities.service.ts, apps/api/src/modules/invites/invites.service.ts, docs/PROJECT.md
- Стоп-точки: «контракт API/shared-schemas» (новый код ошибки, изменение guard'ов)

#### B-F03 [P1] Админ заблокированного вуза сам переводит его в ACTIVE через мастер

- Процесс: B-03
- Где: apps/api/src/modules/onboarding/onboarding.service.ts:70 (`canLaunch: ... && status !== 'ACTIVE'`), :142-153 (`launch` отбивает только ACTIVE и пишет `status: 'ACTIVE'` без условия на текущий статус)
- Суть: `POST /onboarding/launch` доступен UNIVERSITY_ADMIN и проверяет лишь «уже ACTIVE». Вуз, который платформа перевела в BLOCKED, при заполненных шагах (а у работавшего вуза они заполнены) снова «Готов к запуску», и админ вуза одним нажатием перезаписывает решение платформы на ACTIVE. После исправления B-F02 это станет обходом блокировки.
- Решение: разрешать launch только из PENDING: условный `updateMany({ where: { id, status: 'PENDING' } })`, иначе CONFLICT; `canLaunch` считать как `status === 'PENDING' && blocking.length === 0`.
- Файлы для правки: apps/api/src/modules/onboarding/onboarding.service.ts, apps/api/src/modules/onboarding/onboarding.service.spec.ts
- Стоп-точки: нет
