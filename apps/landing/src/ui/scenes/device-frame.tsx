import type { ReactNode } from 'react'
import { CalendarDays, FileText, House, IdCard, MessageCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Корпус телефона, в котором играют сцены «Одного дня».
 *
 * Сделан по iPhone 15: пропорции экрана 393 × 852 pt, крупный радиус корпуса, Dynamic
 * Island вместо чёлки, тонкая рамка и боковые кнопки. Узнаваемый аппарат объясняет
 * контекст быстрее любой подписи — это студент в коридоре, а не абстрактное «мобильное
 * представление».
 *
 * Рамка — единственный владелец геометрии: пропорции, поля, шапка и нижняя навигация.
 * Сцены получают готовую область и только наполняют её. Пока поля задавала каждая сцена
 * сама, они расходились с шапкой приложения, и содержимое стояло левее логотипа.
 *
 * Нижняя навигация не украшение: в самой платформе до `lg` именно она, а не сайдбар, —
 * базовый каркас (docs/DESIGN_SYSTEM.md §15).
 */

/** Одно поле для шапки, содержимого и навигации — по нему выравнивается всё внутри. */
const GUTTER = 'px-4'

/** Вкладки нижней навигации. Порядок и набор — как в мобильном каркасе платформы. */
const TABS: { id: TabId; icon: LucideIcon }[] = [
  { id: 'home', icon: House },
  { id: 'schedule', icon: CalendarDays },
  { id: 'requests', icon: FileText },
  { id: 'chats', icon: MessageCircle },
  { id: 'id', icon: IdCard },
]

export type TabId = 'home' | 'schedule' | 'requests' | 'chats' | 'id'

/**
 * Высоты полос эквалайзера в пикселях. Набор неровный намеренно: одинаковые полосы,
 * пляшущие с одинаковой амплитудой, читаются как индикатор загрузки, а не как звук.
 */
const EQUALIZER = [7, 11, 5, 9, 12]

export function DeviceFrame({
  appName,
  activeTab = 'home',
  time = '9:41',
  children,
}: {
  appName: string
  /** Какая вкладка подсвечена — у каждой сцены своя, как было бы в приложении. */
  activeTab?: TabId
  /**
   * Часы в строке состояния. Обязаны совпадать с моментом сюжета: «9:41» на экране,
   * когда сцена про 12:15, — первое, за что цепляется глаз, и вся сцена после этого
   * читается как макет, а не как снимок происходящего.
   */
  time?: string
  children: ReactNode
}) {
  return (
    <div className="relative mx-auto w-full max-w-[16.5rem]">
      {/* Боковые кнопки. Титановый корпус: у iPhone 15 громкость и «тихий режим» слева,
          кнопка питания справа и заметно длиннее остальных. */}
      <span
        aria-hidden
        className="absolute top-[8.5rem] -left-[3px] h-8 w-[3px] rounded-l-sm bg-neutral-700"
      />
      <span
        aria-hidden
        className="absolute top-[11rem] -left-[3px] h-12 w-[3px] rounded-l-sm bg-neutral-700"
      />
      <span
        aria-hidden
        className="absolute top-[13.75rem] -left-[3px] h-12 w-[3px] rounded-l-sm bg-neutral-700"
      />
      <span
        aria-hidden
        className="absolute top-[11.5rem] -right-[3px] h-16 w-[3px] rounded-r-sm bg-neutral-700"
      />

      {/* Корпус: титановая рамка, внутри чёрная кромка экрана. */}
      <div className="relative rounded-[2.75rem] bg-gradient-to-b from-neutral-500 via-neutral-700 to-neutral-600 p-[3px] shadow-[0_24px_60px_-24px_rgb(0_0_0/0.6)]">
        <div className="relative rounded-[2.6rem] bg-black p-[9px]">
          {/* Экран. Пропорции честные — 393 × 852 pt. */}
          <div className="relative flex aspect-[393/852] flex-col overflow-hidden rounded-[2.1rem] bg-background select-none">
            {/* Строка состояния. Время слева, индикаторы справа — по краям от острова. */}
            <div
              className={`flex shrink-0 items-center justify-between ${GUTTER} pt-2.5 pb-1 text-[0.625rem] font-semibold text-foreground tabular-nums`}
            >
              <span>{time}</span>
              <span className="flex items-center gap-1" aria-hidden>
                <span className="h-2 w-3.5 rounded-[2px] border border-foreground/60" />
                <span className="h-2 w-0.5 rounded-full bg-foreground/60" />
              </span>
            </div>

            {/*
              Dynamic Island с живой активностью: слева значок приложения, справа
              эквалайзер. Ровно так остров и работает на аппарате — показывает, что
              приложение что-то делает прямо сейчас, не открывая его.

              Содержимое разнесено по краям с равными полями: остров симметричен, и
              значок с полосами должны стоять на одинаковом расстоянии от закруглений.
            */}
            <div
              aria-hidden
              className="absolute top-2 left-1/2 flex h-[1.6rem] w-[6.75rem] -translate-x-1/2 items-center justify-between rounded-full bg-black px-2"
            >
              <span className="sh-island-mark grid size-4 shrink-0 place-items-center rounded-[5px] bg-primary text-[0.5rem] leading-none font-bold text-primary-foreground">
                S
              </span>

              {/* Полосы выровнены по нижнему краю: эквалайзер растёт снизу вверх. */}
              <span className="flex h-3 items-end gap-[2px]">
                {EQUALIZER.map((height, i) => (
                  <span
                    key={i}
                    className="sh-eq-bar w-[2px] rounded-full bg-primary"
                    style={{ height: `${height}px`, '--i': i } as React.CSSProperties}
                  />
                ))}
              </span>
            </div>

            {/* Шапка приложения */}
            <div className={`flex shrink-0 items-center gap-2 ${GUTTER} pt-1.5 pb-3`}>
              <span className="grid size-6 place-items-center rounded-md bg-primary text-[0.6rem] font-bold text-primary-foreground">
                S
              </span>
              <span className="text-sm font-semibold">{appName}</span>
            </div>

            {/* Рабочая область сцены. min-h-0 обязателен: без него flex-потомок не даёт
                контейнеру сжаться, и длинная сцена распирает корпус. */}
            <div className={`relative min-h-0 flex-1 ${GUTTER}`}>{children}</div>

            {/* Нижняя навигация. Иконки без подписей: на этом кегле подпись всё равно не
                читается, а разъезжающиеся по ширине слова ломали бы равные колонки. */}
            <nav
              aria-hidden
              className={`mt-3 grid shrink-0 grid-cols-5 border-t border-border bg-card/60 ${GUTTER} pt-2 pb-1.5`}
            >
              {TABS.map(({ id, icon: Icon }) => (
                <span key={id} className="grid place-items-center">
                  <Icon
                    className={
                      id === activeTab ? 'size-4 text-primary' : 'size-4 text-muted-foreground/50'
                    }
                  />
                </span>
              ))}
            </nav>

            {/* Индикатор жеста «домой» */}
            <span
              aria-hidden
              className="mx-auto mb-1.5 h-1 w-28 shrink-0 rounded-full bg-foreground/25"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
