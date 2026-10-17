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
    substitutionPairs: jest.fn().mockResolvedValue([]),
  }
  const events = {
    list: jest.fn().mockResolvedValue({ items: [{ id: 'e1' }], meta: { total: 1 } }),
  }
  const notifications = { list: jest.fn().mockResolvedValue({ items: [{ id: 'n1' }], meta: {} }) }
  const assignments = { list: jest.fn().mockResolvedValue({ items: [{ id: 'a1' }], meta: {} }) }
  const applications = { list: jest.fn().mockResolvedValue({ items: [{ id: 'app1' }], meta: {} }) }
  const prisma = {
    // Часовой пояс вуза — для даты «сегодня».
    university: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Almaty' }) },
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

  it('задания — окно по сроку на неделю вперёд, а не первые 20 за все семестры (C-F17)', async () => {
    const { service, assignments } = setup()
    const before = Date.now()
    await service.today(student)

    expect(assignments.list).toHaveBeenCalledTimes(1)
    const [, query] = assignments.list.mock.calls[0] as [JwtPayload, Record<string, unknown>]
    expect(query).toMatchObject({ page: 1, limit: 50 })
    // Сортировку не задаём: студенту list сам отдаёт «актуальные сверху».
    expect(query.sort).toBeUndefined()
    const dueTo = new Date(query.dueTo as string).getTime()
    expect(dueTo - before).toBeGreaterThanOrEqual(9 * 86_400_000)
    expect(dueTo - before).toBeLessThan(10 * 86_400_000)
  })

  it('не запрашивает заявки для не-студенческих ролей', async () => {
    const { service, applications } = setup()
    const res = await service.today(teacher)

    expect(applications.list).not.toHaveBeenCalled()
    expect(res.applications).toEqual([])
    expect(res.assignments).toEqual([{ id: 'a1' }])
  })

  it('преподавателю добавляет пары, которые он сегодня ведёт по замене (C-F12)', async () => {
    const { service, schedules } = setup()
    schedules.substitutionPairs.mockResolvedValueOnce([{ id: 'p-sub' }, { id: 'p1' }])
    const res = await service.today(teacher)

    // Своя пара p1 не дублируется, чужая по замене — добавлена.
    expect(res.pairs.map((p) => p.id)).toEqual(['p1', 'p-sub'])
    expect(schedules.substitutionPairs).toHaveBeenCalledWith(teacher, res.date)
  })

  it('сбой выборки замен не роняет расписание дня', async () => {
    const { service, schedules } = setup()
    schedules.substitutionPairs.mockRejectedValueOnce(new Error('db down'))
    const res = await service.today(teacher)

    expect(res.pairs.map((p) => p.id)).toEqual(['p1'])
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
