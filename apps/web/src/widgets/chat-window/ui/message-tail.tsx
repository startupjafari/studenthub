import type { CSSProperties } from 'react'
import { cn } from '../../../shared/lib/utils'

/** Контур хвостика своего пузыря (справа); чужой — зеркально. Коробка 9×17. */
const TAIL_PATH = 'M1 0C1 7.5 3.5 13.5 9 16.4V17H0V0Z'
const TAIL_PATH_MIRRORED = 'M8 0C8 7.5 5.5 13.5 0 16.4V17H9V0Z'
const TAIL_W = 9
const TAIL_H = 17
/** Насколько хвостик выступает за край пузыря: 9 px коробки минус пиксель внахлёст. */
const TAIL_OUT = TAIL_W - 1

/**
 * Хвостик пузыря — только у последнего сообщения серии, как в Telegram. Рисуется цветом
 * самого пузыря (`fill-primary` / `fill-card`, в тёмной теме `fill-muted`), поэтому одинаково держится в обеих темах.
 * Угол пузыря на стороне хвостика при этом прямой — хвостик продолжает его край.
 * Форма своя: вогнутая дуга от края пузыря к острию у нижней кромки.
 */
export function MessageTail({ mine }: { mine: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${TAIL_W} ${TAIL_H}`}
      width={TAIL_W}
      height={TAIL_H}
      className={cn(
        // На пиксель внахлёст с пузырём — иначе на дробном масштабе между ними виден шов.
        'pointer-events-none absolute bottom-0',
        mine ? '-right-2 fill-primary' : '-left-2 -scale-x-100 fill-card dark:fill-muted',
      )}
    >
      <path d={TAIL_PATH} />
    </svg>
  )
}

const tailMaskUrl = (mine: boolean): string =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TAIL_W}" height="${TAIL_H}" viewBox="0 0 ${TAIL_W} ${TAIL_H}"><path d="${mine ? TAIL_PATH : TAIL_PATH_MIRRORED}"/></svg>`,
  )}")`

/**
 * Хвостик снимка без пузыря (Telegram): у кадра нет цветной подложки, и хвостик рисуется
 * не фигурой цвета пузыря, а маской самого кадра — нижний угол снимка вытягивается в
 * хвостик из тех же пикселей. Цветная фигура рядом с фотографией читалась бы как обрывок
 * чужого пузыря.
 *
 * Маска не рисует за пределами коробки, поэтому хвостик вырезается ВНУТРИ кадра: полоса
 * шириной с хвостик на его стороне скрыта целиком, кроме самого хвостика внизу, а коробка
 * сдвинута на ту же ширину наружу (`left`/`right`, без влияния на раскладку). Видимый край
 * снимка остаётся там, где край любого пузыря, хвостик выступает так же, как у текстового.
 * Цена — полоса кадра шириной 8 px на стороне хвостика.
 *
 * Слои маски (складываются): тело без полосы и без колонки под скруглённым верхним углом;
 * эта колонка ниже угла; сам угол четвертью круга; хвостик. Дальние от хвостика углы
 * скругляет обычный `border-radius` коробки.
 *
 * @param corners углы кадра (как у пузыря): на стороне хвостика нижний не используется
 */
export function mediaTailStyle(
  mine: boolean,
  corners: { tl: string; tr: string; br: string; bl: string },
): CSSProperties {
  const r = mine ? corners.tr : corners.tl
  const side = mine ? 'right' : 'left'
  const far = mine ? 'left' : 'right'
  const solid = 'linear-gradient(#000 0 0)'
  // Четверть круга с центром в нижнем углу плитки, обращённом к телу кадра.
  const quarter = `radial-gradient(circle at ${mine ? '0 100%' : '100% 100%'}, #000 calc(${r} - 0.5px), transparent ${r})`
  const image = [solid, solid, quarter, tailMaskUrl(mine)].join(', ')
  const position = [
    `${far} 0 top 0`,
    `${side} ${TAIL_OUT}px bottom 0`,
    `${side} ${TAIL_OUT}px top 0`,
    `${side} 0 bottom 0`,
  ].join(', ')
  const size = [
    `calc(100% - ${TAIL_OUT}px - ${r}) 100%`,
    `${r} calc(100% - ${r})`,
    `${r} ${r}`,
    `${TAIL_W}px ${TAIL_H}px`,
  ].join(', ')
  return {
    position: 'relative',
    [side]: -TAIL_OUT,
    borderRadius: mine ? `${corners.tl} 0 0 ${corners.bl}` : `0 ${corners.tr} ${corners.br} 0`,
    maskImage: image,
    maskPosition: position,
    maskSize: size,
    maskRepeat: 'no-repeat',
    WebkitMaskImage: image,
    WebkitMaskPosition: position,
    WebkitMaskSize: size,
    WebkitMaskRepeat: 'no-repeat',
  }
}
