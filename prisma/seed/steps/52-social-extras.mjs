// Шаг «соцчасть, добор»: то, что шаги 50 и 55 оставляют пустым. Сторисы (живые, с медиа,
// опросами, элементами редактора, просмотрами и реакциями), «Актуальное», скрытие сторис,
// страницы компаний и платформы (54), сторис в чатах и жалобы на сторис (53), обсуждение
// событий с вложениями и реакциями, лайки статей, избранное ленты, комментарии к опросам,
// репосты и предупреждения модерации.
//
// МЕДИА СТОРИС — ССЫЛКИ НА ОБРАЗЦЫ ФОРМАТОВ (см. 51-social-media.mjs): своя строка File
// у каждой сторис (сервис не даёт одной строке двух сторис), объект общий. Медиа сторис
// лежит в бакете сторис, копия в «Актуальном» — в бакете подборок, как у сервиса. Без
// хранилища (pool.formats = null) сторис только текстовые: Story.fileId nullable, а
// CreateStorySchema требует медиа ИЛИ текст ИЛИ элемент.
//
// ИСТЁКШИХ СТОРИС НЕТ НАМЕРЕННО. Крон deleteExpiredStories каждые 30 минут физически
// удаляет всё с expiresAt <= now, а лента их не показывает уже сейчас. Строка «истёкшей»
// сторис — это мусор, который не увидит никто. Старые сторисы живут там же, где в продукте:
// снимками в «Актуальном» (sourceStoryId = NULL — исходник уже снят кроном). Живые сторисы
// созданы в пределах последних суток и истекут в течение суток после прогона — так ведёт
// себя и настоящий продукт. (Бакет сторис к тому же чистится TTL-политикой — объект
// образца живёт там столько же, сколько сторис, и перезаливается следующим прогоном.)
//
// Аудитории — как ALLOWED_AUDIENCES сервиса сторис: админ вуза — вуз и преподаватели,
// модератор — вуз, декан — факультет и группа, преподаватель и учащиеся — группа, друзья,
// выбранные. ALL (платформа) и PARTNER_UNIVERSITIES (работодатель) — в шаге 54.
//
// Зависимости: посты, события, дружбы (шаг 50), статьи и опросы (шаг 55), пары (шаг 40),
// чаты (шаги 60, 62), допуски компаний (шаг 80) и жалобы (шаг 70) уже в БД. Их не
// пересчитываем по детерминированным id вслепую, а читаем из базы с take: при диапазонах
// «0-0» постов или статей нет, и ссылка на них нарушила бы внешний ключ.

import { formatFileRow } from '../lib/formats.mjs'
import { child, id } from '../lib/ids.mjs'
import {
  STORY_BACKGROUNDS,
  STORY_REACTION_EMOJIS,
  STORY_TTL_MS,
  eventCommentMediaKit,
  storyEmojiElement,
  storyMediaKit,
  storyPlacement,
  storyTextElement,
} from './51-social-media.mjs'
import { seedStoryComplaints, seedStoryMessages } from './53-story-extras.mjs'
import { seedOrgPages } from './54-org-pages.mjs'

