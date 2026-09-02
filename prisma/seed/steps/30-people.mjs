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

import { ACADEMIC_TITLES, POSITIONS_TEACHER, person, translit } from '../data/people.mjs'
import { staffProfile, studentProfile } from '../data/profiles.mjs'
import { child, emailFor, id, uniPrefix, usernameFor } from '../lib/ids.mjs'

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

  // ── Деканы, преподаватели, студенты, старосты ────────────────────────────────
  const people = { adminId, moderatorIds, faculties: [] }

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
    for (const group of faculty.groups) {
      const studentIds = []
      for (let s = 0; s < group.studentCount; s += 1) {
        const studentId = child(group.id, 'st', String(s).padStart(2, '0'))
        const studentPerson = person(counter++, random)
        const isStarosta = s === 0
        studentIds.push(studentId)
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
    await writer.add('invite', {
      id: id(index, 'inv', i),
      // Токен уникален глобально; он же ключ ссылки-приглашения.
      token: `${id(index, 'invite', i)}-${status.toLowerCase()}`,
      role,
      email: `invite.${i}@${uniId}.example.kz`,
      universityId: uniId,
      facultyId:
        role === 'STUDENT' || role === 'STAROSTA' || role === 'TEACHER' ? faculty.id : null,
      groupId: role === 'STUDENT' || role === 'STAROSTA' ? faculty.groups[0].id : null,
      status,
      expiresAt: status === 'EXPIRED' ? random.randomDate(-30, -2) : random.randomDate(2, 30),
      createdById: adminId,
      usedById: status === 'USED' ? faculty.teacherIds[0] : null,
      usedAt: status === 'USED' ? random.randomDate(-20, -1) : null,
    })
  }
  await writer.flush()

  return people
}
