import * as QRCode from 'qrcode'

/**
 * Единый рендер QR-кодов платформы: скруглённые модули, скруглённая подложка и логотип
 * StudentHub в центре. Все QR (2FA, вход по QR, студенческий билет, наклейка помещения,
 * отметка посещаемости) идут через эту функцию, чтобы выглядеть одинаково.
 *
 * Рисуем SVG сами, а не берём стилизующую библиотеку: `qrcode` уже в зависимостях и умеет
 * отдать матрицу модулей (`create`), а всё остальное — это несколько прямоугольников.
 * Новая зависимость ради скруглений не окупается.
 *
 * Логотип перекрывает центр, поэтому коррекция ошибок всегда `H` (30% площади можно
 * потерять). Сам логотип занимает ~24% ширины и стоит на «вырезанной» области — модули
 * под ним не рисуются, иначе картинка мешала бы распознаванию.
 */

/** Цвет модулей. Максимальный контраст: наклейки печатают и сканируют в плохом свете. */
const DARK = '#000000'
const LIGHT = '#ffffff'
/** Брендовый синий — hex-приближение `--primary` из globals.css (SVG в <img> не видит CSS-переменные). */
const BRAND = '#2f6bf3'

/** Доля ширины кода, которую занимает бейдж логотипа. Выше ~30% — риск для распознавания. */
const LOGO_RATIO = 0.24
/** Радиус скругления подложки в модулях. */
const PLATE_RADIUS = 2
/** Скругление модуля: доля от его стороны. */
const MODULE_RADIUS = 0.3

export interface QrImageOptions {
  /** Ширина картинки в пикселях (SVG всё равно масштабируется, но <img> без CSS берёт её). */
  width?: number
  /** Ширина тихой зоны в модулях. */
  margin?: number
  /** Рисовать логотип в центре. Выключается для очень мелких кодов. */
  logo?: boolean
}

/**
 * QR-код как `data:image/svg+xml;base64,…` — подставляется в `<img src>` как раньше PNG.
 */
export function renderQrDataUrl(text: string, options: QrImageOptions = {}): string {
  const { width = 320, margin = 2, logo = true } = options

  // Коррекция H обязательна: центр закрыт логотипом.
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' })
  const size = qr.modules.size
  const data = qr.modules.data
  const total = size + margin * 2

  // Область под логотипом, в координатах модулей. Вырезаем чуть больше самого бейджа,
  // чтобы вокруг него осталось светлое поле.
  const logoSpan = logo ? Math.max(5, Math.round(size * LOGO_RATIO)) : 0
  const clearSpan = logoSpan + 2
  const centre = total / 2
  const clearFrom = centre - clearSpan / 2
  const clearTo = centre + clearSpan / 2

  const parts: string[] = []

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!data[y * size + x]) continue
      // Три «глаза» рисуем отдельными фигурами — сеткой из точек они выглядят рвано.
      if (isFinder(x, y, size)) continue
      const cx = margin + x + 0.5
      const cy = margin + y + 0.5
      if (logo && cx > clearFrom && cx < clearTo && cy > clearFrom && cy < clearTo) continue
      parts.push(
        `<rect x="${margin + x}" y="${margin + y}" width="1" height="1" rx="${MODULE_RADIUS}"/>`,
      )
    }
  }

  for (const [fx, fy] of finderOrigins(size)) {
    parts.push(finder(margin + fx, margin + fy))
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${total} ${total}" shape-rendering="geometricPrecision">`,
    `<rect width="${total}" height="${total}" rx="${PLATE_RADIUS}" fill="${LIGHT}"/>`,
    `<g fill="${DARK}">${parts.join('')}</g>`,
    logo ? logoBadge(centre, logoSpan) : '',
    `</svg>`,
  ].join('')

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

/** Левые верхние углы трёх поисковых узоров (7×7 модулей каждый). */
function finderOrigins(size: number): Array<[number, number]> {
  return [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ]
}

function isFinder(x: number, y: number, size: number): boolean {
  return finderOrigins(size).some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7)
}

/** Поисковый узор: скруглённая рамка 7×7 (толщиной в модуль) и скруглённое ядро 3×3. */
function finder(x: number, y: number): string {
  return [
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.9" fill="none" stroke="${DARK}" stroke-width="1"/>`,
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.95"/>`,
  ].join('')
}

/**
 * Бейдж с логотипом StudentHub: белая скруглённая плашка и академическая шапочка.
 * Шапочка нарисована здесь, а не взята из lucide: в API этой библиотеки нет, а фигура —
 * ромб, тулья и кисточка.
 */
function logoBadge(centre: number, span: number): string {
  const x = centre - span / 2
  const glyph = span * 0.66
  const gx = centre - glyph / 2
  const scale = glyph / 24

  return [
    `<g>`,
    `<rect x="${x}" y="${x}" width="${span}" height="${span}" rx="${span * 0.26}" fill="${LIGHT}"/>`,
    `<g transform="translate(${gx} ${gx}) scale(${scale})" fill="${BRAND}">`,
    // Ромб-верх шапочки.
    `<path d="M12 3.4 22.6 8.6 12 13.8 1.4 8.6Z"/>`,
    // Тулья под ним.
    `<path d="M6.4 11.4v3.9c0 1.6 2.5 2.8 5.6 2.8s5.6-1.2 5.6-2.8v-3.9L12 14.2Z"/>`,
    // Кисточка.
    `<rect x="20.4" y="9.4" width="1.5" height="5" rx="0.75"/>`,
    `<circle cx="21.15" cy="15.4" r="1.35"/>`,
    `</g>`,
    `</g>`,
  ].join('')
}
