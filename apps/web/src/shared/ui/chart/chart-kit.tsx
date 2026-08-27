'use client'

import { useLocale } from 'next-intl'
import { useMemo } from 'react'
import type { TooltipContentProps } from 'recharts'
import type { ChartPalette } from './palette'

// Общая часть графиков: подсказка и оформление осей. Держим её отдельно, чтобы три
// полотна не расходились в мелочах, и внутри `charts/` — здесь всё, что тянет
// recharts, а он попадает в приложение только динамическим импортом.

/** Отступы полотна: слева ноль — ширину под подписи запрашивает сама ось Y. */
export const CHART_MARGIN = { top: 4, right: 8, bottom: 0, left: 0 } as const

/** Длительность анимации входа и перехода между периодами. */
export const ANIMATION_MS = 300

/**
 * Оформление оси. Подписи — нейтральным `axis`, без линии оси и засечек: сетка по
 * Y уже задаёт уровни, вторая линия рядом с ней ничего не добавляет.
 */
export function axisProps(palette: ChartPalette) {
  return {
    tick: { fill: palette.axis, fontSize: 11 },
    tickLine: false,
    axisLine: false,
  } as const
}

type TooltipItem = TooltipContentProps['payload'][number]

export type ChartTooltipProps = Pick<TooltipContentProps, 'active' | 'payload' | 'label'> & {
  /** Показать сумму по корзине — осмысленно для стека («часть-целое»). */
  total?: boolean
  totalLabel?: string
  /**
   * Цветной ключ перед значением. У графика с одной серией он не различает ничего:
   * подпись корзины уже названа сверху, и ключ остаётся лишним пятном.
   */
  marker?: boolean
}

/**
 * Подсказка под курсором. Это обычная разметка, а не часть полотна,
 * поэтому цвета берутся токенами темы (§12: текст графика — нейтральными токенами,
 * а не цветом данных), а не строками палитры. Значение ведёт, подпись следует.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  total,
  totalLabel,
  marker = true,
}: ChartTooltipProps) {
  const locale = useLocale()
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale])

  if (!active || !payload?.length) return null
  const items = payload.filter((item) => item.value !== null && item.value !== undefined)
  if (!items.length) return null

  const sum = items.reduce((acc, item) => acc + numeric(item.value), 0)

  return (
    <div className="pointer-events-none min-w-32 rounded-xl border border-border bg-popover/95 px-3 py-2 shadow-lg">
      {label !== undefined && (
        <p className="mb-1.5 text-[0.6875rem] text-muted-foreground">{String(label)}</p>
      )}
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={String(item.dataKey)} className="flex items-center gap-2 text-xs">
            {marker && (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color ?? item.stroke ?? item.fill }}
              />
            )}
            <span className="font-semibold tabular-nums text-foreground">
              {nf.format(numeric(item.value))}
            </span>
            {/* Recharts подставляет в `name` имя поля данных, если серии его не задали —
                тогда в подсказке появлялось техническое «value». Такую подпись не
                показываем: у одиночной серии её роль уже играет заголовок подсказки. */}
            {item.name !== undefined && item.name !== item.dataKey && (
              <span className="text-muted-foreground">{String(item.name)}</span>
            )}
          </li>
        ))}
        {total && items.length > 1 && (
          <li className="mt-1 flex items-center gap-2 border-t border-border pt-1 text-xs">
            {marker && <span className="size-2 shrink-0" aria-hidden />}
            <span className="font-semibold tabular-nums text-foreground">{nf.format(sum)}</span>
            <span className="text-muted-foreground">{totalLabel}</span>
          </li>
        )}
      </ul>
    </div>
  )
}

/** Значение из payload: recharts отдаёт число, строку или диапазон. */
function numeric(value: TooltipItem['value']): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value) || 0
  if (Array.isArray(value)) return numeric(value[value.length - 1])
  return 0
}
