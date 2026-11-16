// Шаг «соцчасть»: посты с медиа, комментариями и реакциями, события с участниками,
// друзья и блокировки.
//
// Аудитории — строго как у сервиса (posts.service / events.service, ALLOWED_AUDIENCES):
// студент и староста пишут группе или лично, преподаватель — своей группе, по предмету или
// лично, декан — факультету и группе, админ вуза — вузу, факультету, группе и
// преподавателям, модератор вуза собственных постов не пишет вовсе и публикует только от
// имени университета (universityPageId). Пост с аудиторией, которую роль выбрать не может,
// в живой базе не возникает, а значит и экраны с ним никто не проверял.
//
// Медиа постов — ССЫЛКИ на объекты общего пула (см. 51-social-media.mjs): пара
// (bucket, key) у File не уникальна, и у каждого поста своя строка File без копии объекта.
// Прежнее «один файл — один пост, пул делится между вузами без пересечений» снято
// миграцией 20260929121630_files_shared_object_pool.

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
  postPriority,
  postText,
} from '../data/content.mjs'
import { activityOf } from '../lib/activity.mjs'
import { child, id } from '../lib/ids.mjs'
import { postMediaKit } from './51-social-media.mjs'

// Аудитории личных постов по роли автора — по кругу со сдвигом на автора, а не случайно:
// так каждое значение, доступное роли, встречается в каждом вузе (у сотни авторов круг
// обязательно проходит целиком), а доли остаются правдоподобными — группе пишут чаще, чем
// лично. Модератор вуза — только «от имени университета» (UNIVERSITY + universityPageId).
const AUDIENCE_CYCLE = {
  STUDENT: ['GROUP', 'GROUP', 'GROUP', 'PERSONAL', 'GROUP', 'GROUP', 'GROUP'],
  TEACHER: ['SUBJECT', 'GROUP', 'SUBJECT', 'PERSONAL', 'GROUP', 'SUBJECT'],
  DEAN: ['FACULTY', 'GROUP', 'FACULTY', 'PERSONAL', 'FACULTY'],
  UNIVERSITY_ADMIN: ['UNIVERSITY', 'TEACHERS', 'FACULTY', 'GROUP', 'UNIVERSITY', 'PERSONAL'],
  UNIVERSITY_MODERATOR: ['UNIVERSITY'],
}
// Роли не ниже преподавателя получают +2 к приоритету (posts.service, priorityFor).
const STAFF = new Set(['TEACHER', 'DEAN', 'UNIVERSITY_ADMIN', 'UNIVERSITY_MODERATOR'])

// Срез пула для вуза. Шаги 50 и 55 им больше не пользуются (их медиа — ссылки), но шаг
// чатов по-прежнему берёт отсюда хвост среза для вложений сообщений.
const PHOTOS_PER_UNIVERSITY = 8
export function poolSlice(pool, index) {
  if (!pool) return { photos: [], videos: [] }
  const from = (index - 1) * PHOTOS_PER_UNIVERSITY
  const photos = pool.photos.slice(from, from + PHOTOS_PER_UNIVERSITY)
  const video = pool.videos[index - 1] ? [pool.videos[index - 1]] : []
  return { photos, videos: video }
}

// Онлайн-события: по одному на каждого провайдера встречи (MEETING_PROVIDERS в
// packages/shared-schemas/src/events.ts). Провайдер сервер ставит по хосту ссылки
// (meetingProviderOf) — здесь хосты подобраны так, чтобы он совпал с записанным.
// Ключ — индекс в EVENTS: онлайн только то, что онлайн правдоподобно.
const ONLINE_EVENTS = {
  1: ['ZOOM', (n) => `https://zoom.us/j/${8_100_000_000 + n}`, '482913'],
  4: ['GOOGLE_MEET', (n) => `https://meet.google.com/stu-${String(n).padStart(4, '0')}-hub`, null],
  5: ['TEAMS', (n) => `https://teams.microsoft.com/l/meetup-join/seed-${n}`, null],
  6: ['OTHER', (n) => `https://meet.jit.si/studenthub-hackathon-${n}`, null],
}
const OFFLINE_LOCATIONS = EVENT_LOCATIONS.filter((l) => l !== 'Онлайн')

