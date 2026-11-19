import { Injectable, Logger } from '@nestjs/common'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { RealtimeGateway } from '../../common/realtime'

// Живые «Мои книги» (docs/PROJECT.md §9.2d, `library.loan.changed`). Читатель стоит у стойки,
// библиотекарь сканирует книгу — а у читателя в телефоне прежний список, пока он не обновит
// страницу. Сигнал без содержимого: в data только вид изменения, без названия книги и срока.

/**
 * Вид изменения выдачи. Отмена ошибочной выдачи закрывает её как возврат (`returned`),
 * отмена ошибочного возврата снова открывает (`issued`), погашение долга за утерю — `lost`:
 * клиенту важно лишь, какой список перечитать, а не точный статус.
 */
export type LibraryLoanChangeKind = 'issued' | 'renewed' | 'returned' | 'lost'

@Injectable()
export class LibraryLoanEvents {
  private readonly logger = new Logger(LibraryLoanEvents.name)

  constructor(private readonly realtime: RealtimeGateway) {}

  /** Выдача изменилась — только её читателю. Выдача без читателя (обезличена) — некому. */
  changed(loanId: string, readerId: string | null, kind: LibraryLoanChangeKind): void {
    if (!readerId) return
    try {
      this.realtime.emitEventToUser(readerId, REALTIME_EVENTS.libraryLoanChanged, loanId, { kind })
    } catch (error) {
      // Best-effort: выдача уже записана, сбой рассылки её не откатывает.
      this.logger.warn(
        `Выдача ${loanId} (${kind}): не удалось разослать сигнал — ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
