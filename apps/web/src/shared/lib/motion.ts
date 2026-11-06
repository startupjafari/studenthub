// Токены движения для JS: инлайн-переходы, таймеры размонтирования, анимации на rAF.
// Значения — те же, что `--motion-*` в app/globals.css (DESIGN_SYSTEM §7); меняются вместе.
// Жесты сюда не относятся: у них пружина `spring.ts`, а не длительность (§7.1).

export const MOTION = {
  /** Быстрый старт, мягкая остановка — для всех обычных взаимодействий. */
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
  micro: 120,
  control: 150,
  menu: 180,
  exit: 150,
  page: 200,
  modal: 220,
  panel: 260,
  large: 320,
} as const

const STAGGER_STEP_MS = 40
const STAGGER_MAX_MS = 160

/**
 * Задержка входа элемента волны (плитки дашборда). Шаг короткий и с потолком: длинный
 * каскад заставляет ждать контент, который уже пришёл, — восьмая плитка при шаге 70 мс
 * появлялась почти через полсекунды.
 */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(index, 0) * STAGGER_STEP_MS, STAGGER_MAX_MS)
}
