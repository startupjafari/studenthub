import { Inject, Injectable, Logger } from '@nestjs/common'
import type { PlatformState } from '@prisma/client'
import type Redis from 'ioredis'
import type {
  AnnounceReleaseInput,
  SetNotificationsInput,
  SetBannerInput,
  SetMaintenanceInput,
  SetSeasonInput,
  SetSectionsInput,
} from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import type { NotificationPolicy } from './platform.constants'
import { PLATFORM_STATE_CACHE_KEY, PLATFORM_STATE_ID } from './platform.constants'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import { TwoFactorService } from '../auth/two-factor.service'
import type { RequestContext } from '../auth/auth.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Состояние платформы: рычаги, которыми админ управляет вебом без деплоя.
// Модель и мотивация полей — prisma/schema/30-platform.prisma.

const SINGLETON_ID = PLATFORM_STATE_ID
const CACHE_KEY = PLATFORM_STATE_CACHE_KEY

// Состояние спрашивает каждая загрузка страницы каждого пользователя, поэтому оно
// кэшируется. Запись кэш сбрасывает — значит 60 секунд это не задержка появления
// баннера, а потолок расхождения, если сброс до инстанса не доехал.
const CACHE_TTL_SEC = 60

// Отдельная, куда более короткая память в самом процессе — под вопрос «идут ли техработы».
// Его задаёт КАЖДЫЙ запрос к API (MaintenanceGuard), и ходить за ответом в Redis на каждый
// из них значило бы добавить сетевой round-trip ко всему трафику платформы. Пять секунд —
// цена, которую платит включение режима: столько он доходит до инстанса, который его не
// включал. Для остановки на четверть часа это незаметно.
const MAINTENANCE_MEMO_MS = 5_000

/** Кто может дежурить: команда платформы — те же роли, которым уходят уведомления. */
const DUTY_ROLES: readonly Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]

/**
 * Действия журнала, которые пишут рычаги платформы. Один словарь на запись и на чтение:
 * журнал читается по списку `action IN (...)`, а не префиксом `platform.%` — префиксный
 * LIKE по btree без `text_pattern_ops` индекс не использует, и на десятках миллионов
 * строк аудита план шёл по `created_at` назад до первой записи `platform.*` (B-F20).
 * Новое действие рычага добавляется сюда — иначе его не увидят «Изменения» и откат.
 */
const ACTION = {
  maintenanceOn: 'platform.maintenance.on',
  maintenanceOff: 'platform.maintenance.off',
  bannerOn: 'platform.banner.on',
  bannerOff: 'platform.banner.off',
  sectionsSet: 'platform.sections.set',
  seasonSet: 'platform.season.set',
  dutySet: 'platform.duty.set',
  dutyRotate: 'platform.duty.rotate',
  notificationsSet: 'platform.notifications.set',
  releaseAnnounce: 'platform.release.announce',
  stateUndo: 'platform.state.undo',
} as const

/** Все действия рычагов — для «Последних изменений». */
export const PLATFORM_AUDIT_ACTIONS: string[] = Object.values(ACTION)

/**
 * Что можно откатить: всё, кроме понедельничной смены дежурного. Её пишет крон без
 * снимка `before`, и, оказавшись последней записью, она отвечала «отменять нечего» на
 * правку админа, сделанную минутой раньше.
 */
const UNDOABLE_ACTIONS: string[] = PLATFORM_AUDIT_ACTIONS.filter((a) => a !== ACTION.dutyRotate)

/** Сколько живёт ответ «объём файлов»: COUNT и SUM по всей таблице `files` — не на каждый заход. */
const STORAGE_CACHE_KEY = 'platform:storage'
const STORAGE_CACHE_TTL_SEC = 300

export interface LocalizedText {
  ru: string
  kk: string
  en: string
}

/**
 * Состояние платформы. Срок жизни здесь уже применён: наружу уходит либо действующее
 * объявление, либо `null`. Клиент не сравнивает даты сам — иначе веб, мини-апп и
 * мобильный браузер с уехавшими часами решали бы этот вопрос по-разному.
 *
 * Целиком его видит только команда платформы. Остальным `forViewer` отдаёт срез: без
 * настроек уведомлений и только тот баннер, что адресован им (B-F19).
 */
