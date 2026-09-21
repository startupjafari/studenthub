import type { PlatformState } from '@prisma/client'
import type Redis from 'ioredis'
import { PlatformService } from './platform.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { TwoFactorService } from '../auth/two-factor.service'
import { AppException } from '../../common/exceptions/app.exception'

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
  // Что именно ушло в БД — записываем отдельно: проверять срок удобнее по значению,
  // а не через матчер поверх аргументов мока.
  const updates: Partial<PlatformState>[] = []
  const prisma = {
    platformState: {
      findUnique: jest.fn().mockResolvedValue(stored),
      // upsert отвечает записанным поверх текущей строки — как настоящая БД.
      upsert: jest.fn(({ update }: { update: Partial<PlatformState> }) => {
        updates.push(update)
        return Promise.resolve({ ...row(), ...stored, ...update })
      }),
    },
  }
  const redis = {
    get: jest.fn().mockResolvedValue(cached),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const twoFactor = { verifyForUser: jest.fn().mockResolvedValue(true) }
  const service = new PlatformService(
    prisma as unknown as PrismaService,
    redis as unknown as Redis,
    audit as unknown as AuditService,
    twoFactor as unknown as TwoFactorService,
  )
  return { service, prisma, redis, audit, twoFactor, updates }
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

describe('PlatformService — запись рычагов', () => {
  // Главное свойство: остановить платформу нельзя без второго фактора.
  it('не включает техработы без кода 2FA', async () => {
    const { service, prisma } = setup()

    await expect(service.setMaintenance('admin-1', { minutes: 30, message: null })).rejects.toThrow(
      AppException,
    )
    expect(prisma.platformState.upsert).not.toHaveBeenCalled()
  })

  it('не включает техработы с неверным кодом', async () => {
    const { service, twoFactor, prisma } = setup()
    twoFactor.verifyForUser.mockResolvedValue(false)

    await expect(
      service.setMaintenance('admin-1', { minutes: 30, message: null, code: '000000' }),
    ).rejects.toThrow(AppException)
    expect(prisma.platformState.upsert).not.toHaveBeenCalled()
  })

  // Обратная сторона той же асимметрии: вернуть платформу обязано быть возможно всегда.
  it('снимает техработы без кода', async () => {
    const { service, prisma, twoFactor } = setup(row({ maintenanceUntil: new Date('2030-01-01') }))

    const state = await service.setMaintenance('admin-1', { minutes: null, message: null })

    expect(twoFactor.verifyForUser).not.toHaveBeenCalled()
    expect(prisma.platformState.upsert).toHaveBeenCalled()
    expect(state.maintenance).toBeNull()
  })

  it('считает срок от часов сервера, а не от присланной метки времени', async () => {
    const { service, updates } = setup()

    await service.setMaintenance('admin-1', { minutes: 30, message: null, code: '123456' })

    const written = updates.at(0) ?? {}
    expect(written.maintenanceUntil).toBeInstanceOf(Date)
    const minutesAhead = (Number(written.maintenanceUntil) - Date.now()) / 60_000
    expect(minutesAhead).toBeGreaterThan(29)
    expect(minutesAhead).toBeLessThanOrEqual(30)
  })

  it('сбрасывает кэш сразу после записи — иначе тумблер «не сработал» ещё минуту', async () => {
    const { service, redis } = setup()

    await service.setSections('admin-1', { disabled: ['chats'] })

    expect(redis.del).toHaveBeenCalledWith('platform:state')
  })

  it('пишет в журнал включение и снятие разными действиями', async () => {
    const { service, audit } = setup()

    await service.setMaintenance('admin-1', { minutes: 30, message: null, code: '123456' })
    await service.setMaintenance('admin-1', { minutes: null, message: null })

    expect(audit.record.mock.calls[0][0]).toMatchObject({ action: 'platform.maintenance.on' })
    expect(audit.record.mock.calls[1][0]).toMatchObject({ action: 'platform.maintenance.off' })
  })

  it('не вешает баннер без текста', async () => {
    const { service, prisma } = setup()

    await expect(service.setBanner('admin-1', { minutes: 60, level: 'INFO' })).rejects.toThrow(
      AppException,
    )
    expect(prisma.platformState.upsert).not.toHaveBeenCalled()
  })

  it('снимая баннер, стирает и его текст — чужое объявление не должно всплыть со следующим', async () => {
    const { service, updates } = setup()

    await service.setBanner('admin-1', { minutes: null, level: 'INFO' })

    expect(updates.at(0) ?? {}).toMatchObject({
      bannerTextRu: null,
      bannerTextKk: null,
      bannerTextEn: null,
      bannerLevel: null,
    })
  })

  it('объявляет версию релиза', async () => {
    const { service } = setup()

    const state = await service.announceRelease('admin-1', { version: '1.3.0' })

    expect(state.announcedVersion).toBe('1.3.0')
  })
})

describe('PlatformService — отказ чтения состояния', () => {
  /**
   * Регрессия по деплою: MaintenanceGuard спрашивает состояние на КАЖДЫЙ запрос к API.
   * Если выкатить код раньше миграции, таблицы ещё нет — и без «падения в рабочую сторону»
   * весь API отвечал бы 500 вместо «техработ не идёт».
   */
  it('считает платформу работающей, когда таблицы нет', async () => {
    const { service, prisma } = setup()
    prisma.platformState.findUnique.mockRejectedValue(
      new Error('The table `public.platform_state` does not exist'),
    )

    await expect(service.maintenanceActive(NOW)).resolves.toBe(false)
  })

  it('отдаёт пустое состояние вместо ошибки, если БД недоступна', async () => {
    const { service, prisma } = setup()
    prisma.platformState.findUnique.mockRejectedValue(new Error('connection refused'))

    await expect(service.publicState(NOW)).resolves.toEqual({
      maintenance: null,
      banner: null,
      disabledSections: [],
      announcedVersion: null,
    })
  })
})
