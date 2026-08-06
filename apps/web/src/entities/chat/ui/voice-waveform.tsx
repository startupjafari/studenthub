'use client'

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { cn } from '../../../shared/lib/utils'

const BAR_STEP = 5 // 3px полоса + 2px промежуток

// Живая визуализация громкости записи (Ф9+): бегущие полосы по данным AnalyserNode.
// Число полос вычисляется по ширине контейнера (ResizeObserver) — волна занимает всю доступную ширину.
// Высоты обновляются через DOM напрямую на каждом кадре (без ре-рендера). На паузе — замирает.
export function VoiceWaveform({
  analyserRef,
  paused,
  className,
}: {
  analyserRef: MutableRefObject<AnalyserNode | null>
  paused: boolean
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(48)
  const countRef = useRef(48)
  countRef.current = count
  const barsRef = useRef<(HTMLSpanElement | null)[]>([])
  const heightsRef = useRef<number[]>(new Array(48).fill(0.04))
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  // Число полос по ширине контейнера.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const n = Math.max(8, Math.floor(el.clientWidth / BAR_STEP))
      setCount(n)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    heightsRef.current = new Array(count).fill(0.04)
  }, [count])

  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const analyser = analyserRef.current
      const n = countRef.current
      if (analyser && !pausedRef.current) {
        const buf = new Uint8Array(analyser.fftSize)
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = ((buf[i] ?? 128) - 128) / 128
          sum += v * v
        }
        const level = Math.max(0.04, Math.min(1, Math.sqrt(sum / buf.length) * 3.2))
        const h = heightsRef.current
        if (h.length !== n) {
          heightsRef.current = new Array(n).fill(0.04)
        } else {
          h.shift()
          h.push(level)
        }
        for (let i = 0; i < n; i++) {
          const bar = barsRef.current[i]
          if (bar) bar.style.height = `${Math.round((heightsRef.current[i] ?? 0.04) * 100)}%`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [analyserRef])

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex h-6 min-w-0 flex-1 items-center justify-between gap-[2px] overflow-hidden',
        className,
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el
          }}
          className="w-[3px] shrink-0 rounded-full bg-primary/70"
          style={{ height: '4%' }}
        />
      ))}
    </div>
  )
}
