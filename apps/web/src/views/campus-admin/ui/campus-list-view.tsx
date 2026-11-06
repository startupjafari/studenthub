'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Map as MapIcon, Plus } from 'lucide-react'
import { CampusRow, campusKeys, fetchCampuses } from '../../../entities/campus'
import { Badge, Button, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'
import { CreateCampusModal } from './create-campus-modal'

/**
 * Кампусы вуза для администратора и модератора (docs/CAMPUS_BUILDER.md §16.1). У вуза их может
 * быть несколько (разные площадки); у каждого — корпуса, этажи и опубликованная версия.
 */
export function CampusListView({ basePath }: { basePath: string }) {
  const t = useTranslations('Campus')
  const [creating, setCreating] = useState(false)
  const q = useQuery({ queryKey: campusKeys.list(), queryFn: fetchCampuses })

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('adminTitle')}
        subtitle={t('adminSubtitle')}
        actions={
          <Button type="button" size="md" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('createCampus')}
          </Button>
        }
      />
      {q.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} fill className="min-h-18" />
          ))}
        </div>
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={<MapIcon className="size-6" aria-hidden />}
          title={t('emptyTitle')}
          description={t('emptyText')}
          action={
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t('createCampus')}
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {(q.data ?? []).map((c) => (
            <li key={c.id}>
              <CampusRow
                href={`${basePath}/${c.id}`}
                name={c.name}
                meta={[t('buildingsCount', { count: c.buildingsCount }), c.description]
                  .filter(Boolean)
                  .join(' · ')}
                badge={
                  c.publishedVersionId ? (
                    <Badge variant="success">{t('published')}</Badge>
                  ) : (
                    <Badge variant="secondary">{t('draft')}</Badge>
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateCampusModal basePath={basePath} onClose={() => setCreating(false)} />}
    </div>
  )
}
