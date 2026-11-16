import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  CHAT_FOLDER_LIMITS,
  chatInFolder,
  type ChatFolderMuteInput,
  type ChatFolderRule,
  type CreateChatFolderInput,
  type UpdateChatFolderInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { RealtimeGateway } from '../../common/realtime'

export interface ChatFolderDto {
  id: string
  name: string
  position: number
  chatIds: string[]
  excludedChatIds: string[]
  emoji: string | null
  color: number | null
  includeContacts: boolean
  includeNonContacts: boolean
  includeGroups: boolean
}

const FOLDER_SELECT = {
  id: true,
  name: true,
  position: true,
  emoji: true,
  color: true,
  includeContacts: true,
  includeNonContacts: true,
  includeGroups: true,
} satisfies Prisma.ChatFolderSelect

type FolderRow = Prisma.ChatFolderGetPayload<{ select: typeof FOLDER_SELECT }>

/** Строк состава на папку: явные чаты плюс исключения. */
const FOLDER_ITEMS_MAX =
  CHAT_FOLDER_LIMITS.MAX_CHATS_PER_FOLDER + CHAT_FOLDER_LIMITS.MAX_EXCLUDED_PER_FOLDER

/**
 * Сколько своих чатов разбирается, когда папка собрана правилами («все группы» и т.п.).
 * Столько же страховочного запаса, сколько у присутствия: живой список чатов на порядки меньше.
 */
const FOLDER_SCAN_LIMIT = 1000

