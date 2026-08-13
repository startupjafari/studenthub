import { getTranslations } from 'next-intl/server'
import { PageHeader } from '../../../shared/ui'
import { FeedList } from '../../../widgets/feed-list'
import { HomeSidebar } from './home-sidebar'

// Главная лента студента (дашборд): лента + сайдбар (пары на сегодня, ближайшие события).
export async function HomeView() {
  const t = await getTranslations('Dashboard')

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex flex-col gap-4">
        <PageHeader title={t('feedTitle')} />
        <FeedList />
      </section>

      <aside className="flex flex-col gap-4">
        <HomeSidebar />
      </aside>
    </div>
  )
}
