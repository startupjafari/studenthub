import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { Role } from '@studenthub/shared-types'
import { REALTIME_EVENTS, type AdminLiveList } from '@studenthub/shared-schemas'
import { PrismaService } from '../prisma/prisma.service'
import { RealtimeCoalescer } from './coalescer'
import { RealtimeGateway } from './realtime.gateway'

// Живые админ-списки (`admin.list.changed`, docs/PROJECT.md §9.2d): инвайты, пользователи,
// жалобы, обращения в поддержку, заявки вузов. Раньше эти таблицы обновлялись только по
// перезагрузке, а бейдж заявок вузов опрашивал сервер раз в минуту.
//
// Сигнал без содержимого: в data только имя списка, клиент перечитывает его своим запросом,
// а сервер отдаёт строки по правам зрителя. Адресно, в `user:{id}` тех, кто ведёт список, —
// не в `university:{id}`: там весь вуз, включая студентов, а им сигнал об инвайтах ни к чему.
//
// Живёт в общем RealtimeModule (глобальном), а не в UsersModule: события шлют пять доменов,
// и импорт UsersModule в InvitesModule замкнул бы кольцо Invites → Users → Auth → Invites.
// Так же устроен TelegramNotifyService — уведомлять команду платформы нужно из многих мест.
// Пользователей читаем только ради адресатов: id по роли и вузу, без ПДн.
//
// Склейка: крон удаления аккаунтов, жалоба на пачку сообщений, массовый импорт инвайтов дают
// серию событий одного списка подряд. Окно склейки по (список, вуз) превращает её в одну
// рассылку и один запрос адресатов. Дополнительные адресаты (выдавший инвайт) копятся за окно,
// чтобы не потерять никого из серии.

/** Окно склейки серии изменений одного списка. Клиент своё окно (300 мс) добавит сверху. */
const WINDOW_MS = 500
/** Потолок адресатов одного сигнала: сотрудников одного вуза или платформы столько не бывает. */
const RECIPIENTS_LIMIT = 500

const PLATFORM_STAFF: Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]
const UNIVERSITY_STAFF: Role[] = [Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR]

/** Кто ведёт список: роли платформы и роли сотрудников конкретного вуза. */
interface Audience {
  platformRoles: Role[]
  universityId: string | null
  universityRoles: Role[]
}

interface PendingSignal {
  entityId: string
  extra: Set<string>
}

/** Кто ведёт список инвайтов: админы вуза инвайта; у платформенного — админы платформы. */
function inviteAudience(universityId: string | null): Audience {
  return universityId
    ? { platformRoles: [], universityId, universityRoles: [Role.UNIVERSITY_ADMIN] }
    : { platformRoles: [Role.PLATFORM_ADMIN], universityId: null, universityRoles: [] }
}

@Injectable()
export class AdminListEvents implements OnModuleDestroy {
  private readonly logger = new Logger(AdminListEvents.name)
  private readonly coalescer = new RealtimeCoalescer(WINDOW_MS)
  private readonly pending = new Map<string, PendingSignal>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  onModuleDestroy(): void {
    this.coalescer.clear()
    this.pending.clear()
  }

  /**
   * Инвайт выдан, отозван или использован. Список инвайтов вуза видит только его админ
   * (`GET /invites?scope=university`), свой список — выдавший, поэтому он тоже в адресатах.
   * Инвайт без вуза (платформенный) — админам платформы.
   */
  invite(invite: { id: string; universityId: string | null; createdById: string }): void {
    this.signal('invites', invite.id, inviteAudience(invite.universityId), [invite.createdById])
  }

  /**
   * Пачка инвайтов отозвана разом — удалили вуз, факультет или группу, куда они вели. Один
   * сигнал на scope, а не на инвайт: списку достаточно знать, что он изменился. `scopeId` —
   * id удалённого вуза, факультета или группы; выдавшие — в адресатах, как у одиночного
   * отзыва: каждый ведёт свой список.
   */
  invitesRevoked(batch: {
    scopeId: string
    universityId: string | null
    issuerIds: string[]
  }): void {
    this.signal('invites', batch.scopeId, inviteAudience(batch.universityId), batch.issuerIds)
  }

