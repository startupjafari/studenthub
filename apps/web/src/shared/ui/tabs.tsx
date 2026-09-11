'use client'

import * as React from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'

import { useScrollRow } from 'shared/lib/use-scroll-row'
import { cn } from 'shared/lib/utils'

// Единый Tabs (radix-ui) в визуальном языке StudentHub — том же, что у SegmentedTabs:
// видимая дорожка `bg-muted/50` и «приподнятая» активная вкладка `bg-background`.
// Вариант без дорожки (одна подсветка `bg-primary/10`) пробовали и откатили: на
// поверхности шапки `bg-sidebar` такие табы почти не читались.
// На мобильном список вкладок скроллится.
const Tabs = TabsPrimitive.Root

function TabsList({ className, style, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  // Длинный список вкладок тянется мышью, у краёв затухает и знает, что прокручивается
  // (shared/lib/use-scroll-row). На тач-экране прокрутка нативная.
  const row = useScrollRow<HTMLDivElement>()
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'inline-flex w-full items-center gap-1 overflow-x-auto rounded-2xl border border-border bg-muted/50 p-1 text-muted-foreground [scrollbar-width:none] sm:w-auto lg:rounded-xl [&::-webkit-scrollbar]:hidden',
        row.overflowing && 'cursor-grab',
        row.dragging && 'cursor-grabbing select-none',
        className,
      )}
      style={{ maskImage: row.fadeMask, WebkitMaskImage: row.fadeMask, ...style }}
      {...props}
      ref={row.ref}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm lg:min-h-8 lg:rounded-lg lg:px-3 font-medium whitespace-nowrap transition-[color,background-color] outline-none select-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:flex-none',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('mt-4 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
