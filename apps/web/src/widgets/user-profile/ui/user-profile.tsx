'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { Button, Card, CardContent, CardHeader, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { AccountSettingsPanels } from '../../account-settings'
import {
  fetchMe,
  removeAvatarRequest,
  updateProfileRequest,
  uploadAvatarRequest,
  userKeys,
} from '../../../entities/user'
import { SECTIONS, sectionVisible } from './sections'
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
import { AvatarCropModal } from './avatar-crop-modal'
import { PhotoCreateModal, VideoCreateModal } from './profile-create-modals'
import { ArticleEditorModal } from './article-editor-modal'
import { PollCreateModal } from './poll-create-modal'
import { PostCreateModal } from './post-create-modal'
import { ShareProfileButton } from './share-profile-button'

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

  const editSections = useMemo(
    () => (me.data ? SECTIONS.filter((s) => sectionVisible(s.when, me.data.role)) : []),
    [me.data],
  )

  if (me.isLoading) return <ProfileSkeleton />
  if (me.isError || !me.data)
    return (
      <div className="w-full">
        <p className="text-destructive">{tErr('INTERNAL_ERROR')}</p>
      </div>
    )

  const u = me.data

  return (
    <div className="flex w-full flex-col gap-5">
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
          <ProfileBody data={u} />
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
  const fileRef = useRef<HTMLInputElement>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)

  const uploadMut = useMutation({
    mutationFn: (f: File) => uploadAvatarRequest(f),
    onSuccess: (data) => {
      qc.setQueryData(userKeys.me(), data)
      setCropFile(null)
      toast.success(t('avatarUpdated'))
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

  return (
    <Card className={`overflow-hidden p-0 ${ENTER}`}>
      {/* Обложка — декоративный градиент бренда. Компактная на мобильном/планшете, полная — на десктопе (lg). */}
      <div className="h-14 w-full bg-gradient-to-br from-primary via-indigo-500 to-violet-500 sm:h-20 lg:h-44" />

      <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-end sm:gap-5 sm:px-6">
        {/* Аватар: смена фото (пикер → кроп), удаление, статус (вверху справа), меню «+» (внизу справа) */}
        <div className="relative -mt-10 shrink-0 sm:-mt-12 lg:-mt-16">
          <div className="group relative size-20 sm:size-24 lg:size-32">
            {me.avatarUrl ? (
              <Image
                src={me.avatarUrl}
                alt={fullNameOf(me)}
                width={128}
                height={128}
                unoptimized
                className="size-full rounded-full border-4 border-background object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center rounded-full border-4 border-background bg-primary text-2xl font-semibold text-primary-foreground lg:text-3xl">
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
                onClick={() => window.confirm(t('avatarRemove')) && removeAvatarMut.mutate()}
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

        <div className="flex shrink-0 items-center gap-2 self-start sm:self-end">
          <ShareProfileButton userId={me.id} name={fullNameOf(me)} />
          <Button
            type="button"
            variant={editing ? 'ghost' : 'default'}
            size="sm"
            onClick={onToggleEdit}
            className="transition-transform duration-300 ease-out hover:scale-[1.02] motion-reduce:transform-none"
          >
            {editing ? (
              <X className="size-4" aria-hidden />
            ) : (
              <Pencil className="size-4" aria-hidden />
            )}
            {editing ? t('cancel') : t('editProfile')}
          </Button>
          {editing && (
            <Button
              type="submit"
              form={PROFILE_EDIT_FORM_ID}
              size="sm"
              loading={saving}
              className="transition-transform duration-300 ease-out hover:scale-[1.02] motion-reduce:transform-none"
            >
              <Check className="size-4" aria-hidden />
              {t('save')}
            </Button>
          )}
        </div>
      </div>

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          saving={uploadMut.isPending}
          onCancel={() => setCropFile(null)}
          onSave={(f) => uploadMut.mutate(f)}
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Открытие по наведению: cancelClose держит меню, пока курсор на кнопке ИЛИ на меню;
  // scheduleClose закрывает с задержкой, чтобы успеть перейти через зазор к списку.
  const cancelClose = (): void => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const openNow = (): void => {
    cancelClose()
    setOpen(true)
  }
  const scheduleClose = (): void => {
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
    // Тап вне (тач-устройства, где нет hover) закрывает меню.
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
    const onScroll = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
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
            variant === 'sheet' ? 'gap-3 px-3 py-3 text-base' : 'gap-2.5 px-2.5 py-2 text-sm',
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
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={btnRef}
        type="button"
        aria-label={t('addContent')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={openNow}
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
                className="fixed inset-0 z-[90] bg-foreground/40 animate-in fade-in-0 duration-150"
              />
              <div
                ref={sheetRef}
                role="menu"
                className="fixed inset-x-0 bottom-0 z-[91] rounded-t-2xl border-t border-border bg-popover p-2 pb-6 text-popover-foreground animate-in slide-in-from-bottom duration-200"
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
                onMouseEnter={cancelClose}
                onMouseLeave={scheduleClose}
                style={{ top: pos.top, left: pos.left }}
                className="fixed z-[91] hidden w-52 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground animate-in fade-in-0 zoom-in-95 duration-150 md:block"
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
    <div className="flex w-full flex-col gap-5">
      {/* Шапка: обложка + аватар + имя/подпись/мета + действия */}
      <Card className="overflow-hidden p-0">
        <Skeleton className={cn('h-14 w-full rounded-none sm:h-20 lg:h-44', SK)} />
        <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-end sm:gap-5 sm:px-6">
          <Skeleton
            className={cn(
              '-mt-10 size-20 shrink-0 rounded-full border-4 border-background sm:-mt-12 sm:size-24 lg:-mt-16 lg:size-32',
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
      <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Левая колонка: контакты + чипы */}
        <div className="flex flex-col gap-5">
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
        <div className="flex flex-col gap-5">
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
