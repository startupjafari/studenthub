import { Injectable, Logger } from '@nestjs/common'
import { ComplaintPriority, ComplaintStatus, ComplaintTargetType, Prisma } from '@prisma/client'
import { Role, isHigherRole } from '@studenthub/shared-types'
import type {
  ComplaintListQueryInput,
  CreateComplaintInput,
  ResolveComplaintInput,
} from '@studenthub/shared-schemas'
import { complaintPriorityFor } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { TelegramNotifyService } from '../../common/telegram/telegram-notify.service'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { UserService } from '../users/users.service'
import { StoriesService } from '../stories/stories.service'

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

// Сколько сообщений до и после обжалованного видит модератор (getMessageContext).
const CONTEXT_WINDOW = 50

// Жалоба «в очереди»: её можно взять в разбор и решить. Решённую или отклонённую — нет.
const OPEN_STATUSES: ComplaintStatus[] = [ComplaintStatus.PENDING, ComplaintStatus.REVIEWING]

// Потолок одной пачки дублей, закрываемых вместе с решением (их авторам уходит уведомление).
// Десятки жалоб на одну цель — уже много; остаток, если он есть, закроет следующее решение.
const DUPLICATES_LIMIT = 500
// Сколько разных авторов жалоб на цель считаем точно. Больше — уже и так «очень много».
const TARGET_REPORTERS_LIMIT = 1000

@Injectable()
export class ComplaintsService {
  private readonly logger = new Logger(ComplaintsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly users: UserService,
    private readonly telegram: TelegramNotifyService,
    private readonly stories: StoriesService,
  ) {}

  // ── Создание (11.2) ──────────────────────────────────────────────────────

  async create(reporter: JwtPayload, input: CreateComplaintInput, ctx: RequestContext) {
    const target = await this.getTarget(input.targetType as ComplaintTargetType, input.targetId)
    // На сообщение жалуется только участник его чата. Иначе по одному id чужой личной
    // переписки любой заводил жалобу — и у модератора появлялся формальный повод её читать.
    // Ответ тот же, что у несуществующего сообщения: не подтверждаем, что такой id есть.
    if (input.targetType === ComplaintTargetType.MESSAGE) {
      const member = await this.prisma.chatMember.findFirst({
        where: {
          userId: reporter.sub,
          bannedAt: null,
          chat: { messages: { some: { id: input.targetId } } },
        },
        select: { id: true },
      })
      if (!member) throw new AppException('NOT_FOUND', 'Сообщение не найдено')
    }
    const complaint = await this.createOnce({
      reporterId: reporter.sub,
      targetType: input.targetType as ComplaintTargetType,
      targetId: input.targetId,
      reason: input.reason,
      // Приоритет очереди выводится из категории цели (общее правило в shared-schemas),
      // а не приходит от клиента: иначе жалующийся сам назначал бы себе «срочно».
      priority: complaintPriorityFor(input.targetType) as ComplaintPriority,
      universityId: target.universityId,
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
   * Завести жалобу, если у автора нет открытой жалобы на ту же цель.
   *
   * Повторная жалоба того же человека ничего не добавляет к разбору, а очередь и счётчик
   * «жалоб на цель» раздувала: один настойчивый пользователь выглядел как травля. Проверка и
   * запись — под advisory-локом (автор + цель): два одновременных нажатия иначе оба
   * проходили бы проверку. Решённая жалоба повтору не мешает — нарушение могло повториться.
   */
  private async createOnce(data: {
    reporterId: string
    targetType: ComplaintTargetType
    targetId: string
    reason: string
    priority: ComplaintPriority
    universityId: string | null
  }): Promise<ComplaintRow> {
    return this.prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, `complaint:${data.reporterId}:${data.targetType}:${data.targetId}`)
      const open = await tx.complaint.findFirst({
        where: {
          reporterId: data.reporterId,
          targetType: data.targetType,
          targetId: data.targetId,
          status: { in: OPEN_STATUSES },
        },
        select: { id: true },
      })
      if (open) {
        throw new AppException('CONFLICT', 'Жалоба на это уже отправлена и ждёт рассмотрения')
      }
      return tx.complaint.create({ data, select: COMPLAINT_SELECT })
    })
  }

