import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { Loader2 } from 'lucide-react'

import { cn } from 'shared/lib/utils'

// Кастомная современная кнопка (не дефолт shadcn): крупнее скругление (rounded-xl),
// мягкий «дышащий» фокус (ring-4 ring/20), тень+подъём у заливных, лёгкое нажатие.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-4 focus-visible:ring-ring/20 active:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline:
          'border border-input bg-background hover:border-ring/50 hover:bg-muted hover:text-foreground aria-expanded:bg-muted dark:bg-input/30 dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-muted hover:text-foreground aria-expanded:bg-muted',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20',
        link: 'text-primary underline-offset-4 transition-colors hover:text-primary/70 hover:underline',
      },
      size: {
        default: 'h-10 px-4',
        xs: "h-7 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-11 px-6 text-base',
        icon: 'size-10',
        'icon-xs': "size-7 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8',
        'icon-lg': 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    // Состояние обработки запроса: кнопка приглушённо-серая + Loader по центру (без текста).
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'
  // loading несовместим с asChild (Slot ждёт один дочерний элемент) — там игнорируем.
  const isLoading = loading && !asChild

  return (
    <Comp
      data-slot="button"
      className={cn(
        buttonVariants({ variant, size }),
        isLoading &&
          'pointer-events-none bg-muted text-muted-foreground hover:bg-muted disabled:opacity-70',
        className,
      )}
      disabled={asChild ? undefined : disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        // Ширину держит исходное содержимое: иначе кнопка схлопывается до кружка
        // и ряд кнопок дёргается на время запроса.
        <span className="grid place-items-center">
          <span className="invisible col-start-1 row-start-1 inline-flex items-center gap-2">
            {children}
          </span>
          <Loader2 className="col-start-1 row-start-1 size-4 animate-spin" aria-hidden />
        </span>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
