// Шаг «чаты: полное покрытие»: каждый сценарий чата, который умеют API и клиенты, хотя бы
// раз в каждом вузе. Вложения всех форматов (фото- и видеоальбомы, GIF, спойлер, «без
// сжатия», документы, архивы, голосовые, музыка), стикеры и избранные стикеры, пересылки,
// ответы с цитатой, «без звука», правка и удаление, превью ссылок, карточки постов, все
// системные события группы, опросы во всех режимах, трансляция геопозиции, персональные
// настройки участника (архив, mute на время, порядок закрепов, «непрочитанное», очистка
// истории, скрытие), папки с правилами, запрос на переписку и обращения в поддержку
// платформы во всех состояниях и со всеми тегами.
//
// Почему не вероятностями: «с шансом 10 %» на маленьком вузе даёт ноль, и экран, который
// надо проверить, оказывается пустым. Здесь каждый сценарий — детерминированная запись, а
// сценарии раскладываются по группам по кругу (слот → группа), чтобы не копить всё в
// одном чате. Объём — на вуз, а не на человека: около сотни сообщений и ~350 строк всего.
//
// Номера сообщений — как в шаге 62: в существующие чаты сообщения дописываются после
// Chat.lastSeq, прочитанного из базы, а повторный прогон узнаёт свои сообщения по
// детерминированному id (`<чат>-msg-cv-<ключ>`) и берёт их прежний номер. Новые чаты шага
// (группа команды, запрос на переписку, обращения) заводятся с lastSeq 0 и идут тем же
// путём — у номеров один источник правды.
//
// Свой поток случайностей (как у библиотеки): число вызовов здесь не должно сдвигать данные
// следующих шагов вуза — иначе повторный прогон по уже залитой базе разъехался бы.
//
// Вложения — строки File на общие объекты образцов (lib/formats.mjs): без MinIO пула нет, и
// сообщения, которые без файла были бы пустым пузырём, просто не создаются.

import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { phone } from '../data/people.mjs'
import { formatCycler, formatFileRow, formatSamples } from '../lib/formats.mjs'
import { child, id, uniPrefix } from '../lib/ids.mjs'
import { makeRandom, SEED_BASE } from '../lib/rng.mjs'
import { STICKER_SET_SLUG } from './95-stickers.mjs'

const STAFF_ROLES = ['PLATFORM_ADMIN', 'PLATFORM_MODERATOR']
const MINUTE = 60_000
const DAY = 86_400_000
// Шаг «часов» для дописанных сообщений: все они ложатся в последние часы подряд, и порядок
// по времени внутри чата совпадает с порядком по seq.
const CLOCK_STEP = 9 * MINUTE

// Быстрые реакции клиентов (CHAT_REACTION_EMOJIS) и несколько из полного списка: сервер
// принимает любой одиночный эмодзи, в том числе ZWJ-последовательность (❤️‍🔥).
const EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '👀', '👏', '🤝', '💯', '🙏', '❤️‍🔥']

// Превью — в форме джобы link-preview ({url,title,description,image,siteName}); image всегда
// null: картинку OG сервер не хранит (F-F29), клиенты ждут поле, но не значение.
const LINKS = [
  {
    url: 'https://ru.wikipedia.org/wiki/Линейная_алгебра',
    label: 'Методичка по линейной алгебре',
    title: 'Линейная алгебра — Википедия',
    description:
      'Раздел алгебры, изучающий векторы, векторные пространства, линейные отображения и системы линейных уравнений.',
    siteName: 'Википедия',
  },
  {
    url: 'https://github.com/topics/algorithms',
    label: 'Подборка задач по алгоритмам',
    title: 'algorithms · GitHub Topics',
    description: 'Algorithms are self-contained sequences that carry out a variety of tasks.',
    siteName: 'GitHub',
  },
  {
    url: 'https://egov.kz/cms/ru',
    label: 'Справку об обучении можно заказать и тут',
    title: 'Электронное правительство Республики Казахстан',
    description: 'Государственные услуги и информация для граждан и бизнеса онлайн.',
    siteName: 'eGov.kz',
  },
]

const CAPTIONS = {
  DOCUMENT: ['Методичка к лабораторной', 'Шаблон отчёта', 'Таблица с баллами', 'Слайды лекции'],
  ARCHIVE: ['Исходники проекта', 'Все лабораторные одним архивом', 'Материалы к экзамену'],
  VIDEO: ['Запись решения у доски', 'Видео с практики', 'Демо нашего проекта'],
  MUSIC: ['Плейлист для подготовки 🎧', 'Аудиокнига по истории', 'Запись с репетиции хора'],
}

// Обращения в поддержку платформы: все теги SUPPORT_TAGS и все состояния очереди — открытое
// свободное без ответа, взятое в работу, закрытое после ответа, склеенное с другим,
// открытое заново после закрытия и пустое (чат поддержки открыли, но не написали). Смещения
// сообщений — в минутах от начала обращения; `staff` — ответ команды.
const TICKETS = [
  {
    author: 'student',
    tags: ['ACCESS'],
    startDays: 2,
    messages: [
      ['author', 0, 'Не могу войти в приложение: после кода из SMS снова просит пароль.'],
      ['author', 5, 'Прикладываю скриншот ошибки.', 'image'],
    ],
  },
  {
    author: 'teacher',
    tags: ['DATA', 'BUG'],
    startDays: 5,
    assignee: 0,
    messages: [
      ['author', 0, 'В журнале у группы пропали оценки за прошлую неделю, хотя я их выставлял.'],
      [
        'staff',
        180,
        'Здравствуйте! Проверили: оценки на месте, сбой был в кеше. Обновите страницу.',
      ],
      ['author', 1440, 'Обновил — у двух студентов всё ещё пусто.'],
    ],
  },
  {
    author: 'dean',
    tags: ['DOCS'],
    startDays: 12,
    assignee: 1,
    close: true,
    messages: [
      ['author', 0, 'Как настроить шаблон справки с печатью факультета?'],
      [
        'staff',
        60,
        'Шаблон загружается в «Документы» → «Шаблоны»: DOCX с полями в фигурных скобках.',
      ],
      ['author', 120, 'Получилось, спасибо!'],
      ['staff', 130, 'Рады помочь. Закрываем обращение — пишите, если что-то понадобится.'],
    ],
  },
  {
    author: 'student2',
    tags: ['FEATURE'],
    startDays: 20,
    mergedInto: 4,
    messages: [['author', 0, 'Можно ли добавить тёмную тему в расписание на телефоне?']],
  },
  {
    author: 'student2',
    tags: ['FEATURE', 'OTHER'],
    startDays: 19,
    assignee: 0,
    messages: [
      ['author', 0, 'Повторю вопрос: будет ли тёмная тема и экспорт расписания в календарь?'],
      ['staff', 120, 'Тёмная тема уже в работе, экспорт в календарь — следующим этапом.', 'voice'],
      ['author', 1440, 'Понял, жду обновления 🙂'],
    ],
  },
  {
    author: 'starosta',
    tags: ['ABUSE'],
    startDays: 9,
    // Закрыто командой через сутки после ответа, автор написал снова — обращение открылось.
    reopened: true,
    messages: [
      ['author', 0, 'В общем чате факультета пишут оскорбления, жалоба через меню не уходит.'],
      ['staff', 240, 'Спасибо, передали модераторам — нарушитель заблокирован.'],
      ['author', 11_000, 'Снова пишет тот же человек, уже с другого аккаунта.'],
    ],
  },
  { author: 'admin', tags: [], startDays: 1, messages: [] },
]

