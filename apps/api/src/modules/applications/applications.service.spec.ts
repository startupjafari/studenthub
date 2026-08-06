import { ApplicationStatus } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { ALLOWED_TRANSITIONS, ApplicationsService } from './applications.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { FileService } from '../files/file.service'
import type { ConfigService } from '@nestjs/config'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { AppException } from '../../common/exceptions/app.exception'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const ALL_STATUSES = Object.values(ApplicationStatus)

function setup() {
  const prisma = {
    applicationRequest: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    applicationStatusHistory: { create: jest.fn().mockResolvedValue({ id: 'hist-1' }) },
    // Массив → Promise.all; колбэк → вызов с prisma как tx.
    $transaction: jest.fn((arg: unknown): unknown =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
    ),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const files = { upload: jest.fn(), findOrThrow: jest.fn(), getPresignedUrl: jest.fn() }
  const config = { get: jest.fn().mockReturnValue('applications') }
  const service = new ApplicationsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    files as unknown as FileService,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { service, prisma, audit, queue, files }
}

function viewer(role: Role, scope: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: scope.sub ?? 'u',
    role,
    universityId: scope.universityId ?? null,
    facultyId: scope.facultyId ?? null,
    groupId: scope.groupId ?? null,
  }
}

function appRow(status: ApplicationStatus, over: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    type: 'CERTIFICATE',
    subject: 'Справка',
    status,
    studentId: 'stud-1',
    facultyId: 'fac-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    faculty: { universityId: 'uni-1' },
    ...over,
  }
}

// Админ вуза, чей scope совпадает с заявкой (для проверки самой матрицы, без scope-шумов).
const admin = viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-1' })

// ── 7.2/7.3 Конечный автомат: полная матрица ────────────────────────────────
describe('ApplicationsService.transitionStatus — матрица переходов (7.3)', () => {
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const allowed = ALLOWED_TRANSITIONS[from].includes(to)
      it(`${from} → ${to} — ${allowed ? 'разрешён' : 'ОТКЛОНЁН (400)'}`, async () => {
        const { service, prisma, queue } = setup()
        prisma.applicationRequest.findFirst.mockResolvedValue(appRow(from))
        prisma.applicationRequest.update.mockResolvedValue(appRow(to))

        if (allowed) {
          const res = await service.transitionStatus(admin, 'app-1', { toStatus: to }, ctx)
          expect(res.status).toBe(to)
          expect(prisma.applicationStatusHistory.create).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({ fromStatus: from, toStatus: to }),
            }),
          )
          expect(queue.enqueue).toHaveBeenCalledTimes(1)
        } else {
          const err = await service
            .transitionStatus(admin, 'app-1', { toStatus: to }, ctx)
            .catch((e) => e)
          expect(err).toBeInstanceOf(AppException)
          expect(err.code).toBe('BAD_REQUEST')
          expect(prisma.applicationRequest.update).not.toHaveBeenCalled()
          expect(queue.enqueue).not.toHaveBeenCalled()
        }
      })
    }
  }

  it('CLOSED — терминальный статус: любой переход отклоняется', () => {
    expect(ALLOWED_TRANSITIONS[ApplicationStatus.CLOSED]).toEqual([])
  })
})

