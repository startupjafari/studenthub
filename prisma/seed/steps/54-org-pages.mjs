// Шаг «страницы организаций» (вызывается из 52): контент авторов, которые не принадлежат
// вузу, — платформы и компаний-работодателей.
//
//   • Платформа: посты с аудиторией ALL и сторис ALL (ALLOWED_AUDIENCES — только
//     платформенный админ и модератор). Видны всем вузам.
//   • Компании: посты страницы (аудитория COMPANY), статья, опрос и альбом страницы,
//     сторис для вузов-партнёров (PARTNER_UNIVERSITIES). Видят только вузы с действующим
//     допуском компании (CompanyUniversityAccess APPROVED и не истёк), поэтому шаг идёт
//     после карьеры (шаг 80), где допуски выдаются.
//
// ОБЩИЕ СТРОКИ ИЗ КАЖДОГО ВУЗА. Компания и платформа одни на весь прогон, а вузы идут
// параллельно: каждый вуз пишет одни и те же строки с одними и теми же id, и createMany
// со skipDuplicates оставляет первую. Поэтому содержимое общих строк не зависит от
// случайностей вуза — у компании свой поток (makeRandom от её id), у платформы — номера.
// От вуза зависят только его собственные строки: просмотры, голоса, реакции его студентов
// (их id включают id зрителя или вуза и между вузами не сталкиваются).

import { createHash } from 'node:crypto'
import { postPriority } from '../data/content.mjs'
import { formatFileRow } from '../lib/formats.mjs'
import { child, id } from '../lib/ids.mjs'
import { makeRandom } from '../lib/rng.mjs'
import {
  STORY_TTL_MS,
  albumMediaKit,
  postMediaKit,
  storyMediaKit,
  storyTextElement,
} from './51-social-media.mjs'

const PLATFORM_POSTS = [
  [
    'Обновление StudentHub',
    'В приложении появились сторис с опросами и «Актуальное» в профиле. Расскажите, чего не хватает.',
  ],
  [
    'Безопасность аккаунта',
    'Включите двухфакторную защиту в настройках: вход по одному паролю — главный риск взлома.',
  ],
]
const PLATFORM_STORIES = [
  'Новая версия приложения уже доступна — обновитесь 🚀',
  'Неделя карьеры на платформе: вакансии партнёров в разделе «Карьера».',
]
const COMPANY_POSTS = [
  'Открыт набор на летнюю стажировку: 8 недель, наставник и реальные задачи команды.',
  'Как проходит собеседование у нас: короткое интервью, тестовое задание и встреча с командой.',
  'Спасибо студентам за участие в нашем хакатоне! Лучшие решения — в фотоотчёте.',
]
const COMPANY_POLL = ['Какой формат стажировки вам удобнее?', ['Офис', 'Гибрид', 'Удалённо']]

// Платформенный админ и модератор — общие на процесс: вузы идут параллельно, а спросить
// базу достаточно один раз.
let platformAuthorsPromise = null
function platformAuthors(prisma) {
  platformAuthorsPromise ??= Promise.all(
    ['PLATFORM_ADMIN', 'PLATFORM_MODERATOR'].map((role) =>
      prisma.user.findFirst({
        where: { role, deletedAt: null, isBlocked: false },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }),
    ),
  ).then((rows) => rows.map((u) => u?.id ?? null))
  return platformAuthorsPromise
}

// Свой поток случайностей у общей сущности — от её id, а не от вуза.
const randomFor = (key) =>
  makeRandom(createHash('sha1').update(key).digest().readUInt32BE(0) % 2_000_000_000)

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000)

