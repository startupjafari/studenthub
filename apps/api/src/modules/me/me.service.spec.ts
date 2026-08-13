import { Role } from '@studenthub/shared-types'
import { MeService } from './me.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { SchedulesService } from '../schedules/schedules.service'
import type { EventsService } from '../events/events.service'
import type { NotificationsService } from '../notifications/notifications.service'
import type { AssignmentsService } from '../assignments/assignments.service'
import type { ApplicationsService } from '../application-services/applications.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

function setup() {
  const schedules = {
    getSchedule: jest.fn().mockResolvedValue({ timezone: 'Asia/Almaty', pairs: [{ id: 'p1' }] }),
    listChanges: jest.fn().mockResolvedValue([{ id: 'c1' }]),
  }
  const events = {
    list: jest.fn().mockResolvedValue({ items: [{ id: 'e1' }], meta: { total: 1 } }),
  }
  const notifications = { list: jest.fn().mockResolvedValue({ items: [{ id: 'n1' }], meta: {} }) }
  const assignments = { list: jest.fn().mockResolvedValue({ items: [{ id: 'a1' }], meta: {} }) }
  const applications = { list: jest.fn().mockResolvedValue({ items: [{ id: 'app1' }], meta: {} }) }
  const prisma = {
    applicationEvent: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            id: 'ae1',
            action: 'STATUS_CHANGED',
            applicationId: 'app1',
            actorId: 'x',
            fromStatus: 'DRAFT',
            toStatus: 'SUBMITTED',
            comment: null,
            createdAt: new Date('2026-06-15T10:00:00Z'),
          },
        ]),
    },
    documentEvent: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            id: 'de1',
            action: 'UPLOAD',
            documentId: 'doc1',
            actorId: 'u1',
            metadata: null,
            createdAt: new Date('2026-06-15T12:00:00Z'),
          },
        ]),
    },
    auditLog: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            id: 'al1',
            action: 'LOGIN',
            entity: 'User',
            entityId: 'u1',
            metadata: null,
            createdAt: new Date('2026-06-15T08:00:00Z'),
          },
        ]),
    },
  }
  const service = new MeService(
    prisma as unknown as PrismaService,
    schedules as unknown as SchedulesService,
    events as unknown as EventsService,
    notifications as unknown as NotificationsService,
    assignments as unknown as AssignmentsService,
    applications as unknown as ApplicationsService,
  )
  return { service, prisma, schedules, events, notifications, assignments, applications }
}

const student: JwtPayload = {
  sub: 'u1',
  role: Role.STUDENT,
  universityId: 'uni1',
  facultyId: 'f1',
  groupId: 'g1',
}
const teacher: JwtPayload = { ...student, sub: 'u2', role: Role.TEACHER, groupId: null }

describe('MeService.today', () => {
  it('собирает день студента из всех источников', async () => {
    const { service, applications } = setup()
    const res = await service.today(student)

    expect(res.role).toBe(Role.STUDENT)
    expect(res.timezone).toBe('Asia/Almaty')
    expect(res.pairs).toHaveLength(1)
    expect(res.scheduleChanges).toHaveLength(1)
    expect(res.applications).toEqual([{ id: 'app1' }])
    expect(res.events).toEqual([{ id: 'e1' }])
    expect(res.assignments).toEqual([{ id: 'a1' }])
    expect(res.notifications).toEqual([{ id: 'n1' }])
    expect(applications.list).toHaveBeenCalledTimes(1)
  })

  it('не запрашивает заявки для не-студенческих ролей', async () => {
    const { service, applications } = setup()
    const res = await service.today(teacher)

    expect(applications.list).not.toHaveBeenCalled()
    expect(res.applications).toEqual([])
    expect(res.assignments).toEqual([{ id: 'a1' }])
  })

  it('устойчив к сбою одного источника (возвращает дефолт, остальное цело)', async () => {
    const { service, events } = setup()
    events.list.mockRejectedValueOnce(new Error('events down'))
    const res = await service.today(student)

    expect(res.events).toEqual([])
    expect(res.pairs).toHaveLength(1)
    expect(res.notifications).toEqual([{ id: 'n1' }])
  })
})

describe('MeService.activity', () => {
  it('сводит три журнала в общий контракт и сортирует по времени desc', async () => {
    const { service } = setup()
    const res = await service.activity(student, 30)

    // Порядок по ts desc: document(12:00) → application(10:00) → audit(08:00).
    expect(res.map((a) => a.source)).toEqual(['document', 'application', 'audit'])
    expect(res[0]).toMatchObject({
      id: 'document:de1',
      source: 'document',
      entityType: 'Document',
      entityId: 'doc1',
    })
    expect(res[1]).toMatchObject({
      id: 'application:ae1',
      source: 'application',
      entityType: 'Application',
      entityId: 'app1',
      meta: { fromStatus: 'DRAFT', toStatus: 'SUBMITTED', comment: null },
    })
    expect(res[2]).toMatchObject({ id: 'audit:al1', source: 'audit', action: 'LOGIN' })
  })

  it('scope = свои: фильтрует по studentId/ownerId/userId', async () => {
    const { service, prisma } = setup()
    await service.activity(student, 30)

    expect(prisma.applicationEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { application: { studentId: 'u1' } } }),
    )
    expect(prisma.documentEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { document: { is: { ownerId: 'u1' } } } }),
    )
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    )
  })

  it('соблюдает общий лимит после слияния', async () => {
    const { service } = setup()
    const res = await service.activity(student, 2)
    expect(res).toHaveLength(2)
  })
})