// Пользовательские папки чатов (§2). Встроенные вкладки списка («Личные», «Группы», …) считает
// клиент по типу чата — в БД их нет; здесь только то, что человек собрал сам.
//
// Папка — личная вещь: и сама папка, и её состав видны только владельцу. Поэтому все методы
// фильтруют по userId, а не проверяют «права на папку» отдельным guard'ом.
//
// Своим устройствам изменения папок уходят сигналом `chat:folders-changed` (вкладки), а
// заглушение папки — `chat:list-changed` с id задетых чатов (строки списка).
@Injectable()
export class ChatFoldersService {
  private readonly logger = new Logger(ChatFoldersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(userId: string): Promise<ChatFolderDto[]> {
    const folders = await this.prisma.chatFolder.findMany({
      where: { userId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take: CHAT_FOLDER_LIMITS.MAX_FOLDERS,
      select: {
        ...FOLDER_SELECT,
        items: {
          select: { chatId: true, excluded: true },
          orderBy: { createdAt: 'asc' },
          take: FOLDER_ITEMS_MAX,
        },
      },
    })
    return folders.map(({ items, ...folder }) =>
      this.toDto(
        folder,
        items.filter((i) => !i.excluded).map((i) => i.chatId),
        items.filter((i) => i.excluded).map((i) => i.chatId),
      ),
    )
  }

  async create(userId: string, input: CreateChatFolderInput): Promise<ChatFolderDto> {
    const count = await this.prisma.chatFolder.count({ where: { userId } })
    if (count >= CHAT_FOLDER_LIMITS.MAX_FOLDERS) {
      throw new AppException(
        'CONFLICT',
        `Больше ${CHAT_FOLDER_LIMITS.MAX_FOLDERS} папок не поддерживается`,
      )
    }
    const chatIds = await this.ownChats(userId, input.chatIds ?? [])
    const excludedChatIds = await this.ownChats(userId, input.excludedChatIds ?? [])

    try {
      const folder = await this.prisma.chatFolder.create({
        data: {
          userId,
          name: input.name,
          // Новая папка — в конец списка вкладок.
          position: count,
          emoji: input.emoji ?? null,
          color: input.color ?? null,
          includeContacts: input.includeContacts ?? false,
          includeNonContacts: input.includeNonContacts ?? false,
          includeGroups: input.includeGroups ?? false,
          items: {
            create: [
              ...chatIds.map((chatId) => ({ chatId })),
              ...excludedChatIds.map((chatId) => ({ chatId, excluded: true })),
            ],
          },
        },
        select: FOLDER_SELECT,
      })
      this.logger.log(`Папка чатов ${folder.id} создана пользователем ${userId}`)
      this.emitFoldersChanged(userId)
      return this.toDto(folder, chatIds, excludedChatIds)
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
    // если два устройства правили папку одновременно. Явные чаты и исключения — каждый
    // список своим полем: присланный заменяется, неприсланный остаётся как был.
    const chatIds = input.chatIds === undefined ? null : await this.ownChats(userId, input.chatIds)
    const excluded =
      input.excludedChatIds === undefined
        ? null
        : await this.ownChats(userId, input.excludedChatIds)
    await this.assertNoOverlapWithStored(id, chatIds, excluded)

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.chatFolder.update({
          where: { id },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.position === undefined ? {} : { position: input.position }),
            ...(input.emoji === undefined ? {} : { emoji: input.emoji }),
            ...(input.color === undefined ? {} : { color: input.color }),
            ...(input.includeContacts === undefined
              ? {}
              : { includeContacts: input.includeContacts }),
            ...(input.includeNonContacts === undefined
              ? {}
              : { includeNonContacts: input.includeNonContacts }),
            ...(input.includeGroups === undefined ? {} : { includeGroups: input.includeGroups }),
          },
        })
        // Сначала снимаем оба заменяемых списка, потом пишем: чат, переехавший из исключений
        // в явные (или наоборот), иначе упёрся бы в уникальный ключ (folderId, chatId).
        const lists = [
          { list: chatIds, excluded: false },
          { list: excluded, excluded: true },
        ].filter((l): l is { list: string[]; excluded: boolean } => l.list !== null)
        for (const l of lists) {
          await tx.chatFolderItem.deleteMany({ where: { folderId: id, excluded: l.excluded } })
        }
        const rows = lists.flatMap((l) =>
          l.list.map((chatId) => ({ folderId: id, chatId, excluded: l.excluded })),
        )
        if (rows.length > 0) await tx.chatFolderItem.createMany({ data: rows })
      })
    } catch (error) {
      throw this.duplicateNameOr(error)
    }

    const [folder] = await this.list(userId).then((all) => all.filter((f) => f.id === id))
    if (!folder) throw new AppException('NOT_FOUND', 'Папка не найдена')
    this.emitFoldersChanged(userId)
    return folder
  }

  async remove(userId: string, id: string): Promise<void> {
    // deleteMany с userId в where: чужую папку не удалить, и отдельная проверка не нужна.
    const { count } = await this.prisma.chatFolder.deleteMany({ where: { id, userId } })
    if (count === 0) throw new AppException('NOT_FOUND', 'Папка не найдена')
    this.emitFoldersChanged(userId)
  }

  /**
   * Порядок вкладок (`PUT /chats/folders/order`): ровно все папки пользователя, сверху вниз.
   * Неполное или чужое множество — 422: частичный порядок оставил бы непереставленные папки
   * на старых позициях, и они перемешались бы с новыми. Дубли отсекает схема.
   */
  async reorder(userId: string, folderIds: string[]): Promise<void> {
    const folders = await this.prisma.chatFolder.findMany({
      where: { userId },
      select: { id: true },
      take: CHAT_FOLDER_LIMITS.MAX_FOLDERS + 1,
    })
    const mine = new Set(folders.map((f) => f.id))
    if (folderIds.length !== mine.size || folderIds.some((id) => !mine.has(id))) {
      throw new AppException('VALIDATION_ERROR', 'Порядок должен перечислять ровно все мои папки')
    }
    await this.prisma.$transaction(
      folderIds.map((id, position) =>
        this.prisma.chatFolder.updateMany({ where: { id, userId }, data: { position } }),
      ),
    )
    this.emitFoldersChanged(userId)
  }

  /**
   * Заглушить все чаты папки (`POST /chats/folders/:id/mute`) — те же поля, что у одного чата
   * (`ChatsService.setMuted`): minutes — на время, иначе навсегда; importantOnly — пропускать
   * ответы мне и упоминания. Состав — по правилу chatInFolder на момент вызова: чаты, которые
   * попадут в папку позже, заглушены не будут (как в Telegram).
   */
  async mute(userId: string, id: string, input: ChatFolderMuteInput): Promise<{ updated: number }> {
    const chatIds = await this.folderChatIds(userId, id)
    if (chatIds.length === 0) return { updated: 0 }
    const muted = input.minutes
      ? { mutedAt: null, mutedUntil: new Date(Date.now() + input.minutes * 60_000) }
      : { mutedAt: new Date(), mutedUntil: null }
    const { count } = await this.prisma.chatMember.updateMany({
      where: { userId, chatId: { in: chatIds } },
      data: { ...muted, muteImportantOnly: input.importantOnly ?? false },
    })
    this.emitListChanged(userId, chatIds)
    return { updated: count }
  }

  /** Снять заглушение со всех чатов текущего состава папки. */
  async unmute(userId: string, id: string): Promise<{ updated: number }> {
    const chatIds = await this.folderChatIds(userId, id)
    if (chatIds.length === 0) return { updated: 0 }
    const { count } = await this.prisma.chatMember.updateMany({
      where: { userId, chatId: { in: chatIds } },
      data: { mutedAt: null, mutedUntil: null, muteImportantOnly: false },
    })
    this.emitListChanged(userId, chatIds)
    return { updated: count }
  }

  /**
   * Чаты, которые сейчас входят в папку, — по тому же правилу, что у клиентов (chatInFolder).
   *
   * Кандидаты — чаты человека, где он не забанен и которые не удалил «у себя»: то, что он
   * видит в списке. Без правил по типу разбираются только явные чаты папки; с правилами —
   * весь его список (до FOLDER_SCAN_LIMIT), а «контакт» ли собеседник личного чата, решает
   * одна выборка дружб на всех собеседников, а не запрос на чат.
   */
  private async folderChatIds(userId: string, folderId: string): Promise<string[]> {
    const folder = await this.prisma.chatFolder.findFirst({
      where: { id: folderId, userId },
      select: {
        includeContacts: true,
        includeNonContacts: true,
        includeGroups: true,
        items: { select: { chatId: true, excluded: true }, take: FOLDER_ITEMS_MAX },
      },
    })
    if (!folder) throw new AppException('NOT_FOUND', 'Папка не найдена')
    const explicit = folder.items.filter((i) => !i.excluded).map((i) => i.chatId)
    const rule: ChatFolderRule = {
      chatIds: explicit,
      excludedChatIds: folder.items.filter((i) => i.excluded).map((i) => i.chatId),
      includeContacts: folder.includeContacts,
      includeNonContacts: folder.includeNonContacts,
      includeGroups: folder.includeGroups,
    }
    const byRule = rule.includeContacts || rule.includeNonContacts || rule.includeGroups
    if (!byRule && explicit.length === 0) return []

    const members = await this.prisma.chatMember.findMany({
      where: {
        userId,
        bannedAt: null,
        hiddenAt: null,
        ...(byRule ? {} : { chatId: { in: explicit } }),
      },
      select: { chatId: true, chat: { select: { type: true } } },
      take: byRule ? FOLDER_SCAN_LIMIT : explicit.length,
    })
    const friendChats =
      rule.includeContacts || rule.includeNonContacts
        ? await this.friendChats(
            userId,
            members.filter((m) => m.chat.type === 'PRIVATE').map((m) => m.chatId),
          )
        : new Set<string>()
    return members
      .filter((m) =>
        chatInFolder(rule, {
          id: m.chatId,
          type: m.chat.type,
          isFriend: friendChats.has(m.chatId),
        }),
      )
      .map((m) => m.chatId)
  }

  /** Личные чаты (из переданных), где собеседник — друг: два запроса на любое число чатов. */
  private async friendChats(userId: string, privateChatIds: string[]): Promise<Set<string>> {
    if (privateChatIds.length === 0) return new Set()
    const peers = await this.prisma.chatMember.findMany({
      where: { chatId: { in: privateChatIds }, userId: { not: userId } },
      select: { chatId: true, userId: true },
      take: privateChatIds.length,
    })
    if (peers.length === 0) return new Set()
    const peerIds = peers.map((p) => p.userId)
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [
          { requesterId: userId, addresseeId: { in: peerIds } },
          { addresseeId: userId, requesterId: { in: peerIds } },
        ],
      },
      select: { requesterId: true, addresseeId: true },
      take: peerIds.length,
    })
    const friends = new Set(
      friendships.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId)),
    )
    return new Set(peers.filter((p) => friends.has(p.userId)).map((p) => p.chatId))
  }

  /**
   * Правка присылает только один из списков (явные или исключения) — второй берётся из базы,
   * и пересечься они могут уже там. Уникальный ключ (folderId, chatId) уронил бы такую правку
   * в 500, а это ошибка запроса — 422, как и пересечение внутри одного тела (его ловит схема).
   */
  private async assertNoOverlapWithStored(
    folderId: string,
    chatIds: string[] | null,
    excluded: string[] | null,
  ): Promise<void> {
    if ((chatIds === null) === (excluded === null)) return
    const changed = chatIds ?? excluded ?? []
    if (changed.length === 0) return
    const clash = await this.prisma.chatFolderItem.findFirst({
      // Меняются явные — сверяем с сохранёнными исключениями, и наоборот.
      where: { folderId, excluded: chatIds !== null, chatId: { in: changed } },
      select: { chatId: true },
    })
    if (clash) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Чат не может быть одновременно в папке и в исключениях',
      )
    }
  }

  /**
   * Оставляет только чаты, где пользователь — не забаненный участник.
   *
   * Чужой чат в папке не раскрыл бы содержимое (папка хранит лишь id), но список бы им
   * засорился: клиент показывает вкладку с «мёртвыми» строками, которых нет в /chats.
   * Недоступные id отбрасываются молча, а не валят всю правку: состав клиент присылает
   * целиком, и чат, который человек покинул (или из которого его исключили), лежит в нём
   * по-прежнему — с отказом папку нельзя было ни переименовать, ни поправить.
   */
  private async ownChats(userId: string, chatIds: string[]): Promise<string[]> {
    const unique = [...new Set(chatIds)]
    if (unique.length === 0) return []

    const mine = await this.prisma.chatMember.findMany({
      where: { userId, bannedAt: null, chatId: { in: unique } },
      select: { chatId: true },
      take: unique.length,
    })
    const allowed = new Set(mine.map((m) => m.chatId))
    return unique.filter((chatId) => allowed.has(chatId))
  }

  private toDto(folder: FolderRow, chatIds: string[], excludedChatIds: string[]): ChatFolderDto {
    return {
      id: folder.id,
      name: folder.name,
      position: folder.position,
      chatIds,
      excludedChatIds,
      emoji: folder.emoji,
      color: folder.color,
      includeContacts: folder.includeContacts,
      includeNonContacts: folder.includeNonContacts,
      includeGroups: folder.includeGroups,
    }
  }

  /** Вкладки-папки изменились — сигнал другим устройствам владельца. */
  private emitFoldersChanged(userId: string): void {
    this.realtime.emitToUser(userId, 'chat:folders-changed', {})
  }

  /** Персональные настройки чатов изменились (заглушение папки) — как у ChatsService. */
  private emitListChanged(userId: string, chatIds: string[]): void {
    this.realtime.emitToUser(userId, 'chat:list-changed', { chatIds })
  }

  /** P2002 по (userId, name) — это «папка с таким именем уже есть», а не внутренняя ошибка. */
  private duplicateNameOr(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new AppException('CONFLICT', 'Папка с таким именем уже есть')
    }
    return error
  }
}