// ── Права на переход ────────────────────────────────────────────────────────
describe('ApplicationsService.transitionStatus — права', () => {
  it('декан чужого факультета → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.applicationRequest.findFirst.mockResolvedValue(appRow(ApplicationStatus.NEW))
    const dean = viewer(Role.DEAN, { facultyId: 'fac-OTHER', universityId: 'uni-1' })
    const err = await service
      .transitionStatus(dean, 'app-1', { toStatus: ApplicationStatus.PROCESSING }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('декан своего факультета → переход выполняется', async () => {
    const { service, prisma } = setup()
    prisma.applicationRequest.findFirst.mockResolvedValue(appRow(ApplicationStatus.NEW))
    prisma.applicationRequest.update.mockResolvedValue(appRow(ApplicationStatus.PROCESSING))
    const dean = viewer(Role.DEAN, { facultyId: 'fac-1', universityId: 'uni-1' })
    const res = await service.transitionStatus(dean, 'app-1', { toStatus: 'PROCESSING' }, ctx)
    expect(res.status).toBe(ApplicationStatus.PROCESSING)
  })

  it('студент не может менять статус → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.applicationRequest.findFirst.mockResolvedValue(appRow(ApplicationStatus.NEW))
    const student = viewer(Role.STUDENT, { sub: 'stud-1', facultyId: 'fac-1' })
    const err = await service
      .transitionStatus(student, 'app-1', { toStatus: 'PROCESSING' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('несуществующая заявка → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.applicationRequest.findFirst.mockResolvedValue(null)
    const err = await service
      .transitionStatus(admin, 'x', { toStatus: 'PROCESSING' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })
})

// ── 7.4 Создание / отзыв ────────────────────────────────────────────────────
describe('ApplicationsService.create / withdraw', () => {
  it('студент без факультета → BAD_REQUEST', async () => {
    const { service } = setup()
    const student = viewer(Role.STUDENT, { sub: 'stud-1', facultyId: null })
    const err = await service
      .create(student, { type: 'CERTIFICATE', subject: 'С', body: 'текст' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('создание пишет начальную историю null → NEW', async () => {
    const { service, prisma } = setup()
    prisma.applicationRequest.create.mockResolvedValue(appRow(ApplicationStatus.NEW))
    const student = viewer(Role.STUDENT, { sub: 'stud-1', facultyId: 'fac-1' })
    await service.create(student, { type: 'CERTIFICATE', subject: 'С', body: 'текст' }, ctx)
    expect(prisma.applicationStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromStatus: null, toStatus: 'NEW' }),
      }),
    )
  })

  it('отзыв не своей заявки → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.applicationRequest.findFirst.mockResolvedValue({
      id: 'app-1',
      studentId: 'other',
      status: 'NEW',
    })
    const student = viewer(Role.STUDENT, { sub: 'stud-1' })
    const err = await service.withdraw(student, 'app-1', ctx).catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('отзыв не в статусе NEW → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.applicationRequest.findFirst.mockResolvedValue({
      id: 'app-1',
      studentId: 'stud-1',
      status: 'PROCESSING',
    })
    const student = viewer(Role.STUDENT, { sub: 'stud-1' })
    const err = await service.withdraw(student, 'app-1', ctx).catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('отзыв своей заявки в NEW → soft delete', async () => {
    const { service, prisma } = setup()
    prisma.applicationRequest.findFirst.mockResolvedValue({
      id: 'app-1',
      studentId: 'stud-1',
      status: 'NEW',
    })
    prisma.applicationRequest.update.mockResolvedValue({})
    const student = viewer(Role.STUDENT, { sub: 'stud-1' })
    await service.withdraw(student, 'app-1', ctx)
    expect(prisma.applicationRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    )
  })
})

// ── 7.5 Scope списка/чтения ─────────────────────────────────────────────────
describe('ApplicationsService — scope (7.5)', () => {
  async function listWhere(v: JwtPayload) {
    const { service, prisma } = setup()
    await service.list(v, { page: 1, limit: 20 })
    return prisma.applicationRequest.findMany.mock.calls[0][0].where
  }

  it('староста видит только СВОИ заявки (не одногруппников)', async () => {
    const where = await listWhere(viewer(Role.STAROSTA, { sub: 'star-1', groupId: 'grp-1' }))
    expect(where.studentId).toBe('star-1')
    expect(where.deletedAt).toBeNull()
  })

  it('студент — только свои', async () => {
    const where = await listWhere(viewer(Role.STUDENT, { sub: 'stud-1' }))
    expect(where.studentId).toBe('stud-1')
  })

  it('декан — свой факультет', async () => {
    const where = await listWhere(viewer(Role.DEAN, { facultyId: 'fac-1' }))
    expect(where.facultyId).toBe('fac-1')
  })

  it('преподаватель заявок не видит', async () => {
    const where = await listWhere(viewer(Role.TEACHER, { universityId: 'uni-1' }))
    expect(where.id).toBe('__none__')
  })

  it('getById чужой заявки студентом → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.applicationRequest.findFirst.mockResolvedValue(
      appRow(ApplicationStatus.NEW, { studentId: 'other' }),
    )
    const err = await service
      .getById(viewer(Role.STUDENT, { sub: 'stud-1' }), 'app-1')
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })
})
