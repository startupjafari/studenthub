import type { ReactNode } from 'react'

/**
 * Цветная плитка со значком слева от строки.
 *
 * Цвет здесь не украшение и не смысл: он служит опознавательным знаком строки. В списке
 * из восьми рычагов нужную ищут глазами по цвету и форме значка, а подпись дочитывают
 * уже найдя. Поэтому цвет за разделом закреплён навсегда и не зависит ни от состояния,
 * ни от темы — переехавший цвет заставил бы искать заново.
 *
 * Это единственное место в приложении со своими цветами (`--tint-*`); всё остальное
 * берётся из темы Telegram.
 */
export type TileTone =
  'red' | 'orange' | 'green' | 'teal' | 'blue' | 'indigo' | 'purple' | 'pink' | 'gray'

export function Tile({ tone, children }: { tone: TileTone; children: ReactNode }) {
  return (
    <span className={`tile tile-${tone}`} aria-hidden>
      {children}
    </span>
  )
}
