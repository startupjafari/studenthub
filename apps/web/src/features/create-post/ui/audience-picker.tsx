'use client'

import { useTranslations } from 'next-intl'
import {
  BookOpen,
  Briefcase,
  Building2,
  ChevronDown,
  Globe,
  GraduationCap,
  Landmark,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { PostAudienceValue } from '@studenthub/shared-schemas'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../../shared/ui'

export const AUDIENCE_ICON: Record<PostAudienceValue, LucideIcon> = {
  ALL: Globe,
  UNIVERSITY: Building2,
  FACULTY: Landmark,
  GROUP: Users,
  SUBJECT: BookOpen,
  TEACHERS: GraduationCap,
  PERSONAL: UserRound,
  COMPANY: Briefcase,
}

/**
 * Аудитория — компактной «таблеткой» под именем автора, как в Threads и Facebook: кому
 * уходит пост, видно там же, где видно, кто его пишет. Список — только то, что разрешено
 * роли (AUDIENCES_BY_ROLE, зеркало сервера); окончательно аудиторию проверяет сервер.
 * Одна доступная аудитория — подпись без меню: выбирать не из чего.
 */
export function AudiencePicker({
  value,
  options,
  onChange,
}: {
  value: PostAudienceValue | undefined
  options: readonly PostAudienceValue[]
  onChange: (value: PostAudienceValue) => void
}) {
  const t = useTranslations('Feed')
  const current = value ?? options[0]
  if (!current) return null
  const Icon = AUDIENCE_ICON[current]
  const label = (
    <>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{t(`audience${current}`)}</span>
    </>
  )
  const chip =
    'inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-muted/70 px-2.5 text-xs font-medium text-muted-foreground'

  if (options.length < 2) {
    return (
      <span className={chip} aria-label={`${t('audience')}: ${t(`audience${current}`)}`}>
        {label}
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${t('audience')}: ${t(`audience${current}`)}`}
          className={`${chip} cursor-pointer transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none data-[state=open]:bg-muted data-[state=open]:text-foreground`}
        >
          {label}
          <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(v) => onChange(v as PostAudienceValue)}
        >
          {options.map((a) => {
            const ItemIcon = AUDIENCE_ICON[a]
            return (
              <DropdownMenuRadioItem key={a} value={a} className="gap-2.5">
                <ItemIcon className="size-4 text-muted-foreground" aria-hidden />
                {t(`audience${a}`)}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
