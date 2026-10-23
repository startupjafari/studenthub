import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { UpdateAcademicRecordSchema } from '@studenthub/shared-schemas'
import type { ConfigService } from '@nestjs/config'
import { UserService } from './users.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { PasswordService } from '../../common/security/password.service'
import type { FileService } from '../files/file.service'
import type { QueueService } from '../../common/queue'
import type { AuthService } from '../auth/auth.service'
import type { RealtimeGateway } from '../../common/realtime'
import type { AuditService } from '../../common/audit/audit.service'
import type { ExportBrandingService } from '../../common/export/export-branding.service'
import type { ExportRegistryService } from '../../common/export/export-registry.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import type Redis from 'ioredis'
import sharp from 'sharp'

function setup() {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    file: { findMany: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    // Справочник специальностей вуза: проверка специальности в учебных данных.
    specialty: { findFirst: jest.fn().mockResolvedValue(null) },
    chat: { findMany: jest.fn().mockResolvedValue([]) },
    group: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    telegramAccount: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    complaint: { count: jest.fn().mockResolvedValue(0) },
    moderationWarning: {
      create: jest.fn().mockResolvedValue({ id: 'w1' }),
      count: jest.fn().mockResolvedValue(1),
    },
    friendship: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    userBlock: { findMany: jest.fn().mockResolvedValue([]) },
    // Контент профиля, удаляемый вместе с аккаунтом (softDeleteSelf).
    profileArticle: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    poll: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    album: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    portfolioItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    bookmark: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    // advisory-лок (проверка последнего администратора платформы при удалении аккаунта).
    $executeRaw: jest.fn().mockResolvedValue(1),
    // Пакетная транзакция — массивом запросов; интерактивная получает этот же мок как tx.
    $transaction: jest.fn((arg: unknown): Promise<unknown> =>
      typeof arg === 'function'
        ? Promise.resolve((arg as (tx: unknown) => unknown)(prisma))
        : Promise.all(arg as Promise<unknown>[]),
    ),
  }
  const passwords = { hash: jest.fn(), compare: jest.fn() }
  const files = {
    upload: jest.fn(),
    delete: jest.fn(),
    getObjectBuffer: jest.fn(),
    removeRawObject: jest.fn(),
    listByOwnerAndBucket: jest.fn().mockResolvedValue([]),
  }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn() }
  const authService = { revokeAllUserSessions: jest.fn().mockResolvedValue(undefined) }
  const realtime = { isOnline: jest.fn().mockReturnValue(false) }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  // Брендирование проверяется своим тестом (common/export); здесь достаточно заглушки,
  // которая отдаёт узнаваемые значения.
  const branding = {
    labels: jest.fn().mockReturnValue({ dataSheet: 'Данные', infoSheet: 'Инфо' }),
    infoRows: jest.fn().mockReturnValue([['Система', 'StudentHub']]),
    sheetMetadata: jest.fn().mockReturnValue({}),
    filename: jest.fn().mockReturnValue('studenthub_users_2026-09-13.xlsx'),
    resolveLocale: jest.fn().mockReturnValue('ru'),
  }
  const exportRegistry = {
    register: jest.fn().mockResolvedValue({ id: 'e-1', shortId: 'ABCD2345' }),
  }
  // Redis как Map: счётчик неверных текущих паролей при смене пароля.
  const store = new Map<string, string>()
  const redis = {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    multi: jest.fn(() => {
      const chain = {
        incr: (key: string) => {
          store.set(key, String(Number(store.get(key) ?? 0) + 1))
          return chain
        },
        expire: () => chain,
        exec: async () => [],
      }
      return chain
    }),
  }
  const service = new UserService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    files as unknown as FileService,
    queue as unknown as QueueService,
    config as unknown as ConfigService<EnvVars, true>,
    authService as unknown as AuthService,
    realtime as unknown as RealtimeGateway,
    audit as unknown as AuditService,
    branding as unknown as ExportBrandingService,
    exportRegistry as unknown as ExportRegistryService,
    redis as unknown as Redis,
  )
  return {
    redis,
    service,
    prisma,
    passwords,
    files,
    queue,
    config,
    authService,
    realtime,
    audit,
    branding,
    exportRegistry,
  }
}

const target = {
  id: 'target-1',
  email: 'target@uni-a.io',
  firstName: 'Тар',
  lastName: 'Гет',
  avatarUrl: null,
  role: Role.STUDENT,
  showEmail: false,
  // PUBLIC — чтобы тесты полевой приватности email проверяли именно её, а не слой видимости.
  profileVisibility: 'PUBLIC',
  gpa: 4.5,
  universityId: 'uni-A',
  facultyId: 'fac-A',
  groupId: 'grp-A',
}

function viewer(role: Role, scope: Partial<JwtPayload> = {}, sub = 'viewer'): JwtPayload {
  return {
    sub,
    role,
    universityId: scope.universityId ?? null,
    facultyId: scope.facultyId ?? null,
    groupId: scope.groupId ?? null,
  }
}

// Регрессия: auth-выборки для токена ОБЯЗАНЫ включать twoFactorEnabled, иначе toPayload
// проставит tfa:false даже при включённой 2FA → TwoFactorGuard зациклит на /setup-2fa.
describe('UserService — auth-выборки несут twoFactorEnabled (для флага tfa в токене)', () => {
  it('findByIdForAuth (refresh) выбирает twoFactorEnabled', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(null)
    await service.findByIdForAuth('u1')
    expect(prisma.user.findFirst.mock.calls[0][0].select.twoFactorEnabled).toBe(true)
  })

  it('findByLoginIdentifierForAuth (логин) выбирает twoFactorEnabled', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(null)
    await service.findByLoginIdentifierForAuth('a@b.io')
    expect(prisma.user.findFirst.mock.calls[0][0].select.twoFactorEnabled).toBe(true)
  })
})

// Регрессия: компания работодателя попадает в токен на ЛЮБОМ пути выдачи сессии. Второй шаг
// входа с 2FA её не выбирал — работодатель до первого refresh видел «не привязан к компании».
describe('UserService — auth-выборки несут компанию работодателя (companyId в токене)', () => {
  it.each([
    [
      'findByLoginIdentifierForAuth (логин)',
      (s: UserService) => s.findByLoginIdentifierForAuth('a@b.io'),
    ],
    ['findByIdForAuth (refresh)', (s: UserService) => s.findByIdForAuth('u1')],
    ['getTwoFactorForLogin (вход с 2FA)', (s: UserService) => s.getTwoFactorForLogin('u1')],
  ])('%s выбирает companyMembership', async (_name, call) => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(null)
    await call(service)
    expect(prisma.user.findFirst.mock.calls[0][0].select.companyMembership).toEqual({
      select: { companyId: true },
    })
  })
})

// A-F01: email сравнивается без учёта регистра. До нормализации адрес сохранялся как пришёл
// («Ivanov@Uni.kz»), и форма «Забыли пароль» (она приводит адрес к нижнему регистру) такую
// учётку не находила никогда, а вход по email требовал угадать регистр.
describe('UserService — email без учёта регистра (вход, сброс пароля)', () => {
  const legacy = { id: 'u-legacy', email: 'Ivanov@Uni.kz' }

  it('вход: сначала точное совпадение в нижнем регистре — по индексу', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' })
    await expect(service.findByLoginIdentifierForAuth('  Ivanov@Uni.KZ ')).resolves.toEqual({
      id: 'u1',
    })
    expect(prisma.user.findFirst.mock.calls[0][0].where.OR).toEqual([
      { email: 'ivanov@uni.kz' },
      { username: 'ivanov@uni.kz' },
    ])
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('вход: старая запись со смешанным регистром находится запасным поиском', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(null)
    prisma.user.findMany.mockResolvedValue([legacy])
    await expect(service.findByLoginIdentifierForAuth('ivanov@uni.kz')).resolves.toBe(legacy)
    // `in`, а не `equals`: insensitive-equals Prisma строит через ILIKE, где `_` — шаблон.
    expect(prisma.user.findMany.mock.calls[0][0]).toMatchObject({
      where: { deletedAt: null, email: { in: ['ivanov@uni.kz'], mode: 'insensitive' } },
      take: 2,
    })
  })

  it('вход по username запасным поиском email не ходит', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(null)
    await expect(service.findByLoginIdentifierForAuth('Ivanov')).resolves.toBeNull()
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('несколько учёток с одним адресом в разном регистре — отказ и запись в лог', async () => {
    const { service, prisma } = setup()
    const { logger } = service as unknown as { logger: { warn: (message: string) => void } }
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined)
    prisma.user.findFirst.mockResolvedValue(null)
    prisma.user.findMany.mockResolvedValue([legacy, { id: 'u-dup', email: 'IVANOV@uni.kz' }])
    await expect(service.findByLoginIdentifierForAuth('ivanov@uni.kz')).resolves.toBeNull()
    await expect(service.findForPasswordReset('ivanov@uni.kz')).resolves.toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(String(warn.mock.calls[0]?.[0])).toContain('u-legacy, u-dup')
  })

  it('сброс пароля находит учётку, записанную до нормализации', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(null)
    prisma.user.findMany.mockResolvedValue([legacy])
    await expect(service.findForPasswordReset('ivanov@uni.kz')).resolves.toBe(legacy)
    expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({
      email: 'ivanov@uni.kz',
      deletedAt: null,
    })
  })

  it('регистрация: адрес занят и в другом регистре', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'u-legacy' })
    await expect(service.findEmailOwnerId('ivanov@uni.kz')).resolves.toBe('u-legacy')
    expect(prisma.user.findFirst.mock.calls[1][0].where).toEqual({
      email: { in: ['ivanov@uni.kz'], mode: 'insensitive' },
    })
  })
})

