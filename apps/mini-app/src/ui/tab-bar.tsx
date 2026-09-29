import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { haptic } from '../telegram/webapp'

export interface TabBarItem<T extends string> {
  id: T
  label: string
  /** Значок берёт вид от состояния: у выбранного раздела он залит, у остальных — контурный. */
  icon: (filled: boolean) => ReactNode
  /** Сколько работы ждёт в разделе. 0 — значка нет. */
  count?: number
}

/**
 * Нижняя панель разделов.
 *
 * Отдельный компонент, а не тот же переключатель, что внутри экранов: это разные вещи,
 * которым только на вид общая форма. Переключатель делит ОДИН экран на состояния и живёт
 * в его потоке; панель переключает сами экраны, висит над всеми и остаётся на месте.
 *
 * Значок над подписью, а не вместо неё. Значок узнаётся быстрее слова и держит выбор
 * без чтения, но «Управление» и «Поддержка» по одной картинке не различить — подпись
 * снимает догадку. Вместе они занимают меньше места по высоте, чем кажется: подпись
 * мелкая, потому что её читают один раз, а дальше узнают рисунок.
 *
 * Выбранный раздел отличается не только цветом, но и заливкой значка: цвет различает,
 * только пока его видно, — на солнце и при высокой контрастности он пропадает первым.
 *
 * Пузырь под выбранным разделом ПЕРЕЕЗЖАЕТ, а не гаснет и зажигается. Разделы теперь
 * листаются и пальцем (app.tsx), и при перелистывании перекраска давала разрыв: палец
 * ведёт содержимое плавно, а отметка внизу скачет. Переезд связывает одно с другим —
 * тот же приём и та же механика замера, что у переключателя внутри экрана (ui/tabs.tsx).
 */
export function TabBar<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: TabBarItem<T>[]
  active: T
  onSelect: (id: T) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [bubble, setBubble] = useState<{ left: number; width: number } | null>(null)

  // Состав строкой, а не массивом: массив пересобирается на каждый рендер, и эффект с ним
  // в зависимостях перезапускался бы постоянно. Счётчики в ключ не входят — от них ширина
  // не меняется (цифра сидит НА значке), а перезамер на каждое обновление числа лишний.
  const ids = items.map((item) => item.id).join('|')

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const buttons = [...row.querySelectorAll<HTMLElement>('[role="tab"]')]

    const measure = (): void => {
      const current = buttons.find((button) => button.getAttribute('aria-selected') === 'true')
      // Нулевая ширина — раскладки ещё нет. Пузырь шириной в ноль мигнул бы у левого края
      // и уехал оттуда на место: движение из ниоткуда читается как сбой отрисовки.
      if (!current || current.offsetWidth === 0) {
        setBubble(null)
        return
      }
      setBubble({ left: current.offsetLeft, width: current.offsetWidth })
    }

    measure()

    // ResizeObserver есть не везде (в jsdom его нет): без него остаётся разовый замер —
    // ровно то поведение, что было до пузыря.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    for (const button of buttons) observer.observe(button)
    return () => observer.disconnect()
  }, [active, ids])

  return (
    <nav className="tabbar">
      <div
        className="tabbar-row"
        role="tablist"
        ref={rowRef}
        data-bubble={bubble ? 'on' : undefined}
      >
        {bubble && (
          <span
            className="tabbar-bubble"
            aria-hidden
            style={{ transform: `translateX(${bubble.left}px)`, width: bubble.width }}
          />
        )}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="tabbar-item"
            aria-selected={active === item.id}
            onClick={() => {
              haptic.select()
              onSelect(item.id)
            }}
          >
            <span className="tabbar-icon">
              {item.icon(active === item.id)}
              {/* Счётчик сидит на значке, а не в строке подписи: подпись от него
                  съезжала бы вбок, и раздел с работой оказывался бы шире соседних. */}
              {item.count !== undefined && item.count > 0 && (
                <span className="tabbar-count">{item.count > 99 ? '99+' : item.count}</span>
              )}
            </span>
            <span className="tabbar-label">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
