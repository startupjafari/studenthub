'use client'

import { useEffect, useState } from 'react'

// Водяной знак поверх видео камеры (docs/PROJECT.md §3.10): ФИО смотрящего и текущее
// время, повторённые по всему кадру. Запись экрана он не запрещает — запретить её нельзя, —
// но любой снимок или ролик несёт имя того, кто смотрел, и момент. Слой не ловит клики
// и не выделяется.
export function Watermark({ viewer }: { viewer: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const stamp = `${viewer} · ${now.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-3 place-items-center overflow-hidden select-none"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <span
          key={i}
          className="-rotate-[18deg] whitespace-nowrap text-[11px] font-medium text-white/35 [text-shadow:0_0_2px_rgba(0,0,0,0.6)] sm:text-xs"
        >
          {stamp}
        </span>
      ))}
    </div>
  )
}
