import { Injectable, Logger } from '@nestjs/common'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { RealtimeGateway } from '../../common/realtime'

// Живые задания (docs/PROJECT.md §9.2d, `assignment.changed`). Раньше студент узнавал о новом
// задании только из уведомления, а преподаватель о сданной работе — только перезагрузив очередь
// проверки. Сигнал без содержимого: в data лишь вид изменения и курс, клиент перечитывает
// задания своим запросом, а сервер отдаёт их по правам зрителя.

export type AssignmentChangeKind = 'published' | 'updated' | 'submitted' | 'graded'

@Injectable()
export class AssignmentEvents {
  private readonly logger = new Logger(AssignmentEvents.name)

  constructor(private readonly realtime: RealtimeGateway) {}

  /**
   * Задание выдано или изменилось на виду у студентов — в комнату группы курса. Комната, а не
   * список студентов: сигнал ничего не раскрывает, а чужой (переведённый) студент просто
   * перечитает прежний список. У курса одна группа (`Course.groupId`).
   */
  toGroup(
    assignmentId: string,
    course: { id: string; groupId: string },
    kind: 'published' | 'updated',
  ): void {
    this.send(assignmentId, kind, () =>
      this.realtime.emitEventToRoom(
        `group:${course.groupId}`,
        REALTIME_EVENTS.assignmentChanged,
        assignmentId,
        { kind, courseId: course.id },
      ),
    )
  }

  /** Студент сдал работу — преподавателю курса: его очередь проверки растёт без перезагрузки. */
  submitted(assignmentId: string, course: { id: string; teacherId: string | null }): void {
    // Курс без преподавателя — сдачу проверяют декан или админ из общего списка, адресно некому.
    if (!course.teacherId) return
    const teacherId = course.teacherId
    this.send(assignmentId, 'submitted', () =>
      this.realtime.emitEventToUser(teacherId, REALTIME_EVENTS.assignmentChanged, assignmentId, {
        kind: 'submitted',
        courseId: course.id,
      }),
    )
  }

  /** Работу оценили или вернули на доработку — только её автору. */
  graded(assignmentId: string, courseId: string, studentId: string): void {
    this.send(assignmentId, 'graded', () =>
      this.realtime.emitEventToUser(studentId, REALTIME_EVENTS.assignmentChanged, assignmentId, {
        kind: 'graded',
        courseId,
      }),
    )
  }

  // Рассылка best-effort: действие уже записано, сбой сокета его не откатывает.
  private send(assignmentId: string, kind: AssignmentChangeKind, emit: () => void): void {
    try {
      emit()
    } catch (error) {
      this.logger.warn(
        `Задание ${assignmentId} (${kind}): не удалось разослать сигнал — ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
