// Покрытие сценариев вуза: каждый вид уведомления, который шлёт API, и каждое действие
// журнала аудита — хотя бы по разу на вуз.
//
// Фоновые уведомления шага 70 — шесть типов с готовым текстом, без словарных ключей. Но
// колокольчик собирает строку по `titleKey`/`bodyKey`/`params` (словарь
// packages/shared-config/src/notification-messages.ts), и у каждого вида свой переход по
// `data.url`. Здесь — по строке на каждую статью словаря, которую реально отправляет
// какой-нибудь сервис API, получателю той роли, которой её шлёт сервис.
//
// Журнал аудита: раньше сид писал выдуманные действия (USER_LOGIN, INVITE_CREATED), которых
// API не пишет никогда, — фильтр по действию в журнале и счётчик «решено жалоб» на дашборде
// модератора (ищет `complaint_resolved`) их не видели. Здесь — настоящие имена действий и
// сущностей, как их пишут сервисы через AuditService.record.
//
// Вызывается из шага 75 (последним в нём): к этому моменту в базе есть всё, на что ссылаются
// `entityId` и `data` (заявки, отклики, выдачи книг).

import { child, id } from '../lib/ids.mjs'
import { makeRandom, SEED_BASE } from '../lib/rng.mjs'

const HOUR = 3_600_000

