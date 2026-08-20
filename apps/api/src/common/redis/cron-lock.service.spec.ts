import { CronLockService } from './cron-lock.service'

function setup(redis: { set: jest.Mock; eval?: jest.Mock }) {
  const client = { eval: jest.fn().mockResolvedValue(1), ...redis }
  return { service: new CronLockService(client as never), client }
}

describe('CronLockService', () => {
  it('берёт лок через SET NX PX и выполняет задачу', async () => {
    const { service, client } = setup({ set: jest.fn().mockResolvedValue('OK') })
    const task = jest.fn().mockResolvedValue(7)

    await expect(service.run('expireInvites', 60_000, task)).resolves.toBe(7)

    expect(task).toHaveBeenCalled()
    const [key, token, px, ttl, nx] = client.set.mock.calls[0]
    expect(key).toBe('cron:lock:expireInvites')
    expect([px, ttl, nx]).toEqual(['PX', 60_000, 'NX'])
    // Снимаем лок своим токеном, а не слепым DEL.
    expect(client.eval).toHaveBeenCalledWith(expect.any(String), 1, key, token)
  })

  it('лок занят другим инстансом → задача не запускается, возвращается null', async () => {
    const { service, client } = setup({ set: jest.fn().mockResolvedValue(null) })
    const task = jest.fn()

    await expect(service.run('cleanOrphanFiles', 60_000, task)).resolves.toBeNull()

    expect(task).not.toHaveBeenCalled()
    // Чужой лок не снимаем.
    expect(client.eval).not.toHaveBeenCalled()
  })

  it('Redis недоступен → задача всё равно выполняется (fail-open)', async () => {
    const { service } = setup({ set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) })
    const task = jest.fn().mockResolvedValue(3)

    await expect(service.run('cleanAuditLogs', 60_000, task)).resolves.toBe(3)
    expect(task).toHaveBeenCalled()
  })

  it('лок снимается и когда задача упала', async () => {
    const { service, client } = setup({ set: jest.fn().mockResolvedValue('OK') })
    const task = jest.fn().mockRejectedValue(new Error('boom'))

    await expect(service.run('sweepDocumentExpiry', 60_000, task)).rejects.toThrow('boom')
    expect(client.eval).toHaveBeenCalled()
  })

  it('сбой снятия лока не превращается в ошибку задачи — TTL добьёт сам', async () => {
    const { service } = setup({
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockRejectedValue(new Error('down')),
    })

    await expect(service.run('publishScheduledPosts', 60_000, async () => 1)).resolves.toBe(1)
  })
})
