'use client'

import { useLocale, useTranslations } from 'next-intl'
import { ARTICLE_CATEGORIES, CONTENT_VISIBILITY } from '@studenthub/shared-schemas'
import type { ArticleCategory, ContentVisibility } from '@studenthub/shared-schemas'
import { ARTICLE_TAGS } from '../../../shared/config'
import {
  ARTICLE_CONTENT_MAX,
  type ArticleStats,
  type ContentOwner,
} from '../../../entities/profile-content'
import {
  Checkbox,
  DictMultiSelect,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

export interface ArticleSettingsValue {
  category: ArticleCategory | ''
  tags: string[]
  visibility: ContentVisibility
  allowComments: boolean
}

/**
 * Настройки статьи — отдельно от текста, как в Medium и Notion: справа колонкой на
 * компьютере, выдвижной панелью на телефоне. Категории — из контракта
 * (`ARTICLE_CATEGORIES` общих схем, его же проверяет сервер), теги — справочник с поиском,
 * без дублей и с пределом в 15.
 */
export function EditorSettings({
  value,
  onChange,
  owner,
  stats,
  markdownMode,
  onMarkdownMode,
}: {
  value: ArticleSettingsValue
  onChange: (next: ArticleSettingsValue) => void
  owner: ContentOwner['kind']
  stats: ArticleStats
  markdownMode: boolean
  onMarkdownMode: (on: boolean) => void
}) {
  const t = useTranslations('Article')
  const tProfile = useTranslations('Profile')
  const locale = useLocale()
  const set = <K extends keyof ArticleSettingsValue>(key: K, v: ArticleSettingsValue[K]) =>
    onChange({ ...value, [key]: v })
  const nearLimit = stats.chars > ARTICLE_CONTENT_MAX * 0.9

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="article-category">{tProfile('category')}</Label>
        <Select
          value={value.category || undefined}
          onValueChange={(v) => set('category', v as ArticleCategory)}
        >
          <SelectTrigger id="article-category" className="w-full">
            <SelectValue placeholder={tProfile('categoryPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {ARTICLE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {tProfile(`cat_${c}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="article-tags">{tProfile('tags')}</Label>
        <DictMultiSelect
          id="article-tags"
          value={value.tags}
          onChange={(tags) => set('tags', tags)}
          options={ARTICLE_TAGS}
          max={15}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="article-visibility">{tProfile('visibility')}</Label>
        {owner === 'user' ? (
          <Select
            value={value.visibility}
            onValueChange={(v) => set('visibility', v as ContentVisibility)}
          >
            <SelectTrigger id="article-visibility" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_VISIBILITY.map((v) => (
                <SelectItem key={v} value={v}>
                  {tProfile(`vis_${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          // Видимость статьи страницы организации ставит сервер.
          <p className="text-sm text-muted-foreground">
            {owner === 'company'
              ? tProfile('companyVisibilityHint')
              : tProfile('universityVisibilityHint')}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox
            checked={value.allowComments}
            onCheckedChange={(v) => set('allowComments', v === true)}
          />
          {tProfile('allowComments')}
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox checked={markdownMode} onCheckedChange={(v) => onMarkdownMode(v === true)} />
          {t('markdownMode')}
        </label>
      </div>

      <dl className="grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-3 text-center">
        <Stat label={t('statWords')} value={stats.words.toLocaleString(locale)} />
        <Stat
          label={t('statChars')}
          value={stats.chars.toLocaleString(locale)}
          className={cn(nearLimit && 'text-warning')}
        />
        <Stat label={t('statMinutes')} value={String(stats.minutes)} />
      </dl>
      {nearLimit && (
        <p className="-mt-4 text-xs text-warning">
          {t('charsLimit', { max: ARTICLE_CONTENT_MAX.toLocaleString(locale) })}
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm font-semibold tabular-nums', className)}>{value}</dd>
    </div>
  )
}
