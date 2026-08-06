import * as React from 'react'

import { cn } from 'shared/lib/utils'

// Системная textarea в стиле Input: то же скругление, границы, hover и «дышащий»
// синий фокус. Высота задаётся через rows/className, не мешая ресайзу.
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-20 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 py-2.5 text-base transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground/70 hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/15 md:text-sm dark:bg-input/30 dark:disabled:bg-input/60',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
