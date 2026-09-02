// Шаг «структура вуза»: University → Faculty → Specialty/Subject → Term → Room → Group.
//
// Считает план вуза (сколько факультетов, групп, преподавателей) от заданного числа
// студентов и возвращает его следующим шагам — люди, курсы и контент строятся уже
// поверх готовой структуры.
//
// Демо-вуз (`seed-university-001`) генератор не трогает: он создаёт свои вузы u001…uN
// рядом. Причины — в prisma/seed/lib/ids.mjs.

import { facultiesFor } from '../data/faculties.mjs'
import { universityProfile } from '../data/universities.mjs'
import { id, universityId } from '../lib/ids.mjs'

// Студентов в группе. 25 — типичный размер академической группы; от него считаются
// и число групп, и нагрузка преподавателей.
const GROUP_SIZE = 25
// Годы набора: 4 курса бакалавриата.
const ENROLLMENT_YEARS = [2022, 2023, 2024, 2025]

// Неучебные помещения (Ф16): по QR-коду студент видит часы работы, а не пару.
const SERVICE_ROOMS = [
  ['LIBRARY', 'Библиотека', 'Пн–Пт 09:00–19:00, Сб 10:00–15:00'],
  ['ASSEMBLY_HALL', 'Актовый зал', 'по расписанию мероприятий'],
  ['ADMIN_OFFICE', 'Приёмная ректора', 'Пн–Пт 09:00–18:00, обед 13:00–14:00'],
  ['ACCOUNTING', 'Бухгалтерия', 'Пн–Пт 10:00–17:00, обед 13:00–14:00'],
  ['CANTEEN', 'Столовая', 'Пн–Сб 08:00–18:00'],
  ['SPORT_HALL', 'Спортивный зал', 'Пн–Сб 08:00–22:00'],
  ['DORMITORY', 'Общежитие №1', 'круглосуточно'],
]

// План вуза по числу студентов. Отдельная функция, потому что её же использует
// прогресс-бар (нужно знать объём заранее) и тесты плана масштаба.
export function planUniversity(index, random, { studentsMin, studentsMax }) {
  const students = random.randInt(studentsMin, studentsMax)
  // Факультетов от 4 до 7: у маленького вуза их меньше, у большого больше.
  const facultyCount = Math.min(7, Math.max(4, Math.round(students / 260)))
  const faculties = facultiesFor(index, facultyCount)
  const groupCount = Math.max(faculties.length * ENROLLMENT_YEARS.length, Math.ceil(students / GROUP_SIZE)) // prettier-ignore

  // Группы раскладываем по факультетам как можно ровнее, внутри факультета — по годам
  // набора: иначе на четвёртом курсе не оказалось бы ни одной группы.
  const plan = faculties.map((template) => ({ template, groups: [] }))
  for (let g = 0; g < groupCount; g += 1) {
    const facIndex = g % faculties.length
    const withinFaculty = Math.floor(g / faculties.length)
    const year = ENROLLMENT_YEARS[withinFaculty % ENROLLMENT_YEARS.length]
    const number = Math.floor(withinFaculty / ENROLLMENT_YEARS.length) + 1
    plan[facIndex].groups.push({ year, number, students: GROUP_SIZE })
  }

  // Преподавателей — из нагрузки: 6 дисциплин на группу, до 6 курсов на преподавателя.
  for (const faculty of plan) {
    faculty.teacherCount = Math.max(5, Math.ceil((faculty.groups.length * 6) / 6))
  }

  return {
    index,
    students: groupCount * GROUP_SIZE,
    faculties: plan,
    groupCount,
    roomCount: Math.max(12, Math.ceil(groupCount / 2)),
  }
}

