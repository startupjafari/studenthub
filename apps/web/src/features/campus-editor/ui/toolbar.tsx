'use client'

import type { ComponentType } from 'react'
import { useTranslations } from 'next-intl'
import {
  AppWindow,
  ArrowUpDown,
  BrickWall,
  ChevronsUp,
  DoorOpen,
  Hand,
  MousePointer2,
  Ruler,
  SquareDashed,
  Type,
} from 'lucide-react'
import { cn } from '../../../shared/lib'
import { useEditor, type EditorStore, type ToolId } from '../model/store'
import type { ToolController } from '../model/tools'

/** Инструменты и их клавиши (§12.4). Клавиши ловит редактор, здесь — только подписи. */
export const TOOLS: { id: ToolId; icon: ComponentType<{ className?: string }>; key: string }[] = [
  { id: 'select', icon: MousePointer2, key: 'V' },
  { id: 'wall', icon: BrickWall, key: 'W' },
  { id: 'room', icon: SquareDashed, key: 'R' },
  { id: 'door', icon: DoorOpen, key: 'D' },
  { id: 'window', icon: AppWindow, key: 'N' },
  { id: 'stairs', icon: ChevronsUp, key: 'S' },
  { id: 'elevator', icon: ArrowUpDown, key: 'E' },
  { id: 'label', icon: Type, key: 'T' },
  { id: 'measure', icon: Ruler, key: 'M' },
  { id: 'pan', icon: Hand, key: 'H' },
]

export function Toolbar({ store, tools }: { store: EditorStore; tools: ToolController }) {
  const t = useTranslations('CampusEditor')
  const active = useEditor(store, (s) => s.tool)
  const readonly = useEditor(store, (s) => s.saveState === 'readonly')
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t('tools')}
      className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-1 shadow-sm"
    >
      {TOOLS.map(({ id, icon: Icon, key }) => {
        const disabled = readonly && id !== 'select' && id !== 'pan' && id !== 'measure'
        return (
          <button
            key={id}
            type="button"
            disabled={disabled}
            aria-pressed={active === id}
            title={`${t(`tool_${id}`)} (${key})`}
            aria-label={t(`tool_${id}`)}
            onClick={() => {
              tools.cancel()
              store.set({ tool: id })
            }}
            // 44 px на тач-экранах, 36 px мышью (§12.11).
            className={cn(
              'flex size-11 items-center justify-center rounded-xl text-muted-foreground transition-colors md:size-9',
              'hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
              'focus-visible:ring-4 focus-visible:ring-ring/20 focus-visible:outline-none',
              active === id &&
                'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
            )}
          >
            <Icon className="size-5 md:size-4" />
          </button>
        )
      })}
    </div>
  )
}