const at = (ms) => new Date(Math.min(Date.now(), ms))
const ago = (days, minutes = 0) => at(Date.now() - days * DAY + minutes * MINUTE)
const fullName = (user) => (user ? `${user.lastName} ${user.firstName}`.trim() : undefined)

/** Образцы бакета чатов по видам; null — пула нет (MinIO недоступен). */
function mediaKit(pool) {
  const of = (filter) => formatSamples(pool?.formats, 'chat', filter)
  if (of().length === 0) return null
  const images = of({ categories: ['IMAGE'] }).filter((s) => s.role !== 'gif')
  const kit = {
    images,
    gifs: of({ categories: ['IMAGE'], roles: ['gif'] }),
    videos: of({ categories: ['VIDEO'] }),
    documents: of({ categories: ['DOCUMENT'] }),
    archives: of({ categories: ['ARCHIVE'] }),
    voices: of({ categories: ['AUDIO'], roles: ['voice'] }),
    music: of({ categories: ['AUDIO'], roles: ['music'] }),
  }
  kit.nextImage = formatCycler(images)
  kit.nextDocument = formatCycler(kit.documents)
  kit.nextVoice = formatCycler(kit.voices)
  kit.nextMusic = formatCycler(kit.music)
  return kit
}

export async function seedChatCoverage(prisma, writer, ctx) {
  const { index, structure, people, pool, cityCoords } = ctx
  const { uniId, profile } = structure
  const random = makeRandom(SEED_BASE + index * 7919 + 64)
  const groups = people.faculties.flatMap((faculty) =>
    faculty.groups.map((group) => ({ group, faculty })),
  )
  if (groups.length === 0) return { messages: 0 }

  // Слот → группа по кругу; для сценариев личных чатов — первая подходящая по числу людей.
  const slot = (n, minStudents = 1) => {
    for (let k = 0; k < groups.length; k += 1) {
      const entry = groups[(n + k) % groups.length]
      if (entry.group.studentIds.length >= minStudents) return entry
    }
    return null
  }
  const chatOf = {
    grp: (g) => child(g.id, 'chat', 'grp'),
    off: (g) => child(g.id, 'chat', 'off'),
    subj: (g) => child(g.id, 'chat', 'subj'),
    pv: (g, k) => child(g.id, 'chat', 'pv', k),
    saved: (g) => child(g.starostaId, 'chat', 'saved'),
    dean: (f) => child(f.id, 'chat', 'dean'),
    fac: (f) => child(f.id, 'chat', 'fac'),
  }

  const media = mediaKit(pool)
  let fileSeq = 0
  let emojiSeq = 0

  // ── Справочники из базы ────────────────────────────────────────────────────
  // Стикеры заводит общий шаг до вузов (95-stickers) — только при MinIO и только опубликованные
  // набором клиенты увидят. Нет набора — нет ни стикеров в сообщениях, ни избранного.
  const stickers = (
    await prisma.sticker.findMany({
      where: { set: { slug: STICKER_SET_SLUG, isPublished: true } },
      select: { id: true },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      take: 100,
    })
  ).map((s) => s.id)
  const nextSticker = (n) => stickers[n % stickers.length]
  // Команда платформы — участники каждого обращения (как createTicket у SupportService).
  const staff = (
    await prisma.user.findMany({
      where: { role: { in: STAFF_ROLES }, deletedAt: null, isBlocked: false },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 50,
    })
  ).map((u) => u.id)

  // Исходники пересылок из шага 60 (первое сообщение чата) и посты шага 50: читаются из
  // базы, а не выводятся, — копия обязана совпасть с оригиналом слово в слово.
  const g1 = slot(1)
  const g6 = slot(6)
  const g7 = slot(7)
  const sourceIds = [child(chatOf.off(g1.group), 'msg', 1), child(chatOf.grp(g6.group), 'msg', 1)]
  const sources = new Map(
    (
      await prisma.message.findMany({
        where: { id: { in: sourceIds }, deletedAt: null },
        select: { id: true, content: true },
        take: sourceIds.length,
      })
    ).map((m) => [m.id, { ...m, external: true }]),
  )
  const postIds = [child(g1.group.id, 'post', 0), id(index, 'post', 'uni', 1)]
  const posts = new Set(
    (
      await prisma.post.findMany({
        where: { id: { in: postIds }, deletedAt: null },
        select: { id: true },
        take: postIds.length,
      })
    ).map((p) => p.id),
  )

  // ── Новые чаты: группа команды, запрос на переписку, обращения ────────────
  const allStudents = groups.flatMap(({ group }) => group.studentIds)
  const g0 = groups[0]
  const starosta = g0.group.starostaId
  const others = allStudents.filter((s) => s !== starosta)
  // Команда курсового: семь разных студентов — создатель, будущий владелец, вошедший по
  // ссылке, админ «на время», забаненный, исключённый и вышедший сам.
  const team = random.sample(others, 7)
  const nameIds = [...team]
  const users = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: nameIds } },
        select: { id: true, firstName: true, lastName: true },
        take: nameIds.length,
      })
    ).map((u) => [u.id, u]),
  )

  // Время последнего события нового чата сверх сообщений (закрытие или склейка обращения):
  // updatedAt после записи сообщений не должен оказаться раньше него.
  const touchedAt = new Map()
  const addChat = async (row, members) => {
    // universityId у пользовательской группы, личного чата и обращения API не ставит, и ни
    // один запрос по нему такие чаты не выбирает (официальные ищутся по типу + скоупу). Сид
    // ставит его всем своим чатам, как шаг 60: уборка прогона (cleanup.mjs) сносит чаты по
    // universityId, и без него обращения пережили бы свой вуз.
    await writer.add('chat', { universityId: uniId, lastSeq: 0, ...row })
    for (const [mi, member] of members.entries()) {
      await writer.add('chatMember', { id: child(row.id, 'm', mi), chatId: row.id, ...member })
    }
    touchedAt.set(row.id, row.updatedAt)
  }

  const teamChatId = id(index, 'chat', 'team', 0)
  const [creator, owner, joiner, tempAdmin, banned, removed, leaver] = team
  const teamStart = Date.now() - 14 * DAY
  const teamAt = (hours) => at(teamStart + hours * 3_600_000)
  if (team.length === 7) {
    const photo = pool?.photos?.length ? pool.photos[(index * 13) % pool.photos.length] : null
    await addChat(
      {
        id: teamChatId,
        type: 'GROUP',
        title: 'Курсовой проект — команда',
        description: 'Чат команды по курсовому: дедлайны, черновики и созвоны. Файлы — в закрепе.',
        // Публичный URL из profile-media, а не из avatars: удаление аватара группы снимает
        // объект по ключу в бакете avatars, и общий портрет пула погас бы у всех.
        avatarUrl: photo?.url ?? null,
        // Владелец — тот, кому передали группу (owner_changed ниже); создатель остался админом.
        createdById: owner,
        // Код ссылки-приглашения случайный, как у сервиса: предсказуемый код в базе, где
        // гоняют сид, был бы готовым входом в чужую группу. Повторный прогон его не меняет —
        // строка чата уже есть, и skipDuplicates оставляет прежний.
        inviteCode: randomBytes(18).toString('base64url'),
        createdAt: teamAt(0),
        updatedAt: teamAt(0),
      },
      [
        { userId: creator, isAdmin: true, createdAt: teamAt(0), lastReadAt: ago(0, -30) },
        { userId: owner, isAdmin: true, createdAt: teamAt(0.1), lastReadAt: ago(0, -10) },
        { userId: joiner, createdAt: teamAt(20), lastReadAt: ago(1) },
        { userId: tempAdmin, createdAt: teamAt(0.2) },
        { userId: banned, createdAt: teamAt(0.3), bannedAt: teamAt(70) },
      ],
    )
  }

  // Запрос на переписку (§50): личный чат между студентами разных групп — дружбы шаг 50
  // заводит только внутри группы, значит, эти двое не друзья, и чат ждёт принятия адресата.
  const reqFrom = slot(2, 2)
  const reqTo = groups.find(({ group }) => group.id !== reqFrom?.group.id && group.studentIds.length > 1) // prettier-ignore
  const requestChatId = id(index, 'chat', 'req', 0)
  if (reqFrom && reqTo) {
    await addChat(
      {
        id: requestChatId,
        type: 'PRIVATE',
        requestPendingForId: reqTo.group.studentIds[1],
        createdAt: ago(1, -60),
        updatedAt: ago(1, -60),
      },
      [
        { userId: reqFrom.group.studentIds[1], createdAt: ago(1, -60), lastReadAt: ago(1) },
        { userId: reqTo.group.studentIds[1], createdAt: ago(1, -60) },
      ],
    )
  }

  // Обращения: автор и вся команда платформы в участниках. Без команды обращение некому
  // разбирать — тогда их нет вовсе.
  const authors = {
    student: others[0],
    student2: others[1],
    starosta,
    teacher: g0.faculty.teacherIds[0],
    dean: g0.faculty.deanId,
    admin: people.adminId,
  }
  const ticketIds = TICKETS.map((_, ti) => id(index, 'ticket', ti))
  const ticketPlans = []
  if (staff.length > 0) {
    for (const [ti, spec] of TICKETS.entries()) {
      const authorId = authors[spec.author]
      if (!authorId) continue
      const start = Date.now() - spec.startDays * DAY
      const msgAt = (minutes) => at(start + minutes * MINUTE)
      const assigneeId = spec.assignee != null ? staff[spec.assignee % staff.length] : null
      const responderId = assigneeId ?? staff[ti % staff.length]
      const messages = spec.messages.map(([who, minutes, content, kind]) => ({
        senderId: who === 'staff' ? responderId : authorId,
        fromStaff: who === 'staff',
        at: msgAt(minutes),
        content,
        kind,
      }))
      const last = messages.at(-1)?.at ?? msgAt(0)
      const firstReply = messages.find((m) => m.fromStaff)?.at ?? null
      const closedAt = spec.close
        ? at(last.getTime() + 10 * MINUTE)
        : spec.mergedInto != null
          ? msgAt(24 * 60)
          : null
      await addChat(
        {
          id: ticketIds[ti],
          type: 'SUPPORT_PLATFORM',
          supportTags: spec.tags,
          supportAssigneeId: assigneeId,
          supportClosedAt: closedAt,
          supportMergedIntoId: spec.mergedInto != null ? ticketIds[spec.mergedInto] : null,
          supportFirstReplyAt: firstReply,
          createdAt: msgAt(-1),
          updatedAt: closedAt && closedAt > last ? closedAt : last,
        },
        [authorId, ...staff.filter((s) => s !== authorId)].map((userId) => ({
          userId,
          createdAt: msgAt(-1),
          lastReadAt:
            userId === authorId ? last : userId === assigneeId ? (firstReply ?? null) : null,
        })),
      )
      ticketPlans.push({ chatId: ticketIds[ti], messages })
    }
  }
  // Чаты и участники — до сообщений (FK).
  await writer.flush()

  // ── План сообщений ─────────────────────────────────────────────────────────
  const plans = []
  const add = (chatId, key, senderId, fields = {}) => {
    const plan = { id: `${chatId}-msg-cv-${key}`, chatId, senderId, content: '', ...fields }
    plans.push(plan)
    return plan
  }
  // Пересылка — копия содержимого оригинала (как copyForward у сервиса): текст, превью,
  // пост, стикер и вложения (новые строки File на тот же объект) плюс ссылка на источник.
  const forwardOf = (source) => ({
    forwardOf: source,
    content: source.content,
    ...(source.linkPreview ? { linkPreview: source.linkPreview } : {}),
    ...(source.sharedPostId ? { sharedPostId: source.sharedPostId } : {}),
    ...(source.stickerId ? { stickerId: source.stickerId } : {}),
    ...(source.files ? { files: source.files, asDocument: source.asDocument } : {}),
  })
  const files = (samples, spoilerAt = []) =>
    samples.map((sample, i) => ({ sample, spoiler: spoilerAt.includes(i) }))

  // Слот 5 — трансляция геопозиции, уже завершённая. Первой в плане: так она получает самое
  // раннее время, и конец трансляции (через 15 минут) гарантированно в прошлом.
  const g5 = slot(5, 2)
  if (g5 && cityCoords) {
    const [lat, lng] = cityCoords
    add(chatOf.pv(g5.group, 0), 'live', g5.group.studentIds[1], {
      location: {
        lat: Number((lat + (random.rng() - 0.5) * 0.02).toFixed(6)),
        lng: Number((lng + (random.rng() - 0.5) * 0.02).toFixed(6)),
        title: 'Иду к главному корпусу',
        address: `${profile.cityName}, главный корпус`,
        live: true,
        heading: random.randInt(0, 359),
        accuracy: random.randInt(5, 25),
      },
    })
  }

  // Слот 0 — медиа в чате группы: фотоальбом, фото+видео, спойлер, GIF, видео всех
  // форматов, снимок «без сжатия».
  if (media && media.images.length > 0) {
    const { group } = slot(0)
    const chatId = chatOf.grp(group)
    const s = (n) => group.studentIds[n % group.studentIds.length]
    add(chatId, 'album', s(1), {
      content: 'Фото с практики 📸',
      files: files(media.images),
      reactions: [s(0), s(2), s(3), s(2)],
    })
    if (media.videos.length > 0) {
      // Альбом из фото и видео; снимок в нём — под спойлером (спойлер — свойство вложения).
      add(chatId, 'mixed', s(2), {
        files: files([media.images[1 % media.images.length], media.videos[0]], [0]),
      })
    }
    add(chatId, 'spoiler', s(3), {
      content: 'Ответы к самостоятельной — не открывайте, пока не решите сами',
      files: files([media.images[2 % media.images.length]], [0]),
    })
    for (const [i, gif] of media.gifs.entries()) {
      add(chatId, `gif-${i}`, s(4 + i), { files: files([gif]), reactions: [s(1)] })
    }
    for (const [i, video] of media.videos.entries()) {
      add(chatId, `video-${i}`, s(i), { content: CAPTIONS.VIDEO[i % 3], files: files([video]) })
    }
    const png = media.images.find((img) => img.mime === 'image/png') ?? media.images[0]
    add(chatId, 'asdoc', s(5), {
      content: 'Скан расписания без сжатия',
      files: files([png]),
      asDocument: true,
    })
  }

  // Слот 1 — текстовые возможности в чате группы.
  {
    const { group } = g1
    const chatId = chatOf.grp(group)
    const s = (n) => group.studentIds[n % group.studentIds.length]
    const link = LINKS[index % LINKS.length]
    const linkMsg = add(chatId, 'link', s(1), {
      content: `${link.label}: ${link.url}`,
      linkPreview: {
        url: link.url,
        title: link.title,
        description: link.description,
        image: null,
        siteName: link.siteName,
      },
      reactions: [s(2), s(3)],
    })
    add(chatId, 'quote', s(2), {
      content: 'Спасибо! Вторую главу уже кто-нибудь разобрал?',
      replyTo: linkMsg,
      replyQuote: link.label,
    })
    add(chatId, 'silent', s(0), {
      content: 'Тихое напоминание: завтра пары с 8:00 🌙',
      silent: true,
    })
    add(chatId, 'edited', s(3), {
      content: 'Собираемся в 214 аудитории (поправил номер)',
      editedAfter: 5,
    })
    const deleted = add(chatId, 'deleted', s(4), {
      content: 'Ой, не в тот чат написал',
      // Удалено позже, чем на него успели ответить (следующее сообщение — через CLOCK_STEP):
      // ответ на удалённое клиент рисует плашкой «сообщение удалено».
      deletedAfter: 30,
    })
    add(chatId, 'reply-deleted', s(5), { content: 'А что там было?', replyTo: deleted })
    if (stickers.length > 0) {
      add(chatId, 'sticker', s(1), { stickerId: nextSticker(index), reactions: [s(0)] })
    }
    const groupPost = child(group.id, 'post', 0)
    if (posts.has(groupPost)) {
      add(chatId, 'post', s(2), { content: 'Посмотрите пост старосты', sharedPostId: groupPost })
    }
    const offFirst = sources.get(child(chatOf.off(group), 'msg', 1))
    if (offFirst) add(chatId, 'fwd-off', s(3), forwardOf(offFirst))
    add(chatId, 'unpinned', s(0), {
      content: 'Ссылка на старое расписание (уже неактуально)',
      pin: 'unpinned',
    })
    const pinned = add(chatId, 'pinned', s(0), {
      content: 'Важно: дедлайн курсовой — 20 декабря',
      pin: 'pinned',
      reactions: [s(1), s(2), s(4)],
    })
    add(chatId, 'sys-pin', s(0), { systemType: 'message_pinned', after: pinned })
    add(chatId, 'poll-multi', s(0), {
      content: 'Какие темы разобрать на консультации?',
      poll: {
        description: 'Можно выбрать несколько вариантов',
        multiple: true,
        anonymous: false,
        allowRevote: false,
        randomOrder: true,
        closed: false,
        options: ['Пределы', 'Производные', 'Интегралы', 'Ряды'],
        voters: 4,
      },
    })
    add(chatId, 'poll-anon', s(0), {
      content: 'Удобно ли новое расписание?',
      poll: {
        description: null,
        multiple: false,
        anonymous: true,
        allowRevote: true,
        randomOrder: false,
        closed: true,
        options: ['Да', 'Нет', 'Без разницы'],
        voters: 5,
      },
    })
    // Чек-лист «только автор»: шаг 62 ставит запреты случайно и на вуз их может не выпасть.
    add(chatId, 'checklist', s(0), {
      checklist: {
        title: 'Сдача курсовой',
        othersCanAdd: false,
        othersCanMark: false,
        items: ['Выбрать тему', 'Согласовать с руководителем', 'Сдать черновик', 'Защитить'],
        done: 2,
      },
    })
  }

  // Слот 2 — документы всех форматов в предметном чате, ответ с цитатой и пересылка
  // документа в личный чат (вложение — новая строка File на тот же объект).
  if (media && media.documents.length > 0) {
    const { group, faculty } = slot(2)
    const chatId = chatOf.subj(group)
    const teacher = faculty.teacherIds[0]
    const docs = media.documents.map((doc, i) =>
      add(chatId, `doc-${i}`, teacher, {
        content: CAPTIONS.DOCUMENT[i % CAPTIONS.DOCUMENT.length],
        files: files([doc]),
        reactions: i === 0 ? group.studentIds.slice(0, 2) : [],
      }),
    )
    add(chatId, 'doc-reply', group.studentIds[0], {
      content: 'Отчёт оформлять по этому шаблону или по прошлогоднему?',
      replyTo: docs[1 % docs.length],
      replyQuote: docs[1 % docs.length].content,
    })
    if (group.studentIds.length >= 2) {
      add(chatOf.pv(group, 0), 'fwd-doc', group.studentIds[0], forwardOf(docs[0]))
    }
  }

  // Слот 3 — архивы всех форматов в чате группы.
  if (media && media.archives.length > 0) {
    const { group } = slot(3)
    const chatId = chatOf.grp(group)
    for (const [i, archive] of media.archives.entries()) {
      add(chatId, `arc-${i}`, group.studentIds[i % group.studentIds.length], {
        content: i < CAPTIONS.ARCHIVE.length ? CAPTIONS.ARCHIVE[i] : '',
        files: files([archive]),
      })
    }
  }

  // Слот 4 — голосовые и музыка в личных чатах, стикер и его пересылка.
  const g4 = slot(4, 2)
  if (g4) {
    const { group } = g4
    const [a, b, c] = group.studentIds
    const pv0 = chatOf.pv(group, 0)
    if (media && media.voices.length > 0) {
      const voices = media.voices.map((voice, i) =>
        add(pv0, `voice-${i}`, i % 2 === 0 ? a : b, { files: files([voice]) }),
      )
      add(pv0, 'voice-reply', b, {
        content: 'Ок, понял, захвачу 👍',
        replyTo: voices[0],
        reactions: [a],
      })
    }
    if (media && media.music.length > 0) {
      // Второй личный чат группы есть, когда в ней хотя бы трое (шаг 60: пары соседей).
      const musicChat = c ? chatOf.pv(group, 1) : pv0
      const [m1, m2] = c ? [b, c] : [a, b]
      for (const [i, track] of media.music.entries()) {
        add(musicChat, `music-${i}`, i % 2 === 0 ? m1 : m2, {
          content: CAPTIONS.MUSIC[i % CAPTIONS.MUSIC.length],
          files: files([track]),
        })
      }
    }
    // Карточка контакта с несколькими телефонами и адресами (у шага 62 — по одному).
    add(pv0, 'contact', b, {
      contact: {
        name: 'Библиотека — абонемент',
        phones: [phone(random), phone(random)],
        emails: [`library@${uniPrefix(index)}.edu.kz`, `abonement@${uniPrefix(index)}.edu.kz`],
      },
    })
    if (stickers.length > 0) {
      const sticker = add(chatOf.grp(group), 'sticker-src', a, {
        stickerId: nextSticker(index + 1),
      })
      add(pv0, 'fwd-sticker', a, forwardOf(sticker))
    }
  }

  // Слот 6 — «Сохранённые» старосты: пересланное из чата группы, заметка, файл.
  {
    const { group } = g6
    const chatId = chatOf.saved(group)
    const grpFirst = sources.get(child(chatOf.grp(group), 'msg', 1))
    if (grpFirst) add(chatId, 'fwd', group.starostaId, forwardOf(grpFirst))
    add(chatId, 'note', group.starostaId, { content: 'Не забыть: продлить пропуск до пятницы' })
    if (media) {
      const doc = media.nextDocument()
      if (doc) add(chatId, 'doc', group.starostaId, { content: 'Себе на потом', files: files([doc]) }) // prettier-ignore
    }
  }

  // Слот 7 — чат деканата: вопрос студента, ответ декана с цитатой, карточка поста вуза,
  // скан заявления.
  {
    const { group, faculty } = g7
    const chatId = chatOf.dean(faculty)
    const student = group.studentIds[0]
    const ask = add(chatId, 'ask', student, {
      content: 'Здравствуйте! Подскажите, где взять справку для военкомата?',
    })
    add(chatId, 'answer', faculty.deanId, {
      content: 'Справку можно заказать в разделе «Заявки», готовится до трёх рабочих дней.',
      replyTo: ask,
      replyQuote: 'справку для военкомата',
    })
    const uniPost = id(index, 'post', 'uni', 1)
    if (posts.has(uniPost)) {
      add(chatId, 'post', faculty.deanId, { content: 'Подробности — в объявлении', sharedPostId: uniPost }) // prettier-ignore
    }
    if (media) {
      const scan = media.nextImage()
      if (scan) {
        add(chatId, 'scan', student, {
          content: 'Скан заявления',
          files: files([scan]),
          asDocument: true,
        })
      }
    }
  }

  // Слот 8 — чат факультета: закреплённое объявление «без звука» и системная строка о закрепе.
  {
    const { faculty } = slot(8)
    const chatId = chatOf.fac(faculty)
    const notice = add(chatId, 'notice', faculty.deanId, {
      content: 'Заседание кафедры переносится на среду, 15:00. Явка обязательна.',
      silent: true,
      pin: 'pinned',
    })
    add(chatId, 'sys-pin', faculty.deanId, { systemType: 'message_pinned', after: notice })
    if (faculty.teacherIds[1] ?? faculty.teacherIds[0]) {
      add(chatId, 'ack', faculty.teacherIds[1] ?? faculty.teacherIds[0], {
        content: 'Принято, буду.',
        replyTo: notice,
        replyQuote: 'переносится на среду',
      })
    }
  }

  // Группа команды: все одиннадцать системных событий, которые эмитит сервис (§20), в той
  // последовательности, в какой они правдоподобно случаются.
  if (team.length === 7) {
    const name = (userId) => fullName(users.get(userId))
    const t = (key, hours, senderId, fields) =>
      add(teamChatId, key, senderId, { at: teamAt(hours), ...fields })
    t('01', 0.01, creator, { content: 'Создал чат для курсового, добавляю всех' })
    t('02', 0.1, creator, { systemType: 'member_added', systemMeta: { targetName: name(owner) } })
    t('03', 0.2, creator, { systemType: 'member_added', systemMeta: { targetName: name(tempAdmin) } }) // prettier-ignore
    t('04', 0.3, creator, { systemType: 'member_added', systemMeta: { targetName: name(banned) } })
    t('05', 0.4, creator, { systemType: 'member_added', systemMeta: { targetName: name(removed) } }) // prettier-ignore
    t('06', 0.5, creator, { systemType: 'member_added', systemMeta: { targetName: name(leaver) } })
    t('07', 2, creator, { systemType: 'title_changed', systemMeta: { title: 'Курсовой проект — команда' } }) // prettier-ignore
    t('08', 3, creator, { systemType: 'avatar_changed' })
    t('09', 20, joiner, { systemType: 'member_joined' })
    t('10', 21, creator, { systemType: 'admin_granted', systemMeta: { targetName: name(owner) } })
    t('11', 22, creator, { systemType: 'admin_granted', systemMeta: { targetName: name(tempAdmin) } }) // prettier-ignore
    const draft = t('12', 30, tempAdmin, {
      content: 'Набросал структуру отчёта, гляньте',
      ...(media ? { files: files([media.documents[1 % media.documents.length]]) } : {}),
    })
    t('13', 40, creator, { systemType: 'admin_revoked', systemMeta: { targetName: name(tempAdmin) } }) // prettier-ignore
    t('14', 50, creator, { systemType: 'member_removed', systemMeta: { targetName: name(removed) } }) // prettier-ignore
    t('15', 69, banned, { content: 'Продам готовые курсовые недорого, пишите в личку' })
    t('16', 70, creator, { systemType: 'member_banned', systemMeta: { targetName: name(banned) } })
    t('17', 90, leaver, { content: 'Я, наверное, в другую команду перейду, удачи!' })
    t('18', 91, leaver, { systemType: 'member_left' })
    const call = t('19', 120, owner, {
      content: 'Созвон в четверг в 19:00?',
      pin: 'pinned',
      pinnedById: creator,
      reactions: [creator, joiner, tempAdmin],
    })
    t('20', 121, creator, { systemType: 'message_pinned', after: call })
    t('21', 200, creator, { systemType: 'owner_changed', systemMeta: { targetName: name(owner) } }) // prettier-ignore
    t('22', 201, owner, { content: 'Принял, теперь чат на мне 🙂', replyTo: draft })
  }

  if (reqFrom && reqTo) {
    add(requestChatId, '01', reqFrom.group.studentIds[1], {
      at: ago(1),
      content: 'Привет! Видел твой проект на выставке — можно задать пару вопросов?',
    })
  }

  for (const ticket of ticketPlans) {
    for (const [mi, m] of ticket.messages.entries()) {
      const key = String(mi + 1).padStart(2, '0')
      const sample =
        m.kind === 'image' ? media?.nextImage() : m.kind === 'voice' ? media?.nextVoice() : null
      // Голосовой ответ команды без пула образцов — тем же текстом: пустой пузырь хуже.
      add(ticket.chatId, key, m.senderId, {
        at: m.at,
        content: m.kind === 'voice' && sample ? '' : m.content,
        ...(sample ? { files: files([sample]) } : {}),
      })
    }
  }

  // ── Номера, время и запись сообщений ─────────────────────────────────────
  const { placed, lastSeq: lastSeqOf } = await placePlans(prisma, plans)
  const clocked = placed.filter((p) => !p.at)
  const now = Date.now()
  clocked.forEach((p, i) => {
    p.createdAt = new Date(now - (clocked.length - i) * CLOCK_STEP)
  })
  for (const p of placed) if (p.at) p.createdAt = p.at
  const after = (plan, minutes) => at(plan.createdAt.getTime() + minutes * MINUTE)

  for (const p of placed) {
    // Закреп системной строкой: закреплённое сообщение получает время закрепа из неё.
    if (p.after?.pin === 'pinned') p.after.pinnedAt = p.createdAt
  }
  for (const p of placed) {
    await writer.add('message', {
      id: p.id,
      chatId: p.chatId,
      seq: p.seq,
      senderId: p.senderId,
      content: p.content,
      replyToId: p.replyTo?.id ?? null,
      replyQuote: p.replyQuote ?? null,
      silent: p.silent === true,
      forwardedFromId: p.forwardOf?.id ?? null,
      editedAt: p.editedAfter ? after(p, p.editedAfter) : null,
      deletedAt: p.deletedAfter ? after(p, p.deletedAfter) : null,
      pinnedAt: p.pin === 'pinned' ? (p.pinnedAt ?? after(p, 2)) : null,
      pinnedById: p.pin === 'pinned' ? (p.pinnedById ?? p.senderId) : null,
      // Снятый закреп: pinnedAt обнулён, след — unpinnedAt (по нему догон узнаёт о снятии).
      unpinnedAt: p.pin === 'unpinned' ? after(p, 4) : null,
      sharedPostId: p.sharedPostId ?? null,
      stickerId: p.stickerId ?? null,
      linkPreview: p.linkPreview,
      systemType: p.systemType ?? null,
      systemMeta: p.systemMeta,
      createdAt: p.createdAt,
    })
  }
  // Сообщения — до вложений, реакций и опросов (FK); буфер File в writer открыт раньше
  // сообщений (шаги 50–57), и без явного flush он мог бы уйти в базу первым.
  await writer.flush()

  // Chat.lastSeq и updatedAt — после сообщений, как в шаге 62. updatedAt — время последнего
  // события чата: по нему сортируются список чатов и очередь поддержки.
  const bumps = new Map()
  for (const p of placed) {
    const cur = bumps.get(p.chatId) ?? { seq: 0, at: new Date(0) }
    bumps.set(p.chatId, {
      seq: Math.max(cur.seq, p.seq),
      at: p.createdAt > cur.at ? p.createdAt : cur.at,
    })
  }
  // Только вверх: если после прошлого прогона в чат писали из интерфейса, lastSeq в базе уже
  // больше наших номеров, и «выровнять» его вниз значило бы сломать следующую отправку.
  const updates = [...bumps].filter(([chatId, b]) => b.seq > lastSeqOf.get(chatId))
  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map(([chatId, b]) =>
        prisma.chat.update({
          where: { id: chatId },
          data: {
            lastSeq: b.seq,
            updatedAt: new Date(Math.max(b.at.getTime(), touchedAt.get(chatId)?.getTime() ?? 0)),
          },
        }),
      ),
    )
  }

  // ── Вложения, реакции, опросы, геопозиция ────────────────────────────────
  for (const p of placed) {
    for (const [order, file] of (p.files ?? []).entries()) {
      fileSeq += 1
      await writer.add(
        'file',
        formatFileRow(file.sample, index * 1000 + fileSeq, {
          id: `${p.id}-f-${order}`,
          ownerId: p.senderId,
          messageId: p.id,
          order,
          spoiler: file.spoiler,
          asDocument: p.asDocument === true,
          createdAt: p.createdAt,
        }),
      )
    }
    for (const [ri, userId] of (p.reactions ?? []).entries()) {
      emojiSeq += 1
      await writer.add('messageReaction', {
        id: `${p.id}-rx-${ri}`,
        messageId: p.id,
        userId,
        emoji: EMOJIS[emojiSeq % EMOJIS.length],
        createdAt: after(p, 3 + ri),
      })
    }
    if (p.poll) await addPoll(writer, random, p, groupMembersOf(p.chatId, groups))
    if (p.checklist) {
      const { items, done, ...settings } = p.checklist
      const checklistId = child(p.id, 'cl')
      // Отмечать может только автор (othersCanMark: false) — первые `done` пунктов отмечены им.
      const rows = items.map((text, order) => ({
        id: child(checklistId, 'i', order),
        checklistId,
        text,
        order,
        doneById: order < done ? p.senderId : null,
        doneAt: order < done ? after(p, 30 * (order + 1)) : null,
        createdById: p.senderId,
        createdAt: p.createdAt,
      }))
      const touched = rows.reduce((max, r) => Math.max(max, r.doneAt?.getTime() ?? 0), p.createdAt.getTime()) // prettier-ignore
      await writer.add('chatChecklist', {
        id: checklistId,
        messageId: p.id,
        ...settings,
        createdAt: p.createdAt,
        updatedAt: new Date(touched),
      })
      for (const row of rows) await writer.add('chatChecklistItem', row)
    }
    if (p.contact) {
      // userId сервер не заполняет (поиск по телефону раскрывал бы, кто зарегистрирован).
      await writer.add('chatContact', { messageId: p.id, ...p.contact, userId: null })
    }
    if (p.location) {
      const { live, ...loc } = p.location
      const liveUntil = live ? after(p, 15) : null
      await writer.add('chatLocation', {
        messageId: p.id,
        ...loc,
        liveUntil,
        liveUpdatedAt: liveUntil,
        heading: live ? loc.heading : null,
      })
    }
  }
  await writer.flush()

  // ── Персональные настройки участников ──────────────────────────────────────
  await applyMemberSettings(prisma, g0)

  // ── Папки с правилами состава, избранные стикеры, отложенный ответ с цитатой ─
  const folders = [
    { name: 'Все группы', emoji: '📚', color: 0, includeGroups: true, excluded: chatOf.off(g0.group) }, // prettier-ignore
    { name: 'Друзья', emoji: '👥', color: 4, includeContacts: true, item: chatOf.pv(g0.group, 0) },
    { name: 'Не контакты', emoji: '📨', color: 6, includeNonContacts: true },
  ]
  for (const [fi, folder] of folders.entries()) {
    // Позиции 0 и 1 заняты папками шага 60 («Учёба», «Группа»).
    const folderId = child(starosta, 'fold', fi + 2)
    const { excluded, item, ...rules } = folder
    await writer.add('chatFolder', { id: folderId, userId: starosta, position: fi + 2, ...rules })
    if (excluded) {
      await writer.add('chatFolderItem', { id: child(folderId, 'x'), folderId, chatId: excluded, excluded: true }) // prettier-ignore
    }
    if (item && g0.group.studentIds.length >= 2) {
      await writer.add('chatFolderItem', { id: child(folderId, 'i'), folderId, chatId: item })
    }
  }

  if (stickers.length > 0) {
    const fans = [...groups.slice(0, 3).map(({ group }) => group.starostaId), g0.faculty.teacherIds[0]] // prettier-ignore
    for (const [ui, userId] of [...new Set(fans.filter(Boolean))].entries()) {
      const count = Math.min(5, stickers.length)
      for (let k = 0; k < count; k += 1) {
        await writer.add('favoriteSticker', {
          id: `${userId}-fst-${k}`,
          userId,
          stickerId: stickers[(ui * 3 + k) % stickers.length],
          // «Свежие сверху»: первый в списке — добавленный последним.
          createdAt: ago(k + 1),
        })
      }
    }
  }

  const linkPlan = placed.find((p) => p.id.endsWith('-msg-cv-link'))
  if (linkPlan) {
    await writer.add('scheduledMessage', {
      id: child(linkPlan.chatId, 'sched', 'cv'),
      chatId: linkPlan.chatId,
      senderId: g1.group.starostaId,
      content: 'Напоминаю: по этой методичке завтра летучка.',
      replyToId: linkPlan.id,
      replyQuote: LINKS[index % LINKS.length].label,
      silent: false,
      scheduledAt: new Date(Date.now() + 2 * DAY),
      createdAt: ago(0, -20),
    })
  }

  await writer.flush()
  return { messages: placed.length }
}