export async function seedStructure(prisma, writer, { index, random, config }) {
  const uniId = universityId(index)
  const profile = universityProfile(index, config.cities)
  const plan = planUniversity(index, random, config)

  // Статус в update не переписываем: модератор платформы мог сменить его руками,
  // и повторный сид не должен откатывать это решение.
  const universityData = {
    name: profile.name,
    shortName: profile.shortName,
    country: profile.country,
    city: profile.city,
    timezone: profile.timezone,
  }
  await prisma.university.upsert({
    where: { id: uniId },
    update: universityData,
    create: { id: uniId, ...universityData, status: profile.status },
  })

  // ── Семестры: прошлый (закрыт) и текущий (активен) ──────────────────────────
  // Два, а не один: без закрытого семестра не проверить транскрипт и историю оценок.
  const year = new Date().getUTCFullYear()
  const terms = [
    { suffix: 'prev', name: `Весна ${year}`, number: 4, from: `${year}-01-20`, to: `${year}-06-10`, active: false }, // prettier-ignore
    { suffix: 'cur', name: `Осень ${year}`, number: 5, from: `${year}-09-01`, to: `${year}-12-31`, active: true }, // prettier-ignore
  ]
  const termIds = {}
  for (const term of terms) {
    const termId = id(index, 'term', term.suffix)
    termIds[term.suffix] = termId
    await prisma.term.upsert({
      where: { id: termId },
      update: { name: term.name, isActive: term.active },
      create: {
        id: termId,
        universityId: uniId,
        name: term.name,
        number: term.number,
        startsOn: new Date(term.from),
        endsOn: new Date(term.to),
        isActive: term.active,
      },
    })
  }

  // ── Аудитории и служебные помещения ─────────────────────────────────────────
  const rooms = []
  for (let r = 0; r < plan.roomCount; r += 1) {
    const floor = (r % 4) + 1
    const kind = r % 7 === 6 ? 'LAB' : 'AUDITORIUM'
    const roomId = id(index, 'room', r)
    rooms.push(roomId)
    await writer.add('room', {
      id: roomId,
      universityId: uniId,
      name: kind === 'LAB' ? `Лаборатория ${floor}0${r % 9}` : `${floor}0${r % 9}`,
      capacity: random.pick([24, 30, 40, 50, 60, 80]),
      kind,
      building: random.pick(['Корпус А', 'Корпус Б', 'Корпус В']),
      floor,
      // qrCode уникален глобально, поэтому в нём префикс вуза (Ф16: печатная наклейка).
      qrCode: `${uniId}-R${String(r).padStart(3, '0')}`,
      qrIssuedAt: random.randomDate(-400, -10),
      info: 'Учебное помещение. Занятия — по расписанию группы.',
    })
  }
  for (const [kind, name, openHours] of SERVICE_ROOMS) {
    const roomId = id(index, 'srv', kind.toLowerCase())
    await writer.add('room', {
      id: roomId,
      universityId: uniId,
      name,
      kind,
      building: 'Корпус А',
      floor: 1,
      openHours,
      phone: `+7 (727) ${random.randInt(200, 399)}-${random.randInt(10, 99)}-${random.randInt(10, 99)}`, // prettier-ignore
      info: `${name}: обращайтесь в часы работы.`,
      qrCode: `${uniId}-S-${kind}`,
      qrIssuedAt: random.randomDate(-400, -10),
    })
  }

  // ── Факультеты, специальности, дисциплины, группы ────────────────────────────
  const faculties = []
  for (const faculty of plan.faculties) {
    const template = faculty.template
    const facultyId = id(index, 'f', template.code)

    await prisma.faculty.upsert({
      where: { id: facultyId },
      update: { name: template.name },
      create: { id: facultyId, name: template.name, universityId: uniId },
    })

    for (const [si, specialty] of template.specialties.entries()) {
      await writer.add('specialty', {
        id: id(index, 'spec', template.code, si),
        universityId: uniId,
        name: specialty,
      })
    }

    const subjects = []
    for (const [name, code] of template.subjects) {
      // Дисциплина уникальна по (universityId, name) — id детерминирован по коду.
      const subjectId = id(index, 'subj', code)
      subjects.push({ id: subjectId, name, code })
      await writer.add('subject', { id: subjectId, universityId: uniId, name, code })
    }

    const groups = faculty.groups.map((group, gi) => ({
      id: id(index, 'g', template.code, gi),
      name: `${template.prefix}-${String(group.year).slice(2)}-${group.number}`,
      year: group.year,
      facultyId,
      studentCount: group.students,
    }))
    for (const group of groups) {
      await writer.add('group', {
        id: group.id,
        name: group.name,
        year: group.year,
        facultyId: group.facultyId,
      })
    }

    faculties.push({ ...faculty, id: facultyId, template, subjects, groups })
  }

  // Пары/курсы/оценки создаются следующим шагом уже по этой структуре, поэтому
  // буфер нужно дописать: иначе FK на группы и дисциплины ещё не выполнимы.
  await writer.flush()

  return { uniId, profile, plan, faculties, rooms, termIds }
}

export { GROUP_SIZE, ENROLLMENT_YEARS }
