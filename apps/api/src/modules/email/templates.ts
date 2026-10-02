// Шаблоны писем (docs/PROJECT.md §10.1, §3.3 EmailProcessor).
// Десять типов: приглашение, подтверждение email компании, приветствие, статус заявки,
// изменение расписания, напоминание о событии, офлайн-зеркало in-app уведомления и три
// письма прихода вуза — подтверждение адреса заявки, одобрение, отказ.
// Тексты — в email-strings.ts на трёх языках; язык берётся из `locale` в payload'е job'а,
// то есть из User.locale получателя. У внешних адресатов (компания, заявка вуза с лендинга)
// учётной записи ещё нет — для них русский по умолчанию.
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
import { emailDict, type EmailDict } from './email-strings'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/**
 * Язык письма. Общий для всех payload'ов: продюсер кладёт сюда `User.locale` получателя.
 *
 * Необязательное поле намеренно. Во-первых, часть писем уходит людям без учётной записи
 * (подтверждение компании, заявка вуза с лендинга) — языка у них взять неоткуда.
 * Во-вторых, job'ы, положенные в очередь предыдущей версией кода, приходят без него, и
 * отправить их всё равно надо. Нет языка — русский.
 */
export interface LocalizedEmailPayload {
  locale?: string | null
}

export interface InvitePayload extends LocalizedEmailPayload {
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
export interface CompanyVerificationPayload extends LocalizedEmailPayload {
  to: string
  companyName: string
  verifyUrl: string
  expiresAt: string
}

/**
 * Подтверждение адреса в заявке вуза на тестирование (docs/PROJECT.md §31).
 *
 * Письмо уходит ДО очереди модерации, а не после: форма публичная, и без этого шага
 * в очередь попадали бы заявки, поданные с чужого рабочего адреса. Подтверждение
 * ничего не обещает — только переводит заявку в очередь.
 */
export interface DemoVerificationPayload extends LocalizedEmailPayload {
  to: string
  universityName: string
  verifyUrl: string
  expiresAt: string
}

/**
 * Заявка одобрена. Письмо одно, а не два: ссылка-приглашение уже внутри него.
 * Отдельное письмо «вас пригласили» после письма «заявка одобрена» выглядело бы
 * как дубль, а человек всё равно нажимает первую попавшуюся ссылку.
 */
export interface DemoApprovedPayload extends LocalizedEmailPayload {
  to: string
  universityName: string
  contactName: string
  inviteUrl: string
  expiresAt: string
}

/**
 * Заявка отклонена. Причина — из закрытого списка, уже приведённая к человеческой
 * формулировке на стороне сервиса: шаблон не знает про enum'ы.
 */
export interface DemoRejectedPayload extends LocalizedEmailPayload {
  to: string
  universityName: string
  reasonText: string
  canReapply: boolean
}

export interface WelcomePayload extends LocalizedEmailPayload {
  to: string
  firstName: string
}

export interface ApplicationStatusPayload extends LocalizedEmailPayload {
  to: string
  firstName: string
  applicationId: string
  statusLabel: string
  comment?: string
}

export interface ScheduleChangePayload extends LocalizedEmailPayload {
  to: string
  firstName: string
  groupName?: string
  summary: string
}

export interface EventReminderPayload extends LocalizedEmailPayload {
  to: string
  firstName: string
  eventTitle: string
  startsAtLabel: string
}

export interface NotificationPayload extends LocalizedEmailPayload {
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
function action(url: string, label: string, t: EmailDict): string {
  const safe = esc(url)
  return `<p style="margin:0 0 16px;">
      <a href="${safe}" style="display:inline-block;background:${COLOR.brand};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:12px;font-size:15px;font-weight:bold;">${label}</a>
    </p>
    <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${COLOR.muted};">
      ${t.common.linkFallback}<br />
      <a href="${safe}" style="color:${COLOR.brand};word-break:break-all;">${safe}</a>
    </p>`
}

/**
 * Общий каркас. `preheader` — скрытая строка, которую почтовый клиент показывает в списке
 * писем рядом с темой: без неё туда попадает первый попавшийся кусок вёрстки.
 * `footerExtra` — дополнительная строка подвала (например, как отключить письма).
 */
function layout(
  options: {
    preheader: string
    heading: string
    body: string
    footerExtra?: string
  },
  t: EmailDict,
): string {
  const base = appUrl()
  const brandLink = base
    ? `<p style="margin:8px 0 0;"><a href="${esc(base)}" style="color:${COLOR.muted};text-decoration:underline;">${t.common.openApp}</a></p>`
    : ''
  return `<!doctype html>
<html lang="${t.htmlLang}">
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
                <p style="margin:0;">${t.common.autoNote}</p>
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
function plain(lines: string[], t: EmailDict): string {
  const base = appUrl()
  const footer = [t.common.plainSignature]
  if (base) footer.push(base)
  return [...lines.filter(Boolean), '', ...footer].join('\n')
}

export function renderInvite(data: InvitePayload): RenderedEmail {
  const t = emailDict(data.locale)
  const invitedBy = data.invitedByName
    ? t.invite.invitedBy(esc(data.invitedByName))
    : t.invite.invitedImpersonal
  const subject = t.invite.subject
  const html = layout(
    {
      preheader: t.invite.preheader(esc(data.roleLabel), esc(data.expiresAt)),
      heading: t.invite.heading,
      body:
        paragraph(t.invite.lead(invitedBy)) +
        facts([
          [t.facts.role, esc(data.roleLabel)],
          [t.facts.validUntil, esc(data.expiresAt)],
        ]) +
        paragraph(t.invite.finish) +
        action(data.inviteUrl, t.invite.action, t) +
        note(t.invite.note),
    },
    t,
  )
  const text = plain(
    [
      t.invite.plainLead(
        data.invitedByName ? t.invite.invitedBy(data.invitedByName) : t.invite.invitedImpersonal,
      ),
      `${t.facts.role}: ${data.roleLabel}`,
      `${t.facts.validUntil} ${data.expiresAt}`,
      '',
      t.invite.plainFinish(data.inviteUrl),
      '',
      t.invite.note,
    ],
    t,
  )
  return { subject, html, text }
}

export function renderCompanyVerification(data: CompanyVerificationPayload): RenderedEmail {
  const t = emailDict(data.locale)
  const subject = t.companyVerification.subject
  const html = layout(
    {
      preheader: t.companyVerification.preheader(esc(data.companyName)),
      heading: t.companyVerification.heading,
      body:
        paragraph(t.companyVerification.lead(esc(data.companyName))) +
        facts([
          [t.facts.company, esc(data.companyName)],
          [t.facts.validUntil, esc(data.expiresAt)],
        ]) +
        action(data.verifyUrl, t.companyVerification.action, t) +
        note(t.companyVerification.note),
    },
    t,
  )
  const text = plain(
    [
      t.companyVerification.lead(data.companyName),
      `${t.facts.validUntil} ${data.expiresAt}`,
      '',
      data.verifyUrl,
      '',
      t.companyVerification.plainNote,
    ],
    t,
  )
  return { subject, html, text }
}

export function renderWelcome(data: WelcomePayload): RenderedEmail {
  const t = emailDict(data.locale)
  const subject = t.welcome.subject
  const html = layout(
    {
      preheader: t.welcome.preheader,
      heading: t.welcome.heading(esc(data.firstName)),
      body: paragraph(t.welcome.lead) + paragraph(t.welcome.hint),
    },
    t,
  )
  const text = plain([t.welcome.plainLead(data.firstName), t.welcome.plainWhat], t)
  return { subject, html, text }
}

export function renderApplicationStatus(data: ApplicationStatusPayload): RenderedEmail {
  const t = emailDict(data.locale)
  const subject = t.applicationStatus.subject(data.applicationId, data.statusLabel)
  const html = layout(
    {
      preheader: t.applicationStatus.preheader(esc(data.applicationId), esc(data.statusLabel)),
      heading: t.applicationStatus.heading,
      body:
        paragraph(t.applicationStatus.lead(esc(data.firstName))) +
        facts([
          [t.facts.application, esc(data.applicationId)],
          [t.facts.status, esc(data.statusLabel)],
        ]) +
        (data.comment ? paragraph(t.applicationStatus.comment(esc(data.comment))) : ''),
    },
    t,
  )
  const text = plain(
    [
      t.applicationStatus.lead(data.firstName),
      `${t.facts.application}: ${data.applicationId}`,
      `${t.facts.status}: ${data.statusLabel}`,
      ...(data.comment ? ['', t.applicationStatus.comment(data.comment)] : []),
    ],
    t,
  )
  return { subject, html, text }
}

export function renderDemoVerification(data: DemoVerificationPayload): RenderedEmail {
  const t = emailDict(data.locale)
  const subject = t.demoVerification.subject
  const html = layout(
    {
      preheader: t.demoVerification.preheader(esc(data.universityName)),
      heading: t.demoVerification.heading,
      body:
        paragraph(t.demoVerification.lead(esc(data.universityName))) +
        facts([[t.facts.validUntil, esc(data.expiresAt)]]) +
        action(data.verifyUrl, t.demoVerification.action, t) +
        note(t.demoVerification.note),
    },
    t,
  )
  const text = plain(
    [
      t.demoVerification.lead(data.universityName),
      `${t.facts.validUntil} ${data.expiresAt}`,
      '',
      data.verifyUrl,
      '',
      t.demoVerification.plainNote,
    ],
    t,
  )
  return { subject, html, text }
}

export function renderDemoApproved(data: DemoApprovedPayload): RenderedEmail {
  const t = emailDict(data.locale)
  const subject = t.demoApproved.subject(data.universityName)
  const html = layout(
    {
      preheader: t.demoApproved.preheader,
      heading: t.demoApproved.heading,
      body:
        paragraph(
          `${t.demoApproved.greeting(esc(data.contactName))} ${t.demoApproved.lead(esc(data.universityName))}`,
        ) +
        paragraph(t.demoApproved.wizard) +
        facts([[t.facts.validUntil, esc(data.expiresAt)]]) +
        action(data.inviteUrl, t.demoApproved.action, t) +
        note(t.demoApproved.note),
    },
    t,
  )
  const text = plain(
    [
      t.demoApproved.greeting(data.contactName),
      t.demoApproved.lead(data.universityName),
      '',
      t.demoApproved.wizardPlain,
      '',
      `${t.facts.validUntil} ${data.expiresAt}`,
      data.inviteUrl,
      '',
      t.demoApproved.notePlain,
    ],
    t,
  )
  return { subject, html, text }
}

export function renderDemoRejected(data: DemoRejectedPayload): RenderedEmail {
  const t = emailDict(data.locale)
  const subject = t.demoRejected.subject
  // Отказ — письмо без кнопки. Кнопка здесь звала бы туда, куда звать нечем.
  const again = data.canReapply ? t.demoRejected.again : t.demoRejected.noReply
  const html = layout(
    {
      preheader: t.demoRejected.preheader(esc(data.universityName)),
      heading: t.demoRejected.heading,
      body:
        paragraph(t.demoRejected.lead(esc(data.universityName))) +
        paragraph(esc(data.reasonText)) +
        note(again),
    },
    t,
  )
  const text = plain([t.demoRejected.lead(data.universityName), data.reasonText, '', again], t)
  return { subject, html, text }
}

export function renderScheduleChange(data: ScheduleChangePayload): RenderedEmail {
  const t = emailDict(data.locale)
  const subject = t.scheduleChange.subject
  const html = layout(
    {
      preheader: esc(data.summary),
      heading: t.scheduleChange.heading,
      body:
        paragraph(t.scheduleChange.lead(esc(data.firstName))) +
        (data.groupName ? facts([[t.facts.group, esc(data.groupName)]]) : '') +
        paragraph(esc(data.summary)),
    },
    t,
  )
  const text = plain(
    [
      t.scheduleChange.lead(data.firstName),
      ...(data.groupName ? [`${t.facts.group}: ${data.groupName}`] : []),
      '',
      data.summary,
    ],
    t,
  )
  return { subject, html, text }
}

export function renderEventReminder(data: EventReminderPayload): RenderedEmail {
  const t = emailDict(data.locale)
  const subject = t.eventReminder.subject(data.eventTitle)
  const html = layout(
    {
      preheader: t.eventReminder.preheader(esc(data.eventTitle), esc(data.startsAtLabel)),
      heading: t.eventReminder.heading,
      body:
        paragraph(t.eventReminder.lead(esc(data.firstName))) +
        facts([
          [t.facts.event, esc(data.eventTitle)],
          [t.facts.startsAt, esc(data.startsAtLabel)],
        ]),
    },
    t,
  )
  const text = plain(
    [
      t.eventReminder.lead(data.firstName),
      `${t.facts.event}: ${data.eventTitle}`,
      `${t.facts.startsAt}: ${data.startsAtLabel}`,
    ],
    t,
  )
  return { subject, html, text }
}

// Офлайн-зеркало in-app уведомления: отправляется, когда получатель не онлайн
// и у него включён email-канал (docs/PROJECT.md §10.1, NotificationsProcessor Ф3.4).
// Единственное письмо, которое человек может получать часто, — поэтому в подвале
// сказано, где выключить канал.
export function renderNotification(data: NotificationPayload): RenderedEmail {
  const t = emailDict(data.locale)
  const base = appUrl()
  const settingsLink = base
    ? t.common.settingsLink(
        `<a href="${esc(base)}/settings" style="color:${COLOR.muted};text-decoration:underline;">${t.common.settingsPlain}</a>`,
      )
    : t.common.settingsPlain
  const subject = data.notificationTitle
  const html = layout(
    {
      preheader: esc(data.notificationBody),
      heading: esc(data.notificationTitle),
      // Текст уведомления приходит из продюсера и может начинаться как угодно — с заглавной
      // буквы, с «Отправила вам…», с цитаты. Поэтому обращение отдельным законченным
      // предложением, а не приклеено к телу: иначе выходит «Алия, Отправила вам сообщение».
      body:
        paragraph(t.notificationMirror.lead(esc(data.firstName))) +
        paragraph(esc(data.notificationBody)),
      footerExtra: settingsLink,
    },
    t,
  )
  const text = plain(
    [t.notificationMirror.lead(data.firstName), data.notificationBody, '', t.common.settingsPlain],
    t,
  )
  return { subject, html, text }
}
