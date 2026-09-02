// Шаг «академика»: курсы, расписание, журнал оценок, задания, посещаемость, экзамены,
// консультации, записи в деканат, учебные материалы.
//
// Это самый тяжёлый шаг сида: посещаемость — это (пары × недели × студенты), то есть
// ~43 000 строк на вуз и ~4.3 млн на сто вузов. Поэтому строки не собираются в массивы,
// а сразу уходят в буферный writer, а даты считаются от текущей недели, чтобы окна
// дашбордов («последние 12 недель») не оказались пустыми через месяц после сида.

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

const ASSIGNMENT_TYPES = ['HOMEWORK', 'LAB', 'PROJECT', 'ESSAY']
const EXAM_FORMATS = ['WRITTEN', 'ORAL', 'TEST', 'PROJECT']
const APPOINTMENT_TOPICS = [
  'Вопрос по стипендии',
  'Академический отпуск',
  'Пересдача экзамена',
  'Справка об обучении',
  'Перевод на другую специальность',
  'Заселение в общежитие',
]

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
        name: `Осенний семестр ${new Date().getUTCFullYear()}/${(new Date().getUTCFullYear() + 1) % 100}`, // prettier-ignore
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
          weekType: 'BOTH',
        })
        group.pairs ??= []
        group.pairs.push({ id: pairId, day, teacherId })
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
  for (const [ci, group] of allGroups.entries()) {
    if (!group.pairs?.length) continue
    if (ci % 3 !== 0) continue
    const pair = random.pick(group.pairs)
    const type = changeTypes[ci % changeTypes.length]
    const [newStart, newEnd] = random.pick(TIMES)
    await writer.add('scheduleChange', {
      id: child(pair.id, 'chg', type.toLowerCase()),
      pairId: pair.id,
      type,
      // Дата в пределах ближайших двух недель: изменение должно быть «актуальным».
      date: new Date(monday.getTime() + (pair.day - 1 + random.randInt(0, 13)) * 86_400_000),
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
  for (const course of courses) {
    for (const [ki, [kind, title, maxScore]] of GRADE_COLUMNS.entries()) {
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
        const hasScore = course.current ? random.chance(0.85) : random.chance(0.98)
        await writer.add('grade', {
          id: child(columnId, 'g', studentId),
          columnId,
          studentId,
          score: hasScore ? Number((maxScore * (0.45 + random.rng() * 0.55)).toFixed(1)) : null,
        })
      }
    }
  }

  // ── Задания и сдачи (только текущий семестр) ────────────────────────────────
  for (const course of courses.filter((c) => c.current)) {
    for (let a = 0; a < 2; a += 1) {
      const assignmentId = child(course.id, 'as', a)
      await writer.add('assignment', {
        id: assignmentId,
        courseId: course.id,
        createdById: course.teacherId,
        title: `${course.subject.name}: задание ${a + 1}`,
        description: 'Выполните задание и приложите решение или ссылку на репозиторий.',
        type: random.pick(ASSIGNMENT_TYPES),
        submissionType: random.pick(['TEXT', 'TEXT', 'LINK', 'FILE']),
        status: 'PUBLISHED',
        maxScore: 100,
        maxAttempts: random.pick([1, 1, 2, 3]),
        allowLate: random.chance(0.5),
        publishAt: random.daysFromNow(-20 + a * 7),
        dueAt: random.daysFromNow(-5 + a * 10),
      })
      for (const studentId of course.group.studentIds) {
        if (!random.chance(0.8)) continue
        const graded = random.chance(0.7)
        await writer.add('submission', {
          id: child(assignmentId, 'sub', studentId),
          assignmentId,
          studentId,
          status: graded ? 'GRADED' : 'SUBMITTED',
          text: 'Решение прикреплено, комментарии в файле.',
          linkUrl: random.chance(0.3) ? 'https://github.com/example/homework' : null,
          attemptNumber: 1,
          score: graded ? random.randInt(50, 100) : null,
          feedback: graded ? random.pick(['Хорошая работа', 'Есть замечания по оформлению', 'Зачтено']) : null, // prettier-ignore
          gradedById: graded ? course.teacherId : null,
          submittedAt: random.daysFromNow(-random.randInt(1, 6)),
          gradedAt: graded ? random.daysFromNow(-random.randInt(0, 2)) : null,
        })
      }
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
  for (const group of allGroups) {
    for (const pair of (group.pairs ?? []).slice(0, 3)) {
      for (let w = 0; w < attWeeks; w += 1) {
        const date = new Date(monday)
        date.setUTCDate(date.getUTCDate() + (pair.day - 1) - 7 * (attWeeks - 1 - w))
        for (const studentId of group.studentIds) {
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
  for (const course of courses) {
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
      format: random.pick(EXAM_FORMATS),
      maxScore: 100,
      note: random.chance(0.3) ? 'Разрешён один лист с формулами' : null,
    })
    for (const studentId of course.group.studentIds) {
      const status = course.current
        ? random.pickWeighted([
            ['SCHEDULED', 70],
            ['PASSED', 20],
            ['FAILED', 5],
            ['RETAKE', 5],
          ])
        : random.pickWeighted([
            ['PASSED', 85],
            ['FAILED', 8],
            ['RETAKE', 7],
          ])
      await writer.add('examResult', {
        id: child(examId, 'r', studentId),
        examId,
        studentId,
        admitted: random.chance(0.95),
        status,
        score: status === 'PASSED' ? random.randInt(60, 100) : status === 'FAILED' ? random.randInt(20, 49) : null, // prettier-ignore
        attempt: status === 'RETAKE' ? 2 : 1,
        note: status === 'RETAKE' ? 'Пересдача по графику кафедры' : null,
      })
    }
  }

  // ── Консультации преподавателей ─────────────────────────────────────────────
  const allStudentIds = allGroups.flatMap((g) => g.studentIds)
  for (const teacherId of allTeacherIds) {
    for (let s = 0; s < 3; s += 1) {
      const startsAt = random.randomDate(1, 14)
      startsAt.setUTCHours(10 + s, 0, 0, 0)
      const booked = s === 0 && random.chance(0.6)
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
  // По числу групп: очередь деканата должна быть непустой у каждого факультета.
  for (const [ai, group] of allGroups.entries()) {
    const status = random.pickWeighted([
      ['REQUESTED', 35],
      ['CONFIRMED', 25],
      ['COMPLETED', 30],
      ['CANCELLED', 10],
    ])
    const scheduled = status === 'CONFIRMED' || status === 'COMPLETED'
    await writer.add('deaneryAppointment', {
      id: child(group.id, 'appt', ai % 3),
      studentId: random.pick(group.studentIds),
      facultyId: group.facultyId,
      assignedToId: group.deanId,
      type: random.pick(['CONSULTATION', 'DOCUMENT', 'ACADEMIC', 'OTHER']),
      status,
      topic: random.pick(APPOINTMENT_TOPICS),
      requestedAt: random.randomDate(-14, -1),
      scheduledAt: scheduled ? random.randomDate(1, 7) : null,
      staffNote: scheduled ? 'Ожидаем вас в деканате, кабинет 210' : null,
    })
  }

  // ── Учебные материалы ───────────────────────────────────────────────────────
  // Файлы к материалам добавит шаг медиа: здесь только метаданные и ссылка.
  for (const course of courses.filter((c) => c.current)) {
    await writer.add('material', {
      id: child(course.id, 'mat'),
      teacherId: course.teacherId,
      groupId: course.group.id,
      subject: course.subject.name,
      title: `Лекции: ${course.subject.name}`,
      description: 'Конспекты, слайды и список литературы по курсу.',
      url: 'https://materials.example.edu/course',
    })
  }

  await writer.flush()
  return { courses: courses.length, pairs: attPairIds.length }
}

export { ATT_WEEKS, TIMES }
