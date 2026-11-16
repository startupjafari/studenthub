// Шаг «соцчасть, добор»: то, что шаги 50 и 55 оставляют пустым. Сторисы (живые,
// с опросами, просмотрами и реакциями), «Актуальное», скрытие сторис, обсуждение событий
// с реакциями, лайки статей, избранное ленты, комментарии к опросам, репосты и
// предупреждения модерации.
//
// БЕЗ МЕДИА. Ни одной строки File и ни одного объекта в MinIO: сторис — только текстовые
// (текст на фоне из STORY_BACKGROUNDS, опрос, ссылка, эмодзи-элемент). Схема это
// допускает: Story.fileId nullable, а CreateStorySchema требует медиа ИЛИ текст ИЛИ
// элемент — текста достаточно. Элементы «Актуального» тоже без копии файла (fileId NULL).
//
// ИСТЁКШИХ СТОРИС НЕТ НАМЕРЕННО. Крон deleteExpiredStories каждые 30 минут физически
// удаляет всё с expiresAt <= now, а лента их не показывает уже сейчас. Строка «истёкшей»
// сторис — это мусор, который не увидит никто. Старые сторисы живут там же, где в продукте:
// снимками в «Актуальном» (sourceStoryId = NULL — исходник уже снят кроном). Живые сторисы
// созданы в пределах последних суток и истекут в течение суток после прогона — так ведёт
// себя и настоящий продукт.
//
// Зависимости: посты, события, дружбы (шаг 50), статьи и опросы (шаг 55) уже в БД.
// Их не пересчитываем по детерминированным id вслепую, а читаем из базы с take: при
// диапазонах «0-0» постов или статей нет, и ссылка на них нарушила бы внешний ключ.
// Счётчиков-денормализаций у затронутых родителей нет (лайки, закладки, просмотры сторис
// считаются из таблиц), поэтому апдейтов родительских строк здесь нет.

import { postPriority } from '../data/content.mjs'
import { child, id } from '../lib/ids.mjs'

// Наборы — копии закрытых списков shared-schemas/shared-config: генератор работает на
// чистом node и не тянет собранные пакеты. Менять только вместе с источником.
// STORY_BACKGROUNDS и STORY_REACTION_EMOJIS — packages/shared-schemas/src/stories.ts.
const STORY_BACKGROUNDS = ['sunset', 'ocean', 'forest', 'grape', 'graphite', 'rose']
const STORY_REACTION_EMOJIS = ['❤️', '🔥', '👏', '😮', '😢']
// CHAT_REACTION_EMOJIS — packages/shared-config/src/constants.ts (реакции на комментарии
// к событию идут по правилам чата).
const CHAT_REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '👀']

const STORY_TTL_MS = 24 * 3_600_000

// Тексты сторис — короткие (STORY_TEXT_MAX = 600): сторис читают за секунды.
const STUDENT_STORY_TEXTS = [
  'Сдал(а) коллоквиум! Теперь можно выдохнуть 🎉',
  'Кто в библиотеку после пар? Займу место у окна.',
  'Пятая пара — испытание на прочность.',
  'Наконец-то дописал(а) курсовую. Осталось оформить список литературы.',
  'Утро начинается с кофе и расписания.',
  'Кто знает, перенесли ли семинар на четверг?',
  'Готовимся к хакатону всей командой 💻',
  'Сегодня тренировка в спортзале в 18:00 — присоединяйтесь.',
  'Лекция была огонь, спасибо преподавателю!',
  'Ищу напарника для лабораторной по физике.',
  'Сессия близко, а конспекты далеко.',
  'Первый снег над кампусом ❄️',
]
const STAFF_STORY_TEXTS = [
  'Напоминаем: приём заявлений на справки — через раздел «Заявки».',
  'Открыта регистрация на день открытых дверей.',
  'Расписание консультаций перед сессией уже опубликовано.',
  'Поздравляем победителей студенческой олимпиады!',
  'Библиотека работает до 20:00 всю неделю сессии.',
  'Деканат принимает документы с 9:00 до 17:00, обед с 13:00 до 14:00.',
]
// Опрос сторис: 2–4 варианта, без повторов (StoryPollSchema).
const STORY_POLLS = [
  ['Во сколько удобнее консультация?', ['14:00', '16:00', '18:00']],
  ['Идём на студенческий вечер?', ['Конечно', 'Не получится']],
  ['Самый сложный предмет семестра?', ['Математика', 'Физика', 'Программирование', 'Философия']],
  ['Где готовиться к сессии?', ['Библиотека', 'Дома', 'Коворкинг']],
  ['Кофе или чай перед парой?', ['Кофе', 'Чай']],
  ['Нужен ли разбор задач перед экзаменом?', ['Да, обязательно', 'Справлюсь сам(а)']],
]
// Названия подборок «Актуального» — до 30 символов (STORY_HIGHLIGHT_TITLE_MAX).
const HIGHLIGHT_TITLES = ['Учёба', 'Сессия', 'Спорт', 'Друзья', 'Хакатон', 'Кампус', 'Поездки', 'Олимпиады'] // prettier-ignore
const STAFF_HIGHLIGHT_TITLES = ['Новости', 'Важное', 'Мероприятия']

