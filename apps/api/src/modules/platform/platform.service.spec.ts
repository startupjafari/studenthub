import type { PlatformState } from '@prisma/client'
import type Redis from 'ioredis'
import { PlatformService } from './platform.service'
import type { PrismaService } from '../../common/prisma/prisma.service'

const NOW = new Date('2026-09-21T12:00:00Z')

function row(patch: Partial<PlatformState> = {}): PlatformState {
  return {
    id: 'singleton',
    maintenanceUntil: null,
    maintenanceMessageRu: null,
    maintenanceMessageKk: null,
    maintenanceMessageEn: null,
    bannerUntil: null,
    bannerTextRu: null,
    bannerTextKk: null,
    bannerTextEn: null,
    bannerLevel: null,
    disabledSections: [],
    announcedVersion: null,
    updatedById: null,
    updatedAt: NOW,
    ...patch,
  }
}

function setup(stored: PlatformState | null = null, cached: string | null = null) {
  const prisma = { platformState: { findUnique: jest.fn().mockResolvedValue(stored) } }
  const redis = {
    get: jest.fn().mockResolvedValue(cached),
    set: jest.fn().mockResolvedValue('OK'),
  }
  const service = new PlatformService(prisma as unknown as PrismaService, redis as unknown as Redis)
  return { service, prisma, redis }
}

describe('PlatformService.publicState', () => {
  it('отдаёт пустое состояние, пока рычагов не трогали (строки ещё нет)', async () => {
    const { service } = setup(null)

    await expect(service.publicState(NOW)).resolves.toEqual({
      maintenance: null,
      banner: null,
      disabledSections: [],
      announcedVersion: null,
    })
  })

  it('показывает режим техработ, пока срок не вышел', async () => {
    const until = new Date('2026-09-21T12:30:00Z')
    const { service } = setup(
      row({
        maintenanceUntil: until,
        maintenanceMessageRu: 'Обновляем платформу',
        maintenanceMessageKk: 'Платформаны жаңартамыз',
        maintenanceMessageEn: 'Upgrading the platform',
      }),
    )

    const state = await service.publicState(NOW)

    expect(state.maintenance).toEqual({
      until: until.toISOString(),
      message: {
        ru: 'Обновляем платформу',
        kk: 'Платформаны жаңартамыз',
        en: 'Upgrading the platform',
      },
    })
  })

  // Главное свойство «срока вместо флага»: никто не снимает режим руками, он кончается сам.
  it('снимает режим техработ сам, когда срок истёк', async () => {
    const { service } = setup(
      row({ maintenanceUntil: new Date('2026-09-21T11:59:59Z'), maintenanceMessageRu: 'Ждём' }),
    )

    await expect(service.publicState(NOW)).resolves.toMatchObject({ maintenance: null })
  })

  it('не показывает баннер, если текст есть не на всех языках', async () => {
    const { service } = setup(
      row({
        bannerUntil: new Date('2026-09-22T00:00:00Z'),
        bannerTextRu: 'Сегодня в 22:00 обновление',
        bannerTextKk: null,
        bannerTextEn: 'Update tonight at 22:00',
      }),
    )

    await expect(service.publicState(NOW)).resolves.toMatchObject({ banner: null })
  })

  it('неизвестный уровень баннера читается как INFO, а не ломает ответ', async () => {
    const { service } = setup(
      row({
        bannerUntil: new Date('2026-09-22T00:00:00Z'),
        bannerTextRu: 'р',
        bannerTextKk: 'қ',
        bannerTextEn: 'e',
        bannerLevel: 'DANGER',
      }),
    )

    await expect(service.publicState(NOW)).resolves.toMatchObject({
      banner: expect.objectContaining({ level: 'INFO' }),
    })
  })

  it('не публикует, кто трогал рычаги', async () => {
    const { service } = setup(row({ updatedById: 'admin-1', announcedVersion: '1.3.0' }))

    const state = await service.publicState(NOW)

    expect(state).not.toHaveProperty('updatedById')
    expect(state.announcedVersion).toBe('1.3.0')
  })

  it('берёт состояние из кэша, не трогая БД', async () => {
    const { service, prisma } = setup(null, JSON.stringify(row({ disabledSections: ['career'] })))

    await expect(service.publicState(NOW)).resolves.toMatchObject({
      disabledSections: ['career'],
    })
    expect(prisma.platformState.findUnique).not.toHaveBeenCalled()
  })

  // Из Redis даты приезжают строками; без восстановления сравнение срока молча врало бы.
  it('сравнивает срок из кэша как дату, а не как строку', async () => {
    const { service } = setup(
      null,
      JSON.stringify(row({ maintenanceUntil: new Date('2026-09-21T11:00:00Z') })),
    )

    await expect(service.publicState(NOW)).resolves.toMatchObject({ maintenance: null })
  })

  it('переживает недоступный Redis, отвечая из БД', async () => {
    const { service, redis } = setup(row({ announcedVersion: '1.3.0' }))
    redis.get.mockRejectedValue(new Error('Redis down'))
    redis.set.mockRejectedValue(new Error('Redis down'))

    await expect(service.publicState(NOW)).resolves.toMatchObject({ announcedVersion: '1.3.0' })
  })
})
