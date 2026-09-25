import { getTranslations } from 'next-intl/server'
import { PageHeader, SeasonGreeting } from '../../../shared/ui'
import { FeedList } from '../../../widgets/feed-list'
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

      {/* Колонка ленты — 36rem, как на экране «Посты» (views/feed): раньше здесь стояла
          доля `minmax(0,1fr)`, и на широком мониторе лента растягивалась во всю ширину
          контента. От этого страдали не отступы, а сами посты: плитки коллажа квадратные,
          так что пост с двумя вложениями превращался в два квадрата по 600px, а строка
          текста шла через весь экран. Ширина ленты не зависит от боковой колонки —
          иначе пост выглядел бы по-разному на мониторе и на ноутбуке.

          Центрируется связка «лента + колонка» (36 + 1.5 + 20 = 57.5rem), а не одна
          лента: колонка не должна быть приклеена к краю экрана. Ниже `lg` колонка
          уходит под ленту — на телефоне расписание и события читают после постов. */}
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 lg:max-w-[57.5rem] lg:flex-row lg:justify-center">
        <section className="flex w-full min-w-0 flex-1 flex-col gap-4 lg:max-w-xl">
          <FeedList />
        </section>

        {/* `sticky`: колонка коротка, а лента бесконечна — без прилипания две трети
            прокрутки идут вдоль пустого места. Потолок высоты и своя прокрутка нужны
            той же колонке, когда друзей и событий больше, чем влезает в экран. */}
        <aside className="flex w-full flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:w-80 lg:shrink-0 lg:self-start lg:overflow-y-auto">
          <HomeSidebar />
        </aside>
      </div>
    </div>
  )
}
