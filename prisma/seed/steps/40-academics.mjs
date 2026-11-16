// Шаг «академика»: курсы, расписание, журнал оценок, задания, посещаемость, экзамены,
// консультации, записи в деканат, учебные материалы.
//
// Это самый тяжёлый шаг сида: посещаемость — это (пары × недели × студенты), то есть
// ~43 000 строк на вуз и ~4.3 млн на сто вузов. Поэтому строки не собираются в массивы,
// а сразу уходят в буферный writer, а даты считаются от текущей недели, чтобы окна
// дашбордов («последние 12 недель») не оказались пустыми через месяц после сида.

import { formatCycler, formatFileRow, formatSamples } from '../lib/formats.mjs'
import { child } from '../lib/ids.mjs'

// Сетка звонков: пять пар по 90 минут.
const TIMES = [
  ['08:30', '10:00'],
  ['10:10', '11:40'],
  ['11:50', '13:20'],
  ['14:00', '15:30'],
  ['15:40', '17:10'],
]

// Глубина истории посещаемости в неделях: столько же, сколько окно тренда на дашборде
// вуза (12 недель ≈ семестр). Меньше — и график динамики нечем наполнить.
const ATT_WEEKS = 12

// Колонки журнала: сумма весов = 100.
const GRADE_COLUMNS = [
  ['LAB', 'Лабораторные', 30],
  ['CONTROL', 'Контрольная', 30],
  ['EXAM', 'Итоговый', 40],
]
// У каждой четвёртой дисциплины вместо лабораторных — работа на семинарах (вид OTHER из
// GRADE_COLUMN_KINDS): дисциплины без лабораторных бывают, а колонка «прочее» иначе не
// встречается нигде. Подмена, а не четвёртая колонка: оценок на студента не прибавляется.
const OTHER_COLUMN = ['OTHER', 'Работа на семинарах', 30]

// Виды заданий — из ASSIGNMENT_TYPES (packages/shared-schemas/assignments.ts).
const ASSIGNMENT_TYPES = ['HOMEWORK', 'LAB', 'COURSEWORK', 'PROJECT', 'OTHER']
// Способ сдачи (SUBMISSION_TYPES) — по кругу: TEXT дважды, FILE и MIXED — 40% заданий с
// файлами. По кругу, а не случайно: на любом объёме встречаются все четыре способа.
const SUBMISSION_KINDS = ['TEXT', 'FILE', 'LINK', 'MIXED', 'TEXT']
// Форматы экзамена (EXAM_FORMATS в shared-schemas/exams.ts) — тоже по кругу.
const EXAM_FORMATS = ['WRITTEN', 'ORAL', 'TEST', 'PROJECT', 'OTHER']
// Статусы записи в деканат (APPOINTMENT_STATUSES) — по кругу по группам.
const APPOINTMENT_STATUSES = ['REQUESTED', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED']
const APPOINTMENT_TYPES = ['CONSULTATION', 'DOCUMENT', 'ACADEMIC', 'OTHER']
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const APPOINTMENT_TOPICS = [
  'Вопрос по стипендии',
  'Академический отпуск',
  'Пересдача экзамена',
  'Справка об обучении',
  'Перевод на другую специальность',
  'Заселение в общежитие',
]

/**
 * Чётность ISO-недели даты — та же формула, что у API (isoWeekParity в schedules.service.ts),
 * веба и мобильных клиентов: неделя с понедельника, первая — та, где первый четверг года.
 */
function isoWeekParity(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7))
  const week = 1 + Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / (7 * DAY_MS))
  return week % 2 === 1 ? 'ODD' : 'EVEN'
}

/** Пара идёт в неделю этой даты (heldInWeek в schedules.service.ts). */
function heldOn(weekType, date) {
  return weekType === 'BOTH' || weekType === isoWeekParity(date)
}

