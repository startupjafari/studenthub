import { Role } from '@studenthub/shared-types'
import { ExamsService } from './exams.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const dean: JwtPayload = {
  sub: 'dean-1',
  role: Role.DEAN,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: null,
}

function setup(scored: number, date = new Date('2026-06-10T04:00:00.000Z')) {
  const prisma = {
    exam: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'ex-1',
        groupId: 'grp-1',
        date,
        roomId: null,
        examinerId: 't-1',
        course: {
          teacherId: 't-1',
          subject: { name: 'Матанализ' },
          group: { facultyId: 'fac-1', faculty: { universityId: 'uni-1' } },
        },
      }),
      delete: jest.fn().mockResolvedValue({}),
    },
    examResult: { count: jest.fn().mockResolvedValue(scored) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'st-1' }]) },
    group: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ faculty: { university: { timezone: 'Asia/Almaty' } } }),
    },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new ExamsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
  )
  return { service, prisma, queue }
}

describe('ExamsService.remove — ведомость', () => {
  it('есть результаты → CONFLICT, экзамен остаётся', async () => {
    const { service, prisma } = setup(2)
    const err = await service.remove(dean, 'ex-1', ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.exam.delete).not.toHaveBeenCalled()
  })

  it('без результатов удаляется', async () => {
    const { service, prisma } = setup(0)
    await service.remove(dean, 'ex-1', ctx)
    expect(prisma.exam.delete).toHaveBeenCalledWith({ where: { id: 'ex-1' } })
  })

  it('отмена предстоящего экзамена → уведомление группе', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60_000)
    const { service, queue } = setup(0, future)
    await service.remove(dean, 'ex-1', ctx)
    const [queueName, jobName, payload] = queue.enqueue.mock.calls[0]
    expect(queueName).toBe('notifications')
    expect(jobName).toBe('exam-cancelled')
    expect(payload).toMatchObject({
      recipientIds: ['st-1'],
      type: 'SCHEDULE_CHANGE',
      titleKey: 'exams.cancelled.title',
      params: { subject: 'Матанализ' },
      dedupeKey: 'exam-cancelled:ex-1',
    })
  })

  it('удаление прошедшего экзамена студентов не тревожит', async () => {
    const { service, queue } = setup(0)
    await service.remove(dean, 'ex-1', ctx)
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})
