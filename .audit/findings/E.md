## Группа E — аудит

> Фаза 2, только чтение кода (API + веб). Тесты, сборки и dev-сервер не запускались. Каждая
> P0/P1 подтверждена чтением указанных строк. Оценки нагрузки (F04, F05) — расчёт по коду,
> не замер. Вкладки профиля и потолок списка опросов проверены в состоянии после PR #357/#358.

### Статусы процессов

| Процесс                                       | Статус                | Коротко                                                                                                                                            |
| --------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-01 Публикация поста                         | работает с проблемами | аудитории и scope из JWT, пост+медиа в транзакции; отложенный пост встаёт в ленту по `createdAt` (F06); медиа брошенных форм не чистятся (F15)     |
| E-02 Лента                                    | работает с проблемами | порядок «приоритет раньше свежести» (F06); тянет все реакции каждого поста (F04); отдельный запрос на каждое медиа упирается в лимит 100/мин (F05) |
| E-03 Правка и публикация черновика            | работает с проблемами | опубликованный черновик остаётся на дате создания (F06)                                                                                            |
| E-04 Реакции и комментарии                    | работает с проблемами | комментарии обрезаются на 200 без пагинации, автор поста не может чистить комментарии, уведомлений нет (F12); реакция — произвольная строка (F04)  |
| E-05 Избранное                                | работает с проблемами | гонка переключателя → 409 (F13)                                                                                                                    |
| E-06 Репост и «Поделиться»                    | работает с проблемами | цитата оригинала уходит тем, кому оригинал не виден, и живёт после удаления модератором (F02)                                                      |
| E-07 Закрепление и модерация поста            | работает с проблемами | модераторы и админы не видят в ленте посты, которые вправе снимать (F03); кнопки без проверки ранга (F16)                                          |
| E-08 Просмотр поста                           | работает с проблемами | N+1 запросов за ссылками на медиа (F05); просмотры без дедупликации (F14)                                                                          |
| E-09 Медиа профиля и альбомы                  | работает с проблемами | объекты удалённого аккаунта остаются в публичном бакете (F10); нет квоты, постер сносится до проверки нового (F26)                                 |
| E-10 Статьи профиля                           | работает с проблемами | закрытый профиль не закрывает статьи (F07); нет пути модерации (F08); список отдаёт полный текст (F18)                                             |
| E-11 Комментарии и закладки статей            | работает с проблемами | `GET /profile/bookmarks` без перепроверки видимости и без потребителя (F18); гонка закладки (F13); тестов нет (F27)                                |
| E-12 Опросы профиля                           | работает с проблемами | закрытый профиль не закрывает опросы (F07); фильтр видимости после `take 100` (F17); `anonymous` ни на что не влияет (F17)                         |
| E-13 Сторисы: публикация                      | работает              | гонка на один `fileId` (F19)                                                                                                                       |
| E-14 Сторисы: кольца, просмотры, голос        | работает              | блокировка не скрывает сторис (F09)                                                                                                                |
| E-15 Сторисы: удаление и истечение            | работает              | строки File брошенных загрузок не убираются (F15)                                                                                                  |
| E-16 Друзья: заявки                           | работает с проблемами | блокировка не разрывает дружбу и не гасит заявку (F09); встречные заявки дают две строки (F20)                                                     |
| E-17 Друзья: списки и статус                  | работает с проблемами | удалённые и заблокированные остаются в друзьях (F20)                                                                                               |
| E-18 Мероприятия: создание/правка/удаление    | работает с проблемами | правки в вебе нет вовсе, правка одного кода доступа стирает ссылку на встречу, участников не уведомляют (F21)                                      |
| E-19 Мероприятия: лента, регистрация, встреча | работает с проблемами | кэш списка событий общий с виджетом «4 ближайших» — страница событий и календарь показывают 4 события (F11); регистрация на прошедшее (F21)        |
| E-20 Комментарии и напоминание                | работает с проблемами | пропущенный тик крона или событие, созданное позже чем за 55 мин, — напоминания нет (F22)                                                          |
| E-21 Глобальный поиск и упоминания            | работает с проблемами | подсказка упоминаний шлёт 1-символьный запрос → 422, без debounce, по 6 источникам (F23); события ALL не находятся (F23)                           |
| E-22 Портфолио                                | **сломан (утечка)**   | PRIVATE/UNIVERSITY-записи уходят в публичное резюме по ссылке и работодателю (F01); тестов нет (F27)                                               |
| E-23 Профиль как соцвитрина                   | работает с проблемами | сортировка постов по частично загруженным страницам, бейджи с потолком, бесконечные тосты при ошибке (F25)                                         |

### Проблемы

#### E-F01 [P0] PRIVATE- и UNIVERSITY-записи портфолио уходят в публичное резюме и в карточку работодателя

- Процесс: E-22 (потребители — карьерный модуль)
- Где: apps/api/src/modules/career/resume.service.ts:133-148 (`publicBySlug`, `@Public()` — apps/api/src/modules/career/resume.controller.ts:95-101) → :173-183 (`portfolioItems` без `where` по `visibility`); apps/api/src/modules/career/career-profile.service.ts:281-294 (`loadSource`, тот же select без фильтра) → :211-221 (`portfolio` в ответе `cardForEmployer`). Правильная семантика есть только в apps/api/src/modules/portfolio/portfolio.service.ts:48-63 (`listForUser`: PRIVATE скрыт, UNIVERSITY — только своему вузу).
- Суть: запись портфолио с `visibility=PRIVATE` («только владельцу») или `UNIVERSITY` («только своему вузу») попадает (1) в JSON публичного резюме — эндпоинт без аутентификации, ссылку студент рассылает работодателям и она пересылается дальше; (2) в карточку кандидата, которую открывает внешняя компания (`career_candidate_viewed`), — компания по определению вне вуза. Предпосылка — студент опубликовал резюме или открыл карьерный профиль работодателям, но флаг приватности конкретной записи при этом молча игнорируется. Дополнительно оба запроса сортируют только по `order` (у всех записей одинаковый, поле через API не меняется) и режут `take: 50` — какие записи попадут, не определено.
- Решение: в обоих select добавить `where: { visibility: 'PUBLIC' }` (для работодателя и публичной ссылки UNIVERSITY тоже наружу не идёт); сортировку взять из `ITEM_ORDER` портфолио; вынести выборку «портфолио для внешнего зрителя» в `PortfolioService` и звать её из career, чтобы правило жило в одном месте. В UI резюме показать, что PRIVATE/UNIVERSITY-записи в него не входят. Тест: PRIVATE-запись не попадает ни в `publicBySlug`, ни в `cardForEmployer`.
- Файлы для правки: apps/api/src/modules/career/resume.service.ts; apps/api/src/modules/career/career-profile.service.ts; apps/api/src/modules/portfolio/portfolio.service.ts; спеки career + новый portfolio.service.spec.ts.
- Стоп-точки: нет (меняется только содержимое ответа; формат прежний)