// Русские статьи словаря (RU в notification-messages.ts) — только те, что используются ниже.
// Текст в строке уведомления — уже отрисованный на языке получателя (у сида — ru).
const RU = {
  'friends.request.title': 'Новая заявка в друзья',
  'friends.request.body': '{name} хочет добавить вас в друзья',
  'friends.accepted.title': 'Заявка в друзья принята',
  'friends.accepted.body': 'Ваша заявка в друзья принята',
  'complaints.resolved.title': 'Жалоба рассмотрена',
  'complaints.dismissed.body': 'Ваша жалоба отклонена модератором',
  'complaints.acted.body': 'По вашей жалобе приняты меры',
  'schedule.changed.title': 'Изменение в расписании',
  'schedule.moved.body': '{subject}: перенос занятия на {date}',
  'schedule.roomChanged.body': '{subject}: смена аудитории на {date}',
  'schedule.cancelled.body': '{subject}: отмена занятия на {date}',
  'schedule.substituted.body': '{subject}: замена преподавателя на {date}',
  'schedule.movedRevoked.body': '{subject}: перенос на {date} отменён, занятие в обычное время',
  'schedule.roomChangedRevoked.body': '{subject}: смена аудитории на {date} отменена',
  'schedule.cancelledRevoked.body': '{subject}: занятие {date} состоится',
  'schedule.substitutedRevoked.body': '{subject}: замена преподавателя на {date} отменена',
  'moderation.warning.title': 'Предупреждение модератора',
  'moderation.warning.body':
    'Ваши материалы нарушают правила платформы. При повторном нарушении доступ будет ограничен.',
  'chats.request.title': 'Запрос на переписку',
  'chats.request.body': '{name} хочет вам написать',
  'chats.message.body': 'Новое сообщение',
  'chats.scheduledFailed.title': 'Отложенное сообщение не отправлено',
  'documents.request.title': 'Новый запрос документов',
  'documents.result.title': 'Результат проверки документов',
  'documents.replacement.title': 'Требуется замена документа',
  'documents.expired.title': 'Срок документа истёк',
  'documents.expiring.title': 'Документ скоро истекает',
  'documents.named.body': '«{title}»',
  'documents.shared.title': 'Вам открыт доступ к документу',
  'documents.shared.body': '{name}: «{title}»',
  'documents.submitted.title': 'Комплект документов сдан на проверку',
  'documents.submitted.body': '{name}: «{title}»',
  'applications.needsAction.title': 'Требуется ваше действие',
  'applications.needsAction.body': 'Заявка {number}: требуется исправление',
  'applications.preparing.title': 'Заявка в подготовке',
  'applications.preparing.body': 'Заявка {number}: началась подготовка',
  'applications.rejected.title': 'Заявка отклонена',
  'applications.rejected.body': 'Заявка {number} отклонена',
  'applications.readyPaper.title': 'Документ готов к выдаче',
  'applications.ready.title': 'Документ готов',
  'applications.ready.body': 'Заявка {number}: результат готов',
  'applications.issued.title': 'Документ выдан',
  'applications.issued.body': 'Заявка {number}: оригинал выдан',
  'applications.provided.title': 'Документ предоставлен',
  'applications.provided.body': 'Заявка {number}: электронный документ готов',
  'applications.replacement.title': 'Требуется замена документа',
  'applications.revoked.title': 'Справка отозвана',
  'applications.revoked.body': 'Заявка {number}: выданная справка больше не действительна',
  'applications.submitted.title': 'Новая заявка',
  'applications.submitted.body': 'Заявка {number} ждёт обработки',
  'applications.resubmitted.title': 'Заявка исправлена',
  'applications.resubmitted.body': 'Заявка {number} отправлена повторно',
  'applications.overdue.title': 'Просроченные заявки',
  'applications.overdue.body': 'Заявок с истёкшим сроком обработки: {count}',
  'assignments.published.title': 'Новое задание',
  'assignments.graded.title': 'Работа проверена',
  'assignments.returned.title': 'Работа возвращена на исправление',
  'assignments.course.body': '{subject}: {title}',
  'events.reminder.title': 'Скоро событие',
  'events.reminder.bodyAt': '«{title}» начнётся в {time}',
  'events.rescheduled.title': 'Событие перенесено',
  'events.rescheduled.body': '«{title}»: новое время — {date}',
  'events.cancelled.title': 'Событие отменено',
  'events.cancelled.body': '«{title}» не состоится',
  'comments.new.title': 'Новый комментарий',
  'comments.post.body': '{name} комментирует вашу публикацию',
  'comments.article.body': '{name} комментирует вашу статью',
  'comments.poll.body': '{name} комментирует ваш опрос',
  'comments.mention.title': 'Вас упомянули',
  'comments.mention.body': '{name} упоминает вас в комментарии',
  'stories.mention.title': 'Вас отметили в сторис',
  'stories.mention.body': '{name} отмечает вас в сторис',
  'consultations.cancelled.title': 'Консультация отменена',
  'consultations.booked.title': 'Новая запись на консультацию',
  'consultations.bookingCancelled.title': 'Запись на консультацию отменена',
  'appointments.confirmed.title': 'Запись в деканат подтверждена',
  'appointments.rescheduled.title': 'Запись в деканат перенесена',
  'appointments.completed.title': 'Приём в деканате завершён',
  'appointments.cancelled.title': 'Запись в деканат отменена',
  'appointments.requested.title': 'Новая запись в деканат',
  'exams.scheduled.title': 'Назначен экзамен',
  'exams.updated.title': 'Изменения по экзамену',
  'exams.cancelled.title': 'Экзамен отменён',
  'exams.result.title': 'Результат экзамена',
  'exams.course.body': '{subject}: {date}',
  'career.viewed.body': 'Компания посмотрела ваш отклик',
  'career.shortlisted.body': 'Вас добавили в шорт-лист',
  'career.interview.body': 'Вас пригласили на интервью',
  'career.offer.body': 'Вам сделали предложение',
  'career.hired.body': 'Вас приняли на работу',
  'career.rejected.body': 'По этому отклику отказ',
  'career.accessRequested.title': 'Заявка компании на допуск',
  'career.accessRequested.body': '{company} просит открыть доступ к студентам',
  'career.accessApproved.title': 'Допуск к студентам открыт',
  'career.accessRejected.title': 'Заявка на допуск отклонена',
  'career.accessRevoked.title': 'Допуск к студентам отозван',
  'career.accessExpired.title': 'Срок допуска к студентам истёк',
  'career.university.body': '{university}',
  'career.universityReason.body': '{university}: {reason}',
  'career.vacancyApproved.title': 'Вакансия одобрена',
  'career.vacancyRejected.title': 'Вакансия отклонена',
  'career.vacancy.body': '«{title}» — {university}',
  'career.vacancyReason.body': '«{title}» — {university}: {reason}',
  'career.newApplication.title': 'Новый отклик',
  'career.newApplication.body': 'Вакансия «{title}»',
  'library.loanIssued.title': 'Вы взяли книгу',
  'library.loanIssued.body': '«{title}», инв. {number}. Вернуть до {date}',
  'library.loanReturned.title': 'Книга возвращена',
  'library.loanRenewed.title': 'Срок продлён',
  'library.loanRenewed.body': '«{title}» — вернуть до {date}',
  'library.loanCancelled.title': 'Выдача отменена',
  'library.loanReturnCancelled.title': 'Возврат отменён — книга снова за вами',
  'library.loanDisputed.title': 'Читатель оспорил выдачу',
  'library.loanDisputed.body': '{name}: «{title}», инв. {number}',
  'library.dueSoon.title': 'Скоро вернуть книгу',
  'library.dueSoon.body': '«{title}» — вернуть до {date}',
  'library.dueToday.title': 'Сегодня вернуть книгу',
  'library.dueToday.body': '«{title}» — сегодня последний день',
  'library.overdue.title': 'Книга просрочена',
  'library.overdue.body':
    '«{title}» нужно было вернуть {date}. Пока книга не вернётся, новые выдачи и брони закрыты',
  'library.book.body': '«{title}»',
  'library.reservationReady.title': 'Бронь готова',
  'library.reservationReady.body': '«{title}» ждёт вас до {date}',
  'library.reservationExpired.title': 'Бронь истекла',
  'library.reservationCancelled.title': 'Бронь отменена',
  'library.debtorExpelled.title': 'Отчисление читателя-должника',
  'library.debtorExpelled.body': '{name}: книг не возвращено — {count}',
}

