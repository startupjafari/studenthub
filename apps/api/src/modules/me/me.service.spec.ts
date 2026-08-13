import { Role } from '@studenthub/shared-types'
import { MeService } from './me.service'
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
  const service = new MeService(
    schedules as unknown as SchedulesService,
    events as unknown as EventsService,
    notifications as unknown as NotificationsService,
    assignments as unknown as AssignmentsService,
    applications as unknown as ApplicationsService,
  )
  return { service, schedules, events, notifications, assignments, applications }
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