describe('UserService — приватность профиля', () => {
  it('сам себя — email виден', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(target)
    const res = await service.getProfileForViewer('target-1', viewer(Role.STUDENT, {}, 'target-1'))
    expect(res.email).toBe('target@uni-a.io')
  })

  it('другой студент — email скрыт (null)', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(target)
    const res = await service.getProfileForViewer(
      'target-1',
      viewer(Role.STUDENT, { universityId: 'uni-A', groupId: 'grp-A' }, 'other'),
    )
    expect(res.email).toBeNull()
    expect(res.firstName).toBe('Тар')
  })

  it('платформенный админ — email виден', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(target)
    const res = await service.getProfileForViewer('target-1', viewer(Role.PLATFORM_ADMIN))
    expect(res.email).toBe('target@uni-a.io')
  })

  it('админ своего вуза — виден; чужого — скрыт', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(target)
    const same = await service.getProfileForViewer(
      'target-1',
      viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-A' }),
    )
    expect(same.email).toBe('target@uni-a.io')
    prisma.user.findFirst.mockResolvedValue(target)
    const other = await service.getProfileForViewer(
      'target-1',
      viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-B' }),
    )
    expect(other.email).toBeNull()
  })

  it('декан своего факультета — email виден', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(target)
    const res = await service.getProfileForViewer(
      'target-1',
      viewer(Role.DEAN, { universityId: 'uni-A', facultyId: 'fac-A' }),
    )
    expect(res.email).toBe('target@uni-a.io')
  })

  it('showEmail=true — email виден кому угодно', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({ ...target, showEmail: true })
    const res = await service.getProfileForViewer('target-1', viewer(Role.STUDENT, {}, 'other'))
    expect(res.email).toBe('target@uni-a.io')
  })

  it('не найден → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(null)
    await expect(service.getProfileForViewer('x', viewer(Role.STUDENT))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  // A-F15: язык интерфейса уходил в полной чужой карточке — белый список держался на
  // ручном разборе полей, и locale из него выпал.
  it('чужой полный профиль не содержит locale, username и флага 2FA', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({
      ...target,
      locale: 'kk',
      username: 'secret_login',
      twoFactorEnabled: true,
    })
    const res = await service.getProfileForViewer(
      'target-1',
      viewer(Role.PLATFORM_ADMIN, {}, 'admin'),
    )
    expect(res.access).toBe('full')
    expect(res).not.toHaveProperty('locale')
    expect(res).not.toHaveProperty('username')
    expect(res).not.toHaveProperty('twoFactorEnabled')
  })
})

describe('UserService — закрытый профиль (видимость по ролям)', () => {
  const priv = { ...target, profileVisibility: 'PRIVATE' }
  const uni = { ...target, profileVisibility: 'UNIVERSITY' }

  it('PUBLIC — полный профиль любому авторизованному', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(target)
    const res = await service.getProfileForViewer('target-1', viewer(Role.STUDENT, {}, 'other'))
    expect(res.access).toBe('full')
    expect(res.firstName).toBe('Тар')
  })

  it('UNIVERSITY — свой вуз видит full, чужой — limited', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(uni)
    const inside = await service.getProfileForViewer(
      'target-1',
      viewer(Role.STUDENT, { universityId: 'uni-A' }, 'other'),
    )
    expect(inside.access).toBe('full')
    prisma.user.findFirst.mockResolvedValue(uni)
    const outside = await service.getProfileForViewer(
      'target-1',
      viewer(Role.STUDENT, { universityId: 'uni-B' }, 'other'),
    )
    expect(outside.access).toBe('limited')
    // Визитка не отдаёт детали.
    expect(outside.bio).toBeNull()
    expect(outside.email).toBeNull()
    expect(outside.firstName).toBe('Тар')
  })

  it('PRIVATE — обычный студент своего вуза видит только limited', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(priv)
    const res = await service.getProfileForViewer(
      'target-1',
      viewer(Role.STUDENT, { universityId: 'uni-A', groupId: 'grp-A' }, 'other'),
    )
    expect(res.access).toBe('limited')
  })

  it('PRIVATE — декан своего факультета пробивает и пишет аудит', async () => {
    const { service, prisma, audit } = setup()
    prisma.user.findFirst.mockResolvedValue(priv)
    const res = await service.getProfileForViewer(
      'target-1',
      viewer(Role.DEAN, { universityId: 'uni-A', facultyId: 'fac-A' }),
    )
    expect(res.access).toBe('full')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROFILE_VIEW_PRIVATE', entityId: 'target-1' }),
    )
  })

  it('PUBLIC-надзор (не PRIVATE) — аудит НЕ пишется', async () => {
    const { service, prisma, audit } = setup()
    prisma.user.findFirst.mockResolvedValue(target)
    await service.getProfileForViewer('target-1', viewer(Role.PLATFORM_ADMIN))
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('преподаватель своего вуза — full, но PRIVATE не пробивает', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(uni)
    const full = await service.getProfileForViewer(
      'target-1',
      viewer(Role.TEACHER, { universityId: 'uni-A' }),
    )
    expect(full.access).toBe('full')
    prisma.user.findFirst.mockResolvedValue(priv)
    const limited = await service.getProfileForViewer(
      'target-1',
      viewer(Role.TEACHER, { universityId: 'uni-A' }),
    )
    expect(limited.access).toBe('limited')
  })

  it('gpa виден владельцу и декану, скрыт одногруппнику и старосте', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(target)
    const own = await service.getProfileForViewer('target-1', viewer(Role.STUDENT, {}, 'target-1'))
    expect(own.gpa).toBe(4.5)
    prisma.user.findFirst.mockResolvedValue(target)
    const dean = await service.getProfileForViewer(
      'target-1',
      viewer(Role.DEAN, { universityId: 'uni-A', facultyId: 'fac-A' }),
    )
    expect(dean.gpa).toBe(4.5)
    prisma.user.findFirst.mockResolvedValue(target)
    const starosta = await service.getProfileForViewer(
      'target-1',
      viewer(Role.STAROSTA, { universityId: 'uni-A', facultyId: 'fac-A', groupId: 'grp-A' }, 'st'),
    )
    expect(starosta.access).toBe('full')
    expect(starosta.gpa).toBeNull()
  })

  it('дата рождения, форма оплаты, статус и общежитие — как gpa: одногруппнику не видны', async () => {
    const { service, prisma } = setup()
    const personal = {
      ...target,
      birthDate: new Date('2005-03-01'),
      fundingType: 'Грант',
      academicStatus: 'Обучающийся',
      dormitory: 'Да',
    }
    prisma.user.findFirst.mockResolvedValue(personal)
    const peer = await service.getProfileForViewer(
      'target-1',
      viewer(Role.STUDENT, { universityId: 'uni-A', facultyId: 'fac-A', groupId: 'grp-A' }, 'p'),
    )
    expect(peer.access).toBe('full')
    expect(peer).toMatchObject({
      birthDate: null,
      fundingType: null,
      academicStatus: null,
      dormitory: null,
    })
    prisma.user.findFirst.mockResolvedValue(personal)
    const admin = await service.getProfileForViewer(
      'target-1',
      viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-A' }),
    )
    expect(admin).toMatchObject({ fundingType: 'Грант', dormitory: 'Да' })
  })

  it('createInvitedUser — дефолт видимости по роли (студент → UNIVERSITY, декан → PUBLIC)', async () => {
    const { service, prisma } = setup()
    const tx = {
      user: {
        create: jest.fn().mockResolvedValue({
          id: 'n',
          role: Role.STUDENT,
          universityId: null,
          facultyId: null,
          groupId: null,
        }),
      },
    }
    await service.createInvitedUser(tx as never, {
      email: 'a@b.io',
      username: 'user_ab',
      passwordHash: 'h',
      firstName: 'A',
      lastName: 'B',
      role: Role.STUDENT,
      universityId: null,
      facultyId: null,
      groupId: null,
      // Поля согласия к видимости профиля отношения не имеют, но входят в тип: с
      // сентября 2026 пользователь без записанного согласия не создаётся.
      birthDate: new Date('2000-01-01T00:00:00Z'),
      consentAt: new Date('2026-09-30T00:00:00Z'),
      consentVersion: '2026-09-30',
      consentByGuardian: false,
    })
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ profileVisibility: 'UNIVERSITY' }),
      }),
    )
    tx.user.create.mockResolvedValue({
      id: 'n2',
      role: Role.DEAN,
      universityId: null,
      facultyId: null,
      groupId: null,
    })
    await service.createInvitedUser(tx as never, {
      email: 'c@d.io',
      username: 'user_cd',
      passwordHash: 'h',
      firstName: 'C',
      lastName: 'D',
      role: Role.DEAN,
      universityId: null,
      facultyId: null,
      groupId: null,
      // Поля согласия к видимости профиля отношения не имеют, но входят в тип: с
      // сентября 2026 пользователь без записанного согласия не создаётся.
      birthDate: new Date('2000-01-01T00:00:00Z'),
      consentAt: new Date('2026-09-30T00:00:00Z'),
      consentVersion: '2026-09-30',
      consentByGuardian: false,
    })
    expect(tx.user.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ profileVisibility: 'PUBLIC' }) }),
    )
    void prisma
  })
})

