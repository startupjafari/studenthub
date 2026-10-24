// Словарь уведомлений — один на api и веб.
//
// ПОЧЕМУ НЕ В apps/web/messages/*.json, где лежит остальной перевод интерфейса.
// Одна и та же строка уведомления должна отрисоваться в двух местах: на сервере, когда
// уходит web push или письмо-зеркало офлайн-получателю, и в браузере, когда человек
// открывает колокольчик. Каталоги next-intl живут только в вебе — на стороне api их нет
// вовсе, и дублировать тексты в двух местах означало бы, что рано или поздно они разойдутся
// и пользователь получит push с одним текстом, а в списке увидит другой.
//
// ПОЧЕМУ КЛЮЧ ХРАНИТСЯ В БАЗЕ. Человек меняет язык в настройках и ожидает увидеть на новом
// языке и те уведомления, что пришли вчера. Для этого в `Notification` рядом с отрисованным
// текстом лежат `titleKey`/`bodyKey`/`params`, и клиент предпочитает собрать строку заново.
// Отрисованный текст при этом нужен сам по себе: push и письмо отправляются с сервера и
// требуют готовую строку.
//
// ЧЕГО ЗДЕСЬ НЕТ. Строк, у которых нет словарной статьи в принципе: имя отправителя в
// заголовке уведомления о сообщении, превью самого сообщения, комментарий сотрудника при
// возврате документа. Переводить пользовательский ввод нечем, и для них `titleKey`/`bodyKey`
// остаются пустыми — клиент показывает сохранённый текст как есть.

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from './constants.js'

/** Подстановки в сообщение: `{name}`, `{number}` и т.п. */
export type NotificationParams = Record<string, string | number>

/**
 * Статьи словаря. Ключ — `домен.событие.часть`, значение — строка с подстановками в
 * фигурных скобках. Плоская карта, а не дерево: ключ лежит в колонке базы, и плоский
 * вид означает, что в базе и в словаре он выглядит одинаково.
 */