#### E-F02 [P1] Цитата оригинала в репосте отдаётся без проверки видимости — и после удаления оригинала модератором

- Процесс: E-06, E-07
- Где: apps/api/src/modules/posts/posts.service.ts:110-112 (`original: { select: { id, title, content, author } }` — без `deletedAt`/`audience`/`status`), :468-514 (`repost` запрещает только PERSONAL и неопубликованное); apps/web/src/widgets/feed-list/lib/use-repost-source.ts:28-40 (оригинал невиден → `unavailable`); apps/web/src/widgets/feed-list/ui/post-card.tsx:213-226 (в состоянии `unavailable` рисуется `post.original.title/content` из ответа ленты); apps/api/src/modules/complaints/complaints.service.ts:683-685 (жалоба мягко удаляет только сам пост).
- Суть: (1) Модератор снял нарушающий пост (вручную или по жалобе) — `deletedAt` проставлен, но каждый репост продолжает отдавать его заголовок и текст: `GET /posts/:id` оригинала отвечает 404, клиент падает в «цитату», а цитата приходит в ленте. Снятие контента не работает для всех репостов. (2) Преподаватель видит пост аудитории TEACHERS (или FACULTY своего факультета) и репостит его в GROUP/PERSONAL студенту — студент получает текст оригинала, который ему не виден: сервер отдаёт `original` любому зрителю репоста. Запрет PERSONAL (ссылка на BACKEND_RULES §14.7) закрывает лишь один из таких случаев.
- Решение: в `original` выбирать `deletedAt, status, audience, universityId, facultyId, groupId, targetUserId, authorId`; в `decorateFeed`/`getById` обнулять `original` (оставляя только `id`), если оригинал удалён, не PUBLISHED или не проходит `visibilityWhere` зрителя (одна дополнительная выборка `post.findMany({ where: { id: { in: originalIds }, ...visibilityWhere } })` на страницу). При репосте дополнительно запретить аудиторию шире аудитории оригинала (минимум — TEACHERS/PERSONAL нельзя репостить в студенческие аудитории). Веб: в `unavailable` показывать «Публикация недоступна» вместо цитаты.
- Файлы для правки: apps/api/src/modules/posts/posts.service.ts; posts.service.spec.ts; apps/web/src/widgets/feed-list/ui/post-card.tsx, post-tile.tsx, post-lightbox.tsx.
- Стоп-точки: нет (поле `original` остаётся, меняется наполнение)

#### E-F03 [P1] Модераторы и админы не видят в ленте посты, которые вправе снимать и закреплять

- Процесс: E-07, E-02
- Где: apps/api/src/modules/posts/posts.service.ts:181-206 (`visibilityWhere`: FACULTY — только при `viewer.facultyId`, GROUP — только при `viewer.groupId`, TEACHERS — только роли TEACHER); :734-752 (`assertModerator` разрешает DEAN — свой факультет, UNIVERSITY_ADMIN/MODERATOR — свой вуз, платформе — всё); apps/web/src/app/moderator/platform/posts/page.tsx и apps/web/src/app/moderator/university/posts/page.tsx (оба рендерят обычный `FeedView` с той же видимостью).
- Суть: экран «Посты» модератора — это личная лента модератора. У PLATFORM_MODERATOR нет вуза → он видит только аудиторию ALL, а её публикует лишь PLATFORM_ADMIN, которого он по рангу снимать не вправе: экран пуст для модерации. UNIVERSITY_MODERATOR/ADMIN не видят ни одного поста FACULTY/GROUP/TEACHERS своего вуза — то есть всех студенческих постов (студенты публикуют только GROUP/PERSONAL). Декан не видит GROUP-посты групп своего факультета, хотя `assertModerator` разрешает ему их снимать. Матрица §2.2 («Посты — модерация: ✅ все / ✅ свои / ⚠️ факультет») не выполняется: проактивная модерация невозможна, остаются только жалобы.
- Решение: для ролей модерации расширять видимость scope-ом: PLATFORM_* — без фильтра по аудитории (кроме PERSONAL чужих); UNIVERSITY_ADMIN/MODERATOR — `universityId = свой` для всех аудиторий кроме PERSONAL; DEAN — `facultyId = свой` (FACULTY+GROUP). Делать это отдельным фильтром (`filter=MODERATION` или отдельная ручка `GET /posts/moderation`), чтобы личная лента админа не превратилась в поток всего вуза. Заодно решить про TEACHERS для DEAN/UNIVERSITY_ADMIN.
- Файлы для правки: apps/api/src/modules/posts/posts.service.ts (+controller при отдельной ручке); packages/shared-schemas/src/posts.ts (значение фильтра); apps/web/src/views/feed/ui/feed-view.tsx; posts.service.spec.ts.
- Стоп-точки: контракт API/shared-schemas (новое значение фильтра или новая ручка)

#### E-F04 [P1] Лента выгружает все реакции каждого поста; реакция — произвольная строка

