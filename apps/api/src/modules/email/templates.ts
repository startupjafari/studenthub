// Шаблоны писем (docs/PROJECT.md §10.1, §3.3 EmailProcessor).
// Пять типов: приглашение, приветствие, статус заявки, изменение расписания, напоминание о событии.
// Тексты — на русском (основной язык); полноценный i18n писем — в Ф13.1.
// Payload содержит только необходимый минимум: адрес и данные для рендера, без целых сущностей.

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

// Единая HTML-обёртка с минимальными inline-стилями (внешний CSS в письмах ненадёжен).
function layout(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ru">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background:#2563eb;padding:20px 32px;color:#ffffff;font-size:18px;font-weight:bold;">${BRAND}</td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${heading}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.5;">
                Это автоматическое письмо от платформы ${BRAND}. Отвечать на него не нужно.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function button(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:12px;font-weight:bold;">${label}</a>`
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${text}</p>`
}

export function renderInvite(data: InvitePayload): RenderedEmail {
  const invitedBy = data.invitedByName ? `${data.invitedByName} приглашает вас` : 'Вас пригласили'
  const subject = `Приглашение в ${BRAND}`
  const html = layout(
    'Приглашение в StudentHub',
    paragraph(`${invitedBy} присоединиться к платформе ${BRAND} в роли «${data.roleLabel}».`) +
      paragraph('Чтобы завершить регистрацию, перейдите по кнопке ниже и задайте пароль.') +
      `<p style="margin:0 0 24px;">${button(data.inviteUrl, 'Принять приглашение')}</p>` +
      paragraph(
        `Ссылка действует до ${data.expiresAt}. Если вы не ожидали приглашение — просто проигнорируйте это письмо.`,
      ),
  )
  const text = `${invitedBy} присоединиться к ${BRAND} в роли «${data.roleLabel}».
Завершите регистрацию по ссылке: ${data.inviteUrl}
Ссылка действует до ${data.expiresAt}.`
  return { subject, html, text }
}

export function renderCompanyVerification(data: CompanyVerificationPayload): RenderedEmail {
  const subject = `Подтвердите email компании в ${BRAND}`
  const html = layout(
    'Подтвердите адрес',
    paragraph(
      `Вы зарегистрировали компанию «${data.companyName}» в ${BRAND}. Подтвердите адрес, чтобы подать заявку на доступ к студентам университета.`,
    ) +
      `<p style="margin:0 0 24px;">${button(data.verifyUrl, 'Подтвердить email')}</p>` +
      paragraph(
        `Ссылка действует до ${data.expiresAt}. Если вы не регистрировались — просто проигнорируйте это письмо, аккаунт останется неактивным.`,
      ),
  )
  const text = `Вы зарегистрировали компанию «${data.companyName}» в ${BRAND}.
Подтвердите адрес по ссылке: ${data.verifyUrl}
Ссылка действует до ${data.expiresAt}.`
  return { subject, html, text }
}

export function renderWelcome(data: WelcomePayload): RenderedEmail {
  const subject = `Добро пожаловать в ${BRAND}`
  const html = layout(
    `Добро пожаловать, ${data.firstName}!`,
    paragraph(
      `Ваш аккаунт в ${BRAND} создан. Теперь вам доступны лента, расписание, заявки, чаты и события вашего университета.`,
    ) + paragraph('Загляните в профиль и настройте уведомления под себя.'),
  )
  const text = `Добро пожаловать, ${data.firstName}! Ваш аккаунт в ${BRAND} создан.`
  return { subject, html, text }
}

export function renderApplicationStatus(data: ApplicationStatusPayload): RenderedEmail {
  const subject = `Заявка ${data.applicationId}: ${data.statusLabel}`
  const html = layout(
    'Статус заявки изменён',
    paragraph(
      `${data.firstName}, статус вашей заявки <b>${data.applicationId}</b> изменён на «${data.statusLabel}».`,
    ) + (data.comment ? paragraph(`Комментарий деканата: ${data.comment}`) : ''),
  )
  const text = `${data.firstName}, статус заявки ${data.applicationId}: ${data.statusLabel}.${
    data.comment ? ` Комментарий: ${data.comment}` : ''
  }`
  return { subject, html, text }
}

export function renderScheduleChange(data: ScheduleChangePayload): RenderedEmail {
  const scope = data.groupName ? ` группы ${data.groupName}` : ''
  const subject = 'Изменение в расписании'
  const html = layout(
    'Расписание изменено',
    paragraph(`${data.firstName}, в расписании${scope} есть изменения:`) + paragraph(data.summary),
  )
  const text = `${data.firstName}, в расписании${scope} есть изменения: ${data.summary}`
  return { subject, html, text }
}

// Офлайн-зеркало in-app уведомления: отправляется, когда получатель не онлайн
// и у него включён email-канал (docs/PROJECT.md §10.1, NotificationsProcessor Ф3.4).
export function renderNotification(data: NotificationPayload): RenderedEmail {
  const subject = data.notificationTitle
  const html = layout(
    data.notificationTitle,
    paragraph(`${data.firstName}, ${data.notificationBody}`),
  )
  const text = `${data.firstName}, ${data.notificationBody}`
  return { subject, html, text }
}

export function renderEventReminder(data: EventReminderPayload): RenderedEmail {
  const subject = `Напоминание: ${data.eventTitle}`
  const html = layout(
    'Скоро начнётся событие',
    paragraph(
      `${data.firstName}, напоминаем: событие «${data.eventTitle}» начнётся ${data.startsAtLabel}.`,
    ),
  )
  const text = `${data.firstName}, событие «${data.eventTitle}» начнётся ${data.startsAtLabel}.`
  return { subject, html, text }
}
