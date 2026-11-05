'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Search } from 'lucide-react'
import { ACADEMIC_SPACE_KINDS } from '@studenthub/campus-core'
import { SPACE_KIND_COLOR } from '../../../entities/campus'
import { Input } from '../../../shared/ui'
import { cn } from '../../../shared/lib'
import { useEditor, type EditorStore } from '../model/store'

/**
 * Помещения этажа списком (§12.8): поиск по номеру и названию, отметка «нет связи с
 * аудиторией» у учебных. Клик выделяет помещение и подводит к нему план.
 */
export function SpacesPanel({
  store,
  viewport,
}: {
  store: EditorStore
  viewport: () => { width: number; height: number }
}) {
  const t = useTranslations('CampusEditor')
  const spaces = useEditor(store, (s) => s.doc.spaces)
  const selected = useEditor(store, (s) => (s.selection.kind === 'space' ? s.selection.id : null))
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return Object.entries(spaces)
      .filter(
        ([, s]) => !needle || `${s.number ?? ''} ${s.name ?? ''}`.toLowerCase().includes(needle),
      )
      .sort(([, a], [, b]) =>
        (a.number ?? a.name ?? '').localeCompare(b.number ?? b.name ?? '', undefined, {
          numeric: true,
        }),
      )
  }, [spaces, q])

  const focus = (id: string): void => {
    const sp = store.getState().doc.spaces[id]
    store.set({ selection: { kind: 'space', id } })
    if (!sp) return
    const { width, height } = viewport()
    const k = Math.max(store.getState().view.scale, 0.04)
    store.set({
      view: { scale: k, ox: width / 2 - sp.label.x * k, oy: height / 2 + sp.label.y * k },
    })
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          size="md"
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchSpaces')}
          aria-label={t('searchSpaces')}
        />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noSpaces')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {rows.map(([id, s]) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => focus(id)}
                aria-current={selected === id}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted',
                  'focus-visible:ring-4 focus-visible:ring-ring/20 focus-visible:outline-none',
                  selected === id && 'bg-primary/10',
                )}
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: SPACE_KIND_COLOR[s.kind] }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium tabular-nums">{s.number || '—'}</span>
                  {s.name && <span className="text-muted-foreground"> · {s.name}</span>}
                </span>
                {ACADEMIC_SPACE_KINDS.includes(s.kind) && !s.roomId && (
                  <span className="shrink-0 text-xs text-destructive">{t('noRoomShort')}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
