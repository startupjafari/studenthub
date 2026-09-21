import { Inject, Injectable } from '@nestjs/common'
import type { PlatformState } from '@prisma/client'
import type Redis from 'ioredis'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.module'

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
  ) {}

  /** Публичное состояние платформы. Пока рычагов не трогали, строки нет — это норма. */
  async publicState(now: Date = new Date()): Promise<PublicPlatformState> {
    const row = await this.read()
    return row ? project(row, now) : EMPTY
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