- Процесс: E-02, E-04, E-08
- Где: apps/api/src/modules/posts/posts.service.ts:109 (`reactions: { select: { emoji, userId } }` — отношение без `take` в `POST_SELECT_BASE`, уходит в каждую страницу ленты, профиля и в `getById`); packages/shared-schemas/src/posts.ts:73 (`emoji: z.string().min(1).max(16)` — любой текст); posts.service.ts:646-654 (upsert по `[postId,userId,emoji]`); apps/web/src/widgets/feed-list/ui/post-card.tsx:106,117,237 и widgets/feed-list/ui/post-tile.tsx:130 (веб считает `reactions.length` и ищет свой ❤️ перебором).
- Суть: объявление вуза на 10 000 студентов набирает тысячи лайков — каждая страница ленты (20 постов) везёт все строки реакций всех постов с `userId`, т. е. десятки тысяч объектов на запрос и на клиенте в кэше React Query. Комментарий в самом файле (:75-85) и `StoriesService.decorate` (stories.service.ts:239-245) уже фиксируют этот анти-паттерн, но для реакций постов он остался. Усиление: эмодзи не из белого списка, и один пользователь может поставить на пост неограниченно много «реакций» `a1`, `a2`, … (лимит 100/мин) — накрутка счётчика лайков и раздувание ответа ленты для всех читателей.
- Решение: как у сторис — `groupBy(['postId','emoji'])` по id страницы + отдельный запрос «мои реакции» в `decorateFeed`/`getById`; в ответе `reactions: { emoji, count, mine }[]`. Белый список эмодзи в `ReactionSchema` (веб использует только ❤️). Веб: счётчик из `count`, «лайкнул» из `mine`.
- Файлы для правки: apps/api/src/modules/posts/posts.service.ts; packages/shared-schemas/src/posts.ts; apps/web/src/entities/post/model/types.ts; widgets/feed-list/ui/post-card.tsx, post-tile.tsx, post-lightbox.tsx; widgets/user-profile/ui/profile-posts.tsx (сортировка «популярное»); apps/api/openapi.json.
- Стоп-точки: контракт API/shared-schemas (форма `reactions` в ответе, валидация emoji)

#### E-F05 [P1] Ссылка на каждое медиа ленты — отдельный запрос; лента упирается в лимит 100 запросов/мин

- Процесс: E-02, E-08, E-23
- Где: apps/web/src/widgets/feed-list/ui/post-media.tsx:48-58 (`useQuery → fetchPostMediaLink(postId, media.id)` на каждую плитку, без привязки к видимости на экране); apps/web/src/widgets/feed-list/ui/post-card.tsx:394-427 (до 4 плиток на карточку); apps/web/src/widgets/feed-list/ui/feed-list.tsx:79-86 (рендерятся все карточки всех загруженных страниц); apps/api/src/modules/posts/posts.service.ts:388-405 (каждый вызов — `findVisibleOrThrow` с OR на 7 веток + поиск файла + подпись); apps/api/src/app.module.ts:109 (`throttlers: [{ ttl: 60_000, limit: 100 }]` на пользователя, `@SkipThrottle` в проекте не используется).
- Суть: страница ленты из 20 постов с картинками даёт до 80 запросов `GET /posts/:id/media/:fileId/url` (плюс `GET /posts/:id` на каждый репост — use-repost-source.ts:29-36), каждый — полный запрос видимости к таблице постов. Пролистав 2–3 страницы за минуту, пользователь получает 429; React Query повторяет запрос (retry: 1), плитки уходят в «битое медиа». Одновременно растёт нагрузка на БД: N запросов видимости вместо одного. Сторис эту же задачу решают батчем (stories.service.ts:293-294 — `getPresignedUrls` + `media.describe` в одной выдаче). (Расчёт по коду, не замер.)
- Решение: подписывать ссылки и собирать варианты в `decorateFeed`/`getById` батчем (`files.getPresignedUrls(ids)` + `media.describe(files)`), как в `StoriesService.decorate`; отдельную ручку оставить только для продления истёкшей ссылки. Если подпись в ленте нежелательна — батч-ручка `GET /posts/media-urls?ids=…` и запрос только для карточек в зоне видимости.
- Файлы для правки: apps/api/src/modules/posts/posts.service.ts; apps/web/src/entities/post/model/types.ts; widgets/feed-list/ui/post-media.tsx, media-frame.tsx; apps/api/openapi.json.
- Стоп-точки: контракт API (новые поля медиа в ответе ленты)

#### E-F06 [P1] Порядок ленты: свежий пост тонет — приоритет аудитории раньше времени, отложенные и черновики по дате создания

- Процесс: E-01, E-02, E-03
- Где: apps/api/src/modules/posts/posts.service.ts:315-320 (`orderBy: pinnedAt, priority, createdAt, id`); :61-69 (ALL 50 > UNIVERSITY 40 > FACULTY 35 > TEACHERS 32 > GROUP 30 > SUBJECT 25 > PERSONAL 20); :457-461 (`publishDueScheduled` ставит `publishedAt`, `createdAt` не трогает); :576-579 (`publish` черновика — то же); :494-503 (`repost` без `publishedAt`).
- Суть: (1) Сортировка «сначала приоритет, потом время» строгая: любой пост аудитории UNIVERSITY годичной давности стоит выше сегодняшнего поста группы. Студент видит сегодняшний пост старосты только пролистав все объявления вуза за всё время. §3.3 PROJECT.md описывает приоритет контента, но не «приоритет без учёта возраста». (2) Отложенный на завтра 9:00 пост, созданный сегодня в 15:00, после публикации кроном встаёт на позицию 15:00 вчерашнего дня — под всеми постами того же приоритета, написанными за ночь; черновик недельной давности после «Опубликовать» уходит на неделю вниз. (3) У репоста `publishedAt = null`, в отличие от create.
- Решение: сортировать по моменту выхода к читателю: `publishedAt` (для старых строк — `COALESCE(published_at, created_at)` через заполнение в миграции данных); приоритет применять внутри временного окна (например, день/неделя: `pinnedAt, date_trunc('day', publishedAt) desc, priority desc, publishedAt desc, id`) или как бонус к времени — решение продукта. Индекс ленты пересобрать под новый ключ (рукописный SQL, как в 20261010131500_feed_order_index). В `repost` проставлять `status/publishedAt` как в create.
- Файлы для правки: apps/api/src/modules/posts/posts.service.ts; prisma/schema/05-posts.prisma + новая миграция (индекс, заполнение `published_at`); posts.service.spec.ts; docs/PROJECT.md §3.3.
- Стоп-точки: миграция (индекс + данные)

