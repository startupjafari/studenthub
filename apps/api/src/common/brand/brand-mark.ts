/**
 * Фирменный знак StudentHub — академическая шапочка.
 *
 * Жил внутри `common/qr/qr-image.ts` и был виден только в центре QR-кодов. Документы,
 * которые платформа выгружает наружу (план брендирования, этап A2), обязаны нести тот же
 * знак, а два одинаковых рисунка в разных файлах расходятся при первой же правке —
 * поэтому фигура переехала сюда, а QR и PDF берут её отсюда.
 *
 * Знак нарисован путями, а не взят иконкой из библиотеки: фигура — ромб, тулья и кисточка,
 * это дешевле, чем зависимость, и не требует растрового файла в репозитории.
 */

/** Брендовый синий — hex-приближение `--primary` из globals.css (SVG не видит css-переменные). */
export const BRAND_BLUE = '#2f6bf3'
const WHITE = '#ffffff'

/**
 * Фигуры знака в системе координат 24×24 — без обёртки и без цвета: цвет и трансформацию
 * задаёт вызывающая сторона своей группой. Так разметка остаётся ровно той же, что была
 * внутри QR до выноса, — знак в коде один, и картинка не «поехала» при переезде.
 */
function glyphShapes(): string {
  return [
    // Ромб-верх шапочки.
    `<path d="M12 3.4 22.6 8.6 12 13.8 1.4 8.6Z"/>`,
    // Тулья под ним.
    `<path d="M6.4 11.4v3.9c0 1.6 2.5 2.8 5.6 2.8s5.6-1.2 5.6-2.8v-3.9L12 14.2Z"/>`,
    // Кисточка.
    `<rect x="20.4" y="9.4" width="1.5" height="5" rx="0.75"/>`,
    `<circle cx="21.15" cy="15.4" r="1.35"/>`,
  ].join('')
}

/**
 * Бейдж для центра QR-кода: белая скруглённая плашка со знаком.
 * Координаты — в модулях QR, поэтому размер и центр приходят снаружи.
 */
export function brandMarkBadge(centre: number, span: number): string {
  const x = centre - span / 2
  const glyphSize = span * 0.66
  const gx = centre - glyphSize / 2
  const scale = glyphSize / 24

  return [
    `<g>`,
    `<rect x="${x}" y="${x}" width="${span}" height="${span}" rx="${span * 0.26}" fill="${WHITE}"/>`,
    `<g transform="translate(${gx} ${gx}) scale(${scale})" fill="${BRAND_BLUE}">`,
    glyphShapes(),
    `</g>`,
    `</g>`,
  ].join('')
}

export type BrandMarkVariant = 'plate' | 'glyph'

/**
 * Самостоятельный знак квадратом — для шапки документа.
 *
 * `plate` — синяя скруглённая плашка с белым знаком: узнаётся как иконка приложения,
 * держится на любом фоне. `glyph` — только знак синим, без подложки: для бланка, где
 * цветной квадрат в углу выглядит инородно.
 */
export function brandMarkSvg(sizePx: number, variant: BrandMarkVariant = 'plate'): string {
  const inner =
    variant === 'plate'
      ? [
          `<rect width="24" height="24" rx="6" fill="${BRAND_BLUE}"/>`,
          `<g transform="translate(3.6 3.6) scale(0.7)" fill="${WHITE}">`,
          glyphShapes(),
          `</g>`,
        ].join('')
      : `<g fill="${BRAND_BLUE}">${glyphShapes()}</g>`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 24 24">`,
    inner,
    `</svg>`,
  ].join('')
}
