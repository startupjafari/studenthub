// Шаг «люди»: пользователи всех ролей вуза с ПОЛНОСТЬЮ заполненным профилем.
//
// Требование задачи — заполнены все поля профиля у всех пользователей. Это не про
// «реалистичность»: пустое поле означает, что соответствующий блок профиля, фильтр или
// колонка списка на экране не отрисовывается, и проверить их на демо-данных нельзя.
//
// Пароль у всех один и хэшируется ОДИН раз на весь прогон (передаётся сюда готовым):
// 125 000 вызовов bcrypt с cost=12 — это часы CPU, сид бы просто не закончился.
//
// Роли на вуз: UNIVERSITY_ADMIN (1), UNIVERSITY_MODERATOR (2), DEAN (по факультету),
// TEACHER (по нагрузке), STAROSTA (по одному на группу), STUDENT (остальные).
// PLATFORM_ADMIN/PLATFORM_MODERATOR — платформенные, их создаёт основной сид.

import { createHash, randomUUID } from 'node:crypto'

import { ACADEMIC_TITLES, POSITIONS_TEACHER, person, translit } from '../data/people.mjs'
import { staffProfile, studentProfile } from '../data/profiles.mjs'
import { academicCalendar, enrollmentYears } from '../lib/calendar.mjs'
import { child, emailFor, id, uniPrefix, usernameFor } from '../lib/ids.mjs'

// Учебные статусы — в написании справочника (AcademicStatus в
// packages/shared-types/src/academic-status.ts): так их сохраняет PATCH /users/:id/academic.
const ACADEMIC_STATUS = {
  ACTIVE: 'Обучающийся',
  ACADEMIC_LEAVE: 'Академический отпуск',
  GRADUATED: 'Выпускник',
  EXPELLED: 'Отчислен',
  TRANSFERRED: 'Переведён',
}
// Ушедшие из вуза: им ставится leftUniversityAt (nextLeftUniversityAt в users.service.ts).
const LEFT_STATUSES = new Set(['GRADUATED', 'EXPELLED', 'TRANSFERRED'])
// Не-активные статусы раздаются каждой второй группе по кругу — по последнему студенту
// группы (староста — первый, он остаётся учащимся). Около 2% студентов: экраны деканата,
// библиотеки и поста охраны видят все статусы, а счётчики и списки не «пустеют».
const INACTIVE_CYCLE = ['ACADEMIC_LEAVE', 'EXPELLED', 'TRANSFERRED']
const DAY_MS = 86_400_000

/**
 * Не-активный статус студента или null. GRADUATED — только выпускному курсу (самый ранний
 * год набора, первая его группа факультета): досрочный выпуск в конце прошлого семестра.
 * Остальные — по кругу каждой второй группы. Детерминированно, без случайных чисел: смена
 * статуса не должна сдвигать поток случайностей, из которого строятся профили.
 */
function inactiveStatusFor({ group, groupIndex, firstOldestOfFaculty }) {
  if (group.year === enrollmentYears()[0] && firstOldestOfFaculty) return 'GRADUATED'
  if (groupIndex % 2 !== 0) return null
  return INACTIVE_CYCLE[(groupIndex / 2) % INACTIVE_CYCLE.length]
}

// 'u042-g-eco-3-st07' → 'g.eco.3.st07'
function localFromId(entityId) {
  return entityId.slice(uniPrefix(0).length + 1).replace(/-/g, '.')
}

