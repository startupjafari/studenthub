import { Role } from '@studenthub/shared-types'
import { complaintPriorityFor } from '@studenthub/shared-schemas'
import { ComplaintsService } from './complaints.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Жалоба на личный набор стикеров (цель STICKER_SET): подаёт любой, кому набор виден по
// ссылке; нарушитель — владелец, вуз — его вуз; «снять контент» скрывает набор у всех.

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
    stickerSet: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ createdById: 'owner', createdBy: { universityId: 'uni2' } }),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ universityId: 'uni2', role: Role.STUDENT }),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prisma) => unknown)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  )
  const service = new ComplaintsService(
    prisma as unknown as PrismaService,
    { record: jest.fn().mockResolvedValue(undefined) } as never,
    { enqueue: jest.fn() } as never,
    { setBlocked: jest.fn(), warn: jest.fn() } as never,
    { notifyStaff: jest.fn() } as never,
    {} as never,
    { emitToRoom: jest.fn() } as never,
    {} as never,
    { complaint: jest.fn() } as never,
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

describe('Жалоба на набор стикеров (STICKER_SET)', () => {
  it('жалоба уходит в вуз владельца набора, приоритет MEDIUM', async () => {
    const { service, prisma } = setup()
    await service.create(
      student,
      { targetType: 'STICKER_SET', targetId: 's1', reason: 'оскорбительно' },
      ctx,
    )
    expect(complaintPriorityFor('STICKER_SET')).toBe('MEDIUM')
    expect(prisma.stickerSet.findFirst.mock.calls[0][0].where).toEqual({
      id: 's1',
      kind: 'USER',
      deletedAt: null,
      removedAt: null,
    })
    expect(prisma.complaint.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetType: 'STICKER_SET',
          universityId: 'uni2',
          priority: 'MEDIUM',
        }),
      }),
    )
  })

  it('каталог платформы, удалённый или снятый набор — NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.stickerSet.findFirst.mockResolvedValue(null)
    await expect(
      service.create(student, { targetType: 'STICKER_SET', targetId: 'cat', reason: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('«снять контент» скрывает набор у всех и запоминает модератора', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue({
      id: 'k1',
      targetType: 'STICKER_SET',
      targetId: 's1',
      status: 'PENDING',
      universityId: 'uni2',
      reporter: { id: 'r1' },
      resolvedBy: null,
    })
    const moderator: JwtPayload = { ...student, sub: 'm1', role: Role.PLATFORM_MODERATOR }
    await service.resolve(moderator, 'k1', { action: 'DELETE_CONTENT' }, ctx)
    expect(prisma.stickerSet.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', kind: 'USER', removedAt: null },
      data: { removedAt: expect.any(Date), removedById: 'm1' },
    })
  })
})