  /**
   * Человек появился, заблокирован, разблокирован, сменил роль или удалён. Список вуза ведут
   * его админ и модератор (`UserService.listScope`). Платформе по вузовским людям не шлём:
   * вузов сотни, а крон чистки аккаунтов будил бы её команду без конца. Человек без вуза
   * (работодатель, сотрудник платформы) — в списке только у платформы.
   */
  user(user: { id: string; universityId: string | null }): void {
    const audience: Audience = user.universityId
      ? { platformRoles: [], universityId: user.universityId, universityRoles: UNIVERSITY_STAFF }
      : { platformRoles: PLATFORM_STAFF, universityId: null, universityRoles: [] }
    this.signal('users', user.id, audience)
  }

  /**
   * Жалоба подана, взята в разбор, решена или возвращена в очередь. Очередь видят команда
   * платформы (все жалобы) и админ с модератором вуза жалобы (`ComplaintsService.scopeWhere`).
   */
  complaint(complaint: { id: string; universityId: string | null }): void {
    this.signal('complaints', complaint.id, {
      platformRoles: PLATFORM_STAFF,
      universityId: complaint.universityId,
      universityRoles: complaint.universityId ? UNIVERSITY_STAFF : [],
    })
  }

  /** Обращение в поддержку: новое сообщение, взятие, теги, закрытие, склейка. Команда платформы. */
  supportTicket(ticketId: string): void {
    this.signal('support', ticketId, {
      platformRoles: PLATFORM_STAFF,
      universityId: null,
      universityRoles: [],
    })
  }

  /** Заявка вуза подтверждена, одобрена или отклонена. Разбирает её только админ платформы. */
  demoRequest(requestId: string): void {
    this.signal('demoRequests', requestId, {
      platformRoles: [Role.PLATFORM_ADMIN],
      universityId: null,
      universityRoles: [],
    })
  }

  /**
   * Запланировать сигнал. Синхронно и без исключений: вызывающий зовёт его после записи, и
   * сбой рассылки не должен откатывать уже сделанное действие (best-effort, §9.2d).
   */
  private signal(
    list: AdminLiveList,
    entityId: string,
    audience: Audience,
    extra: string[] = [],
  ): void {
    // Аудитория однозначно задаётся списком и вузом — по ним и склеиваем.
    const key = `${list}:${audience.universityId ?? 'platform'}`
    const pending = this.pending.get(key) ?? { entityId, extra: new Set<string>() }
    pending.entityId = entityId
    for (const id of extra) pending.extra.add(id)
    this.pending.set(key, pending)
    this.coalescer.schedule(key, () => {
      const batch = this.pending.get(key)
      this.pending.delete(key)
      if (batch) void this.deliver(list, batch, audience)
    })
  }

  private async deliver(
    list: AdminLiveList,
    batch: PendingSignal,
    audience: Audience,
  ): Promise<void> {
    // Отправка идёт из таймера: необработанная ошибка здесь уронила бы процесс, поэтому
    // ловится всё — и запрос адресатов, и сама рассылка.
    try {
      const staff = await this.recipients(audience)
      const ids = [...new Set([...staff, ...batch.extra])]
      this.realtime.emitEventToUsers(ids, REALTIME_EVENTS.adminListChanged, batch.entityId, {
        list,
      })
    } catch (error) {
      this.logger.warn(
        `Список ${list}: не удалось разослать сигнал — ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /** id действующих сотрудников, которые ведут список: не удалённые и не заблокированные. */
  private async recipients(audience: Audience): Promise<string[]> {
    const or = [
      ...(audience.platformRoles.length > 0 ? [{ role: { in: audience.platformRoles } }] : []),
      ...(audience.universityId && audience.universityRoles.length > 0
        ? [{ universityId: audience.universityId, role: { in: audience.universityRoles } }]
        : []),
    ]
    if (or.length === 0) return []
    const rows = await this.prisma.user.findMany({
      where: { deletedAt: null, isBlocked: false, OR: or },
      select: { id: true },
      take: RECIPIENTS_LIMIT,
    })
    return rows.map((row) => row.id)
  }
}
