import { Injectable, Logger } from '@nestjs/common'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { RealtimeGateway } from '../../common/realtime'

// Живые кольца историй (эпик «всё живое по сокету», docs/PROJECT.md §9.2d). Новая история
// однокурсника появлялась в ленте колец только после перезагрузки, а удалённая продолжала
// висеть кольцом, которое открывалось в «не найдено».

@Injectable()
export class StoryLiveEvents {
  private readonly logger = new Logger(StoryLiveEvents.name)

  constructor(private readonly realtime: RealtimeGateway) {}

  /**
   * У автора появилась или пропала история. Сигнал — только id автора: клиент перечитывает
   * кольца своим запросом, а сервер отдаёт их по правам зрителя (друзья, группа, факультет),
   * поэтому комнату вуза не нужно сужать до тех, кому история видна.
   *
   * Личная комната автора — для его же второй вкладки и телефона: своё кольцо там обновится
   * без перезагрузки. Автор без вуза (платформа, работодатель) получает только её.
   * Сбой рассылки не отменяет публикацию или удаление — они уже записаны.
   */
  changed(author: { id: string; universityId: string | null | undefined }): void {
    try {
      const rooms = [`user:${author.id}`]
      if (author.universityId) rooms.unshift(`university:${author.universityId}`)
      this.realtime.emitEventToRooms(rooms, REALTIME_EVENTS.storiesChanged, author.id, {
        authorId: author.id,
      })
    } catch (error) {
      this.logger.warn(
        `Истории автора ${author.id}: не удалось разослать живое обновление — ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
