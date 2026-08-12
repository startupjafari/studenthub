'use client'

import * as React from 'react'
import { Tooltip as TooltipPrimitive } from 'radix-ui'

import { cn } from 'shared/lib/utils'

// Подсказка (radix-ui). Доступность иконочных кнопок и пояснения статусов
// (FRONTEND_RULES §9, задача 29). `TooltipProvider` монтируется один раз в
// providers; на странице используем Tooltip/TooltipTrigger/TooltipContent.
const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-[300] max-w-xs rounded-lg bg-foreground px-2.5 py-1.5 text-xs text-background data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
