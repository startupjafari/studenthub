// Шаг «контент профиля»: портфолио, альбомы, статьи, опросы с голосами, закладки и
// комментарии к контенту. По решению пользователя — у КАЖДОГО студента, а не выборкой.
// Плюс страница университета: статьи, опрос и альбом от имени вуза (universityPageId).
//
// Медиа альбомов — ссылки на общий пул (см. 51-social-media.mjs): пара (bucket, key) у
// File не уникальна, поэтому у каждого альбома свои строки File на те же объекты. Прежнее
// «наполняются только альбомы из среза пула, остальные — с одной обложкой» снято миграцией
// 20260929121630_files_shared_object_pool: теперь фото и видео есть в каждом альбоме.
//
// Обложка альбома — фото ЭТОГО альбома (updateAlbum: «Обложка должна быть фото из этого
// альбома»). Обложка и файлы ссылаются друг на друга (Album.coverFileId → File,
// File.albumId → Album), поэтому обложка ставится третьим проходом, после альбомов и файлов.

import {
  ALBUM_TITLES,
  COMMENTS,
  PORTFOLIO_PROJECTS,
  articleBody,
  articleTitle,
  pollTopic,
} from '../data/content.mjs'
import { child, id } from '../lib/ids.mjs'
import { albumMediaKit } from './51-social-media.mjs'

// Видимость контента и видимость портфолио — РАЗНЫЕ перечисления в shared-schemas:
// CONTENT_VISIBILITY = ALL|UNIVERSITY|FACULTY|GROUP, а PORTFOLIO_VISIBILITY =
// PRIVATE|UNIVERSITY|PUBLIC. Общий список подсунул бы статье значение PRIVATE,
// которого схема контента не знает.
const CONTENT_VISIBILITY = ['ALL', 'UNIVERSITY', 'UNIVERSITY', 'FACULTY', 'GROUP']
// Категории — коды из ARTICLE_CATEGORIES (packages/shared-schemas/profile.ts).
const ARTICLE_CATEGORIES = ['STUDY','SCIENCE','STUDENT_LIFE','PROJECTS','INTERNSHIPS','CAREER','EVENTS','RESOURCES'] // prettier-ignore
const PORTFOLIO_VISIBILITY = ['PRIVATE', 'UNIVERSITY', 'PUBLIC']
// Виды портфолио кроме образования (PORTFOLIO_KINDS): у каждого студента — по записи
// каждого вида, чтобы все секции профиля были заполнены.
const PORTFOLIO_KINDS = ['EXPERIENCE', 'PROJECT', 'CERTIFICATE', 'ACHIEVEMENT']
// Ключи градиент-обложек статьи (ARTICLE_GRADIENTS в
// apps/web/src/entities/profile-content/ui/article-cover.tsx): g1…g18.
const ARTICLE_GRADIENTS = Array.from({ length: 18 }, (_, i) => `g${i + 1}`)