export interface PublicPlatformState {
  /**
   * Настройки уведомлений команде — только для команды платформы (мини-апп). Анониму и
   * остальным ролям поля нет: id дежурного админа посетителю сайта знать незачем.
   */
  notifications?: {
    quietFrom: number | null
    quietTo: number | null
    muted: string[]
    dutyUserId: string | null
    digestHour: number | null
  }
  maintenance: {
    until: string
    message: LocalizedText | null
    /** Начало окна, если работы плановые: до него платформа ещё работает. */
    startsAt: string | null
    /** Уже идут или ещё только назначены. */
    active: boolean
  } | null
  banner: {
    until: string
    level: 'INFO' | 'WARNING'
    text: LocalizedText
    /**
     * Кому показывать. Пустые массивы — всем. Адресный баннер сервер отдаёт только
     * адресату, а в `universityIds` оставляет лишь его вуз: чужие вузы из прицела наружу
     * не уходят. Команда платформы видит прицел целиком.
     */
    roles: string[]
    universityIds: string[]
  } | null
  disabledSections: string[]
  announcedVersion: string | null
  /**
   * Рычаг праздничного оформления. Сам праздник веб считает по справочнику в бандле —
   * отсюда приходит только вмешательство человека: погасить всё или показать конкретный
   * сезон вне его даты.
   */
  season: { off: boolean; override: string | null }
}

/** Что вообще можно записать: id, автор и время правки ставит сам сервис. */
type StatePatch = Partial<Omit<PlatformState, 'id' | 'updatedById' | 'updatedAt'>>

/**
 * Окно отката. Полчаса — это «я только что промахнулся»; всё, что старше, было решением,
 * и возвращать его молча одной кнопкой значило бы менять состояние платформы задним числом.
 */
const UNDO_WINDOW_MS = 30 * 60 * 1000

/** Даты в журнале лежат строками ISO: поднимаем их обратно, остальное отдаём как есть. */
function revivePatch(before: Record<string, unknown>): StatePatch {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(before)) {
    const isDateField = key.endsWith('At') || key.endsWith('Until') || key.endsWith('From')
    patch[key] = isDateField && typeof value === 'string' ? new Date(value) : value
  }
  return patch as StatePatch
}

