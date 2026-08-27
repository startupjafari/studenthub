'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  BarChart3,
  Camera,
  Check,
  FileText,
  Image as ImageIcon,
  Newspaper,
  Pencil,
  Plus,
  Trash2,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { MeResponse } from '../../../shared/api'
import { Button, Card, CardContent, CardHeader, Skeleton, useConfirm } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { BRAND_GRADIENT } from '../../../shared/config'
import { useSheetDragClose } from '../../../shared/lib'
import { AccountSettingsPanels } from '../../account-settings'
import { FILE_UPLOAD } from '@studenthub/shared-config'
import {
  fetchMe,
  removeAvatarRequest,
  removeCoverRequest,
  updateProfileRequest,
  uploadAvatarRequest,
  uploadCoverRequest,
  userKeys,
} from '../../../entities/user'
import { visibleSections } from './sections'
import { ProfileEditForm, PROFILE_EDIT_FORM_ID } from './profile-edit-form'
import {
  ENTER,
  ProfileBody,
  ProfileIdentity,
  StatusDot,
  fullNameOf,
  initialsOf,
} from './profile-content'
import { ProfileTabs, type ProfileTabId } from './profile-tabs'
import { ProfileCompletion } from './profile-completion'
import { ShareProfileButton } from './share-profile-button'

// Тяжёлые модалки (кроппер аватара на canvas, редактор статей с markdown, создание
// поста/фото/видео/опроса) грузятся динамически — только при открытии, а не на каждом
// просмотре профиля. Раньше все они тянулись в First Load JS профиля (~0.5 МБ).
const ImageCropModal = dynamic(
  () => import('../../../shared/ui/image-crop-modal').then((m) => m.ImageCropModal),
  { ssr: false },
)
const PhotoCreateModal = dynamic(
  () => import('./profile-create-modals').then((m) => m.PhotoCreateModal),
  { ssr: false },
)
const VideoCreateModal = dynamic(
  () => import('./profile-create-modals').then((m) => m.VideoCreateModal),
  { ssr: false },
)
const ArticleEditorModal = dynamic(
  () => import('./article-editor-modal').then((m) => m.ArticleEditorModal),
  { ssr: false },
)
const PollCreateModal = dynamic(
  () => import('./poll-create-modal').then((m) => m.PollCreateModal),
  { ssr: false },
)
const PostCreateModal = dynamic(
  () => import('./post-create-modal').then((m) => m.PostCreateModal),
  { ssr: false },
)

type CreateKind = 'post' | 'photo' | 'video' | 'article' | 'poll'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

