import { Role } from '@studenthub/shared-types'
import { ExamsService } from './exams.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

// Экзамен по дисциплине преподавателя `lecturer`, принимает его `examiner`.
const examRow = {
  id: 'ex-1',
  groupId: 'grp-1',
  examinerId: 'examiner',
  course: {
    teacherId: 'lecturer',
    group: { facultyId: 'fac-1', faculty: { universityId: 'uni-1' } },
  },
}

function setup() {
  const prisma = {
    exam: {
      findUnique: jest.fn().mockResolvedValue(examRow),
      update: jest.fn().mockResolvedValue({ id: 'ex-1' }),
      delete: jest.fn(),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'st-1' }]) },
    examResult: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new ExamsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { service, prisma }
}

const teacher = (sub: string): JwtPayload => ({
  sub,
  role: Role.TEACHER,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
})

describe('ExamsService — ведомость ведёт экзаменатор', () => {
  it('экзаменатор, не читающий дисциплину, открывает ведомость', async () => {
    const { service } = setup()
    await expect(service.results(teacher('examiner'), 'ex-1')).resolves.toMatchObject({
      examId: 'ex-1',
    })
  })

  it('экзаменатор выставляет результаты', async () => {
    const { service, prisma } = setup()
    await service.setResults(
      teacher('examiner'),
      {
        examId: 'ex-1',
        entries: [{ studentId: 'st-1', admitted: true, status: 'PASSED', score: 85 }],
      },
      ctx,
    )
    expect(prisma.examResult.upsert).toHaveBeenCalled()
  })

  it('править сам экзамен экзаменатор не может — это за ведущим дисциплину', async () => {
    const { service, prisma } = setup()
    await expect(
      service.update(teacher('examiner'), 'ex-1', { note: 'перенос' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prisma.exam.update).not.toHaveBeenCalled()
  })

  it('посторонний преподаватель ведомость не получает', async () => {
    const { service } = setup()
    await expect(service.results(teacher('stranger'), 'ex-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('ведущий дисциплину по-прежнему видит ведомость', async () => {
    const { service } = setup()
    await expect(service.results(teacher('lecturer'), 'ex-1')).resolves.toBeDefined()
  })
})