/**
 * Номера сообщений по правилам шага 62: lastSeq чата из базы, свои сообщения повторного
 * прогона — по id с прежним номером. Сообщение, чей чат не создан (шаг 60 его пропустил), и
 * сообщение, ссылающееся (ответом, пересылкой, закрепом) на не легшее, не кладутся: ответ
 * «в пустоту» сломал бы внешний ключ.
 */
async function placePlans(prisma, plans) {
  const chatIds = [...new Set(plans.map((p) => p.chatId))]
  const ids = plans.map((p) => p.id)
  const [chatRows, existing] = await Promise.all([
    prisma.chat.findMany({
      where: { id: { in: chatIds } },
      select: { id: true, lastSeq: true },
      take: chatIds.length,
    }),
    prisma.message.findMany({
      where: { id: { in: ids } },
      select: { id: true, seq: true },
      take: ids.length,
    }),
  ])
  const lastSeq = new Map(chatRows.map((c) => [c.id, c.lastSeq]))
  const existingSeq = new Map(existing.map((m) => [m.id, m.seq]))
  const nextSeq = new Map(lastSeq)
  const placedIds = new Set()
  const placed = []
  for (const plan of plans) {
    // Два плана с одним id заняли бы два номера под одно сообщение — дыру в seq.
    if (placedIds.has(plan.id)) throw new Error(`Сообщение ${plan.id} запланировано дважды`)
    if (!lastSeq.has(plan.chatId)) continue
    const refs = [plan.replyTo, plan.forwardOf, plan.after].filter((r) => r && !r.external)
    if (refs.some((r) => !placedIds.has(r.id))) continue
    if (existingSeq.has(plan.id)) {
      plan.seq = existingSeq.get(plan.id)
    } else {
      plan.seq = nextSeq.get(plan.chatId) + 1
      nextSeq.set(plan.chatId, plan.seq)
    }
    placedIds.add(plan.id)
    placed.push(plan)
  }
  return { placed, lastSeq }
}