describe('UserService — дружба и личная блокировка (контент профиля)', () => {
  const priv = { ...target, profileVisibility: 'PRIVATE', deletedAt: null }
  const friend = viewer(Role.STUDENT, { universityId: 'uni-B' }, 'friend')

  it('принятая дружба открывает закрытый профиль', async () => {
    const { service, prisma } = setup()
    prisma.friendship.findMany.mockResolvedValue([
      { requesterId: 'friend', addresseeId: 'target-1' },
    ])
    expect(await service.canViewProfileContentOf(friend, priv)).toBe(true)
  })

  // Сценарий травли: человек блокирует бывшего друга, а дружба продолжала открывать ему всё.
  it('блокировка в любую сторону гасит дружбу: закрытый профиль не открывается', async () => {
    const { service, prisma } = setup()
    prisma.friendship.findMany.mockResolvedValue([
      { requesterId: 'friend', addresseeId: 'target-1' },
    ])
    prisma.userBlock.findMany.mockResolvedValue([{ blockerId: 'target-1', blockedId: 'friend' }])
    expect(await service.canViewProfileContentOf(friend, priv)).toBe(false)

    prisma.user.findFirst.mockResolvedValue(priv)
    const card = await service.getProfileForViewer('target-1', friend)
    expect(card.access).toBe('limited')
  })

  it('контент удалённого аккаунта не виден никому, даже платформе', async () => {
    const { service } = setup()
    const deleted = { ...target, deletedAt: new Date() }
    expect(await service.canViewProfileContentOf(viewer(Role.PLATFORM_ADMIN), deleted)).toBe(false)
  })

  it('пачкой: дружба и блокировки — по одному запросу на всех авторов', async () => {
    const { service, prisma } = setup()
    const open = { ...target, id: 'open', deletedAt: null }
    const closedFriend = { ...priv, id: 'closed-friend' }
    const closedBlocked = { ...priv, id: 'closed-blocked' }
    prisma.friendship.findMany.mockResolvedValue([
      { requesterId: 'friend', addresseeId: 'closed-friend' },
      { requesterId: 'closed-blocked', addresseeId: 'friend' },
    ])
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: 'friend', blockedId: 'closed-blocked' },
    ])
    const visible = await service.viewableProfileContentOwners(friend, [
      open,
      closedFriend,
      closedBlocked,
      closedFriend,
    ])
    expect([...visible].sort()).toEqual(['closed-friend', 'open'])
    expect(prisma.friendship.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.userBlock.findMany).toHaveBeenCalledTimes(1)
  })
})

