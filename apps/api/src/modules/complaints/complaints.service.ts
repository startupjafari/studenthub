import { Injectable, Logger } from '@nestjs/common'
import { ComplaintPriority, ComplaintStatus, ComplaintTargetType, Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  ComplaintListQueryInput,
  CreateComplaintInput,
  ResolveComplaintInput,
} from '@studenthub/shared-schemas'
import { complaintPriorityFor } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { TelegramNotifyService } from '../../common/telegram/telegram-notify.service'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { UserService } from '../users/users.service'

const USER_MINI = { select: { id: true, firstName: true, lastName: true } }

const COMPLAINT_SELECT = {
  id: true,
  targetType: true,
  targetId: true,
  reason: true,
  status: true,
  priority: true,
  universityId: true,
  resolution: true,
  resolvedAt: true,
  createdAt: true,
  reporter: USER_MINI,
  resolvedBy: USER_MINI,
  reviewingBy: USER_MINI,
} satisfies Prisma.ComplaintSelect

type ComplaintRow = Prisma.ComplaintGetPayload<{ select: typeof COMPLAINT_SELECT }>

interface TargetInfo {
  universityId: string | null
  ownerId: string | null
}

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

// Сортировка очереди: колонка таблицы → orderBy Prisma, через белый список (произвольное
// поле из query в orderBy не попадает). Порядок по умолчанию и есть «очередь»: сначала
// необработанные (PENDING/REVIEWING идут раньше по порядку enum), внутри — по приоритету
// (HIGH первым, тоже порядок enum), внутри — свежие раньше. Вторая ступень всюду —
// createdAt: при равных значениях строки не должны прыгать между страницами.
function complaintsOrderBy(
  query: ComplaintListQueryInput,
): Prisma.ComplaintOrderByWithRelationInput[] {
  const dir = query.order ?? 'asc'
  switch (query.sort) {
    case 'priority':
      return [{ priority: dir }, { createdAt: 'desc' }]
    case 'createdAt':
      return [{ createdAt: dir }]
    case 'status':
      return [{ status: dir }, { priority: 'asc' }, { createdAt: 'desc' }]
    case 'targetType':
      return [{ targetType: dir }, { createdAt: 'desc' }]
    default:
      return [{ status: 'asc' }, { priority: 'asc' }, { createdAt: 'desc' }]
  }
}

/** Слова для уведомления. Текста жалобы в Telegram не уходит — он читается в мини-аппе. */
const TARGET_WORD: Record<ComplaintTargetType, string> = {
  USER: 'на пользователя',
  MESSAGE: 'на сообщение',
  POST: 'на пост',
  STORY: 'на историю',
  COMMENT: 'на комментарий',
}

@Injectable()
export class ComplaintsService {
  private readonly logger = new Logger(ComplaintsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly users: UserService,
    private readonly telegram: TelegramNotifyService,
  ) {}

  // ── Создание (11.2) ──────────────────────────────────────────────────────

  async create(reporter: JwtPayload, input: CreateComplaintInput, ctx: RequestContext) {
    const target = await this.getTarget(input.targetType as ComplaintTargetType, input.targetId)
    const complaint = await this.prisma.complaint.create({
      data: {
        reporterId: reporter.sub,
        targetType: input.targetType as ComplaintTargetType,
        targetId: input.targetId,
        reason: input.reason,
        // Приоритет очереди выводится из категории цели (общее правило в shared-schemas),
        // а не приходит от клиента: иначе жалующийся сам назначал бы себе «срочно».
        priority: complaintPriorityFor(input.targetType) as ComplaintPriority,
        universityId: target.universityId,
      },
      select: COMPLAINT_SELECT,
    })
    await this.audit.record({
      userId: reporter.sub,
      action: 'complaint_created',
      entity: 'Complaint',
      entityId: complaint.id,
      metadata: { targetType: input.targetType, targetId: input.targetId },
      ...ctx,
    })
    await this.announceIfUrgent(complaint)
    return complaint
  }

