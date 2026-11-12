import { Injectable } from '@nestjs/common'
import { CHAT_CHECKLIST_LIMITS } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { RealtimeGateway } from '../../common/realtime'
import { AppException } from '../../common/exceptions/app.exception'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { ChatsService } from './chats.service'
import { CHECKLIST_SELECT, toChecklistDto, type ChecklistDto } from './checklist-dto'

/** Чек-лист с тем, что нужно для проверки прав: чат и автор сообщения. */
interface ChecklistAccess {
  id: string
  othersCanAdd: boolean
  othersCanMark: boolean
  chatId: string
  authorId: string
}

/**
 * Чек-листы в чатах: пункты добавляют, убирают и отмечают после отправки сообщения.
 *
 * Права: автор сообщения-чек-листа может всё. Остальные участники добавляют пункты, только
 * если `othersCanAdd`, и отмечают — только если `othersCanMark`; убрать пункт может ещё и тот,
 * кто его добавил. Каждое изменение уходит всей комнате `checklist:updated` с чек-листом
 * целиком и двигает `ChatChecklist.updatedAt` — по нему догон после обрыва отдаёт сообщение
 * в `mutated`.
 */
@Injectable()
export class ChatChecklistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chats: ChatsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async get(userId: string, checklistId: string): Promise<ChecklistDto> {
    const access = await this.access(checklistId)
    await this.chats.assertMembership(userId, access.chatId)
    return this.read(checklistId)
  }

  async addItem(userId: string, checklistId: string, text: string): Promise<ChecklistDto> {
    const access = await this.access(checklistId)
    await this.chats.assertCanAct(userId, access.chatId)
    if (access.authorId !== userId && !access.othersCanAdd) {
      throw new AppException('FORBIDDEN', 'Добавлять пункты может только автор списка')
    }
    // Потолок и номер нового пункта — под локом на список: два параллельных добавления
    // иначе оба видели бы 49 пунктов и получали бы один и тот же номер.
    await this.prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, `chat-checklist:${checklistId}`)
      const last = await tx.chatChecklistItem.findFirst({
        where: { checklistId },
        orderBy: { order: 'desc' },
        select: { order: true },
      })
      const count = await tx.chatChecklistItem.count({ where: { checklistId } })
      if (count >= CHAT_CHECKLIST_LIMITS.ITEMS_MAX) {
        throw new AppException(
          'BAD_REQUEST',
          `В списке не может быть больше ${CHAT_CHECKLIST_LIMITS.ITEMS_MAX} пунктов`,
        )
      }
      await tx.chatChecklistItem.create({
        data: { checklistId, text, order: (last?.order ?? -1) + 1, createdById: userId },
      })
      await tx.chatChecklist.update({ where: { id: checklistId }, data: { updatedAt: new Date() } })
    })
    return this.publish(access)
  }

  async removeItem(userId: string, checklistId: string, itemId: string): Promise<ChecklistDto> {
    const access = await this.access(checklistId)
    await this.chats.assertCanAct(userId, access.chatId)
    const item = await this.prisma.chatChecklistItem.findFirst({
      where: { id: itemId, checklistId },
      select: { createdById: true },
    })
    if (!item) throw new AppException('NOT_FOUND', 'Пункт не найден')
    if (access.authorId !== userId && item.createdById !== userId) {
      throw new AppException(
        'FORBIDDEN',
        'Убрать пункт может автор списка или тот, кто его добавил',
      )
    }
    await this.prisma.$transaction([
      this.prisma.chatChecklistItem.deleteMany({ where: { id: itemId, checklistId } }),
      this.prisma.chatChecklist.update({
        where: { id: checklistId },
        data: { updatedAt: new Date() },
      }),
    ])
    return this.publish(access)
  }

  async toggleItem(
    userId: string,
    checklistId: string,
    itemId: string,
    done: boolean,
  ): Promise<ChecklistDto> {
    const access = await this.access(checklistId)
    await this.chats.assertCanAct(userId, access.chatId)
    if (access.authorId !== userId && !access.othersCanMark) {
      throw new AppException('FORBIDDEN', 'Отмечать пункты может только автор списка')
    }
    const { count } = await this.prisma.chatChecklistItem.updateMany({
      where: { id: itemId, checklistId },
      data: done ? { doneById: userId, doneAt: new Date() } : { doneById: null, doneAt: null },
    })
    if (count === 0) throw new AppException('NOT_FOUND', 'Пункт не найден')
    await this.prisma.chatChecklist.update({
      where: { id: checklistId },
      data: { updatedAt: new Date() },
    })
    return this.publish(access)
  }

  /** Список живого сообщения; список удалённого сообщения для всех исчез вместе с ним. */
  private async access(checklistId: string): Promise<ChecklistAccess> {
    const row = await this.prisma.chatChecklist.findUnique({
      where: { id: checklistId },
      select: {
        id: true,
        othersCanAdd: true,
        othersCanMark: true,
        message: { select: { chatId: true, senderId: true, deletedAt: true } },
      },
    })
    if (!row || row.message.deletedAt) throw new AppException('NOT_FOUND', 'Список не найден')
    return {
      id: row.id,
      othersCanAdd: row.othersCanAdd,
      othersCanMark: row.othersCanMark,
      chatId: row.message.chatId,
      authorId: row.message.senderId,
    }
  }

  private async read(checklistId: string): Promise<ChecklistDto> {
    const row = await this.prisma.chatChecklist.findUniqueOrThrow({
      where: { id: checklistId },
      select: CHECKLIST_SELECT,
    })
    return toChecklistDto(row)
  }

  /** Перечитать список и разослать комнате чата — ответ ручки и событие совпадают. */
  private async publish(access: ChecklistAccess): Promise<ChecklistDto> {
    const checklist = await this.read(access.id)
    this.realtime.emitToRoom(`chat:${access.chatId}`, 'checklist:updated', {
      checklistId: access.id,
      chatId: access.chatId,
      checklist,
    })
    return checklist
  }
}
