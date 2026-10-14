import type { Vacancy } from '../../../entities/vacancy'

// Вилка зарплаты строкой: «100 000 — 200 000 KZT», «от 100 000», «до 200 000».
// Общая для строки витрины и карточки вакансии.
export function salaryText(
  vacancy: Vacancy,
  labels: { from: string; to: string },
  locale: string,
): string | null {
  const { salaryMin: min, salaryMax: max, salaryCurrency: currency } = vacancy
  if (min == null && max == null) return null
  const unit = currency ?? ''
  const fmt = (n: number) => n.toLocaleString(locale)
  if (min != null && max != null) return `${fmt(min)} — ${fmt(max)} ${unit}`.trim()
  if (min != null) return `${labels.from} ${fmt(min)} ${unit}`.trim()
  return `${labels.to} ${fmt(max as number)} ${unit}`.trim()
}
