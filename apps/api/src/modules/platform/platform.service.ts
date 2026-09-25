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
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import type { NotificationPolicy } from './platform.constants'
import { PLATFORM_STATE_CACHE_KEY, PLATFORM_STATE_ID } from './platform.constants'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import { TwoFactorService } from '../auth/two-factor.service'
import type { RequestContext } from '../auth/auth.service'

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

export interface LocalizedText {
  ru: string
  kk: string
  en: string
}

/**
 * То, что видит любой посетитель. Срок жизни здесь уже применён: наружу уходит либо
 * действующее объявление, либо `null`. Клиент не сравнивает даты сам — иначе веб,
 * мини-апп и мобильный браузер с уехавшими часами решали бы этот вопрос по-разному.
 */
export interface PublicPlatformState {
  /** Настройки уведомлений команде. Публичны намеренно: в них нет ничего о людях,
      кроме id дежурного, а знание «сейчас тихие часы» не даёт постороннему ничего. */
  notifications: {
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
    /** Кому показывать. Пустые массивы — всем; фильтрует клиент, знающий свою роль. */
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
      this.memo = {
        from: row?.maintenanceFrom ?? null,
        until: row?.maintenanceUntil ?? null,
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

  /** Публичное состояние платформы. Пока рычагов не трогали, строки нет — это норма. */
  async publicState(now: Date = new Date()): Promise<PublicPlatformState> {
    const row = await this.read()
    return row ? project(row, now) : EMPTY
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
      action: until ? 'platform.maintenance.on' : 'platform.maintenance.off',
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
      action: until ? 'platform.banner.on' : 'platform.banner.off',
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
      action: 'platform.sections.set',
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
      action: 'platform.season.set',
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
   */
  async storageUsage(): Promise<{ files: number; bytes: number }> {
    const [files, sum] = await Promise.all([
      this.prisma.file.count(),
      this.prisma.file.aggregate({ _sum: { size: true } }),
    ])
    return { files, bytes: sum._sum.size ?? 0 }
  }

  /**
   * Последние изменения рычагов: кто, что и когда. Читается из журнала аудита — отдельной
   * истории заводить не стали, она уже есть и заполняется теми же действиями.
   */
  async recentChanges(): Promise<
    { action: string; at: Date; by: { id: string; firstName: string; lastName: string } | null }[]
  > {
    const rows = await this.prisma.auditLog.findMany({
      where: { action: { startsWith: 'platform.' } },
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
   */
  async setDuty(
    userId: string,
    rotation: string[],
    ctx: RequestContext = {},
  ): Promise<{ dutyUserId: string | null; rotation: string[] }> {
    const unique = [...new Set(rotation)]
    const current = await this.read()
    const duty = current?.dutyUserId ?? unique[0] ?? null

    const { state: _state, before } = await this.write(userId, {
      dutyRotation: unique,
      dutyUserId: duty,
    })
    void _state
    await this.audit.record({
      userId,
      action: 'platform.duty.set',
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
   * не из списка (назначили руками на выходные) — начинаем с начала.
   */
  async rotateDuty(now: Date = new Date()): Promise<string | null> {
    const row = await this.read()
    const rotation = row?.dutyRotation ?? []
    if (rotation.length < 2) return null

    const index = row?.dutyUserId ? rotation.indexOf(row.dutyUserId) : -1
    const next = rotation[(index + 1) % rotation.length]
    // `next` пуст только если очередь изменилась между чтением и этой строкой; передавать
    // дежурство «никому» нельзя — лучше пропустить понедельник, чем оставить команду без
    // адресата уведомлений.
    if (!next || next === row?.dutyUserId) return null

    await this.write(row?.updatedById ?? next, { dutyUserId: next })
    await this.audit.record({
      action: 'platform.duty.rotate',
      entity: 'PlatformState',
      metadata: { to: next, at: now.toISOString() },
    })
    return next
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
   */
  async undoLast(userId: string, ctx: RequestContext = {}): Promise<PublicPlatformState> {
    const entry = await this.prisma.auditLog.findFirst({
      where: { action: { startsWith: 'platform.' } },
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

    const { state } = await this.write(userId, patch)
    await this.audit.record({
      userId,
      action: 'platform.state.undo',
      entity: 'PlatformState',
      // Снимок отката — тоже снимок: второе нажатие вернёт то, что было до отмены.
      metadata: { of: entry.action, at: entry.createdAt.toISOString(), before },
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
    const { state, before } = await this.write(userId, {
      quietFrom: input.quietFrom,
      quietTo: input.quietTo,
      mutedNotifications: input.muted,
      dutyUserId: input.dutyUserId,
      digestHour: input.digestHour,
    })
    await this.audit.record({
      userId,
      action: 'platform.notifications.set',
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
      action: 'platform.release.announce',
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

/** JSON.parse возвращает даты строками — восстанавливаем, иначе сроки не сравнить. */
function reviveDates(row: PlatformState): PlatformState {
  return {
    ...row,
    maintenanceUntil: row.maintenanceUntil ? new Date(row.maintenanceUntil) : null,
    bannerUntil: row.bannerUntil ? new Date(row.bannerUntil) : null,
    updatedAt: new Date(row.updatedAt),
  }
}
