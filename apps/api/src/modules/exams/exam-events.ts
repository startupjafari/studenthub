import { Injectable, Logger } from '@nestjs/common'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { RealtimeGateway } from '../../common/realtime'

// Живые экзамены (docs/PROJECT.md §9.2d, `exam.changed`). Раньше о назначении, переносе и
// отмене студент узнавал из уведомления, а список «Экзамены», календарь и «Задачи»
// обновлялись только после перезагрузки. Сигнал без содержимого: в data лишь вид изменения,
// клиент перечитывает экзамены своим запросом, а сервер отдаёт их по правам зрителя.

export type ExamChangeKind = 'scheduled' | 'updated' | 'cancelled' | 'results'

@Injectable()
export class ExamEvents {
  private readonly logger = new Logger(ExamEvents.name)

  constructor(private readonly realtime: RealtimeGateway) {}

  /**
   * Экзамен назначен, перенесён (или правлен) либо отменён — комнате его группы и личным
   * комнатам ведущего дисциплину и экзаменатора. Преподаватель в комнате группы не состоит,
   * а экзамен видит в своём списке — без личной комнаты его экран остался бы мёртвым.
   * При смене экзаменатора в `staffIds` передаются оба: у прежнего экзамен из списка уходит.
   */
  changed(
    exam: { id: string; groupId: string },
    kind: Exclude<ExamChangeKind, 'results'>,
    staffIds: (string | null | undefined)[],
  ): void {
    const staff = [...new Set(staffIds.filter((id): id is string => !!id))]
    this.send(exam.id, kind, () =>
      this.realtime.emitEventToRooms(
        [`group:${exam.groupId}`, ...staff.map((id) => `user:${id}`)],
        REALTIME_EVENTS.examChanged,
        exam.id,
        { kind },
      ),
    )
  }

  /**
   * В ведомости изменились строки — только их студентам: результат личный, и остальной
   * группе перечитывать нечего.
   */
  results(examId: string, studentIds: string[]): void {
    const ids = [...new Set(studentIds)]
    if (ids.length === 0) return
    this.send(examId, 'results', () =>
      this.realtime.emitEventToUsers(ids, REALTIME_EVENTS.examChanged, examId, {
        kind: 'results',
      }),
    )
  }

  // Рассылка best-effort: экзамен уже записан, сбой сокета действие не откатывает.
  private send(examId: string, kind: ExamChangeKind, emit: () => void): void {
    try {
      emit()
    } catch (error) {
      this.logger.warn(
        `Экзамен ${examId} (${kind}): не удалось разослать сигнал — ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