export async function seedSocial(prisma, writer, ctx) {
  const { index, random, structure, people, pool } = ctx
  const { uniId } = structure
  const media = await postMediaKit(prisma, pool)
  let mediaPosts = 0
  let mediaFiles = 0

  const allStudents = people.faculties.flatMap((f) => f.groups.flatMap((g) => g.studentIds))
  const allTeachers = people.faculties.flatMap((f) => f.teacherIds)
  const facultyStudents = new Map(
    people.faculties.map((f) => [f.id, f.groups.flatMap((g) => g.studentIds)]),
  )
  // Срез вуза для вовлечения в посты на весь вуз: по трое из каждой группы и часть
  // преподавателей — разные факультеты, а не первые сорок человек одного.
  const uniSample = [
    ...people.faculties.flatMap((f) => f.groups.flatMap((g) => g.studentIds.slice(0, 3))),
    ...allTeachers.slice(0, 20),
  ]

  // Кто видит пост этой аудитории (visibilityWhere): из них берутся комментаторы и те, кто
  // ставит реакции. Комментарий к посту чужой группы означал бы, что его автор видит то,
  // что ему не адресовано.
  const groupMembers = new Map(
    people.faculties.flatMap((f) => f.groups.map((g) => [g.id, g.studentIds])),
  )
  const facultyTeachers = new Map(people.faculties.map((f) => [f.id, f.teacherIds]))
  const audiencePool = (row) => {
    switch (row.audience) {
      case 'GROUP':
        return groupMembers.get(row.groupId) ?? []
      case 'FACULTY':
        return [
          ...(facultyStudents.get(row.facultyId) ?? []).slice(0, 60),
          ...(facultyTeachers.get(row.facultyId) ?? []),
        ]
      case 'TEACHERS':
        return allTeachers
      case 'PERSONAL':
        return [row.targetUserId]
      default:
        return uniSample
    }
  }

  // Медиа поста — новые строки File на объекты пула. Пишутся после постов (FK postId),
  // поэтому копятся в списке.
  const pendingMedia = []
  const withMedia = (postId, ownerId, createdAt, sources) => {
    if (sources.length === 0) return
    mediaPosts += 1
    for (const [k, make] of sources.entries()) {
      pendingMedia.push(make(mediaFiles + k, { id: child(postId, 'm', k), ownerId, postId, createdAt })) // prettier-ignore
    }
    mediaFiles += sources.length
  }

  // ── Посты: вуз → факультет → группа ─────────────────────────────────────────
  // В `posts` — посты, которым дальше раздаются комментарии и реакции, вместе со своей
  // строкой: по ней видно аудиторию.
  const posts = []
  const addPost = async (row, sources = []) => {
    posts.push(row)
    await writer.add('post', row)
    withMedia(row.id, row.authorId, row.publishedAt ?? row.createdAt ?? new Date(), sources)
  }

  for (const [pi, content] of POSTS_UNIVERSITY.entries()) {
    // Каждый третий — от админа вуза в своей ленте; остальные публикует модератор от имени
    // университета: собственных постов у модератора нет (ALLOWED_AUDIENCES), только страница.
    const asPage = pi % 3 !== 0
    const publishedAt = random.randomDate(-25, -1)
    await addPost(
      {
        id: id(index, 'post', 'uni', pi),
        authorId: asPage ? random.pick(people.moderatorIds) : people.adminId,
        audience: 'UNIVERSITY',
        title: random.pick(POST_TITLES),
        content,
        universityId: uniId,
        universityPageId: asPage ? uniId : null,
        status: 'PUBLISHED',
        publishedAt,
        createdAt: publishedAt,
        views: random.randInt(40, 900),
        priority: postPriority('UNIVERSITY', true),
        // Один закреплённый пост на вуз — пост страницы вуза, закреплённый админом.
        // Закрепляет только роль строго выше автора (setPinned), свой пост админ не закрепит.
        ...(pi === 1 ? { pinnedAt: random.randomDate(-5, -1), pinnedById: people.adminId } : {}),
      },
      // Закреплённый пост — с альбомом на десять вложений: потолок CreatePostSchema.
      pi === 1 ? media.albumMax() : media.layout(pi),
    )
  }

  // Объявление админа «только преподавателям»: аудитория TEACHERS, студентам не видна.
  {
    const publishedAt = random.randomDate(-20, -1)
    await addPost(
      {
        id: id(index, 'post', 'teachers'),
        authorId: people.adminId,
        audience: 'TEACHERS',
        title: 'Для преподавателей',
        content: 'Методический совет в среду в 14:00. Повестка — в приложенных материалах.',
        universityId: uniId,
        status: 'PUBLISHED',
        publishedAt,
        createdAt: publishedAt,
        views: random.randInt(10, 120),
        priority: postPriority('TEACHERS', true),
      },
      media.layout(0),
    )
  }

  for (const [fi, faculty] of people.faculties.entries()) {
    for (const [pi, content] of POSTS_FACULTY.slice(0, 2).entries()) {
      const publishedAt = random.randomDate(-18, -1)
      await addPost(
        {
          id: child(faculty.id, 'post', pi),
          authorId: faculty.deanId,
          audience: 'FACULTY',
          content,
          universityId: uniId,
          facultyId: faculty.id,
          status: 'PUBLISHED',
          publishedAt,
          createdAt: publishedAt,
          views: random.randInt(20, 300),
          priority: postPriority('FACULTY', true),
        },
        media.layout(fi + pi),
      )
    }
    for (const [gi, group] of faculty.groups.entries()) {
      for (let pi = 0; pi < 2; pi += 1) {
        const publishedAt = random.randomDate(-12, 0)
        await addPost(
          {
            id: child(group.id, 'post', pi),
            authorId: pi === 0 ? group.starostaId : random.pick(group.studentIds),
            audience: 'GROUP',
            content: random.pick(POSTS_GROUP),
            universityId: uniId,
            facultyId: faculty.id,
            groupId: group.id,
            status: 'PUBLISHED',
            publishedAt,
            createdAt: publishedAt,
            views: random.randInt(5, 60),
            priority: postPriority('GROUP', false),
            // Закреп в ленте группы: декан закрепляет объявление старосты первой группы.
            ...(gi === 0 && pi === 0
              ? { pinnedAt: random.randomDate(-4, 0), pinnedById: faculty.deanId }
              : {}),
          },
          pi === 0 ? media.layout(gi) : [],
        )
      }
    }
  }

  // Черновик и отложенная публикация: без них не проверить статусы в редакторе поста.
  await writer.add('post', {
    id: id(index, 'post', 'draft'),
    authorId: people.adminId,
    audience: 'UNIVERSITY',
    title: 'Черновик объявления',
    content: 'Текст ещё готовится: уточняем дату и место проведения.',
    universityId: uniId,
    status: 'DRAFT',
    priority: postPriority('UNIVERSITY', true),
  })
  await writer.add('post', {
    id: id(index, 'post', 'sched'),
    authorId: people.adminId,
    audience: 'UNIVERSITY',
    title: 'Отложенная публикация',
    content: 'Публикация выйдет автоматически: расписание консультаций перед сессией.',
    universityId: uniId,
    status: 'SCHEDULED',
    scheduledAt: random.randomDate(1, 6),
    priority: postPriority('UNIVERSITY', true),
  })
  // Пост, снятый модерацией (soft delete): в ленте его нет, а в журнале модерации и в
  // жалобах ссылка на него должна вести на «удалено», а не в пустоту.
  {
    const faculty = people.faculties[0]
    const group = faculty.groups[0]
    const publishedAt = random.randomDate(-15, -3)
    await writer.add('post', {
      id: id(index, 'post', 'removed'),
      authorId: group.studentIds[group.studentIds.length - 1],
      audience: 'GROUP',
      content: 'Продам готовые курсовые, пишите в личку.',
      universityId: uniId,
      facultyId: faculty.id,
      groupId: group.id,
      status: 'PUBLISHED',
      publishedAt,
      createdAt: publishedAt,
      priority: postPriority('GROUP', false),
      deletedAt: random.randomDate(-2, 0),
    })
  }

  // ── Личные посты: по роли и активности автора ───────────────────────────────
  // Сколько постов у человека — норма его роли × уровень активности (lib/activity.mjs):
  // деканат и админ вуза пишут больше всех, староста — больше однокурсников, треть людей
  // почти ничего не публикует. Тексты собирает генератор (см. postText), иначе у одного
  // автора двадцать постов оказались бы шестью повторяющимися фразами.
  // Староста — первый в списке группы (studentIds[0], шаг 30): норма у него своя.
  const normRole = (author) =>
    author.role === 'STUDENT' && author.si === 0 ? 'STAROSTA' : author.role
  const authors = [
    ...people.faculties.flatMap((f) => [
      { id: f.deanId, role: 'DEAN', faculty: f },
      ...f.teacherIds.map((tid, ti) => ({ id: tid, role: 'TEACHER', faculty: f, ti })),
      ...f.groups.flatMap((g) =>
        g.studentIds.map((sid, si) => ({ id: sid, role: 'STUDENT', faculty: f, group: g, si })),
      ),
    ]),
    { id: people.adminId, role: 'UNIVERSITY_ADMIN' },
    ...people.moderatorIds.map((mid) => ({ id: mid, role: 'UNIVERSITY_MODERATOR' })),
  ]

  // Скоуп поста по аудитории — ровно те поля, что ставит resolveTarget сервиса.
  const targetOf = (author, audience, ai, pi) => {
    const faculty = author.faculty ?? people.faculties[(ai + pi) % people.faculties.length]
    switch (audience) {
      case 'UNIVERSITY':
        return author.role === 'UNIVERSITY_MODERATOR'
          ? { universityId: uniId, universityPageId: uniId }
          : { universityId: uniId }
      case 'TEACHERS':
        return { universityId: uniId }
      case 'SUBJECT': {
        const subject = faculty.subjects[(author.ti ?? 0) % faculty.subjects.length]
        return { universityId: uniId, subject: subject.name }
      }
      case 'FACULTY':
        return { universityId: uniId, facultyId: faculty.id }
      case 'GROUP': {
        // Студент — только своя группа; преподаватель — группа, где ведёт занятия (шаг 40:
        // предмет si ведёт teacherIds[si % n], то есть преподаватель ti — во всех группах
        // факультета, если у факультета есть предмет ti); остальные — любая группа скоупа.
        if (author.group) return groupScope(author.group, faculty)
        if (author.role === 'TEACHER' && author.ti >= faculty.subjects.length) return null
        const group = faculty.groups[(ai + pi) % faculty.groups.length]
        return group ? groupScope(group, faculty) : null
      }
      case 'PERSONAL': {
        // Адресат — из того же вуза (assertTargetUser) и не из пары блокировки шага ниже:
        // она всегда между первым и последним студентом группы.
        const targetUserId = personalTarget(author, faculty, pi)
        return targetUserId ? { targetUserId } : null
      }
      default:
        return null
    }
  }
  const groupScope = (group, faculty) => ({
    universityId: uniId,
    facultyId: faculty.id,
    groupId: group.id,
  })
  const personalTarget = (author, faculty, pi) => {
    if (author.role === 'STUDENT') {
      const members = author.group.studentIds
      if (members.length < 2) return null
      return members[author.si === 0 ? 1 : author.si - 1]
    }
    if (author.role === 'TEACHER') {
      const group = faculty.groups[pi % faculty.groups.length]
      return group?.studentIds[1] ?? group?.studentIds[0] ?? null
    }
    if (author.role === 'DEAN') return faculty.teacherIds[pi % faculty.teacherIds.length] ?? null
    // Админ вуза пишет лично деканам.
    return people.faculties[pi % people.faculties.length].deanId
  }

  // Посты с медиа: первые N у каждого автора — доля его постов по норме роли
  // (postMedia), раскладки по кругу. Без пула (MinIO недоступен) медиа нет вовсе: строка
  // на несуществующий объект дала бы ссылку с 404.

  // Сколько постов реально досталось автору: ниже по нему раздаются реакции, и
  // «первые два поста» при диапазоне 1-2 или 0-0 существуют не у всех.
  const created = new Map()
  for (const [ai, author] of authors.entries()) {
    const activity = activityOf(author.id, normRole(author))
    const count = activity.posts
    const mediaPerUser = media.empty ? 0 : activity.postMedia
    const cycle = AUDIENCE_CYCLE[author.role]
    const rows = []
    for (let pi = 0; pi < count; pi += 1) {
      let audience = cycle[(ai + pi) % cycle.length]
      let target = targetOf(author, audience, ai, pi)
      // Аудитория недоступна этому автору (преподаватель без своих групп, группа из одного
      // человека) — берём первую из круга роли: она у каждой роли выполнима всегда.
      if (!target) {
        audience = author.role === 'TEACHER' ? 'SUBJECT' : cycle[0]
        target = targetOf(author, audience, ai, pi)
      }
      // Даты — за два последних года: лента и профиль должны прокручиваться в историю.
      const publishedAt = random.randomDate(-730, 0)
      const row = {
        id: child(author.id, 'p', pi),
        authorId: author.id,
        audience,
        content: postText(random),
        ...target,
        status: 'PUBLISHED',
        publishedAt,
        createdAt: publishedAt,
        views: random.randInt(0, 240),
        priority: postPriority(audience, STAFF.has(author.role)),
      }
      await writer.add('post', row)
      rows.push(row)
      if (pi < mediaPerUser) withMedia(row.id, author.id, publishedAt, media.layout(ai + pi))
    }
    created.set(author.id, rows)
  }

  // Посты должны быть в БД раньше комментариев, реакций и привязки файлов.
  await writer.flush()

  // ── Медиа постов ────────────────────────────────────────────────────────────
  for (const row of pendingMedia) await writer.add('file', row)
  await writer.flush()

  // ── Комментарии, ответы и реакции ───────────────────────────────────────────
  for (const [pi, post] of posts.entries()) {
    const viewers = audiencePool(post).filter((uid) => uid !== post.authorId)
    if (viewers.length === 0) continue
    const commentCount = random.randInt(0, 4)
    for (let ci = 0; ci < commentCount; ci += 1) {
      const commentId = child(post.id, 'cm', ci)
      const createdAt = random.randomDate(-10, 0)
      await writer.add('comment', {
        id: commentId,
        postId: post.id,
        authorId: random.pick(viewers),
        content: random.pick(COMMENTS),
        // Изредка комментарий снят (soft delete): ветка показывает «Комментарий удалён».
        deletedAt: ci === 1 && pi % 7 === 3 ? random.randomDate(-1, 0) : null,
        createdAt,
      })
      // Ответ в ветке — у каждого третьего комментария (проверка вложенности). Админ вуза
      // отвечает и в обсуждении группы: модерация открывает ему комментарии своего вуза.
      if (ci === 0 && random.chance(0.35)) {
        await writer.add('comment', {
          id: child(commentId, 'r'),
          postId: post.id,
          parentId: commentId,
          authorId: pi % 2 === 0 ? people.adminId : random.pick(viewers),
          content: random.pick(COMMENT_REPLIES),
          createdAt: random.randomDate(-9, 0),
        })
      }
    }

    // Реакции: уникальны по (post, user, emoji), поэтому идём по разным людям.
    for (const [ri, userId] of random.sample(viewers, random.randInt(0, 8)).entries()) {
      await writer.add('reaction', {
        id: child(post.id, 'rx', ri),
        postId: post.id,
        userId,
        emoji: random.pick(REACTIONS),
        createdAt: random.randomDate(-8, 0),
      })
    }
  }
  // Комментарии и реакции — до событий: дальше пойдут другие модели.
  await writer.flush()

  // Реакции на первые два поста каждого автора: пост без реакций выглядит мёртвым, а
  // раздавать их всем 75 тысячам — это ещё полтора миллиона строк на вуз. Больше, чем
  // постов у автора, брать нельзя: реакция на несуществующий пост — это нарушение
  // внешнего ключа, и при диапазоне «0-0» или «1-2» оно случается на каждом прогоне.
  for (const author of authors) {
    for (const post of (created.get(author.id) ?? []).slice(0, 2)) {
      const viewers = audiencePool(post).filter((uid) => uid !== post.authorId)
      for (const [ri, userId] of random.sample(viewers, random.randInt(0, 3)).entries()) {
        await writer.add('reaction', {
          id: child(post.id, 'rx', ri),
          postId: post.id,
          userId,
          emoji: random.pick(REACTIONS),
          createdAt: random.randomDate(-200, 0),
        })
      }
    }
  }
  await writer.flush()

  // ── События и участники ─────────────────────────────────────────────────────
  // Аудитории — как в events.service: админ — вуз, факультет, группа, преподаватели; декан —
  // факультет; преподаватель — по предмету (весь вуз); староста — своя группа. Участники
  // набираются из тех, кому событие видно: регистрация на невидимое событие невозможна.
  const events = []
  for (const [ei, [title, description]] of EVENTS.entries()) {
    const facultyLevel = ei % 3 !== 0
    const faculty = people.faculties[ei % people.faculties.length]
    events.push({
      id: id(index, 'ev', ei),
      organizerId: facultyLevel ? faculty.deanId : people.adminId,
      audience: facultyLevel ? 'FACULTY' : 'UNIVERSITY',
      title,
      description,
      facultyId: facultyLevel ? faculty.id : null,
      online: ONLINE_EVENTS[ei] ?? null,
      participants: facultyLevel ? facultyStudents.get(faculty.id) : allStudents,
    })
  }
  events.push({
    id: id(index, 'ev', 'teachers'),
    organizerId: people.adminId,
    audience: 'TEACHERS',
    title: 'Методический семинар',
    description: 'Обмен опытом: оценивание проектных работ и антиплагиат.',
    facultyId: null,
    online: null,
    participants: allTeachers,
  })
  for (const faculty of people.faculties) {
    const group = faculty.groups[0]
    if (faculty.teacherIds[0]) {
      events.push({
        id: child(faculty.id, 'ev', 'subj'),
        organizerId: faculty.teacherIds[0],
        audience: 'SUBJECT',
        title: `Открытая лекция: ${faculty.subjects[0].name}`,
        description: 'Разбор сложных тем курса для всех желающих, вопросы — в обсуждении.',
        facultyId: null,
        online: null,
        participants: facultyStudents.get(faculty.id),
      })
    }
    if (group) {
      events.push({
        id: child(group.id, 'ev'),
        organizerId: group.starostaId,
        audience: 'GROUP',
        title: 'Встреча группы',
        description: 'Обсуждаем подготовку к сессии и распределяем темы докладов.',
        facultyId: faculty.id,
        groupId: group.id,
        online: null,
        // Без времени окончания: endsAt необязателен, карточка показывает только начало.
        openEnded: true,
        participants: group.studentIds,
      })
    }
  }

  for (const [n, event] of events.entries()) {
    const startsAt = random.randomDate(-10, 30)
    const [provider, url, passcode] = event.online ?? []
    await writer.add('event', {
      id: event.id,
      organizerId: event.organizerId,
      audience: event.audience,
      title: event.title,
      description: event.description,
      universityId: uniId,
      facultyId: event.facultyId,
      groupId: event.groupId ?? null,
      // У онлайн-события место пустое: ссылка живёт в meetingUrl (07-events.prisma).
      location: event.online ? null : random.pick(OFFLINE_LOCATIONS),
      isOnline: Boolean(event.online),
      meetingProvider: provider ?? null,
      meetingUrl: url ? url(index * 100 + n) : null,
      meetingPasscode: passcode ?? null,
      startsAt,
      endsAt: event.openEnded
        ? null
        : new Date(startsAt.getTime() + random.randInt(1, 6) * 3_600_000),
    })
    // Участники: и прошедшие события, и будущие — счётчик участия виден на карточке.
    const pool = event.participants.filter((uid) => uid !== event.organizerId)
    for (const [ui, userId] of random
      .sample(pool, random.randInt(Math.min(3, pool.length), 40))
      .entries()) {
      // prettier-ignore
      await writer.add('eventParticipant', {
        id: child(event.id, 'p', ui),
        eventId: event.id,
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
      //
      // Пара — первый и последний в списке: дружбы выше идут только «вперёд» не дальше
      // чем на 6 человек, а личные диалоги (шаг 60) — между соседями 0–3. Блокировать
      // соседа значило бы держать человека одновременно в друзьях, в личном чате и в
      // блоке — так не бывает: блокировка рвёт дружбу.
      const blockedId = members[members.length - 1]
      if (random.chance(0.3) && members.length > 7) {
        await writer.add('userBlock', {
          id: `${members[0]}-blk-${blockedId}`,
          blockerId: members[0],
          blockedId,
          createdAt: random.randomDate(-100, -1),
        })
      }
    }
  }

  await writer.flush()
  return { posts: posts.length, mediaPosts, mediaFiles, events: events.length }
}