#### E-F07 [P1] Статьи и опросы закрытого профиля доступны всем по прямому запросу, включая работодателей и другие вузы

- Процесс: E-10, E-12, E-23
- Где: apps/api/src/modules/profile-content/profile-content.service.ts:458-480 (`listArticles` — только `visibility` статьи), :546-560 (`viewerVisibilityWhere`), :562-583 (`assertArticleVisible` — читалка, комментарии, закладки, просмотры); apps/api/src/modules/polls/polls.service.ts:109-134, 230-240 (`listByUser`/`get`/`visibleTo`). Для сравнения медиа и альбомы проверяют профиль: profile-content.service.ts:164-165, 278 (`users.canViewProfileContent`), и комментарий там же прямо говорит «по видимости профиля, как и статьи рядом» — для статей это неправда. Дефолты: packages/shared-schemas/src/profile.ts:32, 54 (`visibility: 'ALL'` у статьи и опроса); у студента `profileVisibility` по умолчанию UNIVERSITY (docs/PROJECT.md §3.7).
- Суть: студент с профилем UNIVERSITY/PRIVATE видит у чужих «Профиль закрыт» и считает, что его контент скрыт, но статья или опрос с дефолтной видимостью ALL отдаются `GET /profile/:userId/articles`, `GET /polls/by-user/:userId`, `GET /polls/:id` любому вошедшему — студенту другого вуза и EMPLOYER (у них нет `@Roles`-ограничений). Веб вкладки на «визитке» прячет (public-user-profile.tsx:214-228), поэтому дыра видна только при прямом запросе — классический обход приватности через API (BACKEND_RULES §14.7). Кроме того, `listArticles` ищет автора без `deletedAt: null` (:459-462) — статьи удалённого аккаунта продолжают отдаваться (см. F10).
- Решение: во всех точках чтения статей и опросов (list, get/читалка, related, comments list/add, bookmark, view, vote, poll comments) первым шагом звать `users.canViewProfileContent(viewer, authorId)` и при `false` отвечать пустым списком / NOT_FOUND, затем применять `visibility` объекта. Для `get` по id — выборка автора вместе с объектом, без лишнего круга.
- Файлы для правки: apps/api/src/modules/profile-content/profile-content.service.ts; apps/api/src/modules/polls/polls.service.ts (+ PollsModule импортирует UsersModule); спеки обоих модулей.
- Стоп-точки: нет

#### E-F08 [P1] Контент профиля нельзя ни обжаловать, ни снять модератором

- Процесс: E-09, E-10, E-11, E-12 (и комментарии к событиям)
- Где: packages/shared-schemas/src/complaints.ts:5 и prisma/schema/_enums.prisma:143-149 (`ComplaintTargetType`: POST, STORY, COMMENT, MESSAGE, USER — нет статьи, опроса, медиа профиля, комментария к статье/опросу/событию); apps/api/src/modules/complaints/complaints.service.ts:652-659 (COMMENT = только `comment` поста); удаление только владельцем: profile-content.service.ts:176-184 (медиа), :501-504 (статья), :621-637 (комментарий — автор или владелец статьи); polls.service.ts:216-222, 360-370.
- Суть: статья с видимостью ALL читается всей платформой, фото лежат в публичном бакете, опрос и комментарии к ним видит вся аудитория — но ни жалобы на них подать нельзя, ни модератор (платформы или вуза) не может их снять: ручек нет, а `ComplaintTargetType` эти сущности не знает. Единственный рычаг — блокировка автора целиком, и даже она контент не скрывает (статьи блокированного/удалённого отдаются, F07/F10). Матрица §2.2 даёт модераторам «Посты — модерация», а контент профиля фактически тот же публичный контент.
- Решение: расширить `ComplaintTargetType` (ARTICLE, POLL, PROFILE_MEDIA, CONTENT_COMMENT, EVENT_COMMENT), научить `getTarget/softDeleteTarget` их владельцам-модулям (по образцу `StoriesService.removeByModeration`); дать модераторам scope удаление по тем же правилам, что у постов (`isHigherRole` + scope); в вебе — пункт «Пожаловаться» в меню статьи/опроса/медиа.
- Файлы для правки: prisma/schema/_enums.prisma + миграция; packages/shared-schemas/src/complaints.ts; apps/api/src/modules/complaints/complaints.service.ts; profile-content, polls, events сервисы; features/report-content в вебе.
- Стоп-точки: миграция (enum), контракт API/shared-schemas

#### E-F09 [P1] Блокировка не действует на соцчасть: дружба остаётся и продолжает открывать закрытый профиль

