import { Role } from '@studenthub/shared-types'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { ApplicationQueueEvents, type QueueApplication } from './application-queue-events'
import type { RealtimeGateway } from '../../common/realtime'
import type { UserService } from '../users/users.service'

// Адресация живой очереди (21.B3): событие уходит тем, чья очередь показывает заявку, —
// админу и модератору её вуза и деканам её факультета, — и только в их личные комнаты.

function setup(staff: Array<{ id: string; role: Role }> = []) {
  const users = { listApplicationAssignees: jest.fn().mockResolvedValue(staff) }
  const realtime = { emitEventToUsers: jest.fn(), emitEventToRoom: jest.fn() }
  const events = new ApplicationQueueEvents(
    users as unknown as UserService,
    realtime as unknown as RealtimeGateway,
  )
  return { events, users, realtime }
}

const app: QueueApplication = {
  id: 'a1',
  status: 'SUBMITTED',
  universityId: 'uni',
  facultyId: 'fac',
}

describe('ApplicationQueueEvents.changed', () => {
  it('обработчикам вуза и факультета заявки — конверт application.queue.changed', async () => {
    const { events, users, realtime } = setup([
      { id: 'dean-1', role: Role.DEAN },
      { id: 'ua', role: Role.UNIVERSITY_ADMIN },
      { id: 'um', role: Role.UNIVERSITY_MODERATOR },
    ])
    await events.changed(app)
    // Аудитория — по вузу и факультету самой заявки, а не того, кто действовал.
    expect(users.listApplicationAssignees).toHaveBeenCalledWith('uni', 'fac')
    expect(realtime.emitEventToUsers).toHaveBeenCalledTimes(1)
    expect(realtime.emitEventToUsers).toHaveBeenCalledWith(
      ['dean-1', 'ua', 'um'],
      REALTIME_EVENTS.applicationQueueChanged,
      'a1',
      { status: 'SUBMITTED' },
    )
    // Не в комнату вуза: там и студенты, и преподаватели.
    expect(realtime.emitEventToRoom).not.toHaveBeenCalled()
  })

  it('вузовская услуга (без факультета) — аудитория без деканов', async () => {
    const { events, users } = setup([{ id: 'ua', role: Role.UNIVERSITY_ADMIN }])
    await events.changed({ ...app, facultyId: null })
    expect(users.listApplicationAssignees).toHaveBeenCalledWith('uni', null)
  })

  it('payload — только статус: ни номера, ни имени студента', async () => {
    const { events, realtime } = setup([{ id: 'ua', role: Role.UNIVERSITY_ADMIN }])
    await events.changed({
      ...app,
      number: 'SH-2026-000001',
      studentId: 'stud',
    } as QueueApplication)
    const data = realtime.emitEventToUsers.mock.calls[0][3]
    expect(data).toEqual({ status: 'SUBMITTED' })
  })

  it('сбой чтения аудитории не роняет действие над заявкой', async () => {
    const { events, users, realtime } = setup()
    users.listApplicationAssignees.mockRejectedValue(new Error('db down'))
    await expect(events.changed(app)).resolves.toBeUndefined()
    expect(realtime.emitEventToUsers).not.toHaveBeenCalled()
  })
})
