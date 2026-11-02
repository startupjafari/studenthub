'use client'

import { useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import {
  Building2,
  CalendarDays,
  Camera,
  Factory,
  Globe,
  Info,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Send,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { FILE_UPLOAD } from '@studenthub/shared-config'
import type { CompanySize } from '@studenthub/shared-schemas'
import {
  companyKeys,
  fetchCompanyPage,
  fetchMyCompany,
  isCompanyOwner,
  removeCompanyImage,
  uploadCompanyImage,
  type CompanyImageKind,
  type CompanyPage,
} from '../../../entities/company'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
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
import { contentOwnerKey } from '../../../entities/profile-content'
import { ContentOwnerProvider } from '../lib/content-owner'
import { useMediaQuota } from '../lib/media-quota'
import { ProfileTabs, type ProfileTabId } from './profile-tabs'
import { AvatarCreateMenu, CoverToolbar, coverActionsClass, type CreateKind } from './user-profile'
import { CompanyEditForm, COMPANY_EDIT_FORM_ID } from './company-edit-form'
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

interface CompanyProfileProps {
  companyId: string
  /** Над шапкой — например, переключатель «Мой профиль / Компания» у работодателя. */
  toolbar?: ReactNode
}

/**
 * Страница компании в стиле профиля пользователя: обложка, логотип, вкладки «Профиль»,
 * «Посты», «Фото», «Видео», «Статьи», «Опросы». Вкладки контента — те же, что у профиля,
 * но владелец контента — компания (ContentOwnerProvider): списки её страницы, создание с
 * `?as=company`.
 *
 * Сотрудник публикует и распоряжается контентом; профиль компании (поля, логотип, обложку)
 * правит только владелец — как и прежнюю форму. Остальные (вузы с допуском) — читают.
 */
export function CompanyProfile({ companyId, toolbar }: CompanyProfileProps) {
  const t = useTranslations('Company')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')

  const page = useQuery({
    queryKey: companyKeys.page(companyId),
    queryFn: () => fetchCompanyPage(companyId),
  })
  const isMember = !!page.data?.isMember
  // Роль в компании — только у своей: правка профиля доступна владельцу.
  const mine = useQuery({
    queryKey: companyKeys.mine(),
    queryFn: fetchMyCompany,
    enabled: isMember,
  })
  const canEdit = isMember && isCompanyOwner(mine.data)

  const [tab, setTab] = useState<ProfileTabId>('profile')
  const [editing, setEditing] = useState(false)
  const [createModal, setCreateModal] = useState<CreateKind | null>(null)
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const quota = useMediaQuota(contentOwnerKey({ kind: 'company', id: companyId }))

  if (page.isError) {
    const code = toApiError(page.error).code
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        {toolbar}
        <EmptyState
          icon={<Building2 className="size-6" aria-hidden />}
          title={code === 'NOT_FOUND' ? t('notFound') : tErr(code)}
          description={code === 'NOT_FOUND' ? t('notFoundHint') : tErr('retryHint')}
          action={
            code === 'NOT_FOUND' ? undefined : (
              <Button variant="outline" onClick={() => void page.refetch()}>
                {tCommon('retry')}
              </Button>
            )
          }
        />
      </div>
    )
  }
  if (!page.data) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        {toolbar}
        <CompanySkeleton />
      </div>
    )
  }

  const company = page.data
  const owner = { kind: 'company' as const, id: companyId }

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
          userId={companyId}
          isOwner={isMember}
          tab={tab}
          onTabChange={setTab}
          locked={editing}
          stickyTop={
            <CompanyHeader
              company={company}
              isMember={isMember}
              canEdit={canEdit}
              editing={editing}
              onToggleEdit={() => {
                setEditing((v) => !v)
                setTab('profile')
              }}
              onQuickCreate={quickCreate}
              toolbar={toolbar}
            />
          }
        >
          {editing && mine.data ? (
            <CompanyEditForm company={mine.data} onSaved={() => setEditing(false)} />
          ) : (
            <CompanyBody company={company} />
          )}
        </ProfileTabs>

        {isMember && (
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
              <PhotoCreateModal userId={companyId} initialFile={pickedFile} onClose={closeCreate} />
            )}
            {createModal === 'video' && pickedFile && (
              <VideoCreateModal userId={companyId} initialFile={pickedFile} onClose={closeCreate} />
            )}
            {createModal === 'article' && (
              <ArticleEditorModal userId={companyId} onClose={closeCreate} />
            )}
            {createModal === 'poll' && <PollCreateModal userId={companyId} onClose={closeCreate} />}
          </>
        )}
      </div>
    </ContentOwnerProvider>
  )
}

