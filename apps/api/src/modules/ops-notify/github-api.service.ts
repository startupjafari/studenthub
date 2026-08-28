import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'

// Чтение GitHub API: упавший шаг CI (T-8) и сравнение веток (T-9).
//
// Отдельный класс, а не «ещё один fetch по месту»: §7.1.1 требует одного клиента на
// направление, и это второе после Telegram. Клиент СТРОГО на чтение — ни ветки, ни релизы,
// ни комментарии отсюда не создаются.
//
// Без `OPS_GITHUB_REPO`/`OPS_GITHUB_TOKEN` всё возвращает `null`, и вызывающие деградируют:
// в сообщении о CI остаётся имя workflow вместо шага, дрейф веток не считается вовсе.
// Токену достаточно прав на чтение репозитория.

const API_BASE = 'https://api.github.com'
const TIMEOUT_MS = 5000

/** Потолок списка коммитов в changelog: канал читают с телефона. */
const MAX_COMMITS = 20

export interface BranchComparison {
  aheadBy: number
  commits: string[]
  compareUrl: string
}

@Injectable()
export class GithubApiService {
  private readonly logger = new Logger(GithubApiService.name)

  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  get enabled(): boolean {
    return Boolean(this.repo && this.token)
  }

  /**
   * Имя упавшего шага прогона — то, ради чего сообщение о CI вообще нужно: по нему сразу
   * видно, чинить код или инфраструктуру. Берём ПЕРВЫЙ упавший: последующие обычно его
   * следствие или вовсе пропущены.
   */
  async failedStep(runId: string): Promise<string | null> {
    const body = await this.get<{
      jobs?: { name?: string; steps?: { name?: string; conclusion?: string }[] }[]
    }>(`/actions/runs/${runId}/jobs`)
    if (!body) return null

    for (const job of body.jobs ?? []) {
      const step = job.steps?.find((s) => s.conclusion === 'failure')
      if (step?.name) return step.name
    }
    return null
  }

  /**
   * Насколько `head` опережает `base` и какими коммитами. Используется дважды: для
   * changelog релиза (`base` — SHA прошлого деплоя) и для дрейфа веток (`main`…`develop`).
   */
  async compare(base: string, head: string): Promise<BranchComparison | null> {
    const body = await this.get<{
      ahead_by?: number
      html_url?: string
      commits?: { sha?: string; commit?: { message?: string } }[]
    }>(`/compare/${base}...${head}`)
    if (!body) return null

    const commits = (body.commits ?? [])
      .slice(-MAX_COMMITS)
      .reverse()
      .map((c) => {
        // Только заголовок коммита: тело содержит Co-authored-by с email (§0.1.1).
        const subject = c.commit?.message?.split('\n')[0] ?? ''
        return `${c.sha?.slice(0, 7) ?? '???????'} ${subject}`.trim()
      })

    return {
      aheadBy: body.ahead_by ?? commits.length,
      commits,
      compareUrl: body.html_url ?? `https://github.com/${this.repo}/compare/${base}...${head}`,
    }
  }

  /** Дата последнего коммита в ветке — «последний релиз N дней назад» в дрейфе. */
  async lastCommitDate(branch: string): Promise<Date | null> {
    const body = await this.get<{ commit?: { committer?: { date?: string } } }>(
      `/commits/${branch}`,
    )
    const date = body?.commit?.committer?.date
    return date ? new Date(date) : null
  }

  /**
   * GET к API репозитория. Как и телеграмный транспорт, НИКОГДА не бросает: наблюдение
   * не имеет права уронить проверку, из которой его позвали. Повторов нет — вызывающие
   * работают по расписанию и попробуют снова сами.
   */
  private async get<T>(path: string): Promise<T | null> {
    if (!this.enabled) return null
    try {
      const res = await fetch(`${API_BASE}/repos/${this.repo}${path}`, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${this.token}`,
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) {
        // Тело ответа не логируем: в ошибках GitHub встречаются фрагменты запроса.
        this.logger.warn(`GitHub API ${path} отказал: ${res.status}`)
        return null
      }
      return (await res.json()) as T
    } catch (error) {
      this.logger.warn(`GitHub API ${path} недоступен: ${String(error)}`)
      return null
    }
  }

  private get repo(): string | undefined {
    return this.config.get('OPS_GITHUB_REPO', { infer: true })
  }

  private get token(): string | undefined {
    return this.config.get('OPS_GITHUB_TOKEN', { infer: true })
  }
}
