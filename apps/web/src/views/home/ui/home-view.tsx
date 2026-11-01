import { getTranslations } from 'next-intl/server'
import { PageHeader, SeasonGreeting } from '../../../shared/ui'
import { FeedList } from '../../../widgets/feed-list'
import { StoriesRail } from '../../../widgets/stories-rail'
import { HomeSidebar } from './home-sidebar'

// Главная лента студента (дашборд): лента + сайдбар (пары на сегодня, ближайшие события).
export async function HomeView() {
  const t = await getTranslations('Dashboard')

  return (
    // Шапка — над сеткой, а не внутри колонки: полоса идёт во всю ширину контента,
    // как на остальных страницах.
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader title={t('feedTitle')} />
      <SeasonGreeting />

      {/* Колонка ленты — до 46rem, как на экране «Посты» (views/feed): прежние 36rem на
          большом мониторе давали узкую полосу посреди пустоты, а снимки — мелкими. Шире
          не делаем: строка текста через весь экран нечитаема. Ширина ленты не зависит от
          боковой колонки — иначе пост выглядел бы по-разному на мониторе и на ноутбуке.

          Центрируется связка «лента + колонка» (46 + 1.5 + 20 = 67.5rem), а не одна
          лента: колонка не должна быть приклеена к краю экрана. Где места на обе нет,
          лента сжимается (`min-w-0`), а колонка становится уже (18rem до xl). Ниже `lg`
          колонка уходит под ленту — на телефоне расписание и события читают после постов. */}
      <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-6 lg:max-w-[67.5rem] lg:flex-row lg:justify-center">
        <section className="flex w-full min-w-0 flex-1 flex-col gap-4 lg:max-w-[46rem]">
          {/* Кольца сторис стоят над лентой и сами решают, показываться ли:
              раздел за флагом раскатки, а пустую полосу виджет не рисует. */}
          <StoriesRail />
          <FeedList />
        </section>

        {/* `sticky`: колонка коротка, а лента бесконечна — без прилипания две трети
            прокрутки идут вдоль пустого места. Потолок высоты и своя прокрутка нужны
            той же колонке, когда друзей и событий больше, чем влезает в экран. */}
        <aside className="flex w-full flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:w-72 lg:shrink-0 lg:self-start lg:overflow-y-auto xl:w-80">
          <HomeSidebar />
        </aside>
      </div>
    </div>
  )
}
