'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AlertTriangle, CheckCircle2, Clock, FileStack, RefreshCw } from 'lucide-react'
import { documentKeys, fetchDocumentOverview } from '../../../entities/document'
import { Card, CardContent, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Обзор (ТЗ §3): плитки-счётчики документов.
export function OverviewPanel() {
  const t = useTranslations('Documents')
  const q = useQuery({ queryKey: documentKeys.overview(), queryFn: fetchDocumentOverview })

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    )
  }
  const o = q.data
  if (!o) return null

  const tiles = [
    { key: 'total', value: o.total, label: t('statTotal'), icon: FileStack, tone: 'text-primary' },
    {
      key: 'toUpload',
      value: o.toUpload,
      label: t('statToUpload'),
      icon: RefreshCw,
      tone: 'text-amber-500',
    },
    {
      key: 'inReview',
      value: o.inReview,
      label: t('statInReview'),
      icon: Clock,
      tone: 'text-sky-500',
    },
    {
      key: 'expiring',
      value: o.expiringSoon,
      label: t('statExpiring'),
      icon: AlertTriangle,
      tone: 'text-orange-500',
    },
    {
      key: 'needs',
      value: o.needsReplacement,
      label: t('statNeedsReplacement'),
      icon: CheckCircle2,
      tone: 'text-destructive',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => {
        const Icon = tile.icon
        return (
          <Card key={tile.key} className="transition-shadow hover:shadow-sm">
            <CardContent className="flex flex-col gap-1.5 p-4">
              <Icon className={cn('size-5', tile.tone)} aria-hidden />
              <span className="text-2xl font-bold tabular-nums">{tile.value}</span>
              <span className="text-xs text-muted-foreground">{tile.label}</span>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