export async function seedProfileContent(prisma, writer, ctx) {
  const { index, random, structure, people, pool, config } = ctx
  const { uniId } = structure
  const [articlesMin, articlesMax] = config.articlesPerUser
  const [pollsMin, pollsMax] = config.pollsPerUser
  const media = albumMediaKit(pool)
  const covers = pool?.photos ?? []
  let coverCursor = index * 7
  let mediaCursor = 0

  const nextCover = () => (covers.length > 0 ? covers[coverCursor++ % covers.length] : null)

  // Обложка статьи — все три режима редактора: загруженное фото (coverUrl), пресет-градиент
  // (coverGradient) и «авто» (оба пусты). По кругу — каждый режим есть в каждом вузе.
  const articleCover = (n) => {
    const mode = n % 3
    const cover = mode === 0 ? nextCover() : null
    return {
      coverUrl: cover?.url ?? null,
      coverGradient: mode === 1 ? ARTICLE_GRADIENTS[n % ARTICLE_GRADIENTS.length] : null,
    }
  }

  // Файлы альбомов пишутся после альбомов (FK albumId), обложки — после файлов.
  const pendingFiles = []
  const albumsWithCover = []
  // Наполнение альбома: первым — фото (оно же обложка), дальше образец формата (по кругу
  // проходит jpeg/png/webp/gif/mp4/webm/mov), видео пула с постером и ещё фото.
  const fillAlbum = (albumId, ownerId, count, extra = {}) => {
    if (media.empty || count === 0) return
    const kinds = ['photo', 'sample', 'video', 'photo', 'sample', 'photo']
    for (let k = 0; k < count; k += 1) {
      const source = media[kinds[k % kinds.length]]()
      if (!source) continue
      pendingFiles.push(
        source.make(mediaCursor++, {
          id: child(albumId, 'f', k),
          ownerId,
          albumId,
          ...extra,
        }),
      )
    }
    albumsWithCover.push(albumId)
  }

  // Сколько статей досталось каждому: комментарий и закладка ссылаются на ПЕРВУЮ
  // статью, а при диапазоне «0-0» её нет ни у кого, и ссылка нарушила бы внешний ключ.
  const articleCounts = new Map()
  let articleN = 0

  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      for (const [si, studentId] of group.studentIds.entries()) {
        // ── Портфолио: образование + по записи каждого вида ─────────────────
        await writer.add('portfolioItem', {
          id: child(studentId, 'pf', 0),
          userId: studentId,
          kind: 'EDUCATION',
          title: `Бакалавриат, ${group.name}`,
          organization: structure.profile.name,
          description: 'Обучение по программе бакалавриата.',
          startDate: new Date(Date.UTC(group.year, 8, 1)),
          visibility: 'UNIVERSITY',
          order: 0,
        })
        for (const [ki, kind] of PORTFOLIO_KINDS.entries()) {
          const options = PORTFOLIO_PROJECTS.filter(([k]) => k === kind)
          const [, title, organization] = options[si % options.length]
          const k = ki + 1
          await writer.add('portfolioItem', {
            id: child(studentId, 'pf', k),
            userId: studentId,
            kind,
            title,
            organization,
            description: 'Подтверждающие документы приложены в профиле.',
            url: (si + k) % 3 === 0 ? 'https://portfolio.example.kz/item' : null,
            startDate: random.randomDate(-700, -60),
            endDate: random.chance(0.6) ? random.randomDate(-59, -10) : null,
            // Все три уровня приватности — по кругу: «только я» проверяется так же часто,
            // как публичная запись.
            visibility: PORTFOLIO_VISIBILITY[(si + k) % PORTFOLIO_VISIBILITY.length],
            order: k,
          })
        }

        // ── Альбом: 3–6 фото и видео, обложка — первое фото ─────────────────
        const albumId = child(studentId, 'alb')
        await writer.add('album', {
          id: albumId,
          userId: studentId,
          title: random.pick(ALBUM_TITLES),
          createdAt: random.randomDate(-300, -5),
        })
        fillAlbum(albumId, studentId, 3 + (si % 4))

        // ── Статьи: 20–50 на пользователя ───────────────────────────────────
        // Заголовок и тело собирает генератор: пятьдесят статей у одного автора из
        // списка в шесть штук выглядели бы как ошибка сида, а не как контент.
        const articleCount = random.randInt(articlesMin, articlesMax)
        articleCounts.set(studentId, articleCount)
        const firstArticleId = child(studentId, 'art', 0)
        for (let ai = 0; ai < articleCount; ai += 1) {
          const body = articleBody(random)
          const publishedAt = random.randomDate(-700, -1)
          await writer.add('profileArticle', {
            id: child(studentId, 'art', ai),
            userId: studentId,
            title: articleTitle(random),
            description: 'Личный опыт и выводы — коротко о том, что сработало.',
            content: body,
            ...articleCover(articleN++),
            category: random.pick(ARTICLE_CATEGORIES),
            tags: random.sample(['учёба', 'опыт', 'советы', 'проекты', 'карьера', 'наука'], 2),
            visibility: random.pick(CONTENT_VISIBILITY),
            allowComments: random.chance(0.9),
            status: ai === articleCount - 1 && random.chance(0.15) ? 'DRAFT' : 'PUBLISHED',
            // Оценка времени чтения: 900 знаков ≈ минута.
            readingMinutes: Math.max(1, Math.round(body.length / 900)),
            views: random.randInt(0, 400),
            publishedAt,
            createdAt: publishedAt,
          })
        }

        // ── Опросы: 10–100 на пользователя ──────────────────────────────────
        // Голоса — самый дорогой домен: 55 опросов на человека × 130 тыс. человек ×
        // голоса даёт десятки миллионов строк, поэтому их число ограничено
        // SEED_POLL_VOTES_MAX (по умолчанию до 3 на опрос).
        const pollCount = random.randInt(pollsMin, pollsMax)
        for (let qi = 0; qi < pollCount; qi += 1) {
          await addPoll(writer, random, {
            pollId: child(studentId, 'poll', qi),
            userId: studentId,
            voterPool: group.studentIds,
            votesMax: config.pollVotesMax,
            // Черновик — изредка последний опрос: у черновика нет голосов, его видит автор.
            draft: qi === pollCount - 1 && (si + qi) % 9 === 0,
            visibility: random.pick(CONTENT_VISIBILITY),
          })
        }

        // ── Комментарии к ПЕРВОЙ статье и закладки ──────────────────────────
        // Только к первой: комментарии на каждой из 20–50 статей — это ещё миллионы
        // строк при нулевой пользе для проверки экрана.
        const commenters =
          articleCount > 0 ? random.sample(group.studentIds, random.randInt(0, 3)) : []
        for (const [ci, commenterId] of commenters.entries()) {
          await writer.add('contentComment', {
            id: child(firstArticleId, 'cc', ci),
            authorId: commenterId,
            articleId: firstArticleId,
            content: random.pick(COMMENTS),
            createdAt: random.randomDate(-90, 0),
          })
        }
        // Закладка на статью однокурсника: уникальна по (user, article). Если у
        // однокурсника статей нет, закладывать нечего.
        if (si > 0 && (articleCounts.get(group.studentIds[si - 1]) ?? 0) > 0) {
          await writer.add('bookmark', {
            id: `${studentId}-bm-${si}`,
            userId: studentId,
            articleId: child(group.studentIds[si - 1], 'art', 0),
            createdAt: random.randomDate(-80, 0),
          })
        }
      }
    }
  }

  // ── Страница университета: статьи, опрос и альбом от имени вуза ─────────────
  // Контент страницы публикует админ или модератор вуза (canManagePageContent): автор —
  // сотрудник, принадлежит — вузу. Видимость ALL: страницу вуза открывают и компании с
  // допуском, и платформа.
  const allStudents = people.faculties.flatMap((f) => f.groups.flatMap((g) => g.studentIds))
  const pageAuthors = [people.adminId, ...people.moderatorIds]
  for (let k = 0; k < 2; k += 1) {
    const body = articleBody(random)
    const publishedAt = random.randomDate(-120, -1)
    await writer.add('profileArticle', {
      id: id(index, 'upage', 'art', k),
      userId: pageAuthors[k % pageAuthors.length],
      universityPageId: uniId,
      title: k === 0 ? `О университете: ${structure.profile.name}`.slice(0, 200) : articleTitle(random), // prettier-ignore
      description: 'Новости и история университета.',
      content: body,
      ...articleCover(k),
      category: k === 0 ? 'STUDENT_LIFE' : 'EVENTS',
      tags: ['университет', 'новости'],
      visibility: 'ALL',
      allowComments: true,
      status: 'PUBLISHED',
      readingMinutes: Math.max(1, Math.round(body.length / 900)),
      views: random.randInt(100, 3000),
      publishedAt,
      createdAt: publishedAt,
    })
  }
  await addPoll(writer, random, {
    pollId: id(index, 'upage', 'poll', 0),
    userId: people.adminId,
    universityPageId: uniId,
    voterPool: allStudents.slice(0, 200),
    votesMax: 20,
    draft: false,
    visibility: 'ALL',
  })
  const pageAlbumId = id(index, 'upage', 'alb')
  await writer.add('album', {
    id: pageAlbumId,
    userId: people.adminId,
    universityPageId: uniId,
    title: 'Кампус',
    createdAt: random.randomDate(-200, -10),
  })
  // Медиа страницы принадлежит вузу (File.universityPageId) — его видят все, кто открыл
  // страницу, и снимает только модуль контента профиля.
  fillAlbum(pageAlbumId, people.adminId, 6, { universityPageId: uniId })

  await writer.flush()

  // Файлы альбомов — ПОСЛЕ записи альбомов (File.albumId ссылается на Album).
  for (const row of pendingFiles) await writer.add('file', row)
  await writer.flush()

  // Обложка — первое фото своего альбома. Одним запросом на вуз: id файла выводится из id
  // альбома, а EXISTS страхует от альбома, которому медиа не досталось. Повторный прогон
  // выбранную пользователем обложку не трогает (cover_file_id IS NULL).
  if (albumsWithCover.length > 0) {
    await prisma.$executeRaw`
      UPDATE albums SET cover_file_id = albums.id || '-f-0'
      WHERE albums.id = ANY(${albumsWithCover}::text[])
        AND albums.cover_file_id IS NULL
        AND EXISTS (SELECT 1 FROM files f WHERE f.id = albums.id || '-f-0')`
  }
}

