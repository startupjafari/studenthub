'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import {
  BadgeCheck,
  BookOpen,
  Briefcase,
  CalendarDays,
  Code2,
  Copy,
  FileText,
  Globe,
  GraduationCap,
  Heart,
  Instagram,
  Languages,
  Mail,
  MapPin,
  Phone,
  Send,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { Role } from '@studenthub/shared-types'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CountryFlag,
  LanguageFlag,
} from '../../../shared/ui'
import { countryCodeOf, languageFlagOf } from '../../../shared/config'
import { cn } from '../../../shared/lib/utils'
import {
  STUDENT_ROLES,
  fieldVisible,
  visibleSections,
  type FieldDef,
  type Section,
} from './sections'

// Значение языка с флагом (иконка языка в профиле).
function languageChip(v: string): ReactNode {
  const flag = languageFlagOf(v)
  return (
    <span className="inline-flex items-center gap-1.5">
      {flag && <LanguageFlag code={flag} />}
      {v}
    </span>
  )
}

// Структурный тип, под который подходят и MeResponse (свой профиль), и PublicUser (чужой).
// Динамические поля секций читаются через Record — здесь перечислены только явно используемые.
export interface ProfileData {
  id: string
  firstName: string
  lastName: string
  middleName?: string | null
  avatarUrl: string | null
  role: Role
  createdAt?: string
  headline?: string | null
  email?: string | null
  phone?: string | null
  telegram?: string | null
  website?: string | null
  bio?: string | null
  instagram?: string | null
  country?: string | null
  languages?: string[]
  skills?: string[]
  interests?: string[]
  specialty?: string | null
  department?: string | null
  course?: number | null
  position?: string | null
  jobTitle?: string | null
}

// Hover-анимация карточек профиля отключена по требованию — карточки статичны.
export const CARD_LIFT = ''
export const ENTER =
  'animate-in fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none'

export function fullNameOf(u: ProfileData): string {
  return [u.lastName, u.firstName, u.middleName].filter(Boolean).join(' ')
}

export function initialsOf(u: ProfileData): string {
  return ((u.lastName[0] ?? '') + (u.firstName[0] ?? '')).toUpperCase()
}

// Индикатор присутствия (в сети / не в сети) для угла аватара.
export function StatusDot({ online }: { online: boolean }) {
  const t = useTranslations('Profile')
  const label = online ? t('online') : t('offline')
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'block size-5 rounded-full border-4 border-background sm:size-6',
        online ? 'bg-success' : 'bg-muted-foreground/50',
      )}
    />
  )
}

// Поля, которые выводятся отдельными карточками (не через общий InfoCard):
// «О себе», контакты (email/phone/telegram/instagram/website) и чипы (навыки/интересы/языки).
const HANDLED_ELSEWHERE = new Set<string>([
  'bio',
  'email',
  'phone',
  'telegram',
  'instagram',
  'website',
  'skills',
  'interests',
  'languages',
])

const SECTION_ICON: Record<string, LucideIcon> = {
  sectionStudy: GraduationCap,
  sectionAcademic: BookOpen,
  sectionWork: Briefcase,
  sectionStarosta: UserRound,
  sectionPersonal: UserRound,
}

// Порядок инфо-секций в правой колонке.
const RIGHT_ORDER = [
  'sectionStudy',
  'sectionAcademic',
  'sectionWork',
  'sectionStarosta',
  'sectionPersonal',
]

