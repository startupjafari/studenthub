import { Role } from '@studenthub/shared-types'
import { ConsultationsService, slotOrderBy } from './consultations.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Порядок строк таблицы — то место, где ошибка не видна на экране: список выглядит
// упорядоченным в любом случае, а страницы при этом могут перемешиваться.
describe('slotOrderBy', () => {
  it('по времени — единственный ключ: он уникален сам по себе', () => {
    expect(slotOrderBy('startsAt', 'desc')).toEqual([{ startsAt: 'desc' }])
  })

  it('по статусу — вторым ключом время, иначе порядок страниц непредсказуем', () => {
    // Статусов три на сотню слотов: без второго ключа СУБД вправе вернуть строки с
    // одинаковым статусом в любом порядке, и одна и та же запись попадала бы то на
    // первую страницу, то на вторую.
    expect(slotOrderBy('status', 'asc')).toEqual([{ status: 'asc' }, { startsAt: 'asc' }])
  })

  it('по студенту — по фамилии и имени, а не по studentId', () => {
    // studentId это uuid: сортировка по нему дала бы случайный порядок, выглядящий
    // как осмысленный.
    expect(slotOrderBy('student', 'asc')).toEqual([
      { student: { lastName: 'asc' } },
      { student: { firstName: 'asc' } },
      { startsAt: 'asc' },
    ])
  })

  it('направление применяется ко всем ключам имени, но не к запасному времени', () => {
    const order = slotOrderBy('student', 'desc')
    expect(order[0]).toEqual({ student: { lastName: 'desc' } })
    // Запасной ключ всегда возрастающий: он не про выбор пользователя, а про
    // устойчивость порядка между страницами.
    expect(order[order.length - 1]).toEqual({ startsAt: 'asc' })
  })
})

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const student: JwtPayload = {
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function setup(slot: Record<string, unknown>) {
  const prisma = {
    consultationSlot: {
      findUnique: jest.fn().mockResolvedValue(slot),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'slot-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new ConsultationsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
  )
  return { service, prisma, queue }
}

const future = new Date(Date.now() + 86_400_000)
const openSlot = {
  id: 'slot-1',
  status: 'OPEN',
  startsAt: future,
  teacherId: 't-1',
  teacher: { universityId: 'uni-1', deletedAt: null, isBlocked: false },
}

describe('ConsultationsService — запись на слот', () => {
  it('запись условная: слот занимается только из OPEN', async () => {
    const { service, prisma } = setup(openSlot)
    await service.book(student, 'slot-1', { topic: 'Курсовая' }, ctx)
    expect(prisma.consultationSlot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'slot-1', status: 'OPEN' } }),
    )
  })

  it('слот успели занять между чтением и записью → CONFLICT, уведомления нет', async () => {
    const { service, prisma, queue } = setup(openSlot)
    prisma.consultationSlot.updateMany.mockResolvedValue({ count: 0 })
    const err = await service.book(student, 'slot-1', {}, ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('удалённый преподаватель → слота как бы нет', async () => {
    const { service } = setup({
      ...openSlot,
      teacher: { universityId: 'uni-1', deletedAt: new Date(), isBlocked: false },
    })
    const err = await service.book(student, 'slot-1', {}, ctx).catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })

  it('отмена студентом слота, уже отменённого преподавателем → CONFLICT, слот не открывается', async () => {
    const { service, prisma } = setup({
      id: 'slot-1',
      status: 'CANCELLED',
      startsAt: future,
      teacherId: 't-1',
      studentId: 'stu-1',
    })
    prisma.consultationSlot.updateMany.mockResolvedValue({ count: 0 })
    const err = await service.cancel(student, 'slot-1', ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.consultationSlot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'slot-1', studentId: 'stu-1', status: 'BOOKED' } }),
    )
  })
})
