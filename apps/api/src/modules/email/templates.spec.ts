import {
  renderApplicationStatus,
  renderEventReminder,
  renderInvite,
  renderScheduleChange,
  renderWelcome,
} from './templates'

describe('email templates', () => {
  it('invite: содержит ссылку, роль и срок', () => {
    const r = renderInvite({
      to: 'a@b.c',
      inviteUrl: 'https://app/register?token=xyz',
      roleLabel: 'Студент',
      invitedByName: 'Иван Петров',
      expiresAt: '28.07.2026 12:00',
    })
    expect(r.subject).toContain('Приглашение')
    expect(r.html).toContain('https://app/register?token=xyz')
    expect(r.html).toContain('Студент')
    expect(r.html).toContain('Иван Петров')
    expect(r.text).toContain('https://app/register?token=xyz')
    expect(r.text).toContain('28.07.2026 12:00')
  })

  it('invite: без invitedByName использует безличную формулировку', () => {
    const r = renderInvite({
      to: 'a@b.c',
      inviteUrl: 'https://app/x',
      roleLabel: 'Декан',
      expiresAt: '01.01.2027',
    })
    expect(r.html).toContain('Вас пригласили')
  })

  it('welcome: обращается по имени', () => {
    const r = renderWelcome({ to: 'a@b.c', firstName: 'Алия' })
    expect(r.subject).toContain('Добро пожаловать')
    expect(r.html).toContain('Алия')
    expect(r.text).toContain('Алия')
  })

  it('application-status: показывает id, статус и комментарий', () => {
    const r = renderApplicationStatus({
      to: 'a@b.c',
      firstName: 'Алия',
      applicationId: 'APP-1',
      statusLabel: 'Одобрена',
      comment: 'Готово к выдаче',
    })
    expect(r.subject).toContain('APP-1')
    expect(r.subject).toContain('Одобрена')
    expect(r.html).toContain('APP-1')
    expect(r.html).toContain('Готово к выдаче')
  })

  it('application-status: без комментария не падает', () => {
    const r = renderApplicationStatus({
      to: 'a@b.c',
      firstName: 'Алия',
      applicationId: 'APP-2',
      statusLabel: 'В обработке',
    })
    expect(r.html).toContain('APP-2')
    expect(r.text).not.toContain('Комментарий')
  })

  it('schedule-change: включает группу и описание', () => {
    const r = renderScheduleChange({
      to: 'a@b.c',
      firstName: 'Алия',
      groupName: 'ИТ-23-1',
      summary: 'Пара по алгоритмам перенесена в ауд. 302',
    })
    expect(r.html).toContain('ИТ-23-1')
    expect(r.html).toContain('ауд. 302')
    expect(r.text).toContain('ИТ-23-1')
  })

  it('event-reminder: содержит название и время', () => {
    const r = renderEventReminder({
      to: 'a@b.c',
      firstName: 'Алия',
      eventTitle: 'День открытых дверей',
      startsAtLabel: 'сегодня в 15:00',
    })
    expect(r.subject).toContain('День открытых дверей')
    expect(r.html).toContain('сегодня в 15:00')
    expect(r.text).toContain('День открытых дверей')
  })
})
