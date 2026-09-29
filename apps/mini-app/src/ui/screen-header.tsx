import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Шапка экрана: название и состояния.
 *
 * Своей кнопки возврата здесь НЕТ. Раньше была — на том основании, что `BackButton`
 * Telegram выглядит в каждом клиенте по-своему. Но два выхода из одного экрана человек
 * читает как два разных действия и ищет разницу там, где её нет, а в шапке мини-аппа
 * стрелка вдобавок стоит прямо под стрелкой самого Telegram. Возврат остался один —
 * клиентский (`useBackButton` в telegram/use-telegram.ts), и экраны по-прежнему обязаны
 * его включать.
 *
 * Описания под названием («Очередь модерации», «Поиск и доступ») здесь тоже нет. Строка
 * повторяла заголовок другими словами и занимала место ровно там, где начинается
 * содержимое: на телефоне она отодвигала вниз первую строку списка, ничего о ней не
 * сообщая.
 *
 * Переключатель состояний стоит СПРАВА от названия, в одной с ним строке. Отдельной
 * строкой он занимал целую полосу экрана и читался как содержимое, хотя это всего лишь
 * «какие из них показывать»: название отвечает «где я», переключатель — «что показано»,
 * и вместе это один вопрос.
 *
 * Крупный заголовок сжимается при прокрутке, как в iOS: когда он уезжает за верх, сверху
 * появляется узкая стеклянная полоса с тем же названием. Иначе на длинной карточке
 * жалобы, пролистанной до решения, не было видно, где ты.
 */
export function ScreenHeader({ title, tabs }: { title: string; tabs?: ReactNode }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const el = titleRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    // Верх экрана в полноэкранном режиме занят вырезом и кнопками Telegram: заголовок,
    // ушедший под них, уже не виден — считаем его уехавшим с этой линии, а не с нуля.
    const root = getComputedStyle(document.documentElement)
    const top =
      (parseFloat(root.getPropertyValue('--tg-safe-area-inset-top')) || 0) +
      (parseFloat(root.getPropertyValue('--tg-content-safe-area-inset-top')) || 0)
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(entry ? !entry.isIntersecting : false),
      { rootMargin: `-${Math.round(top)}px 0px 0px 0px` },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <header className="screen-head">
      <div className={`head-row${tabs ? ' with-tabs' : ''}`}>
        <h1 ref={titleRef}>{title}</h1>
        {/* Переключателю отдаётся вся оставшаяся ширина: делить её поровну с названием
            незачем — «Разобранные» длиннее любого из наших заголовков. */}
        {tabs && <div className="head-tabs">{tabs}</div>}
      </div>

      {/* Сжатая шапка. Для читалки её нет: это тот же заголовок второй раз. */}
      <div className={`compact-head${collapsed ? ' shown' : ''}`} aria-hidden>
        <span className="compact-title">{title}</span>
      </div>
    </header>
  )
}