/** Строка статьи с подстановкой параметров — как renderNotificationMessage. */
export function renderRu(key, params = {}) {
  const template = RU[key]
  if (!template) throw new Error(`Нет статьи словаря уведомлений: ${key}`)
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
}

const day = (date) =>
  `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}` // prettier-ignore

/**
 * Каталог видов уведомлений вуза: [кому, тип, titleKey, bodyKey, params, url, title, body].
 * `title`/`body` — готовый текст там, где статьи словаря нет (имя отправителя, комментарий
 * сотрудника, время приёма): API кладёт такой текст без ключа.
 */
function notificationCatalog(v) {
  const book = { title: 'Абай жолы', number: 'BK-4821', date: v.inWeek }
  return [
    ['student', 'SYSTEM', 'friends.request.title', 'friends.request.body', { name: v.peerName }, v.peerUrl], // prettier-ignore
    ['student', 'SYSTEM', 'friends.accepted.title', 'friends.accepted.body', {}, v.peerUrl],
    ['student', 'SYSTEM', 'complaints.resolved.title', 'complaints.acted.body', {}, '/'],
    ['peer', 'SYSTEM', 'complaints.resolved.title', 'complaints.dismissed.body', {}, '/'],
    ['student', 'SCHEDULE_CHANGE', 'schedule.changed.title', 'schedule.moved.body', v.lesson, '/schedule'], // prettier-ignore
    ['student', 'SCHEDULE_CHANGE', 'schedule.changed.title', 'schedule.roomChanged.body', v.lesson, '/schedule'], // prettier-ignore
    ['student', 'SCHEDULE_CHANGE', 'schedule.changed.title', 'schedule.cancelled.body', v.lesson, '/schedule'], // prettier-ignore
    ['student', 'SCHEDULE_CHANGE', 'schedule.changed.title', 'schedule.substituted.body', v.lesson, '/schedule'], // prettier-ignore
    ['peer', 'SCHEDULE_CHANGE', 'schedule.changed.title', 'schedule.movedRevoked.body', v.lesson, '/schedule'], // prettier-ignore
    ['peer', 'SCHEDULE_CHANGE', 'schedule.changed.title', 'schedule.roomChangedRevoked.body', v.lesson, '/schedule'], // prettier-ignore
    ['peer', 'SCHEDULE_CHANGE', 'schedule.changed.title', 'schedule.cancelledRevoked.body', v.lesson, '/schedule'], // prettier-ignore
    ['peer', 'SCHEDULE_CHANGE', 'schedule.changed.title', 'schedule.substitutedRevoked.body', v.lesson, '/schedule'], // prettier-ignore
    ['peer', 'SYSTEM', 'moderation.warning.title', 'moderation.warning.body', {}, '/'],
    ['student', 'SYSTEM', 'chats.request.title', 'chats.request.body', { name: v.peerName }, '/chats'], // prettier-ignore
    // Сообщение: заголовок — имя отправителя (статьи нет), тело — нейтральное «Новое сообщение».
    ['student', 'MESSAGE', null, 'chats.message.body', null, '/chats', v.peerName],
    ['student', 'SYSTEM', 'chats.scheduledFailed.title', null, null, '/chats', null, ''],
    ['student', 'SYSTEM', 'documents.request.title', 'documents.named.body', { title: v.requestTitle }, '/documents?section=requests'], // prettier-ignore
    ['student', 'SYSTEM', 'documents.result.title', 'documents.named.body', { title: v.requestTitle }, '/documents?section=requests'], // prettier-ignore
    ['peer', 'SYSTEM', 'documents.replacement.title', 'documents.named.body', { title: v.requestTitle }, '/documents?section=requests'], // prettier-ignore
    ['student', 'SYSTEM', 'documents.expiring.title', 'documents.named.body', { title: 'Медицинская справка 086-У' }, '/documents'], // prettier-ignore
    ['peer', 'SYSTEM', 'documents.expired.title', 'documents.named.body', { title: 'Академическая справка' }, '/documents'], // prettier-ignore
    ['teacher', 'SYSTEM', 'documents.shared.title', 'documents.shared.body', { name: v.studentName, title: 'Паспорт' }, '/documents?section=shared'], // prettier-ignore
    ['dean', 'SYSTEM', 'documents.submitted.title', 'documents.submitted.body', { name: v.studentName, title: v.requestTitle }, '/documents?section=requests'], // prettier-ignore
    ['student', 'APP_UPDATE', 'applications.needsAction.title', 'applications.needsAction.body', { number: v.appNumber }, v.appUrl], // prettier-ignore
    ['student', 'APP_UPDATE', 'applications.preparing.title', 'applications.preparing.body', { number: v.appNumber }, v.appUrl], // prettier-ignore
    ['student', 'APP_UPDATE', 'applications.rejected.title', 'applications.rejected.body', { number: v.appNumber }, v.appUrl], // prettier-ignore
    ['student', 'APP_UPDATE', 'applications.readyPaper.title', 'applications.ready.body', { number: v.appNumber }, v.appUrl], // prettier-ignore
    ['student', 'APP_UPDATE', 'applications.ready.title', 'applications.ready.body', { number: v.appNumber }, v.appUrl], // prettier-ignore
    ['student', 'APP_UPDATE', 'applications.issued.title', 'applications.issued.body', { number: v.appNumber }, v.appUrl], // prettier-ignore
    ['student', 'APP_UPDATE', 'applications.provided.title', 'applications.provided.body', { number: v.appNumber }, v.appUrl], // prettier-ignore
    // Замена документа: тело — комментарий сотрудника, переводить нечем.
    ['student', 'APP_UPDATE', 'applications.replacement.title', null, null, v.appUrl, null, 'Приложите разворот с фотографией'], // prettier-ignore
    ['student', 'APP_UPDATE', 'applications.revoked.title', 'applications.revoked.body', { number: v.appNumber }, v.appUrl], // prettier-ignore
    ['dean', 'APP_UPDATE', 'applications.submitted.title', 'applications.submitted.body', { number: v.appNumber }, '/dean/applications'], // prettier-ignore
    ['dean', 'APP_UPDATE', 'applications.resubmitted.title', 'applications.resubmitted.body', { number: v.appNumber }, '/dean/applications'], // prettier-ignore
    ['admin', 'APP_UPDATE', 'applications.overdue.title', 'applications.overdue.body', { count: 3 }, '/university-admin/applications'], // prettier-ignore
    ['student', 'SYSTEM', 'assignments.published.title', 'assignments.course.body', v.assignment, '/assignments'], // prettier-ignore
    ['student', 'SYSTEM', 'assignments.graded.title', 'assignments.course.body', v.assignment, '/assignments'], // prettier-ignore
    ['peer', 'SYSTEM', 'assignments.returned.title', 'assignments.course.body', v.assignment, '/assignments'], // prettier-ignore
    ['student', 'EVENT', 'events.reminder.title', 'events.reminder.bodyAt', { title: v.eventTitle, time: '15:00' }, '/events'], // prettier-ignore
    ['student', 'EVENT', 'events.rescheduled.title', 'events.rescheduled.body', { title: v.eventTitle, date: v.inWeek }, '/events'], // prettier-ignore
    ['peer', 'EVENT', 'events.cancelled.title', 'events.cancelled.body', { title: v.eventTitle }, '/events'], // prettier-ignore
    ['student', 'POST', 'comments.new.title', 'comments.post.body', { name: v.peerName }, '/'],
    ['student', 'POST', 'comments.new.title', 'comments.article.body', { name: v.peerName }, '/'],
    ['student', 'POST', 'comments.new.title', 'comments.poll.body', { name: v.peerName }, '/'],
    ['student', 'POST', 'comments.mention.title', 'comments.mention.body', { name: v.peerName }, '/'], // prettier-ignore
    ['student', 'POST', 'stories.mention.title', 'stories.mention.body', { name: v.peerName }, '/'],
    // Консультации и деканат: тело — время записи строкой (localDateTimeLabel), без статьи.
    ['student', 'SYSTEM', 'consultations.cancelled.title', null, null, '/consultations', null, `${v.inWeek}, 14:00`], // prettier-ignore
    ['teacher', 'SYSTEM', 'consultations.booked.title', null, null, '/teacher/consultations', null, `${v.studentName}, ${v.inWeek} 14:00`], // prettier-ignore
    ['teacher', 'SYSTEM', 'consultations.bookingCancelled.title', null, null, '/teacher/consultations', null, `${v.studentName}, ${v.inWeek} 14:00`], // prettier-ignore
    ['dean', 'SYSTEM', 'appointments.requested.title', null, null, '/dean/appointments', null, `${v.inWeek}, 11:30`], // prettier-ignore
    ['student', 'SYSTEM', 'appointments.confirmed.title', null, null, '/appointments', null, `${v.inWeek}, 11:30`], // prettier-ignore
    ['student', 'SYSTEM', 'appointments.rescheduled.title', null, null, '/appointments', null, `${v.inWeek}, 15:00`], // prettier-ignore
    ['peer', 'SYSTEM', 'appointments.completed.title', null, null, '/appointments', null, `${v.lastWeek}, 10:00`], // prettier-ignore
    ['peer', 'SYSTEM', 'appointments.cancelled.title', null, null, '/appointments', null, `${v.inWeek}, 12:00`], // prettier-ignore
    ['student', 'SCHEDULE_CHANGE', 'exams.scheduled.title', 'exams.course.body', v.exam, '/exams'],
    ['student', 'SCHEDULE_CHANGE', 'exams.updated.title', 'exams.course.body', v.exam, '/exams'],
    ['peer', 'SCHEDULE_CHANGE', 'exams.cancelled.title', 'exams.course.body', v.exam, '/exams'],
    ['student', 'SYSTEM', 'exams.result.title', 'exams.course.body', v.exam, '/exams'],
    // Отклик: заголовок — название вакансии (его пишет работодатель), тело — по статусу.
    ...['viewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'].map((s) => ['student', 'APP_UPDATE', null, `career.${s}.body`, null, '/career/applications', v.vacancyTitle]), // prettier-ignore
    ['admin', 'APP_UPDATE', 'career.accessRequested.title', 'career.accessRequested.body', { company: v.companyName }, '/career/companies'], // prettier-ignore
    ['student', 'SYSTEM', 'library.loanIssued.title', 'library.loanIssued.body', book, '/my-books'],
    ['student', 'SYSTEM', 'library.loanReturned.title', 'library.book.body', book, '/my-books'],
    ['student', 'SYSTEM', 'library.loanRenewed.title', 'library.loanRenewed.body', book, '/my-books'], // prettier-ignore
    ['peer', 'SYSTEM', 'library.loanCancelled.title', 'library.book.body', book, '/my-books'],
    ['peer', 'SYSTEM', 'library.loanReturnCancelled.title', 'library.loanRenewed.body', book, '/my-books'], // prettier-ignore
    ['librarian', 'SYSTEM', 'library.loanDisputed.title', 'library.loanDisputed.body', { ...book, name: v.studentName }, '/library/loans'], // prettier-ignore
    ['student', 'SYSTEM', 'library.dueSoon.title', 'library.dueSoon.body', book, '/my-books'],
    ['student', 'SYSTEM', 'library.dueToday.title', 'library.dueToday.body', book, '/my-books'],
    ['peer', 'SYSTEM', 'library.overdue.title', 'library.overdue.body', { ...book, date: v.lastWeek }, '/my-books'], // prettier-ignore
    ['student', 'SYSTEM', 'library.reservationReady.title', 'library.reservationReady.body', book, '/my-books'], // prettier-ignore
    ['peer', 'SYSTEM', 'library.reservationExpired.title', 'library.book.body', book, '/my-books'],
    ['peer', 'SYSTEM', 'library.reservationCancelled.title', 'library.book.body', book, '/my-books'], // prettier-ignore
    ['librarian', 'SYSTEM', 'library.debtorExpelled.title', 'library.debtorExpelled.body', { name: v.peerName, count: 2 }, '/library/loans'], // prettier-ignore
  ]
}

