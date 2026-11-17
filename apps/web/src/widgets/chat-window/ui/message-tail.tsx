import { cn } from '../../../shared/lib/utils'

/**
 * Хвостик пузыря — только у последнего сообщения серии, как в Telegram. Рисуется цветом
 * самого пузыря (`fill-primary` / `fill-muted`), поэтому одинаково держится в обеих темах.
 * Угол пузыря на стороне хвостика при этом прямой — хвостик продолжает его край.
 * Форма своя: вогнутая дуга от края пузыря к острию у нижней кромки.
 */
export function MessageTail({ mine }: { mine: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 9 17"
      width="9"
      height="17"
      className={cn(
        // На пиксель внахлёст с пузырём — иначе на дробном масштабе между ними виден шов.
        'pointer-events-none absolute bottom-0',
        mine ? '-right-2 fill-primary' : '-left-2 -scale-x-100 fill-muted',
      )}
    >
      <path d="M1 0C1 7.5 3.5 13.5 9 16.4V17H0V0Z" />
    </svg>
  )
}
