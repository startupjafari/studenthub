'use client'

import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { BookOpen, Building2, DoorClosed, GraduationCap, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAppSelector } from '../../../shared/store'
import { fetchUniversityStats, universityKeys } from '../../../entities/university'
import { Card, CardContent, EmptyState, Skeleton } from '../../../shared/ui'
import { useChartTheme } from '../../../shared/ui/chart'

// Тяжёлый recharts — только на клиенте, со скелетоном (docs/FRONTEND_RULES.md §4, §11).
// Полотно — общее из shared/ui/chart: то же «сравнить величину», что на дашборде
// платформы, поэтому второй реализации бара здесь не нужно.
const BarChart = dynamic(() => import('../../../shared/ui/chart/bar-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
})

// Дашборд статистики вуза (docs/PROJECT.md §12.1): плитки-показатели и график
// сравнения величин.
export function StatsDashboard() {
  const t = useTranslations('Stats')
  const tErr = useTranslations('Errors')
  const { palette } = useChartTheme()
  const universityId = useAppSelector((s) => s.auth.universityId)

  const stats = useQuery({
    queryKey: universityKeys.stats(universityId ?? ''),
    queryFn: () => fetchUniversityStats(universityId as string),
    enabled: !!universityId,
  })

  if (!universityId) {
    return <EmptyState title={t('noUniversity')} />
  }
  if (stats.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    )
  }
  if (stats.isError || !stats.data) {
    return <EmptyState title={tErr('INTERNAL_ERROR')} />
  }

  const tiles: { key: string; value: number; icon: LucideIcon }[] = [
    { key: 'faculties', value: stats.data.faculties, icon: Building2 },
    { key: 'groups', value: stats.data.groups, icon: Users },
    { key: 'students', value: stats.data.students, icon: GraduationCap },
    { key: 'teachers', value: stats.data.teachers, icon: BookOpen },
    { key: 'rooms', value: stats.data.rooms, icon: DoorClosed },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <Card key={tile.key}>
              <CardContent className="flex flex-col gap-2 pt-6">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="text-2xl font-bold">{tile.value}</span>
                <span className="text-xs text-muted-foreground">{t(tile.key)}</span>
              </CardContent>
            </Card>
          )
        })}
      </div>
      <Card>
        <CardContent className="pt-6">
          <BarChart
            ariaLabel={t('chartTitle')}
            palette={palette}
            height={tiles.length * 34 + 40}
            labels={tiles.map((tile) => t(tile.key))}
            values={tiles.map((tile) => tile.value)}
          />
        </CardContent>
      </Card>
    </div>
  )
}
