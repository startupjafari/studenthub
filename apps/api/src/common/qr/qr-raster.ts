import { Logger } from '@nestjs/common'
import sharp from 'sharp'
import { renderQrDataUrl, type QrImageOptions } from './qr-image'

/**
 * Тот же фирменный QR, но растром — для PDF.
 *
 * `renderQrDataUrl` отдаёт SVG: он лёгкий и не мылится в браузере. Но @react-pdf надёжно
 * кладёт в документ только PNG, поэтому здесь SVG растрируется. Отдельный рендер QR ради
 * PDF заводить нельзя: код в справке обязан выглядеть так же, как на наклейке помещения и
 * в студенческом — это один визуальный язык платформы.
 *
 * Кеш не нужен: каждый документ несёт свой код, повторов не бывает.
 */
const logger = new Logger('QrRaster')

/** PNG как `data:image/png;base64,…`. `null` — отрисовать не удалось. */
export async function renderQrPngDataUrl(
  text: string,
  options: QrImageOptions = {},
): Promise<string | null> {
  try {
    const svg = renderQrDataUrl(text, options).split(',')[1]
    if (!svg) return null
    const png = await sharp(Buffer.from(svg, 'base64')).png().toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch (error) {
    // Растеризация опирается на librsvg внутри sharp. Для официального документа отсутствие
    // QR — повод отказать (решает вызывающая сторона), поэтому ошибку видно в логе.
    logger.warn(
      `Не удалось отрисовать QR: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}