- Процесс: E-16, E-17, E-09…E-14
- Где: apps/api/src/modules/chats/chats.service.ts:2847-2864 (`blockUser` пишет только `userBlock`, дружбу и заявки не трогает); apps/api/src/modules/users/users.service.ts:1078-1103 (`resolveAccessWithFriendship`: ACCEPTED-дружба → `full`, блокировки не проверяет); apps/api/src/modules/friends/friends.service.ts:130-145 (`accept` без проверки блокировки); блокировка проверяется только в `sendRequest` (:69-80).
- Суть: сценарий травли: человек блокирует бывшего друга. Дружба остаётся ACCEPTED → заблокированный по-прежнему видит полную анкету закрытого (PRIVATE) профиля, фото, видео и альбомы (`canViewProfileContent` → `full`), остаётся в списке друзей и счётчике. Висящую заявку от заблокированного можно случайно принять. Кроме того, ни посты, ни сторис, ни статьи/опросы, ни комментарии не учитывают `UserBlock` — заблокированный продолжает комментировать посты и статьи того, кто его заблокировал.
- Решение: в `blockUser` в одной транзакции удалять `Friendship` между парой (любого статуса) и гасить уведомление-заявку; в `resolveAccessWithFriendship` при наличии блокировки в любую сторону возвращать `limited`; в `accept` проверять блокировку. Отдельной задачей — не давать заблокированному комментировать/реагировать на контент заблокировавшего и скрывать его сторис/контент (решение продукта о глубине).
- Файлы для правки: apps/api/src/modules/chats/chats.service.ts; apps/api/src/modules/users/users.service.ts; apps/api/src/modules/friends/friends.service.ts; спеки chats/users/friends.
- Стоп-точки: нет

#### E-F10 [P1] Удаление аккаунта оставляет соцконтент: фото и видео в публичном бакете, статьи, опросы, портфолио

- Процесс: E-09, E-10, E-12, E-22 (стык с A-14)
- Где: apps/api/src/modules/users/users.service.ts:1550-1640 (`softDeleteSelf` — анонимизирует поля User), :1641-1660 (`deleteUserMedia` сносит только аватар и обложку); медиа профиля — публичный бакет с постоянными URL (profile-content.service.ts:72-75, 231); apps/api/src/modules/profile-content/profile-content.service.ts:459-462 (автор статей ищется без `deletedAt`); apps/api/src/modules/polls/polls.service.ts:109-118 (автор не проверяется вовсе); apps/api/src/modules/portfolio/portfolio.service.ts:51-55 (`findUnique` без `deletedAt`).
- Суть: после «Удалить аккаунт» личные фото и видео человека остаются доступны по прямым ссылкам публичного бакета навсегда (а такие ссылки уже разошлись: лайтбокс, обложки статей), его статьи и опросы продолжают отдаваться по `GET /profile/:id/articles` и `GET /polls/by-user/:id` (с автором «Удалённый пользователь», но с исходным текстом), PUBLIC-портфолио — по `GET /portfolio/user/:id`. PROJECT.md §11.3 и комментарий `softDeleteSelf` обещают затирание ПДн; для контента профиля это не выполняется — риск по закону РК о персональных данных.
- Решение: в `softDeleteSelf` (или очередью, т. к. объектов может быть много) удалять File бакетов profile-media/profile-covers владельца вместе с объектами, `ProfileArticle`, `Poll`, `Album`, `PortfolioItem`, `Bookmark`; во всех читателях этих сущностей фильтровать автора `deletedAt: null`. Посты/комментарии остаются tombstone-ом как сейчас (это решено отдельно).
- Файлы для правки: apps/api/src/modules/users/users.service.ts; profile-content/polls/portfolio сервисы; при переносе в очередь — воркер; спеки.
- Стоп-точки: потеря данных (необратимое удаление — согласовать объём с человеком)

#### E-F11 [P1] Список событий и календарь показывают 4 события: общий ключ кэша с виджетом главной

- Процесс: E-19
- Где: apps/web/src/entities/event/api/event-api.ts:12 (`list: (filter, mine) => ['events','list',filter,mine]` — без `limit`), :19-24 (`fetchEvents`); apps/web/src/views/home/ui/home-sidebar.tsx:26-29 (`fetchEvents({ limit: 4 })` под ключом `list('upcoming')`); apps/web/src/views/events/ui/events-view.tsx:49-52 (limit 50, тот же ключ); apps/web/src/views/calendar/ui/calendar-view.tsx:73-76 (limit 50); apps/web/src/views/tasks/ui/tasks-view.tsx:75-78 (limit 30); apps/web/src/shared/api/query-client.ts:9 (`staleTime: 60_000`, `refetchOnWindowFocus: false`).
- Суть: главная — стартовый экран; её сайдбар кладёт в кэш `['events','list','upcoming',false]` четыре события. Перешёл в «Мероприятия», «Календарь» или «Задачи» в течение минуты — экран берёт из кэша эти 4 события и не перезапрашивает (данные «свежие»); после истечения staleTime перезапрос пойдёт тем `queryFn`, чьи опции применились последними, т. е. результат зависит от порядка навигации. Обратная ситуация — 50 событий в сайдбаре (он режет `slice(0, 4)`, это безвредно). Пользователь не видит часть предстоящих событий и не может на них зарегистрироваться.
- Решение: включить `limit` (и все параметры запроса) в ключ: `eventKeys.list(filter, mine, limit)`; инвалидация по префиксу `['events','list']` остаётся рабочей.
- Файлы для правки: apps/web/src/entities/event/api/event-api.ts; home-sidebar.tsx; events-view.tsx; calendar-view.tsx; tasks-view.tsx.
- Стоп-точки: нет

#### E-F12 [P2] Комментарии: жёсткий потолок без пагинации, автор поста не может чистить обсуждение, уведомлений нет

- Процесс: E-04, E-11, E-12, E-20
- Где: apps/api/src/modules/posts/posts.service.ts:662-670 (`take: 200`, `asc` — отдаются САМЫЕ СТАРЫЕ 200); profile-content.service.ts:597-605 и polls.service.ts:342-350 (то же); events.service.ts:326-335 (последние 100); apps/web/src/widgets/feed-list/ui/post-lightbox.tsx (commentCount = длина загруженного списка); posts.service.ts:692-712 (`removeComment`: автор комментария или модератор — владелец поста нет, в отличие от статей/опросов); в API нет обработки упоминаний (`grep mention` пусто) и уведомлений автору о комментарии.
- Суть: в обсуждении на 201+ комментарий новые не видны никому (в том числе только что написанный пропадает после перезагрузки), заголовок показывает «200». Автор поста не может убрать оскорбление под своим постом. `@username` подсказывается, но упомянутый ничего не получает.
- Решение: cursor-пагинация комментариев (`createdAt desc` + «показать ранее»), счётчик — из `_count`; разрешить автору поста мягко удалять комментарии под ним (с аудитом); уведомление автору поста и упомянутым через очередь notifications (dedupe).
- Файлы для правки: posts/profile-content/polls/events сервисы и контроллеры; shared-schemas (query комментариев); post-lightbox.tsx, content-comments.tsx, event-detail-view.tsx.
- Стоп-точки: контракт API/shared-schemas (пагинация комментариев)

