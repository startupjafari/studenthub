'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ChevronRight, Map as MapIcon } from 'lucide-react'
import { campusKeys, fetchCampuses } from '../../../entities/campus'
import { Card, EmptyState, PageHeader, PageLoader } from '../../../shared/ui'

/** Кампусы своего вуза; если он один — сразу карта. */
export function CampusListView() {
  const t = useTranslations('CampusMap')
  const router = useRouter()
  const list = useQuery({ queryKey: campusKeys.list(), queryFn: fetchCampuses })
  const published = (list.data ?? []).filter((c) => c.publishedVersionId)
  const only = published.length === 1 ? published[0] : null

  useEffect(() => {
    if (only) router.replace(`/campus/${only.id}`)
  }, [only, router])

  if (list.isPending || only) return <PageLoader label={t('loading')} />
  if (published.length === 0) {
    return (
      <EmptyState
        icon={<MapIcon className="size-6" aria-hidden />}
        title={t('notPublished')}
        description={t('notPublishedText')}
      />
    )
  }
  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {published.map((c) => (
          <li key={c.id}>
            <Card className="p-0">
              <Link
                href={`/campus/${c.id}`}
                className="flex items-center gap-3 rounded-[inherit] p-4 hover:bg-muted/50"
              >
                <MapIcon className="size-5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  {c.description && (
                    <span className="block truncate text-sm text-muted-foreground">
                      {c.description}
                    </span>
                  )}
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
