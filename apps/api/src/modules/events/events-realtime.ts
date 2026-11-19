import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { RealtimeCoalescer, RealtimeGateway } from '../../common/realtime'

// Живые события вуза (эпик «всё живое по сокету», docs/PROJECT.md §9.2d). Новое событие,
// перенос, отмена и число записавшихся раньше обновлялись только после перезагрузки списка.

export type EventChangeKind = 'created' | 'updated' | 'deleted' | 'registrations'

/** Окно склейки записей: популярное событие за минуту записывает десятки человек. */
const REGISTRATIONS_WINDOW_MS = 2000

@Injectable()
export class EventsRealtime implements OnModuleDestroy {
  private readonly logger = new Logger(EventsRealtime.name)
  private readonly registrations = new RealtimeCoalescer(REGISTRATIONS_WINDOW_MS)

  constructor(private readonly realtime: RealtimeGateway) {}

  onModuleDestroy(): void {
    this.registrations.clear()
  }

  /**
   * Сигнал «событие изменилось» его вузу. Комната вуза шире аудитории события (факультет,
   * группа), но в data нет ничего, кроме вида изменения: клиент перечитывает список своим
   * запросом, и сервер отдаёт его по правам зрителя (§9.2d).
   *
   * У события платформы (аудитория «для всех») вуза нет, а видит его каждый — сигнал уходит
   * всем подключённым, как пост «для всех».
   */
  changed(event: { id: string; universityId: string | null }, kind: EventChangeKind): void {
    if (kind === 'registrations') {
      // Запись и отмена — частые: склеиваем по событию, уходит последний сигнал окна.
      this.registrations.schedule(event.id, () => this.send(event, kind))
      return
    }
    this.send(event, kind)
  }

  /** Best-effort: событие уже записано, сбой рассылки действие не отменяет. */
  private send(event: { id: string; universityId: string | null }, kind: EventChangeKind): void {
    try {
      if (event.universityId) {
        this.realtime.emitEventToRoom(
          `university:${event.universityId}`,
          REALTIME_EVENTS.eventChanged,
          event.id,
          { kind },
        )
      } else {
        this.realtime.emitEventToAll(REALTIME_EVENTS.eventChanged, event.id, { kind })
      }
    } catch (error) {
      this.logger.warn(
        `Событие ${event.id}: не удалось отправить сигнал «${kind}» — ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
