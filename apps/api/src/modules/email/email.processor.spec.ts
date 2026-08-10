import type { Job } from 'bullmq'
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

describe('EmailProcessor', () => {
  it('рендерит известный job и отправляет письмо получателю', async () => {
    const { processor, mailer } = setup()
    await processor.process(job('send-welcome', { to: 'stu@uni.io', firstName: 'Аня' }))
    expect(mailer.send).toHaveBeenCalledTimes(1)
    const arg = mailer.send.mock.calls[0][0]
    expect(arg.to).toBe('stu@uni.io')
    expect(typeof arg.subject).toBe('string')
    expect(typeof arg.html).toBe('string')
    expect(typeof arg.text).toBe('string')
  })

  it('неизвестный job → бросает, письмо не отправляется', async () => {
    const { processor, mailer } = setup()
    await expect(processor.process(job('send-unknown', { to: 'x@y.io' }))).rejects.toThrow(
      /Неизвестный email job/,
    )
    expect(mailer.send).not.toHaveBeenCalled()
  })

  it('job без получателя → бросает', async () => {
    const { processor, mailer } = setup()
    await expect(processor.process(job('send-welcome', { firstName: 'Аня' }))).rejects.toThrow(
      /без получателя/,
    )
    expect(mailer.send).not.toHaveBeenCalled()
  })

  it('служебное поле _meta не попадает в письмо', async () => {
    const { processor, mailer } = setup()
    await processor.process(
      job('send-welcome', { to: 'stu@uni.io', firstName: 'Аня', _meta: { requestId: 'r1' } }),
    )
    const arg = mailer.send.mock.calls[0][0]
    expect(arg._meta).toBeUndefined()
  })
})