  /**
   * Срочные — в Telegram команде платформы: жалоба на человека или на личные сообщения
   * означает, что кто-то страдает прямо сейчас, и ждать, пока модератор сам откроет
   * очередь, не стоит. Обычные и несрочные ждут в очереди — иначе уведомления
   * обесценятся, и первыми перестанут читать как раз срочные.
   */
  private async announceIfUrgent(complaint: ComplaintRow): Promise<void> {
    if (complaint.priority !== ComplaintPriority.HIGH) return
    await this.telegram.notifyStaff(
      'complaint',
      `Срочная жалоба ${TARGET_WORD[complaint.targetType]}`,
      `complaint_${complaint.id}`,
      new Date(),
      false,
      // Кнопка квитирования прямо в уведомлении: открывать приложение, чтобы сказать
      // «беру», — три лишних шага в момент, когда важна секунда.
      { kind: 'complaint', id: complaint.id },
    )
  }

  /**
   * Взять жалобу в разбор — квитирование.
   *
   * Уведомление о срочной жалобе уходит всей команде, и без отметки «я взял» двое
   * открывают одно и то же, а третья жалоба не достаётся никому: каждый решает, что её
   * взял другой. Нажимают эту кнопку прямо в Telegram, не открывая мини-апп.
   *
   * Перехватить чужое нельзя: условие `reviewingById: null` стоит в самом запросе, и два
   * одновременных «беру» не победят оба. Уже разобранная жалоба в разбор не берётся —
   * брать нечего.
   */
  async take(actor: JwtPayload, id: string): Promise<{ takenBy: string }> {
    const complaint = await this.findScoped(actor, id)
    if (
      complaint.status === ComplaintStatus.RESOLVED ||
      complaint.status === ComplaintStatus.DISMISSED
    ) {
      throw new AppException('CONFLICT', 'Жалоба уже разобрана')
    }

    const { count } = await this.prisma.complaint.updateMany({
      where: { id, reviewingById: null },
      data: { reviewingById: actor.sub, status: ComplaintStatus.REVIEWING },
    })
    if (count === 0) throw new AppException('CONFLICT', 'Жалобу уже разбирает другой человек')

    await this.audit.record({
      userId: actor.sub,
      action: 'complaint_taken',
      entity: 'Complaint',
      entityId: id,
    })
    return { takenBy: actor.sub }
  }

  /**
   * Завести жалобу по обращению в поддержку (пункт 34 каталога мини-аппа).
   *
   * Люди жалуются на других людей через поддержку — это самый естественный путь: адрес
   * известен, а кнопку «пожаловаться» рядом с обидчиком ещё надо найти. До этого путь
   * кончался тупиком: поддержка читала жалобу, а передать её модерации было нечем, кроме
   * пересказа своими словами в третьей системе.
   *
   * Автором жалобы остаётся автор обращения, а не модератор: жаловался он, и очередь
   * должна показывать именно это — иначе по статистике окажется, что половину жалоб на
   * платформе подаёт поддержка. Текст берётся из первого сообщения: это его собственные
   * слова, а не их пересказ.
   */
  async createFromSupport(
    actor: JwtPayload,
    chatId: string,
    targetUserId: string,
    ctx: RequestContext,
  ): Promise<ComplaintRow> {
    const ticket = await this.prisma.chat.findFirst({
      where: { id: chatId, type: 'SUPPORT_PLATFORM' },
      select: {
        id: true,
        members: { select: { user: { select: { id: true, role: true } } } },
        messages: {
          where: { deletedAt: null },
          orderBy: { seq: Prisma.SortOrder.asc },
          take: 1,
          select: { content: true },
        },
      },
    })
    if (!ticket) throw new AppException('NOT_FOUND', 'Обращение не найдено')

    const author = ticket.members.find(
      (member) =>
        member.user.role !== Role.PLATFORM_ADMIN && member.user.role !== Role.PLATFORM_MODERATOR,
    )?.user
    if (!author) throw new AppException('BAD_REQUEST', 'У обращения нет автора')
    if (author.id === targetUserId) {
      throw new AppException('BAD_REQUEST', 'Нельзя пожаловаться на самого себя')
    }

    // Цель проверяем тем же способом, что и обычную жалобу: несуществующий или чужой
    // человек отсеивается здесь, а не в очереди у модератора.
    const target = await this.getTarget(ComplaintTargetType.USER, targetUserId)
    const firstMessage = ticket.messages[0]?.content?.trim()
    const reason = firstMessage
      ? firstMessage.slice(0, 2000)
      : 'Жалоба передана из обращения в поддержку'

    const complaint = await this.prisma.complaint.create({
      data: {
        reporterId: author.id,
        targetType: ComplaintTargetType.USER,
        targetId: targetUserId,
        reason,
        priority: complaintPriorityFor('USER') as ComplaintPriority,
        universityId: target.universityId,
      },
      select: COMPLAINT_SELECT,
    })

    await this.audit.record({
      userId: actor.sub,
      action: 'complaint_from_support',
      entity: 'Complaint',
      entityId: complaint.id,
      metadata: { chatId, targetId: targetUserId },
      ...ctx,
    })
    await this.announceIfUrgent(complaint)
    return complaint
  }

