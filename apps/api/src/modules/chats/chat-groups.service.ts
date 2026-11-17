import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  resolveChatPermissions,
  storedChatPermissions,
  type ChatJoinSettingsInput,
  type ChatPermissions,
  type UpdateChatPermissionsInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { RealtimeGateway } from '../../common/realtime'
import { ChatsService } from './chats.service'

/** Потолок списков заявок и исключённых: страница управления, а не выгрузка. */
const GROUP_LIST_LIMIT = 200

const USER_CARD = { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }

/** Настройки группы после изменения — тело ответа и события `chat:permissions`. */
export interface ChatGroupSettings {
  chatId: string
  permissions: ChatPermissions
  joinByLink: boolean
  joinApproval: boolean
}

/**
 * Управление группой как в Telegram (§8.3): «Разрешения», тип группы (вступление по ссылке и
 * через заявку), заявки на вступление и список исключённых.
 *
 * Отдельно от ChatsService, потому что тот и так собирает весь домен чатов. Проверки прав
 * (assertGroupAdmin) и общие действия над составом (вступление, служебная строка в ленте,
 * сигналы спискам) — его, здесь только правила этих экранов.
 */
@Injectable()
export class ChatGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly chats: ChatsService,
  ) {}

  /**
   * Разрешения участников (`PATCH /chats/:id/permissions`, админ группы). Переданные поля
   * поверх текущих; хранится полный набор — так в базе видно, что выбрали, без умолчаний.
   */
  async updatePermissions(
    actor: JwtPayload,
    chatId: string,
    input: UpdateChatPermissionsInput,
  ): Promise<ChatGroupSettings> {
    await this.chats.assertGroupAdmin(actor, chatId)
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { permissions: true, joinByLink: true, joinApproval: true },
    })
    if (!chat) throw new AppException('NOT_FOUND', 'Чат не найден')
    // Хранится выбор админа без зависимости от «писать» (storedChatPermissions): выключили и
    // включили обратно — остальные права вернутся, какими были. Наружу — уже с зависимостью.
    const stored = { ...storedChatPermissions(chat.permissions), ...input }
    await this.prisma.chat.update({
      where: { id: chatId },
      data: { permissions: stored as unknown as Prisma.InputJsonValue },
    })
    return this.announce({
      chatId,
      permissions: resolveChatPermissions(stored),
      joinByLink: chat.joinByLink,
      joinApproval: chat.joinApproval,
    })
  }

  /** Тип группы (`PATCH /chats/:id/join-settings`, админ группы). */
  async updateJoinSettings(
    actor: JwtPayload,
    chatId: string,
    input: ChatJoinSettingsInput,
  ): Promise<ChatGroupSettings> {
    await this.chats.assertGroupAdmin(actor, chatId)
    const updated = await this.prisma.chat.update({
      where: { id: chatId },
      data: {
        ...(input.joinByLink !== undefined ? { joinByLink: input.joinByLink } : {}),
        ...(input.joinApproval !== undefined ? { joinApproval: input.joinApproval } : {}),
      },
      select: { permissions: true, joinByLink: true, joinApproval: true },
    })
    return this.announce({
      chatId,
      permissions: resolveChatPermissions(updated.permissions),
      joinByLink: updated.joinByLink,
      joinApproval: updated.joinApproval,
    })
  }

  /** Заявки на вступление — свежие первыми (админ группы). */
  async listJoinRequests(actor: JwtPayload, chatId: string) {
    await this.chats.assertGroupAdmin(actor, chatId)
    const rows = await this.prisma.chatJoinRequest.findMany({
      where: { chatId },
      select: { createdAt: true, user: USER_CARD },
      orderBy: { createdAt: 'desc' },
      take: GROUP_LIST_LIMIT,
    })
    return rows.map((r) => ({ ...r.user, requestedAt: r.createdAt.toISOString() }))
  }

  /**
   * Одобрить заявку: человек становится участником так же, как вступивший по ссылке, —
   * служебная строка в ленте, участник в открытых окнах, сигнал спискам (и ему самому).
   * Забаненного за время ожидания не впускаем: заявка просто снимается.
   */
  async approveJoinRequest(
    actor: JwtPayload,
    chatId: string,
    userId: string,
  ): Promise<{ chatId: string; userId: string; approved: true }> {
    await this.chats.assertGroupAdmin(actor, chatId)
    await this.requireRequest(chatId, userId)
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { bannedAt: true },
    })
    if (member?.bannedAt) {
      await this.prisma.chatJoinRequest.deleteMany({ where: { chatId, userId } })
      await this.signalRequests(chatId)
      throw new AppException('FORBIDDEN', 'Пользователь заблокирован в этой группе')
    }
    const joined = !member && (await this.chats.createInvitedMember(chatId, userId))
    await this.chats.clearMembershipLeftovers(chatId, userId)
    if (joined) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, ...USER_CARD })
      this.realtime.emitToRoom(`chat:${chatId}`, 'chat:member-added', { chatId, user })
      await this.chats.emitSystemMessage(chatId, userId, 'member_joined')
    }
    await this.signalRequests(chatId)
    return { chatId, userId, approved: true }
  }

  /** Отклонить заявку. Человеку ничего не приходит — как в Telegram. */
  async declineJoinRequest(actor: JwtPayload, chatId: string, userId: string): Promise<void> {
    await this.chats.assertGroupAdmin(actor, chatId)
    const { count } = await this.prisma.chatJoinRequest.deleteMany({ where: { chatId, userId } })
    if (count === 0) throw new AppException('NOT_FOUND', 'Заявка не найдена')
    await this.signalRequests(chatId)
  }

  /**
   * Исключённые участники («Удалённые», §8.3) — отдельно от заблокированных: те остаются в
   * составе с `banned: true` (GET /chats/:id/members), а эти вернуться могут.
   */
  async listRemoved(actor: JwtPayload, chatId: string) {
    await this.chats.assertGroupAdmin(actor, chatId)
    const rows = await this.prisma.chatRemovedMember.findMany({
      where: { chatId },
      select: { removedAt: true, user: USER_CARD, removedBy: USER_CARD },
      orderBy: { removedAt: 'desc' },
      take: GROUP_LIST_LIMIT,
    })
    return rows.map((r) => ({
      ...r.user,
      removedAt: r.removedAt.toISOString(),
      removedBy: r.removedBy,
    }))
  }

  private async requireRequest(chatId: string, userId: string): Promise<void> {
    const request = await this.prisma.chatJoinRequest.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { id: true },
    })
    if (!request) throw new AppException('NOT_FOUND', 'Заявка не найдена')
  }

  /**
   * Открытым окнам — `chat:permissions` (композер сразу прячет запрещённое), спискам всех
   * участников — тихий сигнал: у кого чат не открыт, права придут с перечитанным списком.
   */
  private async announce(settings: ChatGroupSettings): Promise<ChatGroupSettings> {
    this.realtime.emitToRoom(`chat:${settings.chatId}`, 'chat:permissions', settings)
    await this.chats.pingChatList(settings.chatId)
    return settings
  }

  /** Админам — «список заявок изменился»: экран управления перечитает его. */
  private async signalRequests(chatId: string): Promise<void> {
    for (const id of await this.chats.groupAdminIds(chatId)) {
      this.realtime.emitToUser(id, 'chat:join-requests', { chatId })
    }
  }
}
