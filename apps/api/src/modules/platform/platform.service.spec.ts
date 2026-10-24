import type { PlatformState } from '@prisma/client'
import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import { PLATFORM_AUDIT_ACTIONS, PlatformService } from './platform.service'
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
    seasonOff: false,
    seasonOverride: null,
    quietFrom: null,
    quietTo: null,
    mutedNotifications: [],
    dutyUserId: null,
    dutyRotation: [],
    digestHour: null,
    updatedById: null,
    updatedAt: NOW,
    ...patch,
  }
}

function setup(
  stored: PlatformState | null = null,
  cached: string | null = null,
  // Кому бот НЕ может написать: нет привязки Telegram, заблокирован, удалён, не команда.
  unreachable: string[] = [],
) {
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
    // Дежурство проверяет, дойдёт ли до человека бот: отвечаем всеми, кроме недоступных.
    telegramAccount: {
      findMany: jest.fn(({ where }: { where: { userId: { in: string[] } } }) =>
        Promise.resolve(
          where.userId.in.filter((id) => !unreachable.includes(id)).map((userId) => ({ userId })),
        ),
      ),
    },
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

    // Аноним: настроек уведомлений команды в ответе нет вовсе (B-F19).
    await expect(service.publicState(NOW)).resolves.toEqual({
      maintenance: null,
      banner: null,
      disabledSections: [],
      announcedVersion: null,
      season: { off: false, override: null },
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

  it('сезон пишется состоянием целиком — и выключатель, и подмена сразу', async () => {
    const { service, updates } = setup()

    await service.setSeason('admin-1', { off: true, override: 'nauryz' })

    expect(updates[0]).toMatchObject({ seasonOff: true, seasonOverride: 'nauryz' })
  })

  it('сезон возвращается в календарный одним действием', async () => {
    const { service, updates } = setup(row({ seasonOff: true, seasonOverride: 'nauryz' }))

    await service.setSeason('admin-1', { off: false, override: null })

    expect(updates[0]).toMatchObject({ seasonOff: false, seasonOverride: null })
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

    // Аноним: настроек уведомлений команды в ответе нет вовсе (B-F19).
    await expect(service.publicState(NOW)).resolves.toEqual({
      maintenance: null,
      banner: null,
      disabledSections: [],
      announcedVersion: null,
      season: { off: false, override: null },
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

/**
 * Регрессия B-F01: `maintenanceFrom` возвращался из Redis строкой, MaintenanceGuard падал
 * с TypeError на каждом запросе, и API лежал у всех ролей — даже после конца окна, пока
 * режим не сняли руками. Кэш здесь настоящий по смыслу: первое чтение кладёт строку
 * через JSON.stringify, следующие получают её обратно из JSON, как от Redis.
 */
describe('PlatformService — плановые техработы из кэша', () => {
  function roundTrip(stored: PlatformState) {
    const ctx = setup(stored)
    let cache: string | null = null
    ctx.redis.get.mockImplementation(() => Promise.resolve(cache))
    ctx.redis.set.mockImplementation((_key: string, value: string) => {
      cache = value
      return Promise.resolve('OK')
    })
    return ctx
  }

  it('назначенные на будущее: из кэша видны и платформу не закрывают', async () => {
    const from = new Date(NOW.getTime() + 60 * 60_000)
    const until = new Date(NOW.getTime() + 120 * 60_000)
    const { service, prisma } = roundTrip(row({ maintenanceFrom: from, maintenanceUntil: until }))

    await service.publicState(NOW) // из БД, кладёт строку в кэш
    const state = await service.publicState(NOW)
    const active = await service.maintenanceActive(NOW)

    expect(prisma.platformState.findUnique).toHaveBeenCalledTimes(1)
    expect(state.maintenance).toMatchObject({
      active: false,
      startsAt: from.toISOString(),
      until: until.toISOString(),
    })
    expect(active).toBe(false)
  })

  it('начавшиеся: из кэша закрывают платформу', async () => {
    const from = new Date(NOW.getTime() - 10 * 60_000)
    const until = new Date(NOW.getTime() + 60 * 60_000)
    const { service, prisma } = roundTrip(row({ maintenanceFrom: from, maintenanceUntil: until }))

    await service.publicState(NOW)
    const state = await service.publicState(NOW)
    const active = await service.maintenanceActive(NOW)

    expect(prisma.platformState.findUnique).toHaveBeenCalledTimes(1)
    expect(state.maintenance).toMatchObject({ active: true, startsAt: from.toISOString() })
    expect(active).toBe(true)
  })

  // Окно кончилось, а `maintenanceFrom` в строке остался: платформа обязана вернуться сама.
  it('после конца окна платформа открыта и без ручного снятия', async () => {
    const from = new Date(NOW.getTime() - 120 * 60_000)
    const until = new Date(NOW.getTime() - 60 * 60_000)
    const { service } = setup(
      null,
      JSON.stringify(row({ maintenanceFrom: from, maintenanceUntil: until })),
    )

    await expect(service.publicState(NOW)).resolves.toMatchObject({ maintenance: null })
    await expect(service.maintenanceActive(NOW)).resolves.toBe(false)
  })

  it('битая дата в кэше не роняет проверку', async () => {
    const until = new Date(NOW.getTime() + 60 * 60_000)
    const { service } = setup(
      null,
      JSON.stringify({ ...row({ maintenanceUntil: until }), maintenanceFrom: 'не дата' }),
    )

    await expect(service.maintenanceActive(NOW)).resolves.toEqual(expect.any(Boolean))
    await expect(service.publicState(NOW)).resolves.toMatchObject({
      maintenance: expect.objectContaining({ startsAt: null }),
    })
  })
})

describe('PlatformService — адресный баннер', () => {
  const UNI_A = '11111111-1111-1111-1111-111111111111'
  const UNI_B = '22222222-2222-2222-2222-222222222222'
  const targeted = (patch: Partial<PlatformState> = {}) =>
    row({
      bannerUntil: new Date(NOW.getTime() + 60 * 60_000),
      bannerTextRu: 'р',
      bannerTextKk: 'қ',
      bannerTextEn: 'e',
      bannerRoles: ['TEACHER'],
      bannerUniversityIds: [UNI_A, UNI_B],
      ...patch,
    })

  it('команда платформы видит аудиторию целиком', async () => {
    const { service } = setup(targeted())

    await expect(
      service.publicState(NOW, { role: Role.PLATFORM_ADMIN, universityId: null }),
    ).resolves.toMatchObject({
      banner: expect.objectContaining({ roles: ['TEACHER'], universityIds: [UNI_A, UNI_B] }),
    })
  })

  // B-F19: объявление «только преподавателям вуза X» с UUID вузов читал любой без входа.
  it('аноним адресного баннера не получает', async () => {
    const { service } = setup(targeted())
    await expect(service.publicState(NOW)).resolves.toMatchObject({ banner: null })
  })

  it('аноним видит баннер без адресации', async () => {
    const { service } = setup(targeted({ bannerRoles: [], bannerUniversityIds: [] }))
    await expect(service.publicState(NOW)).resolves.toMatchObject({
      banner: expect.objectContaining({ roles: [], universityIds: [] }),
    })
  })

  it('адресат получает баннер, а из прицела по вузам — только свой вуз', async () => {
    const { service } = setup(targeted())

    const state = await service.publicState(NOW, { role: Role.TEACHER, universityId: UNI_A })

    expect(state.banner).toMatchObject({ roles: ['TEACHER'], universityIds: [UNI_A] })
  })

  it('не адресату баннер не уходит: чужой вуз или чужая роль', async () => {
    const { service } = setup(targeted())

    const otherUni = await service.publicState(NOW, {
      role: Role.TEACHER,
      universityId: '33333333-3333-3333-3333-333333333333',
    })
    const otherRole = await service.publicState(NOW, { role: Role.STUDENT, universityId: UNI_A })

    expect(otherUni.banner).toBeNull()
    expect(otherRole.banner).toBeNull()
  })

  it('баннер ролям без прицела по вузам доходит до этой роли в любом вузе', async () => {
    const { service } = setup(targeted({ bannerUniversityIds: [] }))
    const state = await service.publicState(NOW, { role: Role.TEACHER, universityId: UNI_B })
    expect(state.banner).toMatchObject({ roles: ['TEACHER'], universityIds: [] })
  })

  // Снимая баннер, аудиторию тоже стираем: иначе следующий унаследовал бы чужой прицел.
  it('снятие баннера стирает аудиторию', async () => {
    const { service, updates } = setup()

    await service.setBanner('admin-1', { minutes: null, level: 'INFO' })

    expect(updates.at(0) ?? {}).toMatchObject({ bannerRoles: [], bannerUniversityIds: [] })
  })
})

describe('PlatformService — настройки уведомлений в состоянии', () => {
  const policy = row({ quietFrom: 22, quietTo: 8, dutyUserId: 'duty-1', digestHour: 9 })

  it('команда платформы (мини-апп) получает настройки уведомлений', async () => {
    const { service } = setup(policy)
    const state = await service.publicState(NOW, {
      role: Role.PLATFORM_MODERATOR,
      universityId: null,
    })
    expect(state.notifications).toEqual({
      quietFrom: 22,
      quietTo: 8,
      muted: [],
      dutyUserId: 'duty-1',
      digestHour: 9,
    })
  })

  it('остальным id дежурного и тихие часы не отдаются', async () => {
    const { service } = setup(policy)
    const anon = await service.publicState(NOW)
    const admin = await service.publicState(NOW, { role: Role.UNIVERSITY_ADMIN, universityId: 'u' })
    expect(anon).not.toHaveProperty('notifications')
    expect(admin).not.toHaveProperty('notifications')
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

  // B-F20: COUNT и SUM по всей таблице файлов — не на каждое открытие «Обзора».
  it('объём файлов кэшируется на пять минут', async () => {
    const { service, prisma, redis } = setup()
    prisma.file.count.mockResolvedValue(3)
    prisma.file.aggregate.mockResolvedValue({ _sum: { size: 10 } })

    await service.storageUsage()

    expect(redis.set).toHaveBeenCalledWith(
      'platform:storage',
      JSON.stringify({ files: 3, bytes: 10 }),
      'EX',
      300,
    )
  })

  it('попадание в кэш объёма не идёт в БД', async () => {
    const { service, prisma } = setup(null, JSON.stringify({ files: 5, bytes: 50 }))

    await expect(service.storageUsage()).resolves.toEqual({ files: 5, bytes: 50 })
    expect(prisma.file.count).not.toHaveBeenCalled()
    expect(prisma.file.aggregate).not.toHaveBeenCalled()
  })

  it('недоступный Redis не ломает объём файлов', async () => {
    const { service, prisma, redis } = setup()
    redis.get.mockRejectedValue(new Error('down'))
    redis.set.mockRejectedValue(new Error('down'))
    prisma.file.count.mockResolvedValue(1)

    await expect(service.storageUsage()).resolves.toEqual({ files: 1, bytes: 0 })
  })

  // Префиксный LIKE `platform.%` индекс по action не использует — читаем по списку.
  it('журнал изменений читается по списку действий, а не префиксом', async () => {
    const { service, prisma } = setup()

    await service.recentChanges()

    const where = prisma.auditLog.findMany.mock.calls[0]?.[0]?.where
    expect(where).toEqual({ action: { in: PLATFORM_AUDIT_ACTIONS }, entity: 'PlatformState' })
    expect(PLATFORM_AUDIT_ACTIONS).toEqual(
      expect.arrayContaining(['platform.maintenance.on', 'platform.duty.rotate']),
    )
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

  // Запись об откате несёт состояние до отмены: второе «верни как было» отменяет отмену.
  it('кладёт в запись об откате значения до отмены', async () => {
    const { service, prisma, audit } = setup(row({ disabledSections: ['chats'] }))
    prisma.auditLog.findFirst.mockResolvedValue(entry({ disabledSections: [] }))

    await service.undoLast('admin')
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'platform.state.undo',
        metadata: expect.objectContaining({ before: { disabledSections: ['chats'] } }),
      }),
    )
  })

  // Снимок в журнале — JSON: даты лежат строками, и вернуть их строками в БД нельзя.
  it('поднимает даты из строк обратно', async () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const { service, prisma, updates } = setup(row())
    prisma.auditLog.findFirst.mockResolvedValue(entry({ bannerUntil: past }))

    await service.undoLast('admin')
    expect(updates.at(-1)?.bannerUntil).toBeInstanceOf(Date)
  })

  // B-F20: крон смены дежурного пишет запись без снимка — откат её пропускает и отменяет
  // правку админа, сделанную до неё.
  it('пропускает смену дежурного кроном', async () => {
    const { service, prisma } = setup(row())

    await service.undoLast('admin').catch(() => undefined)

    const where = prisma.auditLog.findFirst.mock.calls[0]?.[0]?.where as {
      action: { in: string[] }
      entity: string
    }
    expect(where.action.in).not.toContain('platform.duty.rotate')
    expect(where.action.in).toContain('platform.banner.on')
    expect(where.entity).toBe('PlatformState')
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

// ── Очередь дежурств (пункт 90) ─────────────────────────────────────────────
describe('PlatformService — дежурство по очереди', () => {
  it('первый в списке становится дежурным сразу: очередь не должна ждать неделю', async () => {
    const { service, updates } = setup(row())
    await service.setDuty('admin', ['a', 'b', 'c'])
    expect(updates.at(-1)).toMatchObject({ dutyUserId: 'a', dutyRotation: ['a', 'b', 'c'] })
  })

  // Назначенного руками дежурного расписание не снимает: его ставили осознанно.
  it('не отбирает дежурство у назначенного руками', async () => {
    const { service, updates } = setup(row({ dutyUserId: 'z' }))
    await service.setDuty('admin', ['a', 'b'])
    expect(updates.at(-1)?.dutyUserId).toBe('z')
  })

  it('передаёт дежурство следующему по списку', async () => {
    const { service, updates } = setup(row({ dutyUserId: 'a', dutyRotation: ['a', 'b', 'c'] }))
    await expect(service.rotateDuty()).resolves.toBe('b')
    expect(updates.at(-1)?.dutyUserId).toBe('b')
  })

  it('с конца списка возвращается к началу', async () => {
    const { service } = setup(row({ dutyUserId: 'c', dutyRotation: ['a', 'b', 'c'] }))
    await expect(service.rotateDuty()).resolves.toBe('a')
  })

  // Дежурный не из очереди — его назначили руками на выходные; начинаем круг сначала.
  it('дежурный вне списка → первый из очереди', async () => {
    const { service } = setup(row({ dutyUserId: 'z', dutyRotation: ['a', 'b'] }))
    await expect(service.rotateDuty()).resolves.toBe('a')
  })

  it('очередь короче двух — передавать некому', async () => {
    const { service } = setup(row({ dutyUserId: 'a', dutyRotation: ['a'] }))
    await expect(service.rotateDuty()).resolves.toBeNull()
  })

  // BUG-351: `/duty` называет следующим того же, кого выберет крон, и ничего не пишет.
  it('nextOnDuty пропускает недоступных, как смена', async () => {
    const { service, updates } = setup(
      row({ dutyUserId: 'a', dutyRotation: ['a', 'b', 'c'] }),
      null,
      ['b'],
    )
    await expect(service.nextOnDuty()).resolves.toBe('c')
    expect(updates).toHaveLength(0)
  })

  it('nextOnDuty: очередь короче двух — следующего нет', async () => {
    const { service } = setup(row({ dutyUserId: 'z', dutyRotation: ['a'] }))
    await expect(service.nextOnDuty()).resolves.toBeNull()
  })
})

describe('PlatformService — дежурный, которому бот не может написать', () => {
  // Дежурный без привязки превращает «только дежурному» в «никому»: жалобы теряются молча.
  it('не ставит в очередь человека без привязки Telegram', async () => {
    const { service, updates } = setup(row(), null, ['b'])

    const error = await service.setDuty('admin', ['a', 'b']).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AppException)
    expect((error as AppException).code).toBe('VALIDATION_ERROR')
    expect((error as AppException).details).toEqual([
      { field: 'rotation.1', message: expect.any(String) },
    ])
    expect(updates).toHaveLength(0)
  })

  it('доступность проверяет теми же условиями, что и рассылка', async () => {
    const { service, prisma } = setup(row())

    await service.setDuty('admin', ['a', 'b'])

    expect(prisma.telegramAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: { in: ['a', 'b'] },
          revokedAt: null,
          user: {
            role: { in: ['PLATFORM_ADMIN', 'PLATFORM_MODERATOR'] },
            isBlocked: false,
            deletedAt: null,
          },
        },
      }),
    )
  })

  // Отвязавшийся после постановки в очередь в списке мини-аппа уже не виден — строгая
  // проверка всего списка не дала бы убрать из очереди вообще никого.
  it('не отвергает того, кто уже стоял в очереди и с тех пор отвязался', async () => {
    const { service, updates } = setup(row({ dutyRotation: ['a', 'b', 'c'] }), null, ['a'])

    await service.setDuty('admin', ['a', 'b'])

    expect(updates.at(-1)).toMatchObject({ dutyRotation: ['a', 'b'] })
  })

  it('первым дежурным ставит первого, кому бот может написать', async () => {
    const { service, updates } = setup(row({ dutyRotation: ['a', 'b'] }), null, ['a'])

    await service.setDuty('admin', ['a', 'b'])

    expect(updates.at(-1)?.dutyUserId).toBe('b')
  })

  it('ротация пропускает тех, кому бот не может написать', async () => {
    const { service, updates, audit } = setup(
      row({ dutyUserId: 'a', dutyRotation: ['a', 'b', 'c'] }),
      null,
      ['b'],
    )

    await expect(service.rotateDuty()).resolves.toBe('c')
    expect(updates.at(-1)?.dutyUserId).toBe('c')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform.duty.rotate',
        metadata: expect.objectContaining({ to: 'c', skipped: 1 }),
      }),
    )
  })

  // Передать дежурство «никому» хуже, чем оставить прежнего: до команды дойдёт и так.
  it('если в очереди никому не написать — смену пропускает', async () => {
    const { service, updates } = setup(
      row({ dutyUserId: 'a', dutyRotation: ['a', 'b', 'c'] }),
      null,
      ['a', 'b', 'c'],
    )

    await expect(service.rotateDuty()).resolves.toBeNull()
    expect(updates).toHaveLength(0)
  })

  it('единственный доступный — текущий дежурный: оставляет его', async () => {
    const { service, updates } = setup(row({ dutyUserId: 'a', dutyRotation: ['a', 'b'] }), null, [
      'b',
    ])

    await expect(service.rotateDuty()).resolves.toBeNull()
    expect(updates).toHaveLength(0)
  })

  const SETTINGS = { quietFrom: 22, quietTo: 8, muted: [], digestHour: 9 }

  it('не назначает дежурным человека без привязки Telegram', async () => {
    const { service, updates } = setup(row(), null, ['z'])

    await expect(
      service.setNotifications('admin', { ...SETTINGS, dutyUserId: 'z' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(updates).toHaveLength(0)
  })

  it('назначает дежурным сотрудника с привязкой', async () => {
    const { service, updates } = setup(row())

    await service.setNotifications('admin', { ...SETTINGS, dutyUserId: 'a' })

    expect(updates.at(-1)?.dutyUserId).toBe('a')
  })

  // Правка тихих часов не должна падать из-за дежурного, отвязавшегося после назначения:
  // до команды уведомления дойдут и так.
  it('не проверяет прежнего дежурного, если его не меняли', async () => {
    const { service, updates, prisma } = setup(row({ dutyUserId: 'a' }), null, ['a'])

    await service.setNotifications('admin', { ...SETTINGS, dutyUserId: 'a' })

    expect(updates.at(-1)).toMatchObject({ dutyUserId: 'a', quietFrom: 22 })
    expect(prisma.telegramAccount.findMany).not.toHaveBeenCalled()
  })

  // BUG-352: рассылка глушит сводку тем же окном — в тихий час она не пришла бы никогда.
  it('не принимает час сводки внутри тихих часов', async () => {
    const { service, updates } = setup(row())

    await expect(
      service.setNotifications('admin', { ...SETTINGS, digestHour: 23, dutyUserId: null }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(updates).toHaveLength(0)
  })

  // Тишина круглые сутки — «выключить всё, не стирая настройку»: час сводки остаётся.
  it('тишина круглые сутки не стирает час сводки', async () => {
    const { service, updates } = setup(row())

    await service.setNotifications('admin', {
      ...SETTINGS,
      quietFrom: 8,
      quietTo: 8,
      dutyUserId: null,
    })

    expect(updates.at(-1)).toMatchObject({ digestHour: 9, quietFrom: 8, quietTo: 8 })
  })
})