const RU = {
  'friends.request.title': 'Новая заявка в друзья',
  'friends.request.body': '{name} хочет добавить вас в друзья',
  'friends.accepted.title': 'Заявка в друзья принята',
  'friends.accepted.body': 'Ваша заявка в друзья принята',

  'complaints.resolved.title': 'Жалоба рассмотрена',
  'complaints.dismissed.body': 'Ваша жалоба отклонена модератором',
  'complaints.acted.body': 'По вашей жалобе приняты меры',

  'schedule.changed.title': 'Изменение в расписании',
  'schedule.changed.body': '{subject}: {change} на {date}',
  // Своя статья на тип изменения: прежняя `{change}` приходила готовой русской строкой и
  // в kk/en (старые уведомления по-прежнему собираются по `schedule.changed.body`).
  'schedule.moved.body': '{subject}: перенос занятия на {date}',
  'schedule.roomChanged.body': '{subject}: смена аудитории на {date}',
  'schedule.cancelled.body': '{subject}: отмена занятия на {date}',
  'schedule.substituted.body': '{subject}: замена преподавателя на {date}',
  // Деканат убрал ошибочное изменение (C-F16).
  'schedule.movedRevoked.body': '{subject}: перенос на {date} отменён, занятие в обычное время',
  'schedule.roomChangedRevoked.body': '{subject}: смена аудитории на {date} отменена',
  'schedule.cancelledRevoked.body': '{subject}: занятие {date} состоится',
  'schedule.substitutedRevoked.body': '{subject}: замена преподавателя на {date} отменена',

  'moderation.warning.title': 'Предупреждение модератора',
  'moderation.warning.body':
    'Ваши материалы нарушают правила платформы. При повторном нарушении доступ будет ограничен.',

  'chats.request.title': 'Запрос на переписку',
  'chats.request.body': '{name} хочет вам написать',
  // Текст сообщения в уведомление не подставляется (docs/PERSONAL_DATA.md §3): оно уходит
  // в push-сервисы и почтовому провайдеру и живёт в истории уведомлений дольше сообщения.
  'chats.message.body': 'Новое сообщение',
  'chats.scheduledFailed.title': 'Отложенное сообщение не отправлено',

  'documents.request.title': 'Новый запрос документов',
  'documents.result.title': 'Результат проверки документов',
  // Результат проверки комплекта с отклонёнными позициями: документ нужно заменить.
  'documents.replacement.title': 'Требуется замена документа',
  'documents.expired.title': 'Срок документа истёк',
  'documents.expiring.title': 'Документ скоро истекает',
  'documents.named.body': '«{title}»',
  // Владелец открыл документ получателю (грант «пользователь» или «деканат факультета»).
  'documents.shared.title': 'Вам открыт доступ к документу',
  'documents.shared.body': '{name}: «{title}»',
  // Автору запроса документов: студент отправил комплект на проверку.
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
  // Студенту: выданная по заявке справка отозвана — в кабинете она помечена «Отклонён».
  'applications.revoked.title': 'Справка отозвана',
  'applications.revoked.body': 'Заявка {number}: выданная справка больше не действительна',
  // Обработчикам заявок (деканат, администрация вуза): новая и исправленная заявка, сводка
  // просроченных по сроку обработки.
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
  'events.reminder.body': '«{title}» начнётся примерно через час',
  // Время начала, а не «через час»: окно напоминаний (now, now+70м] ловит и события через
  // десять минут — созданные или перенесённые поздно, пропущенный тик крона. Прежний
  // `events.reminder.body` остаётся для уже сохранённых уведомлений.
  'events.reminder.bodyAt': '«{title}» начнётся в {time}',
  // Участникам: организатор перенёс или отменил событие.
  'events.rescheduled.title': 'Событие перенесено',
  'events.rescheduled.body': '«{title}»: новое время — {date}',
  'events.cancelled.title': 'Событие отменено',
  'events.cancelled.body': '«{title}» не состоится',

  // Комментарии: автору публикации, статьи или опроса — о новом комментарии; упомянутому
  // через @логин — об упоминании. Текст комментария в уведомление не кладём: это
  // пользовательский ввод, и он виден по переходу.
  'comments.new.title': 'Новый комментарий',
  'comments.post.body': '{name} комментирует вашу публикацию',
  'comments.article.body': '{name} комментирует вашу статью',
  'comments.poll.body': '{name} комментирует ваш опрос',
  'comments.mention.title': 'Вас упомянули',
  'comments.mention.body': '{name} упоминает вас в комментарии',

  'consultations.cancelled.title': 'Консультация отменена',
  'consultations.booked.title': 'Новая запись на консультацию',
  'consultations.bookingCancelled.title': 'Запись на консультацию отменена',

  'appointments.confirmed.title': 'Запись в деканат подтверждена',
  'appointments.rescheduled.title': 'Запись в деканат перенесена',
  'appointments.completed.title': 'Приём в деканате завершён',
  'appointments.cancelled.title': 'Запись в деканат отменена',
  // Сотрудникам деканата: студент записался на приём (тело — желаемое время).
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
  // Карьерный центр вуза (администрация): компания просит допуск к студентам.
  'career.accessRequested.title': 'Заявка компании на допуск',
  'career.accessRequested.body': '{company} просит открыть доступ к студентам',
  // Компании: решение вуза по допуску. Тело — вуз, с причиной, если её указали.
  'career.accessApproved.title': 'Допуск к студентам открыт',
  'career.accessRejected.title': 'Заявка на допуск отклонена',
  'career.accessRevoked.title': 'Допуск к студентам отозван',
  'career.accessExpired.title': 'Срок допуска к студентам истёк',
  'career.university.body': '{university}',
  'career.universityReason.body': '{university}: {reason}',
  // Компании: решение вуза по вакансии.
  'career.vacancyApproved.title': 'Вакансия одобрена',
  'career.vacancyRejected.title': 'Вакансия отклонена',
  'career.vacancy.body': '«{title}» — {university}',
  'career.vacancyReason.body': '«{title}» — {university}: {reason}',
  // Компании: новый отклик (свёрнутое — одна строка на вакансию).
  'career.newApplication.title': 'Новый отклик',
  'career.newApplication.body': 'Вакансия «{title}»',

  // Библиотека (Фаза 20). Дата — «ДД.ММ.ГГГГ» по часам вуза.
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
} as const