const fullName = (u) => (u ? `${u.lastName} ${u.firstName}`.trim() : '')

export async function seedNotificationCoverage(prisma, writer, ctx) {
  const { index, structure, people, companies } = ctx
  const random = makeRandom(SEED_BASE + index * 7919 + 76)
  const faculty = people.faculties[0]
  const group = faculty.groups[0]
  const recipients = {
    // Не староста (studentIds[0]): у старосты своя очередь, а это витрина обычного студента.
    student: group.studentIds[1] ?? group.studentIds[0],
    peer: group.studentIds[2] ?? group.studentIds[0],
    teacher: faculty.teacherIds[0],
    dean: faculty.deanId,
    admin: people.adminId,
    librarian: people.librarianIds?.[0] ?? people.adminId,
  }
  const users = await prisma.user.findMany({
    where: { id: { in: [recipients.student, recipients.peer] } },
    select: { id: true, firstName: true, lastName: true },
    take: 2,
  })
  const byId = new Map(users.map((u) => [u.id, u]))
  // Заявка студента-витрины — настоящая (шаг 70), на неё ведёт ссылка уведомления.
  const app = await prisma.application.findFirst({
    where: { studentId: recipients.student },
    select: { id: true, number: true },
  })
  const vacancy = companies?.find((c) => c.vacancyIds?.length)
  const v = {
    studentName: fullName(byId.get(recipients.student)),
    peerName: fullName(byId.get(recipients.peer)),
    requestTitle: 'Комплект документов на новый учебный год',
    appNumber: app?.number ?? `${structure.uniId}-000000`,
    appUrl: app ? `/applications/${app.id}` : '/applications',
    lesson: { subject: 'Математический анализ', date: day(random.daysFromNow(2)) },
    assignment: { subject: 'Математический анализ', title: 'Домашняя работа №3' },
    exam: { subject: 'Математический анализ', date: day(random.daysFromNow(14)) },
    eventTitle: 'День открытых дверей',
    inWeek: day(random.daysFromNow(7)),
    lastWeek: day(random.daysFromNow(-7)),
    peerUrl: `/profile/${recipients.peer}`,
    vacancyTitle: 'Стажёр-разработчик',
    companyName: vacancy?.name ?? 'Kaspi Lab',
  }

  for (const [ni, entry] of notificationCatalog(v).entries()) {
    const [who, type, titleKey, bodyKey, params, url, title, body] = entry
    const userId = recipients[who]
    if (!userId) continue
    const createdAt = random.randomDate(-20, 0)
    // Половина прочитана: в колокольчике видны оба состояния каждого вида.
    const isRead = ni % 2 === 1
    const slug = `${titleKey ?? 'raw'}-${bodyKey ?? 'raw'}`.replace(/[^a-zA-Z0-9]+/g, '-')
    await writer.add('notification', {
      id: child(userId, 'ntfc', slug),
      userId,
      type,
      title: titleKey ? renderRu(titleKey, params ?? {}) : (title ?? ''),
      body: bodyKey ? renderRu(bodyKey, params ?? {}) : (body ?? ''),
      titleKey,
      bodyKey,
      ...(params && Object.keys(params).length > 0 ? { params } : {}),
      data: { url },
      isRead,
      readAt: isRead ? new Date(Math.min(Date.now(), createdAt.getTime() + HOUR)) : null,
      dedupeKey: `seed:cov:${slug}`,
      createdAt,
    })
  }
}