#### E-F13 [P2] Переключатели закладок без идемпотентности: двойное нажатие → 409

- Процесс: E-05, E-11
- Где: apps/api/src/modules/posts/posts.service.ts:349-363; apps/api/src/modules/profile-content/profile-content.service.ts:641-653 (findUnique → create/delete без транзакции, `P2002` не ловится). Полка SAVED сортируется порядком ленты, а не временем сохранения, хотя индекс `[userId, createdAt]` заведён ровно под это (prisma/schema/05-posts.prisma, модель PostBookmark).
- Суть: два параллельных запроса (двойной тап, повтор после таймаута) — второй `create` падает уникальностью и отвечает 409/500 вместо состояния. Полка «Сохранённое» показывает закреплённые/приоритетные сверху, а не «последнее сохранённое».
- Решение: `deleteMany` → если `count===0`, `create` с перехватом P2002 (= уже сохранено) — или `createMany({ skipDuplicates })`; для SAVED — сортировка по `bookmarks.createdAt`.
- Файлы для правки: posts.service.ts, profile-content.service.ts, спеки.
- Стоп-точки: нет

#### E-F14 [P2] Просмотры постов и статей: +1 на каждое открытие и UPDATE горячей строки

- Процесс: E-08, E-10
- Где: apps/api/src/modules/posts/posts.service.ts:371-378; apps/web/src/widgets/feed-list/ui/post-lightbox.tsx:308-313 (на каждое открытие/пролистывание); profile-content.service.ts:507-515.
- Суть: счётчик накручивается повторными открытиями, а популярный пост получает конкурентные UPDATE одной строки на каждый просмотр (блокировки строки под нагрузкой).
- Решение: учёт уникальных просмотров (таблица `post_views` с unique `[postId,userId]` или Redis HyperLogLog с периодическим сбросом в БД).
- Файлы для правки: posts.service.ts, profile-content.service.ts; при таблице — схема и миграция.
- Стоп-точки: миграция (если таблица)

#### E-F15 [P2] Медиа брошенных форм постов и сторис не убираются

- Процесс: E-01, E-13, E-15
- Где: apps/web/src/features/create-post/ui/create-post-form.tsx:166 (файл грузится до создания поста); apps/api/src/modules/cleanup/cleanup.service.ts:356-379 (`cleanDetachedFiles` чистит только бакеты chat и materials; комментарий говорит, что строка без связей — норма для остальных); posts.service.ts:590-609 (мягкое удаление поста оставляет его File и объекты).
- Суть: закрытая без публикации форма поста оставляет File с `postId = null` и объект в posts-media навсегда; у удалённых постов медиа тоже живёт вечно. Для сторис объект снимет TTL бакета, но строка File остаётся.
- Решение: в `cleanDetachedFiles` добавить `{ bucket: POSTS, postId: null, createdAt < now-24h }` и stories-бакет без сторис старше суток; медиа постов, удалённых больше N дней назад, — отдельной задачей.
- Файлы для правки: apps/api/src/modules/cleanup/cleanup.service.ts; cleanup.service.spec.ts.
- Стоп-точки: потеря данных (удаление объектов — согласовать срок)

#### E-F16 [P2] Кнопки модерации показываются без проверки ранга и scope

- Процесс: E-07, E-18, E-20
- Где: apps/web/src/widgets/feed-list/ui/post-card.tsx:112-115, post-tile.tsx:69-73, post-lightbox.tsx:420-423 (`canModerate` = роль из MODERATOR_ROLES); apps/web/src/views/events/ui/events-view.tsx:35, 208 и event-detail-view.tsx:43, 63, 94 (DEAN видит «Удалить» и список участников у событий вуза, сервер разрешает только свой факультет — events.service.ts:469-485).
- Суть: модератор вуза видит «Удалить/Закрепить» на посте админа вуза, декан — на чужих событиях; нажатие даёт 403-тост. Список участников у декана на событии вуза — ошибка загрузки.
- Решение: отдавать с сервера `canDelete/canPin/canManage` в карточке (как `StoryCard.canDelete`), веб опирается на флаги.
- Файлы для правки: posts.service.ts, events.service.ts (поля в ответе); веб-компоненты выше; openapi.json.
- Стоп-точки: контракт API (новые поля)

#### E-F17 [P2] Опросы: фильтр видимости после `take 100`, флаг `anonymous` пустой, гонка правки с голосом

- Процесс: E-12
- Где: apps/api/src/modules/polls/polls.service.ts:109-123 (`take: 100` по всем опросам автора, затем `filter` в памяти — черновики и узкая видимость съедают выдачу, бейдж вкладки занижен); :60-81, 288-338 (нет ни одной ручки со списком голосовавших — `anonymous=false` ничего не меняет); :185-212 (проверка «голосов нет» вне транзакции, затем `pollOption.deleteMany` каскадом сносит голос, пришедший между проверкой и транзакцией); :172-183 (`cancelVote` без проверки видимости/статуса); :342-358 (комментарии зовут полный `get` с тремя агрегатами ради проверки видимости).
- Решение: фильтр видимости в `where` (как в `viewerVisibilityWhere` статей) + cursor-пагинация; либо реализовать список проголосовавших для неанонимных, либо убрать флаг из формы; правку делать под тем же advisory-локом по опросу с повторной проверкой голосов внутри транзакции; для комментариев — лёгкая проверка видимости.
- Файлы для правки: polls.service.ts, polls.service.spec.ts; poll-create-modal.tsx.
- Стоп-точки: нет

