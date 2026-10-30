// Раскладка производных объектов в бакете. Все варианты файла — под одним префиксом
// `variants/<fileId>/`: удаление файла сносит префикс целиком, а ночная чистка по префиксу
// понимает, чей это объект, без отдельной записи на каждый сегмент HLS.

export const VARIANTS_ROOT = 'variants/'

export function variantPrefix(fileId: string): string {
  return `${VARIANTS_ROOT}${fileId}/`
}

export function imageVariantKey(fileId: string, width: number): string {
  return `${variantPrefix(fileId)}w${width}.webp`
}

export function posterVariantKey(fileId: string, width: number): string {
  return `${variantPrefix(fileId)}poster-w${width}.webp`
}

/** Каталог рендишна HLS; плейлист — `index.m3u8`, сегменты — `seg-NNNN.ts` рядом. */
export function hlsRenditionDir(fileId: string, height: number): string {
  return `${variantPrefix(fileId)}hls/${height}/`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** id файла-владельца по ключу варианта; `null` — ключ не из раскладки вариантов. */
export function variantOwnerId(key: string): string | null {
  if (!key.startsWith(VARIANTS_ROOT)) return null
  const id = key.slice(VARIANTS_ROOT.length).split('/')[0] ?? ''
  return UUID_RE.test(id) ? id : null
}
