import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  CHAT_FOLDER_LIMITS,
  type CreateChatFolderInput,
  type UpdateChatFolderInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'

export interface ChatFolderDto {
  id: string
  name: string
  position: number
  chatIds: string[]
}

// Пользовательские папки чатов (§2). Встроенные вкладки списка («Личные», «Группы», …) считает
// клиент по типу чата — в БД их нет; здесь только то, что человек собрал сам.
//
// Папка — личная вещь: и сама папка, и её состав видны только владельцу. Поэтому все методы
// фильтруют по userId, а не проверяют «права на папку» отдельным guard'ом.
@Injectable()
export class ChatFoldersService {
  private readonly logger = new Logger(ChatFoldersService.name)

  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<ChatFolderDto[]> {
    const folders = await this.prisma.chatFolder.findMany({
      where: { userId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take: CHAT_FOLDER_LIMITS.MAX_FOLDERS,
      select: {
        id: true,
        name: true,
        position: true,
        items: {
          select: { chatId: true },
          orderBy: { createdAt: 'asc' },
          take: CHAT_FOLDER_LIMITS.MAX_CHATS_PER_FOLDER,
        },
      },
    })
    return folders.map((f) => ({
      id: f.id,
      name: f.name,
      position: f.position,
      chatIds: f.items.map((i) => i.chatId),
    }))
  }

  async create(userId: string, input: CreateChatFolderInput): Promise<ChatFolderDto> {
    const count = await this.prisma.chatFolder.count({ where: { userId } })
    if (count >= CHAT_FOLDER_LIMITS.MAX_FOLDERS) {
      throw new AppException(
        'CONFLICT',
        `Больше ${CHAT_FOLDER_LIMITS.MAX_FOLDERS} папок не поддерживается`,
      )
    }
    const chatIds = await this.assertOwnChats(userId, input.chatIds ?? [])

    try {
      const folder = await this.prisma.chatFolder.create({
        data: {
          userId,
          name: input.name,
          // Новая папка — в конец списка вкладок.
          position: count,
          items: { create: chatIds.map((chatId) => ({ chatId })) },
        },
        select: { id: true, name: true, position: true },
      })
      this.logger.log(`Папка чатов ${folder.id} создана пользователем ${userId}`)
      return { ...folder, chatIds }
    } catch (error) {
      throw this.duplicateNameOr(error)
    }
  }

  async update(userId: string, id: string, input: UpdateChatFolderInput): Promise<ChatFolderDto> {
    const existing = await this.prisma.chatFolder.findFirst({
      where: { id, userId },
      select: { id: true },
    })
    if (!existing) throw new AppException('NOT_FOUND', 'Папка не найдена')

    // Состав заменяется целиком, а не дельтой: клиент присылает итоговый набор галочек, и
    // «удалить всё лишнее + добавить новое» одним переходом избавляет от рассинхрона,
    // если два устройства правили папку одновременно.
    const chatIds =
      input.chatIds === undefined ? null : await this.assertOwnChats(userId, input.chatIds)

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.chatFolder.update({
          where: { id },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.position === undefined ? {} : { position: input.position }),
          },
        })
        if (chatIds) {
          await tx.chatFolderItem.deleteMany({ where: { folderId: id } })
          if (chatIds.length > 0) {
            await tx.chatFolderItem.createMany({
              data: chatIds.map((chatId) => ({ folderId: id, chatId })),
            })
          }
        }
      })
    } catch (error) {
      throw this.duplicateNameOr(error)
    }

    const [folder] = await this.list(userId).then((all) => all.filter((f) => f.id === id))
    if (!folder) throw new AppException('NOT_FOUND', 'Папка не найдена')
    return folder
  }

  async remove(userId: string, id: string): Promise<void> {
    // deleteMany с userId в where: чужую папку не удалить, и отдельная проверка не нужна.
    const { count } = await this.prisma.chatFolder.deleteMany({ where: { id, userId } })
    if (count === 0) throw new AppException('NOT_FOUND', 'Папка не найдена')
  }

  /**
   * Оставляет только чаты, где пользователь — не забаненный участник.
   *
   * Чужой чат в папке не раскрыл бы содержимое (папка хранит лишь id), но список бы им
   * засорился: клиент показывает вкладку с «мёртвыми» строками, которых нет в /chats.
   * Поэтому неизвестный id — явная ошибка, а не тихо отброшенный элемент.
   */
  private async assertOwnChats(userId: string, chatIds: string[]): Promise<string[]> {
    const unique = [...new Set(chatIds)]
    if (unique.length === 0) return []

    const mine = await this.prisma.chatMember.findMany({
      where: { userId, bannedAt: null, chatId: { in: unique } },
      select: { chatId: true },
      take: unique.length,
    })
    if (mine.length !== unique.length) {
      throw new AppException('BAD_REQUEST', 'В папку попал чат, недоступный пользователю')
    }
    return unique
  }

  /** P2002 по (userId, name) — это «папка с таким именем уже есть», а не внутренняя ошибка. */
  private duplicateNameOr(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new AppException('CONFLICT', 'Папка с таким именем уже есть')
    }
    return error
  }
}
