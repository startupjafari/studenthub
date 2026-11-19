import { Injectable, Logger } from '@nestjs/common'
import {
  COMPANY_CONTENT_VISIBILITY,
  REALTIME_EVENTS,
  UNIVERSITY_PAGE_CONTENT_VISIBILITY,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { RealtimeGateway } from '../../common/realtime'

// Живое обсуждение статьи (эпик «всё живое по сокету», docs/PROJECT.md §9.2d). Комментарий
// под статьёй появлялся у читающих её только после перезагрузки страницы /articles/<id>.
// Сигнал тот же, что у поста, — `post.comments.changed` (в реестре: «под постом или
// статьёй»), `entityId` — id статьи, в data только число комментариев. Клиент перечитывает
// обсуждение своим запросом, сервер отдаёт его по правам зрителя.

/** Поля статьи, по которым выбираются комнаты сигнала. */
interface ArticleRoomsTarget {
  id: string
  userId: string
  status: string
  visibility: string
  universityPageId: string | null
  user: { universityId: string | null; groupId: string | null }
}

/**
 * Комнаты сигнала по видимости статьи. `'all'` — всем подключённым: статью «для всех» видит
 * каждый. Права поштучно не проверяем — сигнал без содержимого, а кому статья не видна, тот
 * её обсуждение и не открыл.
 *
 * Личная комната автора — всегда: его вторая вкладка и телефон. Черновик видит только автор.
 * Статья страницы компании видна вузам с допуском — их может быть много, а комнаты компании
 * нет: такие обсуждения живут только у автора (остальные перечитают при возврате во вкладку).
 */
export function articleRooms(article: ArticleRoomsTarget): string[] | 'all' {
  const author = `user:${article.userId}`
  if (article.status !== 'PUBLISHED') return [author]
  const university = article.user.universityId
  switch (article.visibility) {
    case 'ALL':
      return 'all'
    case 'UNIVERSITY':
    case 'FACULTY':
      // Комнаты факультета нет — вуз автора; чужой факультет перечитает прежнее (ничего).
      return university ? [`university:${university}`, author] : [author]
    case 'GROUP':
      return article.user.groupId ? [`group:${article.user.groupId}`, author] : [author]
    case UNIVERSITY_PAGE_CONTENT_VISIBILITY:
      return article.universityPageId
        ? [`university:${article.universityPageId}`, author]
        : [author]
    case COMPANY_CONTENT_VISIBILITY:
    default:
      return [author]
  }
}

@Injectable()
export class ArticleLiveEvents {
  private readonly logger = new Logger(ArticleLiveEvents.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Под статьёй добавили или удалили комментарий. Число — из БД в момент отправки: клиент
   * получает итог, а не прибавку. Best-effort: комментарий уже записан или удалён, сбой
   * рассылки его не отменяет и наружу не пробрасывается.
   */
  async commentsChanged(articleId: string): Promise<void> {
    try {
      const article = await this.prisma.profileArticle.findUnique({
        where: { id: articleId },
        select: {
          id: true,
          userId: true,
          status: true,
          visibility: true,
          universityPageId: true,
          user: { select: { universityId: true, groupId: true } },
        },
      })
      if (!article) return
      const count = await this.prisma.contentComment.count({ where: { articleId } })
      const rooms = articleRooms(article)
      const data = { count }
      if (rooms === 'all') {
        this.realtime.emitEventToAll(REALTIME_EVENTS.postCommentsChanged, articleId, data)
      } else {
        this.realtime.emitEventToRooms(rooms, REALTIME_EVENTS.postCommentsChanged, articleId, data)
      }
    } catch (error) {
      this.logger.warn(
        `Статья ${articleId}: не удалось разослать живое обновление обсуждения — ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