describe('UserService — changePassword', () => {
  it('неверный текущий → BAD_REQUEST, пароль не меняется', async () => {
    const { service, prisma, passwords } = setup()
    prisma.user.findFirst.mockResolvedValue({ passwordHash: 'h' })
    passwords.compare.mockResolvedValue(false)
    await expect(service.changePassword('u', 'wrong', 'New1234!')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('успех → обновляет хеш и гасит все сессии', async () => {
    const { service, prisma, passwords, authService } = setup()
    prisma.user.findFirst.mockResolvedValue({ passwordHash: 'h' })
    passwords.compare.mockResolvedValue(true)
    passwords.hash.mockResolvedValue('new-hash')
    prisma.user.update.mockResolvedValue({})
    await service.changePassword('u', 'Old1234!', 'New1234!')
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u' },
      data: { passwordHash: 'new-hash' },
    })
    expect(authService.revokeAllUserSessions).toHaveBeenCalledWith('u')
  })

  // A-F12: с украденным access-токеном текущий пароль перебирался под общим лимитом
  // 100/мин, а угаданный тут же менялся — захват учётки.
  it('после пяти неверных текущих паролей — RATE_LIMIT даже с верным, пароль не меняется', async () => {
    const { service, prisma, passwords } = setup()
    prisma.user.findFirst.mockResolvedValue({ passwordHash: 'h' })
    passwords.compare.mockResolvedValue(false)
    for (let i = 0; i < 5; i++) {
      await expect(service.changePassword('u', 'wrong', 'New1234!')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
    }
    passwords.compare.mockResolvedValue(true)
    await expect(service.changePassword('u', 'Old1234!', 'New1234!')).rejects.toMatchObject({
      code: 'RATE_LIMIT',
    })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('верный пароль сбрасывает счётчик промахов', async () => {
    const { service, prisma, passwords, redis } = setup()
    prisma.user.findFirst.mockResolvedValue({ passwordHash: 'h' })
    prisma.user.update.mockResolvedValue({})
    passwords.compare.mockResolvedValueOnce(false).mockResolvedValue(true)
    await service.changePassword('u', 'wrong', 'New1234!').catch(() => undefined)
    expect(redis.store.get('password-change:fails:u')).toBe('1')

    await service.changePassword('u', 'Old1234!', 'New1234!')
    expect(redis.store.has('password-change:fails:u')).toBe(false)
  })

  it('недоступный Redis не мешает смене пароля', async () => {
    const { service, prisma, passwords, redis } = setup()
    prisma.user.findFirst.mockResolvedValue({ passwordHash: 'h' })
    prisma.user.update.mockResolvedValue({})
    passwords.compare.mockResolvedValue(true)
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'))
    redis.del.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(service.changePassword('u', 'Old1234!', 'New1234!')).resolves.toBeUndefined()
  })

  it('смена пароля пишется в аудит с адресом, без паролей', async () => {
    const { service, prisma, passwords, audit } = setup()
    prisma.user.findFirst.mockResolvedValue({ passwordHash: 'h' })
    prisma.user.update.mockResolvedValue({})
    passwords.compare.mockResolvedValue(true)
    passwords.hash.mockResolvedValue('new-hash')
    await service.changePassword('u', 'Old1234!', 'New1234!', { ip: '203.0.113.5' })
    expect(audit.record).toHaveBeenCalledWith({
      userId: 'u',
      action: 'password_changed',
      entity: 'User',
      entityId: 'u',
      ip: '203.0.113.5',
    })
  })
})

describe('UserService — староста по инвайту', () => {
  it('ставит отметку в группе и оставляет в ней одного старосту', async () => {
    const { service } = setup()
    const tx = {
      group: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'u-old' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const demoted = await service.assignInvitedStarosta(tx as never, 'grp-1', 'u-new')
    expect(tx.group.updateMany).toHaveBeenCalledWith({
      where: { id: 'grp-1' },
      data: { starostaId: 'u-new' },
    })
    // Прежний староста группы возвращается в студенты; новый в выборку не попадает.
    expect(tx.user.findMany.mock.calls[0][0].where).toMatchObject({
      groupId: 'grp-1',
      role: Role.STAROSTA,
      id: { not: 'u-new' },
    })
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['u-old'] } },
      data: { role: Role.STUDENT, starostaSince: null },
    })
    expect(demoted).toEqual(['u-old'])
  })
})

describe('UserService — softDeleteSelf', () => {
  function withBuckets(config: { get: jest.Mock }) {
    config.get.mockImplementation((key: string) =>
      key === 'MINIO_BUCKET_AVATARS'
        ? 'avatars'
        : key === 'MINIO_BUCKET_PROFILE_COVERS'
          ? 'profile-covers'
          : key === 'MINIO_BUCKET_PROFILE_MEDIA'
            ? 'profile-media'
            : undefined,
    )
  }

  it('затирает ВСЕ ПДн, гасит 2FA/приватность и разлогинивает', async () => {
    const { service, prisma, passwords, authService, config } = setup()
    withBuckets(config)
    passwords.hash.mockResolvedValue('anon')
    prisma.user.update.mockResolvedValue({})
    await service.softDeleteSelf('u')
    const { data } = prisma.user.update.mock.calls[0][0]
    expect(data.deletedAt).toBeInstanceOf(Date)
    expect(data.email).toContain('deleted+u@')
    // Ни одно персональное поле не должно пережить удаление.
    for (const field of [
      'avatarUrl',
      'avatarThumbUrl',
      'coverUrl',
      'phone',
      'telegram',
      'instagram',
      'middleName',
      'bio',
      'birthDate',
      'address',
      'studentCardNumber',
      'gpa',
      'dormitory',
      'twoFactorSecret',
      'department',
      'employeeNumber',
    ]) {
      expect(data[field]).toBeNull()
    }
    expect(data.showEmail).toBe(false)
    expect(data.showPhone).toBe(false)
    expect(data.profileVisibility).toBe('PRIVATE')
    expect(data.twoFactorEnabled).toBe(false)
    expect(data.twoFactorBackupCodes).toEqual([])
    expect(data.interests).toEqual([])
    expect(authService.revokeAllUserSessions).toHaveBeenCalledWith('u')
  })

  it('удаление аккаунта пишется в аудит — только id, без ПДн', async () => {
    const { service, prisma, passwords, audit, config } = setup()
    withBuckets(config)
    passwords.hash.mockResolvedValue('anon')
    prisma.user.update.mockResolvedValue({})
    await service.softDeleteSelf('u', { ip: '203.0.113.5' })
    expect(audit.record).toHaveBeenCalledWith({
      userId: 'u',
      action: 'account_deleted',
      entity: 'User',
      entityId: 'u',
      ip: '203.0.113.5',
    })
  })

  it('староста: освобождает имя входа, выходит из группы и снимает отметку старосты', async () => {
    const { service, prisma, passwords, config } = setup()
    withBuckets(config)
    passwords.hash.mockResolvedValue('anon')
    prisma.user.findUnique.mockResolvedValue({ role: Role.STAROSTA })
    prisma.user.update.mockResolvedValue({})
    await service.softDeleteSelf('u')
    const { data } = prisma.user.update.mock.calls[0][0]
    expect(data.username).toBeNull()
    expect(data.groupId).toBeNull()
    expect(data.role).toBe(Role.STUDENT)
    expect(prisma.group.updateMany).toHaveBeenCalledWith({
      where: { starostaId: 'u' },
      data: { starostaId: null },
    })
  })

  // Бот и мини-апп узнают человека по telegramId, а не по сессии: разлогин этот канал
  // не гасит, и удалённый сотрудник платформы продолжал бы работать через Telegram.
  it('снимает привязку Telegram в той же транзакции', async () => {
    const { service, prisma, passwords, config } = setup()
    withBuckets(config)
    passwords.hash.mockResolvedValue('anon')
    prisma.user.findUnique.mockResolvedValue({ role: Role.PLATFORM_MODERATOR })
    prisma.user.update.mockResolvedValue({})
    await service.softDeleteSelf('u')
    expect(prisma.telegramAccount.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u' } })
    // Анонимизация, староста, Telegram и пять видов контента профиля — одной транзакцией.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function))
  })

  // Статьи, опросы, альбомы и портфолио после удаления продолжали отдаваться с исходным
  // текстом под «Удалённым пользователем».
  it('удаляет статьи, опросы, альбомы, портфолио и закладки в той же транзакции', async () => {
    const { service, prisma, passwords, config } = setup()
    withBuckets(config)
    passwords.hash.mockResolvedValue('anon')
    prisma.user.update.mockResolvedValue({})
    await service.softDeleteSelf('u')
    for (const model of [
      prisma.profileArticle,
      prisma.poll,
      prisma.album,
      prisma.portfolioItem,
      prisma.bookmark,
    ]) {
      expect(model.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u' } })
    }
  })

  // Бакеты профиля публичные: без удаления объектов фото и видео оставались доступны по
  // разошедшимся прямым ссылкам навсегда.
  it('сносит фото/видео профиля и обложки статей вместе с постерами видео', async () => {
    const { service, prisma, passwords, files, config } = setup()
    withBuckets(config)
    passwords.hash.mockResolvedValue('anon')
    prisma.user.update.mockResolvedValue({})
    files.listByOwnerAndBucket.mockImplementation(async (_owner: string, bucket: string) =>
      bucket === 'profile-media' ? [{ id: 'vid-1', posterKey: 'poster.webp' }] : [],
    )
    // После удаления пачка пуста — цикл заканчивается.
    files.delete.mockImplementation(async () => {
      files.listByOwnerAndBucket.mockResolvedValue([])
    })
    await service.softDeleteSelf('u')
    expect(files.listByOwnerAndBucket).toHaveBeenCalledWith('u', 'profile-media', 100)
    expect(files.listByOwnerAndBucket).toHaveBeenCalledWith('u', 'profile-covers', 100)
    expect(files.delete).toHaveBeenCalledWith('vid-1')
    expect(files.removeRawObject).toHaveBeenCalledWith('profile-covers', 'poster.webp')
  })

  it('файл, который не удаётся снести, не зацикливает удаление аккаунта', async () => {
    const { service, prisma, passwords, files, config } = setup()
    withBuckets(config)
    passwords.hash.mockResolvedValue('anon')
    prisma.user.update.mockResolvedValue({})
    files.listByOwnerAndBucket.mockResolvedValue([{ id: 'stuck', posterKey: null }])
    files.delete.mockRejectedValue(new Error('minio down'))
    await expect(service.softDeleteSelf('u')).resolves.toBeUndefined()
    // По одному кругу на бакет: пачка без единого удаления дальше не крутится.
    expect(files.delete).toHaveBeenCalledTimes(2)
    expect(prisma.user.update).toHaveBeenCalled()
  })

  it('сносит объекты аватара и обложки в MinIO', async () => {
    const { service, prisma, passwords, files, config } = setup()
    withBuckets(config)
    passwords.hash.mockResolvedValue('anon')
    prisma.file.findMany.mockResolvedValue([{ id: 'av-1' }])
    prisma.user.findUnique.mockResolvedValue({ coverUrl: 'http://m/profile-covers/cover.webp' })
    prisma.user.update.mockResolvedValue({})
    await service.softDeleteSelf('u')
    expect(files.delete).toHaveBeenCalledWith('av-1')
    expect(files.removeRawObject).toHaveBeenCalledWith('profile-covers', 'cover.webp')
  })

  it('не падает, если MinIO недоступен (best-effort очистка файлов)', async () => {
    const { service, prisma, passwords, config } = setup()
    withBuckets(config)
    passwords.hash.mockResolvedValue('anon')
    prisma.file.findMany.mockRejectedValue(new Error('minio down'))
    prisma.user.update.mockResolvedValue({})
    await expect(service.softDeleteSelf('u')).resolves.toBeUndefined()
    // ПДн всё равно затёрты.
    expect(prisma.user.update).toHaveBeenCalled()
  })
})

// A-F13: необратимое удаление запускал любой, у кого открытая вкладка или access-токен.
describe('UserService — удаление аккаунта с повторной аутентификацией', () => {
  function account(
    prisma: ReturnType<typeof setup>['prisma'],
    extra: Record<string, unknown> = {},
  ) {
    prisma.user.findFirst.mockResolvedValue({
      role: Role.STUDENT,
      passwordHash: 'h',
      twoFactorEnabled: false,
      ...extra,
    })
    prisma.user.update.mockResolvedValue({})
  }
  const verifyNever = () => jest.fn().mockResolvedValue(true)

  it('без пароля — BAD_REQUEST, аккаунт не тронут', async () => {
    const { service, prisma, passwords } = setup()
    account(prisma)
    await expect(service.deleteOwnAccount('u', {}, verifyNever())).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(passwords.compare).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('неверный пароль — BAD_REQUEST, промах в общем счётчике со сменой пароля', async () => {
    const { service, prisma, passwords, redis } = setup()
    account(prisma)
    passwords.compare.mockResolvedValue(false)
    await expect(
      service.deleteOwnAccount('u', { password: 'wrong' }, verifyNever()),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(redis.store.get('password-change:fails:u')).toBe('1')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('верный пароль без 2FA — аккаунт удалён', async () => {
    const { service, prisma, passwords, authService } = setup()
    account(prisma)
    passwords.compare.mockResolvedValue(true)
    passwords.hash.mockResolvedValue('anon')
    const verify = verifyNever()
    await service.deleteOwnAccount('u', { password: 'Secret123' }, verify)
    expect(verify).not.toHaveBeenCalled()
    expect(prisma.user.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date)
    expect(authService.revokeAllUserSessions).toHaveBeenCalledWith('u')
  })

  it('2FA включена: без кода — BAD_REQUEST, пароль даже не сверяется', async () => {
    const { service, prisma, passwords } = setup()
    account(prisma, { twoFactorEnabled: true })
    await expect(
      service.deleteOwnAccount('u', { password: 'Secret123' }, verifyNever()),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(passwords.compare).not.toHaveBeenCalled()
  })

  it('2FA включена: неверный код — INVALID_2FA_CODE, аккаунт не тронут', async () => {
    const { service, prisma, passwords } = setup()
    account(prisma, { twoFactorEnabled: true })
    passwords.compare.mockResolvedValue(true)
    const verify = jest.fn().mockResolvedValue(false)
    await expect(
      service.deleteOwnAccount('u', { password: 'Secret123', code: '000000' }, verify),
    ).rejects.toMatchObject({ code: 'INVALID_2FA_CODE' })
    expect(verify).toHaveBeenCalledWith('000000')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('2FA: код проверяется только после верного пароля — резервный код не сгорает зря', async () => {
    const { service, prisma, passwords } = setup()
    account(prisma, { twoFactorEnabled: true })
    passwords.compare.mockResolvedValue(false)
    const verify = jest.fn().mockResolvedValue(true)
    await expect(
      service.deleteOwnAccount('u', { password: 'wrong', code: 'ABCD-EFGH' }, verify),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(verify).not.toHaveBeenCalled()
  })

  it('последний действующий администратор платформы — CONFLICT до пароля и кода', async () => {
    const { service, prisma, passwords, files } = setup()
    account(prisma, { role: Role.PLATFORM_ADMIN, twoFactorEnabled: true })
    prisma.user.count.mockResolvedValue(0)
    const verify = jest.fn().mockResolvedValue(true)
    await expect(
      service.deleteOwnAccount('u', { password: 'Secret123', code: '123456' }, verify),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: {
        role: Role.PLATFORM_ADMIN,
        deletedAt: null,
        isBlocked: false,
        id: { not: 'u' },
      },
    })
    expect(passwords.compare).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
    expect(files.listByOwnerAndBucket).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('администратор платформы при живом втором — удаляется, проверка повторяется под локом', async () => {
    const { service, prisma, passwords } = setup()
    account(prisma, { role: Role.PLATFORM_ADMIN })
    prisma.user.findUnique.mockResolvedValue({ role: Role.PLATFORM_ADMIN })
    prisma.user.count.mockResolvedValue(1)
    passwords.compare.mockResolvedValue(true)
    passwords.hash.mockResolvedValue('anon')
    await service.deleteOwnAccount('u', { password: 'Secret123' }, verifyNever())
    // Лок — в транзакции анонимизации, перед повторным подсчётом.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prisma.user.count).toHaveBeenCalledTimes(3)
    expect(prisma.user.update).toHaveBeenCalled()
  })

  it('пока удалял себя, второй администратор ушёл — транзакция отказывает, ПДн не затёрты', async () => {
    const { service, prisma } = setup()
    prisma.user.findUnique.mockResolvedValue({ role: Role.PLATFORM_ADMIN })
    // До сноса медиа второй ещё был, под локом в транзакции — уже нет.
    prisma.user.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    await expect(service.softDeleteSelf('u')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })
})

describe('UserService — avatar', () => {
  function withAvatarConfig(config: { get: jest.Mock }) {
    config.get.mockImplementation((key: string) => {
      switch (key) {
        case 'MINIO_BUCKET_AVATARS':
          return 'avatars'
        case 'MINIO_USE_SSL':
          return false
        case 'MINIO_ENDPOINT':
          return 'localhost'
        case 'MINIO_PORT':
          return 9000
        default:
          return undefined
      }
    })
  }

  it('setAvatar: удаляет прежние, грузит с категорией IMAGE и пишет публичный URL', async () => {
    const { service, prisma, files, queue, config } = setup()
    withAvatarConfig(config)
    prisma.file.findMany.mockResolvedValue([{ id: 'old-1', key: 'old-1.png' }])
    files.upload.mockResolvedValue({ id: 'file-1', key: 'new-key.png' })
    prisma.user.update.mockResolvedValue({ id: 'u', avatarUrl: 'x' })

    await service.setAvatar('u', Buffer.from('img'))

    expect(files.delete).toHaveBeenCalledWith('old-1')
    // Прежние ищутся без только что загруженного, и сносятся уже после записи нового URL.
    expect(prisma.file.findMany.mock.calls[0][0].where).toEqual({
      ownerId: 'u',
      bucket: 'avatars',
      id: { not: 'file-1' },
    })
    expect(prisma.user.update.mock.invocationCallOrder[0]).toBeLessThan(
      files.delete.mock.invocationCallOrder[0]!,
    )
    expect(files.upload).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'avatars', ownerId: 'u', expectedCategory: 'IMAGE' }),
    )
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u' },
      data: { avatarUrl: 'http://localhost:9000/avatars/new-key.png', avatarThumbUrl: null },
      select: expect.anything(),
    })
    // Тяжёлый ресайз уходит в очередь file-processing с идемпотентным jobId.
    expect(queue.enqueue).toHaveBeenCalledWith(
      'file-processing',
      'generate-thumbnail',
      expect.objectContaining({
        fileId: 'file-1',
        bucket: 'avatars',
        key: 'new-key.png',
        userId: 'u',
      }),
      expect.objectContaining({ jobId: 'thumb_file-1' }),
    )
  })

  // A-F14: прежние объекты удалялись до проверки нового файла — подменённое расширение или
  // сбой MinIO оставляли в профиле ссылку на снесённый аватар.
  it('setAvatar: новый файл отклонён — прежний аватар и профиль целы', async () => {
    const { service, prisma, files, config } = setup()
    withAvatarConfig(config)
    prisma.file.findMany.mockResolvedValue([{ id: 'old-1', key: 'old-1.png' }])
    files.upload.mockRejectedValue(
      new AppException('FILE_TYPE_NOT_ALLOWED', 'Недопустимый тип файла'),
    )

    await expect(service.setAvatar('u', Buffer.from('not-an-image'))).rejects.toMatchObject({
      code: 'FILE_TYPE_NOT_ALLOWED',
    })
    expect(files.delete).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('превью пишется, только пока аватар тот же; опоздавшее — сносится', async () => {
    const { service, prisma, files, config } = setup()
    withAvatarConfig(config)
    files.getObjectBuffer.mockResolvedValue(
      await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#336699' },
      })
        .png()
        .toBuffer(),
    )
    files.upload.mockResolvedValue({ id: 'thumb-1', key: 'thumb.webp' })
    // Аватар успели сменить: условие по avatarUrl строку не выбрало.
    prisma.user.updateMany.mockResolvedValue({ count: 0 })

    await service.generateAvatarThumbnail({
      fileId: 'old-file',
      bucket: 'avatars',
      key: 'old.png',
      userId: 'u',
    })

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u', deletedAt: null, avatarUrl: { endsWith: '/avatars/old.png' } },
      data: { avatarThumbUrl: 'http://localhost:9000/avatars/thumb.webp' },
    })
    expect(files.delete).toHaveBeenCalledWith('thumb-1')
  })

  it('removeAvatar: удаляет объекты и обнуляет avatarUrl', async () => {
    const { service, prisma, files, config } = setup()
    withAvatarConfig(config)
    prisma.file.findMany.mockResolvedValue([
      { id: 'old-1', key: 'old-1.png' },
      { id: 'old-2', key: 'old-2.png' },
    ])
    prisma.user.update.mockResolvedValue({ id: 'u', avatarUrl: null })

    await service.removeAvatar('u')

    expect(files.delete).toHaveBeenCalledTimes(2)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u' },
      data: { avatarUrl: null, avatarThumbUrl: null },
      select: expect.anything(),
    })
  })

  it('не удаляет аватары групп, которые пользователь ставил как админ', async () => {
    const { service, prisma, files, config } = setup()
    withAvatarConfig(config)
    prisma.file.findMany.mockResolvedValue([
      { id: 'mine', key: 'mine.png' },
      { id: 'group', key: 'group.png' },
    ])
    prisma.chat.findMany.mockResolvedValue([
      { avatarUrl: 'http://localhost:9000/avatars/group.png' },
    ])
    prisma.user.update.mockResolvedValue({ id: 'u', avatarUrl: null })

    await service.removeAvatar('u')

    expect(files.delete).toHaveBeenCalledTimes(1)
    expect(files.delete).toHaveBeenCalledWith('mine')
  })
})

describe('UserService — setBlocked', () => {
  it('себя → BAD_REQUEST', async () => {
    const { service } = setup()
    await expect(
      service.setBlocked(viewer(Role.PLATFORM_ADMIN, {}, 'me'), 'me', true),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('чужой вуз (админ вуза) → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 't', universityId: 'uni-B', role: Role.STUDENT })
    await expect(
      service.setBlocked(viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-A' }), 't', true),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })

  it('платформенный админ блокирует и гасит сессии', async () => {
    const { service, prisma, authService } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 't', universityId: 'uni-B', role: Role.STUDENT })
    prisma.user.update.mockResolvedValue({})
    await service.setBlocked(viewer(Role.PLATFORM_ADMIN), 't', true)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 't' },
      // Срока нет — блокировка бессрочная, и поле явно затирается: иначе снятая и
      // выданная заново блокировка унаследовала бы чужой срок.
      data: { isBlocked: true, blockedUntil: null },
    })
    expect(authService.revokeAllUserSessions).toHaveBeenCalledWith('t')
  })
})

describe('UserService — ранг при мерах модерации', () => {
  it('модератор вуза не блокирует админа своего вуза', async () => {
    const { service, prisma, authService } = setup()
    prisma.user.findFirst.mockResolvedValue({
      id: 't',
      universityId: 'uni-A',
      role: Role.UNIVERSITY_ADMIN,
    })
    await expect(
      service.setBlocked(viewer(Role.UNIVERSITY_MODERATOR, { universityId: 'uni-A' }), 't', true),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(authService.revokeAllUserSessions).not.toHaveBeenCalled()
  })

  it('модератор платформы не блокирует и не выкидывает из сессий её админа', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({
      id: 't',
      universityId: null,
      role: Role.PLATFORM_ADMIN,
    })
    await expect(
      service.setBlocked(viewer(Role.PLATFORM_MODERATOR), 't', true),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      service.revokeSessions(viewer(Role.PLATFORM_MODERATOR), 't'),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('равный по роли тоже под защитой: админ вуза не предупреждает другого админа', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({
      id: 't',
      universityId: 'uni-A',
      role: Role.UNIVERSITY_ADMIN,
    })
    await expect(
      service.warn(viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-A' }), 't'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('свои сессии завершить можно всегда', async () => {
    const { service, authService } = setup()
    await service.revokeSessions(viewer(Role.UNIVERSITY_MODERATOR, {}, 'me'), 'me')
    expect(authService.revokeAllUserSessions).toHaveBeenCalledWith('me')
  })
})

// ── Предупреждение и временная блокировка ───────────────────────────────────
describe('UserService — предупреждение', () => {
  it('чужой вуз (модератор вуза) → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 't', universityId: 'uni-B', role: Role.STUDENT })
    await expect(
      service.warn(viewer(Role.UNIVERSITY_MODERATOR, { universityId: 'uni-A' }), 't'),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })

  // Предупреждение, о котором человек не узнал, — это не мера, а запись в базе.
  it('уведомляет предупреждённого и возвращает счётчик', async () => {
    const { service, prisma, queue } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 't', universityId: 'uni-B', role: Role.STUDENT })
    prisma.moderationWarning.count.mockResolvedValue(2)

    await expect(service.warn(viewer(Role.PLATFORM_ADMIN), 't', 'c1')).resolves.toEqual({
      total: 2,
    })
    expect(queue.enqueue.mock.calls[0][2].recipientIds).toEqual(['t'])
  })

  // Комментарий к решению — внутренняя записка модератора: её писали не нарушителю.
  it('не пересылает нарушителю внутренний текст', async () => {
    const { service, prisma, queue } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 't', universityId: 'uni-B', role: Role.STUDENT })
    await service.warn(viewer(Role.PLATFORM_ADMIN), 't', 'c1')
    const payload = queue.enqueue.mock.calls[0][2]
    expect(payload.data).toEqual({ warningId: 'w1' })
  })

  it('доступ ни у кого не отбирает', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 't', universityId: 'uni-B', role: Role.STUDENT })
    await service.warn(viewer(Role.PLATFORM_ADMIN), 't')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })
})

describe('UserService — временная блокировка', () => {
  it('со сроком пишет blockedUntil', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 't', universityId: 'uni-B', role: Role.STUDENT })
    prisma.user.update.mockResolvedValue({})
    const until = new Date('2026-10-01T00:00:00.000Z')

    await service.setBlocked(viewer(Role.PLATFORM_ADMIN), 't', true, until)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 't' },
      data: { isBlocked: true, blockedUntil: until },
    })
  })

  // Снятая руками блокировка не должна «сниматься» второй раз кроном — и не должна
  // оставлять в карточке срок, которого больше нет.
  it('разблокировка стирает срок', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 't', universityId: 'uni-B', role: Role.STUDENT })
    prisma.user.update.mockResolvedValue({})

    await service.setBlocked(viewer(Role.PLATFORM_ADMIN), 't', false)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 't' },
      data: { isBlocked: false, blockedUntil: null },
    })
  })
})

