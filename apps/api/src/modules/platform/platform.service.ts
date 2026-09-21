import { Inject, Injectable } from '@nestjs/common'
import type { PlatformState } from '@prisma/client'
import type Redis from 'ioredis'
import type {
  AnnounceReleaseInput,
  SetBannerInput,
  SetMaintenanceInput,
  SetSectionsInput,
} from '@studenthub/shared-schemas'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import { TwoFactorService } from '../auth/two-factor.service'
import type { RequestContext } from '../auth/auth.service'

// Состояние платформы: рычаги, которыми админ управляет вебом без деплоя.
// Модель и мотивация полей — prisma/schema/30-platform.prisma.

const SINGLETON_ID = 'singleton'
const CACHE_KEY = 'platform:state'

// Состояние спрашивает каждая загрузка страницы каждого пользователя, поэтому оно
// кэшируется. Запись кэш сбрасывает — значит 60 секунд это не задержка появления
// баннера, а потолок расхождения, если сброс до инстанса не доехал.
const CACHE_TTL_SEC = 60

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
  maintenance: { until: string; message: LocalizedText | null } | null
  banner: { until: string; level: 'INFO' | 'WARNING'; text: LocalizedText } | null
  disabledSections: string[]
  announcedVersion: string | null
}

/** Что вообще можно записать: id, автор и время правки ставит сам сервис. */
type StatePatch = Partial<Omit<PlatformState, 'id' | 'updatedById' | 'updatedAt'>>

const EMPTY: PublicPlatformState = {
  maintenance: null,
  banner: null,
  disabledSections: [],
  announcedVersion: null,
}

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly audit: AuditService,
    private readonly twoFactor: TwoFactorService,
  ) {}

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

    const until = input.minutes === null ? null : minutesFromNow(input.minutes)
    const state = await this.write(userId, {
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
      metadata: until ? { until: until.toISOString(), minutes: input.minutes } : {},
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

    const state = await this.write(userId, {
      bannerUntil: until,
      bannerLevel: until ? input.level : null,
      bannerTextRu: until ? (input.text?.ru ?? null) : null,
      bannerTextKk: until ? (input.text?.kk ?? null) : null,
      bannerTextEn: until ? (input.text?.en ?? null) : null,
    })

    await this.audit.record({
      userId,
      action: until ? 'platform.banner.on' : 'platform.banner.off',
      entity: 'PlatformState',
      metadata: until ? { until: until.toISOString(), level: input.level } : {},
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
    const state = await this.write(userId, { disabledSections: input.disabled })
    await this.audit.record({
      userId,
      action: 'platform.sections.set',
      entity: 'PlatformState',
      metadata: { disabled: input.disabled },
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
    const state = await this.write(userId, { announcedVersion: input.version })
    await this.audit.record({
      userId,
      action: 'platform.release.announce',
      entity: 'PlatformState',
      metadata: { version: input.version },
      ...ctx,
    })
    return state
  }

  /**
   * Запись строки-синглтона и сброс кэша. Сброс — сразу после записи и до ответа: человек,
   * нажавший тумблер, обязан увидеть результат при первом же обновлении, а не через минуту.
   */
  private async write(userId: string, data: StatePatch): Promise<PublicPlatformState> {
    const row = await this.prisma.platformState.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...data, updatedById: userId },
      update: { ...data, updatedById: userId },
    })
    await this.redis.del(CACHE_KEY).catch(() => undefined)
    return project(row, new Date())
  }

  /**
   * Строка состояния с кэшем. Источник правды — БД: перезапуск Redis не должен молча
   * снимать режим техработ.
   */
  private async read(): Promise<PlatformState | null> {
    const cached = await this.redis.get(CACHE_KEY).catch(() => null)
    if (cached) return reviveDates(JSON.parse(cached) as PlatformState)

    const row = await this.prisma.platformState.findUnique({ where: { id: SINGLETON_ID } })
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
    maintenance: alive(row.maintenanceUntil, now)
      ? {
          until: row.maintenanceUntil!.toISOString(),
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
          }
        : null,
    disabledSections: row.disabledSections,
    announcedVersion: row.announcedVersion,
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