// CHAT_REACTION_EMOJIS — packages/shared-config/src/constants.ts (реакции на комментарии
// к событию идут по правилам чата).
const CHAT_REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '👀']

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
// Надписи текстового элемента редактора — до STORY_ELEMENT_TEXT_MAX (200).
const ELEMENT_TEXTS = ['Сегодня!', 'Все сюда 👇', 'Не пропустите', 'Наш кампус', 'Сессия ✍️', 'Ура!'] // prettier-ignore
// Опрос сторис: 2–4 варианта, без повторов (StoryPollSchema).
const STORY_POLLS = [
  ['Во сколько удобнее консультация?', ['14:00', '16:00', '18:00']],
  ['Идём на студенческий вечер?', ['Конечно', 'Не получится']],
  ['Самый сложный предмет семестра?', ['Математика', 'Физика', 'Программирование', 'Философия']],
  ['Где готовиться к сессии?', ['Библиотека', 'Дома', 'Коворкинг']],
  ['Кофе или чай перед парой?', ['Кофе', 'Чай']],
  ['Нужен ли разбор задач перед экзаменом?', ['Да, обязательно', 'Справлюсь сам(а)']],
]
// Аудитории сторис учащегося — по кругу со сдвигом на автора: каждая встречается в вузе.
const STUDENT_STORY_AUDIENCES = ['GROUP', 'FRIENDS', 'GROUP', 'SELECTED', 'GROUP']
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
// Вложения комментариев к событию — по кругу: без вложений, фото, альбом со спойлером,
// видео, документ, голосовое (без текста, как в чате), музыка, снимок «без сжатия».
// Документ — дважды за круг: форматов документов четыре, а комментариев в вузе несколько
// десятков, и каждый формат должен успеть встретиться.
const EVENT_ATTACHMENTS = [
  [],
  ['image'],
  ['document'],
  ['image', 'spoiler'],
  ['video'],
  [],
  ['document'],
  ['voice'],
  ['music'],
  ['asDocument'],
]
const POLL_COMMENTS = [
  'Проголосовал(а), интересно, что выберут остальные.',
  'Не хватает варианта «другое».',
  'Ожидаемый результат.',
  'Хороший вопрос, давно хотел(а) спросить.',
  'Давайте обсудим на паре.',
]

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000)
// Момент позже опорного, но не в будущем: лайк или закладка не бывают раньше публикации.
const after = (random, base, maxDays) => {
  const from = base ? base.getTime() : Date.now() - maxDays * 86_400_000
  const span = Math.max(0, Date.now() - from)
  return new Date(from + Math.floor(random.rng() * span))
}
// Ближайшая дата пары с этим днём недели (1 — понедельник) в формате YYYY-MM-DD: карточка
// расписания в сторис ссылается на пару на конкретную дату (StoryScheduleElementSchema).
const nextPairDate = (dayOfWeek) => {
  const date = new Date()
  const today = ((date.getUTCDay() + 6) % 7) + 1
  date.setUTCDate(date.getUTCDate() + ((dayOfWeek - today + 7) % 7 || 7))
  return date.toISOString().slice(0, 10)
}

