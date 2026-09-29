import { useTranslations } from 'next-intl'

/**
 * Размер файла человеку: число + единица измерения.
 *
 * Разделено надвое сознательно. Само деление на 1024 — чистая арифметика и живёт здесь;
 * единица («МБ», «MB», «МБ» по-казахски) — текст интерфейса и обязана идти через i18n,
 * поэтому подставляет её вызывающий через {@link formatBytes}. До этого в проекте было
 * четыре своих форматтера подряд: три писали `MB` латиницей мимо перевода, четвёртый —
 * `МБ` хардкодом, и один и тот же файл в списке вложений и в панели чата выглядел
 * по-разному.
 */

export type ByteUnit = 'b' | 'kb' | 'mb' | 'gb'

export interface ByteSize {
  /** Округлённое значение в выбранной единице. */
  value: number
  unit: ByteUnit
}

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

/**
 * Подобрать единицу и округлить: байты целыми, килобайты целыми (десятые доли килобайта
 * никому не говорят ничего), мегабайты и гигабайты — до десятых.
 */
export function toByteSize(bytes: number): ByteSize {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  if (safe < KB) return { value: Math.round(safe), unit: 'b' }
  if (safe < MB) return { value: Math.round(safe / KB), unit: 'kb' }
  if (safe < GB) return { value: Math.round((safe / MB) * 10) / 10, unit: 'mb' }
  return { value: Math.round((safe / GB) * 10) / 10, unit: 'gb' }
}

/**
 * Собрать строку размера, взяв единицу у переводчика: `formatBytes(size, (u) => t(u))`,
 * где ключи лежат в `Common.byteUnit*`.
 */
export function formatBytes(bytes: number, unitLabel: (unit: ByteUnit) => string): string {
  const { value, unit } = toByteSize(bytes)
  return `${value} ${unitLabel(unit)}`
}

/**
 * Прогресс загрузки: `11.5 / 40.1 МБ`. Единица берётся по полному размеру и не скачет,
 * пока идут байты, — иначе на первых килобайтах строка показывала бы «КБ из МБ», а число
 * слева прыгало бы между единицами на каждом обновлении прогресса.
 */
export function formatBytesProgress(
  loaded: number,
  total: number,
  unitLabel: (unit: ByteUnit) => string,
): string {
  const { value, unit } = toByteSize(total)
  const divisor = { b: 1, kb: KB, mb: MB, gb: GB }[unit]
  const done = Math.round((Math.max(0, Math.min(loaded, total)) / divisor) * 10) / 10
  return `${unit === 'b' ? Math.round(done) : done} / ${value} ${unitLabel(unit)}`
}

/**
 * Подписи единиц текущей локали. Ключи перечислены явным `switch`, а не собраны из строки:
 * динамическая сборка ключа прячет его от проверки полноты словарей (FRONTEND_RULES §10).
 */
export function useByteUnitLabel(): (unit: ByteUnit) => string {
  const t = useTranslations('Common')
  return (unit) => {
    switch (unit) {
      case 'b':
        return t('byteUnitB')
      case 'kb':
        return t('byteUnitKb')
      case 'gb':
        return t('byteUnitGb')
      default:
        return t('byteUnitMb')
    }
  }
}
