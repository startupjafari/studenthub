import { Injectable, Logger } from '@nestjs/common'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { RealtimeGateway } from '../../common/realtime'

// Живые друзья (эпик «всё живое по сокету», docs/PROJECT.md §9.2d). Входящая заявка, принятие
// и удаление из друзей раньше становились видны второй стороне только после перезагрузки:
// список заявок, бейдж и кнопка в профиле жили на старом кэше.

/**
 * Вид изменения связи. `removed` — дружбу удалили или инициатор отозвал свою заявку:
 * для второй стороны это одно и то же — связь исчезла, перечитать списки.
 */
export type FriendsChangeKind = 'requested' | 'accepted' | 'declined' | 'removed'

@Injectable()
export class FriendsRealtime {
  private readonly logger = new Logger(FriendsRealtime.name)

  constructor(private readonly realtime: RealtimeGateway) {}

  /**
   * Сигнал второй стороне связи — в её личную комнату. Инициатору не шлём: у него экран уже
   * обновлён ответом на его же запрос. В data только вид изменения, без имён — клиент
   * перечитывает списки и счётчики сам, по своим правам.
   *
   * Best-effort: действие уже записано, сбой рассылки его не отменяет.
   */
  changed(otherUserId: string, friendshipId: string, kind: FriendsChangeKind): void {
    try {
      this.realtime.emitEventToUser(otherUserId, REALTIME_EVENTS.friendsChanged, friendshipId, {
        kind,
      })
    } catch (error) {
      this.logger.warn(
        `Дружба ${friendshipId}: не удалось отправить сигнал «${kind}» — ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