// ── Карточка человека для модератора ────────────────────────────────────────
describe('UserService.moderationCard', () => {
  const target = {
    id: 't',
    firstName: 'Айгуль',
    lastName: 'Серикова',
    role: Role.STUDENT,
    isBlocked: false,
    createdAt: new Date('2025-09-14T10:00:00.000Z'),
    universityId: 'uni-B',
    university: { id: 'uni-B', name: 'КазНУ' },
  }

  it('чужой вуз (модератор вуза) → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(target)
    await expect(
      service.moderationCard(viewer(Role.UNIVERSITY_MODERATOR, { universityId: 'uni-A' }), 't'),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })

  it('считает жалобы на человека и отдельно подтверждённые', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(target)
    prisma.complaint.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2)
    const card = await service.moderationCard(viewer(Role.PLATFORM_ADMIN), 't')
    expect(card.complaints).toEqual({ total: 4, upheld: 2 })
    expect(card.university).toEqual({ id: 'uni-B', name: 'КазНУ' })
  })

  // Карточку читают с телефона: лишние ПДн в ней — это ПДн, уехавшие в Telegram.
  it('не отдаёт ни почты, ни телефона', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(target)
    const card = await service.moderationCard(viewer(Role.PLATFORM_ADMIN), 't')
    expect(card).not.toHaveProperty('email')
    expect(card).not.toHaveProperty('phone')
    const select = prisma.user.findFirst.mock.calls[0][0].select
    expect(select.email).toBeUndefined()
    expect(select.phone).toBeUndefined()
  })
})