// ── Шапка: обложка, логотип, название, пометка «Страница компании» ───────────
function CompanyHeader({
  company,
  isMember,
  canEdit,
  editing,
  onToggleEdit,
  onQuickCreate,
  toolbar,
}: {
  company: CompanyPage
  isMember: boolean
  canEdit: boolean
  editing: boolean
  onToggleEdit: () => void
  onQuickCreate: (kind: CreateKind) => void
  toolbar?: ReactNode
}) {
  const t = useTranslations('Company')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const logoRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const [crop, setCrop] = useState<{ kind: CompanyImageKind; file: File } | null>(null)

  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: companyKeys.page(company.id) })
    void qc.invalidateQueries({ queryKey: companyKeys.mine() })
  }
  const uploadMut = useMutation({
    mutationFn: ({ kind, file }: { kind: CompanyImageKind; file: File }) =>
      uploadCompanyImage(kind, file),
    onSuccess: (_r, { kind }) => {
      refresh()
      setCrop(null)
      toast.success(kind === 'logo' ? t('logoUpdated') : t('coverUpdated'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })
  const removeMut = useMutation({
    mutationFn: (kind: CompanyImageKind) => removeCompanyImage(kind),
    onSuccess: (_r, kind) => {
      refresh()
      toast.success(kind === 'logo' ? t('logoRemoved') : t('coverRemoved'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  // Тип и размер — до кропа (FRONTEND_RULES §7): файл, который сервер отвергнет, не режем.
  const pick =
    (kind: CompanyImageKind) =>
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
            <Button
              type="submit"
              form={COMPANY_EDIT_FORM_ID}
              size="sm"
              aria-label={t('save')}
              className="shadow-md"
            >
              <span>{t('save')}</span>
            </Button>
          )}
        </div>
      )}

      <div className="group/cover relative h-20 w-full overflow-hidden sm:h-28 lg:h-52">
        {company.coverUrl ? (
          <Image
            src={company.coverUrl}
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
              aria-label={company.coverUrl ? t('coverChange') : t('coverAdd')}
              disabled={uploadMut.isPending}
              className={imageButton}
            >
              <Camera className="size-4" aria-hidden />
              <span className="hidden sm:inline">
                {company.coverUrl ? t('coverChange') : t('coverAdd')}
              </span>
            </button>
            {company.coverUrl && (
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
              <AvatarImage src={company.logoUrl ?? undefined} alt={company.name} />
              <AvatarFallback className="bg-primary text-primary-foreground">
                <Building2 className="size-10 lg:size-12" aria-hidden />
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
                {company.logoUrl && (
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
          {/* Публикует любой сотрудник — меню «+» есть у всех, кто в компании. */}
          {isMember && <AvatarCreateMenu onSelect={onQuickCreate} />}
        </div>

        <CompanyIdentity company={company} />
      </div>

      {isMember && (
        <p className="flex items-start gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-6">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('visibilityHint')}
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

function CompanyIdentity({ company }: { company: CompanyPage }) {
  const t = useTranslations('Company')
  const sizeLabel = useCompanySizeLabel()
  return (
    <div className="min-w-0 flex-1">
      <h1 className="truncate text-balance text-xl font-bold sm:text-2xl">{company.name}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        {/* Пометка: это страница компании, а не профиль человека. */}
        <Badge variant="info">
          <Building2 className="size-3" aria-hidden />
          {t('pageBadge')}
        </Badge>
        {company.industry && (
          <span className="inline-flex items-center gap-1.5">
            <Factory className="size-4 text-muted-foreground/70" aria-hidden />
            {company.industry}
          </span>
        )}
        {company.city && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4 text-muted-foreground/70" aria-hidden />
            {company.city}
          </span>
        )}
        {company.size && (
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-4 text-muted-foreground/70" aria-hidden />
            {sizeLabel(company.size)}
          </span>
        )}
      </div>
    </div>
  )
}

/** Подпись численности — явной картой, без сборки ключа из значения (FRONTEND_RULES §10). */
function useCompanySizeLabel(): (size: CompanySize) => string {
  const t = useTranslations('Company')
  const labels: Record<CompanySize, string> = {
    '1_10': t('size1to10'),
    '11_50': t('size11to50'),
    '51_200': t('size51to200'),
    '201_1000': t('size201to1000'),
    '1000_PLUS': t('size1000plus'),
  }
  return (size) => labels[size]
}

// ── Вкладка «Профиль»: о компании, детали, контакты ──────────────────────────
function CompanyBody({ company }: { company: CompanyPage }) {
  const t = useTranslations('Company')
  const sizeLabel = useCompanySizeLabel()
  const locale = useLocale()

  const details: { icon: LucideIcon; label: string; value: string | null }[] = [
    { icon: Factory, label: t('fieldIndustry'), value: company.industry },
    { icon: Users, label: t('fieldSize'), value: company.size ? sizeLabel(company.size) : null },
    {
      icon: CalendarDays,
      label: t('fieldFounded'),
      value: company.foundedYear ? String(company.foundedYear) : null,
    },
    { icon: MapPin, label: t('fieldCity'), value: company.city },
    { icon: Building2, label: t('fieldAddress'), value: company.address },
    {
      icon: CalendarDays,
      label: t('onPlatformSince'),
      value: new Date(company.createdAt).toLocaleDateString(locale),
    },
  ]

  const telegram = company.telegram
    ? company.telegram.startsWith('@')
      ? `https://t.me/${company.telegram.slice(1)}`
      : company.telegram
    : null
  const contacts: { icon: LucideIcon; label: string; value: string | null; href?: string }[] = [
    {
      icon: Globe,
      label: t('fieldWebsite'),
      value: company.website,
      href: company.website ?? undefined,
    },
    {
      icon: Mail,
      label: t('fieldContactEmail'),
      value: company.contactEmail,
      href: company.contactEmail ? `mailto:${company.contactEmail}` : undefined,
    },
    {
      icon: Phone,
      label: t('fieldContactPhone'),
      value: company.contactPhone,
      href: company.contactPhone ? `tel:${company.contactPhone.replace(/[^\d+]/g, '')}` : undefined,
    },
    { icon: Send, label: 'Telegram', value: company.telegram, href: telegram ?? undefined },
    {
      icon: Instagram,
      label: 'Instagram',
      value: company.instagram,
      href: company.instagram ?? undefined,
    },
    {
      icon: Linkedin,
      label: 'LinkedIn',
      value: company.linkedin,
      href: company.linkedin ?? undefined,
    },
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
            {contacts.map((c) => {
              const Icon = c.icon
              return (
                <li key={c.label} className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="size-4" aria-hidden />
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
              )
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className={ENTER}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="size-4 text-primary" aria-hidden />
              {t('about')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {company.description?.trim() ? (
              <p className="whitespace-pre-line break-words text-sm leading-relaxed">
                {company.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground/60">{t('noData')}</p>
            )}
          </CardContent>
        </Card>
        <Card className={ENTER}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4 text-primary" aria-hidden />
              {t('details')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {details.map((d) => (
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

function CompanySkeleton() {
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