/**
 * Уведомления стороны компании (решения вуза по допуску и вакансиям, новые отклики).
 * Компания — общая для платформы, поэтому строки — у её владельца, а id от компании, а не от
 * вуза: вуз, которому досталась та же компания, ничего не задвоит.
 */
export async function seedCompanyNotifications(writer, { company, universityName, vacancyTitle }) {
  const ownerId = company.recruiterIds?.[0]
  if (!ownerId) return
  const u = { university: universityName }
  const reason = 'Нет подтверждения деятельности компании'
  const vac = { title: vacancyTitle, university: universityName }
  const list = [
    ['career.accessApproved.title', 'career.university.body', u],
    ['career.accessRejected.title', 'career.universityReason.body', { ...u, reason }],
    ['career.accessRevoked.title', 'career.university.body', u],
    ['career.accessExpired.title', 'career.university.body', u],
    ['career.vacancyApproved.title', 'career.vacancy.body', vac],
    ['career.vacancyRejected.title', 'career.vacancyReason.body', { ...vac, reason: 'Требования не соответствуют уровню студентов' }], // prettier-ignore
    ['career.newApplication.title', 'career.newApplication.body', { title: vacancyTitle }],
  ]
  for (const [ni, [titleKey, bodyKey, params]] of list.entries()) {
    const slug = `${titleKey}-${bodyKey}`.replace(/[^a-zA-Z0-9]+/g, '-')
    const createdAt = new Date(Date.now() - (ni + 1) * 26 * HOUR)
    await writer.add('notification', {
      id: `${company.id}-ntfc-${slug}`,
      userId: ownerId,
      type: 'APP_UPDATE',
      title: renderRu(titleKey, params),
      body: renderRu(bodyKey, params),
      titleKey,
      bodyKey,
      params,
      data: { url: titleKey.includes('vacancy') ? '/employer/vacancies' : titleKey.includes('newApplication') ? '/employer/candidates' : '/employer/access' }, // prettier-ignore
      isRead: ni % 2 === 1,
      readAt: ni % 2 === 1 ? createdAt : null,
      dedupeKey: `seed:cov:${slug}`,
      createdAt,
    })
  }
}