export async function seedPeople(prisma, writer, ctx) {
  const { index, random, structure, passwordHash, pool } = ctx
  const { uniId, profile, faculties } = structure
  const cityName = profile.cityName
  let counter = 0

  // Аватар и обложку ставим ПРИ СОЗДАНИИ пользователя, а не апдейтом после.
  // Шаг медиа идёт раньше генератора вузов (пул нужен всем шагам), и его раздача
  // аватаров видит только тех, кто уже есть в БД, — новые 125 000 остались бы без
  // аватара. Здесь это ноль дополнительных запросов: URL публичного бакета
  // переиспользуется сколько угодно раз.
  const faces = pool?.faces ?? []
  const covers = pool?.photos ?? []
  const mediaFor = (n) => {
    if (faces.length === 0) return {}
    const face = faces[(index * 37 + n) % faces.length]
    const cover = covers.length > 0 ? covers[(index * 53 + n) % covers.length] : null
    return {
      avatarUrl: face.url,
      // Отдельного объекта-превью у сида нет: джоба generate-thumbnail делает его при
      // реальной загрузке, а клиенту разница не видна.
      avatarThumbUrl: face.url,
      ...(cover ? { coverUrl: cover.url } : {}),
    }
  }

  // Настройки уведомлений — по строке на каждого пользователя (иначе экран настроек
  // показывает дефолты, а не сохранённое состояние).
  const addUser = async (row) => {
    await writer.add('user', { ...mediaFor(counter), ...row })
    await writer.add('notificationSettings', {
      id: child(row.id, 'ns'),
      userId: row.id,
      emailEnabled: random.chance(0.8),
      pushEnabled: random.chance(0.4),
      scheduleChangeEnabled: random.chance(0.95),
      appUpdateEnabled: random.chance(0.9),
      messageEnabled: random.chance(0.97),
      postEnabled: random.chance(0.85),
      eventEnabled: random.chance(0.9),
      systemEnabled: true,
    })
  }

  const staffCtx = { profile, cityName }

  // ── Администрация вуза ──────────────────────────────────────────────────────
  const adminId = id(index, 'admin')
  const adminPerson = person(counter++, random)
  await addUser({
    id: adminId,
    email: emailFor(index, 'admin'),
    username: usernameFor(index, 'admin'),
    passwordHash,
    ...adminPerson,
    role: 'UNIVERSITY_ADMIN',
    universityId: uniId,
    ...staffProfile(adminPerson, random, { ...staffCtx, template: null }),
    position: 'Начальник управления',
    jobTitle: 'Администратор университета',
    responsibilities: 'Структура вуза, пользователи, инвайты, справочники.',
    academicDegree: random.pick(['Магистр', 'Кандидат наук', null]),
  })

  const moderatorIds = []
  for (let m = 0; m < 2; m += 1) {
    const modId = id(index, 'mod', m)
    const modPerson = person(counter++, random)
    moderatorIds.push(modId)
    await addUser({
      id: modId,
      email: emailFor(index, `moderator.${m}`),
      username: usernameFor(index, `moderator.${m}`),
      passwordHash,
      ...modPerson,
      role: 'UNIVERSITY_MODERATOR',
      universityId: uniId,
      ...staffProfile(modPerson, random, { ...staffCtx, template: null }),
      position: 'Модератор контента',
      jobTitle: 'Модератор университета',
      responsibilities: 'Проверка постов, событий и жалоб внутри вуза.',
      moderationAreas: random.pick([
        'Посты и комментарии',
        'Жалобы и обращения',
        'События и объявления',
      ]),
    })
  }

  // ── Охрана и библиотекарь ───────────────────────────────────────────────────
  // Роли с запретом по умолчанию (RESTRICTED_ROLES): без них журналы охраны, камеры и
  // библиотека вуза пустые, а войти и проверить эти экраны не под кем. Профиль закрыт —
  // как у роли на проде (defaultVisibilityFor).
  const staffRoles = [
    {
      role: 'SECURITY_GUARD',
      count: 2,
      local: 'security',
      kind: 'guard',
      position: 'Сотрудник охраны',
      jobTitle: 'Охрана',
      responsibilities: 'Пропускной режим главного корпуса, проверка студенческих билетов.',
    },
    {
      role: 'LIBRARIAN',
      count: 1,
      local: 'librarian',
      kind: 'librarian',
      position: 'Библиотекарь',
      jobTitle: 'Библиотека',
      responsibilities: 'Выдача и приём книг, учёт фонда, работа с должниками.',
    },
  ]
  const staffIds = { SECURITY_GUARD: [], LIBRARIAN: [] }
  for (const staff of staffRoles) {
    for (let n = 0; n < staff.count; n += 1) {
      const staffId = id(index, staff.kind, n)
      const staffPerson = person(counter++, random)
      staffIds[staff.role].push(staffId)
      await addUser({
        id: staffId,
        email: emailFor(index, `${staff.local}.${n}`),
        username: usernameFor(index, `${staff.local}.${n}`),
        passwordHash,
        ...staffPerson,
        role: staff.role,
        universityId: uniId,
        ...staffProfile(staffPerson, random, { ...staffCtx, template: null }),
        position: staff.position,
        jobTitle: staff.jobTitle,
        responsibilities: staff.responsibilities,
        profileVisibility: 'PRIVATE',
      })
    }
  }

  // ── Деканы, преподаватели, студенты, старосты ────────────────────────────────
  const people = {
    adminId,
    moderatorIds,
    securityGuardIds: staffIds.SECURITY_GUARD,
    librarianIds: staffIds.LIBRARIAN,
    faculties: [],
    // studentId → { code, since, leftAt }: студенты не в статусе «Обучающийся». Шаг академики
    // по нему не ставит посещаемость и новые оценки после `since`, пост охраны — пропуск.
    studentStatus: new Map(),
  }
  const calendar = academicCalendar()
  // Порядковый номер группы в вузе — для круга статусов (см. inactiveStatusFor).
  let groupIndex = 0

  for (const faculty of faculties) {
    const template = faculty.template
    const facCtx = { ...staffCtx, template }

    const deanId = child(faculty.id, 'dean')
    const deanPerson = person(counter++, random)
    await addUser({
      id: deanId,
      email: emailFor(index, `dean.${template.code}`),
      username: usernameFor(index, `dean.${template.code}`),
      passwordHash,
      ...deanPerson,
      role: 'DEAN',
      universityId: uniId,
      facultyId: faculty.id,
      ...staffProfile(deanPerson, random, facCtx),
      position: 'Декан факультета',
      academicDegree: random.pick(template.degrees),
      academicTitle: random.pick(ACADEMIC_TITLES),
      jobTitle: 'Декан',
      responsibilities: 'Учебный процесс факультета, приём студентов, аттестация.',
    })

    const teacherIds = []
    for (let t = 0; t < faculty.teacherCount; t += 1) {
      const teacherId = child(faculty.id, 't', t)
      const teacherPerson = person(counter++, random)
      teacherIds.push(teacherId)
      await addUser({
        id: teacherId,
        email: emailFor(index, `t.${template.code}.${t}`),
        username: usernameFor(index, `t.${template.code}.${t}`),
        passwordHash,
        ...teacherPerson,
        role: 'TEACHER',
        universityId: uniId,
        facultyId: faculty.id,
        ...staffProfile(teacherPerson, random, facCtx),
        position: random.pick(POSITIONS_TEACHER),
        academicDegree: random.pick(template.degrees),
        academicTitle: random.chance(0.5) ? random.pick(ACADEMIC_TITLES) : null,
      })
    }

    const groups = []
    let oldestSeen = false
    for (const group of faculty.groups) {
      const studentIds = []
      const isOldest = group.year === enrollmentYears()[0]
      const inactiveCode = inactiveStatusFor({
        group,
        groupIndex,
        firstOldestOfFaculty: isOldest && !oldestSeen,
      })
      if (isOldest) oldestSeen = true
      groupIndex += 1
      for (let s = 0; s < group.studentCount; s += 1) {
        const studentId = child(group.id, 'st', String(s).padStart(2, '0'))
        const studentPerson = person(counter++, random)
        const isStarosta = s === 0
        studentIds.push(studentId)
        // Последний студент группы (не староста) — носитель не-активного статуса.
        const status =
          inactiveCode && !isStarosta && s === group.studentCount - 1
            ? academicStatusFields(inactiveCode, { calendar, groupIndex })
            : { academicStatus: ACADEMIC_STATUS.ACTIVE }
        if (status.since) {
          people.studentStatus.set(studentId, {
            code: inactiveCode,
            since: status.since,
            leftAt: status.leftUniversityAt ?? null,
          })
        }
        await addUser({
          id: studentId,
          // Локальная часть — хвост id студента (g.eco.3.st07): уникальна внутри вуза
          // по построению, в отличие от «имя.фамилия», которые повторяются.
          email: emailFor(index, localFromId(studentId)),
          // username выводится из СТРУКТУРНОГО хвоста id, а не из «фамилия + счётчик».
          // Иначе он зависит от случайной фамилии и позиции в обходе: смена плана вуза
          // (стало больше факультетов) сдвигает счётчик, новый студент занимает username
          // уже существующего, его строка молча пропускается по уникальному индексу — и
          // NotificationSettings на несуществующего пользователя роняет прогон по FK.
          // Ровно это и случилось на полном прогоне с двумя вузами.
          username: usernameFor(index, `${translit(studentPerson.lastName)}.${localFromId(studentId)}`), // prettier-ignore
          passwordHash,
          ...studentPerson,
          role: isStarosta ? 'STAROSTA' : 'STUDENT',
          universityId: uniId,
          facultyId: faculty.id,
          groupId: group.id,
          ...studentProfile(studentPerson, random, {
            group,
            specialties: template.specialties,
            cityName,
            profile,
          }),
          // Поверх профиля: построитель кладёт код ACTIVE, а сервис хранит написание
          // справочника. Служебное `since` в строку пользователя не попадает.
          academicStatus: status.academicStatus,
          ...(status.leftUniversityAt ? { leftUniversityAt: status.leftUniversityAt } : {}),
          ...(status.graduationYear ? { graduationYear: status.graduationYear } : {}),
          ...(isStarosta
            ? {
                starostaSince: new Date(Date.UTC(group.year, 8, 1)),
                duties: 'Староста группы: посещаемость, объявления, связь с деканатом.',
              }
            : {}),
        })
      }
      groups.push({ ...group, studentIds, starostaId: studentIds[0] })
    }

    people.faculties.push({ ...faculty, deanId, teacherIds, groups })
  }

  // Пользователи должны существовать до простановки старост и до инвайтов (FK).
  await writer.flush()

  // Староста группы — отдельным апдейтом: Group.starostaId ссылается на User, а User
  // ссылается на Group. Одной вставкой такой цикл не закрыть.
  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      await prisma.group
        .update({ where: { id: group.id }, data: { starostaId: group.starostaId } })
        .catch(() => {})
    }
  }

  // ── Инвайты вуза: очередь приглашений в разных статусах ─────────────────────
  // Без них экран «Приглашения» у админа вуза пустой, а он есть у каждого вуза.
  const inviteRoles = ['STUDENT', 'STUDENT', 'TEACHER', 'STAROSTA', 'DEAN', 'UNIVERSITY_MODERATOR']
  for (const [i, role] of inviteRoles.entries()) {
    const status = i % 3 === 0 ? 'PENDING' : i % 3 === 1 ? 'USED' : 'EXPIRED'
    const faculty = people.faculties[i % people.faculties.length]
    const group = faculty.groups[0]
    // Scope инвайта — как у сервиса выдачи: факультет у всех ролей факультета (декану
    // тоже), группа — у учащихся.
    const inFaculty = ['STUDENT', 'STAROSTA', 'TEACHER', 'DEAN'].includes(role)
    const inGroup = ['STUDENT', 'STAROSTA'].includes(role)
    // Использованный инвайт закрыт человеком ТОЙ ЖЕ роли и из того же scope: регистрация
    // берёт роль из инвайта, и «студенческий инвайт использовал преподаватель» — состояние,
    // которого в живой базе не бывает.
    const usedBy = {
      STUDENT: group.studentIds[1],
      STAROSTA: group.starostaId,
      TEACHER: faculty.teacherIds[0],
      DEAN: faculty.deanId,
      UNIVERSITY_MODERATOR: people.moderatorIds[0],
    }[role]
    await writer.add('invite', {
      id: id(index, 'inv', i),
      // Токен уникален глобально; он же ключ ссылки-приглашения. У живого (PENDING)
      // инвайта он не должен быть выводим из репозитория: сид гоняют и по боевой базе, и
      // `u001-invite-3-pending` был бы готовой регистрацией старостой. Поэтому в колонку
      // кладём хэш случайного токена (так хранит и сервис, invite-token.ts) — сам токен
      // нигде не сохраняется, и ссылкой по такому инвайту не воспользоваться никому.
      // Использованным и истёкшим предсказуемый токен ничего не даёт.
      token:
        status === 'PENDING'
          ? createHash('sha256').update(randomUUID()).digest('hex')
          : `${id(index, 'invite', i)}-${status.toLowerCase()}`,
      role,
      email: `invite.${i}@${uniId}.example.kz`,
      universityId: uniId,
      facultyId: inFaculty ? faculty.id : null,
      groupId: inGroup ? group.id : null,
      status,
      expiresAt: status === 'EXPIRED' ? random.randomDate(-30, -2) : random.randomDate(2, 30),
      // Выдаёт тот, кому иерархия инвайтов разрешает (invites.service): студента — староста
      // группы, старосту — декан, остальных — админ вуза.
      createdById:
        role === 'STUDENT' ? group.starostaId : role === 'STAROSTA' ? faculty.deanId : adminId,
      usedById: status === 'USED' ? usedBy : null,
      usedAt: status === 'USED' ? random.randomDate(-20, -1) : null,
    })
  }
  // Отозванные и приглашения ролей с запретом по умолчанию (охрана, библиотекарь — их выдаёт
  // админ вуза, scope — только вуз). Без случайных чисел: хвост потока шага не сдвигается.
  // REVOKED токеном не воспользоваться, поэтому он предсказуемый, как у USED/EXPIRED.
  const extraInvites = [
    ['TEACHER', 'REVOKED'],
    ['SECURITY_GUARD', 'PENDING'],
    ['LIBRARIAN', 'REVOKED'],
  ]
  for (const [k, [role, status]] of extraInvites.entries()) {
    const i = inviteRoles.length + k
    const faculty = people.faculties[i % people.faculties.length]
    await writer.add('invite', {
      id: id(index, 'inv', i),
      token:
        status === 'PENDING'
          ? createHash('sha256').update(randomUUID()).digest('hex')
          : `${id(index, 'invite', i)}-${status.toLowerCase()}`,
      role,
      email: `invite.${i}@${uniId}.example.kz`,
      universityId: uniId,
      facultyId: role === 'TEACHER' ? faculty.id : null,
      groupId: null,
      status,
      // Отзыв не трогает срок: отозванный инвайт остаётся со сроком, которого не дождался.
      expiresAt: new Date(Date.now() + (7 + k * 5) * DAY_MS),
      createdById: adminId,
      usedById: null,
      usedAt: null,
    })
  }
  await writer.flush()

  return people
}

