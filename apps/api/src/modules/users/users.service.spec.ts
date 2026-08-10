import { Role } from '@studenthub/shared-types'
import type { ConfigService } from '@nestjs/config'
import { UserService } from './users.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { PasswordService } from '../../common/security/password.service'
import type { FileService } from '../files/file.service'
import type { QueueService } from '../../common/queue'
import type { AuthService } from '../auth/auth.service'
import type { RealtimeGateway } from '../../common/realtime'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'

function setup() {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    file: { findMany: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    friendship: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((ops: unknown) => Promise.all(ops as Promise<unknown>[])),
  }
  const passwords = { hash: jest.fn(), compare: jest.fn() }
  const files = { upload: jest.fn(), delete: jest.fn(), removeRawObject: jest.fn() }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn() }
  const authService = { revokeAllUserSessions: jest.fn().mockResolvedValue(undefined) }
  const realtime = { isOnline: jest.fn().mockReturnValue(false) }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new UserService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    files as unknown as FileService,
    queue as unknown as QueueService,
    config as unknown as ConfigService<EnvVars, true>,
    authService as unknown as AuthService,
    realtime as unknown as RealtimeGateway,
    audit as unknown as AuditService,
  )
  return { service, prisma, passwords, files, queue, config, authService, realtime, audit }
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
      passwordHash: 'h',
      firstName: 'A',
      lastName: 'B',
      role: Role.STUDENT,
      universityId: null,
      facultyId: null,
      groupId: null,
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
      passwordHash: 'h',
      firstName: 'C',
      lastName: 'D',
      role: Role.DEAN,
      universityId: null,
      facultyId: null,
      groupId: null,
    })
    expect(tx.user.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ profileVisibility: 'PUBLIC' }) }),
    )
    void prisma
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
})

describe('UserService — softDeleteSelf', () => {
  function withBuckets(config: { get: jest.Mock }) {
    config.get.mockImplementation((key: string) =>
      key === 'MINIO_BUCKET_AVATARS'
        ? 'avatars'
        : key === 'MINIO_BUCKET_PROFILE_COVERS'
          ? 'profile-covers'
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
    prisma.file.findMany.mockResolvedValue([{ id: 'old-1' }])
    files.upload.mockResolvedValue({ id: 'file-1', key: 'new-key.png' })
    prisma.user.update.mockResolvedValue({ id: 'u', avatarUrl: 'x' })

    await service.setAvatar('u', Buffer.from('img'))

    expect(files.delete).toHaveBeenCalledWith('old-1')
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

  it('removeAvatar: удаляет объекты и обнуляет avatarUrl', async () => {
    const { service, prisma, files, config } = setup()
    withAvatarConfig(config)
    prisma.file.findMany.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }])
    prisma.user.update.mockResolvedValue({ id: 'u', avatarUrl: null })

    await service.removeAvatar('u')

    expect(files.delete).toHaveBeenCalledTimes(2)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u' },
      data: { avatarUrl: null, avatarThumbUrl: null },
      select: expect.anything(),
    })
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
    prisma.user.findFirst.mockResolvedValue({ id: 't', universityId: 'uni-B' })
    await expect(
      service.setBlocked(viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-A' }), 't', true),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })

  it('платформенный админ блокирует и гасит сессии', async () => {
    const { service, prisma, authService } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 't', universityId: 'uni-B' })
    prisma.user.update.mockResolvedValue({})
    await service.setBlocked(viewer(Role.PLATFORM_ADMIN), 't', true)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 't' },
      data: { isBlocked: true },
    })
    expect(authService.revokeAllUserSessions).toHaveBeenCalledWith('t')
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

  it('платформа видит всех (без scope-фильтра), только не удалённых', async () => {
    const where = await whereFor(viewer(Role.PLATFORM_ADMIN))
    expect(where.deletedAt).toBeNull()
    expect(where.universityId).toBeUndefined()
    expect(where.facultyId).toBeUndefined()
  })

  it('админ вуза — только свой вуз', async () => {
    const where = await whereFor(viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-A' }))
    expect(where.universityId).toBe('uni-A')
  })

  it('декан — только свой факультет', async () => {
    const where = await whereFor(viewer(Role.DEAN, { facultyId: 'fac-A' }))
    expect(where.facultyId).toBe('fac-A')
  })

  it('фильтры role/search применяются', async () => {
    const { service, prisma } = setup()
    await service.list(viewer(Role.PLATFORM_ADMIN), {
      page: 1,
      limit: 20,
      role: Role.TEACHER,
      search: 'ив',
    } as never)
    const where = prisma.user.findMany.mock.calls[0][0].where
    expect(where.role).toBe(Role.TEACHER)
    expect(Array.isArray(where.OR)).toBe(true)
  })
})