/** Участники чата группы (для голосов в опросе): чат группы — это её студенты. */
function groupMembersOf(chatId, groups) {
  const entry = groups.find(({ group }) => chatId.startsWith(`${group.id}-chat-`))
  return entry?.group.studentIds ?? []
}

/**
 * Опрос: варианты и голоса. Голос уникален по (вариант, пользователь); при множественном
 * выборе человек голосует за два варианта — две строки, как пишет сервис.
 */
async function addPoll(writer, random, plan, members) {
  const { options, voters, ...settings } = plan.poll
  const pollId = child(plan.id, 'poll')
  await writer.add('chatPoll', {
    id: pollId,
    messageId: plan.id,
    question: plan.content,
    ...settings,
    createdAt: plan.createdAt,
  })
  const optionIds = options.map((_, oi) => child(pollId, 'o', oi))
  for (const [oi, text] of options.entries()) {
    await writer.add('chatPollOption', { id: optionIds[oi], pollId, text, order: oi })
  }
  for (const [vi, userId] of members.slice(0, voters).entries()) {
    const picks = settings.multiple ? [vi % options.length, (vi + 1) % options.length] : [vi % options.length] // prettier-ignore
    for (const oi of picks) {
      await writer.add('chatPollVote', {
        id: `${optionIds[oi]}-v-${userId}`,
        pollId,
        optionId: optionIds[oi],
        userId,
        createdAt: new Date(
          Math.min(Date.now(), plan.createdAt.getTime() + random.randInt(5, 120) * MINUTE),
        ),
      })
    }
  }
}