/** Ключ словарной статьи. Тип выводится из русского каталога — он и есть эталон состава. */
export type NotificationMessageKey = keyof typeof RU

const KK: Record<NotificationMessageKey, string> = {
  'friends.request.title': 'Жаңа достық сұрауы',
  'friends.request.body': '{name} сізді достарына қосқысы келеді',
  'friends.accepted.title': 'Достық сұрауы қабылданды',
  'friends.accepted.body': 'Сіздің достық сұрауыңыз қабылданды',

  'complaints.resolved.title': 'Шағым қаралды',
  'complaints.dismissed.body': 'Шағымыңызды модератор қабылдамады',
  'complaints.acted.body': 'Шағымыңыз бойынша шаралар қабылданды',

  'schedule.changed.title': 'Сабақ кестесіндегі өзгеріс',
  'schedule.changed.body': '{subject}: {date} күніне {change}',
  'schedule.moved.body': '{subject}: {date} күнгі сабақ ауыстырылды',
  'schedule.roomChanged.body': '{subject}: {date} күні аудитория ауыстырылды',
  'schedule.cancelled.body': '{subject}: {date} күнгі сабақ болмайды',
  'schedule.substituted.body': '{subject}: {date} күні оқытушы ауыстырылды',
  'schedule.movedRevoked.body':
    '{subject}: {date} күнгі ауыстыру болдырылмады, сабақ әдеттегі уақытта',
  'schedule.roomChangedRevoked.body': '{subject}: {date} күнгі аудитория ауыстыру болдырылмады',
  'schedule.cancelledRevoked.body': '{subject}: {date} күнгі сабақ өтеді',
  'schedule.substitutedRevoked.body': '{subject}: {date} күнгі оқытушы ауыстыру болдырылмады',

  'moderation.warning.title': 'Модератор ескертуі',
  'moderation.warning.body':
    'Материалдарыңыз платформа ережелерін бұзады. Қайта бұзған жағдайда қолжетімділік шектеледі.',

  'chats.request.title': 'Хат алмасу сұрауы',
  'chats.request.body': '{name} сізге жазғысы келеді',
  'chats.message.body': 'Жаңа хабарлама',
  'chats.scheduledFailed.title': 'Кейінге қалдырылған хабарлама жіберілмеді',

  'documents.request.title': 'Жаңа құжат сұрауы',
  'documents.result.title': 'Құжаттарды тексеру нәтижесі',
  'documents.replacement.title': 'Құжатты ауыстыру қажет',
  'documents.expired.title': 'Құжаттың мерзімі өтті',
  'documents.expiring.title': 'Құжаттың мерзімі жақында бітеді',
  'documents.named.body': '«{title}»',
  'documents.shared.title': 'Сізге құжатқа қолжетімділік ашылды',
  'documents.shared.body': '{name}: «{title}»',
  'documents.submitted.title': 'Құжаттар жиынтығы тексеруге тапсырылды',
  'documents.submitted.body': '{name}: «{title}»',

  'applications.needsAction.title': 'Сіздің әрекетіңіз қажет',
  'applications.needsAction.body': '{number} өтініші: түзету қажет',
  'applications.preparing.title': 'Өтініш дайындалуда',
  'applications.preparing.body': '{number} өтініші: дайындық басталды',
  'applications.rejected.title': 'Өтініш қабылданбады',
  'applications.rejected.body': '{number} өтініші қабылданбады',
  'applications.readyPaper.title': 'Құжат беруге дайын',
  'applications.ready.title': 'Құжат дайын',
  'applications.ready.body': '{number} өтініші: нәтиже дайын',
  'applications.issued.title': 'Құжат берілді',
  'applications.issued.body': '{number} өтініші: түпнұсқа берілді',
  'applications.provided.title': 'Құжат ұсынылды',
  'applications.provided.body': '{number} өтініші: электрондық құжат дайын',
  'applications.replacement.title': 'Құжатты ауыстыру қажет',
  'applications.revoked.title': 'Анықтама кері қайтарылды',
  'applications.revoked.body': '{number} өтініші: берілген анықтама енді жарамсыз',
  'applications.submitted.title': 'Жаңа өтініш',
  'applications.submitted.body': '{number} өтініші өңдеуді күтуде',
  'applications.resubmitted.title': 'Өтініш түзетілді',
  'applications.resubmitted.body': '{number} өтініші қайта жіберілді',
  'applications.overdue.title': 'Мерзімі өткен өтініштер',
  'applications.overdue.body': 'Өңдеу мерзімі өткен өтініштер: {count}',

  'assignments.published.title': 'Жаңа тапсырма',
  'assignments.graded.title': 'Жұмыс тексерілді',
  'assignments.returned.title': 'Жұмыс түзетуге қайтарылды',
  'assignments.course.body': '{subject}: {title}',

  'events.reminder.title': 'Жақында іс-шара',
  'events.reminder.body': '«{title}» шамамен бір сағаттан кейін басталады',
  'events.reminder.bodyAt': '«{title}» {time} басталады',
  'events.rescheduled.title': 'Іс-шара ауыстырылды',
  'events.rescheduled.body': '«{title}»: жаңа уақыты — {date}',
  'events.cancelled.title': 'Іс-шара тоқтатылды',
  'events.cancelled.body': '«{title}» өтпейді',

  'comments.new.title': 'Жаңа пікір',
  'comments.post.body': '{name} жарияланымыңызға пікір қалдырды',
  'comments.article.body': '{name} мақалаңызға пікір қалдырды',
  'comments.poll.body': '{name} сауалнамаңызға пікір қалдырды',
  'comments.mention.title': 'Сізді атап өтті',
  'comments.mention.body': '{name} пікірде сізді атап өтті',

  'consultations.cancelled.title': 'Консультация болдырылмады',
  'consultations.booked.title': 'Консультацияға жаңа жазылу',
  'consultations.bookingCancelled.title': 'Консультацияға жазылу болдырылмады',

  'appointments.confirmed.title': 'Деканатқа жазылу расталды',
  'appointments.rescheduled.title': 'Деканатқа жазылу ауыстырылды',
  'appointments.completed.title': 'Деканаттағы қабылдау аяқталды',
  'appointments.cancelled.title': 'Деканатқа жазылу болдырылмады',
  'appointments.requested.title': 'Деканатқа жаңа жазылу',

  'exams.scheduled.title': 'Емтихан тағайындалды',
  'exams.updated.title': 'Емтихан бойынша өзгерістер',
  'exams.cancelled.title': 'Емтихан болдырылмады',
  'exams.result.title': 'Емтихан нәтижесі',
  'exams.course.body': '{subject}: {date}',

  'career.viewed.body': 'Компания сіздің өтінішіңізді қарады',
  'career.shortlisted.body': 'Сіз қысқа тізімге қосылдыңыз',
  'career.interview.body': 'Сіз сұхбатқа шақырылдыңыз',
  'career.offer.body': 'Сізге ұсыныс жасалды',
  'career.hired.body': 'Сіз жұмысқа қабылдандыңыз',
  'career.rejected.body': 'Бұл өтініш бойынша бас тартылды',
  'career.accessRequested.title': 'Компанияның рұқсат сұрауы',
  'career.accessRequested.body': '{company} студенттерге қолжетімділік сұрайды',
  'career.accessApproved.title': 'Студенттерге қолжетімділік ашылды',
  'career.accessRejected.title': 'Қолжетімділік сұрауы қабылданбады',
  'career.accessRevoked.title': 'Студенттерге қолжетімділік тоқтатылды',
  'career.accessExpired.title': 'Студенттерге қолжетімділік мерзімі аяқталды',
  'career.university.body': '{university}',
  'career.universityReason.body': '{university}: {reason}',
  'career.vacancyApproved.title': 'Вакансия мақұлданды',
  'career.vacancyRejected.title': 'Вакансия қабылданбады',
  'career.vacancy.body': '«{title}» — {university}',
  'career.vacancyReason.body': '«{title}» — {university}: {reason}',
  'career.newApplication.title': 'Жаңа өтініш',
  'career.newApplication.body': '«{title}» вакансиясы',

  'library.loanIssued.title': 'Сіз кітап алдыңыз',
  'library.loanIssued.body': '«{title}», түг. {number}. {date} дейін қайтару',
  'library.loanReturned.title': 'Кітап қайтарылды',
  'library.loanRenewed.title': 'Мерзім ұзартылды',
  'library.loanRenewed.body': '«{title}» — {date} дейін қайтару',
  'library.loanCancelled.title': 'Беру жойылды',
  'library.loanReturnCancelled.title': 'Қайтару жойылды — кітап қайтадан сізде',
  'library.loanDisputed.title': 'Оқырман беруге наразылық білдірді',
  'library.loanDisputed.body': '{name}: «{title}», түг. {number}',
  'library.dueSoon.title': 'Кітапты жақында қайтару керек',
  'library.dueSoon.body': '«{title}» — {date} дейін қайтару',
  'library.dueToday.title': 'Кітапты бүгін қайтару керек',
  'library.dueToday.body': '«{title}» — бүгін соңғы күн',
  'library.overdue.title': 'Кітаптың мерзімі өтті',
  'library.overdue.body':
    '«{title}» кітабын {date} қайтару керек еді. Кітап қайтарылмайынша жаңа беру мен бронь жабық',
  'library.book.body': '«{title}»',
  'library.reservationReady.title': 'Бронь дайын',
  'library.reservationReady.body': '«{title}» сізді {date} дейін күтеді',
  'library.reservationExpired.title': 'Броньның мерзімі өтті',
  'library.reservationCancelled.title': 'Бронь жойылды',
}

