'use client'

import { useEffect, useRef, useState } from 'react'
import { useChartTheme } from '../../../shared/ui/chart'

// Спарклайн плитки: инлайновый SVG, а не полотно графика — для 14 точек без осей
// и подписей полотно и регистрация контроллеров не нужны.
// Линия в приглушённом тоне, последняя точка — акцентом (контракт stat tile).
//
// Анимация: линия «прорисовывается» слева направо через stroke-dashoffset,
// точка появляется после. Это CSS-переход, то есть работает на композиторе
// и не даёт перерисовок React; при prefers-reduced-motion выключается.

const VIEW_WIDTH = 100
const VIEW_HEIGHT = 28

export function Sparkline({
  values,
  ariaLabel,
  className,
}: {
  values: number[]
  ariaLabel: string
  className?: string
}) {
  const { palette } = useChartTheme()
  const [drawn, setDrawn] = useState(false)
  const path = useRef<SVGPolylineElement | null>(null)
  const [length, setLength] = useState(0)

  // Длину линии считаем после монтирования: до вставки в DOM getTotalLength
  // недоступен, а без неё dashoffset задать нечем.
  useEffect(() => {
    const node = path.current
    if (!node) return
    setLength(node.getTotalLength?.() ?? 0)
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [values])

  if (values.length < 2) return null

  const max = Math.max(...values)
  const min = Math.min(...values)
  // Плоский ряд (все значения равны) рисуем по центру, иначе делили бы на ноль.
  const span = max - min || 1
  const stepX = VIEW_WIDTH / (values.length - 1)
  const y = (v: number): number => VIEW_HEIGHT - 2 - ((v - min) / span) * (VIEW_HEIGHT - 4)
  const points = values.map((v, i) => `${i * stepX},${y(v)}`).join(' ')
  const lastY = y(values[values.length - 1] ?? 0)

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      className={className}
    >
      <polyline
        ref={path}
        points={points}
        fill="none"
        stroke={palette.muted}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
        style={
          length ? { strokeDasharray: length, strokeDashoffset: drawn ? 0 : length } : undefined
        }
      />
      {/* Кольцо цветом поверхности: точка остаётся читаемой поверх линии. */}
      <circle
        cx={VIEW_WIDTH - 2}
        cy={lastY}
        r={3}
        fill={palette.series[0]}
        stroke={palette.surface}
        strokeWidth={2}
        className="transition-opacity delay-500 duration-300 motion-reduce:transition-none"
        style={{ opacity: drawn ? 1 : 0 }}
      />
    </svg>
  )
}
