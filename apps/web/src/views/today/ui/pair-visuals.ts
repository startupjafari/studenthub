import type { PairState } from '../lib/schedule-day'

// Единый визуальный язык состояний пары (тот же, что в schedule-grid): цветная
// левая полоса + мягкая заливка. Никаких хардкод-цветов вне токенов/chart-палитры.
export const PAIR_ACCENT: Record<PairState, string> = {
  now: 'border-l-primary bg-primary/[0.07]',
  normal: 'border-l-border bg-card',
  past: 'border-l-border bg-muted/40',
  cancelled: 'border-l-destructive bg-destructive/[0.06]',
  moved: 'border-l-warning bg-warning/[0.08]',
  room: 'border-l-warning bg-warning/[0.08]',
  substituted: 'border-l-info bg-info/[0.08]',
}

// Вариант Badge для состояния (см. shared/ui/badge).
export const PAIR_BADGE: Record<
  PairState,
  'default' | 'secondary' | 'success' | 'info' | 'warning' | 'destructive' | 'outline'
> = {
  now: 'default',
  normal: 'outline',
  past: 'secondary',
  cancelled: 'destructive',
  moved: 'warning',
  room: 'warning',
  substituted: 'info',
}

// i18n-ключ подписи состояния в namespace Today (Today.state.*).
export const PAIR_STATE_KEY: Record<PairState, string> = {
  now: 'state.now',
  normal: 'state.scheduled',
  past: 'state.past',
  cancelled: 'state.cancelled',
  moved: 'state.moved',
  room: 'state.roomChanged',
  substituted: 'state.substituted',
}
