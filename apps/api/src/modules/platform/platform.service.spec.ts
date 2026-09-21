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
    maintenanceFrom: null,
    maintenanceUntil: null,
    maintenanceMessageRu: null,
    maintenanceMessageKk: null,
    maintenanceMessageEn: null,
    bannerUntil: null,
    bannerTextRu: null,
    bannerTextKk: null,
    bannerTextEn: null,
    bannerLevel: null,
    bannerRoles: [],
    bannerUniversityIds: [],
    disabledSections: [],
    announcedVersion: null,
    quietFrom: null,
    quietTo: null,
    mutedNotifications: [],
    dutyUserId: null,
    digestHour: null,
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
    // Наблюдение: объём файлов и журнал изменений.
    file: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { size: null } }),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
      // Откат читает последнюю запись рычага и берёт из неё снимок «как было».
      findFirst: jest.fn().mockResolvedValue(null),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
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
      notifications: {
        quietFrom: null,
        quietTo: null,
        muted: [],
        dutyUserId: null,
        digestHour: null,
      },
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
      startsAt: null,
      active: true,
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
      bannerRoles: [],
      bannerUniversityIds: [],
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
      notifications: {
        quietFrom: null,
        quietTo: null,
        muted: [],
        dutyUserId: null,
        digestHour: null,
      },
      maintenance: null,
      banner: null,
      disabledSections: [],
      announcedVersion: null,
    })
  })
})

describe('PlatformService — плановые техработы', () => {
  /**
   * Предупреждение и остановка — разные состояния одного события: назначенные на вечер
   * работы видны заранее, но платформу закрывать ещё не должны.
   */
  it('назначенные на будущее видны, но платформу не закрывают', async () => {
    const from = new Date(NOW.getTime() + 60 * 60_000)
    const until = new Date(NOW.getTime() + 120 * 60_000)
    const { service } = setup(row({ maintenanceFrom: from, maintenanceUntil: until }))

    const state = await service.publicState(NOW)

    expect(state.maintenance).toMatchObject({ active: false, startsAt: from.toISOString() })
    await expect(service.maintenanceActive(NOW)).resolves.toBe(false)
  })

  it('начавшиеся закрывают платформу', async () => {
    const from = new Date(NOW.getTime() - 10 * 60_000)
    const until = new Date(NOW.getTime() + 60 * 60_000)
    const { service } = setup(row({ maintenanceFrom: from, maintenanceUntil: until }))

    await expect(service.maintenanceActive(NOW)).resolves.toBe(true)
  })

  // Иначе плановые работы, назначенные на вечер, кончались бы через час после нажатия.
  it('срок окончания считается от начала окна, а не от нажатия', async () => {
    const { service, updates } = setup()

    await service.setMaintenance('admin-1', {
      startsInMinutes: 120,
      minutes: 30,
      message: null,
      code: '123456',
    })

    const written = updates.at(0) ?? {}
    const minutesAhead = (Number(written.maintenanceUntil) - Date.now()) / 60_000
    expect(minutesAhead).toBeGreaterThan(149)
    expect(minutesAhead).toBeLessThanOrEqual(150)
  })
})

describe('PlatformService — адресный баннер', () => {
  it('отдаёт аудиторию вместе с баннером', async () => {
    const { service } = setup(
      row({
        bannerUntil: new Date(NOW.getTime() + 60 * 60_000),
        bannerTextRu: 'р',
        bannerTextKk: 'қ',
        bannerTextEn: 'e',
        bannerRoles: ['TEACHER'],
        bannerUniversityIds: ['11111111-1111-1111-1111-111111111111'],
      }),
    )

    await expect(service.publicState(NOW)).resolves.toMatchObject({
      banner: expect.objectContaining({
        roles: ['TEACHER'],
        universityIds: ['11111111-1111-1111-1111-111111111111'],
      }),
    })
  })

  // Снимая баннер, аудиторию тоже стираем: иначе следующий унаследовал бы чужой прицел.
  it('снятие баннера стирает аудиторию', async () => {
    const { service, updates } = setup()

    await service.setBanner('admin-1', { minutes: null, level: 'INFO' })

    expect(updates.at(0) ?? {}).toMatchObject({ bannerRoles: [], bannerUniversityIds: [] })
  })
})

describe('PlatformService — наблюдение', () => {
  it('считает объём файлов по журналу, а не по диску', async () => {
    const { service, prisma } = setup()
    prisma.file.count.mockResolvedValue(12)
    prisma.file.aggregate.mockResolvedValue({ _sum: { size: 4096 } })

    await expect(service.storageUsage()).resolves.toEqual({ files: 12, bytes: 4096 })
  })

  // Prisma на пустой таблице возвращает `_sum.size: null`, а не 0 — экран показал бы
  // «null Б», если бы это не сводилось к нулю здесь.
  it('пустое хранилище отдаёт нулём, а не null', async () => {
    const { service } = setup()

    await expect(service.storageUsage()).resolves.toEqual({ files: 0, bytes: 0 })
  })

  // У AuditLog нет связи с User: журнал переживает удаление аккаунта, и имя может не найтись.
  it('отдаёт изменение без автора, если аккаунт удалён', async () => {
    const { service, prisma } = setup()
    prisma.auditLog.findMany.mockResolvedValue([
      { action: 'platform.maintenance.on', createdAt: NOW, userId: 'gone' },
    ])

    await expect(service.recentChanges()).resolves.toEqual([
      { action: 'platform.maintenance.on', at: NOW, by: null },
    ])
  })
})

// ── Откат последнего изменения (пункт 53) ───────────────────────────────────
describe('PlatformService.undoLast', () => {
  function entry(before: Record<string, unknown>, ageMs = 0, action = 'platform.banner.on') {
    return { action, metadata: { before }, createdAt: new Date(Date.now() - ageMs) }
  }

  it('возвращает поля к прежним значениям', async () => {
    const { service, prisma, updates } = setup(row({ disabledSections: ['chats'] }))
    prisma.auditLog.findFirst.mockResolvedValue(entry({ disabledSections: [] }))

    await service.undoLast('admin')
    expect(updates.at(-1)).toMatchObject({ disabledSections: [] })
  })

  // Снимок в журнале — JSON: даты лежат строками, и вернуть их строками в БД нельзя.
  it('поднимает даты из строк обратно', async () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const { service, prisma, updates } = setup(row())
    prisma.auditLog.findFirst.mockResolvedValue(entry({ bannerUntil: past }))

    await service.undoLast('admin')
    expect(updates.at(-1)?.bannerUntil).toBeInstanceOf(Date)
  })

  it('отменять нечего → NOT_FOUND', async () => {
    const { service } = setup(row())
    const err = await service.undoLast('admin').catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('NOT_FOUND')
  })

  // Полчаса — граница между «промахнулся» и «решил»: второе молча не отменяют.
  it('старше получаса → CONFLICT', async () => {
    const { service, prisma } = setup(row())
    prisma.auditLog.findFirst.mockResolvedValue(entry({ disabledSections: [] }, 31 * 60 * 1000))
    const err = await service.undoLast('admin').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
  })

  // Включение техработ спрашивает код 2FA. Кнопка без кода, делающая то же самое,
  // превратила бы эту защиту в декорацию.
  it('не включает техработы откатом', async () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString()
    const { service, prisma } = setup(row())
    prisma.auditLog.findFirst.mockResolvedValue(
      entry({ maintenanceUntil: future }, 0, 'platform.maintenance.off'),
    )
    const err = await service.undoLast('admin').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
  })
})