const EMPTY: PublicPlatformState = {
  notifications: { quietFrom: null, quietTo: null, muted: [], dutyUserId: null, digestHour: null },
  maintenance: null,
  banner: null,
  disabledSections: [],
  announcedVersion: null,
  season: { off: false, override: null },
}

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly audit: AuditService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  /** Память процесса под вопрос «идут ли техработы» (см. MAINTENANCE_MEMO_MS). */
  private memo: { from: Date | null; until: Date | null; readAt: number } | null = null

  /**
   * Идут ли техработы прямо сейчас. Отдельно от `publicState`, потому что вызывается на
   * каждый запрос и отвечать обязан почти бесплатно.
   */
  async maintenanceActive(now: Date = new Date()): Promise<boolean> {
    if (this.memo === null || Date.now() - this.memo.readAt > MAINTENANCE_MEMO_MS) {
      const row = await this.read()
      // Через toDate, а не как есть: этот ответ читает каждый запрос к API, и строка вместо
      // даты здесь — уже не кривой ответ одной функции, а 500 на всей платформе.
      this.memo = {
        from: toDate(row?.maintenanceFrom),
        until: toDate(row?.maintenanceUntil),
        readAt: Date.now(),
      }
    }
    // Плановые работы платформу ещё не закрывают: пока окно не началось, guard пропускает.
    const started = this.memo.from === null || this.memo.from.getTime() <= now.getTime()
    return started && alive(this.memo.until, now)
  }

  /**
   * Кого и когда уведомлять. Читается перед каждой отправкой в Telegram, поэтому идёт
   * через тот же кэш, что и состояние: настройки меняют раз в месяц, а спрашивают их
   * на каждую жалобу.
   */
  async notificationPolicy(): Promise<NotificationPolicy> {
    const row = await this.read()
    return {
      quietFrom: row?.quietFrom ?? null,
      quietTo: row?.quietTo ?? null,
      muted: row?.mutedNotifications ?? [],
      dutyUserId: row?.dutyUserId ?? null,
      digestHour: row?.digestHour ?? null,
    }
  }

  /**
   * Состояние платформы глазами того, кто спрашивает: `viewer` — пользователь из токена
   * или null для анонима. Пока рычагов не трогали, строки нет — это норма.
   */
  async publicState(
    now: Date = new Date(),
    viewer: Pick<JwtPayload, 'role' | 'universityId'> | null = null,
  ): Promise<PublicPlatformState> {
    const row = await this.read()
    return forViewer(row ? project(row, now) : EMPTY, viewer)
  }

  /**
   * Включить или снять режим техработ.
   *
   * Включение требует кода 2FA, снятие — нет. Асимметрия намеренная: остановить платформу
   * для всех нельзя одним промахом по экрану, а вот вернуть её обязано быть возможно
   * всегда и быстро — иначе потерянный телефон продлевал бы простой.
   */
  async setMaintenance(
    userId: string,
    input: SetMaintenanceInput,
    ctx: RequestContext = {},
  ): Promise<PublicPlatformState> {
    if (input.minutes !== null) {
      const ok = input.code ? await this.twoFactor.verifyForUser(userId, input.code) : false
      if (!ok) throw new AppException('INVALID_2FA_CODE', 'Неверный код подтверждения')
    }

    const startsIn = input.startsInMinutes ?? 0
    const from = input.minutes === null || startsIn === 0 ? null : minutesFromNow(startsIn)
    // Срок окончания считается от НАЧАЛА окна, а не от «сейчас»: иначе плановые работы,
    // назначенные на вечер, кончались бы через час после нажатия кнопки.
    const until = input.minutes === null ? null : minutesFromNow(startsIn + input.minutes)
    const { state, before } = await this.write(userId, {
      maintenanceFrom: from,
      maintenanceUntil: until,
      maintenanceMessageRu: input.message?.ru ?? null,
      maintenanceMessageKk: input.message?.kk ?? null,
      maintenanceMessageEn: input.message?.en ?? null,
    })

    await this.audit.record({
      userId,
      action: until ? ACTION.maintenanceOn : ACTION.maintenanceOff,
      entity: 'PlatformState',
      // Текст объявления в журнал не пишем: он и так виден всем, а место в метаданных
      // нужнее сроку — по нему потом считают длительность простоя.
      metadata: {
        before,
        ...(until
          ? {
              until: until.toISOString(),
              minutes: input.minutes,
              ...(from ? { from: from.toISOString() } : {}),
            }
          : {}),
      },
      ...ctx,
    })
    return state
  }

  /** Повесить или снять баннер-объявление. */
  async setBanner(
    userId: string,
    input: SetBannerInput,
    ctx: RequestContext = {},
  ): Promise<PublicPlatformState> {
    const until = input.minutes === null ? null : minutesFromNow(input.minutes)
    if (until !== null && !input.text) {
      throw new AppException('VALIDATION_ERROR', 'Баннеру нужен текст')
    }

    const { state, before } = await this.write(userId, {
      bannerUntil: until,
      bannerLevel: until ? input.level : null,
      bannerRoles: until ? (input.roles ?? []) : [],
      bannerUniversityIds: until ? (input.universityIds ?? []) : [],
      bannerTextRu: until ? (input.text?.ru ?? null) : null,
      bannerTextKk: until ? (input.text?.kk ?? null) : null,
      bannerTextEn: until ? (input.text?.en ?? null) : null,
    })

    await this.audit.record({
      userId,
      action: until ? ACTION.bannerOn : ACTION.bannerOff,
      entity: 'PlatformState',
      metadata: { before, ...(until ? { until: until.toISOString(), level: input.level } : {}) },
      ...ctx,
    })
    return state
  }

  /** Погасить или вернуть разделы. Список приходит целиком — это состояние, а не команда. */
  async setSections(
    userId: string,
    input: SetSectionsInput,
    ctx: RequestContext = {},
  ): Promise<PublicPlatformState> {
    const { state, before } = await this.write(userId, { disabledSections: input.disabled })
    await this.audit.record({
      userId,
      action: ACTION.sectionsSet,
      entity: 'PlatformState',
      metadata: { before, disabled: input.disabled },
      ...ctx,
    })
    return state
  }

  /**
   * Праздничное оформление. Состояние целиком: «выключено и без подмены» отправляется
   * одним действием, как и всё остальное на этом экране.
   */
  async setSeason(
    userId: string,
    input: SetSeasonInput,
    ctx: RequestContext = {},
  ): Promise<PublicPlatformState> {
    const { state, before } = await this.write(userId, {
      seasonOff: input.off,
      seasonOverride: input.override,
    })
    await this.audit.record({
      userId,
      action: ACTION.seasonSet,
      entity: 'PlatformState',
      metadata: { before, off: input.off, override: input.override },
      ...ctx,
    })
    return state
  }

  /**
   * Объём файлов платформы. Считается по журналу `File`, а не по диску: S3-совместимое
   * хранилище про своё свободное место не рассказывает, и обещать «осталось столько-то»
   * было бы враньём. Зато рост этого числа виден, а он и есть то, что заканчивается.
   *
   * Ответ кэшируется на пять минут: COUNT и SUM идут по всей таблице `files`, а «Обзор»
   * мини-аппа открывают много раз в день. Рост хранилища за пять минут не меняет ничего,
   * что по этому числу решают. Redis недоступен — считаем напрямую.
   */
  async storageUsage(): Promise<{ files: number; bytes: number }> {
    const cached = await this.redis.get(STORAGE_CACHE_KEY).catch(() => null)
    if (cached) {
      try {
        return JSON.parse(cached) as { files: number; bytes: number }
      } catch {
        // Битая запись — пересчитаем и перезапишем.
      }
    }
    const [files, sum] = await Promise.all([
      this.prisma.file.count(),
      this.prisma.file.aggregate({ _sum: { size: true } }),
    ])
    const usage = { files, bytes: sum._sum.size ?? 0 }
    await this.redis
      .set(STORAGE_CACHE_KEY, JSON.stringify(usage), 'EX', STORAGE_CACHE_TTL_SEC)
      .catch(() => undefined)
    return usage
  }

  /**
   * Последние изменения рычагов: кто, что и когда. Читается из журнала аудита — отдельной
   * истории заводить не стали, она уже есть и заполняется теми же действиями.
   */
  async recentChanges(): Promise<
    { action: string; at: Date; by: { id: string; firstName: string; lastName: string } | null }[]
  > {
    const rows = await this.prisma.auditLog.findMany({
      // Список действий, а не префикс: см. ACTION.
      where: { action: { in: PLATFORM_AUDIT_ACTIONS }, entity: 'PlatformState' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { action: true, createdAt: true, userId: true },
    })

    // У AuditLog нет связи с User намеренно (журнал переживает удаление аккаунта),
    // поэтому имена добираем отдельным запросом по уникальным id.
    const ids = [
      ...new Set(rows.map((row) => row.userId).filter((id): id is string => id !== null)),
    ]
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, firstName: true, lastName: true },
        })
      : []
    const byId = new Map(users.map((user) => [user.id, user]))

    return rows.map((row) => ({
      action: row.action,
      at: row.createdAt,
      by: row.userId ? (byId.get(row.userId) ?? null) : null,
    }))
  }

  /**
   * Очередь дежурств: кто дежурит сейчас и в каком порядке меняются.
   *
   * Отдельно от публичного `GET /platform/state`: там нет ничего о людях, кроме id
   * дежурного, а список всей команды — это уже данные о команде, и посетителю сайта их
   * знать незачем.
   */
  async duty(): Promise<{ dutyUserId: string | null; rotation: string[] }> {
    const row = await this.read()
    return { dutyUserId: row?.dutyUserId ?? null, rotation: row?.dutyRotation ?? [] }
  }

  /**
   * Задать очередь. Пустой список выключает ротацию, дежурного при этом не трогаем: он
   * мог быть назначен руками, и молча снимать его вместе с расписанием — не то, о чём
   * просили. Первым дежурным ставим первого в списке, если дежурного ещё нет: очередь,
   * которая начнёт работать только через неделю, выглядит как сломанная.
   *
   * В очередь ставят только тех, кому бот может написать: сотрудник платформы с
   * действующей привязкой Telegram. Иначе — 422: дежурный без привязки молча глушит
   * уведомления команде.
   */
  async setDuty(
    userId: string,
    rotation: string[],
    ctx: RequestContext = {},
  ): Promise<{ dutyUserId: string | null; rotation: string[] }> {
    const unique = [...new Set(rotation)]
    const current = await this.read()
    const reachable = await this.reachable(unique)

    // Проверяются только ДОБАВЛЕННЫЕ: тот, кто уже стоит в очереди и с тех пор отвязал
    // Telegram, в списке мини-аппа не виден, и убрать его оттуда нельзя — строгая проверка
    // всего списка заперла бы очередь навсегда. Такого крон просто пропускает.
    const known = new Set(current?.dutyRotation ?? [])
    const rejected = unique.filter((id) => !known.has(id) && !reachable.has(id))
    if (rejected.length > 0) {
      throw new AppException(
        'VALIDATION_ERROR',
        'В очередь можно поставить только сотрудника платформы с привязанным Telegram',
        rejected.map((id) => ({
          field: `rotation.${rotation.indexOf(id)}`,
          message: 'Нет активной привязки Telegram',
        })),
      )
    }

    const duty = current?.dutyUserId ?? unique.find((id) => reachable.has(id)) ?? null

    const { state: _state, before } = await this.write(userId, {
      dutyRotation: unique,
      dutyUserId: duty,
    })
    void _state
    await this.audit.record({
      userId,
      action: ACTION.dutySet,
      entity: 'PlatformState',
      metadata: { before, size: unique.length },
      ...ctx,
    })
    return { dutyUserId: duty, rotation: unique }
  }

  /**
   * Передать дежурство следующему. Зовётся кроном по понедельникам.
   *
   * Позиция ищется по текущему дежурному, а не хранится числом: номер смены пришлось бы
   * чинить руками каждый раз, когда список правят, а по имени всё сходится само. Дежурный
   * не из списка (назначили руками на выходные) — начинаем с начала. Тех, кому бот не
   * может написать, пропускаем.
   */
  async rotateDuty(now: Date = new Date()): Promise<string | null> {
    const row = await this.read()
    const rotation = row?.dutyRotation ?? []
    if (rotation.length < 2) return null

    // Круг от следующего за текущим. Кому бот не может написать (отвязал Telegram,
    // заблокирован, удалён, ушёл из команды), того пропускаем: дежурство, переданное ему,
    // означало бы неделю, в которую уведомления о жалобах не доходят до дежурного.
    const index = row?.dutyUserId ? rotation.indexOf(row.dutyUserId) : -1
    const order = rotation.map((_, step) => rotation[(index + 1 + step) % rotation.length]!)
    const reachable = await this.reachable(rotation)
    const next = order.find((id) => reachable.has(id))
    // Передавать дежурство «никому» нельзя — лучше пропустить понедельник, чем оставить
    // команду без адресата уведомлений.
    if (!next) {
      this.logger.warn('rotateDuty: в очереди нет никого с привязанным Telegram — смена пропущена')
      return null
    }
    if (next === row?.dutyUserId) return null

    await this.write(row?.updatedById ?? next, { dutyUserId: next })
    await this.audit.record({
      action: ACTION.dutyRotate,
      entity: 'PlatformState',
      metadata: { to: next, at: now.toISOString(), skipped: order.indexOf(next) },
    })
    return next
  }

  /**
   * Кому из перечисленных бот может написать: сотрудник платформы, не удалён, не
   * заблокирован, привязка Telegram действует. Те же условия, что у рассылки в
   * TelegramNotifyService: дежурный, до которого она не дойдёт, хуже, чем никакого.
   */
  private async reachable(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set()
    const rows = await this.prisma.telegramAccount.findMany({
      where: {
        userId: { in: ids },
        revokedAt: null,
        user: { role: { in: [...DUTY_ROLES] }, isBlocked: false, deletedAt: null },
      },
      select: { userId: true },
      take: ids.length,
    })
    return new Set(rows.map((row) => row.userId))
  }

  /**
   * Вернуть как было — откат последнего изменения рычагов.
   *
   * Ошибочное переключение — самый частый способ навредить с телефона: чипы стоят рядом,
   * палец один. До этой кнопки «верни как было» означало вспомнить прежнее состояние и
   * набрать его руками, а прежнее состояние нигде не показано.
   *
   * Откатывается ровно то, что трогало последнее действие: снимок в журнале содержит
   * только переписанные поля, и возврат баннера не снимет техработы, включённые в ту же
   * минуту кем-то другим. Запись об откате сама несёт снимок — второе нажатие вернёт всё
   * обратно, и это честно называется «верни как было» дважды.
   *
   * Два ограничения. Срок: старше получаса — уже не промах, а решение, и тихо менять
   * состояние платформы под этим предлогом нельзя. И направление: включить техработы
   * откатом нельзя — включение спрашивает код 2FA, и обход этого требования кнопкой без
   * кода сделал бы защиту декоративной.
   *
   * Понедельничную смену дежурного откат пропускает: это не правка человека, снимка у
   * неё нет, и «отменять нечего» после неё было бы неправдой.
   */
  async undoLast(userId: string, ctx: RequestContext = {}): Promise<PublicPlatformState> {
    const entry = await this.prisma.auditLog.findFirst({
      where: { action: { in: UNDOABLE_ACTIONS }, entity: 'PlatformState' },
      orderBy: { createdAt: 'desc' },
      select: { action: true, metadata: true, createdAt: true },
    })
    const before = (entry?.metadata as { before?: Record<string, unknown> } | null)?.before
    if (!entry || !before || Object.keys(before).length === 0) {
      throw new AppException('NOT_FOUND', 'Отменять нечего')
    }
    if (Date.now() - entry.createdAt.getTime() > UNDO_WINDOW_MS) {
      throw new AppException('CONFLICT', 'Изменение старше получаса — отмените его обычной кнопкой')
    }

    const patch = revivePatch(before)
    const until = patch.maintenanceUntil
    if (until instanceof Date && until.getTime() > Date.now()) {
      throw new AppException(
        'CONFLICT',
        'Техработы включаются только своей кнопкой — она спросит код',
      )
    }

    // Снимок отката — состояние до отмены, а не снимок отменённой записи: с ним второе
    // нажатие вернуло бы те же значения, что уже стоят, и отмену было бы не отменить.
    const { state, before: undone } = await this.write(userId, patch)
    await this.audit.record({
      userId,
      action: ACTION.stateUndo,
      entity: 'PlatformState',
      metadata: { of: entry.action, at: entry.createdAt.toISOString(), before: undone },
      ...ctx,
    })
    return state
  }

  /** Настройки уведомлений команде: тишина, дежурный, что слать, час сводки. */
  async setNotifications(
    userId: string,
    input: SetNotificationsInput,
    ctx: RequestContext = {},
  ): Promise<PublicPlatformState> {
    // Нового дежурного проверяем так же, как очередь: назначенный, которому бот не может
    // написать, превращает «только дежурному» в «никому». Прежнее значение не проверяем —
    // правка тихих часов не должна падать из-за того, что дежурный с тех пор отвязался
    // (до команды такие уведомления всё равно дойдут, см. TelegramNotifyService).
    if (input.dutyUserId !== null) {
      const current = await this.read()
      if (
        input.dutyUserId !== current?.dutyUserId &&
        !(await this.reachable([input.dutyUserId])).has(input.dutyUserId)
      ) {
        throw new AppException(
          'VALIDATION_ERROR',
          'Дежурным можно назначить только сотрудника платформы с привязанным Telegram',
          [{ field: 'dutyUserId', message: 'Нет активной привязки Telegram' }],
        )
      }
    }

    const { state, before } = await this.write(userId, {
      quietFrom: input.quietFrom,
      quietTo: input.quietTo,
      mutedNotifications: input.muted,
      dutyUserId: input.dutyUserId,
      digestHour: input.digestHour,
    })
    await this.audit.record({
      userId,
      action: ACTION.notificationsSet,
      entity: 'PlatformState',
      metadata: {
        before,
        quietFrom: input.quietFrom,
        quietTo: input.quietTo,
        muted: input.muted,
        duty: input.dutyUserId !== null,
        digestHour: input.digestHour,
      },
      ...ctx,
    })
    return state
  }

  /** Объявить версию «Что нового» — только номер, текст едет в бандле web. */
  async announceRelease(
    userId: string,
    input: AnnounceReleaseInput,
    ctx: RequestContext = {},
  ): Promise<PublicPlatformState> {
    const { state, before } = await this.write(userId, { announcedVersion: input.version })
    await this.audit.record({
      userId,
      action: ACTION.releaseAnnounce,
      entity: 'PlatformState',
      metadata: { before, version: input.version },
      ...ctx,
    })
    return state
  }

  /**
   * Запись строки-синглтона и сброс кэша. Сброс — сразу после записи и до ответа: человек,
   * нажавший тумблер, обязан увидеть результат при первом же обновлении, а не через минуту.
   */
  private async write(
    userId: string,
    data: StatePatch,
  ): Promise<{ state: PublicPlatformState; before: Record<string, unknown> }> {
    // Снимок ровно тех полей, которые сейчас перепишем: он уходит в журнал и делает
    // возможной кнопку «верни как было». Снимать состояние целиком незачем — откат
    // баннера не должен трогать техработы, включённые в ту же минуту кем-то другим.
    const before = await this.snapshot(Object.keys(data))
    const row = await this.prisma.platformState.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...data, updatedById: userId },
      update: { ...data, updatedById: userId },
    })
    await this.redis.del(CACHE_KEY).catch(() => undefined)
    // И местную память тоже: инстанс, принявший команду, обязан подчиниться ей сразу, а не
    // через пять секунд — иначе админ увидит «включено», а следующий его же запрос пройдёт.
    this.memo = null
    return { state: project(row, new Date()), before }
  }

  /** Текущие значения перечисленных полей. Нет строки — откатывать будет не к чему. */
  private async snapshot(keys: string[]): Promise<Record<string, unknown>> {
    const row = await this.read().catch(() => null)
    if (!row) return {}
    const source = row as unknown as Record<string, unknown>
    const before: Record<string, unknown> = {}
    for (const key of keys) {
      const value = source[key]
      // В журнал уходит JSON: даты — строками, иначе обратно они не поднимутся.
      before[key] = value instanceof Date ? value.toISOString() : (value ?? null)
    }
    return before
  }

  /**
   * Строка состояния с кэшем. Источник правды — БД: перезапуск Redis не должен молча
   * снимать режим техработ.
   */
  private async read(): Promise<PlatformState | null> {
    const cached = await this.redis.get(CACHE_KEY).catch(() => null)
    if (cached) return reviveDates(JSON.parse(cached) as PlatformState)

    // Отказ чтения = «объявлений нет», а не исключение.
    //
    // Этот запрос идёт на КАЖДЫЙ запрос к API (MaintenanceGuard), и любая его ошибка
    // иначе становится отказом всей платформы, а не одной функции. Самый близкий случай —
    // выкатка нового кода раньше миграции: таблицы ещё нет, и без этого catch весь API
    // начал бы отвечать 500 вместо «техработ не идёт».
    //
    // Сторона, в которую падаем, выбрана осознанно: не сумев прочитать состояние, платформа
    // считает себя работающей. Обратное означало бы, что сбой БД запирает всех, включая тех,
    // кто пришёл бы его чинить.
    const row = await this.prisma.platformState
      .findUnique({ where: { id: SINGLETON_ID } })
      .catch((error: unknown) => {
        this.logger.warn(`Состояние платформы не прочитано: ${String(error)}`)
        return null
      })
    if (row) {
      await this.redis
        .set(CACHE_KEY, JSON.stringify(row), 'EX', CACHE_TTL_SEC)
        .catch(() => undefined)
    }
    return row
  }
}