// ── Имя + подпись + мета (read-only, общий для своего и чужого профиля) ──────
export function ProfileIdentity({ data }: { data: ProfileData }) {
  const t = useTranslations('Profile')
  const tRoles = useTranslations('Roles')
  const locale = useLocale()

  const isStudent = STUDENT_ROLES.includes(data.role)
  // У служебных ролей кафедры нет (поле им недоступно) — в первой строке показываем
  // должность, чтобы мета-строка не осталась пустой; во второй тогда дублировать нечего.
  const metaPrimary = isStudent
    ? data.specialty
    : (data.department ?? data.position ?? data.jobTitle)
  const MetaPrimaryIcon = isStudent ? GraduationCap : Briefcase
  const metaSecondary = isStudent
    ? data.course
      ? `${data.course} ${t('courseShort')}`
      : null
    : data.department
      ? (data.position ?? data.jobTitle ?? null)
      : null

  return (
    <div className="min-w-0 flex-1">
      <h1 className="flex items-center gap-2 text-balance text-xl font-bold sm:text-2xl">
        <span className="truncate">{fullNameOf(data)}</span>
        <BadgeCheck className="size-5 shrink-0 text-primary" aria-hidden />
      </h1>
      {data.headline && (
        <p className="mt-0.5 truncate text-sm text-muted-foreground">{data.headline}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        <Badge variant="default">{tRoles(data.role)}</Badge>
        {metaPrimary && (
          <span className="inline-flex items-center gap-1.5">
            <MetaPrimaryIcon className="size-4 text-muted-foreground/70" aria-hidden />
            {metaPrimary}
          </span>
        )}
        {metaSecondary && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4 text-muted-foreground/70" aria-hidden />
            {metaSecondary}
          </span>
        )}
        {data.createdAt && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-4 text-muted-foreground/70" aria-hidden />
            {t('memberSince')} {new Date(data.createdAt).toLocaleDateString(locale)}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Двухколоночное тело профиля (read-only) ─────────────────────────────────
export function ProfileBody({ data }: { data: ProfileData }) {
  const t = useTranslations('Profile')
  const locale = useLocale()

  const record = data as unknown as Record<string, unknown>

  const displayValue = (f: FieldDef): string | string[] | null => {
    const raw = record[f.key]
    if (raw === null || raw === undefined || raw === '') return null
    if (f.type === 'list') return Array.isArray(raw) && raw.length ? (raw as string[]) : null
    if (f.type === 'date') return new Date(String(raw)).toLocaleDateString(locale)
    if (f.type === 'gender') return t(`gender_${String(raw)}`)
    return String(raw)
  }

  // Показываем ВСЕ блоки и ВСЕ поля секций (пустые значения → «Нет данных»).
  const editSections = visibleSections(data.role)
  const infoSections = RIGHT_ORDER.map((title) => editSections.find((s) => s.title === title))
    .filter((s): s is Section => Boolean(s))
    .map((s) => ({
      section: s,
      rows: s.fields
        .filter((f) => !HANDLED_ELSEWHERE.has(f.key))
        .map((f) => ({ f, v: displayValue(f) })),
    }))
    .filter((x) => x.rows.length > 0)

  // Навыки/интересы — поля студента. Рендерим карточку только если роль их вообще
  // может заполнить, иначе получаются вечные «Нет данных» без пути в форму.
  const showSkills = fieldVisible('skills', data.role)
  const showInterests = fieldVisible('interests', data.role)
  const skills = data.skills ?? []
  const interests = data.interests ?? []
  const langs = data.languages ?? []

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* Левая колонка */}
      <div className="flex flex-col gap-4 lg:sticky lg:top-2">
        <ContactsCard data={data} />
        {showSkills && <ChipsCard title={t('skills')} icon={Code2} items={skills} tone="primary" />}
        {showInterests && (
          <ChipsCard title={t('interests')} icon={Heart} items={interests} tone="accent" />
        )}
        <ChipsCard
          title={t('languages')}
          icon={Languages}
          items={langs}
          tone="muted"
          renderItem={languageChip}
        />
      </div>

      {/* Правая колонка */}
      <div className="flex flex-col gap-4">
        <AboutCard bio={data.bio ?? ''} title={t('sectionAbout')} />
        {infoSections.map(({ section, rows }) => (
          <InfoCard
            key={section.title}
            title={t(section.title)}
            icon={SECTION_ICON[section.title] ?? UserRound}
            rows={rows}
            fieldLabel={(k) => t(k)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Контакты ────────────────────────────────────────────────────────────────
function ContactsCard({ data }: { data: ProfileData }) {
  const t = useTranslations('Profile')
  // Все контакты выводятся всегда; пустые — «Нет данных» (value: null).
  const tg = data.telegram?.replace(/^@+/, '')
  const ig = data.instagram?.replace(/^@+/, '')
  const items: {
    icon: LucideIcon
    label: string
    value: string | null
    href?: string
    copy?: string
  }[] = [
    {
      icon: Mail,
      label: t('email'),
      value: data.email ?? null,
      href: data.email ? `mailto:${data.email}` : undefined,
      copy: data.email ?? undefined,
    },
    { icon: Phone, label: t('phone'), value: data.phone ?? null, copy: data.phone ?? undefined },
    {
      icon: Send,
      label: t('telegram'),
      value: tg ? `@${tg}` : null,
      href: tg ? `https://t.me/${tg}` : undefined,
      copy: tg ? `https://t.me/${tg}` : undefined,
    },
    {
      icon: Instagram,
      label: t('instagram'),
      value: ig ? `@${ig}` : null,
      href: ig ? `https://instagram.com/${ig}` : undefined,
      copy: ig ? `https://instagram.com/${ig}` : undefined,
    },
    {
      icon: Globe,
      label: t('website'),
      value: data.website ?? null,
      href: data.website ?? undefined,
      copy: data.website ?? undefined,
    },
  ]

  return (
    <Card className={cn(CARD_LIFT, ENTER)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="size-4 text-primary" aria-hidden />
          {t('sectionContacts')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {items.map((it) => {
          const Icon = it.icon
          return (
            <div
              key={it.label}
              className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">{it.label}</span>
                {it.value === null ? (
                  <span className="block truncate text-sm font-medium text-muted-foreground/60">
                    {t('noData')}
                  </span>
                ) : it.href ? (
                  <a
                    href={it.href}
                    target={it.href.startsWith('http') ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-medium hover:text-primary hover:underline"
                  >
                    {it.value}
                  </a>
                ) : (
                  <span className="block truncate text-sm font-medium">{it.value}</span>
                )}
              </span>
              {it.copy && (
                <button
                  type="button"
                  aria-label={t('copy')}
                  title={t('copy')}
                  onClick={() => {
                    navigator.clipboard.writeText(it.copy!).then(
                      () => toast.success(t('copied')),
                      () => toast.error(t('copyFailed')),
                    )
                  }}
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Copy className="size-3.5" aria-hidden />
                </button>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ── Карточка чипов (навыки / интересы / языки) ──────────────────────────────
function ChipsCard({
  title,
  icon: Icon,
  items,
  tone,
  renderItem,
}: {
  title: string
  icon: LucideIcon
  items: string[]
  renderItem?: (item: string) => ReactNode
  tone: 'primary' | 'accent' | 'muted'
}) {
  const t = useTranslations('Profile')
  const chipTone =
    tone === 'primary'
      ? 'bg-primary/10 text-primary'
      : tone === 'accent'
        ? 'bg-info/10 text-info'
        : 'bg-muted text-foreground'
  return (
    <Card className={cn(CARD_LIFT, ENTER)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-primary" aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {items.length === 0 ? (
          <span className="text-sm text-muted-foreground/60">{t('noData')}</span>
        ) : (
          items.map((it) => (
            <span key={it} className={cn('rounded-full px-3 py-1 text-sm font-medium', chipTone)}>
              {renderItem ? renderItem(it) : it}
            </span>
          ))
        )}
      </CardContent>
    </Card>
  )
}

// ── «О себе» (Markdown) ──────────────────────────────────────────────────────
function AboutCard({ bio, title }: { bio: string; title: string }) {
  const t = useTranslations('Profile')
  return (
    <Card className={cn(CARD_LIFT, ENTER)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4 text-primary" aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {bio.trim() ? (
          <div className="text-sm leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:mb-1 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{bio}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/60">{t('noData')}</p>
        )}
      </CardContent>
    </Card>
  )
}

// ── Инфо-секция (учёба / работа / личное / староста) ────────────────────────
function InfoCard({
  title,
  icon: Icon,
  rows,
  fieldLabel,
}: {
  title: string
  icon: LucideIcon
  rows: { f: FieldDef; v: string | string[] | null }[]
  fieldLabel: (key: string) => string
}) {
  const t = useTranslations('Profile')
  const copyValue = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(t('copied')),
      () => toast.error(t('copyFailed')),
    )
  }
  return (
    <Card className={cn(CARD_LIFT, ENTER)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-primary" aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(({ f, v }) => {
            const empty = v === null || (Array.isArray(v) && v.length === 0)
            const copyText = Array.isArray(v) ? v.join(', ') : String(v)
            return (
              <div
                key={f.key}
                className="group -mx-2 flex items-start gap-2 rounded-lg px-2 py-0.5 transition-colors hover:bg-muted/60"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <dt className="text-xs text-muted-foreground">{fieldLabel(f.key)}</dt>
                  {empty ? (
                    <dd className="text-sm font-medium text-muted-foreground/60">{t('noData')}</dd>
                  ) : Array.isArray(v) ? (
                    <dd className="flex flex-wrap gap-1.5">
                      {v.map((chip) => (
                        <span
                          key={chip}
                          className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
                        >
                          {chip}
                        </span>
                      ))}
                    </dd>
                  ) : f.key === 'country' && countryCodeOf(String(v)) ? (
                    <dd className="flex items-center gap-1.5 text-sm font-medium">
                      <CountryFlag code={countryCodeOf(String(v))!} />
                      {v}
                    </dd>
                  ) : (
                    <dd className="break-words text-sm font-medium">{v}</dd>
                  )}
                </div>
                {!empty && (
                  <button
                    type="button"
                    aria-label={t('copy')}
                    title={t('copy')}
                    onClick={() => copyValue(copyText)}
                    className="mt-0.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Copy className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
            )
          })}
        </dl>
      </CardContent>
    </Card>
  )
}