/**
 * Журнал аудита вуза: настоящие действия сервисов (AuditService.record), по разу каждое.
 * [действие, сущность, кто (ключ роли), id сущности, metadata].
 */
function auditCatalog(r) {
  return [
    ['login', null, 'student', null, { method: 'password' }],
    ['logout', null, 'student', null, null],
    ['register_by_invite', 'User', 'student', r.student, { role: 'STUDENT' }],
    ['password_changed', 'User', 'teacher', r.teacher, null],
    ['password_reset_requested', 'User', 'peer', r.peer, null],
    ['password_reset', 'User', 'peer', r.peer, null],
    ['2fa_enabled', 'User', 'admin', r.admin, null],
    ['2fa_backup_codes_regenerated', 'User', 'admin', r.admin, null],
    ['2fa_disabled', 'User', 'dean', r.dean, null],
    ['consent_accepted', 'User', 'student', r.student, null],
    ['change_username', 'User', 'student', r.student, null],
    ['invite_created', 'Invite', 'admin', r.invite, { role: 'STUDENT' }],
    ['invite_bulk_created', 'Invite', 'admin', null, { count: 25 }],
    ['invite_revoked', 'Invite', 'admin', r.invite, null],
    ['invites_expired', 'Invite', null, null, { count: 2 }],
    ['faculty_updated', 'Faculty', 'admin', r.faculty, null],
    ['group_created', 'Group', 'dean', r.group, null],
    ['group_updated', 'Group', 'dean', r.group, null],
    ['specialty_created', 'Specialty', 'dean', null, null],
    ['subject_updated', 'Subject', 'dean', null, null],
    ['term_created', 'Term', 'admin', null, null],
    ['room_created', 'Room', 'admin', null, null],
    ['room_qr_issued', 'Room', 'admin', null, null],
    ['room_qr_rotated', 'Room', 'admin', null, null],
    ['schedule_updated', 'Schedule', 'dean', null, null],
    ['pair_created', 'Pair', 'dean', null, null],
    ['pair_deleted', 'Pair', 'dean', null, null],
    ['schedule_change_created', 'ScheduleChange', 'dean', null, { type: 'MOVED' }],
    ['schedule_change_deleted', 'ScheduleChange', 'dean', null, null],
    ['course_updated', 'Course', 'teacher', null, null],
    ['attendance_marked', 'Attendance', 'teacher', null, { count: 24 }],
    ['attendance_self_checkin', 'Attendance', 'student', null, null],
    ['grade_column_created', 'GradeColumn', 'teacher', null, null],
    ['grades_saved', 'GradeColumn', 'teacher', null, { count: 24 }],
    ['assignment_created', 'Assignment', 'teacher', null, null],
    ['submission_returned', 'Submission', 'teacher', null, null],
    ['exam_created', 'Exam', 'dean', null, null],
    ['exam_results_set', 'Exam', 'teacher', null, { count: 24 }],
    ['consultation_slot_created', 'ConsultationSlot', 'teacher', null, null],
    ['consultation_booked', 'ConsultationSlot', 'student', null, null],
    ['consultation_cancelled_by_teacher', 'ConsultationSlot', 'teacher', null, null],
    ['appointment_created', 'Appointment', 'student', null, null],
    ['appointment_cancelled_by_student', 'Appointment', 'student', null, null],
    ['material_created', 'Material', 'teacher', null, null],
    ['material_file_added', 'Material', 'teacher', null, null],
    ['material_deleted', 'Material', 'teacher', null, null],
    ['post_created', 'Post', 'admin', r.post, null],
    ['post_published', 'Post', 'admin', r.post, null],
    ['post_updated', 'Post', 'admin', r.post, null],
    ['post_deleted', 'Post', 'moderator', r.post, null],
    ['comment_deleted', 'Comment', 'moderator', null, null],
    ['event_created', 'Event', 'admin', r.event, null],
    ['event_updated', 'Event', 'admin', r.event, null],
    ['story_created', 'Story', 'student', null, null],
    ['story_deleted', 'Story', 'moderator', null, null],
    ['portfolio_item_created', 'PortfolioItem', 'student', null, null],
    ['complaint_created', 'Complaint', 'peer', r.complaint, null],
    ['complaint_taken', 'Complaint', 'moderator', r.complaint, null],
    ['complaint_resolved', 'Complaint', 'moderator', r.complaint, { action: 'WARN_USER' }],
    ['complaint_reopened', 'Complaint', 'moderator', r.complaint, null],
    ['moderator_chat_access', 'Chat', 'moderator', null, null],
    ['user_warned', 'User', 'moderator', r.peer, null],
    ['user_role_changed', 'User', 'admin', r.peer, { from: 'STUDENT', to: 'STAROSTA' }],
    ['user_academic_updated', 'User', 'dean', r.peer, null],
    ['user_sessions_revoked', 'User', 'admin', r.peer, null],
    ['user_2fa_reset', 'User', 'admin', r.dean, null],
    ['users_export', 'User', 'admin', null, { rows: 120 }],
    ['personal_data_export', 'User', 'student', r.student, { rows: 340 }],
    ['PROFILE_VIEW_PRIVATE', 'User', 'admin', r.student, null],
    ['student_id_verified', 'User', 'student', r.student, null],
    ['DOCUMENT_TYPE_CREATE', 'DocumentType', 'admin', null, { typeId: 'PRACTICE_REPORT' }],
    ['DOCUMENT_TYPE_UPDATE', 'DocumentType', 'admin', null, { typeId: 'MEDICAL' }],
    ['DOCUMENT_TYPE_DELETE', 'DocumentType', 'admin', null, { typeId: 'DIPLOMA_SUPPLEMENT' }],
    ['application_service_created', 'ApplicationService', 'admin', null, null],
    ['application_service_customized', 'ApplicationService', 'admin', null, null],
    ['application_service_updated', 'ApplicationService', 'admin', null, null],
    ['document_template_created', 'DocumentTemplate', 'admin', null, null],
    ['document_template_updated', 'DocumentTemplate', 'admin', null, null],
    ['document_template_archived', 'DocumentTemplate', 'admin', null, { generations: 3 }],
    ['onboarding_profile_confirmed', 'University', 'admin', r.university, null],
    ['onboarding_step_skipped', 'University', 'admin', r.university, { step: 'rooms' }],
    ['university_launched', 'University', 'admin', r.university, null],
    ['university_updated', 'University', 'admin', r.university, null],
    ['analytics_report_export', null, 'admin', null, { format: 'xlsx' }],
    ['career_report_export', 'University', 'admin', r.university, { format: 'xlsx' }],
    ['company_access_approved', 'CompanyUniversityAccess', 'admin', null, null],
    ['company_access_rejected', 'CompanyUniversityAccess', 'admin', null, null],
    ['company_access_revoked', 'CompanyUniversityAccess', 'admin', null, null],
    ['vacancy_review_approved', 'Vacancy', 'admin', null, null],
    ['vacancy_review_rejected', 'Vacancy', 'admin', null, null],
    ['career_visibility_changed', 'CareerProfile', 'student', null, { visibility: 'EMPLOYERS' }],
    ['career_profile_shared', 'CareerProfileGrant', 'student', null, null],
    ['career_profile_unshared', 'CareerProfileGrant', 'student', null, null],
    ['career_application_created', 'CareerApplication', 'student', null, null],
    ['career_application_withdrawn', 'CareerApplication', 'student', null, null],
    ['library_book_created', 'Book', 'librarian', null, null],
    ['library_copies_added', 'Book', 'librarian', null, { count: 3 }],
    ['library_loan_issued', 'Loan', 'librarian', null, null],
    ['library_loan_returned', 'Loan', 'librarian', null, null],
    ['library_loan_renewed', 'Loan', 'librarian', null, null],
    ['library_loan_lost', 'Loan', 'librarian', null, null],
    ['library_loan_disputed', 'Loan', 'student', null, null],
    ['library_reservation_created', 'Reservation', 'student', null, null],
    ['library_clearance_issued', 'DocumentExport', 'student', null, null],
    ['library_clearance_revoked', 'DocumentExport', 'librarian', null, null],
    ['camera_created', 'Camera', 'admin', null, null],
    ['campus_published', 'Campus', 'admin', null, null],
  ]
}

