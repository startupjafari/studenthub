import { Logger } from '@nestjs/common'
import sharp from 'sharp'
import { brandMarkSvg, type BrandMarkVariant } from './brand-mark'

/**
 * Фирменный знак растром — для форматов, которые не умеют SVG.
 *
 * @react-pdf/renderer надёжно кладёт в документ PNG, а с SVG у него поддержка частичная,
 * поэтому знак для шапки документа растрируем заранее. Растр — не файл в репозитории, а
 * тот же самый `brandMarkSvg`: один источник формы на QR, PDF и всё остальное.
 *
 * Результат кешируется в памяти по размеру и варианту: отрисовка занимает единицы
 * миллисекунд, но выгрузка списка на тысячу строк вызвала бы её тысячу раз.
 */
const logger = new Logger('BrandLogo')
const cache = new Map<string, Buffer>()

/**
 * PNG со знаком. `null` — отрисовать не удалось.
 *
 * Не бросаем намеренно: документ без логотипа остаётся годным документом, а выгрузка,
 * упавшая из-за картинки, — нет (план брендирования, раздел «точки отказа»). Со шрифтом
 * в PDF решение обратное — там без файла текст выйдет пустым, и падать правильно.
 */
export async function brandLogoPng(
  sizePx: number,
  variant: BrandMarkVariant = 'plate',
): Promise<Buffer | null> {
  const key = `${variant}:${sizePx}`
  const cached = cache.get(key)
  if (cached) return cached

  try {
    const png = await sharp(Buffer.from(brandMarkSvg(sizePx, variant)))
      .png()
      .toBuffer()
    cache.set(key, png)
    return png
  } catch (error) {
    // Растеризация SVG в sharp опирается на librsvg: в урезанном образе её может не быть.
    logger.warn(
      `Не удалось отрисовать логотип (${key}): ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}
