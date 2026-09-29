import type { ReactNode } from 'react'
import { t } from '../i18n'

/**
 * Плашка пустоты и отказа.
 *
 * Занимает всё, что осталось от экрана, а текст стоит в её середине. Карточка в две
 * строки под заголовком выглядела как первая запись списка, за которой сейчас появятся
 * остальные, — и человек ждал загрузки там, где всё уже загрузилось. Пустой экран обязан
 * выглядеть пустым: тогда «ничего нет» читается с одного взгляда, а не вычитывается.
 *
 * Отказ отличается от пустоты только наличием кнопки: пустота — это ответ, повторять
 * который незачем, а отказ — вопрос без ответа, и его переспрашивают.
 */
export function StatePlate({
  title,
  text,
  onRetry,
  children,
}: {
  title: string
  text?: string
  onRetry?: () => void
  children?: ReactNode
}) {
  return (
    <section className="card plate">
      <h2>{title}</h2>
      {text && <p className="hint">{text}</p>}
      {onRetry && (
        <button type="button" className="fallback-submit plate-action" onClick={onRetry}>
          {t('retry')}
        </button>
      )}
      {children}
    </section>
  )
}
