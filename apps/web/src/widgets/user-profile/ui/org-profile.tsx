'use client'

import { useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import {
  CalendarDays,
  Camera,
  Globe,
  Info,
  Instagram,
  Linkedin,
  Mail,
  Pencil,
  Phone,
  Send,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { FILE_UPLOAD } from '@studenthub/shared-config'
import { contentOwnerKey, type ContentOwner } from '../../../entities/profile-content'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { toApiError } from '../../../shared/lib'
import { BRAND_GRADIENT } from '../../../shared/config'
import { ContentOwnerProvider } from '../lib/content-owner'
import { useMediaQuota } from '../lib/media-quota'
import { ProfileTabs, type ProfileTabId } from './profile-tabs'
import { AvatarCreateMenu, CoverToolbar, coverActionsClass, type CreateKind } from './user-profile'
import { ENTER } from './profile-content'

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

// Обложка — как у профиля пользователя: широкая полоса 3:1, 1500px по ширине.
const COVER_ASPECT = 3
const COVER_WIDTH = 1500

export type OrgImageKind = 'logo' | 'cover'

/** Страница организации, чей контент на вкладках: компания или университет. */
export type OrgOwner = ContentOwner & { kind: 'company' | 'university' }

/** То, что шапка показывает об организации. */
export interface OrgHeaderData {
  name: string
  logoUrl: string | null
  coverUrl: string | null
  /** Иконка вместо логотипа, пока его нет. */
  icon: LucideIcon
  /** Пометка под названием: «Страница компании» / «Страница университета». */
  badge: ReactNode
  /** Строка мета-данных под названием: отрасль, город и т. п. */
  metas: { icon: LucideIcon; label: string }[]
}

interface OrgProfileProps {
  owner: OrgOwner
  toolbar?: ReactNode
  /** Страница ещё грузится (header нет) или упала с ошибкой. */
  header: OrgHeaderData | undefined
  error?: unknown
  onRetry: () => void
  notFound: { title: string; hint: string }
  /** Публикует от имени организации: меню «+», черновики и управление контентом. */
  canPublish: boolean
  /** Правит саму страницу: поля, логотип, обложку. */
  canEdit: boolean
  images: {
    upload: (kind: OrgImageKind, file: File) => Promise<unknown>
    remove: (kind: OrgImageKind) => Promise<void>
    onChanged: () => void
  }
  /** Подсказка публикующим: кто видит контент страницы. */
  visibilityHint: string
  body: ReactNode
  /** Форма правки страницы (submit — кнопкой «Сохранить» в шапке, по editFormId). */
  editForm: (onSaved: () => void) => ReactNode
  editFormId: string
}

/**
 * Страница организации в стиле профиля пользователя: обложка, логотип, вкладки «Профиль»,
 * «Посты», «Фото», «Видео», «Статьи», «Опросы». Вкладки контента — те же, что у профиля,
 * но владелец контента — организация (ContentOwnerProvider): списки её страницы, создание с
 * `?as=company|university`. Компания и университет — тонкие обёртки над этим каркасом.
 */
export function OrgProfile({
  owner,
  toolbar,
  header,
  error,
  onRetry,
  notFound,
  canPublish,
  canEdit,
  images,
  visibilityHint,
  body,
  editForm,
  editFormId,
}: OrgProfileProps) {
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')

  const [tab, setTab] = useState<ProfileTabId>('profile')
  const [editing, setEditing] = useState(false)
  const [createModal, setCreateModal] = useState<CreateKind | null>(null)
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const quota = useMediaQuota(contentOwnerKey(owner))

  if (error) {
    const code = toApiError(error).code
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        {toolbar}
        <EmptyState
          icon={<Info className="size-6" aria-hidden />}
          title={code === 'NOT_FOUND' ? notFound.title : tErr(code)}
          description={code === 'NOT_FOUND' ? notFound.hint : tErr('retryHint')}
          action={
            code === 'NOT_FOUND' ? undefined : (
              <Button variant="outline" onClick={onRetry}>
                {tCommon('retry')}
              </Button>
            )
          }
        />
      </div>
    )
  }
  if (!header) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        {toolbar}
        <OrgSkeleton />
      </div>
    )
  }

  const quickCreate = (kind: CreateKind): void => {
    if (kind === 'photo') photoInputRef.current?.click()
    else if (kind === 'video') videoInputRef.current?.click()
    else setCreateModal(kind)
  }
  const closeCreate = (): void => {
    setCreateModal(null)
    setPickedFile(null)
  }
  const onMediaPicked =
    (kind: 'photo' | 'video') =>
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const f = e.target.files?.[0]
      e.target.value = ''
      if (!f || !quota.fits(f)) return
      setPickedFile(f)
      setCreateModal(kind)
    }

  return (
    <ContentOwnerProvider owner={owner}>
      <div className="flex w-full flex-1 flex-col gap-4">
        <ProfileTabs
          userId={owner.id}
          isOwner={canPublish}
          tab={tab}
          onTabChange={setTab}
          locked={editing}
          stickyTop={
            <OrgHeader
              header={header}
              canPublish={canPublish}
              canEdit={canEdit}
              editing={editing}
              editFormId={editFormId}
              images={images}
              visibilityHint={visibilityHint}
              onToggleEdit={() => {
                setEditing((v) => !v)
                setTab('profile')
              }}
              onQuickCreate={quickCreate}
              toolbar={toolbar}
            />
          }
        >
          {editing && canEdit ? editForm(() => setEditing(false)) : body}
        </ProfileTabs>

        {canPublish && (
          <>
            {createModal === 'post' && <PostCreateModal onClose={closeCreate} />}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onMediaPicked('photo')}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={onMediaPicked('video')}
            />
            {createModal === 'photo' && pickedFile && (
              <PhotoCreateModal userId={owner.id} initialFile={pickedFile} onClose={closeCreate} />
            )}
            {createModal === 'video' && pickedFile && (
              <VideoCreateModal userId={owner.id} initialFile={pickedFile} onClose={closeCreate} />
            )}
            {createModal === 'article' && (
              <ArticleEditorModal userId={owner.id} onClose={closeCreate} />
            )}
            {createModal === 'poll' && <PollCreateModal userId={owner.id} onClose={closeCreate} />}
          </>
        )}
      </div>
    </ContentOwnerProvider>
  )
}