/** Применяет сроки и отбрасывает служебные поля (кто правил — не дело посетителя). */
function project(row: PlatformState, now: Date): PublicPlatformState {
  return {
    notifications: {
      quietFrom: row.quietFrom,
      quietTo: row.quietTo,
      muted: row.mutedNotifications,
      dutyUserId: row.dutyUserId,
      digestHour: row.digestHour,
    },
    maintenance: alive(row.maintenanceUntil, now)
      ? {
          until: row.maintenanceUntil!.toISOString(),
          startsAt: row.maintenanceFrom?.toISOString() ?? null,
          // Назначенные на будущее работы видны заранее, но платформу ещё не закрывают:
          // предупреждение и остановка — разные состояния одного события.
          active: row.maintenanceFrom === null || row.maintenanceFrom.getTime() <= now.getTime(),
          message: localized(
            row.maintenanceMessageRu,
            row.maintenanceMessageKk,
            row.maintenanceMessageEn,
          ),
        }
      : null,
    banner:
      alive(row.bannerUntil, now) &&
      localized(row.bannerTextRu, row.bannerTextKk, row.bannerTextEn) !== null
        ? {
            until: row.bannerUntil!.toISOString(),
            level: row.bannerLevel === 'WARNING' ? 'WARNING' : 'INFO',
            text: localized(row.bannerTextRu, row.bannerTextKk, row.bannerTextEn)!,
            roles: row.bannerRoles,
            universityIds: row.bannerUniversityIds,
          }
        : null,
    disabledSections: row.disabledSections,
    announcedVersion: row.announcedVersion,
    // `?? ` здесь не формальность: в Redis на минуту переживает строка, записанная ДО
    // выкатки этих полей, и без подстраховки наружу ушли бы undefined вместо значений.
    season: { off: row.seasonOff ?? false, override: row.seasonOverride ?? null },
  }
}