const EN: Record<NotificationMessageKey, string> = {
  'friends.request.title': 'New friend request',
  'friends.request.body': '{name} wants to add you as a friend',
  'friends.accepted.title': 'Friend request accepted',
  'friends.accepted.body': 'Your friend request was accepted',

  'complaints.resolved.title': 'Complaint reviewed',
  'complaints.dismissed.body': 'A moderator dismissed your complaint',
  'complaints.acted.body': 'Action was taken on your complaint',

  'schedule.changed.title': 'Schedule change',
  'schedule.changed.body': '{subject}: {change} on {date}',
  'schedule.moved.body': '{subject}: class moved on {date}',
  'schedule.roomChanged.body': '{subject}: room changed on {date}',
  'schedule.cancelled.body': '{subject}: class cancelled on {date}',
  'schedule.substituted.body': '{subject}: substitute teacher on {date}',
  'schedule.movedRevoked.body': '{subject}: the move on {date} is undone, class at the usual time',
  'schedule.roomChangedRevoked.body': '{subject}: the room change on {date} is undone',
  'schedule.cancelledRevoked.body': '{subject}: the class on {date} will take place',
  'schedule.substitutedRevoked.body': '{subject}: the teacher substitution on {date} is undone',

  'moderation.warning.title': 'Moderator warning',
  'moderation.warning.body':
    'Your content violates the platform rules. Repeated violations will restrict your access.',

  'chats.request.title': 'Message request',
  'chats.request.body': '{name} wants to message you',
  'chats.message.body': 'New message',
  'chats.scheduledFailed.title': 'Scheduled message was not sent',

  'documents.request.title': 'New document request',
  'documents.result.title': 'Document review result',
  'documents.replacement.title': 'Document replacement required',
  'documents.expired.title': 'Document has expired',
  'documents.expiring.title': 'Document expires soon',
  'documents.named.body': '“{title}”',
  'documents.shared.title': 'A document was shared with you',
  'documents.shared.body': '{name}: “{title}”',
  'documents.submitted.title': 'Documents submitted for review',
  'documents.submitted.body': '{name}: “{title}”',

  'applications.needsAction.title': 'Your action is required',
  'applications.needsAction.body': 'Application {number}: correction required',
  'applications.preparing.title': 'Application in preparation',
  'applications.preparing.body': 'Application {number}: preparation started',
  'applications.rejected.title': 'Application rejected',
  'applications.rejected.body': 'Application {number} was rejected',
  'applications.readyPaper.title': 'Document ready for collection',
  'applications.ready.title': 'Document ready',
  'applications.ready.body': 'Application {number}: the result is ready',
  'applications.issued.title': 'Document issued',
  'applications.issued.body': 'Application {number}: the original was issued',
  'applications.provided.title': 'Document provided',
  'applications.provided.body': 'Application {number}: the electronic document is ready',
  'applications.replacement.title': 'Document replacement required',
  'applications.revoked.title': 'Certificate revoked',
  'applications.revoked.body': 'Application {number}: the issued certificate is no longer valid',
  'applications.submitted.title': 'New application',
  'applications.submitted.body': 'Application {number} is awaiting processing',
  'applications.resubmitted.title': 'Application corrected',
  'applications.resubmitted.body': 'Application {number} was resubmitted',
  'applications.overdue.title': 'Overdue applications',
  'applications.overdue.body': 'Applications past their processing deadline: {count}',

  'assignments.published.title': 'New assignment',
  'assignments.graded.title': 'Work graded',
  'assignments.returned.title': 'Work returned for revision',
  'assignments.course.body': '{subject}: {title}',

  'events.reminder.title': 'Event starting soon',
  'events.reminder.body': '“{title}” starts in about an hour',
  'events.reminder.bodyAt': '“{title}” starts at {time}',
  'events.rescheduled.title': 'Event rescheduled',
  'events.rescheduled.body': '“{title}”: new time — {date}',
  'events.cancelled.title': 'Event cancelled',
  'events.cancelled.body': '“{title}” will not take place',

  'comments.new.title': 'New comment',
  'comments.post.body': '{name} commented on your post',
  'comments.article.body': '{name} commented on your article',
  'comments.poll.body': '{name} commented on your poll',
  'comments.mention.title': 'You were mentioned',
  'comments.mention.body': '{name} mentioned you in a comment',

  'consultations.cancelled.title': 'Consultation cancelled',
  'consultations.booked.title': 'New consultation booking',
  'consultations.bookingCancelled.title': 'Consultation booking cancelled',

  'appointments.confirmed.title': 'Dean’s office appointment confirmed',
  'appointments.rescheduled.title': 'Dean’s office appointment rescheduled',
  'appointments.completed.title': 'Dean’s office appointment completed',
  'appointments.cancelled.title': 'Dean’s office appointment cancelled',
  'appointments.requested.title': 'New dean’s office appointment request',

  'exams.scheduled.title': 'Exam scheduled',
  'exams.updated.title': 'Exam details changed',
  'exams.cancelled.title': 'Exam cancelled',
  'exams.result.title': 'Exam result',
  'exams.course.body': '{subject}: {date}',

  'career.viewed.body': 'The company viewed your application',
  'career.shortlisted.body': 'You were shortlisted',
  'career.interview.body': 'You were invited to an interview',
  'career.offer.body': 'You received an offer',
  'career.hired.body': 'You were hired',
  'career.rejected.body': 'This application was declined',
  'career.accessRequested.title': 'Company access request',
  'career.accessRequested.body': '{company} asks for access to your students',
  'career.accessApproved.title': 'Access to students granted',
  'career.accessRejected.title': 'Access request declined',
  'career.accessRevoked.title': 'Access to students revoked',
  'career.accessExpired.title': 'Access to students expired',
  'career.university.body': '{university}',
  'career.universityReason.body': '{university}: {reason}',
  'career.vacancyApproved.title': 'Vacancy approved',
  'career.vacancyRejected.title': 'Vacancy declined',
  'career.vacancy.body': '“{title}” — {university}',
  'career.vacancyReason.body': '“{title}” — {university}: {reason}',
  'career.newApplication.title': 'New application',
  'career.newApplication.body': 'Vacancy “{title}”',

  'library.loanIssued.title': 'You borrowed a book',
  'library.loanIssued.body': '“{title}”, inv. {number}. Return by {date}',
  'library.loanReturned.title': 'Book returned',
  'library.loanRenewed.title': 'Loan renewed',
  'library.loanRenewed.body': '“{title}” — return by {date}',
  'library.loanCancelled.title': 'Loan cancelled',
  'library.loanReturnCancelled.title': 'Return cancelled — the book is on your record again',
  'library.loanDisputed.title': 'A reader disputed a loan',
  'library.loanDisputed.body': '{name}: “{title}”, inv. {number}',
  'library.dueSoon.title': 'Book due soon',
  'library.dueSoon.body': '“{title}” — return by {date}',
  'library.dueToday.title': 'Book due today',
  'library.dueToday.body': '“{title}” — today is the last day',
  'library.overdue.title': 'Book overdue',
  'library.overdue.body':
    '“{title}” was due {date}. New loans and holds are closed until it is returned',
  'library.book.body': '“{title}”',
  'library.reservationReady.title': 'Hold is ready',
  'library.reservationReady.body': '“{title}” is waiting for you until {date}',
  'library.reservationExpired.title': 'Hold expired',
  'library.reservationCancelled.title': 'Hold cancelled',
}

