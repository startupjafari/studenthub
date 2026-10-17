import { QueueService } from './queue.service'
import { QUEUES, QUEUE_NAMES, jobOptionsFor } from './queue.constants'

type Mock = jest.Mock

function makeService() {
  const add = jest.fn().mockResolvedValue({ id: 'job-1' }) as Mock
  const queue = { add }
  // Все очереди используют один мок add — нам важен только вызов add.
  const service = new QueueService(
    queue as never,
    queue as never,
    queue as never,
    queue as never,
    queue as never,
    queue as never,
  )
  return { service, add }
}

describe('QueueService.enqueue', () => {
  it('штампует _meta (requestId + enqueuedAt) в payload', async () => {
    const { service, add } = makeService()
    await service.enqueue(QUEUES.EMAIL, 'send-invite', { to: 'a@b.c' }, { requestId: 'req-9' })
    const [name, payload] = add.mock.calls[0]
    expect(name).toBe('send-invite')
    expect(payload.to).toBe('a@b.c')
    expect(payload._meta.requestId).toBe('req-9')
    expect(typeof payload._meta.enqueuedAt).toBe('string')
  })

  it('генерирует requestId, если не передан', async () => {
    const { service, add } = makeService()
    await service.enqueue(QUEUES.EMAIL, 'send-invite', { to: 'a@b.c' })
    expect(add.mock.calls[0][1]._meta.requestId).toEqual(expect.any(String))
  })

  it('санирует двоеточия в jobId (ограничение BullMQ)', async () => {
    const { service, add } = makeService()
    await service.enqueue(
      QUEUES.EMAIL,
      'send-notification',
      { to: 'a@b.c' },
      { jobId: 'notif-email:new-message:msg1:user1' },
    )
    const opts = add.mock.calls[0][2]
    expect(opts.jobId).toBe('notif-email_new-message_msg1_user1')
    expect(opts.jobId).not.toContain(':')
  })

  it('requestId не утекает в jobOptions', async () => {
    const { service, add } = makeService()
    await service.enqueue(QUEUES.EMAIL, 'send-invite', { to: 'a@b.c' }, { requestId: 'r' })
    expect(add.mock.calls[0][2]).not.toHaveProperty('requestId')
  })
})

// F-F20: упавшие job'ы не копятся в Redis вечно, почта переживает короткий сбой SMTP.
describe('jobOptionsFor', () => {
  it("упавшие job'ы любой очереди хранятся ограниченно — по сроку и по числу", () => {
    for (const name of QUEUE_NAMES) {
      expect(jobOptionsFor(name).removeOnFail).toEqual({
        age: 7 * 24 * 60 * 60,
        count: 1000,
      })
      expect(jobOptionsFor(name).removeOnComplete).toBe(true)
    }
  })

  it('письмо повторяется около получаса, а не 15 секунд', () => {
    const opts = jobOptionsFor(QUEUES.EMAIL)
    const backoff = opts.backoff as { type: string; delay: number }
    expect(backoff.type).toBe('exponential')
    // Сумма пауз между попытками: delay · (2^(attempts-1) − 1).
    const totalMs = backoff.delay * (2 ** ((opts.attempts ?? 1) - 1) - 1)
    expect(totalMs).toBeGreaterThanOrEqual(20 * 60 * 1000)
    expect(totalMs).toBeLessThan(60 * 60 * 1000)
  })

  it('остальные очереди — с базовыми тремя попытками', () => {
    expect(jobOptionsFor(QUEUES.NOTIFICATIONS).attempts).toBe(3)
    expect(jobOptionsFor(QUEUES.MEDIA_IMAGE).attempts).toBe(3)
  })
})
