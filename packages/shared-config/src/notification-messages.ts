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

  'moderation.warning.title': 'Предупреждение модератора',
  'moderation.warning.body':
    'Ваши материалы нарушают правила платформы. При повторном нарушении доступ будет ограничен.',

  'chats.request.title': 'Запрос на переписку',
  'chats.request.body': '{name} хочет вам написать',
  'chats.scheduledFailed.title': 'Отложенное сообщение не отправлено',

  'documents.request.title': 'Новый запрос документов',
  'documents.result.title': 'Результат проверки документов',
  'documents.expired.title': 'Срок документа истёк',
  'documents.expiring.title': 'Документ скоро истекает',
  'documents.named.body': '«{title}»',

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

  'assignments.published.title': 'Новое задание',
  'assignments.graded.title': 'Работа проверена',
  'assignments.returned.title': 'Работа возвращена на исправление',
  'assignments.course.body': '{subject}: {title}',

  'events.reminder.title': 'Скоро событие',
  'events.reminder.body': '«{title}» начнётся примерно через час',

  'consultations.cancelled.title': 'Консультация отменена',
  'consultations.booked.title': 'Новая запись на консультацию',
  'consultations.bookingCancelled.title': 'Запись на консультацию отменена',

  'appointments.confirmed.title': 'Запись в деканат подтверждена',
  'appointments.rescheduled.title': 'Запись в деканат перенесена',
  'appointments.completed.title': 'Приём в деканате завершён',
  'appointments.cancelled.title': 'Запись в деканат отменена',

  'career.viewed.body': 'Компания посмотрела ваш отклик',
  'career.shortlisted.body': 'Вас добавили в шорт-лист',
  'career.interview.body': 'Вас пригласили на интервью',
  'career.offer.body': 'Вам сделали предложение',
  'career.hired.body': 'Вас приняли на работу',
  'career.rejected.body': 'По этому отклику отказ',
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

  'moderation.warning.title': 'Модератор ескертуі',
  'moderation.warning.body':
    'Материалдарыңыз платформа ережелерін бұзады. Қайта бұзған жағдайда қолжетімділік шектеледі.',

  'chats.request.title': 'Хат алмасу сұрауы',
  'chats.request.body': '{name} сізге жазғысы келеді',
  'chats.scheduledFailed.title': 'Кейінге қалдырылған хабарлама жіберілмеді',

  'documents.request.title': 'Жаңа құжат сұрауы',
  'documents.result.title': 'Құжаттарды тексеру нәтижесі',
  'documents.expired.title': 'Құжаттың мерзімі өтті',
  'documents.expiring.title': 'Құжаттың мерзімі жақында бітеді',
  'documents.named.body': '«{title}»',

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

  'assignments.published.title': 'Жаңа тапсырма',
  'assignments.graded.title': 'Жұмыс тексерілді',
  'assignments.returned.title': 'Жұмыс түзетуге қайтарылды',
  'assignments.course.body': '{subject}: {title}',

  'events.reminder.title': 'Жақында іс-шара',
  'events.reminder.body': '«{title}» шамамен бір сағаттан кейін басталады',

  'consultations.cancelled.title': 'Консультация болдырылмады',
  'consultations.booked.title': 'Консультацияға жаңа жазылу',
  'consultations.bookingCancelled.title': 'Консультацияға жазылу болдырылмады',

  'appointments.confirmed.title': 'Деканатқа жазылу расталды',
  'appointments.rescheduled.title': 'Деканатқа жазылу ауыстырылды',
  'appointments.completed.title': 'Деканаттағы қабылдау аяқталды',
  'appointments.cancelled.title': 'Деканатқа жазылу болдырылмады',

  'career.viewed.body': 'Компания сіздің өтінішіңізді қарады',
  'career.shortlisted.body': 'Сіз қысқа тізімге қосылдыңыз',
  'career.interview.body': 'Сіз сұхбатқа шақырылдыңыз',
  'career.offer.body': 'Сізге ұсыныс жасалды',
  'career.hired.body': 'Сіз жұмысқа қабылдандыңыз',
  'career.rejected.body': 'Бұл өтініш бойынша бас тартылды',
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

  'moderation.warning.title': 'Moderator warning',
  'moderation.warning.body':
    'Your content violates the platform rules. Repeated violations will restrict your access.',

  'chats.request.title': 'Message request',
  'chats.request.body': '{name} wants to message you',
  'chats.scheduledFailed.title': 'Scheduled message was not sent',

  'documents.request.title': 'New document request',
  'documents.result.title': 'Document review result',
  'documents.expired.title': 'Document has expired',
  'documents.expiring.title': 'Document expires soon',
  'documents.named.body': '“{title}”',

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

  'assignments.published.title': 'New assignment',
  'assignments.graded.title': 'Work graded',
  'assignments.returned.title': 'Work returned for revision',
  'assignments.course.body': '{subject}: {title}',

  'events.reminder.title': 'Event starting soon',
  'events.reminder.body': '“{title}” starts in about an hour',

  'consultations.cancelled.title': 'Consultation cancelled',
  'consultations.booked.title': 'New consultation booking',
  'consultations.bookingCancelled.title': 'Consultation booking cancelled',

  'appointments.confirmed.title': 'Dean’s office appointment confirmed',
  'appointments.rescheduled.title': 'Dean’s office appointment rescheduled',
  'appointments.completed.title': 'Dean’s office appointment completed',
  'appointments.cancelled.title': 'Dean’s office appointment cancelled',

  'career.viewed.body': 'The company viewed your application',
  'career.shortlisted.body': 'You were shortlisted',
  'career.interview.body': 'You were invited to an interview',
  'career.offer.body': 'You received an offer',
  'career.hired.body': 'You were hired',
  'career.rejected.body': 'This application was declined',
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