  // ── Очередь и просмотр (11.3) ────────────────────────────────────────────

  async list(viewer: JwtPayload, query: ComplaintListQueryInput): Promise<Paginated<ComplaintRow>> {
    const where: Prisma.ComplaintWhereInput = {
      ...this.scopeWhere(viewer),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.status ? { status: query.status as ComplaintStatus } : {}),
      ...(query.priority ? { priority: query.priority as ComplaintPriority } : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.complaint.findMany({
        where,
        select: COMPLAINT_SELECT,
        orderBy: complaintsOrderBy(query),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.complaint.count({ where }),
    ])
    return new Paginated(rows, { total })
  }

  /**
   * Одна жалоба плюс счётчик: сколько раз на ту же цель жаловались вообще.
   *
   * Число отличает единичную обиду от травли, и без него модератор судит по одной строке
   * текста. Считается по `targetId`, а не по автору жалобы: важно, сколько РАЗНЫХ людей
   * пришло с одним и тем же, а не сколько раз пришёл один настойчивый.
   */
  async getById(
    viewer: JwtPayload,
    id: string,
  ): Promise<ComplaintRow & { targetReports: number; targetOwnerId: string | null }> {
    const complaint = await this.findScoped(viewer, id)
    const targetReports = await this.prisma.complaint.count({
      where: { targetType: complaint.targetType, targetId: complaint.targetId },
    })
    // Кто отвечает за цель. В жалобе на пост или сообщение автора не видно, а решение
    // принимается про человека: заблокировать — значит заблокировать именно его.
    // Снесённая цель отвечает null — карточку нарушителя тогда просто не показываем.
    const targetOwnerId = await this.ownerOf(complaint)
    return { ...complaint, targetReports, targetOwnerId }
  }

  // ── Разрешение (11.4) ────────────────────────────────────────────────────

  async resolve(actor: JwtPayload, id: string, input: ResolveComplaintInput, ctx: RequestContext) {
    const complaint = await this.findScoped(actor, id)
    if (
      complaint.status === ComplaintStatus.RESOLVED ||
      complaint.status === ComplaintStatus.DISMISSED
    ) {
      throw new AppException('CONFLICT', 'Жалоба уже обработана')
    }
    const targetType = complaint.targetType

    if (input.action === 'DELETE_CONTENT') {
      if (targetType === ComplaintTargetType.USER) {
        throw new AppException('BAD_REQUEST', 'Для пользователя используйте блокировку')
      }
      await this.softDeleteTarget(targetType, complaint.targetId)
    } else if (input.action === 'BLOCK_USER') {
      const ownerId = await this.ownerOf(complaint)
      if (!ownerId)
        throw new AppException('BAD_REQUEST', 'Не удалось определить пользователя для блокировки')
      // Срок делает блокировку временной: её снимет крон, а не память модератора.
      const until = input.blockDays
        ? new Date(Date.now() + input.blockDays * 24 * 60 * 60 * 1000)
        : null
      // UserService.setBlocked проверяет scope и рвёт сессии.
      await this.users.setBlocked(actor, ownerId, true, until)
    } else if (input.action === 'WARN_USER') {
      const ownerId = await this.ownerOf(complaint)
      if (!ownerId)
        throw new AppException(
          'BAD_REQUEST',
          'Не удалось определить пользователя для предупреждения',
        )
      // Предупреждение не трогает ни контент, ни доступ: человеку уходит уведомление,
      // а модерации остаётся запись — вторая жалоба на того же человека будет разбираться
      // уже зная, что разговор был.
      await this.users.warn(actor, ownerId, id)
    }

    const status = input.action === 'DISMISS' ? ComplaintStatus.DISMISSED : ComplaintStatus.RESOLVED
    const updated = await this.prisma.complaint.update({
      where: { id },
      data: { status, resolvedById: actor.sub, resolution: input.comment, resolvedAt: new Date() },
      select: COMPLAINT_SELECT,
    })

    await this.audit.record({
      userId: actor.sub,
      action: 'complaint_resolved',
      entity: 'Complaint',
      entityId: id,
      metadata: { action: input.action, targetType, targetId: complaint.targetId },
      ...ctx,
    })

    // Уведомить автора жалобы (11.4).
    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.COMPLAINT_RESOLVED,
      {
        recipientIds: [complaint.reporter.id],
        type: 'SYSTEM',
        title: 'Жалоба рассмотрена',
        body:
          input.action === 'DISMISS'
            ? 'Ваша жалоба отклонена модератором'
            : 'По вашей жалобе приняты меры',
        data: { complaintId: id },
        dedupeKey: `complaint-resolved:${id}`,
      },
      { jobId: `complaint-resolved:${id}` },
    )

    if (input.applyToDuplicates) await this.closeDuplicates(actor, complaint, status, id, ctx)
    return updated
  }