export async function seedAuditCoverage(prisma, writer, ctx) {
  const { index, structure, people } = ctx
  const random = makeRandom(SEED_BASE + index * 7919 + 77)
  const { uniId } = structure
  const faculty = people.faculties[0]
  const group = faculty.groups[0]
  const actors = {
    student: group.studentIds[1] ?? group.studentIds[0],
    peer: group.studentIds[2] ?? group.studentIds[0],
    teacher: faculty.teacherIds[0],
    dean: faculty.deanId,
    admin: people.adminId,
    moderator: people.moderatorIds[0] ?? people.adminId,
    librarian: people.librarianIds?.[0] ?? people.adminId,
  }
  const refs = {
    ...actors,
    university: uniId,
    faculty: faculty.id,
    group: group.id,
    invite: id(index, 'inv', 0),
    post: id(index, 'post', 'uni', 0),
    complaint: id(index, 'cmp', 0),
    event: id(index, 'ev', 'career'),
  }
  // Браузеры — для колонки «устройство»: журнал входа без них выглядит как от одного робота.
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    'StudentHub/1.4.0 (Android 14)',
  ]
  for (const [ai, [action, entity, who, entityId, metadata]] of auditCatalog(refs).entries()) {
    await writer.add('auditLog', {
      id: id(index, 'audit', action.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
      userId: who ? actors[who] : null,
      action,
      entity,
      entityId,
      ...(metadata ? { metadata } : {}),
      // Системные записи (крон) — без адреса и браузера, как их пишет cleanup.service.
      ip: who ? `10.${index % 255}.${ai % 255}.${((ai * 7) % 250) + 1}` : null,
      userAgent: who ? agents[ai % agents.length] : null,
      createdAt: random.randomDate(-60, 0),
    })
  }
}
