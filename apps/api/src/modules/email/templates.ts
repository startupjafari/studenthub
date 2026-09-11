// Шаблоны писем (docs/PROJECT.md §10.1, §3.3 EmailProcessor).
// Семь типов: приглашение, подтверждение email компании, приветствие, статус заявки,
// изменение расписания, напоминание о событии, офлайн-зеркало in-app уведомления.
// Тексты — на русском (основной язык); полноценный i18n писем — в Ф13.1.
// Payload содержит только необходимый минимум: адрес и данные для рендера, без целых сущностей.
//
// Единый стиль (§ ниже): у всех писем один каркас — синяя шапка с названием платформы,
// белая карточка 560px, заголовок, текст, необязательные блоки «факты» и «кнопка+ссылка»,
// сноска и общий подвал. Отдельные письма отличаются только содержимым блоков: почтовый
// клиент не место для авторских вёрсток, а получатель узнаёт отправителя по повторяющейся
// форме. Всё оформление — inline-стилями и таблицами: внешний CSS, flex и grid в почте
// не работают.
//
// Тема письма: название платформы стоит только там, где письмо приходит человеку, который
// ещё может не знать продукт (приглашение, приветствие, подтверждение компании). Рабочие
// письма — сразу о событии: имя отправителя в почтовом клиенте и так «StudentHub».

import { pickWebBase } from '../../config/web-base'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export interface InvitePayload {
  to: string
  inviteUrl: string
  roleLabel: string
  invitedByName?: string
  expiresAt: string
}

/**
 * Подтверждение адреса при самостоятельной регистрации работодателя (Ф18).
 * Единственный сценарий на платформе, где email не проверен инвайтом заранее, — поэтому
 * до перехода по ссылке компания не видна ни одному вузу.
 */
export interface CompanyVerificationPayload {
  to: string
  companyName: string
  verifyUrl: string
  expiresAt: string
}

export interface WelcomePayload {
  to: string
  firstName: string
}

export interface ApplicationStatusPayload {
  to: string
  firstName: string
  applicationId: string
  statusLabel: string
  comment?: string
}

export interface ScheduleChangePayload {
  to: string
  firstName: string
  groupName?: string
  summary: string
}

export interface EventReminderPayload {
  to: string
  firstName: string
  eventTitle: string
  startsAtLabel: string
}

export interface NotificationPayload {
  to: string
  firstName: string
  notificationTitle: string
  notificationBody: string
}

const BRAND = 'StudentHub'

// Палитра письма — те же значения, что у токенов дизайн-системы в светлой теме
// (`--primary`, `--foreground`, `--muted-foreground`, `--border`), но в hex: oklch и
// css-переменные почтовые клиенты не понимают.
const COLOR = {
  brand: '#2563eb',
  page: '#f1f5f9',
  card: '#ffffff',
  border: '#e2e8f0',
  heading: '#0f172a',
  body: '#334155',
  muted: '#64748b',
} as const

// Шрифтовой стек без веб-шрифтов: Inter в почте не подгрузить, поэтому берём системный.
// Outlook (движок Word) выбирает первое знакомое имя — им окажется Segoe UI.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,Helvetica,sans-serif"

/** Экранирование всего, что пришло из данных: имена, названия, комментарии, ссылки. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Публичный адрес веба для ссылок подвала. Шаблоны — чистые функции без DI, поэтому
 * читаем переменную напрямую, но по тому же правилу, что и остальной код (`pickWebBase`).
 * Адреса нет (юнит-тесты, ранний старт) — подвал просто остаётся без ссылок.
 */
function appUrl(): string {
  return pickWebBase(process.env.CORS_ORIGIN ?? '')
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLOR.body};">${text}</p>`
}

/** Сноска: срок жизни ссылки, «если вы этого не ждали» — тише основного текста. */
function note(text: string): string {
  return `<p style="margin:0;font-size:13px;line-height:1.6;color:${COLOR.muted};">${text}</p>`
}

/**
 * Структурные данные письма — всегда таблицей «подпись → значение», а не жирным внутри
 * фразы: роль, срок, номер заявки и статус читаются одинаково во всех письмах.
 */
function facts(rows: [label: string, value: string][]): string {
  const cells = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:0 16px 8px 0;font-size:13px;line-height:1.5;color:${COLOR.muted};white-space:nowrap;">${label}</td>
          <td style="padding:0 0 8px;font-size:15px;line-height:1.5;color:${COLOR.heading};font-weight:bold;">${value}</td>
        </tr>`,
    )
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-collapse:collapse;">${cells}</table>`
}

/**
 * Целевое действие письма: кнопка плюс та же ссылка текстом. Текстовый дубль обязателен —
 * часть клиентов вырезает оформление кнопки, и без него письмо становится тупиком.
 */