// Обсуждение события: вопросы аудитории и ответы организатора.
const EVENT_COMMENTS = [
  'А регистрация обязательна?',
  'Можно прийти с другом из другой группы?',
  'Во сколько закончится?',
  'Будет ли запись для тех, кто не сможет прийти?',
  'Отличная идея, обязательно буду!',
  'Нужно ли что-то взять с собой?',
  'Засчитают ли участие в волонтёрские часы?',
  'Спасибо за организацию, было очень полезно.',
]
const EVENT_REPLIES = [
  'Да, регистрация по кнопке «Участвую».',
  'Приходите, места хватит всем.',
  'Запись выложим в течение недели.',
  'Ничего не нужно, всё выдадим на месте.',
]
const POLL_COMMENTS = [
  'Проголосовал(а), интересно, что выберут остальные.',
  'Не хватает варианта «другое».',
  'Ожидаемый результат.',
  'Хороший вопрос, давно хотел(а) спросить.',
  'Давайте обсудим на паре.',
]
const REPOST_CAPTIONS = ['', '', 'Советую прочитать.', 'Полезно для всей группы.', 'Сохраните себе.'] // prettier-ignore

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000)
// Момент позже опорного, но не в будущем: лайк или закладка не бывают раньше публикации.
const after = (random, base, maxDays) => {
  const from = base ? base.getTime() : Date.now() - maxDays * 86_400_000
  const span = Math.max(0, Date.now() - from)
  return new Date(from + Math.floor(random.rng() * span))
}

