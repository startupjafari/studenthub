import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OPS_NOTIFIER, type OpsNotifier } from '../../../common/monitoring'
import type { EnvVars } from '../../../config/env.schema'
import { DeployTrackerService } from '../deploy-tracker.service'
import { GithubApiService } from '../github-api.service'

// T-9 (docs/TELEGRAM_BOT.md §2.1): «develop опережает main на 12 коммитов, последний релиз
// 9 дней назад».
//
// Для нерегулярных релизов это единственное напоминание, что накопилось. Раз в сутки и
// в тему «Сводки»: это не авария, а тренд, и будить им никого нельзя.

/** Ниже этого порога накопленное — норма рабочей недели, а не повод писать в чат. */
const MIN_AHEAD = 5

@Injectable()
export class BranchDriftCheck {
  private readonly logger = new Logger(BranchDriftCheck.name)

  constructor(
    private readonly github: GithubApiService,
    private readonly deploys: DeployTrackerService,
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(OPS_NOTIFIER) private readonly notifier: OpsNotifier,
  ) {}

  async run(): Promise<void> {
    if (!this.github.enabled) return

    const base = this.config.get('OPS_GITHUB_BASE_BRANCH', { infer: true })
    const head = this.config.get('OPS_GITHUB_HEAD_BRANCH', { infer: true })

    const comparison = await this.github.compare(base, head)
    if (!comparison || comparison.aheadBy < MIN_AHEAD) return

    this.notifier.emit('branchDrift', {
      base,
      head,
      ahead: comparison.aheadBy,
      lastRelease: await this.describeLastRelease(),
      compareUrl: comparison.compareUrl,
    })
    this.logger.log(`${head} опережает ${base} на ${comparison.aheadBy} коммитов`)
  }

  /**
   * «9 дней назад» вместо даты: в напоминании важен возраст, а не календарное число.
   *
   * Момент берём у трекера деплоя — единственного источника правды о релизах (§7.1.6).
   * Его ещё нет (бота подключили недавно) — откатываемся на дату последнего коммита в
   * базовой ветке: это не то же самое, но ближе, чем молчание.
   */
  private async describeLastRelease(): Promise<string> {
    const base = this.config.get('OPS_GITHUB_BASE_BRANCH', { infer: true })
    const at = (await this.deploys.lastReleaseAt()) ?? (await this.github.lastCommitDate(base))
    if (!at) return 'неизвестно'

    const days = Math.floor((Date.now() - at.getTime()) / (24 * 60 * 60 * 1000))
    if (days === 0) return 'сегодня'
    if (days === 1) return 'вчера'
    return `${days} дней назад`
  }
}