// Опрос с вариантами и голосами. Варианты и голоса — в той же «транзакции»: опрос без
// вариантов был бы сломанным экраном.
async function addPoll(writer, random, opts) {
  const { pollId, userId, voterPool, votesMax, draft, visibility } = opts
  const { question, options } = pollTopic(random)
  const createdAt = random.randomDate(-500, -1)
  const resultsVisibility = random.pick(['AFTER_VOTE', 'AFTER_END', 'HIDDEN'])
  // Срок: без срока, ещё идёт или уже закрыт. Закрытый — через трое суток после создания:
  // голоса ниже ставятся в первые двое суток, то есть до закрытия.
  const roll = random.rng()
  const closesAt =
    roll < 0.15 && createdAt.getTime() + 3 * 86_400_000 < Date.now()
      ? new Date(createdAt.getTime() + 3 * 86_400_000)
      : roll < 0.4
        ? random.randomDate(1, 20)
        : null
  await writer.add('poll', {
    id: pollId,
    userId,
    question,
    multiple: random.chance(0.2),
    anonymous: random.chance(0.7),
    allowRevote: random.chance(0.3),
    resultsVisibility,
    visibility,
    universityPageId: opts.universityPageId ?? null,
    status: draft ? 'DRAFT' : 'PUBLISHED',
    closesAt: draft ? null : closesAt,
    createdAt,
  })
  const optionIds = []
  for (const [oi, text] of options.entries()) {
    const optionId = child(pollId, 'o', oi)
    optionIds.push(optionId)
    await writer.add('pollOption', { id: optionId, pollId, text, order: oi })
  }
  if (draft) return
  // Голосуют однокурсники: голос уникален по (option, user), поэтому берём разных людей.
  const voters = random.sample(
    voterPool.filter((uid) => uid !== userId),
    random.randInt(0, votesMax),
  )
  for (const voterId of voters) {
    const optionId = random.pick(optionIds)
    await writer.add('pollVote', {
      id: `${optionId}-v-${voterId}`,
      pollId,
      optionId,
      userId: voterId,
      createdAt: new Date(createdAt.getTime() + random.randInt(1, 48) * 3_600_000),
    })
  }
}
