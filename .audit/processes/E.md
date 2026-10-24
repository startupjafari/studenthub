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
