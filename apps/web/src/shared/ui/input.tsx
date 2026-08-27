import * as React from 'react'

import { cn } from 'shared/lib/utils'
import { FIELD_SIZE, type ControlSize } from './control-size'

function Input({
  className,
  type,
  size = 'lg',
  ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & { size?: ControlSize }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Кастомный современный инпут (не дефолт shadcn): крупнее скругление,
        // плавный hover и «дышащий» синий фокус. Высота — из общей шкалы контролов
        // (control-size.ts), поэтому поле и кнопка одного размера совпадают по высоте.
        'w-full min-w-0 rounded-xl border border-input bg-background py-2 transition-[color,box-shadow,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/70 hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/15 dark:bg-input/30 dark:disabled:bg-input/60',
        FIELD_SIZE[size],
        className,
      )}
      {...props}
    />
  )
}

export { Input }
