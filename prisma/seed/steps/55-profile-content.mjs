// Шаг «контент профиля»: портфолио, альбомы, статьи, опросы с голосами, закладки и
// комментарии к контенту. По решению пользователя — у КАЖДОГО студента, а не выборкой.
//
// Про медиа в альбомах. Обложка альбома (Album.coverFileId) и обложка статьи
// (ProfileArticle.coverUrl) ссылаются на файл пула и могут переиспользоваться сколько
// угодно — поэтому они есть у всех. А вот содержимое альбома — это File.albumId, то
// есть эксклюзивная привязка объекта к одному альбому: сколько объектов в пуле,
// столько альбомов может быть наполнено. Наполняются альбомы из среза пула этого вуза;
// у остальных альбом с обложкой, но без фотографий внутри. Увеличить это можно только
// увеличив число объектов в MinIO (SEED_PHOTOS больше 1000).

import {
  ALBUM_TITLES,
  COMMENTS,
  PORTFOLIO_PROJECTS,
  articleBody,
  articleTitle,
  pollTopic,
} from '../data/content.mjs'
import { child } from '../lib/ids.mjs'
import { poolSlice } from './50-social.mjs'

// Видимость контента и видимость портфолио — РАЗНЫЕ перечисления в shared-schemas:
// CONTENT_VISIBILITY = ALL|UNIVERSITY|FACULTY|GROUP, а PORTFOLIO_VISIBILITY =
// PRIVATE|UNIVERSITY|PUBLIC. Общий список подсунул бы статье значение PRIVATE,
// которого схема контента не знает.
const CONTENT_VISIBILITY = ['ALL', 'UNIVERSITY', 'UNIVERSITY', 'FACULTY', 'GROUP']
// Категории — коды из ARTICLE_CATEGORIES (packages/shared-schemas/profile.ts).
const ARTICLE_CATEGORIES = ['STUDY','SCIENCE','STUDENT_LIFE','PROJECTS','INTERNSHIPS','CAREER','EVENTS','RESOURCES'] // prettier-ignore
const PORTFOLIO_VISIBILITY = ['PRIVATE', 'UNIVERSITY', 'UNIVERSITY', 'PUBLIC']

export async function seedProfileContent(prisma, writer, ctx) {
  const { index, random, structure, people, pool, config } = ctx
  const [articlesMin, articlesMax] = config.articlesPerUser
  const [pollsMin, pollsMax] = config.pollsPerUser
  const slice = poolSlice(pool, index)
  // Фото для наполнения альбомов — вторая половина среза (первая ушла на посты).
  const albumPhotos = slice.photos.slice(4)
  const covers = pool?.photos ?? []
  let coverCursor = index * 7

  const nextCover = () => (covers.length > 0 ? covers[coverCursor++ % covers.length] : null)

  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      for (const [si, studentId] of group.studentIds.entries()) {
        const cover = nextCover()

        // ── Портфолио: образование + 2 достижения ───────────────────────────
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
        for (let k = 1; k <= 2; k += 1) {
          const [kind, title, organization] = random.pick(PORTFOLIO_PROJECTS)
          await writer.add('portfolioItem', {
            id: child(studentId, 'pf', k),
            userId: studentId,
            kind,
            title,
            organization,
            description: 'Подтверждающие документы приложены в профиле.',
            url: random.chance(0.4) ? 'https://portfolio.example.kz/item' : null,
            startDate: random.randomDate(-700, -60),
            endDate: random.chance(0.6) ? random.randomDate(-59, -10) : null,
            visibility: random.pick(PORTFOLIO_VISIBILITY),
            order: k,
          })
        }

        // ── Альбом (обложка есть у всех, фото — у кого хватило пула) ─────────
        const albumId = child(studentId, 'alb')
        await writer.add('album', {
          id: albumId,
          userId: studentId,
          title: random.pick(ALBUM_TITLES),
          coverFileId: cover?.fileId ?? null,
          createdAt: random.randomDate(-300, -5),
        })

        // ── Статьи: 20–50 на пользователя ───────────────────────────────────
        // Заголовок и тело собирает генератор: пятьдесят статей у одного автора из
        // списка в шесть штук выглядели бы как ошибка сида, а не как контент.
        const articleCount = random.randInt(articlesMin, articlesMax)
        const firstArticleId = child(studentId, 'art', 0)
        for (let ai = 0; ai < articleCount; ai += 1) {
          const body = articleBody(random)
          const articleCover = ai === 0 ? cover : nextCover()
          const publishedAt = random.randomDate(-700, -1)
          await writer.add('profileArticle', {
            id: child(studentId, 'art', ai),
            userId: studentId,
            title: articleTitle(random),
            description: 'Личный опыт и выводы — коротко о том, что сработало.',
            content: body,
            coverUrl: articleCover?.url ?? null,
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
          const { question, options } = pollTopic(random)
          const pollId = child(studentId, 'poll', qi)
          const createdAt = random.randomDate(-500, -1)
          await writer.add('poll', {
            id: pollId,
            userId: studentId,
            question,
            multiple: random.chance(0.2),
            anonymous: random.chance(0.7),
            allowRevote: random.chance(0.3),
            resultsVisibility: random.pick(['AFTER_VOTE', 'AFTER_END', 'HIDDEN']),
            visibility: random.pick(CONTENT_VISIBILITY),
            status: 'PUBLISHED',
            closesAt: random.chance(0.3) ? random.randomDate(1, 20) : null,
            createdAt,
          })
          const optionIds = []
          for (const [oi, text] of options.entries()) {
            const optionId = child(pollId, 'o', oi)
            optionIds.push(optionId)
            await writer.add('pollOption', { id: optionId, pollId, text, order: oi })
          }
          // Голосуют однокурсники: голос уникален по (option, user), поэтому берём
          // разных людей.
          const voters = random.sample(group.studentIds, random.randInt(0, config.pollVotesMax))
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

        // ── Комментарии к ПЕРВОЙ статье и закладки ──────────────────────────
        // Только к первой: комментарии на каждой из 20–50 статей — это ещё миллионы
        // строк при нулевой пользе для проверки экрана.
        for (const [ci, commenterId] of random
          .sample(group.studentIds, random.randInt(0, 3))
          .entries()) {
          await writer.add('contentComment', {
            id: child(firstArticleId, 'cc', ci),
            authorId: commenterId,
            articleId: firstArticleId,
            content: random.pick(COMMENTS),
            createdAt: random.randomDate(-90, 0),
          })
        }
        // Закладка на статью однокурсника: уникальна по (user, article).
        if (si > 0) {
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

  await writer.flush()

  // Фото в альбомы — ПОСЛЕ записи альбомов (File.albumId ссылается на Album) и один
  // раз на вуз, а не на каждую группу: привязка эксклюзивная, и при обходе по группам
  // один и тот же файл переезжал бы из альбома в альбом, оставаясь только в последнем.
  const albumOwners = people.faculties.flatMap((f) => f.groups.flatMap((g) => g.studentIds))
  for (const [fi, file] of albumPhotos.entries()) {
    const studentId = albumOwners[fi]
    if (!studentId) break
    await prisma.file
      .update({ where: { id: file.fileId }, data: { albumId: child(studentId, 'alb') } })
      .catch(() => {})
  }
}