function action(url: string, label: string): string {
  const safe = esc(url)
  return `<p style="margin:0 0 16px;">
      <a href="${safe}" style="display:inline-block;background:${COLOR.brand};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:12px;font-size:15px;font-weight:bold;">${label}</a>
    </p>
    <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${COLOR.muted};">
      Если кнопка не открывается, скопируйте ссылку:<br />
      <a href="${safe}" style="color:${COLOR.brand};word-break:break-all;">${safe}</a>
    </p>`
}

/**
 * Общий каркас. `preheader` — скрытая строка, которую почтовый клиент показывает в списке
 * писем рядом с темой: без неё туда попадает первый попавшийся кусок вёрстки.
 * `footerExtra` — дополнительная строка подвала (например, как отключить письма).
 */
function layout(options: {
  preheader: string
  heading: string
  body: string
  footerExtra?: string
}): string {
  const base = appUrl()
  const brandLink = base
    ? `<p style="margin:8px 0 0;"><a href="${esc(base)}" style="color:${COLOR.muted};text-decoration:underline;">Открыть ${BRAND}</a></p>`
    : ''
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <!-- Письмо светлое в любой теме: без этого часть клиентов инвертирует цвета сама
         и синяя шапка уезжает в грязно-серый. -->
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${options.heading}</title>
  </head>
  <body style="margin:0;padding:0;background:${COLOR.page};font-family:${FONT};color:${COLOR.heading};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${options.preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.page};padding:24px 0;">
      <tr>
        <td align="center" style="padding:0 12px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${COLOR.card};border-radius:16px;overflow:hidden;border:1px solid ${COLOR.border};">
            <tr>
              <td style="background:${COLOR.brand};padding:20px 32px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:-0.2px;">${BRAND}</td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${COLOR.heading};">${options.heading}</h1>
                ${options.body}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid ${COLOR.border};color:${COLOR.muted};font-size:12px;line-height:1.5;">
                <p style="margin:0;">Это автоматическое письмо от платформы ${BRAND}. Отвечать на него не нужно.</p>
                ${options.footerExtra ? `<p style="margin:8px 0 0;">${options.footerExtra}</p>` : ''}
                ${brandLink}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/** Текстовая версия того же письма: абзацы через пустую строку плюс общая подпись. */
function plain(lines: string[]): string {
  const base = appUrl()
  const footer = [`— ${BRAND}. Это автоматическое письмо, отвечать на него не нужно.`]
  if (base) footer.push(base)
  return [...lines.filter(Boolean), '', ...footer].join('\n')
}

export function renderInvite(data: InvitePayload): RenderedEmail {
  const invitedBy = data.invitedByName
    ? `${esc(data.invitedByName)} приглашает вас`
    : 'Вас пригласили'
  const subject = `Приглашение в ${BRAND}`
  const html = layout({
    preheader: `Роль «${esc(data.roleLabel)}», ссылка действует до ${esc(data.expiresAt)}`,
    heading: `Приглашение в ${BRAND}`,
    body:
      paragraph(`${invitedBy} присоединиться к платформе ${BRAND}.`) +
      facts([
        ['Роль', esc(data.roleLabel)],
        ['Ссылка действует до', esc(data.expiresAt)],
      ]) +
      paragraph('Чтобы завершить регистрацию, перейдите по ссылке и задайте пароль.') +
      action(data.inviteUrl, 'Принять приглашение') +
      note('Если вы не ожидали приглашение — просто проигнорируйте это письмо.'),
  })
  const text = plain([
    `${data.invitedByName ? `${data.invitedByName} приглашает вас` : 'Вас пригласили'} присоединиться к ${BRAND}.`,
    `Роль: ${data.roleLabel}`,
    `Ссылка действует до ${data.expiresAt}`,
    '',
    `Завершите регистрацию по ссылке: ${data.inviteUrl}`,
    '',
    'Если вы не ожидали приглашение — просто проигнорируйте это письмо.',
  ])
  return { subject, html, text }
}

export function renderCompanyVerification(data: CompanyVerificationPayload): RenderedEmail {
  const subject = `Подтвердите email компании в ${BRAND}`
  const html = layout({
    preheader: `Компания «${esc(data.companyName)}» ждёт подтверждения адреса`,
    heading: 'Подтвердите адрес',
    body:
      paragraph(
        `Вы зарегистрировали компанию «${esc(data.companyName)}» в ${BRAND}. Подтвердите адрес, чтобы подать заявку на доступ к студентам университета.`,
      ) +
      facts([
        ['Компания', esc(data.companyName)],
        ['Ссылка действует до', esc(data.expiresAt)],
      ]) +
      action(data.verifyUrl, 'Подтвердить email') +
      note(
        'Если вы не регистрировались — просто проигнорируйте это письмо, аккаунт останется неактивным.',
      ),
  })
  const text = plain([
    `Вы зарегистрировали компанию «${data.companyName}» в ${BRAND}.`,
    `Ссылка действует до ${data.expiresAt}`,
    '',
    `Подтвердите адрес по ссылке: ${data.verifyUrl}`,
    '',
    'Если вы не регистрировались — просто проигнорируйте это письмо.',
  ])
  return { subject, html, text }
}

export function renderWelcome(data: WelcomePayload): RenderedEmail {
  const subject = `Добро пожаловать в ${BRAND}`
  const html = layout({
    preheader: 'Аккаунт создан — лента, расписание, заявки и чаты уже доступны',
    heading: `Добро пожаловать, ${esc(data.firstName)}!`,
    body:
      paragraph(
        `Ваш аккаунт в ${BRAND} создан. Теперь вам доступны лента, расписание, заявки, чаты и события вашего университета.`,
      ) + paragraph('Загляните в профиль и настройте уведомления под себя.'),
  })
  const text = plain([
    `Добро пожаловать, ${data.firstName}! Ваш аккаунт в ${BRAND} создан.`,
    'Вам доступны лента, расписание, заявки, чаты и события вашего университета.',
  ])
  return { subject, html, text }
}

export function renderApplicationStatus(data: ApplicationStatusPayload): RenderedEmail {
  const subject = `Заявка ${data.applicationId}: ${data.statusLabel}`
  const html = layout({
    preheader: `Заявка ${esc(data.applicationId)} — ${esc(data.statusLabel)}`,
    heading: 'Статус заявки изменён',
    body:
      paragraph(`${esc(data.firstName)}, статус вашей заявки изменился.`) +
      facts([
        ['Заявка', esc(data.applicationId)],
        ['Статус', esc(data.statusLabel)],
      ]) +
      (data.comment ? paragraph(`Комментарий деканата: ${esc(data.comment)}`) : ''),
  })
  const text = plain([
    `${data.firstName}, статус вашей заявки изменился.`,
    `Заявка: ${data.applicationId}`,
    `Статус: ${data.statusLabel}`,
    ...(data.comment ? ['', `Комментарий деканата: ${data.comment}`] : []),
  ])
  return { subject, html, text }
}

export function renderScheduleChange(data: ScheduleChangePayload): RenderedEmail {
  const subject = 'Изменение в расписании'
  const html = layout({
    preheader: esc(data.summary),
    heading: 'Расписание изменено',
    body:
      paragraph(`${esc(data.firstName)}, в расписании есть изменения.`) +
      (data.groupName ? facts([['Группа', esc(data.groupName)]]) : '') +
      paragraph(esc(data.summary)),
  })
  const text = plain([
    `${data.firstName}, в расписании есть изменения.`,
    ...(data.groupName ? [`Группа: ${data.groupName}`] : []),
    '',
    data.summary,
  ])
  return { subject, html, text }
}

export function renderEventReminder(data: EventReminderPayload): RenderedEmail {
  const subject = `Напоминание: ${data.eventTitle}`
  const html = layout({
    preheader: `«${esc(data.eventTitle)}» начнётся ${esc(data.startsAtLabel)}`,
    heading: 'Скоро начнётся событие',
    body:
      paragraph(`${esc(data.firstName)}, напоминаем о событии.`) +
      facts([
        ['Событие', esc(data.eventTitle)],
        ['Начало', esc(data.startsAtLabel)],
      ]),
  })
  const text = plain([
    `${data.firstName}, напоминаем о событии.`,
    `Событие: ${data.eventTitle}`,
    `Начало: ${data.startsAtLabel}`,
  ])
  return { subject, html, text }
}

// Офлайн-зеркало in-app уведомления: отправляется, когда получатель не онлайн
// и у него включён email-канал (docs/PROJECT.md §10.1, NotificationsProcessor Ф3.4).
// Единственное письмо, которое человек может получать часто, — поэтому в подвале
// сказано, где выключить канал.
export function renderNotification(data: NotificationPayload): RenderedEmail {
  const base = appUrl()
  const settingsLink = base
    ? `Отключить письма можно в <a href="${esc(base)}/settings" style="color:${COLOR.muted};text-decoration:underline;">настройках уведомлений</a>.`
    : 'Отключить письма можно в настройках уведомлений.'
  const subject = data.notificationTitle
  const html = layout({
    preheader: esc(data.notificationBody),
    heading: esc(data.notificationTitle),
    // Текст уведомления приходит из продюсера и может начинаться как угодно — с заглавной
    // буквы, с «Отправила вам…», с цитаты. Поэтому обращение отдельным законченным
    // предложением, а не приклеено к телу: иначе выходит «Алия, Отправила вам сообщение».
    body:
      paragraph(`${esc(data.firstName)}, у вас новое уведомление:`) +
      paragraph(esc(data.notificationBody)),
    footerExtra: settingsLink,
  })
  const text = plain([
    `${data.firstName}, у вас новое уведомление:`,
    data.notificationBody,
    '',
    'Отключить письма можно в настройках уведомлений.',
  ])
  return { subject, html, text }
}
