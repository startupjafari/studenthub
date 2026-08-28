import { QueueService } from './queue.service'
import { QUEUES } from './queue.constants'

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
    await service.enqueue(QUEUES.EMAIL, 'send-welcome', { to: 'a@b.c' }, { requestId: 'req-9' })
    const [name, payload] = add.mock.calls[0]
    expect(name).toBe('send-welcome')
    expect(payload.to).toBe('a@b.c')
    expect(payload._meta.requestId).toBe('req-9')
    expect(typeof payload._meta.enqueuedAt).toBe('string')
  })

  it('генерирует requestId, если не передан', async () => {
    const { service, add } = makeService()
    await service.enqueue(QUEUES.EMAIL, 'send-welcome', { to: 'a@b.c' })
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
    await service.enqueue(QUEUES.EMAIL, 'send-welcome', { to: 'a@b.c' }, { requestId: 'r' })
    expect(add.mock.calls[0][2]).not.toHaveProperty('requestId')
  })
})