export async function seedSocialExtras(prisma, writer, ctx) {
  const { index, random, structure, people } = ctx
  const { uniId } = structure
  const stats = { stories: 0, highlights: 0, eventComments: 0, warnings: 0 }

  const allStudents = people.faculties.flatMap((f) => f.groups.flatMap((g) => g.studentIds))
  const facultyOf = new Map()
  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      for (const studentId of group.studentIds) facultyOf.set(studentId, faculty.id)
    }
  }
  // Живые сторисы автора: часть из них попадает в его «Актуальное» (шаг ниже).
  const liveStories = new Map()

  // ── Сторис: строка, опрос, просмотры, реакции, голоса ──────────────────────
  // viewers — кто реально может видеть сторис по её аудитории (audienceConditions в
  // stories.service): автор в зрители не пишется, сервис свой просмотр не фиксирует.
  const addStory = async (authorId, k, story, viewers, { withPoll = false } = {}) => {
    const storyId = child(authorId, 'story', k)
    const createdAt = minutesAgo(random.randInt(10, 23 * 60))
    const row = {
      id: storyId,
      authorId,
      audience: story.audience,
      universityId: story.universityId ?? null,
      facultyId: story.facultyId ?? null,
      groupId: story.groupId ?? null,
      audienceUserIds: story.audienceUserIds ?? [],
      text: story.text,
      background: random.pick(STORY_BACKGROUNDS),
      linkUrl: story.linkUrl ?? null,
      linkLabel: story.linkLabel ?? null,
      // Эмодзи-стикер поверх фона: позиции — доли кадра 0..1 (StoryEmojiElementSchema).
      ...(random.chance(0.3)
        ? {
            elements: [
              {
                type: 'emoji',
                x: 0.2 + random.rng() * 0.6,
                y: 0.15 + random.rng() * 0.2,
                scale: 1 + random.rng(),
                rotation: random.randInt(-20, 20),
                emoji: random.pick(STORY_REACTION_EMOJIS),
              },
            ],
          }
        : {}),
      expiresAt: new Date(createdAt.getTime() + STORY_TTL_MS),
      createdAt,
    }
    await writer.add('story', row)
    stats.stories += 1

    // Опрос — в той же «транзакции» сторис: без вариантов он был бы сломанным экраном.
    let optionIds = []
    let pollId = null
    if (withPoll) {
      const [question, options] = random.pick(STORY_POLLS)
      pollId = child(storyId, 'poll')
      await writer.add('storyPoll', { id: pollId, storyId, question, createdAt })
      optionIds = options.map((_, oi) => child(pollId, 'o', oi))
      for (const [oi, text] of options.entries()) {
        await writer.add('storyPollOption', { id: optionIds[oi], pollId, text, order: oi })
      }
    }

    const elapsed = Date.now() - createdAt.getTime()
    const seenAt = () => new Date(createdAt.getTime() + Math.floor(random.rng() * elapsed))
    const seen = random.sample(viewers, random.randInt(Math.min(2, viewers.length), 15))
    for (const viewerId of seen) {
      const viewedAt = seenAt()
      // Пара (сторис, зритель) уникальна — повторный показ строк не множит.
      await writer.add('storyView', {
        id: `${storyId}-sv-${viewerId}`,
        storyId,
        userId: viewerId,
        createdAt: viewedAt,
      })
      // Реагирует и голосует только тот, кто открыл сторис.
      if (random.chance(0.3)) {
        await writer.add('storyReaction', {
          id: `${storyId}-sr-${viewerId}`,
          storyId,
          userId: viewerId,
          emoji: random.pick(STORY_REACTION_EMOJIS),
          createdAt: viewedAt,
        })
      }
      // Голос одиночный: один на (опрос, человек), вариант — из этого же опроса.
      if (pollId && random.chance(0.6)) {
        await writer.add('storyPollVote', {
          id: `${pollId}-v-${viewerId}`,
          pollId,
          optionId: random.pick(optionIds),
          userId: viewerId,
          createdAt: viewedAt,
        })
      }
    }

    const list = liveStories.get(authorId) ?? []
    list.push(row)
    liveStories.set(authorId, list)
  }

  // Администрация: аудитория UNIVERSITY (ALLOWED_AUDIENCES для админа и модератора вуза).
  const staffAuthors = [people.adminId, ...people.moderatorIds]
  for (const [ai, authorId] of staffAuthors.entries()) {
    const count = ai === 0 ? 2 : random.randInt(0, 1)
    for (let k = 0; k < count; k += 1) {
      await addStory(
        authorId,
        k,
        {
          audience: 'UNIVERSITY',
          universityId: uniId,
          text: random.pick(STAFF_STORY_TEXTS),
          ...(random.chance(0.4)
            ? { linkUrl: 'https://example.kz/news', linkLabel: 'Подробнее' }
            : {}),
        },
        allStudents,
      )
    }
  }

  for (const faculty of people.faculties) {
    const facultyStudents = faculty.groups.flatMap((g) => g.studentIds)
    // Декан — своему факультету, иногда с опросом.
    const deanStories = random.randInt(0, 2)
    for (let k = 0; k < deanStories; k += 1) {
      await addStory(
        faculty.deanId,
        k,
        {
          audience: 'FACULTY',
          universityId: uniId,
          facultyId: faculty.id,
          text: random.pick(STAFF_STORY_TEXTS),
        },
        facultyStudents,
        { withPoll: random.chance(0.3) },
      )
    }

    // Принятые дружбы студентов факультета: из них — аудитория FRIENDS и её зрители.
    // Дружбы шаг 50 строит внутри группы, ≤ 6 исходящих на человека — отсюда потолок.
    const friendRows = await prisma.friendship.findMany({
      where: { status: 'ACCEPTED', requesterId: { in: facultyStudents } },
      select: { requesterId: true, addresseeId: true },
      orderBy: { id: 'asc' },
      take: facultyStudents.length * 7,
    })
    const friendsOf = new Map()
    for (const { requesterId, addresseeId } of friendRows) {
      for (const [a, b] of [
        [requesterId, addresseeId],
        [addresseeId, requesterId],
      ]) {
        const list = friendsOf.get(a) ?? []
        list.push(b)
        friendsOf.set(a, list)
      }
    }

    for (const group of faculty.groups) {
      const members = group.studentIds
      // Блокировка шага 50 — только между первым и последним в группе (и не всегда).
      // Зрителями друг друга их не делаем ни при каком исходе: заблокированный не видит
      // сторис блокирующего, и наоборот.
      const blockPair = new Set([members[0], members[members.length - 1]])
      const viewersFor = (authorId, pool) =>
        pool.filter((uid) => uid !== authorId && !(blockPair.has(authorId) && blockPair.has(uid) && members.length > 7)) // prettier-ignore

      for (const studentId of members) {
        // Сторис публикует примерно каждый третий: лента колец полная, но не у всех.
        if (!random.chance(0.3)) continue
        const count = random.randInt(1, 2)
        for (let k = 0; k < count; k += 1) {
          const friends = friendsOf.get(studentId) ?? []
          const audience = random.pickWeighted([
            ['GROUP', 70],
            ['FRIENDS', friends.length > 0 ? 22 : 0],
            ['SELECTED', members.length > 3 ? 8 : 0],
          ])
          const text = random.pick(STUDENT_STORY_TEXTS)
          if (audience === 'GROUP') {
            await addStory(
              studentId,
              k,
              { audience, universityId: uniId, facultyId: faculty.id, groupId: group.id, text },
              viewersFor(studentId, members),
              { withPoll: random.chance(0.3) },
            )
          } else if (audience === 'FRIENDS') {
            // Личная аудитория: вуз и факультет — автора (authorScope), видимость по дружбе.
            await addStory(
              studentId,
              k,
              { audience, universityId: uniId, facultyId: faculty.id, text },
              viewersFor(studentId, friends),
              { withPoll: random.chance(0.2) },
            )
          } else {
            // Поимённый список: однокурсники без автора и без пары блокировки.
            const recipients = random.sample(viewersFor(studentId, members), random.randInt(2, 5))
            await addStory(
              studentId,
              k,
              {
                audience,
                universityId: uniId,
                facultyId: faculty.id,
                audienceUserIds: recipients,
                text,
              },
              recipients,
            )
          }
        }
      }
    }
  }
  await writer.flush()

  // ── «Актуальное» и скрытие сторис ──────────────────────────────────────────
  // Подборка — снимок: текст, фон и аудитория переносятся, опрос — нет. Старые элементы
  // ссылаются на исходник NULL (тот давно снят кроном), живые — на свою сторис.
  // Обложка (coverItemId) не выбрана: NULL — обложкой служит первый элемент, а ссылка на
  // элемент из строки подборки потребовала бы второго прохода с апдейтом.
  const addHighlight = async (ownerId, hi, title, scope, texts) => {
    const highlightId = child(ownerId, 'hl', hi)
    const createdAt = random.randomDate(-300, -2)
    await writer.add('storyHighlight', { id: highlightId, ownerId, title, position: hi, createdAt })
    stats.highlights += 1
    let position = 0
    const itemCount = random.randInt(2, 5)
    for (let ii = 0; ii < itemCount; ii += 1) {
      await writer.add('storyHighlightItem', {
        id: child(highlightId, 'it', ii),
        highlightId,
        sourceStoryId: null,
        ...scope,
        text: random.pick(texts),
        background: random.pick(STORY_BACKGROUNDS),
        storyCreatedAt: random.randomDate(-400, -2),
        position: position++,
        createdAt,
      })
    }
    // Живая сторис в подборке — снимок с sourceStoryId: по нему сервис не даёт добавить
    // её в ту же подборку повторно. Опрос в снимок не переносится.
    const live = hi === 0 ? (liveStories.get(ownerId) ?? [])[0] : null
    if (live && random.chance(0.5)) {
      await writer.add('storyHighlightItem', {
        id: child(highlightId, 'it', 'live'),
        highlightId,
        sourceStoryId: live.id,
        audience: live.audience,
        universityId: live.universityId,
        facultyId: live.facultyId,
        groupId: live.groupId,
        audienceUserIds: live.audienceUserIds,
        text: live.text,
        background: live.background,
        linkUrl: live.linkUrl,
        linkLabel: live.linkLabel,
        ...(live.elements ? { elements: live.elements } : {}),
        storyCreatedAt: live.createdAt,
        position: position++,
        createdAt: live.createdAt,
      })
    }
  }

  await addHighlight(
    people.adminId,
    0,
    random.pick(STAFF_HIGHLIGHT_TITLES),
    { audience: 'UNIVERSITY', universityId: uniId },
    STAFF_STORY_TEXTS,
  )
  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      const members = group.studentIds
      for (const studentId of members) {
        if (random.chance(0.15)) {
          const titles = random.sample(HIGHLIGHT_TITLES, random.randInt(1, 2))
          for (const [hi, title] of titles.entries()) {
            await addHighlight(
              studentId,
              hi,
              title,
              { audience: 'GROUP', universityId: uniId, facultyId: faculty.id, groupId: group.id },
              STUDENT_STORY_TEXTS,
            )
          }
        }
        // «Скрыть сторис пользователя»: редкая мера, уникальна по паре.
        if (members.length > 1 && random.chance(0.04)) {
          const others = members.filter((uid) => uid !== studentId)
          const mutedUserId = random.pick(others)
          await writer.add('storyMute', {
            id: `${studentId}-smute-${mutedUserId}`,
            userId: studentId,
            mutedUserId,
            createdAt: random.randomDate(-60, -1),
          })
        }
      }
    }
  }
  await writer.flush()

  // ── Лайки статей, избранное ленты, комментарии к опросам, репосты ──────────
  // Всё — внутри группы: статьи, опросы и личные посты однокурсника видны при любой их
  // видимости (ALL/UNIVERSITY/FACULTY/GROUP). Кандидаты — первые несколько записей
  // каждого однокурсника; что из них реально есть и опубликовано, отвечает база.
  // Посты вуза от администрации: официальные объявления и её личные посты на вуз. Без
  // фильтра по автору take отдал бы личные посты студентов (их id сортируются раньше).
  const uniPosts = await prisma.post.findMany({
    where: {
      universityId: uniId,
      authorId: { in: staffAuthors },
      audience: 'UNIVERSITY',
      status: 'PUBLISHED',
      deletedAt: null,
      originalPostId: null,
      sharedArticleId: null,
    },
    select: { id: true, publishedAt: true },
    orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
    take: 30,
  })

  for (const faculty of people.faculties) {
    const facultyStudents = faculty.groups.flatMap((g) => g.studentIds)
    const articleCandidates = facultyStudents.flatMap((sid) => [0, 1, 2].map((n) => child(sid, 'art', n))) // prettier-ignore
    const postCandidates = [
      ...faculty.groups.flatMap((g) => [child(g.id, 'post', 0), child(g.id, 'post', 1)]),
      ...facultyStudents.flatMap((sid) => [0, 1, 2].map((n) => child(sid, 'p', n))),
    ]
    const pollCandidates = facultyStudents.map((sid) => child(sid, 'poll', 0))

    const [articles, posts, polls] = await Promise.all([
      prisma.profileArticle.findMany({
        where: { id: { in: articleCandidates }, status: 'PUBLISHED' },
        select: { id: true, userId: true, publishedAt: true },
        orderBy: { id: 'asc' },
        take: articleCandidates.length,
      }),
      prisma.post.findMany({
        where: { id: { in: postCandidates }, status: 'PUBLISHED', deletedAt: null },
        select: { id: true, authorId: true, groupId: true, publishedAt: true },
        orderBy: { id: 'asc' },
        take: postCandidates.length,
      }),
      prisma.poll.findMany({
        where: { id: { in: pollCandidates }, status: 'PUBLISHED' },
        select: { id: true, userId: true, createdAt: true },
        orderBy: { id: 'asc' },
        take: pollCandidates.length,
      }),
    ])

    for (const group of faculty.groups) {
      const inGroup = new Set(group.studentIds)
      const groupArticles = articles.filter((a) => inGroup.has(a.userId))
      // Посты группы (автор — староста или студент) и личные посты однокурсников.
      const groupPosts = posts.filter((p) => p.groupId === group.id || inGroup.has(p.authorId))
      const groupPolls = polls.filter((p) => inGroup.has(p.userId))

      for (const studentId of group.studentIds) {
        // Лайк — один на (статья, человек); своё не лайкаем.
        const likable = groupArticles.filter((a) => a.userId !== studentId)
        for (const article of random.sample(likable, random.randInt(0, 4))) {
          await writer.add('articleLike', {
            id: `${article.id}-lk-${studentId}`,
            articleId: article.id,
            userId: studentId,
            createdAt: after(random, article.publishedAt, 90),
          })
        }

        // Избранное ленты: уникально по (человек, пост), чужие посты.
        // Выборки не пересекаются: в groupPosts авторы — студенты, в uniPosts — администрация.
        const savable = [...groupPosts.filter((p) => p.authorId !== studentId), ...uniPosts]
        for (const post of random.sample(savable, random.randInt(0, 4))) {
          await writer.add('postBookmark', {
            id: `${studentId}-pbm-${post.id}`,
            userId: studentId,
            postId: post.id,
            createdAt: after(random, post.publishedAt, 60),
          })
        }

        // Комментарий к первому опросу однокурсника: обсуждение под опросом (ContentComment
        // с pollId). Шаг 55 комментирует только статьи.
        if (random.chance(0.35)) {
          const poll = random.pick(groupPolls.filter((p) => p.userId !== studentId))
          if (poll) {
            await writer.add('contentComment', {
              id: child(poll.id, 'cc', studentId),
              authorId: studentId,
              pollId: poll.id,
              content: random.pick(POLL_COMMENTS),
              createdAt: after(random, poll.createdAt, 60),
            })
          }
        }

        // Репост в группу: поста вуза или статьи однокурсника. Редко — лента не должна
        // состоять из репостов. Аудитория GROUP — та, что разрешена студенту.
        if (random.chance(0.05)) {
          const article = random.chance(0.5) ? random.pick(likable) : null
          const original = article ? null : random.pick(uniPosts)
          const source = article ?? original
          if (source) {
            const publishedAt = after(random, source.publishedAt, 30)
            await writer.add('post', {
              id: child(studentId, 'repost'),
              authorId: studentId,
              audience: 'GROUP',
              content: random.pick(REPOST_CAPTIONS),
              universityId: uniId,
              facultyId: faculty.id,
              groupId: group.id,
              status: 'PUBLISHED',
              publishedAt,
              createdAt: publishedAt,
              priority: postPriority('GROUP', false),
              ...(article ? { sharedArticleId: article.id } : { originalPostId: original.id }),
            })
          }
        }
      }
    }
  }
  await writer.flush()

  // ── Обсуждение событий и реакции на комментарии ────────────────────────────
  // Комментировать может любой, кому видно событие (не только участник): участники с
  // подходящим скоупом пишут вопросы, организатор отвечает. Участников шаг 50 набирает
  // по всему вузу, поэтому у событий факультета чужих отфильтровываем.
  const events = await prisma.event.findMany({
    where: { universityId: uniId },
    select: {
      id: true,
      organizerId: true,
      audience: true,
      facultyId: true,
      participants: { select: { userId: true }, orderBy: { id: 'asc' }, take: 40 },
    },
    orderBy: { id: 'asc' },
    take: 200,
  })
  for (const event of events) {
    const audienceOk = (uid) =>
      event.audience !== 'FACULTY' || !event.facultyId || facultyOf.get(uid) === event.facultyId
    const pool = event.participants.map((p) => p.userId).filter(audienceOk)
    if (pool.length === 0) continue
    const count = random.randInt(0, 6)
    for (let ci = 0; ci < count; ci += 1) {
      const commentId = child(event.id, 'ec', ci)
      const createdAt = random.randomDate(-9, 0)
      await writer.add('eventComment', {
        id: commentId,
        eventId: event.id,
        authorId: random.pick(pool),
        content: random.pick(EVENT_COMMENTS),
        // Изредка удалённый комментарий: экран показывает «Комментарий удалён».
        deletedAt: random.chance(0.05) ? after(random, createdAt, 9) : null,
        createdAt,
      })
      stats.eventComments += 1
      // Ответ организатора — на комментарий того же события.
      if (random.chance(0.3)) {
        await writer.add('eventComment', {
          id: child(commentId, 'r'),
          eventId: event.id,
          authorId: event.organizerId,
          content: random.pick(EVENT_REPLIES),
          replyToId: commentId,
          createdAt: after(random, createdAt, 9),
        })
        stats.eventComments += 1
      }
      // Реакция одна на человека (сервис заменяет прежнюю), эмодзи — из набора чата.
      for (const userId of random.sample(pool, random.randInt(0, 4))) {
        await writer.add('eventCommentReaction', {
          id: `${commentId}-rx-${userId}`,
          commentId,
          userId,
          emoji: random.pick(CHAT_REACTION_EMOJIS),
          createdAt: after(random, createdAt, 9),
        })
      }
    }
  }
  await writer.flush()

  // ── Предупреждения модерации ────────────────────────────────────────────────
  // По подтверждённым жалобам на пользователя — со ссылкой на жалобу (если жалобы к
  // этому моменту уже в базе: их пишет шаг 70), плюс прямые предупреждения модератора
  // без жалобы. Выдаёт модератор вуза, себя предупредить нельзя — студенты не модераторы.
  const complaints = await prisma.complaint.findMany({
    where: { universityId: uniId, targetType: 'USER', status: 'RESOLVED' },
    select: { id: true, targetId: true, resolvedById: true, resolvedAt: true },
    orderBy: { id: 'asc' },
    take: 50,
  })
  const studentSet = new Set(allStudents)
  for (const complaint of complaints) {
    if (!studentSet.has(complaint.targetId)) continue
    await writer.add('moderationWarning', {
      id: child(complaint.id, 'warn'),
      userId: complaint.targetId,
      issuedById: complaint.resolvedById ?? people.moderatorIds[0] ?? people.adminId,
      complaintId: complaint.id,
      createdAt: complaint.resolvedAt ?? random.randomDate(-10, -1),
    })
    stats.warnings += 1
  }
  const issuers = people.moderatorIds.length > 0 ? people.moderatorIds : [people.adminId]
  const warned = random.sample(allStudents, Math.max(1, Math.round(allStudents.length / 150)))
  for (const [wi, userId] of warned.entries()) {
    await writer.add('moderationWarning', {
      id: id(index, 'warn', wi),
      userId,
      issuedById: random.pick(issuers),
      complaintId: null,
      createdAt: random.randomDate(-120, -1),
    })
    stats.warnings += 1
  }
  await writer.flush()

  return stats
}
