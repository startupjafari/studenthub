'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FolderPlus, Images, MoreHorizontal, Pencil, Star, Trash2, X } from 'lucide-react'
import type { Album } from '../../../entities/profile-content'
import { Button } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

export type AlbumFilter = 'all' | 'none' | string

// Полоса альбомов над сеткой фото: фильтр «Все / <альбомы> / Без альбома» + управление (владелец).
export function AlbumBar({
  albums,
  active,
  isOwner,
  onSelect,
  onCreate,
  onRenameActive,
  onDeleteActive,
}: {
  albums: Album[]
  active: AlbumFilter
  isOwner: boolean
  onSelect: (f: AlbumFilter) => void
  onCreate: () => void
  onRenameActive: () => void
  onDeleteActive: () => void
}) {
  const t = useTranslations('Profile')
  const chip = (f: AlbumFilter, label: string, count?: number) => (
    <button
      key={f}
      type="button"
      onClick={() => onSelect(f)}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
        active === f ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted',
      )}
    >
      {label}
      {count !== undefined && <span className="text-xs text-muted-foreground">{count}</span>}
    </button>
  )

  const activeIsAlbum = active !== 'all' && active !== 'none'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {chip('all', t('albumAll'))}
        {albums.map((a) => chip(a.id, a.title, a.count))}
        {chip('none', t('albumNone'))}
        {isOwner && (
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onCreate}>
            <FolderPlus className="size-4" aria-hidden />
            {t('albumCreate')}
          </Button>
        )}
      </div>
      {isOwner && activeIsAlbum && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={onRenameActive}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <Pencil className="size-3.5" aria-hidden />
            {t('albumRename')}
          </button>
          <button
            type="button"
            onClick={onDeleteActive}
            className="inline-flex items-center gap-1 hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden />
            {t('albumDelete')}
          </button>
        </div>
      )}
    </div>
  )
}

// Меню действий на фото (владелец): добавить в альбом / убрать / сделать обложкой / удалить.
export function PhotoAlbumMenu({
  albums,
  inAlbumId,
  activeAlbumId,
  onAssign,
  onRemove,
  onSetCover,
  onDelete,
}: {
  albums: Album[]
  inAlbumId: string | null
  activeAlbumId: string | null
  onAssign: (albumId: string) => void
  onRemove: () => void
  onSetCover: () => void
  onDelete: () => void
}) {
  const t = useTranslations('Profile')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const item =
    'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted'

  return (
    <div ref={ref} className="absolute left-1.5 top-1.5 z-10">
      <button
        type="button"
        aria-label={t('actions')}
        onClick={() => setOpen((o) => !o)}
        className="flex size-7 items-center justify-center rounded-lg bg-foreground/50 text-background opacity-0 backdrop-blur transition-opacity hover:bg-foreground/70 group-hover:opacity-100"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-8 z-20 max-h-64 w-52 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {activeAlbumId && inAlbumId === activeAlbumId && (
            <button
              type="button"
              className={item}
              onClick={() => {
                onSetCover()
                setOpen(false)
              }}
            >
              <Star className="size-4 text-muted-foreground" aria-hidden />
              {t('albumSetCover')}
            </button>
          )}
          {inAlbumId && (
            <button
              type="button"
              className={item}
              onClick={() => {
                onRemove()
                setOpen(false)
              }}
            >
              <X className="size-4 text-muted-foreground" aria-hidden />
              {t('albumRemovePhoto')}
            </button>
          )}
          {albums
            .filter((a) => a.id !== inAlbumId)
            .map((a) => (
              <button
                key={a.id}
                type="button"
                className={item}
                onClick={() => {
                  onAssign(a.id)
                  setOpen(false)
                }}
              >
                <Images className="size-4 text-muted-foreground" aria-hidden />
                <span className="truncate">{t('albumAddTo', { title: a.title })}</span>
              </button>
            ))}
          <button
            type="button"
            className={cn(item, 'text-destructive hover:bg-destructive/10')}
            onClick={() => {
              onDelete()
              setOpen(false)
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            {t('delete')}
          </button>
        </div>
      )}
    </div>
  )
}
