'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Building2, Map, Plus } from 'lucide-react'
import { campusKeys, fetchCampuses } from '../../../entities/campus'
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'
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
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title={t('adminTitle')}
        subtitle={t('adminSubtitle')}
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('createCampus')}
          </Button>
        }
      />
      {q.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Map className="size-6" aria-hidden />}
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
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(q.data ?? []).map((c) => (
            <li key={c.id}>
              <Link
                href={`${basePath}/${c.id}`}
                className="block rounded-2xl outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
              >
                <Card className="flex h-full flex-col gap-2 p-4 transition-colors duration-150 hover:bg-muted/40">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-base font-semibold">{c.name}</h2>
                    {c.publishedVersionId ? (
                      <Badge variant="success">{t('published')}</Badge>
                    ) : (
                      <Badge variant="secondary">{t('draft')}</Badge>
                    )}
                  </div>
                  {c.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{c.description}</p>
                  )}
                  <p className="mt-auto flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Building2 className="size-4" aria-hidden />
                    {t('buildingsCount', { count: c.buildingsCount })}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateCampusModal basePath={basePath} onClose={() => setCreating(false)} />}
    </div>
  )
}
