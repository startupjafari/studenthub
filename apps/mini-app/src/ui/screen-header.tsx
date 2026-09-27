import { useEffect, useRef, useState, type ReactNode } from 'react'
import { haptic } from '../telegram/webapp'
import { IconBack } from './icons'
import { t } from '../i18n'

/**
 * Шапка экрана: возврат, название, состояния.
 *
 * Своя кнопка возврата, хотя Telegram даёт свою (`BackButton`). Его кнопка живёт в чужой
 * панели над приложением, выглядит в каждом клиенте по-своему и на части из них не
 * появляется вовсе — а провалившись в карточку, человек обязан видеть выход, не гадая.
 * Родная кнопка Telegram при этом остаётся: две двери лучше, чем одна ненадёжная.
 *
 * Переключатель состояний стоит СПРАВА от названия, в одной с ним строке. Отдельной
 * строкой он занимал целую полосу экрана и читался как содержимое, хотя это всего лишь
 * «какие из них показывать»: название отвечает «где я», переключатель — «что показано»,
 * и вместе это один вопрос.
 *
 * Крупный заголовок сжимается при прокрутке, как в iOS: когда он уезжает за верх, сверху
 * появляется узкая стеклянная полоса с тем же названием и возвратом. Иначе на длинной
 * карточке жалобы, пролистанной до решения, не было видно ни где ты, ни как выйти.
 */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  tabs,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  tabs?: ReactNode
}) {
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

  const back = onBack
    ? () => {
        haptic.tap()
        onBack()
      }
    : undefined

  return (
    <header className={`screen-head${back ? ' with-back' : ''}`}>
      <div className={`head-row${tabs ? ' with-tabs' : ''}`}>
        {back && (
          <button type="button" className="head-back" aria-label={t('back')} onClick={back}>
            <IconBack size={22} />
          </button>
        )}
        <h1 ref={titleRef}>{title}</h1>
        {/* Переключателю отдаётся вся оставшаяся ширина: делить её поровну с названием
            незачем — «Разобранные» длиннее любого из наших заголовков. */}
        {tabs && <div className="head-tabs">{tabs}</div>}
      </div>
      {subtitle && <p className="hint">{subtitle}</p>}

      {/* Сжатая шапка. Для читалки её нет: это тот же заголовок второй раз, а возврат
          уже есть выше и в кнопке Telegram. */}
      <div className={`compact-head${collapsed ? ' shown' : ''}`} aria-hidden>
        {back && (
          <button type="button" className="head-back" tabIndex={-1} onClick={back}>
            <IconBack size={20} />
          </button>
        )}
        <span className="compact-title">{title}</span>
      </div>
    </header>
  )
}