#### E-F18 [P2] Список статей отдаёт полный текст; `GET /profile/bookmarks` без перепроверки видимости и без потребителя

- Процесс: E-10, E-11, E-23
- Где: apps/api/src/modules/profile-content/profile-content.service.ts:33-52 (`content` в ARTICLE_SELECT), :473-478 (`take: 100`; контент до 20 000 символов — packages/shared-schemas/src/profile.ts:26); apps/web/src/widgets/user-profile/ui/profile-tabs.tsx:82-85 (список статей грузится на каждом открытии профиля ради бейджа); profile-content.service.ts:655-666 (закладки без `assertArticleVisible`, веб ручку не вызывает).
- Суть: открытие профиля автора может тянуть до ~2 МБ текста ради мозаики и цифры на вкладке; закладка на статью, ставшую черновиком или сузившую видимость, продолжает отдавать её полный текст.
- Решение: в списке — `description` + первые N символов, полный текст — отдельной ручкой читалки `GET /profile/articles/:id`; закладки фильтровать тем же `viewerVisibilityWhere` (или удалить неиспользуемую ручку).
- Файлы для правки: profile-content.service.ts/controller; веб profile-articles.tsx; openapi.json.
- Стоп-точки: контракт API (форма списка статей)

#### E-F19 [P2] Сторис: гонка на один файл, API не закрыт флагом раскатки

- Процесс: E-13, E-15
- Где: apps/api/src/modules/stories/stories.service.ts:637-648 (`count` занятости файла вне транзакции, `fileId` не уникален — prisma/schema/32-stories.prisma `@@index([fileId])`); apps/web/src/shared/config/features.ts (флаг только в вебе).
- Суть: два одновременных POST /stories с одним fileId создают две сторис на один объект; удаление первой гасит медиа второй. Раздел «за флагом», но `POST /stories` и лента колец доступны любому клиенту.
- Решение: `@@unique([fileId])` (NULL допускаются) или проверка внутри транзакции с локом; серверный флаг раскатки на контроллере.
- Файлы для правки: stories.service.ts; prisma/schema/32-stories.prisma + миграция; stories.controller.ts.
- Стоп-точки: миграция (уникальный индекс)

#### E-F20 [P2] Друзья: встречные заявки дублируются, удалённые и заблокированные остаются в списке, повторные заявки без паузы

- Процесс: E-16, E-17
- Где: apps/api/src/modules/friends/friends.service.ts:82-99 (`findBetween` → `create` без транзакции; unique только `[requesterId, addresseeId]` — prisma/schema/15-friends.prisma:16); :166-191, 194-223, 226-239 (списки и счётчики без `deletedAt: null`/`isBlocked: false`); :148-163 (после отклонения заявку можно слать снова сразу).
- Суть: одновременные A→B и B→A дают две PENDING-строки (статус кнопки зависит от того, какую вернёт `findFirst`); «Удалённый пользователь» висит в друзьях и счётчике; отклонённый может бесконечно повторять заявку (каждый раз новое уведомление).
- Решение: каноническая пара (`least/greatest`) с уникальным индексом или advisory-лок по паре; фильтр `deletedAt/isBlocked` в списках и счётчиках; пауза на повторную заявку после отклонения (поле `declinedAt` вместо удаления или Redis-ключ).
- Файлы для правки: friends.service.ts, friends.service.spec.ts; при уникальной паре — схема + миграция.
- Стоп-точки: миграция (если уникальная пара)

#### E-F21 [P2] Мероприятия: правки в вебе нет, частичная правка стирает встречу, участников не уведомляют

- Процесс: E-18, E-19
- Где: apps/web/src/entities/event/api/event-api.ts:46-49 (`updateEventRequest` нигде не вызывается — правки/переноса в вебе нет, вопреки описанию E-18); apps/api/src/modules/events/events.service.ts:255-259 (`meetingFields(input.meetingUrl, input.meetingPasscode)` при `meetingUrl === undefined` возвращает все `null` — PATCH только кода доступа стирает ссылку; смена ссылки без кода стирает код); :237-276, 277-287 (перенос/удаление без уведомления зарегистрированных); :291-301 (регистрация на прошедшее/идущее событие); :118 (`upcoming` = `startsAt >= now` — идущее онлайн-событие уходит в «Прошедшие», пока к нему можно подключиться); :309-316 (участники `take: 1000` без пагинации); :134 (offset-пагинация ленты — BACKEND_RULES §5.3).
- Решение: форма правки в event-detail-view (перенос, место, ссылка); `meetingFields` применять к текущему значению при частичной правке; уведомлять участников о переносе/отмене (очередь notifications, dedupe по `startsAt`); запрет регистрации после `endsAt ?? startsAt+2ч`; `upcoming` = «ещё не закончилось»; cursor-пагинация участников.
- Файлы для правки: events.service.ts, events.service.spec.ts; views/events/ui/event-detail-view.tsx, features/create-event (переиспользовать форму).
- Стоп-точки: нет

#### E-F22 [P2] Напоминание за час теряется при пропущенном тике крона и для поздно созданных событий

- Процесс: E-20
- Где: apps/api/src/modules/events/events.service.ts:42, 382-436 (окно `[now+55, now+70]`); apps/api/src/modules/cleanup/cleanup.service.ts:149 (`*/15`).
- Суть: ширина окна равна шагу крона — каждое событие попадает ровно в один тик. Рестарт/деплой/занятый лок на этом тике — напоминания нет никогда; событие, созданное или перенесённое на время «через 40 минут», напоминания не получит.
- Решение: окно `startsAt <= now+70мин AND startsAt > now` при `reminderSentAt IS NULL` (дедуп уже есть по `reminderSentAt` и `dedupeKey`).
- Файлы для правки: events.service.ts, events.service.spec.ts.
- Стоп-точки: нет

#### E-F23 [P2] Поиск: подсказка упоминаний шлёт невалидные запросы и гоняет все 6 источников; события ALL не находятся