// Понедельник текущей недели (UTC) — опорная точка для дат посещаемости.
function currentMonday() {
  const now = new Date()
  const isoDay = (now.getUTCDay() + 6) % 7
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - isoDay))
}

export async function seedAcademics(prisma, writer, ctx) {
  const { random, structure, people, config } = ctx
  const { termIds, rooms } = structure
  const attWeeks = config.attendanceWeeks ?? ATT_WEEKS
  const monday = currentMonday()
  const now = Date.now()
  // Студент в академе или ушедший (30-people): с даты `since` он не ходит на пары, не сдаёт
  // задания и не получает новых оценок.
  const studentStatus = people.studentStatus ?? new Map()
  const inactiveSince = (studentId) => studentStatus.get(studentId)?.since ?? null
  const activeOn = (studentId, date) => {
    const since = inactiveSince(studentId)
    return since === null || date < since
  }

  const allTeacherIds = people.faculties.flatMap((f) => f.teacherIds)

  // ── Курсы, расписание, пары ─────────────────────────────────────────────────
  // Курс = дисциплина группы в семестре (уникален по subject+group+term). Прошлый
  // семестр тоже наполняем — иначе транскрипт и история оценок пустые.
  const courses = []
  for (const faculty of people.faculties) {
    for (const group of faculty.groups) {
      const scheduleId = child(group.id, 'sch')
      await writer.add('schedule', {
        id: scheduleId,
        groupId: group.id,
        name: structure.calendar.scheduleName,
        isActive: true,
      })

      for (const [si, subject] of faculty.subjects.entries()) {
        const teacherId = faculty.teacherIds[si % faculty.teacherIds.length]
        // Текущий семестр — с расписанием и посещаемостью; прошлый — только оценки.
        for (const [termKey, termId] of Object.entries(termIds)) {
          const courseId = child(group.id, 'c', termKey, subject.code)
          await writer.add('course', {
            id: courseId,
            subjectId: subject.id,
            groupId: group.id,
            teacherId,
            termId,
            credits: random.pick([3, 4, 5, 6]),
          })
          courses.push({
            id: courseId,
            subject,
            teacherId,
            group,
            facultyId: faculty.id,
            current: termKey === 'cur',
          })
        }

        // Пара в расписании — только для текущего семестра.
        const day = (si % 5) + 1
        const [startTime, endTime] = TIMES[si % TIMES.length]
        // Дисциплин больше, чем слотов сетки: шестая встаёт в слот первой. Раньше это был
        // конфликт расписания группы, теперь — «мигалка», как в настоящих вузах: первая
        // дисциплина по нечётным неделям, шестая по чётным (WeekType ODD/EVEN).
        const sharesSlot =
          faculty.subjects.length > TIMES.length &&
          si % TIMES.length < faculty.subjects.length - TIMES.length
        const weekType = sharesSlot ? (si < TIMES.length ? 'ODD' : 'EVEN') : 'BOTH'
        const pairId = child(group.id, 'p', si)
        await writer.add('pair', {
          id: pairId,
          scheduleId,
          groupId: group.id,
          subject: subject.name,
          teacherId,
          roomId: random.pick(rooms),
          dayOfWeek: day,
          startTime,
          endTime,
          weekType,
        })
        group.pairs ??= []
        group.pairs.push({ id: pairId, day, teacherId, weekType })
      }
    }
  }
  // Пары и курсы должны быть в БД до оценок, посещаемости и изменений расписания.
  await writer.flush()

  // Плоский список групп собираем ПОСЛЕ создания пар: group.pairs заполняется в цикле
  // выше, и копия, снятая раньше, осталась бы без пар — посещаемость молча вышла бы
  // нулевой (именно так и случилось на первом прогоне).
  const allGroups = people.faculties.flatMap((f) =>
    f.groups.map((g) => ({ ...g, facultyId: f.id, deanId: f.deanId, teacherIds: f.teacherIds })),
  )

  // ── Изменения расписания (перенос/замена/отмена/смена аудитории) ────────────
  // По одному изменению каждого типа на вуз плюс россыпь: без них экран «Изменения»
  // и уведомления SCHEDULE_CHANGE проверить нечем.
  const changeTypes = ['CANCELLED', 'MOVED', 'ROOM_CHANGED', 'SUBSTITUTED']
  // Отменённые пары: посещаемость на них не ставится (ключ — пара и дата).
  const cancelled = new Set()
  for (const [ci, group] of allGroups.entries()) {
    if (!group.pairs?.length) continue
    if (ci % 3 !== 0) continue
    const pair = random.pick(group.pairs)
    const type = changeTypes[ci % changeTypes.length]
    const [newStart, newEnd] = random.pick(TIMES)
    // Разовое изменение — в день, когда эта пара стоит в расписании (её день недели), на
    // следующей или через неделю: изменение должно быть «актуальным», а сдвиг на
    // произвольное число дней ставил его на день, когда пары нет вовсе. Пара через неделю
    // (ODD/EVEN) идёт только в одну из двух соседних недель — API принимает изменение лишь
    // на неделю нужной чётности.
    const weekAt = (k) => new Date(monday.getTime() + (pair.day - 1 + 7 * k) * DAY_MS)
    const k0 = random.randInt(1, 2)
    const date = heldOn(pair.weekType, weekAt(k0)) ? weekAt(k0) : weekAt(3 - k0)
    if (type === 'CANCELLED') cancelled.add(`${pair.id}|${date.toISOString().slice(0, 10)}`)
    await writer.add('scheduleChange', {
      id: child(pair.id, 'chg', type.toLowerCase()),
      pairId: pair.id,
      type,
      date,
      newRoomId: type === 'ROOM_CHANGED' || type === 'MOVED' ? random.pick(rooms) : null,
      newTeacherId: type === 'SUBSTITUTED' ? random.pick(group.teacherIds) : null,
      newStartTime: type === 'MOVED' ? newStart : null,
      newEndTime: type === 'MOVED' ? newEnd : null,
      note: {
        CANCELLED: 'Преподаватель на конференции',
        MOVED: 'Перенос по просьбе группы',
        ROOM_CHANGED: 'Аудитория занята комиссией',
        SUBSTITUTED: 'Замена на время больничного',
      }[type],
      createdById: group.deanId,
    })
  }

  // ── Журнал оценок ───────────────────────────────────────────────────────────
  for (const [ci, course] of courses.entries()) {
    // Курсы идут парами (текущий и прошлый семестр одной дисциплины) — подмена по дисциплине,
    // чтобы колонка «прочее» была и в открытом журнале, и в закрытом.
    const columns =
      Math.floor(ci / 2) % 4 === 3 ? [OTHER_COLUMN, ...GRADE_COLUMNS.slice(1)] : GRADE_COLUMNS
    for (const [ki, [kind, title, maxScore]] of columns.entries()) {
      const columnId = child(course.id, 'gc', ki)
      await writer.add('gradeColumn', {
        id: columnId,
        courseId: course.id,
        createdById: course.teacherId,
        title,
        kind,
        maxScore,
        position: ki,
        // Прошлый семестр закрыт — там опубликовано всё; в текущем последняя колонка
        // может быть ещё черновиком.
        published: course.current ? ki < 2 || random.chance(0.5) : true,
      })
      for (const studentId of course.group.studentIds) {
        // В закрытом семестре оценка есть почти всегда, в текущем — не у всех.
        const drawn = course.current ? random.chance(0.85) : random.chance(0.98)
        // В текущем семестре ушедшему или ушедшему в академ новых оценок не ставят.
        const hasScore = drawn && !(course.current && inactiveSince(studentId) !== null)
        await writer.add('grade', {
          id: child(columnId, 'g', studentId),
          columnId,
          studentId,
          score: hasScore ? Number((maxScore * (0.45 + random.rng() * 0.55)).toFixed(1)) : null,
        })
      }
    }
  }

  // ── Учебные материалы ───────────────────────────────────────────────────────
  // Строки материалов — раньше заданий: файлы (File.materialId) пишутся ниже, после сдач, и
  // буфер writer'а должен знать модель material раньше модели file (порядок флаша по FK).
  const formats = ctx.pool?.formats ?? null
  const currentCourses = courses.filter((c) => c.current)
  for (const [ci, course] of currentCourses.entries()) {
    await writer.add('material', {
      id: child(course.id, 'mat'),
      teacherId: course.teacherId,
      groupId: course.group.id,
      subject: course.subject.name,
      title: `Лекции: ${course.subject.name}`,
      description: 'Конспекты, слайды и список литературы по курсу.',
      // Ссылка — у каждого третьего: остальные материалы — только файлы. Без хранилища
      // (образцов нет) ссылка у всех, иначе материал был бы пустым.
      url: !formats || ci % 3 === 0 ? 'https://materials.example.edu/course' : null,
    })
  }

  // ── Задания и сдачи (только текущий семестр) ────────────────────────────────
  // Статус задания: каждое шестое второе задание — черновик (студенты его не видят, сдач
  // нет), каждое четвёртое первое — закрыто (срок прошёл, приём работ окончен).
  // Статус сдачи — по кругу по номеру студента в группе: черновик и «на доработку» есть в
  // каждой дисциплине, а не «где повезёт».
  const submissionSamples = formatSamples(formats, 'applications')
  const nextSubmissionSample = formatCycler(submissionSamples)
  const submissionFiles = []
  for (const [ci, course] of currentCourses.entries()) {
    for (let a = 0; a < 2; a += 1) {
      const assignmentId = child(course.id, 'as', a)
      const status =
        a === 1 && ci % 6 === 5 ? 'DRAFT' : a === 0 && ci % 4 === 2 ? 'CLOSED' : 'PUBLISHED'
      const submissionType = SUBMISSION_KINDS[(ci * 2 + a) % SUBMISSION_KINDS.length]
      const publishAt = status === 'DRAFT' ? null : random.daysFromNow(-20 + a * 7)
      const dueAt = random.daysFromNow(-5 + a * 10)
      const allowLate = random.chance(0.5)
      await writer.add('assignment', {
        id: assignmentId,
        courseId: course.id,
        createdById: course.teacherId,
        title: `${course.subject.name}: задание ${a + 1}`,
        description:
          submissionType === 'LINK'
            ? 'Выложите решение в репозиторий и пришлите ссылку.'
            : submissionType === 'TEXT'
              ? 'Ответьте на вопросы задания текстом.'
              : 'Выполните задание и приложите решение файлом (отчёт, код архивом, презентация).',
        type: random.pick(ASSIGNMENT_TYPES),
        submissionType,
        status,
        maxScore: 100,
        maxAttempts: random.pick([1, 1, 2, 3]),
        allowLate,
        publishAt,
        dueAt,
      })
      // Черновик задания студентам не виден — сдач по нему быть не может.
      if (status === 'DRAFT') continue
      for (const [si, studentId] of course.group.studentIds.entries()) {
        if (!random.chance(0.8)) continue
        // Ушедшие и академ — не сдают (задания вышли после даты статуса).
        if (inactiveSince(studentId) !== null) continue
        const roll = (si + a + ci) % 20
        const subStatus =
          roll === 0 ? 'DRAFT' : roll === 1 ? 'RETURNED' : roll < 7 ? 'SUBMITTED' : 'GRADED'
        const submissionId = child(assignmentId, 'sub', studentId)
        // Отправлено до срока (и не в будущем): поздняя сдача без allowLate API не примет.
        const upper = Math.min(dueAt.getTime(), now)
        const submittedAt =
          subStatus === 'DRAFT' ? null : new Date(upper - random.randInt(2, 72) * HOUR_MS)
        const reviewed = subStatus === 'GRADED' || subStatus === 'RETURNED'
        const gradedAt = reviewed
          ? new Date(Math.min(now - HOUR_MS, submittedAt.getTime() + random.randInt(4, 48) * HOUR_MS)) // prettier-ignore
          : null
        const withText = submissionType === 'TEXT' || submissionType === 'MIXED'
        const withLink =
          submissionType === 'LINK' || (submissionType === 'MIXED' && random.chance(0.5))
        const withFile = submissionType === 'FILE' || submissionType === 'MIXED'
        await writer.add('submission', {
          id: submissionId,
          assignmentId,
          studentId,
          status: subStatus,
          text: withText
            ? subStatus === 'DRAFT'
              ? 'Черновик: начал разбирать задачу, допишу к сроку.'
              : 'Решение прикреплено, комментарии в файле.'
            : null,
          linkUrl: withLink ? 'https://github.com/example/homework' : null,
          attemptNumber: 1,
          score: subStatus === 'GRADED' ? random.randInt(50, 100) : null,
          feedback:
            subStatus === 'GRADED'
              ? random.pick(['Хорошая работа', 'Есть замечания по оформлению', 'Зачтено'])
              : subStatus === 'RETURNED'
                ? 'Доработайте выводы и оформите отчёт по шаблону кафедры.'
                : null,
          // Возврат на доработку пишет проверяющего и время, как returnForFix.
          gradedById: reviewed ? course.teacherId : null,
          submittedAt,
          gradedAt,
        })
        if (withFile && submissionSamples.length > 0) {
          submissionFiles.push({
            submissionId,
            studentId,
            sample: nextSubmissionSample(),
            createdAt: submittedAt ?? new Date(now - random.randInt(1, 48) * HOUR_MS),
          })
        }
      }
    }
  }

  // ── Файлы сдач и материалов ─────────────────────────────────────────────────
  // Ссылки на объекты образцов (lib/formats.mjs): строка File на вложение, объект в бакете
  // один. Сдачи — бакет applications, все категории: архивы сдачам разрешены (allowArchives
  // в assignments.service.ts). Материалы — бакет materials без архивов (materials.service.ts
  // не включает allowArchives): документ к каждому материалу и медиа по кругу.
  for (const [n, f] of submissionFiles.entries()) {
    await writer.add(
      'file',
      formatFileRow(f.sample, n, {
        id: child(f.submissionId, 'f', 0),
        ownerId: f.studentId,
        submissionId: f.submissionId,
        createdAt: f.createdAt,
      }),
    )
  }
  const nextMaterialDoc = formatCycler(formatSamples(formats, 'materials', { categories: ['DOCUMENT'] })) // prettier-ignore
  const nextMaterialMedia = formatCycler(
    formatSamples(formats, 'materials', { categories: ['IMAGE', 'VIDEO', 'AUDIO'] }),
  )
  for (const [ci, course] of currentCourses.entries()) {
    const materialId = child(course.id, 'mat')
    for (const [k, sample] of [nextMaterialDoc(), nextMaterialMedia()].entries()) {
      if (!sample) continue
      await writer.add(
        'file',
        formatFileRow(sample, ci, {
          id: child(materialId, 'f', k),
          ownerId: course.teacherId,
          materialId,
          order: k,
          createdAt: new Date(now - (30 - (ci % 20)) * DAY_MS),
        }),
      )
    }
  }

  // ── Посещаемость ────────────────────────────────────────────────────────────
  // Первые три пары каждой группы × ATT_WEEKS недель. Идентификатор включает дату:
  // при повторном прогоне (SEED_FORCE) старые строки сначала удаляются по pairId,
  // иначе слои прогонов за разные даты накапливались бы и завышали статистику.
  const attPairIds = allGroups.flatMap((g) => (g.pairs ?? []).slice(0, 3).map((p) => p.id))
  if (attPairIds.length > 0) {
    await prisma.attendance.deleteMany({ where: { pairId: { in: attPairIds } } })
  }
  // Отмечают только прошедшие пары текущего семестра: не сегодня и не в будущем (окно
  // доходит до конца текущей недели), не до начала семестра (в августе осенний ещё не
  // начался) и не на отменённых парах.
  const today = new Date(monday)
  today.setUTCDate(today.getUTCDate() + ((new Date().getUTCDay() + 6) % 7))
  const termFrom = new Date(structure.calendar.cur.from)
  const termTo = new Date(structure.calendar.cur.to)
  for (const group of allGroups) {
    for (const pair of (group.pairs ?? []).slice(0, 3)) {
      for (let w = 0; w < attWeeks; w += 1) {
        const date = new Date(monday)
        date.setUTCDate(date.getUTCDate() + (pair.day - 1) - 7 * (attWeeks - 1 - w))
        if (date >= today || date < termFrom || date > termTo) continue
        // Пара через неделю в «чужую» неделю не проводится — и отметок на ней нет.
        if (!heldOn(pair.weekType, date)) continue
        if (cancelled.has(`${pair.id}|${date.toISOString().slice(0, 10)}`)) continue
        for (const studentId of group.studentIds) {
          if (!activeOn(studentId, date)) continue
          const status = random.pickWeighted([
            ['PRESENT', 80],
            ['LATE', 10],
            ['ABSENT', 7],
            ['EXCUSED', 3],
          ])
          await writer.add('attendance', {
            id: `${pair.id}-att-${date.toISOString().slice(0, 10)}-${studentId}`,
            pairId: pair.id,
            studentId,
            date,
            status,
            note: status === 'EXCUSED' ? 'Справка от врача' : null,
            markedById: pair.teacherId,
          })
        }
      }
    }
  }

  // ── Экзамены и результаты ───────────────────────────────────────────────────
  for (const [ci, course] of courses.entries()) {
    const examId = child(course.id, 'ex')
    await writer.add('exam', {
      id: examId,
      courseId: course.id,
      groupId: course.group.id,
      createdById: course.teacherId,
      examinerId: course.teacherId,
      roomId: random.pick(rooms),
      // Прошлый семестр — экзамен уже прошёл, текущий — предстоит.
      date: course.current ? random.randomDate(10, 40) : random.randomDate(-160, -120),
      format: EXAM_FORMATS[ci % EXAM_FORMATS.length],
      maxScore: 100,
      note: random.chance(0.3) ? 'Разрешён один лист с формулами' : null,
    })
    for (const studentId of course.group.studentIds) {
      // Экзамен текущего семестра ещё не прошёл: результатов по нему быть не может.
      const status = course.current
        ? 'SCHEDULED'
        : random.pickWeighted([
            ['PASSED', 82],
            ['FAILED', 8],
            ['RETAKE', 6],
            // Неявка: балла нет, попытка не засчитана пересдачей.
            ['ABSENT', 4],
          ])
      const drawnAdmitted = random.chance(0.95)
      // Ушедший или в академе к сессии текущего семестра не допускается.
      const inactive = course.current && inactiveSince(studentId) !== null
      await writer.add('examResult', {
        id: child(examId, 'r', studentId),
        examId,
        studentId,
        admitted: drawnAdmitted && !inactive,
        status,
        score: status === 'PASSED' ? random.randInt(60, 100) : status === 'FAILED' ? random.randInt(20, 49) : null, // prettier-ignore
        attempt: status === 'RETAKE' ? 2 : 1,
        note: inactive
          ? 'Не допущен: не обучается (статус в учебных данных)'
          : status === 'RETAKE'
            ? 'Пересдача по графику кафедры'
            : status === 'ABSENT'
              ? 'Не явился на экзамен'
              : null,
      })
    }
  }

  // ── Консультации преподавателей ─────────────────────────────────────────────
  // Записываются только учащиеся: ушедший из вуза на консультацию не придёт.
  const allStudentIds = allGroups.flatMap((g) => g.studentIds).filter((sid) => !studentStatus.has(sid)) // prettier-ignore
  for (const [ti, teacherId] of allTeacherIds.entries()) {
    for (let s = 0; s < 3; s += 1) {
      const startsAt = random.randomDate(1, 14)
      startsAt.setUTCHours(10 + s, 0, 0, 0)
      const booked = s === 0 && random.chance(0.6)
      // Третий слот каждого четвёртого преподавателя отменён им самим после записи студента:
      // сервис ставит CANCELLED и оставляет студента и тему (студент получает уведомление).
      if (s === 2 && ti % 4 === 0) {
        await writer.add('consultationSlot', {
          id: child(teacherId, 'cons', s),
          teacherId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 45 * 60_000),
          location: `каб. ${random.randInt(100, 300)}`,
          isOnline: false,
          status: 'CANCELLED',
          studentId: random.pick(allStudentIds),
          topic: 'Разбор контрольной',
        })
        continue
      }
      await writer.add('consultationSlot', {
        id: child(teacherId, 'cons', s),
        teacherId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 45 * 60_000),
        location: `каб. ${random.randInt(100, 300)}`,
        isOnline: random.chance(0.3),
        status: booked ? 'BOOKED' : 'OPEN',
        studentId: booked ? random.pick(allStudentIds) : null,
        topic: booked ? random.pick(['Вопрос по курсовой', 'Разбор контрольной', 'Тема диплома']) : null, // prettier-ignore
      })
    }
  }

  // ── Записи в деканат ────────────────────────────────────────────────────────
  // По числу групп: очередь деканата должна быть непустой у каждого факультета. Статус — по
  // кругу (все пять из APPOINTMENT_STATUSES в каждом вузе). Время — как его оставляют
  // переходы сервиса: подтверждённая и перенесённая — приём впереди, завершённая — уже
  // прошёл, у перенесённой в заметке причина переноса.
  const deanOffices = structure.deanOffices ?? {}
  for (const [ai, group] of allGroups.entries()) {
    const status = APPOINTMENT_STATUSES[ai % APPOINTMENT_STATUSES.length]
    const office = deanOffices[group.facultyId]
    const cabinet = office ? `кабинет ${office.number}` : 'кабинет 210'
    const requestedAt =
      status === 'COMPLETED' ? random.randomDate(-21, -10) : random.randomDate(-14, -1)
    const scheduledAt =
      status === 'COMPLETED'
        ? new Date(requestedAt.getTime() + random.randInt(2, 7) * DAY_MS)
        : status === 'CONFIRMED' || status === 'RESCHEDULED'
          ? random.randomDate(1, 7)
          : null
    if (scheduledAt) scheduledAt.setUTCHours(random.pick([4, 5, 6, 9, 10]), 0, 0, 0)
    await writer.add('deaneryAppointment', {
      id: child(group.id, 'appt', ai % 3),
      studentId: random.pick(group.studentIds),
      facultyId: group.facultyId,
      // Ответственного ставит деканат подтверждением или переносом (appointments.service.ts).
      assignedToId: scheduledAt ? group.deanId : null,
      type: APPOINTMENT_TYPES[ai % APPOINTMENT_TYPES.length],
      status,
      topic: random.pick(APPOINTMENT_TOPICS),
      requestedAt,
      scheduledAt,
      staffNote:
        status === 'RESCHEDULED'
          ? `Декан на учёном совете — приём перенесён, ждём вас в деканате, ${cabinet}`
          : scheduledAt
            ? `Ожидаем вас в деканате, ${cabinet}`
            : null,
    })
  }

  await writer.flush()
  return { courses: courses.length, pairs: attPairIds.length }
}

export { ATT_WEEKS, TIMES }
