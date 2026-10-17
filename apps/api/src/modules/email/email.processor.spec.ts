import { UnrecoverableError, type Job } from 'bullmq'
import { EmailProcessor } from './email.processor'
import type { MailerService } from './mailer.service'
import type { JobPayload } from '../../common/queue'

// Воркер очереди email (план 3.3): диспетчер шаблонов + guard'ы «неизвестный job» / «без получателя».
function setup() {
  const mailer = { send: jest.fn().mockResolvedValue(undefined) }
  const processor = new EmailProcessor(mailer as unknown as MailerService)
  return { processor, mailer }
}

function job(name: string, data: Record<string, unknown>): Job<JobPayload> {
  return { name, data, id: 'job-1' } as unknown as Job<JobPayload>
}

const INVITE = {
  to: 'stu@uni.io',
  inviteUrl: 'https://app/register?token=raw-token',
  roleLabel: 'Студент',
  expiresAt: '28.07.2026 12:00',
}

describe('EmailProcessor', () => {
  it('рендерит известный job и отправляет письмо получателю', async () => {
    const { processor, mailer } = setup()
    await processor.process(job('send-invite', INVITE))
    expect(mailer.send).toHaveBeenCalledTimes(1)
    const arg = mailer.send.mock.calls[0][0]
    expect(arg.to).toBe('stu@uni.io')
    expect(typeof arg.subject).toBe('string')
    expect(typeof arg.html).toBe('string')
    expect(typeof arg.text).toBe('string')
  })

  it('неизвестный job → бросает без повторов, письмо не отправляется', async () => {
    const { processor, mailer } = setup()
    const run = processor.process(job('send-unknown', { to: 'x@y.io' }))
    await expect(run).rejects.toThrow(/Неизвестный email job/)
    await expect(run).rejects.toBeInstanceOf(UnrecoverableError)
    expect(mailer.send).not.toHaveBeenCalled()
  })

  // Убранные шаблоны (F-F19) больше не отправляются: их никто не ставил в очередь.
  it('удалённые шаблоны не принимаются', async () => {
    const { processor } = setup()
    await expect(
      processor.process(job('send-welcome', { to: 'stu@uni.io', firstName: 'Аня' })),
    ).rejects.toThrow(/Неизвестный email job/)
  })

  it('job без получателя → бросает без повторов', async () => {
    const { processor, mailer } = setup()
    const { to: _to, ...withoutTo } = INVITE
    void _to
    const run = processor.process(job('send-invite', withoutTo))
    await expect(run).rejects.toThrow(/без получателя/)
    await expect(run).rejects.toBeInstanceOf(UnrecoverableError)
    expect(mailer.send).not.toHaveBeenCalled()
  })

  it('служебное поле _meta не попадает в письмо', async () => {
    const { processor, mailer } = setup()
    await processor.process(job('send-invite', { ...INVITE, _meta: { requestId: 'r1' } }))
    const arg = mailer.send.mock.calls[0][0]
    expect(arg._meta).toBeUndefined()
  })
})

// F-F20: упавшее письмо не держит в Redis адрес и сырой токен ссылки.
describe('EmailProcessor.onFailed', () => {
  function failedJob(attemptsMade: number, extra: Partial<Job> = {}) {
    const updateData = jest.fn().mockResolvedValue(undefined)
    const j = {
      name: 'send-invite',
      id: 'job-1',
      data: { ...INVITE, _meta: { requestId: 'r1', enqueuedAt: '2026-10-17T00:00:00.000Z' } },
      opts: { attempts: 8 },
      attemptsMade,
      updateData,
      ...extra,
    } as unknown as Job<JobPayload>
    return { job: j, updateData }
  }

  it('промежуточная попытка: данные на месте — письмо ещё будут повторять', async () => {
    const { processor } = setup()
    const { job: j, updateData } = failedJob(3)
    await processor.onFailed(j, new Error('ECONNREFUSED'))
    expect(updateData).not.toHaveBeenCalled()
  })

  it('попытки исчерпаны: payload стирается, остаются только _meta', async () => {
    const { processor } = setup()
    const { job: j, updateData } = failedJob(8, { finishedOn: Date.now() })
    await processor.onFailed(j, new Error('ECONNREFUSED'))
    expect(updateData).toHaveBeenCalledWith({
      _meta: { requestId: 'r1', enqueuedAt: '2026-10-17T00:00:00.000Z' },
    })
    const scrubbed = JSON.stringify(updateData.mock.calls[0][0])
    expect(scrubbed).not.toContain('raw-token')
    expect(scrubbed).not.toContain('stu@uni.io')
  })

  it('неисправимая ошибка на первой попытке — тоже окончательная', async () => {
    const { processor } = setup()
    const { job: j, updateData } = failedJob(1, { finishedOn: Date.now() })
    await processor.onFailed(j, new UnrecoverableError('Неизвестный email job'))
    expect(updateData).toHaveBeenCalledTimes(1)
  })

  it('job уже вытеснен лимитом хранения — сбой стирания не всплывает', async () => {
    const { processor } = setup()
    const { job: j, updateData } = failedJob(8)
    updateData.mockRejectedValueOnce(new Error('Missing key for job job-1'))
    await expect(processor.onFailed(j, new Error('boom'))).resolves.toBeUndefined()
  })

  it('событие без job не роняет обработчик', async () => {
    const { processor } = setup()
    await expect(processor.onFailed(undefined, new Error('boom'))).resolves.toBeUndefined()
  })
})