export async function seedSocialExtras(prisma, writer, ctx) {
  const { index, random, structure, people, pool } = ctx
  const { uniId } = structure
  const stats = { stories: 0, mediaStories: 0, highlights: 0, eventComments: 0, warnings: 0 }
  const storyMedia = storyMediaKit(pool)
  let fileN = 0

  const allStudents = people.faculties.flatMap((f) => f.groups.flatMap((g) => g.studentIds))
  const allTeachers = people.faculties.flatMap((f) => f.teacherIds)
  const facultyOf = new Map()
  const groupOf = new Map()
  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      for (const studentId of group.studentIds) {
        facultyOf.set(studentId, faculty.id)
        groupOf.set(studentId, group.id)
      }
    }
  }
  // Живые сторисы автора: часть из них попадает в его «Актуальное» (шаг ниже), а первая
  // сторис старосты — в ответы и пересылки в личном чате (шаг 53).
  const liveStories = new Map()

  // ── Сторис: план ───────────────────────────────────────────────────────────
  // Сначала план, потом запись: строка File медиа обязана попасть в базу раньше сторис
  // (Story.fileId), а буферы writer'а сбрасываются в порядке первого обращения к модели.
  //
  // `cards` — что автор вправе показать на кадре: кого отметить (только тех, кто увидит
  // сторис, — assertMentionable), какое событие, пост и пару (assertCardsUsable).
  const planned = []
  let storyN = 0
  // Свой счётчик у надписей: стиль надписи идёт по кругу от него (storyTextElement), и
  // общий номер сторис, на котором надпись бывает лишь у части вариантов, давал бы два
  // цвета и один шрифт на весь вуз.
  let textN = 0
  const planStory = (authorId, k, story, viewers, { withPoll = false, cards = {} } = {}) => {
    const n = storyN++
    const storyId = child(authorId, 'story', k)
    const createdAt = minutesAgo(random.randInt(10, 23 * 60))

    // Медиа: каждая пятая — фото, ещё каждая пятая — видео (если хранилище доступно).
    const sample = n % 5 === 1 ? storyMedia.image() : n % 5 === 3 ? storyMedia.video() : null
    const file = sample
      ? formatFileRow(sample, fileN++, { id: child(storyId, 'f'), ownerId: authorId, createdAt })
      : null

    // Элементы редактора по кругу: без них, эмодзи, надпись, отметка, карточка, надпись+эмодзи.
    const elements = []
    const variant = n % 6
    if (variant === 1 || variant === 5) elements.push(storyEmojiElement(n, 1))
    if (variant === 2 || variant === 5) {
      const t = textN++
      elements.push(storyTextElement(t, ELEMENT_TEXTS[t % ELEMENT_TEXTS.length]))
    }
    if (variant === 3 && cards.mentionable?.length) {
      const userId = cards.mentionable[n % cards.mentionable.length]
      elements.push({ type: 'mention', ...storyPlacement(n, 2), userId })
    }
    if (variant === 4) {
      // Карточки по очереди: событие, пост, пара расписания — что у автора есть.
      const card = Math.floor(n / 6) % 3
      if (card === 0 && cards.eventId) {
        elements.push({ type: 'event', ...storyPlacement(n, 3), eventId: cards.eventId })
      } else if (card === 1 && cards.postId) {
        elements.push({ type: 'post', ...storyPlacement(n, 3), postId: cards.postId })
      } else if (cards.pair) {
        elements.push({
          type: 'schedule',
          ...storyPlacement(n, 3),
          pairId: cards.pair.id,
          date: nextPairDate(cards.pair.day),
        })
      }
    }

    // Текст: у текстовой сторис с надписью-элементом подписи может не быть вовсе (весь
    // текст — на кадре), у медиа подпись через раз. Фон — только у текстовой (refine
    // backgroundTextOnly).
    const text = (variant === 2 && !file) || (file && n % 2 === 0) ? null : story.text
    const row = {
      id: storyId,
      authorId,
      audience: story.audience,
      universityId: story.universityId ?? null,
      facultyId: story.facultyId ?? null,
      groupId: story.groupId ?? null,
      audienceUserIds: story.audienceUserIds ?? [],
      fileId: file?.id ?? null,
      text,
      background: file ? null : random.pick(STORY_BACKGROUNDS),
      linkUrl: story.linkUrl ?? null,
      linkLabel: story.linkLabel ?? null,
      ...(elements.length > 0 ? { elements } : {}),
      expiresAt: new Date(createdAt.getTime() + STORY_TTL_MS),
      createdAt,
    }
    planned.push({ row, file, viewers, withPoll, sample, forced: story.forcedViewers ?? [] })
    const list = liveStories.get(authorId) ?? []
    list.push({ ...row, sample })
    liveStories.set(authorId, list)
  }

  // Карточки, доступные всем в вузе: событие на весь вуз (шаг 50, ev-0 — UNIVERSITY) и
  // официальный пост вуза. Пара — у каждой группы своя (шаг 40).
  const uniEventId = id(index, 'ev', 0)
  const uniPostId = id(index, 'post', 'uni', 0)
  const firstPair = people.faculties[0]?.groups[0]?.pairs?.[0] ?? null

  // Администрация: админ — вуз и преподаватели (TEACHERS видят только преподаватели вуза),
  // модератор — вуз (ALLOWED_AUDIENCES сервиса сторис).
  const staffAuthors = [people.adminId, ...people.moderatorIds]
  for (const [ai, authorId] of staffAuthors.entries()) {
    const count = ai === 0 ? 2 : random.randInt(0, 1)
    for (let k = 0; k < count; k += 1) {
      planStory(
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
        [...allStudents, ...allTeachers],
        { cards: { mentionable: allTeachers, eventId: uniEventId, postId: uniPostId, pair: firstPair } }, // prettier-ignore
      )
    }
  }
  planStory(
    people.adminId,
    2,
    {
      audience: 'TEACHERS',
      universityId: uniId,
      text: 'Коллеги, методический совет переносится на пятницу.',
    },
    allTeachers,
    { cards: { mentionable: allTeachers, eventId: uniEventId } },
  )

  for (const faculty of people.faculties) {
    const facultyStudents = faculty.groups.flatMap((g) => g.studentIds)
    const firstGroup = faculty.groups[0]
    // Декан — своему факультету (иногда с опросом) и объявлением одной группе.
    planStory(
      faculty.deanId,
      0,
      {
        audience: 'FACULTY',
        universityId: uniId,
        facultyId: faculty.id,
        text: random.pick(STAFF_STORY_TEXTS),
      },
      [...facultyStudents, ...faculty.teacherIds],
      {
        withPoll: random.chance(0.3),
        cards: {
          mentionable: faculty.teacherIds,
          eventId: uniEventId,
          postId: child(faculty.id, 'post', 0),
          pair: firstGroup?.pairs?.[0],
        },
      },
    )
    if (firstGroup) {
      planStory(
        faculty.deanId,
        1,
        {
          audience: 'GROUP',
          universityId: uniId,
          facultyId: faculty.id,
          groupId: firstGroup.id,
          text: 'Группа, жду старосту в деканате до конца недели.',
        },
        firstGroup.studentIds,
        { cards: { mentionable: firstGroup.studentIds.slice(0, 1) } },
      )
    }
    // Преподаватель — группе, где ведёт пары: teacherIds[0] ведёт предмет 0 во всех
    // группах факультета (шаг 40). Карточка — своя пара в этой группе.
    const teacherId = faculty.teacherIds[0]
    if (teacherId && firstGroup) {
      planStory(
        teacherId,
        0,
        {
          audience: 'GROUP',
          universityId: uniId,
          facultyId: faculty.id,
          groupId: firstGroup.id,
          text: 'Завтра на паре — контрольная по пройденной теме.',
        },
        firstGroup.studentIds,
        {
          withPoll: true,
          cards: {
            mentionable: firstGroup.studentIds,
            pair: firstGroup.pairs?.find((p) => p.teacherId === teacherId),
          },
        },
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
      const viewersFor = (authorId, list) =>
        list.filter((uid) => uid !== authorId && !(blockPair.has(authorId) && blockPair.has(uid) && members.length > 7)) // prettier-ignore
      const groupCards = {
        eventId: uniEventId,
        postId: child(group.id, 'post', 0),
        pair: group.pairs?.[0],
      }

      for (const [si, studentId] of members.entries()) {
        // Сторис публикует примерно каждый третий; староста — всегда: его первая сторис
        // группе нужна для ответа и пересылки в личном чате (шаг 53).
        const starosta = studentId === group.starostaId
        if (!starosta && !random.chance(0.3)) continue
        const count = random.randInt(1, 2)
        for (let k = 0; k < count; k += 1) {
          const friends = viewersFor(studentId, friendsOf.get(studentId) ?? [])
          let audience = STUDENT_STORY_AUDIENCES[(si + k) % STUDENT_STORY_AUDIENCES.length]
          if (starosta && k === 0) audience = 'GROUP'
          if (audience === 'FRIENDS' && friends.length === 0) audience = 'GROUP'
          if (audience === 'SELECTED' && members.length <= 3) audience = 'GROUP'
          const text = random.pick(STUDENT_STORY_TEXTS)
          if (audience === 'GROUP') {
            const viewers = viewersFor(studentId, members)
            planStory(
              studentId,
              k,
              {
                audience,
                universityId: uniId,
                facultyId: faculty.id,
                groupId: group.id,
                text,
                // Ответ в личном чате (шаг 53) пишет второй в группе — он сторис открыл.
                forcedViewers: starosta && k === 0 ? members.slice(1, 2) : [],
              },
              viewers,
              { withPoll: random.chance(0.3), cards: { ...groupCards, mentionable: viewers } },
            )
          } else if (audience === 'FRIENDS') {
            // Личная аудитория: вуз и факультет — автора (authorScope), видимость по дружбе.
            // Карточка поста группы друзьям из других групп не видна — отметки и событие.
            planStory(
              studentId,
              k,
              { audience, universityId: uniId, facultyId: faculty.id, text },
              friends,
              { withPoll: random.chance(0.2), cards: { mentionable: friends, eventId: uniEventId } }, // prettier-ignore
            )
          } else {
            // Поимённый список: однокурсники без автора и без пары блокировки.
            const recipients = random.sample(viewersFor(studentId, members), random.randInt(2, 5))
            planStory(
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
              { cards: { ...groupCards, mentionable: recipients } },
            )
          }
        }
      }
    }
  }

  // ── Сторис: запись ─────────────────────────────────────────────────────────
  for (const { file } of planned) if (file) await writer.add('file', file)
  await writer.flush()
  for (const { row, file, viewers, withPoll, forced } of planned) {
    await writer.add('story', row)
    stats.stories += 1
    if (file) stats.mediaStories += 1
    await writeStoryEngagement(writer, random, row, viewers, { withPoll, forced })
  }
  await writer.flush()

  // ── «Актуальное» и скрытие сторис ──────────────────────────────────────────
  // Подборка — снимок: текст, фон, элементы и аудитория переносятся, опрос — нет; медиа
  // копируется в бакет подборок своей строкой File (fileId уникален у элемента). Старые
  // элементы ссылаются на исходник NULL (тот давно снят кроном), живые — на свою сторис.
  // Обложка (coverItemId) — у части подборок первый элемент, у остальных NULL: тогда
  // обложкой служит первый видимый элемент. Ставится после элементов (ссылка на них).
  const highlightFiles = []
  const highlightRows = []
  const itemRows = []
  const covered = []
  let itemN = 0
  const addHighlight = (ownerId, hi, title, scope, texts) => {
    const highlightId = child(ownerId, 'hl', hi)
    const createdAt = random.randomDate(-300, -2)
    highlightRows.push({ id: highlightId, ownerId, title, position: hi, createdAt })
    if ((itemN + hi) % 2 === 0) covered.push(highlightId)
    let position = 0
    const itemCount = random.randInt(2, 5)
    for (let ii = 0; ii < itemCount; ii += 1) {
      const itemId = child(highlightId, 'it', ii)
      const n = itemN++
      // Каждый третий архивный элемент — фото: снимок медийной сторис.
      const sample = n % 3 === 1 ? storyMedia.highlightImage() : null
      const file = sample
        ? formatFileRow(sample, fileN++, { id: child(itemId, 'f'), ownerId, createdAt })
        : null
      if (file) highlightFiles.push(file)
      itemRows.push({
        id: itemId,
        highlightId,
        sourceStoryId: null,
        ...scope,
        fileId: file?.id ?? null,
        text: file && n % 2 === 0 ? null : random.pick(texts),
        background: file ? null : random.pick(STORY_BACKGROUNDS),
        ...(n % 4 === 2 ? { elements: [storyTextElement(textN, ELEMENT_TEXTS[textN++ % ELEMENT_TEXTS.length])] } : {}), // prettier-ignore
        storyCreatedAt: random.randomDate(-400, -2),
        position: position++,
        createdAt,
      })
    }
    // Живая сторис в подборке — снимок с sourceStoryId: по нему сервис не даёт добавить
    // её в ту же подборку повторно. Опрос в снимок не переносится, медиа — копией.
    const live = hi === 0 ? (liveStories.get(ownerId) ?? [])[0] : null
    if (live && random.chance(0.5)) {
      const itemId = child(highlightId, 'it', 'live')
      const copy = live.sample ? storyMedia.highlightOf(live.sample) : null
      const file = copy
        ? formatFileRow(copy, fileN++, { id: child(itemId, 'f'), ownerId, createdAt: live.createdAt }) // prettier-ignore
        : null
      if (file) highlightFiles.push(file)
      itemRows.push({
        id: itemId,
        highlightId,
        sourceStoryId: live.id,
        audience: live.audience,
        universityId: live.universityId,
        facultyId: live.facultyId,
        groupId: live.groupId,
        audienceUserIds: live.audienceUserIds,
        fileId: file?.id ?? null,
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

  addHighlight(
    people.adminId,
    0,
    random.pick(STAFF_HIGHLIGHT_TITLES),
    { audience: 'UNIVERSITY', universityId: uniId },
    STAFF_STORY_TEXTS,
  )
  for (const faculty of people.faculties) {
    addHighlight(
      faculty.deanId,
      0,
      random.pick(STAFF_HIGHLIGHT_TITLES),
      { audience: 'FACULTY', universityId: uniId, facultyId: faculty.id },
      STAFF_STORY_TEXTS,
    )
    for (const group of faculty.groups) {
      const members = group.studentIds
      for (const studentId of members) {
        if (random.chance(0.15)) {
          const titles = random.sample(HIGHLIGHT_TITLES, random.randInt(1, 2))
          for (const [hi, title] of titles.entries()) {
            addHighlight(
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
  for (const file of highlightFiles) await writer.add('file', file)
  await writer.flush()
  for (const row of highlightRows) await writer.add('storyHighlight', row)
  stats.highlights += highlightRows.length
  await writer.flush()
  for (const row of itemRows) await writer.add('storyHighlightItem', row)
  await writer.flush()
  // Обложка — первый элемент подборки (id выводится из id подборки). Один запрос на вуз;
  // выбранную пользователем обложку повторный прогон не трогает.
  if (covered.length > 0) {
    await prisma.$executeRaw`
      UPDATE story_highlights SET cover_item_id = story_highlights.id || '-it-0'
      WHERE story_highlights.id = ANY(${covered}::text[])
        AND story_highlights.cover_item_id IS NULL
        AND EXISTS (SELECT 1 FROM story_highlight_items i WHERE i.id = story_highlights.id || '-it-0')`
  }

  // ── Страницы компаний и платформы: посты, сторис, статьи, альбомы ───────────
  Object.assign(stats, await seedOrgPages(prisma, writer, ctx, { writeStoryEngagement }))

  // ── Лайки статей, избранное ленты, комментарии к опросам ───────────────────
  // Всё — внутри группы: статьи, опросы и посты однокурсника группе видны при любой их
  // видимости (ALL/UNIVERSITY/FACULTY/GROUP). Личные (PERSONAL) видит только адресат —
  // их в кандидатах нет. Что из кандидатов реально есть и опубликовано, отвечает база.
  // Посты вуза от администрации: официальные объявления и посты страницы вуза. Без
  // фильтра по автору take отдал бы посты студентов (их id сортируются раньше).
  const uniPosts = await prisma.post.findMany({
    where: {
      universityId: uniId,
      authorId: { in: staffAuthors },
      audience: 'UNIVERSITY',
      status: 'PUBLISHED',
      deletedAt: null,
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
        where: {
          id: { in: postCandidates },
          status: 'PUBLISHED',
          deletedAt: null,
          audience: 'GROUP',
        },
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
      // Посты группы (автор — староста или студент) — только адресованные этой группе.
      const groupPosts = posts.filter((p) => p.groupId === group.id)
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
      }
    }
  }
  await writer.flush()

  // ── Обсуждение событий: комментарии, вложения, реакции ─────────────────────
  // Комментировать может любой, кому видно событие (не только участник): участники с
  // подходящим скоупом пишут вопросы, организатор отвечает. Карьерные события (шаг 80)
  // набирают участников по-своему, поэтому скоуп сверяем для всех аудиторий.
  const teacherSet = new Set(allTeachers)
  const events = await prisma.event.findMany({
    where: { universityId: uniId },
    select: {
      id: true,
      organizerId: true,
      audience: true,
      facultyId: true,
      groupId: true,
      participants: { select: { userId: true }, orderBy: { id: 'asc' }, take: 40 },
    },
    orderBy: { id: 'asc' },
    take: 200,
  })
  const commentMedia = eventCommentMediaKit(pool)
  const commentFiles = []
  let commentN = 0
  for (const event of events) {
    const audienceOk = (uid) => {
      if (event.audience === 'TEACHERS') return teacherSet.has(uid)
      if (event.audience === 'GROUP') return groupOf.get(uid) === event.groupId
      if (event.audience === 'FACULTY' && event.facultyId) {
        return facultyOf.get(uid) === event.facultyId || teacherSet.has(uid)
      }
      return true
    }
    const viewers = event.participants.map((p) => p.userId).filter(audienceOk)
    if (viewers.length === 0) continue
    const count = random.randInt(0, 6)
    for (let ci = 0; ci < count; ci += 1) {
      const commentId = child(event.id, 'ec', ci)
      const createdAt = random.randomDate(-9, 0)
      const authorId = random.pick(viewers)
      // Вложения — файлы бакета постов, свои у автора комментария (addComment привязывает
      // только свои и ещё ничьи). Текст пустой у голосового: оно и есть сообщение.
      const attach = EVENT_ATTACHMENTS[commentN++ % EVENT_ATTACHMENTS.length]
      const files = []
      for (const [ai, kind] of attach.entries()) {
        const source =
          kind === 'spoiler' || kind === 'asDocument' ? commentMedia.image() : commentMedia[kind]()
        if (!source) continue
        files.push(
          formatFileRow(source, fileN++, {
            id: child(commentId, 'f', ai),
            ownerId: authorId,
            eventCommentId: commentId,
            spoiler: kind === 'spoiler',
            asDocument: kind === 'asDocument',
            createdAt,
          }),
        )
      }
      commentFiles.push(...files)
      const voiceOnly = attach[0] === 'voice' && files.length > 0
      await writer.add('eventComment', {
        id: commentId,
        eventId: event.id,
        authorId,
        content: voiceOnly ? '' : random.pick(EVENT_COMMENTS),
        // Изредка удалённый комментарий: экран показывает «Комментарий удалён».
        deletedAt: files.length === 0 && random.chance(0.05) ? after(random, createdAt, 9) : null,
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
      for (const userId of random.sample(viewers, random.randInt(0, 4))) {
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
  // Вложения — после комментариев (File.eventCommentId).
  for (const file of commentFiles) await writer.add('file', file)
  await writer.flush()

  // ── Сторис в личных чатах и жалобы на сторис и комментарии ─────────────────
  Object.assign(stats, await seedStoryMessages(prisma, writer, ctx, { liveStories }))
  Object.assign(stats, await seedStoryComplaints(prisma, writer, ctx, { liveStories }))

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

/**
 * Опрос, просмотры, реакции и голоса сторис. `viewers` — кто реально может видеть сторис по
 * её аудитории (audienceConditions в stories.service): автор в зрители не пишется, сервис
 * свой просмотр не фиксирует. `forced` — зрители, которые обязаны быть (ответили на сторис).
 *
 * Общая для сторис вуза и сторис платформы и компаний (шаг 54). Случайные решения берутся
 * из переданного `random`: у общих авторов это свой поток, чтобы опрос и его варианты
 * совпадали, из какого бы вуза строка ни пришла первой.
 */
export async function writeStoryEngagement(writer, random, row, viewers, opts = {}) {
  const { withPoll = false, forced = [], poll = null } = opts
  const storyId = row.id
  const createdAt = row.createdAt
  let optionIds = []
  let pollId = null
  if (withPoll || poll) {
    const [question, options] = poll ?? random.pick(STORY_POLLS)
    pollId = child(storyId, 'poll')
    await writer.add('storyPoll', { id: pollId, storyId, question, createdAt })
    optionIds = options.map((_, oi) => child(pollId, 'o', oi))
    for (const [oi, text] of options.entries()) {
      await writer.add('storyPollOption', { id: optionIds[oi], pollId, text, order: oi })
    }
  }

  const elapsed = Date.now() - createdAt.getTime()
  const seenAt = () => new Date(createdAt.getTime() + Math.floor(random.rng() * elapsed))
  const sampled = random.sample(viewers, random.randInt(Math.min(2, viewers.length), 15))
  const seen = [...new Set([...forced, ...sampled])]
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
}
