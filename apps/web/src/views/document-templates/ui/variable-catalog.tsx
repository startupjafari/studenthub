'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, Copy, Download, Search } from 'lucide-react'
import {
  DOCUMENT_TEMPLATE_VARIABLE_GROUPS,
  DOCUMENT_TEMPLATE_VARIABLES,
  type DocumentTemplateVariableGroup,
} from '@studenthub/shared-config'
import { Badge, Button, Card, EmptyState, Input, SegmentedTabs } from '../../../shared/ui'
import { saveBlob } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { asTag, useTemplateTexts, varKey } from '../lib/use-template-texts'

type GroupFilter = 'ALL' | DocumentTemplateVariableGroup

interface VariableCatalogProps {
  /** Компактный вид — внутри мастера: без шапки с действиями и в одну колонку. */
  compact?: boolean
  className?: string
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Буфер обмена недоступен (не https, запрет браузера) — сообщаем, а не молчим.
    return false
  }
}

// Каталог переменных StudentHub: что можно вставить в документ Word. Источник — реестр в
// shared-config, тот же, по которому сервер проверяет и заполняет шаблоны: каталог не может
// показать переменную, которой сервер не знает.
export function VariableCatalog({ compact = false, className }: VariableCatalogProps) {
  const t = useTranslations('DocumentTemplates')
  const { variableLabel } = useTemplateTexts()
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<GroupFilter>('ALL')
  const [copied, setCopied] = useState<string | null>(null)

  const description = (key: string) => t(`var_${varKey(key)}_desc`)

  // Три десятка строк — фильтруем на каждом рендере, без мемоизации (FRONTEND_RULES §11).
  const q = query.trim().toLowerCase()
  const items = DOCUMENT_TEMPLATE_VARIABLES.filter(
    (v) => group === 'ALL' || v.group === group,
  ).filter(
    (v) =>
      !q ||
      v.key.toLowerCase().includes(q) ||
      variableLabel(v.key).toLowerCase().includes(q) ||
      description(v.key).toLowerCase().includes(q),
  )

  const copyOne = async (key: string) => {
    if (await copyText(asTag(key))) {
      setCopied(key)
      toast.success(t('copied', { tag: asTag(key) }))
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000)
    } else {
      toast.error(t('copyFailed'))
    }
  }

  // Справочник одним текстом: «Название — {переменная}», по группам. Удобно держать рядом с
  // Word или переслать коллеге, который готовит бланк.
  const reference = () =>
    DOCUMENT_TEMPLATE_VARIABLE_GROUPS.map((g) =>
      [
        t(`group_${g}`),
        ...DOCUMENT_TEMPLATE_VARIABLES.filter((v) => v.group === g).map(
          (v) => `  ${variableLabel(v.key)} — ${asTag(v.key)}`,
        ),
      ].join('\n'),
    ).join('\n\n')

  const copyAll = async () => {
    if (await copyText(reference())) toast.success(t('copiedAll'))
    else toast.error(t('copyFailed'))
  }

  const download = () =>
    void saveBlob(
      new Blob([`${t('referenceTitle')}\n\n${reference()}\n`], {
        type: 'text/plain;charset=utf-8',
      }),
      `${t('referenceFile')}.txt`,
    )

  const tabs = [
    { value: 'ALL' as const, label: t('group_ALL') },
    ...DOCUMENT_TEMPLATE_VARIABLE_GROUPS.map((g) => ({ value: g, label: t(`group_${g}`) })),
  ]

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {!compact && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm text-muted-foreground">{t('catalogIntro')}</p>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => void copyAll()}>
              <Copy className="size-4" aria-hidden /> {t('copyAll')}
            </Button>
            <Button variant="outline" size="sm" onClick={download}>
              <Download className="size-4" aria-hidden /> {t('downloadReference')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('catalogSearch')}
            aria-label={t('catalogSearch')}
            className="pl-9"
          />
        </div>
        <SegmentedTabs items={tabs} value={group} onChange={setGroup} compact collapsible />
      </div>

      {items.length === 0 ? (
        <EmptyState title={t('catalogEmpty')} description={t('catalogEmptyHint')} />
      ) : (
        <ul className={cn('grid gap-3', !compact && 'sm:grid-cols-2 xl:grid-cols-3')}>
          {items.map((v) => (
            <li key={v.key}>
              <Card className="flex h-full flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">{variableLabel(v.key)}</span>
                    <div className="flex flex-wrap gap-1">
                      {'personal' in v && v.personal && (
                        <Badge variant="warning">{t('personalBadge')}</Badge>
                      )}
                      {'optional' in v && v.optional && (
                        <Badge variant="secondary">{t('optionalBadge')}</Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void copyOne(v.key)}
                    aria-label={t('copyVariable', { label: variableLabel(v.key) })}
                  >
                    {copied === v.key ? (
                      <Check className="size-4 text-success" aria-hidden />
                    ) : (
                      <Copy className="size-4" aria-hidden />
                    )}
                    <span className="hidden sm:inline">
                      {copied === v.key ? t('copiedShort') : t('copy')}
                    </span>
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">{description(v.key)}</p>
                <code className="w-fit rounded bg-muted px-2 py-1 font-mono text-xs break-all select-all">
                  {asTag(v.key)}
                </code>
                <p className="mt-auto text-xs text-muted-foreground">
                  {t('exampleValue')}: <span className="text-foreground">{v.example}</span>
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