  /**
   * Срочные — в Telegram команде платформы: жалоба на человека или на личные сообщения
   * означает, что кто-то страдает прямо сейчас, и ждать, пока модератор сам откроет
   * очередь, не стоит. Обычные и несрочные ждут в очереди — иначе уведомления
   * обесценятся, и первыми перестанут читать как раз срочные.
   */
  private async announceIfUrgent(complaint: ComplaintRow): Promise<void> {
    if (complaint.priority !== ComplaintPriority.HIGH) return
    // Размер очереди строкой ниже: «срочная жалоба» звучит одинаково и когда она одна, и
    // когда она девятая, а решать, бросать ли текущее дело, приходится по этому тексту.
    const { count } = await this.queueStats()
    await this.telegram.notifyStaff(
      'complaint',
      `Срочная жалоба ${TARGET_WORD[complaint.targetType]}\nЖалоб в очереди: ${count}`,
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
   * брать нечего. Статус тоже в условии записи: решение, успевшее между чтением и записью,
   * иначе возвращалось бы в REVIEWING без решающего, а мера по нему уже применена.
   */
  async take(
    actor: JwtPayload,
    id: string,
    ctx: RequestContext = {},
  ): Promise<{ takenBy: string }> {
    const complaint = await this.findScoped(actor, id)
    if (!OPEN_STATUSES.includes(complaint.status)) {
      throw new AppException('CONFLICT', 'Жалоба уже разобрана')
    }

    const { count } = await this.prisma.complaint.updateMany({
      where: { id, reviewingById: null, status: { in: OPEN_STATUSES } },
      data: { reviewingById: actor.sub, status: ComplaintStatus.REVIEWING },
    })
    if (count === 0) throw new AppException('CONFLICT', 'Жалобу уже разбирает другой человек')

    await this.audit.record({
      userId: actor.sub,
      action: 'complaint_taken',
      entity: 'Complaint',
      entityId: id,
      ...ctx,
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

    // Тот же запрет повтора, что у обычной жалобы: автор обращения уже жаловался на этого
    // человека, и жалоба ещё в очереди — вторая ничего не добавит.
    const complaint = await this.createOnce({
      reporterId: author.id,
      targetType: ComplaintTargetType.USER,
      targetId: targetUserId,
      reason,
      priority: complaintPriorityFor('USER') as ComplaintPriority,
      universityId: target.universityId,
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
   * Одна жалоба плюс счётчик: сколько разных людей жаловались на ту же цель.
   *
   * Число отличает единичную обиду от травли, и без него модератор судит по одной строке
   * текста. Считаются разные авторы жалоб на `targetId`, а не строки: важно, сколько РАЗНЫХ
   * людей пришло с одним и тем же, а не сколько раз пришёл один настойчивый.
   */
  async getById(
    viewer: JwtPayload,
    id: string,
  ): Promise<ComplaintRow & { targetReports: number; targetOwnerId: string | null }> {
    const complaint = await this.findScoped(viewer, id)
    // Разные авторы, а не строки: повторные жалобы одного человека (до запрета повтора их
    // заводили сколько угодно) травлю не означают.
    const reporters = await this.prisma.complaint.groupBy({
      by: ['reporterId'],
      where: { targetType: complaint.targetType, targetId: complaint.targetId },
      orderBy: { reporterId: 'asc' },
      take: TARGET_REPORTERS_LIMIT,
    })
    const targetReports = reporters.length
    // Кто отвечает за цель. В жалобе на пост или сообщение автора не видно, а решение
    // принимается про человека: заблокировать — значит заблокировать именно его.
    // Снесённая цель отвечает null — карточку нарушителя тогда просто не показываем.
    const targetOwnerId = await this.ownerOf(complaint)
    return { ...complaint, targetReports, targetOwnerId }
  }

  // ── Разрешение (11.4) ────────────────────────────────────────────────────

  async resolve(actor: JwtPayload, id: string, input: ResolveComplaintInput, ctx: RequestContext) {
    const complaint = await this.findScoped(actor, id)
    if (!OPEN_STATUSES.includes(complaint.status)) {
      throw new AppException('CONFLICT', 'Жалоба уже обработана')
    }
    const targetType = complaint.targetType

    // Отказы по существу (не та цель, нарушитель не найден, ранг автора) — до захвата
    // жалобы: такой отказ не должен ни на миг делать её «решённой».
    const ownerId = await this.assertActionApplicable(actor, complaint, input)

    const status = input.action === 'DISMISS' ? ComplaintStatus.DISMISSED : ComplaintStatus.RESOLVED
    const resolvedDate = new Date()
    const resolvedAt = resolvedDate.getTime()
    // Захват — условная запись, и только после неё мера. Раньше статус проверялся чтением, а
    // мера шла до записи: два одновременных решения (веб и мини-апп по кнопке из Telegram,
    // двойной клик) оба проходили проверку — два предупреждения в счётчик нарушителя, две
    // блокировки, два уведомления автору жалобы. Теперь статус «в очереди» видит одно
    // решение, второе получает CONFLICT и ничего не применяет.
    const { count } = await this.prisma.complaint.updateMany({
      where: { id, status: { in: OPEN_STATUSES } },
      data: {
        status,
        resolvedById: actor.sub,
        resolution: input.comment,
        resolvedAt: resolvedDate,
      },
    })
    if (count === 0) throw new AppException('CONFLICT', 'Жалоба уже обработана')

    try {
      await this.applyAction(actor, complaint, input, ownerId, ctx)
    } catch (error) {
      // Мера не прошла (scope нарушителя, сбой записи) — жалоба возвращается в очередь в
      // прежнем виде, иначе числилась бы решённой без применённой меры. Условие — наш
      // собственный захват: чужое решение, принятое после отката, не трогаем.
      await this.prisma.complaint
        .updateMany({
          where: { id, status, resolvedById: actor.sub, resolvedAt: resolvedDate },
          data: {
            status: complaint.status,
            resolvedById: complaint.resolvedBy?.id ?? null,
            resolution: complaint.resolution,
            resolvedAt: complaint.resolvedAt,
          },
        })
        .catch((rollbackError: unknown) =>
          this.logger.error(`Жалоба ${id}: не удалось вернуть в очередь`, rollbackError),
        )
      throw error
    }

    const updated = await this.prisma.complaint.findUnique({
      where: { id },
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
        titleKey: 'complaints.resolved.title',
        bodyKey: input.action === 'DISMISS' ? 'complaints.dismissed.body' : 'complaints.acted.body',
        data: { complaintId: id },
        // Жалобу могут открыть заново и решить ещё раз — второе решение тоже должно дойти.
        // Момент решения в ключе: ретрай той же job приходит с тем же payload и отсекается.
        dedupeKey: `complaint-resolved:${id}:${resolvedAt}`,
      },
      { jobId: `complaint-resolved:${id}:${resolvedAt}` },
    )

    if (input.applyToDuplicates) {
      await this.closeDuplicates(
        actor,
        complaint,
        { status, action: input.action, comment: input.comment },
        id,
        ctx,
      )
    }
    return updated
  }

  /**
   * Проверить, что мера применима, ничего не меняя. Возвращает нарушителя — владельца цели
   * (для DISMISS и снятия контента без автора — null).
   */
  private async assertActionApplicable(
    actor: JwtPayload,
    complaint: ComplaintRow,
    input: ResolveComplaintInput,
  ): Promise<string | null> {
    if (input.action === 'DISMISS') return null
    if (input.action === 'DELETE_CONTENT') {
      if (complaint.targetType === ComplaintTargetType.USER) {
        throw new AppException('BAD_REQUEST', 'Для пользователя используйте блокировку')
      }
      // Тот же ранг, что при удалении контента напрямую (posts/stories): по жалобе модератор
      // вуза не снимает пост админа своего вуза.
      const ownerId = await this.ownerOf(complaint)
      if (ownerId) {
        const owner = await this.prisma.user.findUnique({
          where: { id: ownerId },
          select: { role: true },
        })
        if (owner && !isHigherRole(actor.role, owner.role)) {
          throw new AppException('FORBIDDEN', 'Чужой контент снимает только роль выше автора')
        }
      }
      return ownerId
    }
    const ownerId = await this.ownerOf(complaint)
    if (!ownerId) {
      throw new AppException(
        'BAD_REQUEST',
        input.action === 'BLOCK_USER'
          ? 'Не удалось определить пользователя для блокировки'
          : 'Не удалось определить пользователя для предупреждения',
      )
    }
    return ownerId
  }

  /** Применить меру по жалобе. Вызывается только после захвата жалобы (см. resolve). */
  private async applyAction(
    actor: JwtPayload,
    complaint: ComplaintRow,
    input: ResolveComplaintInput,
    ownerId: string | null,
    ctx: RequestContext,
  ): Promise<void> {
    if (input.action === 'DELETE_CONTENT') {
      await this.softDeleteTarget(complaint.targetType, complaint.targetId)
    } else if (input.action === 'BLOCK_USER' && ownerId) {
      // Срок делает блокировку временной: её снимет крон, а не память модератора.
      const until = input.blockDays
        ? new Date(Date.now() + input.blockDays * 24 * 60 * 60 * 1000)
        : null
      // UserService.setBlocked проверяет scope и рвёт сессии. Жалоба — в журнал блокировки:
      // иначе по аудиту не восстановить, за что человека заблокировали.
      await this.users.setBlocked(actor, ownerId, true, until, {
        ...ctx,
        complaintId: complaint.id,
      })
    } else if (input.action === 'WARN_USER' && ownerId) {
      // Предупреждение не трогает ни контент, ни доступ: человеку уходит уведомление,
      // а модерации остаётся запись — вторая жалоба на того же человека будет разбираться
      // уже зная, что разговор был.
      await this.users.warn(actor, ownerId, complaint.id, ctx)
    }
  }

  /**
   * Закрыть остальные необработанные жалобы на ту же цель тем же статусом.
   *
   * Побочное действие (снять контент, заблокировать) здесь НЕ повторяется — оно уже
   * выполнено для первой жалобы. Второе удаление того же поста было бы безобидным, а вот
   * вторая блокировка того же человека записала бы в журнал события, которых не было.
   *
   * Дубли получают то же решение целиком — статус, решающего, комментарий, — и их авторам
   * уходит то же уведомление, что автору основной жалобы. Раньше дубли закрывались молча и
   * без `resolution`: их авторы так и не узнавали итог.
   */
  private async closeDuplicates(
    actor: JwtPayload,
    complaint: { targetType: ComplaintTargetType; targetId: string; reporter: { id: string } },
    decision: {
      status: ComplaintStatus
      action: ResolveComplaintInput['action']
      comment?: string
    },
    exceptId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const duplicates = await this.prisma.complaint.findMany({
      where: {
        id: { not: exceptId },
        targetType: complaint.targetType,
        targetId: complaint.targetId,
        status: { in: OPEN_STATUSES },
        // Чужой scope не трогаем: модератор вуза не должен закрывать жалобы другого вуза
        // только потому, что цель у них общая.
        ...this.scopeWhere(actor),
      },
      select: { id: true, reporterId: true },
      orderBy: { createdAt: 'asc' },
      take: DUPLICATES_LIMIT,
    })
    if (duplicates.length === 0) return

    const resolvedDate = new Date()
    // Условие на «в очереди» и в записи: дубль, решённый параллельно отдельно, не трогаем.
    const { count } = await this.prisma.complaint.updateMany({
      where: { id: { in: duplicates.map((d) => d.id) }, status: { in: OPEN_STATUSES } },
      data: {
        status: decision.status,
        resolvedById: actor.sub,
        resolution: decision.comment ?? null,
        resolvedAt: resolvedDate,
      },
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

    // Решены ли именно эти дубли нами, а не параллельным решением, — перечитываем по
    // нашему захвату: уведомление уходит только тем, чью жалобу закрыло это решение.
    const closed = await this.prisma.complaint.findMany({
      where: {
        id: { in: duplicates.map((d) => d.id) },
        resolvedById: actor.sub,
        resolvedAt: resolvedDate,
      },
      select: { id: true, reporterId: true },
      take: DUPLICATES_LIMIT,
    })
    const at = resolvedDate.getTime()
    // Одному человеку — одно уведомление: автор основной жалобы своё уже получил, а старые
    // повторы одного автора (до запрета повтора) не должны давать пачку одинаковых.
    const notified = new Set<string>([complaint.reporter.id])
    for (const dup of closed) {
      if (notified.has(dup.reporterId)) continue
      notified.add(dup.reporterId)
      await this.queue.enqueue(
        QUEUES.NOTIFICATIONS,
        NOTIFICATION_JOBS.COMPLAINT_RESOLVED,
        {
          recipientIds: [dup.reporterId],
          type: 'SYSTEM',
          titleKey: 'complaints.resolved.title',
          bodyKey:
            decision.action === 'DISMISS' ? 'complaints.dismissed.body' : 'complaints.acted.body',
          data: { complaintId: dup.id },
          dedupeKey: `complaint-resolved:${dup.id}:${at}`,
        },
        { jobId: `complaint-resolved:${dup.id}:${at}` },
      )
    }
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

  /**
   * Размер очереди разбора и возраст самой старой жалобы.
   *
   * Живёт здесь, а не у вызывающих, потому что таблица жалоб принадлежит этому модулю
   * (BACKEND_RULES §2.1). Спрашивают одно и то же двое — ежедневная сводка и команда
   * бота, — и две копии этого запроса разошлись бы в первый же раз, когда поменяется
   * набор статусов «в очереди».
   *
   * Прав здесь не проверяется: метод не отдаёт ни одной жалобы, только числа, и зовут
   * его крон и бот, у которых нет ни сессии, ни scope.
   */
  async queueStats(): Promise<{ count: number; oldestAt: Date | null }> {
    const where = { status: { in: [ComplaintStatus.PENDING, ComplaintStatus.REVIEWING] } }
    const [count, oldest] = await this.prisma.$transaction([
      this.prisma.complaint.count({ where }),
      this.prisma.complaint.findFirst({
        where,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ])
    return { count, oldestAt: oldest?.createdAt ?? null }
  }

  /**
   * Движение за период: сколько жалоб пришло и сколько разобрано.
   *
   * Нужно сводке: ноль в очереди после сорока разобранных жалоб и ноль в тихий день —
   * разные новости, а без этих чисел выглядели они одинаково.
   */
  async dayStats(since: Date): Promise<{ created: number; closed: number }> {
    const [created, closed] = await this.prisma.$transaction([
      this.prisma.complaint.count({ where: { createdAt: { gte: since } } }),
      this.prisma.complaint.count({ where: { resolvedAt: { gte: since } } }),
    ])
    return { created, closed }
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
      select: { chatId: true, createdAt: true },
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

    // Окно вокруг обжалованного сообщения, а не начало чата: в длинной переписке первые сто
    // сообщений — годичной давности, и самого нарушения среди них не было. Доступ —
    // минимально нужный для разбора, а не вся история.
    const select = {
      id: true,
      senderId: true,
      content: true,
      createdAt: true,
      deletedAt: true,
      sender: USER_MINI,
    } satisfies Prisma.MessageSelect
    const [before, after] = await Promise.all([
      this.prisma.message.findMany({
        where: { chatId: target.chatId, createdAt: { lte: target.createdAt } },
        select,
        orderBy: { createdAt: 'desc' },
        take: CONTEXT_WINDOW + 1,
      }),
      this.prisma.message.findMany({
        where: { chatId: target.chatId, createdAt: { gt: target.createdAt } },
        select,
        orderBy: { createdAt: 'asc' },
        take: CONTEXT_WINDOW,
      }),
    ])
    // Удалённые сообщения вокруг — без текста: их удалили для всех. Само обжалованное
    // остаётся с текстом, даже если автор успел его удалить: это и есть предмет жалобы.
    return [...before.reverse(), ...after].map((m) =>
      m.deletedAt && m.id !== complaint.targetId ? { ...m, content: null } : m,
    )
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
  // Автора ищем и у уже удалённого контента: иначе нарушитель уходил от блокировки, просто
  // удалив пост или сообщение до разбора жалобы.
  private async ownerOf(complaint: { targetType: ComplaintTargetType; targetId: string }) {
    const target = await this.getTarget(complaint.targetType, complaint.targetId, {
      includeDeleted: true,
    }).catch(() => null)
    return target?.ownerId ?? null
  }

  private async getTarget(
    type: ComplaintTargetType,
    targetId: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<TargetInfo> {
    const alive = opts.includeDeleted ? {} : { deletedAt: null }
    switch (type) {
      case ComplaintTargetType.STORY: {
        // Истёкшая сторис для жалобы не существует: разбирать нечего, контента уже нет.
        const s = await this.prisma.story.findFirst({
          where: {
            id: targetId,
            ...(opts.includeDeleted ? {} : { expiresAt: { gt: new Date() } }),
          },
          select: {
            authorId: true,
            universityId: true,
            author: { select: { universityId: true } },
          },
        })
        if (!s) throw new AppException('NOT_FOUND', 'Сторис не найдена')
        return { universityId: s.universityId ?? s.author.universityId, ownerId: s.authorId }
      }
      case ComplaintTargetType.POST: {
        const p = await this.prisma.post.findFirst({
          where: { id: targetId, ...alive },
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
          where: { id: targetId, ...alive },
          select: { authorId: true, author: { select: { universityId: true } } },
        })
        if (!c) throw new AppException('NOT_FOUND', 'Комментарий не найден')
        return { universityId: c.author.universityId, ownerId: c.authorId }
      }
      case ComplaintTargetType.MESSAGE: {
        const m = await this.prisma.message.findFirst({
          where: { id: targetId, ...alive },
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
    } else if (type === ComplaintTargetType.STORY) {
      // У сторис мягкого удаления нет: она живёт сутки и удаляется физически вместе с
      // медиа. Делает это владелец домена — он же знает про объект в MinIO (§2.1).
      await this.stories.removeByModeration(targetId)
    }
  }
}
