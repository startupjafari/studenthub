// Шаг «соцчасть»: посты с комментариями и реакциями, события с участниками,
// друзья и блокировки.
//
// Вложения постов — из общего медиа-пула, и здесь важное ограничение схемы:
// File.postId — скаляр, а объект уникален по (bucket, key), поэтому один файл может
// висеть ровно на одном посте. Пул делится между вузами БЕЗ ПЕРЕСЕЧЕНИЙ (иначе
// следующий вуз «отобрал» бы файл у предыдущего), и медиа получают первые несколько
// постов каждого вуза. Обложки (Album.coverFileId, ProfileArticle.coverUrl,
// User.coverUrl) так не ограничены — их можно переиспользовать сколько угодно.

import {
  COMMENTS,
  COMMENT_REPLIES,
  EVENTS,
  EVENT_LOCATIONS,
  POSTS_FACULTY,
  POSTS_GROUP,
  POSTS_UNIVERSITY,
  POST_TITLES,
  REACTIONS,
} from '../data/content.mjs'
import { child, id } from '../lib/ids.mjs'

// Сколько файлов пула отдаётся одному вузу. 8 фото × 100 вузов = 800 контентных фото
// пула ровно на всех; видео (их около сотни) достаётся не каждому вузу.
const PHOTOS_PER_UNIVERSITY = 8

// Срез пула для вуза: строго свой диапазон, без пересечений с другими вузами.
export function poolSlice(pool, index) {
  if (!pool) return { photos: [], videos: [] }
  const from = (index - 1) * PHOTOS_PER_UNIVERSITY
  const photos = pool.photos.slice(from, from + PHOTOS_PER_UNIVERSITY)
  const video = pool.videos[index - 1] ? [pool.videos[index - 1]] : []
  return { photos, videos: video }
}