/**
 * Срез состояния для того, кто спрашивает (B-F19).
 *
 * Раньше ответ был один на всех, а адресацию баннера проверял клиент: объявление «только
 * студентам вуза X» вместе с UUID вузов-адресатов и UUID дежурного читал любой без входа.
 * Теперь:
 * - команда платформы видит всё — ей нужно проверить, что и кому повешено;
 * - остальные — без настроек уведомлений, а адресный баннер только если он им: роль и
 *   вуз проверяются пересечением, как в вебе (platform-gate), прицел по вузам сужается
 *   до своего вуза;
 * - аноним — только техработы и баннер без адресации.
 *
 * Имена полей прежние: веб и мини-апп читают тот же ответ, а фильтр на клиенте после
 * серверного просто ничего не отсеивает.
 */
export function forViewer(
  state: PublicPlatformState,
  viewer: Pick<JwtPayload, 'role' | 'universityId'> | null,
): PublicPlatformState {
  if (viewer && DUTY_ROLES.includes(viewer.role)) return state
  const { notifications: _team, ...rest } = state
  void _team
  return { ...rest, banner: bannerFor(state.banner, viewer) }
}

function bannerFor(
  banner: PublicPlatformState['banner'],
  viewer: Pick<JwtPayload, 'role' | 'universityId'> | null,
): PublicPlatformState['banner'] {
  if (!banner) return null
  if (banner.roles.length === 0 && banner.universityIds.length === 0) return banner
  if (!viewer) return null
  if (banner.roles.length > 0 && !banner.roles.includes(viewer.role)) return null
  if (banner.universityIds.length === 0) return banner
  if (!viewer.universityId || !banner.universityIds.includes(viewer.universityId)) return null
  return { ...banner, universityIds: [viewer.universityId] }
}