- Процесс: E-21
- Где: apps/web/src/widgets/feed-list/ui/mention-suggest.tsx:45-51 (`enabled` при длине ≥ 1, без debounce) против packages/shared-schemas/src/search.ts:6 (`q.min(2)` → 422 на «@a», retry удваивает); apps/api/src/modules/search/search.service.ts:24-92 (ради людей считаются курсы, задания, материалы, события и чаты); :126-129 (`eventScope` требует `universityId = вуз зрителя` — события ALL с `universityId = null` не находятся никому, кроме платформы).
- Решение: в подсказке — порог 2 символа и debounce (как `use-search-items.ts`), параметр `sources=people` (или отдельная ручка людей); в `eventScope` — `OR: [{ universityId: uni }, { audience: 'ALL' }]` поверх `eventVisibilityWhere`.
- Файлы для правки: mention-suggest.tsx; search.service.ts (+ schema при `sources`); search.service.spec.ts.
- Стоп-точки: контракт API/shared-schemas (если параметр `sources`)

#### E-F24 [P2] Портфолио: чужой просмотр без учёта удаления и закрытого профиля, порядок не меняется

- Процесс: E-22
- Где: apps/api/src/modules/portfolio/portfolio.service.ts:48-63 (`findUnique` без `deletedAt`, без `profileVisibility`; ручку веб не использует); :24-28 (сортировка по `order`, которое API не позволяет менять — packages/shared-schemas/src/portfolio.ts); :38-45, 58-62 (`take: 500` без пагинации, создание без потолка числа записей).
- Решение: `deletedAt: null` + `canViewProfileContent` для чужого просмотра (или удалить неиспользуемую ручку); поле `order` в Update-схеме или ручка перестановки; потолок числа записей на пользователя.
- Файлы для правки: portfolio.service.ts; packages/shared-schemas/src/portfolio.ts.
- Стоп-точки: контракт API/shared-schemas (если `order`)

#### E-F25 [P2] Вкладки профиля: сортировка по частично загруженным страницам, бейджи с потолком, бесконечные тосты

- Процесс: E-23
- Где: apps/web/src/widgets/user-profile/ui/profile-posts.tsx:61-65, 150-159 (сортировки «новые/популярные» и фильтр статусов применяются к уже загруженным страницам, а сервер отдаёт порядок «приоритет → время» — свежий GROUP-пост автора-админа появляется наверху только после догрузки его страницы, мозаика переставляется при каждой подгрузке); profile-tabs.tsx:92-98 (бейджи «Фото/Видео» ≤ 300, «Статьи» ≤ 100, «Опросы» — видимые из последних 100); use-retry-on-error.ts:10-42 (при постоянной ошибке, в т. ч. 429 из F05, — тост и повтор каждые 5 с, пока открыт экран).
- Решение: сортировку и фильтр статуса передавать на сервер (`sort`, `status` в FeedQuery для `authorId`), бейджи — из серверных `total`; в `useRetryOnError` — экспоненциальная пауза и остановка на 4xx.
- Файлы для правки: profile-posts.tsx, profile-tabs.tsx, use-retry-on-error.ts; posts.service.ts + packages/shared-schemas/src/posts.ts при серверной сортировке.
- Стоп-точки: контракт API/shared-schemas (если новые параметры)

#### E-F26 [P2] Медиа профиля: нет квоты, старый постер сносится до проверки нового

- Процесс: E-09
- Где: apps/api/src/modules/profile-content/profile-content.service.ts:145-157, 202-211 (ни числа, ни суммарного объёма на пользователя; видео до 100 МБ в публичный бакет); :256-257 (`removeRawObject` старого постера до `putAuxImage` — невалидный файл оставляет `posterKey` на удалённый объект; тот же паттерн, что A-F14 у аватара).
- Решение: квота на пользователя (число и байты, константы в shared-config); удалять прежний постер после успешной записи нового и обновления `posterKey`.
- Файлы для правки: profile-content.service.ts; packages/shared-config.
- Стоп-точки: нет

#### E-F27 [P2] Пробелы в тестах

- Процесс: E-11, E-12, E-21, E-22, E-23, E-02
- Где: модуль portfolio — ни одного теста; apps/api/src/modules/profile-content/profile-content.service.spec.ts — нет комментариев и закладок статей; apps/api/src/modules/polls/polls.service.spec.ts (74 строки) — только голосование, нет видимости `listByUser/get`, правки, удаления, комментариев; apps/api/src/modules/search/search.service.spec.ts — 2 кейса, нет scope курсов/заданий/материалов; веб: нет тестов stories-rail, events-view/detail, portfolio-view, profile-tabs/use-progressive; e2e только посты и лента.
- Решение: в первую очередь регрессии на F01 (PRIVATE не уходит наружу), F02, F07, F09, F11.
- Файлы для правки: соответствующие *.spec.ts / *.test.tsx.
- Стоп-точки: нет

#### E-F28 [P2] Аудитории SUBJECT и TEACHERS расходятся с названием

- Процесс: E-01, E-02, E-18
- Где: apps/api/src/modules/posts/posts.service.ts:189-192 и apps/api/src/modules/events/event-visibility.ts:14-17 (SUBJECT виден всему вузу — модели Subject в посте нет, `subject` — свободная строка, prisma/schema/05-posts.prisma); TEACHERS видит только роль TEACHER — декан и админ вуза (кроме автора) не видят.
- Суть: преподаватель выбирает «Предмет: Математика», а пост читает весь вуз; декан не видит рассылку «для преподавателей» своего вуза.
- Решение: привязать SUBJECT к курсу (`courseId`, видимость — студенты групп курса) или переименовать аудиторию в «Вуз (от преподавателя)»; TEACHERS — открыть DEAN/UNIVERSITY_ADMIN своего вуза. Решение продукта.
- Файлы для правки: posts.service.ts, event-visibility.ts, shared-schemas, веб create-post-form.
- Стоп-точки: миграция и контракт API (если `courseId`)
