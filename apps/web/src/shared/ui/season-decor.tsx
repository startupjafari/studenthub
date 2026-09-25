'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { localId } from '../lib/local-id'

/**
 * Праздничные частицы: редкий медленный «снег» цветом сезонного акцента.
 *
 * Включается только вручную в настройках и играет один раз в день праздника
 * (shared/lib/season.ts) — постоянное движение на рабочем экране утомляет быстрее,
 * чем успевает порадовать.
 *
 * Монтируется лениво и снимает себя сам: после последней частицы возвращает `null`,
 * чтобы в дереве не осталось полусотни узлов с `will-change` до конца сессии.
 */

const PARTICLE_COUNT = 40

/** Самая долгая частица (задержка + падение) — по ней считается время жизни слоя. */
const MAX_DELAY_S = 2.5
const MIN_FALL_S = 4
const MAX_FALL_S = 7

interface Particle {
  id: string
  left: number
  size: number
  delay: number
  duration: number
  drift: number
  opacity: number
}

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    id: localId('particle'),
    left: Math.random() * 100,
    size: 4 + Math.random() * 5,
    delay: Math.random() * MAX_DELAY_S,
    duration: MIN_FALL_S + Math.random() * (MAX_FALL_S - MIN_FALL_S),
    // Горизонтальный снос в обе стороны: строго вертикальное падение выглядит как дождь.
    drift: (Math.random() * 2 - 1) * 80,
    opacity: 0.3 + Math.random() * 0.35,
  }))
}

export function SeasonDecor() {
  // Случайные значения считаются один раз и на клиенте: компонент монтируется лениво,
  // на сервере его нет, поэтому расхождения гидрации здесь возникнуть не может.
  const particles = useMemo(makeParticles, [])
  const [alive, setAlive] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setAlive(false), (MAX_DELAY_S + MAX_FALL_S) * 1000)
    return () => clearTimeout(timer)
  }, [])

  if (!alive) return null

  return (
    // z-30 — внутристраничный слой по шкале §5.3: частицы идут поверх карточек, но под
    // нижней навигацией и модалками. Нового слоя праздник не заводит.
    // aria-hidden + pointer-events-none: украшение не должно ни попадать в скринридер,
    // ни перехватывать нажатия.
    <div aria-hidden className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {particles.map((p) => (
        <span
          key={p.id}
          className="sh-season-particle absolute top-0 rounded-full bg-primary"
          style={
            {
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              '--sh-drift': `${p.drift}px`,
              '--sh-particle-opacity': p.opacity,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
