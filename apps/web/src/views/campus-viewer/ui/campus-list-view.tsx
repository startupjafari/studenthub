'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Map as MapIcon } from 'lucide-react'
import { CampusRow, campusKeys, fetchCampuses } from '../../../entities/campus'
import { EmptyState, PageHeader, PageLoader } from '../../../shared/ui'

/** Кампусы своего вуза; если он один — сразу карта. */
export function CampusListView() {
  const t = useTranslations('CampusMap')
  const tc = useTranslations('Campus')
  const router = useRouter()
  const list = useQuery({ queryKey: campusKeys.list(), queryFn: fetchCampuses })
  const published = (list.data ?? []).filter((c) => c.publishedVersionId)
  const only = published.length === 1 ? published[0] : null

  useEffect(() => {
    if (only) router.replace(`/campus/${only.id}`)
  }, [only, router])

  if (list.isPending || only) return <PageLoader label={t('loading')} />
  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {published.length === 0 ? (
        <EmptyState
          icon={<MapIcon className="size-6" aria-hidden />}
          title={t('notPublished')}
          description={t('notPublishedText')}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {published.map((c) => (
            <li key={c.id}>
              <CampusRow
                href={`/campus/${c.id}`}
                name={c.name}
                meta={[tc('buildingsCount', { count: c.buildingsCount }), c.description]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
