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
  ARTICLES,
  ARTICLE_BODY,
  COMMENTS,
  POLLS,
  PORTFOLIO_PROJECTS,
} from '../data/content.mjs'
import { child } from '../lib/ids.mjs'
import { poolSlice } from './50-social.mjs'

// Видимость контента и видимость портфолио — РАЗНЫЕ перечисления в shared-schemas:
// CONTENT_VISIBILITY = ALL|UNIVERSITY|FACULTY|GROUP, а PORTFOLIO_VISIBILITY =
// PRIVATE|UNIVERSITY|PUBLIC. Общий список подсунул бы статье значение PRIVATE,
// которого схема контента не знает.
const CONTENT_VISIBILITY = ['ALL', 'UNIVERSITY', 'UNIVERSITY', 'FACULTY', 'GROUP']
const PORTFOLIO_VISIBILITY = ['PRIVATE', 'UNIVERSITY', 'UNIVERSITY', 'PUBLIC']

export async function seedProfileContent(prisma, writer, ctx) {
  const { index, random, structure, people, pool } = ctx
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

        // ── Статья ──────────────────────────────────────────────────────────
        const [title, category, description] = random.pick(ARTICLES)
        const articleId = child(studentId, 'art')
        const body = random.pick(ARTICLE_BODY)
        await writer.add('profileArticle', {
          id: articleId,
          userId: studentId,
          title,
          description,
          content: body,
          coverUrl: cover?.url ?? null,
          category,
          tags: random.sample(['учёба', 'опыт', 'советы', 'проекты', 'карьера'], 2),
          visibility: random.pick(CONTENT_VISIBILITY),
          allowComments: random.chance(0.9),
          status: 'PUBLISHED',
          // Оценка времени чтения: 900 знаков ≈ минута.
          readingMinutes: Math.max(1, Math.round(body.length / 900)),
          views: random.randInt(0, 400),
          publishedAt: random.randomDate(-200, -1),
        })

        // ── Опрос с вариантами и голосами ───────────────────────────────────
        const [question, options] = POLLS[si % POLLS.length]
        const pollId = child(studentId, 'poll')
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
          closesAt: random.chance(0.4) ? random.randomDate(1, 20) : null,
          createdAt: random.randomDate(-120, -1),
        })
        const optionIds = []
        for (const [oi, text] of options.entries()) {
          const optionId = child(pollId, 'o', oi)
          optionIds.push(optionId)
          await writer.add('pollOption', { id: optionId, pollId, text, order: oi })
        }
        // Голосуют однокурсники: голос уникален по (option, user).
        for (const voterId of random.sample(group.studentIds, random.randInt(3, 10))) {
          const optionId = random.pick(optionIds)
          await writer.add('pollVote', {
            id: `${optionId}-v-${voterId}`,
            pollId,
            optionId,
            userId: voterId,
            createdAt: random.randomDate(-100, 0),
          })
        }

        // ── Комментарии к статье и закладки ─────────────────────────────────
        for (const [ci, commenterId] of random
          .sample(group.studentIds, random.randInt(0, 3))
          .entries()) {
          // prettier-ignore
          await writer.add('contentComment', {
            id: child(articleId, 'cc', ci),
            authorId: commenterId,
            articleId,
            content: random.pick(COMMENTS),
            createdAt: random.randomDate(-90, 0),
          })
        }
        // Закладка на статью однокурсника: уникальна по (user, article).
        if (si > 0) {
          await writer.add('bookmark', {
            id: `${studentId}-bm-${si}`,
            userId: studentId,
            articleId: child(group.studentIds[si - 1], 'art'),
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