// ── 12.2 GET /users — scope списка ──────────────────────────────────────────
describe('UserService.list — scope (12.2)', () => {
  function viewer(role: Role, scope: Partial<JwtPayload> = {}): JwtPayload {
    return {
      sub: 'v1',
      role,
      universityId: scope.universityId ?? null,
      facultyId: scope.facultyId ?? null,
      groupId: scope.groupId ?? null,
    }
  }
  async function whereFor(v: JwtPayload, query = { page: 1, limit: 20 }) {
    const { service, prisma } = setup()
    await service.list(v, query as never)
    return prisma.user.findMany.mock.calls[0][0].where
  }

  // where = { deletedAt: null, AND: [scope, ...фильтры] }. scope = AND[0]; клиентские
  // фильтры лишь СУЖАЮТ его (регрессия cross-tenant утечки через ?facultyId=/?groupId=).
  it('платформа видит всех (scope пустой), только не удалённых', async () => {
    const where = await whereFor(viewer(Role.PLATFORM_ADMIN))
    expect(where.deletedAt).toBeNull()
    expect(where.AND[0]).toEqual({})
  })

  it('админ вуза — только свой вуз', async () => {
    const where = await whereFor(viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-A' }))
    expect(where.AND[0]).toEqual({ universityId: 'uni-A' })
  })

  it('декан — только свой факультет', async () => {
    const where = await whereFor(viewer(Role.DEAN, { facultyId: 'fac-A' }))
    expect(where.AND[0]).toEqual({ facultyId: 'fac-A' })
  })

  it('фильтры role/search применяются', async () => {
    const { service, prisma } = setup()
    await service.list(viewer(Role.PLATFORM_ADMIN), {
      page: 1,
      limit: 20,
      role: Role.TEACHER,
      search: 'ив',
    } as never)
    const and = prisma.user.findMany.mock.calls[0][0].where.AND
    expect(and).toContainEqual({ role: Role.TEACHER })
    expect(and.some((c: { OR?: unknown }) => Array.isArray(c.OR))).toBe(true)
  })

  // Регрессия: декан не может выгрузить пользователей чужого факультета через ?facultyId=.
  // scope-условие своего факультета остаётся в AND рядом с запрошенным — подмена невозможна.
  it('декан не может подменить факультет через ?facultyId=', async () => {
    const where = await whereFor(viewer(Role.DEAN, { facultyId: 'fac-A' }), {
      page: 1,
      limit: 20,
      facultyId: 'fac-B',
    } as never)
    expect(where.AND[0]).toEqual({ facultyId: 'fac-A' })
    expect(where.AND).toContainEqual({ facultyId: 'fac-B' })
  })
})

describe('UserService.list — сортировка (sort/order)', () => {
  const viewer: JwtPayload = {
    sub: 'v1',
    role: Role.PLATFORM_ADMIN,
    universityId: null,
    facultyId: null,
    groupId: null,
  }
  async function orderFor(query: Record<string, unknown>) {
    const { service, prisma } = setup()
    await service.list(viewer, { page: 1, limit: 20, ...query } as never)
    return prisma.user.findMany.mock.calls[0][0].orderBy
  }

  it('по умолчанию — по фамилии и имени', async () => {
    expect(await orderFor({})).toEqual([{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }])
  })

  it('sort=name с order=desc разворачивает обе ступени имени', async () => {
    expect(await orderFor({ sort: 'name', order: 'desc' })).toEqual([
      { lastName: 'desc' },
      { firstName: 'desc' },
      { id: 'asc' },
    ])
  })

  it('sort=email / sort=blocked / sort=createdAt отдают свои колонки', async () => {
    expect(await orderFor({ sort: 'email' })).toEqual([{ email: 'asc' }, { id: 'asc' }])
    expect(await orderFor({ sort: 'blocked', order: 'desc' })).toEqual([
      { isBlocked: 'desc' },
      { lastName: 'asc' },
      { id: 'asc' },
    ])
    expect(await orderFor({ sort: 'createdAt', order: 'desc' })).toEqual([
      { createdAt: 'desc' },
      { id: 'asc' },
    ])
  })

  // Поле из query не подставляется в orderBy напрямую: неизвестное имя даёт порядок
  // по умолчанию, а не сортировку по чужой колонке модели.
  it('неизвестное поле сортировки не попадает в orderBy', async () => {
    expect(await orderFor({ sort: 'passwordHash', order: 'desc' })).toEqual([
      { lastName: 'asc' },
      { firstName: 'asc' },
      { id: 'asc' },
    ])
  })

  // Ключ сортировки всегда доопределён id: иначе строки с равными значениями
  // перескакивают между страницами от запроса к запросу.
  it('последняя ступень сортировки — id', async () => {
    for (const sort of ['name', 'email', 'role', 'blocked', 'createdAt']) {
      const order = await orderFor({ sort })
      expect(order[order.length - 1]).toEqual({ id: 'asc' })
    }
  })
})

describe('UserService.updateProfile — набор полей по роли (PROFILE_FIELD_ROLES)', () => {
  // Zod-схема UpdateProfileSchema одна для всех ролей, поэтому единственная защита
  // от записи чужих полей прямым PATCH — проверка по роли из JWT внутри сервиса.
  // Недоступное поле = 400 BAD_REQUEST, а не тихий игнор: иначе клиент считает,
  // что данные сохранены.
  function dataOf(prisma: ReturnType<typeof setup>['prisma']): Record<string, unknown> {
    return (prisma.user.update.mock.calls[0][0] as { data: Record<string, unknown> }).data
  }

  async function expectRejected(
    role: Role,
    input: Parameters<UserService['updateProfile']>[2],
    fields: string[],
  ): Promise<void> {
    const { service, prisma } = setup()
    const err = await service.updateProfile('u1', role, input).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppException)
    const app = err as AppException
    expect(app.code).toBe('BAD_REQUEST')
    expect(app.getStatus()).toBe(400)
    expect(app.details?.map((d) => d.field)).toEqual(fields)
    // Запрос отклонён целиком — в БД не уходит даже разрешённая часть.
    expect(prisma.user.update).not.toHaveBeenCalled()
  }

  it('платформенному админу пишет служебные поля', async () => {
    const { service, prisma } = setup()
    prisma.user.update.mockResolvedValue({ id: 'u1' })

    await service.updateProfile('u1', Role.PLATFORM_ADMIN, {
      headline: 'Дежурный',
      responsibilities: 'Вузы Астаны',
      workPhone: '+7 700 000 00 00',
      timezone: 'Asia/Almaty',
    })

    expect(dataOf(prisma)).toEqual({
      headline: 'Дежурный',
      responsibilities: 'Вузы Астаны',
      workPhone: '+7 700 000 00 00',
      timezone: 'Asia/Almaty',
    })
  })

  // Платформенная команда — публичные лица продукта, поэтому личные поля ей открыты
  // (PERSONAL_ROLES/SHOWCASE_ROLES в shared-schemas). Служебным ролям ВУЗА — по-прежнему нет.
  it('платформенному админу пишет личные поля', async () => {
    const { service, prisma } = setup()
    prisma.user.update.mockResolvedValue({ id: 'u1' })

    await service.updateProfile('u1', Role.PLATFORM_ADMIN, {
      // Схема объявляет birthDate как z.coerce.date(), поэтому на входе сервиса — Date.
      birthDate: new Date('1990-05-01'),
      country: 'Казахстан',
      website: 'https://example.kz',
      skills: ['TypeScript'],
    })

    expect(dataOf(prisma)).toEqual({
      birthDate: new Date('1990-05-01'),
      country: 'Казахстан',
      website: 'https://example.kz',
      skills: ['TypeScript'],
    })
  })

  it('админу вуза личные поля по-прежнему недоступны', async () => {
    await expectRejected(
      Role.UNIVERSITY_ADMIN,
      { birthDate: new Date('1990-05-01'), country: 'Казахстан' },
      ['birthDate', 'country'],
    )
  })

  it('платформенному админу отказывает в академических и вузовских полях', async () => {
    await expectRejected(
      Role.PLATFORM_ADMIN,
      { headline: 'Дежурный', academicDegree: 'к.т.н.', department: 'Кафедра ИБ', gpa: 5 },
      ['academicDegree', 'department', 'gpa'],
    )
  })

  it('преподавателю пишет академические поля', async () => {
    const { service, prisma } = setup()
    prisma.user.update.mockResolvedValue({ id: 'u2' })

    await service.updateProfile('u2', Role.TEACHER, {
      academicDegree: 'к.т.н.',
      department: 'Кафедра ИБ',
      subjects: ['Матан'],
    })

    expect(dataOf(prisma)).toEqual({
      academicDegree: 'к.т.н.',
      department: 'Кафедра ИБ',
      subjects: ['Матан'],
    })
  })

  it('преподавателю отказывает в студенческих полях', async () => {
    await expectRejected(Role.TEACHER, { gpa: 5, dormitory: 'Общежитие 3' }, ['gpa', 'dormitory'])
  })

  it('зона модерации доступна модератору, но не администратору', async () => {
    const mod = setup()
    mod.prisma.user.update.mockResolvedValue({ id: 'm1' })
    await mod.service.updateProfile('m1', Role.PLATFORM_MODERATOR, { moderationAreas: 'Жалобы' })
    expect(dataOf(mod.prisma)).toEqual({ moderationAreas: 'Жалобы' })

    await expectRejected(Role.PLATFORM_ADMIN, { moderationAreas: 'Жалобы' }, ['moderationAreas'])
  })

  it('обязанности старосты доступны только старосте', async () => {
    const starosta = setup()
    starosta.prisma.user.update.mockResolvedValue({ id: 's1' })
    await starosta.service.updateProfile('s1', Role.STAROSTA, { duties: 'Журнал' })
    expect(dataOf(starosta.prisma)).toEqual({ duties: 'Журнал' })

    await expectRejected(Role.STUDENT, { duties: 'Журнал' }, ['duties'])
  })

  it('общие поля доступны любой роли', async () => {
    for (const role of Object.values(Role)) {
      const { service, prisma } = setup()
      prisma.user.update.mockResolvedValue({ id: 'x' })
      await service.updateProfile('x', role, { headline: 'Статус', timezone: 'Asia/Almaty' })
      expect(dataOf(prisma)).toEqual({ headline: 'Статус', timezone: 'Asia/Almaty' })
    }
  })
})