/**
 * Поля учебного статуса так, как их оставляет PATCH /users/:id/academic: значение
 * справочника и дата ухода из вуза у ушедших (группа и роль не меняются — сервис их не
 * трогает). `since` — с какого дня студент не учится: у академического отпуска даты в базе
 * нет (leftUniversityAt — только у ушедших), но посещаемость после неё ставить нельзя.
 */
function academicStatusFields(code, { calendar, groupIndex }) {
  const now = Date.now()
  if (code === 'GRADUATED') {
    // Конец прошлого семестра: выпуск — по итогам закрытой сессии.
    const leftAt = new Date(`${calendar.prev.to}T12:00:00Z`)
    return {
      academicStatus: ACADEMIC_STATUS.GRADUATED,
      leftUniversityAt: leftAt,
      graduationYear: leftAt.getUTCFullYear(),
      since: leftAt,
    }
  }
  // 15–44 дня назад: внутри окна журнала поста охраны (120 дней) и истории посещаемости.
  const since = new Date(now - (15 + ((groupIndex * 7) % 30)) * DAY_MS)
  since.setUTCHours(12, 0, 0, 0)
  return {
    academicStatus: ACADEMIC_STATUS[code],
    ...(LEFT_STATUSES.has(code) ? { leftUniversityAt: since } : {}),
    since,
  }
}