// ── Шапка: обложка, логотип, название, пометка страницы ──────────────────────
function OrgHeader({
  header,
  canPublish,
  canEdit,
  editing,
  editFormId,
  images,
  visibilityHint,
  onToggleEdit,
  onQuickCreate,
  toolbar,
}: {
  header: OrgHeaderData
  canPublish: boolean
  canEdit: boolean
  editing: boolean
  editFormId: string
  images: OrgProfileProps['images']
  visibilityHint: string
  onToggleEdit: () => void
  onQuickCreate: (kind: CreateKind) => void
  toolbar?: ReactNode
}) {
  const t = useTranslations('OrgPage')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const logoRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const [crop, setCrop] = useState<{ kind: OrgImageKind; file: File } | null>(null)
  const Icon = header.icon

  const uploadMut = useMutation({
    mutationFn: ({ kind, file }: { kind: OrgImageKind; file: File }) => images.upload(kind, file),
    onSuccess: (_r, { kind }) => {
      images.onChanged()
      setCrop(null)
      toast.success(kind === 'logo' ? t('logoUpdated') : t('coverUpdated'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })
  const removeMut = useMutation({
    mutationFn: (kind: OrgImageKind) => images.remove(kind),
    onSuccess: (_r, kind) => {
      images.onChanged()
      toast.success(kind === 'logo' ? t('logoRemoved') : t('coverRemoved'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  // Тип и размер — до кропа (FRONTEND_RULES §7): файл, который сервер отвергнет, не режем.
  const pick =
    (kind: OrgImageKind) =>
    (e: React.ChangeEvent<HTMLInputElement>): void => {
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
      setCrop({ kind, file: f })
    }

  const imageButton =
    'flex items-center gap-1.5 rounded-lg bg-foreground/55 px-2.5 py-1.5 text-xs font-medium text-background opacity-0 shadow-md outline-none transition-opacity duration-(--motion-micro) hover:bg-foreground/70 focus-visible:opacity-100 group-hover/cover:opacity-100 disabled:opacity-60 motion-reduce:transition-none max-sm:opacity-100'

  return (
    <Card className={cn('relative overflow-hidden p-0', ENTER)}>
      {toolbar && <CoverToolbar>{toolbar}</CoverToolbar>}
      {canEdit && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-2 sm:top-4 sm:right-4">
          <Button
            type="button"
            variant={editing ? 'secondary' : 'default'}
            size="sm"
            onClick={onToggleEdit}
            aria-label={editing ? t('cancel') : t('edit')}
            className="shadow-md"
          >
            {editing ? (
              <X className="size-4" aria-hidden />
            ) : (
              <Pencil className="size-4" aria-hidden />
            )}
            <span className="hidden sm:inline">{editing ? t('cancel') : t('edit')}</span>
          </Button>
          {editing && (
            <Button type="submit" form={editFormId} size="sm" className="shadow-md">
              {t('save')}
            </Button>
          )}
        </div>
      )}

      <div className="group/cover relative h-20 w-full overflow-hidden sm:h-28 lg:h-52">
        {header.coverUrl ? (
          <Image
            src={header.coverUrl}
            alt=""
            fill
            unoptimized
            sizes="100vw"
            className="object-cover"
          />
        ) : (
          <div className={cn('size-full', BRAND_GRADIENT)} />
        )}
        {canEdit && (
          <div className={coverActionsClass(!!toolbar)}>
            <button
              type="button"
              onClick={() => coverRef.current?.click()}
              aria-label={header.coverUrl ? t('coverChange') : t('coverAdd')}
              disabled={uploadMut.isPending}
              className={imageButton}
            >
              <Camera className="size-4" aria-hidden />
              <span className="hidden sm:inline">
                {header.coverUrl ? t('coverChange') : t('coverAdd')}
              </span>
            </button>
            {header.coverUrl && (
              <button
                type="button"
                aria-label={t('coverRemove')}
                disabled={removeMut.isPending}
                onClick={() => {
                  void confirm({ title: t('coverRemove'), destructive: true }).then(
                    (ok) => ok && removeMut.mutate('cover'),
                  )
                }}
                className={cn(imageButton, 'size-8 justify-center px-0 hover:bg-destructive')}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            )}
            <input
              ref={coverRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={pick('cover')}
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-end sm:gap-4 sm:px-6">
        <div className="relative -mt-12 shrink-0 self-start sm:-mt-14 sm:self-auto lg:-mt-20">
          <div className="group relative size-24 sm:size-28 lg:size-36">
            <Avatar className="size-full border-4 border-background">
              <AvatarImage src={header.logoUrl ?? undefined} alt={header.name} />
              <AvatarFallback className="bg-primary text-primary-foreground">
                <Icon className="size-10 lg:size-12" aria-hidden />
              </AvatarFallback>
            </Avatar>
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => logoRef.current?.click()}
                  aria-label={t('logoChange')}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-full bg-foreground/55 text-xs font-medium text-background opacity-0 outline-none transition-opacity duration-(--motion-micro) group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
                >
                  <Camera className="size-5" aria-hidden />
                  {t('logoChange')}
                </button>
                {header.logoUrl && (
                  <button
                    type="button"
                    aria-label={t('logoRemove')}
                    onClick={() => {
                      void confirm({ title: t('logoRemove'), destructive: true }).then(
                        (ok) => ok && removeMut.mutate('logo'),
                      )
                    }}
                    className="absolute left-[15%] top-[15%] z-10 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background bg-card text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                )}
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={pick('logo')}
                />
              </>
            )}
          </div>
          {canPublish && <AvatarCreateMenu onSelect={onQuickCreate} />}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-balance text-xl font-bold sm:text-2xl">{header.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            {header.badge}
            {header.metas.map((m) => (
              <span key={m.label} className="inline-flex items-center gap-1.5">
                <m.icon className="size-4 text-muted-foreground/70" aria-hidden />
                {m.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {canPublish && (
        <p className="flex items-start gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-6">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {visibilityHint}
        </p>
      )}

      {crop && (
        <ImageCropModal
          file={crop.file}
          aspect={crop.kind === 'cover' ? COVER_ASPECT : 1}
          outputWidth={crop.kind === 'cover' ? COVER_WIDTH : undefined}
          shape={crop.kind === 'cover' ? 'square' : 'circle'}
          title={crop.kind === 'cover' ? t('coverChange') : t('logoChange')}
          saving={uploadMut.isPending}
          onCancel={() => setCrop(null)}
          onSave={(file) => uploadMut.mutate({ kind: crop.kind, file })}
        />
      )}
    </Card>
  )
}

// ── Вкладка «Профиль»: общие карточки ─────────────────────────────────────────

/** Поля витрины, общие для компании и вуза (OrgPageFieldsShape в shared-schemas). */
export interface OrgPageFields {
  description: string | null
  website: string | null
  foundedYear: number | null
  contactEmail: string | null
  contactPhone: string | null
  address: string | null
  telegram: string | null
  instagram: string | null
  linkedin: string | null
  createdAt: string
}

/**
 * «О …», «Детали» и «Контакты». Детали — общие строки (год, адрес, на платформе) плюс свои
 * у организации (`details`, в начале списка).
 */
export function OrgBody({
  page,
  aboutTitle,
  details,
}: {
  page: OrgPageFields
  aboutTitle: string
  details: { icon: LucideIcon; label: string; value: string | null }[]
}) {
  const t = useTranslations('OrgPage')
  const locale = useLocale()

  const rows = [
    ...details,
    {
      icon: CalendarDays,
      label: t('fieldFounded'),
      value: page.foundedYear ? String(page.foundedYear) : null,
    },
    { icon: Info, label: t('fieldAddress'), value: page.address },
    {
      icon: CalendarDays,
      label: t('onPlatformSince'),
      value: new Date(page.createdAt).toLocaleDateString(locale),
    },
  ]

  const telegram = page.telegram
    ? page.telegram.startsWith('@')
      ? `https://t.me/${page.telegram.slice(1)}`
      : page.telegram
    : null
  const contacts: { icon: LucideIcon; label: string; value: string | null; href?: string }[] = [
    { icon: Globe, label: t('fieldWebsite'), value: page.website, href: page.website ?? undefined },
    {
      icon: Mail,
      label: t('fieldContactEmail'),
      value: page.contactEmail,
      href: page.contactEmail ? `mailto:${page.contactEmail}` : undefined,
    },
    {
      icon: Phone,
      label: t('fieldContactPhone'),
      value: page.contactPhone,
      href: page.contactPhone ? `tel:${page.contactPhone.replace(/[^\d+]/g, '')}` : undefined,
    },
    { icon: Send, label: 'Telegram', value: page.telegram, href: telegram ?? undefined },
    {
      icon: Instagram,
      label: 'Instagram',
      value: page.instagram,
      href: page.instagram ?? undefined,
    },
    { icon: Linkedin, label: 'LinkedIn', value: page.linkedin, href: page.linkedin ?? undefined },
  ]

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className={ENTER}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="size-4 text-primary" aria-hidden />
            {t('contacts')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3">
            {contacts.map((c) => (
              <li key={c.label} className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <c.icon className="size-4" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs text-muted-foreground">{c.label}</span>
                  {c.value ? (
                    c.href ? (
                      <a
                        href={c.href}
                        target={c.href.startsWith('http') ? '_blank' : undefined}
                        rel="noopener noreferrer"
                        className="truncate text-sm font-medium text-primary hover:underline"
                      >
                        {c.value}
                      </a>
                    ) : (
                      <span className="truncate text-sm font-medium">{c.value}</span>
                    )
                  ) : (
                    <span className="text-sm font-medium text-muted-foreground/60">
                      {t('noData')}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className={ENTER}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="size-4 text-primary" aria-hidden />
              {aboutTitle}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {page.description?.trim() ? (
              <p className="whitespace-pre-line break-words text-sm leading-relaxed">
                {page.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground/60">{t('noData')}</p>
            )}
          </CardContent>
        </Card>
        <Card className={ENTER}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="size-4 text-primary" aria-hidden />
              {t('details')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {rows.map((d) => (
                <div key={d.label} className="flex flex-col gap-0.5">
                  <dt className="text-xs text-muted-foreground">{d.label}</dt>
                  {d.value ? (
                    <dd className="break-words text-sm font-medium">{d.value}</dd>
                  ) : (
                    <dd className="text-sm font-medium text-muted-foreground/60">{t('noData')}</dd>
                  )}
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function OrgSkeleton() {
  return (
    <div className="flex w-full flex-col gap-4">
      <Card className="overflow-hidden p-0">
        <Skeleton className="h-20 w-full rounded-none sm:h-28 lg:h-52" />
        <div className="flex items-end gap-4 px-4 pb-4 sm:px-6">
          <Skeleton className="-mt-12 size-24 shrink-0 rounded-full border-4 border-background sm:-mt-14 sm:size-28 lg:-mt-20 lg:size-36" />
          <div className="flex flex-1 flex-col gap-2 pb-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
      </Card>
      <Skeleton className="h-11 w-full rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  )
}