/** Срок считает сервер: часы клиента в этом вопросе не участвуют (см. SetMaintenanceSchema). */
function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000)
}

function alive(until: Date | null, now: Date): boolean {
  return until !== null && until.getTime() > now.getTime()
}

/** Текст отдаём только целиком: строка на двух языках из трёх — это дыра в интерфейсе. */
function localized(ru: string | null, kk: string | null, en: string | null): LocalizedText | null {
  return ru && kk && en ? { ru, kk, en } : null
}

/**
 * Все поля-даты строки состояния. Тип заставляет перечислить их целиком: новая колонка
 * DateTime без записи здесь не соберётся. Список руками однажды забыл `maintenanceFrom` —
 * он возвращался из кэша строкой, и плановые техработы роняли весь API.
 */
type DateField = {
  [K in keyof PlatformState]-?: PlatformState[K] extends Date | null ? K : never
}[keyof PlatformState]

const DATE_FIELDS: Record<DateField, true> = {
  maintenanceFrom: true,
  maintenanceUntil: true,
  bannerUntil: true,
  updatedAt: true,
}

/** JSON.parse возвращает даты строками — восстанавливаем, иначе сроки не сравнить. */
function reviveDates(row: PlatformState): PlatformState {
  const revived: Record<string, unknown> = { ...row }
  for (const key of Object.keys(DATE_FIELDS)) revived[key] = toDate(revived[key])
  return revived as unknown as PlatformState
}

/** Дата из кэша или из памяти. Пусто или не разбирается — `null`, а не Invalid Date. */
function toDate(value: unknown): Date | null {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}
