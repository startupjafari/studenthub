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
import {
  EmptyState,
  MediaImage,
  MosaicGrid,
  MosaicTile,
  Skeleton,
  mosaicShape,
  useConfirm,
} from '../../../shared/ui'
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

// Ширина плитки в раскладке — по ней браузер берёт копию нужного размера: высокая и широкая
// плитки вдвое крупнее квадрата по одной из сторон, им нужна копия побольше.
function tileSizes(index: number): string {
  return mosaicShape(index) === 'square'
    ? '(max-width: 640px) 33vw, 360px'
    : '(max-width: 640px) 66vw, 720px'
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
    isPhoto && albumFilter !== 'all' ? allItems.filter((m) => m.albumId === albumFilter) : allItems
  const items = [...filtered].sort((a, b) => {
    const d = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    return sort === 'new' ? d : -d
  })
  const activeAlbumId = albumFilter !== 'all' ? albumFilter : null

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
          <MosaicGrid aria-hidden>
            {Array.from({ length: 14 }).map((_, i) => (
              <MosaicTile key={i} index={i}>
                <Skeleton className="size-full rounded-none" />
              </MosaicTile>
            ))}
          </MosaicGrid>
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
          <div className="flex flex-1 flex-col gap-4">
            {items.length === 0 ? (
              <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {t('albumEmpty')}
              </p>
            ) : isPhoto ? (
              <MosaicGrid>
                {items.map((m, i) => (
                  <MosaicTile key={m.id} index={i}>
                    <button
                      type="button"
                      onClick={() => setLightbox(i)}
                      aria-label={t('tabPhotos')}
                      className="block size-full outline-none focus-visible:ring-4 focus-visible:ring-ring/20 focus-visible:ring-inset"
                    >
                      {/* Внешний домен MinIO — next/image не оптимизирует. Плитка берёт копию
                          своей ширины (медиа-система), а заглушка видна до прихода байтов. */}
                      <MediaImage
                        src={m.url}
                        media={m}
                        alt=""
                        sizes={tileSizes(i)}
                        className="size-full"
                        imgClassName="transition-transform duration-300 ease-out group-hover/tile:scale-105"
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
                  </MosaicTile>
                ))}
              </MosaicGrid>
            ) : (
              <MosaicGrid>
                {items.map((m, i) => (
                  <VideoTile
                    key={m.id}
                    index={i}
                    media={m}
                    label={t('tabVideos')}
                    onOpen={() => setLightbox(i)}
                    onDelete={isOwner ? () => confirmDelete(m.id) : undefined}
                    deleteLabel={t('delete')}
                  />
                ))}
              </MosaicGrid>
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
    <div className="flex min-w-0 items-center gap-0.5 rounded-lg bg-muted/60 px-1.5 py-1">
      {/* w-0 + flex-1: у поля своя ширина «на 20 знаков», и без обнуления оно не
          ужималось под узкую колонку фильтров. */}
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
          else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        placeholder={placeholder}
        className="w-0 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
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
      className="absolute right-1.5 top-1.5 z-10 flex size-7 items-center justify-center rounded-lg bg-foreground/50 text-background opacity-0 backdrop-blur transition-opacity hover:bg-destructive focus-visible:opacity-100 group-hover/tile:opacity-100"
    >
      <Trash2 className="size-3.5" aria-hidden />
    </button>
  )
}

// Плитка видео в мозаике: постер во всю плитку, длительность внизу (из медиа-системы или метаданных).
function VideoTile({
  index,
  media,
  label,
  onOpen,
  onDelete,
  deleteLabel,
}: {
  index: number
  media: ProfileMedia
  label: string
  onOpen: () => void
  onDelete?: () => void
  deleteLabel: string
}) {
  const [measured, setMeasured] = useState<number | null>(null)
  // Длительность — с сервера (медиа-система), иначе из метаданных самого ролика.
  const duration = media.durationMs ? media.durationMs / 1000 : measured
  // Постер — картинка: плитке не нужно тянуть начало ролика ради первого кадра.
  const poster = media.posterUrl ?? media.poster?.at(-1)?.url
  return (
    <MosaicTile index={index}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={label}
        className="relative block size-full outline-none focus-visible:ring-4 focus-visible:ring-ring/20 focus-visible:ring-inset"
      >
        {poster ? (
          <MediaImage
            src={poster}
            // Выбранная владельцем обложка — одна картинка; кадр воркера — набор копий.
            media={
              media.posterUrl
                ? { placeholder: media.placeholder }
                : { ...media, sources: media.poster }
            }
            alt=""
            sizes={tileSizes(index)}
            className="size-full bg-neutral-900"
            imgClassName="transition-transform duration-300 ease-out group-hover/tile:scale-105"
          />
        ) : (
          <video
            src={media.url}
            muted
            preload="metadata"
            onLoadedMetadata={(e) => setMeasured(e.currentTarget.duration)}
            className="size-full bg-neutral-900 object-cover"
          />
        )}
        {/* Как в Reels: подпись внизу на затемнении (читается на любом кадре), кнопка
            воспроизведения — по наведению, чтобы мозаика не пестрела кружками. Цвет значка —
            постоянный тёмный: кружок белый в обеих темах, и «▶» цвета текста сливался бы с ним. */}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/tile:bg-black/25">
          <span className="flex size-11 items-center justify-center rounded-full bg-white/90 text-neutral-900 opacity-0 transition-opacity group-hover/tile:opacity-100">
            <Play className="size-5 translate-x-0.5 fill-current" aria-hidden />
          </span>
        </span>
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-6 pb-2 text-xs font-medium text-white">
          <Play className="size-3.5 shrink-0 fill-current" aria-hidden />
          {duration !== null && <span className="tabular-nums">{formatDuration(duration)}</span>}
        </span>
      </button>
      {onDelete && <DeleteButton label={deleteLabel} onClick={onDelete} />}
    </MosaicTile>
  )
}
