import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { haptic } from '../telegram/webapp'

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
}

/**
 * Переключатель разделов.
 *
 * Выделение — не перекрашенная кнопка, а отдельная плашка, которая ПЕРЕЕЗЖАЕТ от вкладки
 * к вкладке. Разница не косметическая: при перекраске выбранное появляется в новом месте,
 * и связь между тем, куда нажали, и тем, что открылось, приходится достраивать самому.
 * Переезд показывает её движением — глаз следит за плашкой и приходит туда же, куда
 * приехало содержимое.
 *
 * Положение и ширина замеряются по живому DOM, а не считаются из числа вкладок: подписи
 * разной длины, у части из них счётчик, и в трёх локалях ширины разные. Поэтому же замер
 * повторяется при изменении размеров — режим крупного шрифта меняет их все сразу.
 *
 * До замера плашки нет вовсе (`data-lens` не выставлен), и выбранная вкладка красится
 * фоном по-старому: в окружении без разметки (тесты, отключённый JS-рендер размеров)
 * переключатель обязан оставаться читаемым, а не терять выделение целиком.
 */
export function Tabs<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: TabItem<T>[]
  active: T
  onSelect: (id: T) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [lens, setLens] = useState<{ left: number; width: number } | null>(null)

  // Состав вкладок строкой, а не массивом в зависимостях: массив собирается заново на
  // каждый рендер, и эффект с ним в списке перезапускался бы постоянно — вместе с
  // подкруткой к выбранной вкладке, то есть отнимая прокрутку у пальца.
  const ids = items.map((item) => item.id).join('|')

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const buttons = [...list.querySelectorAll<HTMLElement>('[role="tab"]')]

    const measure = (): void => {
      const current = buttons.find((button) => button.getAttribute('aria-selected') === 'true')
      // Нулевая ширина значит, что раскладки ещё нет: плашка шириной в ноль мигнула бы
      // в левом краю капсулы и уехала оттуда на место — движение из ниоткуда.
      if (!current || current.offsetWidth === 0) {
        setLens(null)
        return
      }
      setLens({ left: current.offsetLeft, width: current.offsetWidth })
    }

    measure()
    // Вкладки не помещаются в ширину телефона и прокручиваются: выбранная с краю обязана
    // оказаться на виду сама, иначе после нажатия она уезжает за границу капсулы.
    buttons
      .find((button) => button.getAttribute('aria-selected') === 'true')
      ?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })

    // ResizeObserver есть не везде (jsdom в тестах его не реализует) — без него остаётся
    // разовый замер, и это ровно то поведение, которое было до плашки.
    if (typeof ResizeObserver === 'undefined') return
    // Следим за каждой кнопкой, а не только за полосой: полоса тянется во всю ширину и не
    // меняет размера, когда у вкладки появляется счётчик, — а плашка под ней меняет.
    const observer = new ResizeObserver(measure)
    for (const button of buttons) observer.observe(button)
    return () => observer.disconnect()
  }, [active, ids])

  return (
    <div className="tabs" role="tablist" ref={listRef} data-lens={lens ? 'on' : undefined}>
      {lens && (
        <span
          className="tab-lens"
          aria-hidden
          style={{ transform: `translateX(${lens.left}px)`, width: lens.width }}
        />
      )}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          className="tab"
          aria-selected={active === item.id}
          onClick={() => {
            // Отклик пальцу раньше, чем ответ экрана: содержимое вкладки может ещё
            // грузиться, и без него нажатие секунду выглядит непринятым.
            haptic.select()
            onSelect(item.id)
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
