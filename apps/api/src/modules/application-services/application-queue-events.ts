import { Injectable, Logger } from '@nestjs/common'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { RealtimeGateway } from '../../common/realtime'
import { UserService } from '../users/users.service'

// Живая очередь обработчиков (21.B3, docs/PROJECT.md §9.2a). Студент о своей заявке узнаёт
// из `application.status.changed`, а очереди декана, админа и модератора вуза менялись только
// после перезагрузки страницы: новую заявку, взятую коллегой или поручённую кому-то, никто
// не видел, пока не обновит экран.

/** Поля заявки, по которым решается, чья очередь её показывает. */
export interface QueueApplication {
  id: string
  status: string
  universityId: string
  facultyId: string | null
}

@Injectable()
export class ApplicationQueueEvents {
  private readonly logger = new Logger(ApplicationQueueEvents.name)

  constructor(
    private readonly users: UserService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Сообщить очередям, что заявка изменилась: подана, сменила статус или ответственного.
   *
   * Адресаты — те, кому её показывает очередь (`ApplicationPolicy.scopeWhere`): админ и
   * модератор вуза заявки (`read:university`) и деканы её факультета (`read:faculty`). Это
   * ровно тот набор, из которого назначают ответственного, поэтому берём его оттуда же.
   * Комнаты `university:{id}` не подходят: в ней весь вуз, включая студентов. Платформенному
   * админу (`read:all`) не шлём — очереди у него нет, а вузов сотни.
   *
   * Payload — только статус, без PII: клиент перезапрашивает список и карточку сам.
   * Сбой не отменяет действие — оно уже записано; живое обновление best-effort.
   */
  async changed(app: QueueApplication): Promise<void> {
    try {
      const staff = await this.users.listApplicationAssignees(app.universityId, app.facultyId)
      this.realtime.emitEventToUsers(
        staff.map((u) => u.id),
        REALTIME_EVENTS.applicationQueueChanged,
        app.id,
        { status: app.status },
      )
    } catch (error) {
      this.logger.warn(
        `Заявка ${app.id}: не удалось обновить очереди обработчиков — ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
