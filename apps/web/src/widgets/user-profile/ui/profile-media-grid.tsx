'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  Check,
  FolderPlus,
  ImagePlus,
  Pencil,
  Play,
  Trash2,
  Video as VideoIcon,
  X,
} from 'lucide-react'
import {
  assignAlbumMedia,
  createAlbum,
  deleteAlbum,
  deleteProfileMedia,
  fetchAlbums,
  fetchProfileMedia,
  profileContentKeys,
  removeAlbumMedia,
  updateAlbum,
  uploadProfileMediaAuto,
  type ProfileMedia,
} from '../../../entities/profile-content'
import { Card, EmptyState, Skeleton, useConfirm } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { MediaLightbox } from './media-lightbox'
import { PhotoAlbumMenu, type AlbumFilter } from './album-controls'
import { ContentLayout, FilterGroup, FilterOption, FilterSkeleton } from './filter-sidebar'
import { useRetryOnError } from './use-retry-on-error'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

interface ProfileMediaGridProps {
  userId: string
  isOwner: boolean
  kind: 'PHOTO' | 'VIDEO'
  // Сигнал «открыть выбор файла» (из меню «+» в шапке профиля); nonce меняется при каждом вызове.
  openPicker?: number
  onConsumed?: () => void
}

export function ProfileMediaGrid({
  userId,
  isOwner,
  kind,
  openPicker,
  onConsumed,
}: ProfileMediaGridProps) {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (openPicker === undefined) return
    inputRef.current?.click()
    onConsumed?.()
  }, [openPicker])

  const q = useQuery({
    queryKey: profileContentKeys.media(userId),
    queryFn: () => fetchProfileMedia(userId),
  })
  // При ошибке — держим скелетон, тост каждые 5 сек и повтор запроса.
  useRetryOnError(q.isError, q.refetch, t('loadRetry'))
  const isPhoto = kind === 'PHOTO'
  const albumsQ = useQuery({
    queryKey: profileContentKeys.albums(userId),
    queryFn: () => fetchAlbums(userId),
    enabled: isPhoto,
  })
  const albums = albumsQ.data ?? []

  const [lightbox, setLightbox] = useState<number | null>(null)
  const [albumFilter, setAlbumFilter] = useState<AlbumFilter>('all')
  const [sort, setSort] = useState<'new' | 'old'>('new')
  // Инлайн-создание/переименование альбома: поле ввода в строке (крестик — отмена, галочка — сохранить).
  const [creatingAlbum, setCreatingAlbum] = useState(false)
  const [newAlbumTitle, setNewAlbumTitle] = useState('')
  const [editingAlbumId, setEditingAlbumId] = useState<string | null>(null)
  const [editAlbumTitle, setEditAlbumTitle] = useState('')

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: profileContentKeys.media(userId) })
    void qc.invalidateQueries({ queryKey: profileContentKeys.albums(userId) })
  }
  const albumErr = (e: unknown) => toast.error(tErr(errCode(e)))
  const createAlbumMut = useMutation({
    mutationFn: createAlbum,
    onSuccess: invalidateAll,
    onError: albumErr,
  })
  const deleteAlbumMut = useMutation({
    mutationFn: deleteAlbum,
    onSuccess: invalidateAll,
    onError: albumErr,
  })
  const renameAlbumMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => updateAlbum(id, { title }),
    onSuccess: invalidateAll,
    onError: albumErr,
  })
  const coverMut = useMutation({
    mutationFn: ({ id, coverFileId }: { id: string; coverFileId: string }) =>
      updateAlbum(id, { coverFileId }),
    onSuccess: invalidateAll,
    onError: albumErr,
  })
  const assignMut = useMutation({
    mutationFn: ({ albumId, fileId }: { albumId: string; fileId: string }) =>
      assignAlbumMedia(albumId, { fileIds: [fileId] }),
    onSuccess: invalidateAll,
    onError: albumErr,
  })
  const removeFromAlbumMut = useMutation({
    mutationFn: ({ albumId, fileId }: { albumId: string; fileId: string }) =>
      removeAlbumMedia(albumId, fileId),
    onSuccess: invalidateAll,
    onError: albumErr,
  })

  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadProfileMediaAuto(file),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileContentKeys.media(userId) })
      toast.success(t('mediaUploaded'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const delMut = useMutation({
    mutationFn: deleteProfileMedia,
    onSuccess: () => void qc.invalidateQueries({ queryKey: profileContentKeys.media(userId) }),
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const allItems = (q.data ?? []).filter((m) => m.type === kind)
  const filtered =
    isPhoto && albumFilter !== 'all'
      ? allItems.filter((m) =>
          albumFilter === 'none' ? m.albumId === null : m.albumId === albumFilter,
        )
      : allItems
  const items = [...filtered].sort((a, b) => {
    const d = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    return sort === 'new' ? d : -d
  })
  const activeAlbumId = albumFilter !== 'all' && albumFilter !== 'none' ? albumFilter : null

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadMut.mutate(file)
    e.target.value = ''
  }

  function confirmDelete(id: string): void {
    void confirm({ title: t('mediaDeleteConfirm'), destructive: true }).then((ok) => {
      if (ok) delMut.mutate(id)
    })
  }

  function openCreateAlbum(): void {
    setNewAlbumTitle('')
    setCreatingAlbum(true)
  }
  function cancelCreateAlbum(): void {
    setCreatingAlbum(false)
    setNewAlbumTitle('')
  }
  function submitCreateAlbum(): void {
    const title = newAlbumTitle.trim()
    if (!title) return
    createAlbumMut.mutate({ title })
    cancelCreateAlbum()
  }
  function openRenameAlbum(id: string, current: string): void {
    setEditingAlbumId(id)
    setEditAlbumTitle(current)
  }
  function cancelRenameAlbum(): void {
    setEditingAlbumId(null)
    setEditAlbumTitle('')
  }
  function submitRenameAlbum(): void {
    const id = editingAlbumId
    const title = editAlbumTitle.trim()
    if (!id || !title) return
    renameAlbumMut.mutate({ id, title })
    cancelRenameAlbum()
  }
  function handleDeleteAlbum(): void {
    if (!activeAlbumId) return
    void confirm({ title: t('albumDeleteConfirm'), destructive: true }).then((ok) => {
      if (ok) {
        deleteAlbumMut.mutate(activeAlbumId)
        setAlbumFilter('all')
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Загрузка — через меню «+» в шапке профиля (openPicker → этот скрытый input). */}
      {isOwner && (
        <input
          ref={inputRef}
          type="file"
          accept={isPhoto ? 'image/*' : 'video/*'}
          className="hidden"
          onChange={onPick}
        />
      )}

      {q.isLoading || q.isError ? (
        <ContentLayout sidebar={<FilterSkeleton groups={isPhoto ? 2 : 1} />}>
          <div
            className={cn(
              'grid gap-3',
              isPhoto
                ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
            )}
          >
            {Array.from({ length: isPhoto ? 24 : 9 }).map((_, i) => (
              <Skeleton
                key={i}
                className={cn('w-full rounded-xl', isPhoto ? 'aspect-square' : 'aspect-video')}
              />
            ))}
          </div>
        </ContentLayout>
      ) : allItems.length === 0 ? (
        <EmptyState
          icon={
            isPhoto ? (
              <ImagePlus className="size-6" aria-hidden />
            ) : (
              <VideoIcon className="size-6" aria-hidden />
            )
          }
          title={isPhoto ? t('noPhotos') : t('noVideos')}
          className="min-h-[calc(100dvh_-_20rem)]"
        />
      ) : (
        <ContentLayout
          sidebar={
            // Мобильный: «Альбомы» и «Сортировка» в один компактный ряд (flex-wrap, меньше отступы).
            // Десктоп (lg): прежняя вертикальная колонка.
            <div className="flex flex-wrap gap-x-8 gap-y-3 lg:flex-col lg:flex-nowrap lg:gap-4">
              {/* Альбомы (только фото) */}
              {isPhoto && (albums.length > 0 || isOwner) && (
                <FilterGroup
                  title={t('albums')}
                  action={
                    isOwner ? (
                      <button
                        type="button"
                        aria-label={t('albumCreate')}
                        onClick={openCreateAlbum}
                        className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <FolderPlus className="size-4" aria-hidden />
                      </button>
                    ) : undefined
                  }
                >
                  {creatingAlbum && (
                    <AlbumRowInput
                      value={newAlbumTitle}
                      onChange={setNewAlbumTitle}
                      onSubmit={submitCreateAlbum}
                      onCancel={cancelCreateAlbum}
                      placeholder={t('albumCreatePrompt')}
                      cancelLabel={t('cancel')}
                      saveLabel={t('save')}
                    />
                  )}
                  <FilterOption
                    active={albumFilter === 'all'}
                    onClick={() => setAlbumFilter('all')}
                    label={t('albumAll')}
                    count={allItems.length}
                  />
                  {albums.map((a) =>
                    editingAlbumId === a.id ? (
                      <AlbumRowInput
                        key={a.id}
                        value={editAlbumTitle}
                        onChange={setEditAlbumTitle}
                        onSubmit={submitRenameAlbum}
                        onCancel={cancelRenameAlbum}
                        placeholder={t('albumRenamePrompt')}
                        cancelLabel={t('cancel')}
                        saveLabel={t('save')}
                      />
                    ) : (
                      <FilterOption
                        key={a.id}
                        active={albumFilter === a.id}
                        onClick={() => setAlbumFilter(a.id)}
                        label={a.title}
                        count={a.count}
                        actions={
                          isOwner && albumFilter === a.id ? (
                            <>
                              <button
                                type="button"
                                aria-label={t('albumRename')}
                                onClick={() => openRenameAlbum(a.id, a.title)}
                                className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                              >
                                <Pencil className="size-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                aria-label={t('albumDelete')}
                                onClick={handleDeleteAlbum}
                                className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
                              >
                                <Trash2 className="size-3.5" aria-hidden />
                              </button>
                            </>
                          ) : undefined
                        }
                      />
                    ),
                  )}
                  <FilterOption
                    active={albumFilter === 'none'}
                    onClick={() => setAlbumFilter('none')}
                    label={t('albumNone')}
                    count={allItems.filter((m) => m.albumId === null).length}
                  />
                </FilterGroup>
              )}
              <FilterGroup title={t('sortBy')}>
                <FilterOption
                  active={sort === 'new'}
                  onClick={() => setSort('new')}
                  label={t('sortNew')}
                />
                <FilterOption
                  active={sort === 'old'}
                  onClick={() => setSort('old')}
                  label={t('sortOldest')}
                />
              </FilterGroup>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            {items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {t('albumEmpty')}
              </p>
            ) : isPhoto ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {items.map((m, i) => (
                  <Card key={m.id} className="group relative overflow-hidden p-0">
                    <button
                      type="button"
                      onClick={() => setLightbox(i)}
                      aria-label={t('tabPhotos')}
                      className="block w-full outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
                    >
                      {/* Внешний домен MinIO — next/image не оптимизирует, используем обычный img. */}
                      <img
                        src={m.url}
                        alt=""
                        className="aspect-square w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
                      />
                    </button>
                    {isOwner && (
                      <PhotoAlbumMenu
                        albums={albums}
                        inAlbumId={m.albumId}
                        activeAlbumId={activeAlbumId}
                        onAssign={(albumId) => assignMut.mutate({ albumId, fileId: m.id })}
                        onRemove={() =>
                          m.albumId &&
                          removeFromAlbumMut.mutate({ albumId: m.albumId, fileId: m.id })
                        }
                        onSetCover={() =>
                          activeAlbumId && coverMut.mutate({ id: activeAlbumId, coverFileId: m.id })
                        }
                        onDelete={() => confirmDelete(m.id)}
                      />
                    )}
                  </Card>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((m, i) => (
                  <VideoTile
                    key={m.id}
                    media={m}
                    label={t('tabVideos')}
                    onOpen={() => setLightbox(i)}
                    onDelete={isOwner ? () => confirmDelete(m.id) : undefined}
                    deleteLabel={t('delete')}
                  />
                ))}
              </div>
            )}

            {lightbox !== null && (
              <MediaLightbox
                items={items}
                index={lightbox}
                onClose={() => setLightbox(null)}
                onIndex={setLightbox}
              />
            )}
          </div>
        </ContentLayout>
      )}
    </div>
  )
}

// Строка ввода имени альбома (создание/переименование): поле + крестик (отмена) + галочка (сохранить).
function AlbumRowInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  cancelLabel,
  saveLabel,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
  placeholder: string
  cancelLabel: string
  saveLabel: string
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 px-1.5 py-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
          else if (e.key === 'Escape') onCancel()
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
      <button
        type="button"
        aria-label={cancelLabel}
        onClick={onCancel}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
      >
        <X className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={saveLabel}
        onClick={onSubmit}
        disabled={!value.trim()}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-primary transition-colors hover:bg-background disabled:opacity-40"
      >
        <Check className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute right-1.5 top-1.5 z-10 flex size-7 items-center justify-center rounded-lg bg-foreground/50 text-background opacity-0 backdrop-blur transition-opacity hover:bg-destructive group-hover:opacity-100"
    >
      <Trash2 className="size-3.5" aria-hidden />
    </button>
  )
}

// Карточка видео: широкая (16:9), кнопка воспроизведения и длительность (из метаданных).
function VideoTile({
  media,
  label,
  onOpen,
  onDelete,
  deleteLabel,
}: {
  media: ProfileMedia
  label: string
  onOpen: () => void
  onDelete?: () => void
  deleteLabel: string
}) {
  const [duration, setDuration] = useState<number | null>(null)
  return (
    <Card className="group relative overflow-hidden p-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={label}
        className="relative block w-full outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
      >
        <video
          src={media.url}
          muted
          preload="metadata"
          poster={media.posterUrl ?? undefined}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          className="aspect-video w-full bg-neutral-900 object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/15 transition-colors group-hover:bg-black/30">
          <span className="flex size-11 items-center justify-center rounded-full bg-white/90 text-foreground">
            <Play className="size-5 fill-current" aria-hidden />
          </span>
        </span>
        {duration !== null && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
            {formatDuration(duration)}
          </span>
        )}
      </button>
      {onDelete && <DeleteButton label={deleteLabel} onClick={onDelete} />}
    </Card>
  )
}
