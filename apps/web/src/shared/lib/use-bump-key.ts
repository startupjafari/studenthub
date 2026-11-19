'use client'

import { useRef } from 'react'

/**
 * Ключ, который меняется, только когда число ВЫРОСЛО: бейдж с этим `key` перемонтируется и
 * заново проигрывает `sh-badge-pop` — новое уведомление или сообщение заметно глазом, а
 * прочтение (число убывает) бейдж не дёргает.
 */
export function useBumpKey(count: number): number {
  const prev = useRef(count)
  const bump = useRef(0)
  if (count > prev.current) bump.current += 1
  prev.current = count
  return bump.current
}
