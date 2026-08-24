'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { BarChart3, BookOpen, Building2, GraduationCap, Users } from 'lucide-react'
import {
  fetchUniversities,
  fetchUniversityStats,
  universityKeys,
} from '../../../entities/university'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../../../shared/ui'

// Агрегированная статистика платформы: список вузов, у каждого — плитки из GET /universities/:id/stats.
export function PlatformStatsView() {
  const t = useTranslations('Stats')
  const tErr = useTranslations('Errors')
  const unis = useQuery({ queryKey: universityKeys.list(), queryFn: fetchUniversities })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={BarChart3} title={t('platformTitle')} subtitle={t('platformSubtitle')} />
      {unis.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : unis.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : (unis.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Building2 className="size-6" aria-hidden />}
          title={t('noUniversities')}
        />
      ) : (
        unis.data!.map((u) => <UniversityStatsCard key={u.id} id={u.id} name={u.name} />)
      )}
    </div>
  )
}

function UniversityStatsCard({ id, name }: { id: string; name: string }) {
  const t = useTranslations('Stats')
  const stats = useQuery({
    queryKey: universityKeys.stats(id),
    queryFn: () => fetchUniversityStats(id),
  })

  const tiles = stats.data
    ? [
        { key: 'faculties', value: stats.data.faculties, icon: Building2 },
        { key: 'groups', value: stats.data.groups, icon: Users },
        { key: 'students', value: stats.data.students, icon: GraduationCap },
        { key: 'teachers', value: stats.data.teachers, icon: BookOpen },
      ]
    : []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{name}</CardTitle>
      </CardHeader>
      <CardContent>
        {stats.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map((tile) => {
              const Icon = tile.icon
              return (
                <div
                  key={tile.key}
                  className="flex flex-col gap-1 rounded-xl border border-border p-3"
                >
                  <Icon className="size-4 text-primary" aria-hidden />
                  <span className="text-xl font-bold">{tile.value}</span>
                  <span className="text-xs text-muted-foreground">{t(tile.key)}</span>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
