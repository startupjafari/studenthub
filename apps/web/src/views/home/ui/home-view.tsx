import { getTranslations } from 'next-intl/server'
import { BarChart3, CalendarClock, CalendarDays } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../../../shared/ui'
import { FeedList } from '../../../widgets/feed-list'

// Главная лента студента (дашборд). Данные ленты/расписания/событий — из будущих фаз
// (Ф8/Ф6/Ф10), поэтому пока осмысленные пустые состояния «скоро».
export async function HomeView() {
  const t = await getTranslations('Dashboard')

  const widgets = [
    { title: t('scheduleToday'), icon: CalendarDays, phase: 6 },
    { title: t('upcomingEvents'), icon: CalendarClock, phase: 10 },
    { title: t('myStats'), icon: BarChart3, phase: 12 },
  ]

  return (
    <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">{t('feedTitle')}</h1>
        <FeedList />
      </section>

      <aside className="flex flex-col gap-4">
        {widgets.map((w) => {
          const Icon = w.icon
          return (
            <Card key={w.title}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="size-4 text-primary" aria-hidden />
                  {w.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {t('comingSoonPhase', { phase: w.phase })}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </aside>
    </div>
  )
}