export async function seedOrgPages(prisma, writer, ctx, { writeStoryEngagement }) {
  const { index, random, structure, people, pool } = ctx
  const { uniId } = structure
  const stats = { platformPosts: 0, companyPosts: 0, orgStories: 0 }
  const allStudents = people.faculties.flatMap((f) => f.groups.flatMap((g) => g.studentIds))
  const allTeachers = people.faculties.flatMap((f) => f.teacherIds)
  const everyone = [...allStudents, ...allTeachers]

  // Строки по слоям: медиа сторис (для сторис файл — родитель), затем родители (посты,
  // альбомы, сторис, статьи, опросы), варианты опросов, затем дети (реакции, голоса, медиа
  // постов и альбомов — у них родитель пост или альбом). Каждый слой — после flush
  // предыдущего: порядок сброса буферов writer'а задаёт первое обращение к модели.
  const files = []
  const parents = []
  const optionRows = []
  const children = []
  const stories = []
  const albums = []

  // ── Платформа: посты и сторис для всех ──────────────────────────────────────
  const [platformAdmin, platformModerator] = await platformAuthors(prisma)
  if (platformAdmin) {
    const media = await postMediaKit(prisma, pool)
    for (const [k, [title, content]] of PLATFORM_POSTS.entries()) {
      const postId = child(platformAdmin, 'post', 'all', k)
      const publishedAt = daysAgo(3 + k * 4)
      parents.push([
        'post',
        {
          id: postId,
          authorId: platformAdmin,
          audience: 'ALL',
          title,
          content,
          status: 'PUBLISHED',
          publishedAt,
          createdAt: publishedAt,
          priority: postPriority('ALL', true),
        },
      ])
      for (const [m, make] of media.layout(k).entries()) {
        children.push(['file', make(m, { id: child(postId, 'm', m), ownerId: platformAdmin, postId, createdAt: publishedAt })]) // prettier-ignore
      }
      // Реакции студентов этого вуза: id с префиксом вуза — у каждого вуза свои.
      for (const [ri, userId] of random.sample(allStudents, random.randInt(2, 8)).entries()) {
        children.push([
          'reaction',
          {
            id: child(postId, 'rx', uniId, ri),
            postId,
            userId,
            emoji: '❤️',
            createdAt: daysAgo(1),
          },
        ])
      }
      stats.platformPosts += 1
    }
  }
  const storyKit = storyMediaKit(pool)
  for (const [k, authorId] of [platformAdmin, platformModerator].entries()) {
    if (!authorId) continue
    const storyId = child(authorId, 'story', 'all')
    const createdAt = new Date(Date.now() - (60 + k * 120) * 60_000)
    // У модератора — фото, у админа — текст на фоне с надписью: оба вида у ALL.
    const sample = k === 1 ? storyKit.image() : null
    const file = sample
      ? formatFileRow(sample, k, { id: child(storyId, 'f'), ownerId: authorId, createdAt })
      : null
    if (file) files.push(file)
    stories.push({
      row: {
        id: storyId,
        authorId,
        audience: 'ALL',
        audienceUserIds: [],
        fileId: file?.id ?? null,
        text: PLATFORM_STORIES[k],
        background: file ? null : 'graphite',
        linkUrl: 'https://studenthub.app',
        linkLabel: 'Подробнее',
        elements: [storyTextElement(k + 4, 'StudentHub')],
        expiresAt: new Date(createdAt.getTime() + STORY_TTL_MS),
        createdAt,
      },
      viewers: everyone,
    })
  }

  // ── Компании с действующим допуском в этот вуз ──────────────────────────────
  const now = new Date()
  const accesses = await prisma.companyUniversityAccess.findMany({
    where: {
      universityId: uniId,
      status: 'APPROVED',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      company: { status: 'ACTIVE', deletedAt: null },
    },
    select: {
      companyId: true,
      company: {
        select: {
          name: true,
          members: { select: { userId: true, role: true }, orderBy: { userId: 'asc' }, take: 5 },
        },
      },
    },
    orderBy: { companyId: 'asc' },
    take: 20,
  })

  for (const { companyId, company } of accesses) {
    // Пишет владелец страницы; если его нет — любой сотрудник (все сотрудники публикуют).
    const owner = company.members.find((m) => m.role === 'OWNER') ?? company.members[0]
    if (!owner) continue
    const authorId = owner.userId
    const crandom = randomFor(companyId)
    // Свои наборы медиа на компанию: круг каждый раз с начала, и строки File выходят теми
    // же, из какого бы вуза их ни записали.
    const media = await postMediaKit(prisma, pool)
    const albumKit = albumMediaKit(pool)
    const storyMedia = storyMediaKit(pool)

    // Посты страницы: аудитория COMPANY, скоупа вуза нет. Приоритет 0 — в ленту вуза
    // такие посты не попадают, сравнивать его не с чем (AUDIENCE_PRIORITY.COMPANY).
    for (const [k, content] of COMPANY_POSTS.entries()) {
      const postId = `${companyId}-post-${k}`
      const publishedAt = daysAgo(5 + k * 9 + crandom.randInt(0, 3))
      parents.push([
        'post',
        {
          id: postId,
          authorId,
          audience: 'COMPANY',
          title: k === 0 ? 'Стажировка' : null,
          content,
          companyId,
          status: 'PUBLISHED',
          publishedAt,
          createdAt: publishedAt,
          views: crandom.randInt(50, 800),
          priority: 0,
        },
      ])
      // Первый — с фото, второй — с видео, третий — фотоотчёт альбомом.
      const sources = k === 2 ? media.layout(5) : media.layout(k === 0 ? 0 : 3)
      for (const [m, make] of sources.entries()) {
        children.push(['file', make(m, { id: child(postId, 'm', m), ownerId: authorId, postId, createdAt: publishedAt })]) // prettier-ignore
      }
      for (const [ri, userId] of random.sample(allStudents, random.randInt(0, 5)).entries()) {
        children.push([
          'reaction',
          {
            id: child(postId, 'rx', uniId, ri),
            postId,
            userId,
            emoji: '👍',
            createdAt: daysAgo(1),
          },
        ])
      }
      stats.companyPosts += 1
    }

    // Статья и опрос страницы: принадлежат компании (companyId), автор — сотрудник.
    const publishedAt = daysAgo(20)
    parents.push([
      'profileArticle',
      {
        id: `${companyId}-art-0`,
        userId: authorId,
        companyId,
        title: `Карьера в ${company.name}`.slice(0, 200),
        description: 'Чем мы занимаемся и кого ищем среди студентов.',
        content:
          'Мы растим инженеров и аналитиков с первого курса.\n\n' +
          '## Как попасть\n\nОткликнитесь на вакансию в разделе «Карьера» — мы отвечаем в течение недели.',
        coverGradient: `g${crandom.randInt(1, 18)}`,
        category: 'CAREER',
        tags: ['карьера', 'стажировка'],
        visibility: 'ALL',
        allowComments: true,
        status: 'PUBLISHED',
        readingMinutes: 2,
        views: crandom.randInt(100, 2000),
        publishedAt,
        createdAt: publishedAt,
      },
    ])
    const pollId = `${companyId}-poll-0`
    const [question, options] = COMPANY_POLL
    parents.push([
      'poll',
      {
        id: pollId,
        userId: authorId,
        companyId,
        question,
        multiple: false,
        anonymous: true,
        allowRevote: true,
        resultsVisibility: 'AFTER_VOTE',
        visibility: 'ALL',
        status: 'PUBLISHED',
        createdAt: publishedAt,
      },
    ])
    const optionIds = options.map((_, oi) => child(pollId, 'o', oi))
    for (const [oi, text] of options.entries()) {
      optionRows.push(['pollOption', { id: optionIds[oi], pollId, text, order: oi }])
    }
    // Голоса — студенты этого вуза; голос уникален по (вариант, человек).
    for (const userId of random.sample(allStudents, random.randInt(3, 12))) {
      const optionId = random.pick(optionIds)
      children.push(['pollVote', { id: `${optionId}-v-${userId}`, pollId, optionId, userId, createdAt: daysAgo(2) }]) // prettier-ignore
    }

    // Альбом страницы: медиа принадлежит компании (File.companyId), бакет медиа профиля.
    const albumId = `${companyId}-alb`
    albums.push(albumId)
    parents.push(['album', { id: albumId, userId: authorId, companyId, title: 'Жизнь команды', createdAt: daysAgo(40) }]) // prettier-ignore
    const kinds = ['photo', 'sample', 'video', 'photo']
    for (const [m, kind] of kinds.entries()) {
      const source = albumKit[kind]()
      if (!source) continue
      children.push([
        'file',
        source.make(m, { id: child(albumId, 'f', m), ownerId: authorId, companyId, albumId }),
      ])
    }

    // Сторис для вузов-партнёров: видят студенты и старосты вузов с допуском. Скоупа вуза
    // у неё нет (resolveTarget → {}), только автор-сотрудник.
    const storyId = child(authorId, 'story', 'partner')
    const createdAt = new Date(Date.now() - crandom.randInt(30, 600) * 60_000)
    const sample = storyMedia.video() ?? storyMedia.image()
    const file = sample
      ? formatFileRow(sample, 0, { id: child(storyId, 'f'), ownerId: authorId, createdAt })
      : null
    if (file) files.push(file)
    stories.push({
      row: {
        id: storyId,
        authorId,
        audience: 'PARTNER_UNIVERSITIES',
        audienceUserIds: [],
        fileId: file?.id ?? null,
        text: `${company.name}: открыт набор на стажировку`.slice(0, 600),
        background: file ? null : 'ocean',
        linkUrl: 'https://example.kz/careers',
        linkLabel: 'Откликнуться',
        elements: [storyTextElement(crandom.randInt(0, 26), 'Стажировка 2026')],
        expiresAt: new Date(createdAt.getTime() + STORY_TTL_MS),
        createdAt,
      },
      viewers: allStudents,
      poll: COMPANY_POLL,
    })
  }

  // ── Запись по слоям ─────────────────────────────────────────────────────────
  for (const file of files) await writer.add('file', file)
  await writer.flush()
  for (const [model, row] of parents) await writer.add(model, row)
  for (const { row } of stories) await writer.add('story', row)
  await writer.flush()
  for (const [model, row] of optionRows) await writer.add(model, row)
  await writer.flush()
  for (const [model, row] of children) await writer.add(model, row)
  for (const { row, viewers, poll } of stories) {
    await writeStoryEngagement(writer, random, row, viewers, { poll })
    stats.orgStories += 1
  }
  await writer.flush()
  if (albums.length > 0) {
    await prisma.$executeRaw`
      UPDATE albums SET cover_file_id = albums.id || '-f-0'
      WHERE albums.id = ANY(${albums}::text[])
        AND albums.cover_file_id IS NULL
        AND EXISTS (SELECT 1 FROM files f WHERE f.id = albums.id || '-f-0')`
  }

  // Жалоба на сторис работодателя: у автора нет вуза, поэтому и у жалобы его нет
  // (universityId = NULL) — её разбирает только модерация платформы.
  const partner = stories.find((s) => s.row.audience === 'PARTNER_UNIVERSITIES')
  if (partner && allStudents.length > 0) {
    await writer.add('complaint', {
      id: id(index, 'cmp', 'partner'),
      reporterId: allStudents[allStudents.length - 1],
      targetType: 'STORY',
      targetId: partner.row.id,
      reason: 'Реклама сторонних услуг',
      status: 'PENDING',
      priority: 'MEDIUM',
      universityId: null,
      createdAt: new Date(Math.max(partner.row.createdAt.getTime(), Date.now() - 5 * 60_000)),
    })
    await writer.flush()
  }

  return stats
}