export function UserProfile() {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState<ProfileTabId>('profile')
  const [createModal, setCreateModal] = useState<CreateKind | null>(null)

  const updateMut = useMutation({
    mutationFn: updateProfileRequest,
    onSuccess: (data) => {
      qc.setQueryData(userKeys.me(), data)
      setEditing(false)
      toast.success(t('saved'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const editSections = useMemo(() => (me.data ? visibleSections(me.data.role) : []), [me.data])

  if (me.isLoading) return <ProfileSkeleton />
  if (me.isError || !me.data)
    return (
      <div className="w-full">
        <p className="text-destructive">{tErr('INTERNAL_ERROR')}</p>
      </div>
    )

  const u = me.data

  return (
    <div className="flex w-full flex-col gap-4">
      <ProfileTabs
        userId={u.id}
        isOwner
        tab={tab}
        onTabChange={setTab}
        locked={editing}
        settings={<AccountSettingsPanels />}
        stickyTop={
          <ProfileHeader
            me={u}
            editing={editing}
            saving={updateMut.isPending}
            onToggleEdit={() => {
              // Редактирование доступно только на «Профиль»; входя в режим — переключаемся туда.
              setEditing((v) => !v)
              setTab('profile')
            }}
            onQuickCreate={setCreateModal}
          />
        }
      >
        {editing ? (
          <ProfileEditForm
            me={u}
            sections={editSections}
            onSave={(payload) => updateMut.mutate(payload)}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <ProfileCompletion
              data={u as unknown as Record<string, unknown>}
              role={u.role}
              onEdit={() => {
                setEditing(true)
                setTab('profile')
              }}
            />
            <ProfileBody data={u} />
          </div>
        )}
      </ProfileTabs>

      {createModal === 'post' && <PostCreateModal onClose={() => setCreateModal(null)} />}
      {createModal === 'photo' && (
        <PhotoCreateModal userId={u.id} onClose={() => setCreateModal(null)} />
      )}
      {createModal === 'video' && (
        <VideoCreateModal userId={u.id} onClose={() => setCreateModal(null)} />
      )}
      {createModal === 'article' && (
        <ArticleEditorModal userId={u.id} onClose={() => setCreateModal(null)} />
      )}
      {createModal === 'poll' && (
        <PollCreateModal userId={u.id} onClose={() => setCreateModal(null)} />
      )}
    </div>
  )
}

// Кадр обложки: широкая полоса 3:1. Точную высоту шапки задаёт CSS (h-20/h-28/h-52 при
// разной ширине экрана), поэтому кроп даёт запас по вертикали, а не подгоняется под один
// брейкпоинт — остальное дорезает `object-cover`.
const COVER_ASPECT = 3
const COVER_WIDTH = 1500

// ── Шапка своего профиля: обложка + аватар (со сменой фото) + действия ──────
function ProfileHeader({
  me,
  editing,
  saving,
  onToggleEdit,
  onQuickCreate,
}: {
  me: MeResponse
  editing: boolean
  saving: boolean
  onToggleEdit: () => void
  onQuickCreate: (kind: CreateKind) => void
}) {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [coverCropFile, setCoverCropFile] = useState<File | null>(null)

  const uploadMut = useMutation({
    mutationFn: (f: File) => uploadAvatarRequest(f),
    onSuccess: (data) => {
      qc.setQueryData(userKeys.me(), data)
      setCropFile(null)
      toast.success(t('avatarUpdated'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const uploadCoverMut = useMutation({
    mutationFn: (f: File) => uploadCoverRequest(f),
    onSuccess: (data) => {
      qc.setQueryData(userKeys.me(), data)
      setCoverCropFile(null)
      toast.success(t('coverUpdated'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const removeCoverMut = useMutation({
    mutationFn: removeCoverRequest,
    onSuccess: (data) => {
      qc.setQueryData(userKeys.me(), data)
      toast.success(t('coverRemoved'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const removeAvatarMut = useMutation({
    mutationFn: removeAvatarRequest,
    onSuccess: (data) => {
      qc.setQueryData(userKeys.me(), data)
      toast.success(t('avatarRemoved'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) setCropFile(f)
    e.target.value = ''
  }

  // Обложка кадрируется перед отправкой. Клиентская проверка типа/размера — до открытия
  // кропа (§7): нет смысла разбирать в canvas файл, который сервер всё равно отвергнет.
  function onPickCover(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) {
      toast.error(tErr('FILE_TYPE_NOT_ALLOWED'))
      return
    }
    if (f.size > FILE_UPLOAD.MAX_BYTES.IMAGE) {
      toast.error(tErr('FILE_TOO_LARGE'))
      return
    }
    setCoverCropFile(f)
  }

  return (
    <Card className={`relative overflow-hidden p-0 ${ENTER}`}>
      {/* Действия — над обложкой справа (Telegram/VK-стиль): поделиться + редактировать/сохранить. */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2 sm:top-4 sm:right-4">
        <ShareProfileButton userId={me.id} name={fullNameOf(me)} className="shadow-md" />
        <Button
          type="button"
          variant={editing ? 'secondary' : 'default'}
          size="sm"
          onClick={onToggleEdit}
          aria-label={editing ? t('cancel') : t('editProfile')}
          className="shadow-md transition-transform duration-300 ease-out hover:scale-[1.02] motion-reduce:transform-none"
        >
          {editing ? (
            <X className="size-4" aria-hidden />
          ) : (
            <Pencil className="size-4" aria-hidden />
          )}
          <span className="hidden sm:inline">{editing ? t('cancel') : t('editProfile')}</span>
        </Button>
        {editing && (
          <Button
            type="submit"
            form={PROFILE_EDIT_FORM_ID}
            size="sm"
            loading={saving}
            aria-label={t('save')}
            className="shadow-md transition-transform duration-300 ease-out hover:scale-[1.02] motion-reduce:transform-none"
          >
            <Check className="size-4" aria-hidden />
            <span className="hidden sm:inline">{t('save')}</span>
          </Button>
        )}
      </div>

      {/* Обложка: своё изображение или декоративный градиент бренда. Смена/удаление — по ховеру
          (владелец). Компактная на мобильном/планшете, крупнее — на десктопе (lg). */}
      <div className="group/cover relative h-20 w-full overflow-hidden sm:h-28 lg:h-52">
        {me.coverUrl ? (
          <Image src={me.coverUrl} alt="" fill unoptimized sizes="100vw" className="object-cover" />
        ) : (
          <div className={cn('size-full', BRAND_GRADIENT)} />
        )}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2 sm:top-4 sm:left-4">
          <button
            type="button"
            onClick={() => coverRef.current?.click()}
            aria-label={me.coverUrl ? t('coverChange') : t('coverAdd')}
            disabled={uploadCoverMut.isPending}
            className="flex items-center gap-1.5 rounded-lg bg-foreground/55 px-2.5 py-1.5 text-xs font-medium text-background opacity-0 shadow-md outline-none transition-opacity duration-300 ease-out hover:bg-foreground/70 focus-visible:opacity-100 group-hover/cover:opacity-100 disabled:opacity-60 motion-reduce:transition-none max-sm:opacity-100"
          >
            <Camera className="size-4" aria-hidden />
            <span className="hidden sm:inline">
              {me.coverUrl ? t('coverChange') : t('coverAdd')}
            </span>
          </button>
          {me.coverUrl && (
            <button
              type="button"
              aria-label={t('coverRemove')}
              disabled={removeCoverMut.isPending}
              onClick={() => {
                void confirm({ title: t('coverRemove'), destructive: true }).then(
                  (ok) => ok && removeCoverMut.mutate(),
                )
              }}
              className="flex size-8 items-center justify-center rounded-lg bg-foreground/55 text-background opacity-0 shadow-md outline-none transition-opacity duration-300 ease-out hover:bg-destructive focus-visible:opacity-100 group-hover/cover:opacity-100 disabled:opacity-60 motion-reduce:transition-none max-sm:opacity-100"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          )}
        </div>
        <input
          ref={coverRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPickCover}
        />
      </div>

      <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-end sm:gap-4 sm:px-6">
        {/* Аватар: смена фото (пикер → кроп), удаление, статус (вверху справа), меню «+» (внизу справа).
            self-start в колоночной раскладке (моб.) — иначе контейнер растягивается на всю ширину
            (align-items: stretch) и «+» (left-85%) уезжает вправо; на sm+ (ряд) — обычное выравнивание. */}
        <div className="relative -mt-12 shrink-0 self-start sm:-mt-14 sm:self-auto lg:-mt-20">
          <div className="group relative size-24 sm:size-28 lg:size-36">
            {me.avatarUrl ? (
              <Image
                src={me.avatarThumbUrl ?? me.avatarUrl}
                alt={fullNameOf(me)}
                width={128}
                height={128}
                unoptimized
                className="size-full rounded-full border-4 border-background object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center rounded-full border-4 border-background bg-primary text-3xl font-semibold text-primary-foreground lg:text-4xl">
                {initialsOf(me) || '#'}
              </div>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label={t('avatarChange')}
              className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-full bg-foreground/55 text-xs font-medium text-background opacity-0 outline-none transition-opacity duration-300 ease-out group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
            >
              <Camera className="size-5" aria-hidden />
              {t('avatarChange')}
            </button>
            {me.avatarUrl && (
              <button
                type="button"
                aria-label={t('avatarRemove')}
                onClick={() => {
                  void confirm({ title: t('avatarRemove'), destructive: true }).then(
                    (ok) => ok && removeAvatarMut.mutate(),
                  )
                }}
                className="absolute left-[15%] top-[15%] z-10 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background bg-card text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            )}
            {/* Статус — вверху справа, на кромке круга */}
            <span className="absolute left-[85%] top-[15%] z-10 -translate-x-1/2 -translate-y-1/2">
              <StatusDot online />
            </span>
          </div>
          {/* Меню «+» — внизу справа, вне group аватара (чтобы не триггерить оверлей) */}
          <AvatarCreateMenu onSelect={onQuickCreate} />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
        </div>

        <ProfileIdentity data={me} />
      </div>

      {cropFile && (
        <ImageCropModal
          file={cropFile}
          saving={uploadMut.isPending}
          onCancel={() => setCropFile(null)}
          onSave={(f) => uploadMut.mutate(f)}
        />
      )}

      {coverCropFile && (
        <ImageCropModal
          file={coverCropFile}
          // Обложка — широкая полоса, а не квадрат: кадрируем в 3:1 (COVER_ASPECT)
          // и отдаём 1500px по ширине, чтобы хватило на десктопную шапку профиля.
          aspect={COVER_ASPECT}
          outputWidth={COVER_WIDTH}
          shape="square"
          title={me.coverUrl ? t('coverChange') : t('coverAdd')}
          saving={uploadCoverMut.isPending}
          onCancel={() => setCoverCropFile(null)}
          onSave={(f) => uploadCoverMut.mutate(f)}
        />
      )}
    </Card>
  )
}

// ── Меню быстрого создания на аватаре («+» → Фото/Видео/Статья/Вопрос-ответ) ──
function AvatarCreateMenu({ onSelect }: { onSelect: (kind: CreateKind) => void }) {
  const t = useTranslations('Profile')
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  // Свайп-вниз закрывает нижний лист (общий хук). Один узел — на click-outside и на жест: объединяем refs.
  const dragRef = useSheetDragClose<HTMLDivElement>(() => setOpen(false))
  const setSheetRef = (node: HTMLDivElement | null): void => {
    sheetRef.current = node
    dragRef.current = node
  }
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = (): void => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  // Hover-открытие — ТОЛЬКО для мыши: на тач эмулируемый mouseleave закрывал лист сразу после тапа.
  // На тач меню открывается/закрывается кликом (toggle) — надёжно.
  const hoverOpen = (e: React.PointerEvent): void => {
    if (e.pointerType !== 'mouse') return
    cancelClose()
    setOpen(true)
  }
  const hoverClose = (e: React.PointerEvent): void => {
    if (e.pointerType !== 'mouse') return
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 160)
  }
  useEffect(() => cancelClose, [])

  // Меню рендерим в портал (шапка имеет overflow-hidden — иначе дропдаун обрезается).
  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 8, left: Math.min(r.left, window.innerWidth - 216) })
    }
    place()
    // Тап вне закрывает меню.
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        btnRef.current?.contains(target) ||
        menuRef.current?.contains(target) ||
        sheetRef.current?.contains(target)
      )
        return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Скроллом НЕ закрываем (иначе на мобильном лист «прыгает» при малейшем скролле); только репозиция.
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('resize', place)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const items: { target: CreateKind; label: string; icon: LucideIcon }[] = [
    { target: 'post', label: t('tabPosts'), icon: Newspaper },
    { target: 'photo', label: t('tabPhotos'), icon: ImageIcon },
    { target: 'video', label: t('tabVideos'), icon: Video },
    { target: 'article', label: t('tabArticles'), icon: FileText },
    { target: 'poll', label: t('tabPolls'), icon: BarChart3 },
  ]

  // Пункты меню; на мобильном (bottom-sheet) — крупнее для удобного тапа.
  const renderItems = (variant: 'dropdown' | 'sheet') =>
    items.map((it) => {
      const Icon = it.icon
      return (
        <button
          key={it.target}
          type="button"
          role="menuitem"
          onClick={() => {
            onSelect(it.target)
            setOpen(false)
          }}
          className={cn(
            'flex w-full items-center rounded-lg font-medium transition-colors hover:bg-muted',
            variant === 'sheet' ? 'gap-3 px-3 py-3 text-base' : 'gap-2 px-2.5 py-2 text-sm',
          )}
        >
          <Icon
            className={cn('shrink-0 text-primary', variant === 'sheet' ? 'size-5' : 'size-4')}
            aria-hidden
          />
          {it.label}
        </button>
      )
    })

  return (
    <div
      className="absolute left-[85%] top-[85%] z-20 -translate-x-1/2 -translate-y-1/2"
      onPointerEnter={hoverOpen}
      onPointerLeave={hoverClose}
    >
      <button
        ref={btnRef}
        type="button"
        aria-label={t('addContent')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground outline-none transition-transform hover:scale-105 focus-visible:ring-4 focus-visible:ring-ring/20 motion-reduce:transform-none lg:size-8"
      >
        <Plus className="size-3.5 lg:size-4" aria-hidden />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            {/* Мобильный: bottom-sheet снизу с подложкой и ручкой-хватом. */}
            <div className="md:hidden">
              <button
                type="button"
                aria-label={t('close')}
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-[190] bg-foreground/50 animate-in fade-in-0 duration-150"
              />
              <div
                ref={setSheetRef}
                role="menu"
                className="fixed inset-x-0 bottom-0 z-[190] rounded-t-2xl border-t border-border bg-popover p-2 pb-[calc(1rem+env(safe-area-inset-bottom))] text-popover-foreground animate-in slide-in-from-bottom duration-200"
              >
                <div
                  className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/30"
                  aria-hidden
                />
                {renderItems('sheet')}
              </div>
            </div>
            {/* Десктоп: прежний dropdown у кнопки «+». */}
            {pos && (
              <div
                ref={menuRef}
                role="menu"
                onPointerEnter={hoverOpen}
                onPointerLeave={hoverClose}
                style={{ top: pos.top, left: pos.left }}
                className="fixed z-[190] hidden w-52 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground animate-in fade-in-0 zoom-in-95 duration-150 md:block"
              >
                {renderItems('dropdown')}
              </div>
            )}
          </>,
          document.body,
        )}
    </div>
  )
}

// ── Скелетон загрузки ────────────────────────────────────────────────────────
// Скелетон повторяет реальную раскладку профиля: шапка (обложка+аватар+имя+кнопки),
// панель табов, две колонки (контакты/чипы слева, «О себе»/инфо справа). Чётче обычного.
const SK = 'bg-muted-foreground/15'

function SkelCardTitle() {
  return (
    <div className="flex items-center gap-2">
      <Skeleton className={cn('size-4 rounded', SK)} />
      <Skeleton className={cn('h-4 w-28', SK)} />
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div className="flex w-full flex-col gap-4">
      {/* Шапка: обложка + аватар + имя/подпись/мета + действия */}
      <Card className="overflow-hidden p-0">
        <Skeleton className={cn('h-20 w-full rounded-none sm:h-28 lg:h-52', SK)} />
        <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-end sm:gap-4 sm:px-6">
          <Skeleton
            className={cn(
              '-mt-12 size-24 shrink-0 rounded-full border-4 border-background sm:-mt-14 sm:size-28 lg:-mt-20 lg:size-36',
              SK,
            )}
          />
          <div className="flex flex-1 flex-col gap-2 pb-1">
            <Skeleton className={cn('h-7 w-64 max-w-full', SK)} />
            <Skeleton className={cn('h-4 w-40', SK)} />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Skeleton className={cn('h-6 w-20 rounded-full', SK)} />
              <Skeleton className={cn('h-4 w-52 max-w-full', SK)} />
              <Skeleton className={cn('h-4 w-36', SK)} />
            </div>
          </div>
          <div className="flex shrink-0 gap-2 self-start sm:self-end">
            <Skeleton className={cn('h-8 w-28 rounded-xl', SK)} />
            <Skeleton className={cn('h-8 w-44 rounded-xl', SK)} />
          </div>
        </div>
      </Card>

      {/* Панель табов */}
      <Skeleton className={cn('h-[52px] w-full rounded-xl', SK)} />

      {/* Тело: две колонки */}
      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Левая колонка: контакты + чипы */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <SkelCardTitle />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className={cn('size-8 shrink-0 rounded-lg', SK)} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Skeleton className={cn('h-3 w-16', SK)} />
                    <Skeleton className={cn('h-4 w-40 max-w-full', SK)} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SkelCardTitle />
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {[16, 12, 20, 14, 10, 18].map((w, i) => (
                <Skeleton
                  key={i}
                  className={cn('h-7 rounded-full', SK)}
                  style={{ width: `${w * 6}px` }}
                />
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Правая колонка: «О себе» + инфо-карточка */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <SkelCardTitle />
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Skeleton className={cn('h-4 w-full', SK)} />
              <Skeleton className={cn('h-4 w-full', SK)} />
              <Skeleton className={cn('h-4 w-11/12', SK)} />
              <Skeleton className={cn('h-4 w-4/5', SK)} />
            </CardContent>
          </Card>

          {/* Несколько инфо-секций (Учёба/Личное/…) — чтобы высота совпадала с загруженной и был скролл */}
          {Array.from({ length: 3 }).map((_, c) => (
            <Card key={c}>
              <CardHeader>
                <SkelCardTitle />
              </CardHeader>
              <CardContent>
                <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex flex-col gap-1.5">
                      <Skeleton className={cn('h-3 w-24', SK)} />
                      <Skeleton className={cn('h-4 w-32 max-w-full', SK)} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