  /**
   * Закрыть остальные необработанные жалобы на ту же цель тем же статусом.
   *
   * Побочное действие (снять контент, заблокировать) здесь НЕ повторяется — оно уже
   * выполнено для первой жалобы. Второе удаление того же поста было бы безобидным, а вот
   * вторая блокировка того же человека записала бы в журнал события, которых не было.
   */
  private async closeDuplicates(
    actor: JwtPayload,
    complaint: { targetType: ComplaintTargetType; targetId: string },
    status: ComplaintStatus,
    exceptId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const where = {
      id: { not: exceptId },
      targetType: complaint.targetType,
      targetId: complaint.targetId,
      status: { in: [ComplaintStatus.PENDING, ComplaintStatus.REVIEWING] },
      // Чужой scope не трогаем: модератор вуза не должен закрывать жалобы другого вуза
      // только потому, что цель у них общая.
      ...this.scopeWhere(actor),
    }
    const { count } = await this.prisma.complaint.updateMany({
      where,
      data: { status, resolvedById: actor.sub, resolvedAt: new Date() },
    })
    if (count === 0) return

    await this.audit.record({
      userId: actor.sub,
      action: 'complaint_duplicates_closed',
      entity: 'Complaint',
      entityId: exceptId,
      metadata: { count, targetType: complaint.targetType, targetId: complaint.targetId },
      ...ctx,
    })
  }

  /**
   * Вернуть жалобу в очередь. Ошибка модератора до этого исправлялась только правкой в БД.
   *
   * Побочные действия решения НЕ отменяются: снятый контент не возвращается, а блокировка
   * снимается отдельно, в разделе «Люди». Возврат в очередь означает «решение было
   * неверным, нужен новый разбор», а не «ничего не было».
   */
  async reopen(actor: JwtPayload, id: string, ctx: RequestContext) {
    const complaint = await this.findScoped(actor, id)
    if (
      complaint.status !== ComplaintStatus.RESOLVED &&
      complaint.status !== ComplaintStatus.DISMISSED
    ) {
      throw new AppException('CONFLICT', 'Жалоба и так в очереди')
    }

    const updated = await this.prisma.complaint.update({
      where: { id },
      data: {
        status: ComplaintStatus.PENDING,
        resolvedById: null,
        resolvedAt: null,
        // Возврат в очередь снимает и «кто взял»: жалоба снова ничья, иначе она висела бы
        // за человеком, который её уже закрыл.
        reviewingById: null,
        resolution: null,
      },
      select: COMPLAINT_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'complaint_reopened',
      entity: 'Complaint',
      entityId: id,
      ...ctx,
    })
    return updated
  }

  // ── Доступ модератора к личному чату по жалобе (11.5) ──────────────────────

