import * as React from 'react'

import { cn } from 'shared/lib/utils'
import { AREA_SIZE, type ControlSize } from './control-size'

// Системная textarea в стиле Input: то же скругление, границы, hover и «дышащий»
// синий фокус. Размер из общей шкалы контролов задаёт минимальную высоту и отступы,
// дальше высота растёт по содержимому (rows/className), не мешая ресайзу.
function Textarea({
  className,
  size = 'md',
  ...props
}: React.ComponentProps<'textarea'> & { size?: ControlSize }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'w-full min-w-0 rounded-xl border border-input bg-background transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground/70 hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/15 dark:bg-input/30 dark:disabled:bg-input/60',
        AREA_SIZE[size],
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
