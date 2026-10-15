import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({ api: { post: vi.fn().mockResolvedValue({}) } }))

import { claimDeviceCache, forgetDeviceData } from './device-data'

function mockCaches(names: string[]) {
  const deleted: string[] = []
  vi.stubGlobal('caches', {
    keys: vi.fn().mockResolvedValue(names),
    delete: vi.fn(async (n: string) => {
      deleted.push(n)
      return true
    }),
  })
  return deleted
}

describe('данные прошлого пользователя на устройстве', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('выход стирает офлайн-кэши API, но не статику приложения', async () => {
    const deleted = mockCaches(['student-pass-api', 'chat-messages-api', 'next-static-js-assets'])
    await forgetDeviceData()
    expect(deleted.sort()).toEqual(['chat-messages-api', 'student-pass-api'])
  })

  it('вход другого человека стирает кэш прежнего, повторный вход того же — нет', async () => {
    const deleted = mockCaches(['me-today-api'])
    await claimDeviceCache('u1')
    expect(deleted).toEqual([])
    await claimDeviceCache('u1')
    expect(deleted).toEqual([])
    await claimDeviceCache('u2')
    expect(deleted).toEqual(['me-today-api'])
  })
})