  /** Контекст сообщения-цели: доступен модератору ТОЛЬКО при наличии жалобы, всегда с аудитом. */
  async getMessageContext(actor: JwtPayload, id: string, ctx: RequestContext) {
    const complaint = await this.findScoped(actor, id)
    if (complaint.targetType !== ComplaintTargetType.MESSAGE) {
      throw new AppException('BAD_REQUEST', 'Жалоба не на сообщение')
    }
    const target = await this.prisma.message.findUnique({
      where: { id: complaint.targetId },
      select: { chatId: true },
    })
    if (!target) throw new AppException('NOT_FOUND', 'Сообщение не найдено')

    // §11.5/§14.8 — каждый доступ администратора к личному чату фиксируется в AuditLog.
    await this.audit.record({
      userId: actor.sub,
      action: 'moderator_chat_access',
      entity: 'Chat',
      entityId: target.chatId,
      metadata: { complaintId: id, messageId: complaint.targetId },
      ...ctx,
    })

    return this.prisma.message.findMany({
      where: { chatId: target.chatId },
      select: {
        id: true,
        senderId: true,
        content: true,
        createdAt: true,
        deletedAt: true,
        sender: USER_MINI,
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
  }

  // ── Внутреннее ─────────────────────────────────────────────────────────────

  private scopeWhere(viewer: JwtPayload): Prisma.ComplaintWhereInput {
    if (isPlatform(viewer.role)) return {}
    // UNIVERSITY_ADMIN / UNIVERSITY_MODERATOR — только свой вуз.
    return { universityId: viewer.universityId ?? '__none__' }
  }

  private async findScoped(viewer: JwtPayload, id: string): Promise<ComplaintRow> {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id },
      select: COMPLAINT_SELECT,
    })
    if (!complaint) throw new AppException('NOT_FOUND', 'Жалоба не найдена')
    if (!isPlatform(viewer.role) && complaint.universityId !== viewer.universityId) {
      throw new AppException('WRONG_SCOPE', 'Жалоба другого университета')
    }
    return complaint
  }

  /** Проверка существования цели и вычисление её вуза/владельца. */
  /** Владелец цели: автор поста, отправитель сообщения или сам пользователь. */
  private async ownerOf(complaint: { targetType: ComplaintTargetType; targetId: string }) {
    const target = await this.getTarget(complaint.targetType, complaint.targetId).catch(() => null)
    return target?.ownerId ?? null
  }

  private async getTarget(type: ComplaintTargetType, targetId: string): Promise<TargetInfo> {
    switch (type) {
      case ComplaintTargetType.STORY:
        throw new AppException('BAD_REQUEST', 'Жалобы на истории пока не поддерживаются')
      case ComplaintTargetType.POST: {
        const p = await this.prisma.post.findFirst({
          where: { id: targetId, deletedAt: null },
          select: {
            authorId: true,
            universityId: true,
            author: { select: { universityId: true } },
          },
        })
        if (!p) throw new AppException('NOT_FOUND', 'Пост не найден')
        return { universityId: p.universityId ?? p.author.universityId, ownerId: p.authorId }
      }
      case ComplaintTargetType.COMMENT: {
        const c = await this.prisma.comment.findFirst({
          where: { id: targetId, deletedAt: null },
          select: { authorId: true, author: { select: { universityId: true } } },
        })
        if (!c) throw new AppException('NOT_FOUND', 'Комментарий не найден')
        return { universityId: c.author.universityId, ownerId: c.authorId }
      }
      case ComplaintTargetType.MESSAGE: {
        const m = await this.prisma.message.findFirst({
          where: { id: targetId, deletedAt: null },
          select: { senderId: true, sender: { select: { universityId: true } } },
        })
        if (!m) throw new AppException('NOT_FOUND', 'Сообщение не найдено')
        return { universityId: m.sender.universityId, ownerId: m.senderId }
      }
      case ComplaintTargetType.USER: {
        const u = await this.prisma.user.findFirst({
          where: { id: targetId, deletedAt: null },
          select: { id: true, universityId: true },
        })
        if (!u) throw new AppException('NOT_FOUND', 'Пользователь не найден')
        return { universityId: u.universityId, ownerId: u.id }
      }
      default:
        throw new AppException('BAD_REQUEST', 'Неизвестный тип цели')
    }
  }

  private async softDeleteTarget(type: ComplaintTargetType, targetId: string): Promise<void> {
    const now = new Date()
    if (type === ComplaintTargetType.POST) {
      await this.prisma.post.updateMany({ where: { id: targetId }, data: { deletedAt: now } })
    } else if (type === ComplaintTargetType.COMMENT) {
      await this.prisma.comment.updateMany({ where: { id: targetId }, data: { deletedAt: now } })
    } else if (type === ComplaintTargetType.MESSAGE) {
      await this.prisma.message.updateMany({ where: { id: targetId }, data: { deletedAt: now } })
    }
  }
}
