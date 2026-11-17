import { Role } from '@studenthub/shared-types'
import { complaintPriorityFor } from '@studenthub/shared-schemas'
import { ComplaintsService } from './complaints.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Жалоба на группу целиком (§11, цель CHAT): подаёт только участник, нарушитель — владелец,
// приоритет как у публичного контента, удалить группу «как контент» нельзя.

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const prisma = {
    complaint: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: unknown }) => ({ id: 'c-new', data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    chat: {
      findFirst: jest.fn().mockResolvedValue({ universityId: null, createdById: 'owner' }),
      findUnique: jest.fn(),
    },
    chatMember: { findUnique: jest.fn().mockResolvedValue({ bannedAt: null }) },
    user: {
      findUnique: jest.fn().mockResolvedValue({ universityId: 'uni1', role: Role.STUDENT }),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prisma) => unknown)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  )
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new ComplaintsService(
    prisma as unknown as PrismaService,
    audit as never,
    { enqueue: jest.fn() } as never,
    { setBlocked: jest.fn(), warn: jest.fn() } as never,
    { notifyStaff: jest.fn() } as never,
    {} as never,
    { emitToRoom: jest.fn() } as never,
    {} as never,
  )
  return { service, prisma }
}

const student: JwtPayload = {
  sub: 'r1',
  role: Role.STUDENT,
  universityId: 'uni1',
  facultyId: null,
  groupId: null,
}

describe('Жалоба на группу (CHAT)', () => {
  it('участник жалуется: вуз — владельца группы, приоритет MEDIUM', async () => {
    const { service, prisma } = setup()
    await service.create(student, { targetType: 'CHAT', targetId: 'g1', reason: 'спам' }, ctx)
    expect(complaintPriorityFor('CHAT')).toBe('MEDIUM')
    expect(prisma.complaint.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetType: 'CHAT',
          targetId: 'g1',
          universityId: 'uni1',
          priority: 'MEDIUM',
        }),
      }),
    )
  })

  it('не участник (или забаненный) — NOT_FOUND, как несуществующая группа', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValueOnce(null)
    await expect(
      service.create(student, { targetType: 'CHAT', targetId: 'g1', reason: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    prisma.chatMember.findUnique.mockResolvedValueOnce({ bannedAt: new Date() })
    await expect(
      service.create(student, { targetType: 'CHAT', targetId: 'g1', reason: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('не пользовательская группа (личный или официальный чат) — NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue(null)
    await expect(
      service.create(student, { targetType: 'CHAT', targetId: 'p1', reason: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prisma.chat.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1', type: 'GROUP' } }),
    )
  })

  it('«снять контент» к группе неприменимо — BAD_REQUEST, жалоба остаётся в очереди', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue({
      id: 'k1',
      targetType: 'CHAT',
      targetId: 'g1',
      status: 'PENDING',
      universityId: 'uni1',
      reporter: { id: 'r1' },
      resolvedBy: null,
    })
    const moderator: JwtPayload = { ...student, sub: 'm1', role: Role.PLATFORM_MODERATOR }
    await expect(
      service.resolve(moderator, 'k1', { action: 'DELETE_CONTENT' }, ctx),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prisma.complaint.updateMany).not.toHaveBeenCalled()
  })
})
