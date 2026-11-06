import { OG_CONTENT_TYPE, OG_SIZE, ogAlt, renderOgImage } from '../../og/og-image'

// Картинка превью русской версии — корня сайта. Генератор общий для трёх языков (src/og/og-image.tsx), а файл
// лежит здесь, чтобы Next положил адрес картинки в метаданные именно этой страницы.
export const alt = ogAlt('ru')
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage('ru')
}
