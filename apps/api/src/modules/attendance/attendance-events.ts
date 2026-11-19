import { Injectable, Logger } from '@nestjs/common'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { RealtimeGateway } from '../../common/realtime'

// Живая посещаемость (docs/PROJECT.md §9.2d, `attendance.changed`). Студент видел свою отметку
// только после перезагрузки «Посещаемости»: преподаватель отметил пропуск или исправил его на
// уважительную причину, а у студента прежний процент. Сигнал без содержимого — data пустая,
// клиент перечитывает сводку своим запросом.

@Injectable()
export class AttendanceEvents {
  private readonly logger = new Logger(AttendanceEvents.name)

  constructor(private readonly realtime: RealtimeGateway) {}

  /**
   * Отметки занятия изменились — только тем студентам, чья отметка действительно поменялась.
   * Журнал сохраняют целиком, и сигнал всей группе при каждом сохранении заставлял бы
   * перечитывать сводку тех, у кого ничего не произошло. Отправка одна на всех адресатов.
   */
  marksChanged(pairId: string, studentIds: string[]): void {
    if (studentIds.length === 0) return
    try {
      this.realtime.emitEventToUsers(studentIds, REALTIME_EVENTS.attendanceChanged, pairId, {})
    } catch (error) {
      // Best-effort: отметки уже записаны, сбой рассылки их не откатывает.
      this.logger.warn(
        `Занятие ${pairId}: не удалось разослать сигнал посещаемости — ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