describe('UserService.updateUsername', () => {
  const conflict = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['username'] },
    })

  it('нормализует имя в нижний регистр и обрезает пробелы', async () => {
    const { service, prisma } = setup()
    prisma.user.update.mockResolvedValue({ id: 'u1', username: 'ivan_petrov' })

    await service.updateUsername('u1', '  Ivan_Petrov ')

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { username: 'ivan_petrov' } }),
    )
  })

  it('пишет аудит смены имени входа', async () => {
    const { service, prisma, audit } = setup()
    prisma.user.update.mockResolvedValue({ id: 'u1', username: 'ivan' })

    await service.updateUsername('u1', 'ivan')

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', action: 'change_username', entityId: 'u1' }),
    )
  })

  it('занятое имя → USERNAME_TAKEN, а не 500', async () => {
    // Уникальность держит БД: между «проверить свободно» и «записать» имя может занять другой,
    // поэтому обрабатываем именно отказ вставки.
    const { service, prisma } = setup()
    prisma.user.update.mockRejectedValue(conflict())

    await expect(service.updateUsername('u1', 'taken')).rejects.toMatchObject({
      code: 'USERNAME_TAKEN',
    })
  })

  it('прочие ошибки БД не маскируются под «занято»', async () => {
    const { service, prisma } = setup()
    prisma.user.update.mockRejectedValue(new Error('соединение потеряно'))

    await expect(service.updateUsername('u1', 'ivan')).rejects.toThrow('соединение потеряно')
  })

  it('аудит не пишется, если запись не удалась', async () => {
    const { service, prisma, audit } = setup()
    prisma.user.update.mockRejectedValue(conflict())

    await expect(service.updateUsername('u1', 'taken')).rejects.toBeInstanceOf(AppException)
    expect(audit.record).not.toHaveBeenCalled()
  })
})

describe('UserService — выгрузка списка', () => {
  const admin: JwtPayload = {
    sub: 'adm-1',
    role: Role.UNIVERSITY_ADMIN,
    universityId: 'uni-a',
    facultyId: null,
    groupId: null,
  }
  const query = { page: 1, limit: 20 } as never

  function row(id: string) {
    return {
      id,
      email: `${id}@uni-a.io`,
      firstName: 'Имя',
      lastName: 'Фамилия',
      role: Role.STUDENT,
      isBlocked: false,
      createdAt: new Date('2026-09-01T10:00:00Z'),
    }
  }

  it('отказывает, когда строк больше предела, вместо тихого обрезания', async () => {
    const { service, prisma } = setup()
    prisma.user.count.mockResolvedValue(5001)

    await expect(service.exportList(admin, query, 'ru', 'xlsx')).rejects.toThrow(AppException)
    // Данные при этом не читаются: отказ до выборки, а не после.
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('собирает книгу и записывает выгрузку в журнал', async () => {
    const { service, prisma, audit, branding } = setup()
    prisma.user.count.mockResolvedValue(2)
    prisma.user.findFirst.mockResolvedValue({
      firstName: 'Асан',
      lastName: 'Асанов',
      university: { timezone: 'Asia/Almaty' },
    })
    prisma.user.findMany.mockResolvedValueOnce([row('u-1'), row('u-2')]).mockResolvedValue([])

    const result = await service.exportList(admin, query, 'ru', 'xlsx')

    expect(result.filename).toBe('studenthub_users_2026-09-13.xlsx')
    expect(Buffer.isBuffer(result.body)).toBe(true)
    expect(branding.filename).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'users', timezone: 'Asia/Almaty' }),
      'xlsx',
    )
    // В журнал идут объём и условия, но не сами данные (§13).
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'users_export',
        metadata: expect.objectContaining({ format: 'xlsx', rows: 2 }),
      }),
    )
  })

  it('CSV отдаётся строкой с BOM — иначе Excel ломает кириллицу', async () => {
    const { service, prisma } = setup()
    prisma.user.count.mockResolvedValue(1)
    prisma.user.findFirst.mockResolvedValue({
      firstName: 'Асан',
      lastName: 'Асанов',
      university: { timezone: 'Asia/Almaty' },
    })
    prisma.user.findMany.mockResolvedValueOnce([row('u-1')]).mockResolvedValue([])

    const { body } = await service.exportList(admin, query, 'ru', 'csv')

    expect(typeof body).toBe('string')
    expect((body as string).charCodeAt(0)).toBe(0xfeff)
  })
})

describe('UserService — роль старосты группы', () => {
  function tx() {
    return {
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'old-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
  }

  it('прежние старосты группы — в студенты, новый — в старосты', async () => {
    const { service } = setup()
    const t = tx()

    const demoted = await service.syncGroupStarosta(t as never, 'grp-1', 'stud-1')

    expect(demoted).toEqual(['old-1'])
    expect(t.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          groupId: 'grp-1',
          role: Role.STAROSTA,
          id: { not: 'stud-1' },
        }),
      }),
    )
    expect(t.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-1'] } },
      data: { role: Role.STUDENT, starostaSince: null },
    })
    // Повышается только студент: действующий староста сохраняет дату начала полномочий.
    expect(t.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'stud-1', role: Role.STUDENT } }),
    )
  })

  it('разжалованному гасятся сессии, обе смены роли — в журнал', async () => {
    const { service, authService, audit } = setup()

    await service.afterStarostaChange('dean-1', 'grp-1', 'stud-1', ['old-1'])

    expect(authService.revokeAllUserSessions).toHaveBeenCalledWith('old-1')
    expect(authService.revokeAllUserSessions).not.toHaveBeenCalledWith('stud-1')
    expect(audit.record).toHaveBeenCalledTimes(2)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user_role_changed', entityId: 'old-1' }),
    )
  })
})

