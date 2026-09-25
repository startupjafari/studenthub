import type { ReactNode } from 'react'
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
  return (
    <header className="screen-head">
      <div className={`head-row${tabs ? ' with-tabs' : ''}`}>
        {onBack && (
          <button
            type="button"
            className="head-back"
            aria-label={t('back')}
            onClick={() => {
              haptic.tap()
              onBack()
            }}
          >
            <IconBack size={22} />
          </button>
        )}
        <h1>{title}</h1>
        {/* Переключателю отдаётся вся оставшаяся ширина: делить её поровну с названием
            незачем — «Разобранные» длиннее любого из наших заголовков. */}
        {tabs && <div className="head-tabs">{tabs}</div>}
      </div>
      {subtitle && <p className="hint">{subtitle}</p>}
    </header>
  )
}