export const NOTIFICATION_MESSAGES: Record<Locale, Record<NotificationMessageKey, string>> = {
  ru: RU,
  kk: KK,
  en: EN,
}

/** Все ключи словаря — для проверки паритета и для тестов. */
export const NOTIFICATION_MESSAGE_KEYS = Object.keys(RU) as NotificationMessageKey[]

/** Есть ли такая статья в словаре. Ключ приходит из базы, то есть ему нельзя доверять. */
export function isNotificationMessageKey(key: string): key is NotificationMessageKey {
  return key in RU
}

/**
 * Собрать строку уведомления.
 *
 * Возвращает `null`, если ключа нет в словаре, — вызывающий в этом случае показывает
 * сохранённый в базе текст. Ключ приходит из колонки `notifications.title_key`, то есть
 * мог быть записан версией кода, где статья ещё была, и удалён позже; падать из-за этого
 * нельзя — уведомление должно остаться читаемым.
 *
 * Подстановка простая, `{name}`, без склонений и множественного числа: ни одна строка
 * словаря их не требует, а ICU ради этого тащить в общий пакет незачем. Пропущенный
 * параметр остаётся в тексте как `{name}` — это заметно при первом же взгляде и лучше
 * пустого места, по которому непонятно, что сломалось.
 */
export function renderNotificationMessage(
  locale: string,
  key: string,
  params?: NotificationParams | null,
): string | null {
  if (!isNotificationMessageKey(key)) return null
  const table = SUPPORTED_LOCALES.includes(locale as Locale)
    ? NOTIFICATION_MESSAGES[locale as Locale]
    : NOTIFICATION_MESSAGES[DEFAULT_LOCALE]
  const template = table[key] ?? NOTIFICATION_MESSAGES[DEFAULT_LOCALE][key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    return value === undefined || value === null ? whole : String(value)
  })
}