export async function seedSocial(prisma, writer, ctx) {
  const { index, random, structure, people, pool } = ctx
  const { uniId } = structure
  const slice = poolSlice(pool, index)
  // Файлы, которые прикрепим к постам: фото пополам с альбомами (шаг 55) + видео.
  const attachable = [...slice.photos.slice(0, 4), ...slice.videos]
  const attached = []

  const allStudents = people.faculties.flatMap((f) => f.groups.flatMap((g) => g.studentIds))
  const allTeachers = people.faculties.flatMap((f) => f.teacherIds)

  // ── Посты: вуз → факультет → группа ─────────────────────────────────────────
  const posts = []
  const addPost = async (postId, row) => {
    posts.push(postId)
    await writer.add('post', { id: postId, ...row })
  }

  for (const [pi, content] of POSTS_UNIVERSITY.entries()) {
    const postId = id(index, 'post', 'uni', pi)
    await addPost(postId, {
      authorId: pi % 3 === 0 ? people.adminId : random.pick(people.moderatorIds),
      audience: 'UNIVERSITY',
      title: random.pick(POST_TITLES),
      content,
      universityId: uniId,
      status: 'PUBLISHED',
      publishedAt: random.randomDate(-25, -1),
      views: random.randInt(40, 900),
      // Один закреплённый пост на вуз: лента должна показывать закрепление.
      ...(pi === 0
        ? { pinnedAt: random.randomDate(-5, -1), pinnedById: people.adminId, priority: 1 }
        : {}),
    })
  }

  for (const faculty of people.faculties) {
    for (const [pi, content] of POSTS_FACULTY.slice(0, 2).entries()) {
      const postId = child(faculty.id, 'post', pi)
      await addPost(postId, {
        authorId: faculty.deanId,
        audience: 'FACULTY',
        content,
        universityId: uniId,
        facultyId: faculty.id,
        status: 'PUBLISHED',
        publishedAt: random.randomDate(-18, -1),
        views: random.randInt(20, 300),
      })
    }
    for (const group of faculty.groups) {
      for (let pi = 0; pi < 2; pi += 1) {
        const postId = child(group.id, 'post', pi)
        await addPost(postId, {
          authorId: pi === 0 ? group.starostaId : random.pick(group.studentIds),
          audience: 'GROUP',
          content: random.pick(POSTS_GROUP),
          universityId: uniId,
          facultyId: faculty.id,
          groupId: group.id,
          status: 'PUBLISHED',
          publishedAt: random.randomDate(-12, 0),
          views: random.randInt(5, 60),
        })
      }
    }
  }

  // Черновик и отложенная публикация: без них не проверить статусы в редакторе поста.
  await addPost(id(index, 'post', 'draft'), {
    authorId: people.adminId,
    audience: 'UNIVERSITY',
    title: 'Черновик объявления',
    content: 'Текст ещё готовится: уточняем дату и место проведения.',
    universityId: uniId,
    status: 'DRAFT',
  })
  await addPost(id(index, 'post', 'sched'), {
    authorId: people.adminId,
    audience: 'UNIVERSITY',
    title: 'Отложенная публикация',
    content: 'Публикация выйдет автоматически: расписание консультаций перед сессией.',
    universityId: uniId,
    status: 'SCHEDULED',
    scheduledAt: random.randomDate(1, 6),
  })

  // Посты должны быть в БД раньше комментариев, реакций и привязки файлов.
  await writer.flush()

  // ── Вложения постов из пула ─────────────────────────────────────────────────
  for (const [fi, file] of attachable.entries()) {
    const postId = posts[fi]
    if (!postId) break
    // Файл переезжает в бакет поста? Нет: объект уже загружен в publicный бакет пула,
    // и перекладывать его нет смысла — клиент получает ссылку из File-строки.
    await prisma.file.update({ where: { id: file.fileId }, data: { postId } }).catch(() => {})
    attached.push(file.fileId)
  }

  // ── Комментарии, ответы и реакции ───────────────────────────────────────────
  const commenters = [...allStudents.slice(0, 40), ...allTeachers.slice(0, 10)]
  for (const [pi, postId] of posts.entries()) {
    const commentCount = random.randInt(0, 4)
    for (let ci = 0; ci < commentCount; ci += 1) {
      const commentId = child(postId, 'cm', ci)
      await writer.add('comment', {
        id: commentId,
        postId,
        authorId: random.pick(commenters),
        content: random.pick(COMMENTS),
        createdAt: random.randomDate(-10, 0),
      })
      // Ответ в ветке — у каждого третьего комментария (проверка вложенности).
      if (ci === 0 && random.chance(0.35)) {
        await writer.add('comment', {
          id: child(commentId, 'r'),
          postId,
          parentId: commentId,
          authorId: pi % 2 === 0 ? people.adminId : random.pick(commenters),
          content: random.pick(COMMENT_REPLIES),
          createdAt: random.randomDate(-9, 0),
        })
      }
    }

    // Реакции: уникальны по (post, user, emoji), поэтому идём по разным людям.
    const reactors = random.sample(commenters, random.randInt(0, 8))
    for (const [ri, userId] of reactors.entries()) {
      await writer.add('reaction', {
        id: child(postId, 'rx', ri),
        postId,
        userId,
        emoji: random.pick(REACTIONS),
        createdAt: random.randomDate(-8, 0),
      })
    }
  }
  // Комментарии и реакции — до событий: дальше пойдут другие модели.
  await writer.flush()

  // ── События и участники ─────────────────────────────────────────────────────
  for (const [ei, [title, description]] of EVENTS.entries()) {
    const eventId = id(index, 'ev', ei)
    const facultyLevel = ei % 3 !== 0
    const faculty = people.faculties[ei % people.faculties.length]
    const isOnline = random.chance(0.25)
    const startsAt = random.randomDate(-10, 30)
    await writer.add('event', {
      id: eventId,
      organizerId: facultyLevel ? faculty.deanId : people.adminId,
      audience: facultyLevel ? 'FACULTY' : 'UNIVERSITY',
      title,
      description,
      universityId: uniId,
      facultyId: facultyLevel ? faculty.id : null,
      location: isOnline ? 'Онлайн' : random.pick(EVENT_LOCATIONS),
      isOnline,
      startsAt,
      endsAt: new Date(startsAt.getTime() + random.randInt(1, 6) * 3_600_000),
    })
    // Участники: и прошедшие события, и будущие — счётчик участия виден на карточке.
    for (const [ui, userId] of random.sample(allStudents, random.randInt(5, 40)).entries()) {
      await writer.add('eventParticipant', {
        id: child(eventId, 'p', ui),
        eventId,
        userId,
        createdAt: random.randomDate(-9, 0),
      })
    }
  }
  await writer.flush()

  // ── Друзья и блокировки ─────────────────────────────────────────────────────
  // Дружба симметрична и уникальна по (requester, addressee), поэтому пары строим
  // строго в одну сторону: внутри группы и немного между группами факультета.
  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      const members = group.studentIds
      for (const [si, requesterId] of members.entries()) {
        // 3–6 связей на человека: своя группа (кольцом, чтобы не было дубликатов) и
        // один-два человека с других групп факультета.
        const links = random.randInt(3, 6)
        for (let k = 1; k <= links; k += 1) {
          const ai = (si + k) % members.length
          const addresseeId = members[ai]
          if (!addresseeId || addresseeId === requesterId) continue
          // Кольцо замыкается на начало списка, поэтому берём только пары «вперёд»:
          // иначе к паре (A,B) добавилась бы (B,A), а дружба уникальна по паре.
          if (ai < si) continue
          const accepted = random.chance(0.75)
          await writer.add('friendship', {
            id: `${requesterId}-fr-${addresseeId}`,
            requesterId,
            addresseeId,
            status: accepted ? 'ACCEPTED' : 'PENDING',
            createdAt: random.randomDate(-200, -2),
            respondedAt: accepted ? random.randomDate(-190, -1) : null,
          })
        }
      }
      // Блокировка: одна на группу. Экран «Заблокированные» должен быть непустым
      // хотя бы у части пользователей.
      if (random.chance(0.3) && members.length > 2) {
        await writer.add('userBlock', {
          id: `${members[0]}-blk-${members[1]}`,
          blockerId: members[0],
          blockedId: members[1],
          createdAt: random.randomDate(-100, -1),
        })
      }
    }
  }

  await writer.flush()
  return { posts: posts.length, attachedFiles: attached.length }
}
