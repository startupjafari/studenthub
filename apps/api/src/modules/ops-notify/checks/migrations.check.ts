import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { PrismaService } from '../../../common/prisma/prisma.service'
import { OPS_NOTIFIER, type OpsNotifier } from '../../../common/monitoring'

// T-3 (docs/TELEGRAM_BOT.md §2.2): расхождение `prisma/migrations` и таблицы
// `_prisma_migrations`. Самая дешёвая проверка с самой высокой отдачей — именно этот
// случай ломал локальный запуск, а на проде проявился бы только рантайм-ошибкой
// в первом же запросе к новой колонке.
//
// Проверка ТОЛЬКО СООБЩАЕТ. Применяет миграции человек (docs/RUNBOOK.md): автоматический
// `migrate deploy` из приложения — это ровно тот сценарий потери данных, который запрещён.

/**
 * Каталог миграций ищем от рабочей директории: локально API стартует из `apps/api`,
 * в образе — из `/app`, куда Dockerfile кладёт `prisma/` рядом с `dist/`.
 */
const MIGRATIONS_DIR_CANDIDATES = ['prisma/migrations', '../../prisma/migrations']

/** Сколько имён показываем в сообщении: остальное — счётчиком, канал читают с телефона. */
const NAMES_SHOWN = 5

@Injectable()
export class MigrationsCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(MigrationsCheck.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OPS_NOTIFIER) private readonly notifier: OpsNotifier,
  ) {}

  /**
   * Старт не блокируем: проверка запускается фоном и её сбой не имеет права помешать
   * приложению подняться (T-3, §0.1.3).
   */
  onApplicationBootstrap(): void {
    void this.run().catch((error: unknown) => {
      this.logger.warn(`Проверка миграций не выполнена: ${String(error)}`)
    })
  }

  /**
   * Состояние миграций без каких-либо сообщений — этим же пользуется команда `/migrations`
   * (§6): она отвечает на запрос человека, и рассылать по такому поводу событие не нужно.
   */
  async state(): Promise<{ applied: number; pending: string[] }> {
    const local = this.localMigrations()
    if (!local.length) return { applied: 0, pending: [] }

    const applied = await this.appliedMigrations()
    if (!applied) return { applied: 0, pending: [] }

    return { applied: applied.size, pending: local.filter((name) => !applied.has(name)) }
  }

  async run(): Promise<string[]> {
    const { applied, pending } = await this.state()
    if (!pending.length) {
      this.logger.log(`Миграции синхронны с БД (${applied})`)
      return []
    }

    const shown = pending.slice(0, NAMES_SHOWN).join(', ')
    this.notifier.emit('migrationsPending', {
      count: pending.length,
      names:
        pending.length > NAMES_SHOWN ? `${shown} и ещё ${pending.length - NAMES_SHOWN}` : shown,
    })
    this.logger.error(`Неприменённые миграции (${pending.length}): ${pending.join(', ')}`)
    return pending
  }

  /** Имена каталогов миграций в репозитории. `migration_lock.toml` — файл, не миграция. */
  private localMigrations(): string[] {
    for (const candidate of MIGRATIONS_DIR_CANDIDATES) {
      const dir = join(process.cwd(), candidate)
      if (!existsSync(dir)) continue
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    }
    return []
  }

  /**
   * Применённые миграции из служебной таблицы Prisma.
   *
   * Raw SQL здесь неизбежен: `_prisma_migrations` не описана в схеме и клиента для неё нет.
   * Лимита нет намеренно — размер выборки задан числом миграций в репозитории (десятки),
   * а не пользовательскими данными; это единственное исключение из §7.2 в модуле.
   *
   * Таблицы может не быть вовсе (БД поднята через `db push`) — тогда молчим: это состояние
   * разработчика, а не авария прода.
   */
  private async appliedMigrations(): Promise<Set<string> | null> {
    try {
      const rows = await this.prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      `
      return new Set(rows.map((r) => r.migration_name))
    } catch (error) {
      this.logger.warn(`Не удалось прочитать _prisma_migrations: ${String(error)}`)
      return null
    }
  }
}