describe('UserService — учебные данные ведёт вуз', () => {
  it('студент не меняет себе статус, форму оплаты и курс через свой профиль', async () => {
    const { service, prisma } = setup()
    await expect(
      service.updateProfile('s1', Role.STUDENT, { academicStatus: 'Обучающийся', course: 4 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('декан правит учебные данные студента своего факультета, правка в аудите', async () => {
    const { service, prisma, audit } = setup()
    prisma.user.findFirst.mockResolvedValue({
      id: 's1',
      role: Role.STUDENT,
      universityId: 'uni-A',
      facultyId: 'fac-A',
    })
    prisma.user.update.mockResolvedValue({ id: 's1' })
    await service.updateAcademicRecord(
      viewer(Role.DEAN, { universityId: 'uni-A', facultyId: 'fac-A' }),
      's1',
      { course: 3 },
    )
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' }, data: { course: 3 } }),
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user_academic_updated',
        metadata: { fields: ['course'] },
      }),
    )
  })

  it('декан чужого факультета — WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({
      id: 's1',
      role: Role.STUDENT,
      universityId: 'uni-A',
      facultyId: 'fac-B',
    })
    await expect(
      service.updateAcademicRecord(
        viewer(Role.DEAN, { universityId: 'uni-A', facultyId: 'fac-A' }),
        's1',
        { course: 3 },
      ),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })

  // От даты ухода считаются сроки хранения ПДн (PERSONAL_DATA §4).
  describe('дата ухода из вуза (leftUniversityAt)', () => {
    const admin = viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-A' })
    const student = (leftUniversityAt: Date | null) => ({
      id: 's1',
      role: Role.STUDENT,
      universityId: 'uni-A',
      facultyId: 'fac-A',
      specialty: null,
      leftUniversityAt,
    })

    it('«Отчислен» проставляет дату ухода', async () => {
      const { service, prisma } = setup()
      prisma.user.findFirst.mockResolvedValue(student(null))
      prisma.user.update.mockResolvedValue({ id: 's1' })
      const before = Date.now()
      await service.updateAcademicRecord(admin, 's1', { academicStatus: 'Отчислен' })
      const data = prisma.user.update.mock.calls[0][0].data
      expect(data.academicStatus).toBe('Отчислен')
      expect(data.leftUniversityAt).toBeInstanceOf(Date)
      expect(data.leftUniversityAt.getTime()).toBeGreaterThanOrEqual(before)
    })

    it('смена одного терминального статуса на другой не сдвигает дату', async () => {
      const { service, prisma } = setup()
      const left = new Date('2026-06-30T00:00:00Z')
      prisma.user.findFirst.mockResolvedValue(student(left))
      prisma.user.update.mockResolvedValue({ id: 's1' })
      await service.updateAcademicRecord(admin, 's1', { academicStatus: 'Переведён' })
      expect(prisma.user.update.mock.calls[0][0].data.leftUniversityAt).toBe(left)
    })

    it('возврат к учёбе обнуляет дату — действующий студент уборкой не задет', async () => {
      const { service, prisma } = setup()
      prisma.user.findFirst.mockResolvedValue(student(new Date('2025-01-01T00:00:00Z')))
      prisma.user.update.mockResolvedValue({ id: 's1' })
      await service.updateAcademicRecord(admin, 's1', { academicStatus: 'Обучающийся' })
      expect(prisma.user.update.mock.calls[0][0].data.leftUniversityAt).toBeNull()
    })

    it('правка без статуса дату не трогает', async () => {
      const { service, prisma } = setup()
      prisma.user.findFirst.mockResolvedValue(student(new Date('2025-01-01T00:00:00Z')))
      prisma.user.update.mockResolvedValue({ id: 's1' })
      await service.updateAcademicRecord(admin, 's1', { course: 4 })
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({ course: 4 })
    })
  })

  it('у не-студента учебных данных нет', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({
      id: 't1',
      role: Role.TEACHER,
      universityId: 'uni-A',
      facultyId: 'fac-A',
    })
    await expect(
      service.updateAcademicRecord(viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-A' }), 't1', {
        course: 1,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('UserService — специальность из справочника вуза', () => {
  const student = {
    id: 's1',
    role: Role.STUDENT,
    universityId: 'uni-A',
    facultyId: 'fac-A',
    specialty: 'Старое название',
  }
  const admin = viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-A' })

  it('название из справочника сохраняется в его написании', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(student)
    prisma.user.update.mockResolvedValue({ id: 's1' })
    prisma.specialty.findFirst.mockResolvedValueOnce({ id: 'sp-1', name: 'Информатика' })
    await service.updateAcademicRecord(admin, 's1', { specialty: 'информатика' })
    expect(prisma.specialty.findFirst).toHaveBeenCalledWith({
      where: { universityId: 'uni-A', name: { in: ['информатика'], mode: 'insensitive' } },
      select: { id: true, name: true },
    })
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { specialty: 'Информатика' } }),
    )
  })

  it('справочник заведён, а такой специальности нет — VALIDATION_ERROR по полю', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(student)
    prisma.specialty.findFirst
      .mockResolvedValueOnce(null) // совпадения по названию нет
      .mockResolvedValueOnce({ id: 'sp-1' }) // но справочник у вуза есть
    await expect(
      service.updateAcademicRecord(admin, 's1', { specialty: 'Что-то своё' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field: 'specialty' }] })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('у вуза без справочника — свободный текст, как раньше', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(student)
    prisma.user.update.mockResolvedValue({ id: 's1' })
    await service.updateAcademicRecord(admin, 's1', { specialty: 'Что-то своё' })
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { specialty: 'Что-то своё' } }),
    )
  })

  // Правка курса не должна упираться в специальность, вписанную до справочника.
  it('прежнее значение и очистка поля проходят без справочника', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(student)
    prisma.user.update.mockResolvedValue({ id: 's1' })
    await service.updateAcademicRecord(admin, 's1', { specialty: 'Старое название', course: 2 })
    await service.updateAcademicRecord(admin, 's1', { specialty: '' })
    expect(prisma.specialty.findFirst).not.toHaveBeenCalled()
    expect(prisma.user.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { specialty: '' } }),
    )
  })

  it('renameSpecialty: переименование доходит до студентов вуза, без учёта регистра', async () => {
    const { service } = setup()
    const tx = { user: { updateMany: jest.fn().mockResolvedValue({ count: 7 }) } }
    await expect(
      service.renameSpecialty(
        tx as unknown as Prisma.TransactionClient,
        'uni-A',
        'Информатика',
        'Информатика и ВТ',
      ),
    ).resolves.toBe(7)
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { universityId: 'uni-A', specialty: { in: ['Информатика'], mode: 'insensitive' } },
      data: { specialty: 'Информатика и ВТ' },
    })
  })
})

describe('UserService — общежитие ведёт вуз (а старые клиенты его ещё присылают)', () => {
  function dataOf(prisma: ReturnType<typeof setup>['prisma']): Record<string, unknown> {
    return (prisma.user.update.mock.calls[0][0] as { data: Record<string, unknown> }).data
  }

  it('студент: общежитие из PATCH /users/me молча отбрасывается, остальное сохраняется', async () => {
    const { service, prisma } = setup()
    prisma.user.update.mockResolvedValue({ id: 's1' })
    // Не 400: мобильный клиент, присылающий форму целиком, не должен терять сохранение.
    await service.updateProfile('s1', Role.STUDENT, { dormitory: 'Общежитие №3', bio: 'Привет' })
    expect(dataOf(prisma)).toEqual({ bio: 'Привет' })
  })

  it('староста — так же', async () => {
    const { service, prisma } = setup()
    prisma.user.update.mockResolvedValue({ id: 's1' })
    await service.updateProfile('s1', Role.STAROSTA, { dormitory: 'Да' })
    expect(dataOf(prisma)).toEqual({})
  })

  it('роли без общежития по-прежнему получают 400', async () => {
    const { service, prisma } = setup()
    await expect(
      service.updateProfile('t1', Role.TEACHER, { dormitory: 'Да' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('учебные данные вуза принимают общежитие', () => {
    expect(UpdateAcademicRecordSchema.parse({ dormitory: 'Да' })).toEqual({ dormitory: 'Да' })
  })
})

describe('UserService — сброс 2FA администратором', () => {
  const targetRow = {
    id: 't',
    universityId: 'uni-A',
    role: Role.DEAN as Role,
    twoFactorEnabled: true,
    email: 'dean@uni-a.io',
    firstName: 'Айгуль',
    locale: 'kk',
  }

  // Одна выборка на id: администратор (есть ли у него 2FA) и цель (охват, ранг, 2FA, почта).
  function arrange(
    prisma: ReturnType<typeof setup>['prisma'],
    opts: { adminTfa?: boolean; target?: Partial<typeof targetRow> } = {},
  ): void {
    prisma.user.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'admin'
        ? { twoFactorEnabled: opts.adminTfa ?? true }
        : { ...targetRow, ...opts.target },
    )
    prisma.user.update.mockResolvedValue({})
  }

  const admin = (role: Role = Role.UNIVERSITY_ADMIN) =>
    viewer(role, { universityId: 'uni-A' }, 'admin')

  it('выключает 2FA, гасит сессии, пишет аудит и шлёт письмо владельцу', async () => {
    const { service, prisma, authService, audit, queue } = setup()
    arrange(prisma)
    const confirm = jest.fn().mockResolvedValue(true)
    await service.resetTwoFactor(admin(), 't', confirm, { ip: '10.0.0.1' })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 't' },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [] },
    })
    expect(authService.revokeAllUserSessions).toHaveBeenCalledWith('t')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin',
        action: 'user_2fa_reset',
        entityId: 't',
        ip: '10.0.0.1',
      }),
    )
    expect(queue.enqueue).toHaveBeenCalledWith(
      'email',
      'send-two-factor-reset',
      { to: 'dean@uni-a.io', locale: 'kk', firstName: 'Айгуль' },
      expect.objectContaining({ jobId: expect.stringContaining('two-factor-reset:t:') }),
    )
  })

  it('неверный код администратора → INVALID_2FA_CODE, ничего не меняется', async () => {
    const { service, prisma, authService, queue } = setup()
    arrange(prisma)
    await expect(
      service.resetTwoFactor(admin(), 't', jest.fn().mockResolvedValue(false)),
    ).rejects.toMatchObject({ code: 'INVALID_2FA_CODE' })
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(authService.revokeAllUserSessions).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('у самого администратора 2FA нет → FORBIDDEN, код даже не спрашивается', async () => {
    const { service, prisma } = setup()
    arrange(prisma, { adminTfa: false })
    const confirm = jest.fn().mockResolvedValue(true)
    await expect(service.resetTwoFactor(admin(), 't', confirm)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(confirm).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('только строго старшему: модератор вуза не сбрасывает админу вуза', async () => {
    const { service, prisma } = setup()
    arrange(prisma, { target: { role: Role.UNIVERSITY_ADMIN } })
    const confirm = jest.fn().mockResolvedValue(true)
    await expect(
      service.resetTwoFactor(admin(Role.UNIVERSITY_MODERATOR), 't', confirm),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Код не тратится на запрос, который всё равно отклонён (backup-код сгорел бы).
    expect(confirm).not.toHaveBeenCalled()
  })

  it('чужой вуз → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    arrange(prisma, { target: { universityId: 'uni-B' } })
    await expect(
      service.resetTwoFactor(admin(), 't', jest.fn().mockResolvedValue(true)),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })

  it('у человека 2FA не включена → BAD_REQUEST, код не тратится', async () => {
    const { service, prisma } = setup()
    arrange(prisma, { target: { twoFactorEnabled: false } })
    const confirm = jest.fn().mockResolvedValue(true)
    await expect(service.resetTwoFactor(admin(), 't', confirm)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('себе — BAD_REQUEST: своя 2FA отключается в настройках', async () => {
    const { service, prisma } = setup()
    arrange(prisma)
    await expect(
      service.resetTwoFactor(admin(), 'admin', jest.fn().mockResolvedValue(true)),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('UserService — присутствие только в охвате', () => {
  it('человек другого вуза без дружбы — «не в сети», без раскрытия', async () => {
    const { service, prisma, realtime } = setup()
    realtime.isOnline.mockReturnValue(true)
    prisma.user.findFirst.mockResolvedValue({ universityId: 'uni-B' })
    ;(
      prisma as unknown as { friendship: { findFirst: jest.Mock } }
    ).friendship.findFirst.mockResolvedValue(null)
    await expect(
      service.getPresenceFor(viewer(Role.STUDENT, { universityId: 'uni-A' }), 'x'),
    ).resolves.toEqual({ online: false })
  })

  it('свой вуз — реальный статус', async () => {
    const { service, prisma, realtime } = setup()
    realtime.isOnline.mockReturnValue(true)
    prisma.user.findFirst.mockResolvedValue({ universityId: 'uni-A' })
    await expect(
      service.getPresenceFor(viewer(Role.STUDENT, { universityId: 'uni-A' }), 'x'),
    ).resolves.toEqual({ online: true })
  })
})
