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

      {/* Колонка ленты — до 44rem (704px): уже — снимки выходят мелкими, шире — строка
          текста становится неудобной. Ширина ленты не зависит от боковой колонки — иначе
          пост выглядел бы по-разному на мониторе и на ноутбуке.

          Центрируется связка «лента + колонка» (44 + 1.5 + 20 = 65.5rem), а не одна лента:
          колонка не должна быть приклеена к краю экрана. Колонка встаёт сбоку только с `xl`:
          на `lg` рядом с сайдбаром приложения (18rem) лента сжималась до ~23rem, и пост
          читался узкой полосой. Ниже `xl` колонка уходит под ленту, как на телефоне. На `xl`
          колонка уже (18rem), чтобы ленте на ноутбуке 1280px досталось около 40rem. */}
      <div className="mx-auto flex w-full max-w-[44rem] flex-col gap-6 xl:max-w-[65.5rem] xl:flex-row xl:justify-center">
        <section className="flex w-full min-w-0 flex-1 flex-col gap-4 xl:max-w-[44rem]">
          {/* Кольца сторис стоят над лентой и сами решают, показываться ли:
              раздел за флагом раскатки, а пустую полосу виджет не рисует. */}
          <StoriesRail />
          <FeedList />
        </section>

        {/* `sticky`: колонка коротка, а лента бесконечна — без прилипания две трети
            прокрутки идут вдоль пустого места. Потолок высоты и своя прокрутка нужны
            той же колонке, когда друзей и событий больше, чем влезает в экран. */}
        <aside className="sh-scroll flex w-full flex-col gap-4 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-2rem)] xl:w-72 xl:shrink-0 xl:self-start xl:overflow-y-auto 2xl:w-80">
          <HomeSidebar />
        </aside>
      </div>
    </div>
  )
}
