import type { ReactNode } from 'react'
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
  return (
    <nav className="tabbar">
      <div className="tabbar-row" role="tablist">
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