/**
 * Персональные настройки участников первой группы вуза: архив, mute на время, «только
 * важные», закрепы с ручным порядком, «пометить непрочитанным», очистка истории целиком и за
 * период, «удалить чат у себя». Апдейтом, а не вставкой: строки участников заводит шаг 60.
 *
 * В условии — «поле ещё пустое»: повторный прогон не переписывает отметки новым временем и
 * не трогает то, что человек успел поменять сам.
 */
async function applyMemberSettings(prisma, { group, faculty }) {
  const s = group.studentIds
  const off = child(group.id, 'chat', 'off')
  const grp = child(group.id, 'chat', 'grp')
  const subj = child(group.id, 'chat', 'subj')
  const saved = child(group.starostaId, 'chat', 'saved')
  const now = Date.now()
  const updates = [
    // Архив «у себя»: студент убрал чат деканата, преподаватель — чат факультета.
    s[1] && [child(faculty.id, 'chat', 'dean'), s[1], { archivedAt: null }, { archivedAt: new Date(now - 4 * DAY) }], // prettier-ignore
    faculty.teacherIds[0] && [child(faculty.id, 'chat', 'fac'), faculty.teacherIds[0], { archivedAt: null }, { archivedAt: new Date(now - 6 * DAY) }], // prettier-ignore
    // Mute на время (§17): до вечера, без «навсегда».
    s[2] && [off, s[2], { mutedUntil: null }, { mutedUntil: new Date(now + 8 * 3_600_000) }],
    // Заглушено, но ответы и упоминания доходят.
    s[5] && [grp, s[5], { muteImportantOnly: false }, { mutedAt: new Date(now - 3 * DAY), muteImportantOnly: true }], // prettier-ignore
    // Закрепы старосты с ручным порядком: 0 — самый верх.
    [grp, group.starostaId, { pinnedOrder: null }, { pinnedAt: new Date(now - DAY), pinnedOrder: 0 }], // prettier-ignore
    [subj, group.starostaId, { pinnedOrder: null }, { pinnedAt: new Date(now - 2 * DAY), pinnedOrder: 1 }], // prettier-ignore
    [saved, group.starostaId, { pinnedOrder: null }, { pinnedAt: new Date(now - 3 * DAY), pinnedOrder: 2 }], // prettier-ignore
    // «Пометить как новое» — чат непрочитан, хотя всё прочитано.
    s[1] && [subj, s[1], { markedUnreadAt: null }, { markedUnreadAt: new Date(now - 3_600_000), lastReadAt: new Date(now - 3_600_000) }], // prettier-ignore
    // Очистка истории «для меня»: целиком до отметки и за период (диапазоны — ISO-строки).
    s[3] && [grp, s[3], { clearedAt: null }, { clearedAt: new Date(now - 10 * DAY) }],
    s[4] && [grp, s[4], { clearedRanges: { equals: Prisma.AnyNull } }, { clearedRanges: [{ from: new Date(now - 20 * DAY).toISOString(), to: new Date(now - 15 * DAY).toISOString() }] }], // prettier-ignore
    // «Удалить чат у себя» — третий личный чат группы: шаг 62 и этот шаг в него не пишут, а
    // новое сообщение вернуло бы чат в список.
    s[3] && [child(group.id, 'chat', 'pv', 2), s[3], { hiddenAt: null }, { hiddenAt: new Date(now - 2 * DAY) }], // prettier-ignore
  ].filter(Boolean)
  await prisma.$transaction(
    updates.map(([chatId, userId, where, data]) =>
      prisma.chatMember.updateMany({ where: { chatId, userId, ...where }, data }),
    ),
  )
}
