// Модель находки UI-аудита и накопитель. Один тип на весь прогон: и браузерные проверки,
// и слушатели консоли/сети, и падения навигации кладут сюда одинаковые записи — иначе отчёт
// приходится собирать из трёх разных форматов, а классификация разъезжается.

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

/**
 * Категории. Держим закрытым списком, чтобы в отчёте не появилось три написания одного и того же.
 *
 * nav       — экран не открылся вовсе (таймаут, редирект не туда)
 * overflow  — страница шире окна
 * clipped   — содержимое обрезано контейнером без возможности прокрутки
 * touch     — цель нажатия меньше нормы на тач-ширине
 * typography— нечитаемо мелкий текст
 * a11y      — доступность: имена, подписи, alt, дубли id, иерархия заголовков
 * console   — ошибки и предупреждения в консоли браузера
 * network   — неуспешные запросы
 * visual    — расхождение с эталоном (только при UI_AUDIT_VISUAL=1)
 */
export type Category =
  | 'nav'
  | 'overflow'
  | 'clipped'
  | 'touch'
  | 'typography'
  | 'a11y'
  | 'console'
  | 'network'
  | 'visual'

export interface Finding {
  severity: Severity
  category: Category
  /** Зона (роль), от лица которой открывали экран. */
  zone: string
  route: string
  /** Ширина, на которой видно. Пусто — находка от ширины не зависит. */
  viewport?: string
  message: string
  /** Короткий CSS-путь до виновника — с него начинается поиск компонента в коде. */
  selector?: string
  /** Кусок разметки: по нему компонент ищется грепом, когда селектор слишком общий. */
  snippet?: string
}

/** Сколько находок отброшено сверх потолка — по категориям. Молча резать нельзя. */
export type Truncated = Record<string, number>

export interface ZoneResult {
  zone: string
  /** Маршруты, которые реально открывали. */
  checked: string[]
  /** Маршрут → причина пропуска. */
  skipped: Record<string, string>
  /** Зона не проверялась целиком (не вошла в бюджет входов, нет аккаунта) — причина. */
  unavailable?: string
}

export class FindingCollector {
  private readonly items: Finding[] = []
  private readonly zones: ZoneResult[] = []
  readonly truncated: Truncated = {}
  /**
   * 429 от throttler'а — не дефект интерфейса, а след самого аудита: он открывает сотни
   * страниц подряд, а API ограничен 100 запросами в минуту с IP. Считаем отдельно и
   * показываем как предупреждение о прогоне, чтобы не выдавать за сетевые ошибки продукта.
   */
  throttled = 0

  add(finding: Finding): void {
    this.items.push(finding)
  }

  addMany(findings: Finding[]): void {
    for (const f of findings) this.items.push(f)
  }

  noteTruncated(category: string, count: number): void {
    if (count <= 0) return
    this.truncated[category] = (this.truncated[category] ?? 0) + count
  }

  addZone(result: ZoneResult): void {
    this.zones.push(result)
  }

  all(): Finding[] {
    return [...this.items].sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        a.route.localeCompare(b.route) ||
        a.category.localeCompare(b.category),
    )
  }

  zoneResults(): ZoneResult[] {
    return this.zones
  }

  countBySeverity(): Record<Severity, number> {
    const counts: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
    for (const f of this.items) counts[f.severity] += 1
    return counts
  }

  blocking(): Finding[] {
    return this.items.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
  }
}
