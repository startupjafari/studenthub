/**
 * Можно ли загружать картинку из пользовательского markdown автоматически.
 *
 * Внешняя картинка в сообщении, статье или «о себе» — это запрос с устройства каждого
 * читателя на чужой сервер: автор получает IP, браузер и время прочтения (трекинг-пиксель),
 * мимо настроек приватности. Свои источники — сам веб, API и хранилище файлов; остальное
 * показываем ссылкой, по которой человек перейдёт сам, если захочет.
 */
export function isTrustedImageUrl(src: string | undefined | null): boolean {
  if (!src) return false
  if (src.startsWith('data:image/') || src.startsWith('blob:')) return true
  const own = typeof window !== 'undefined' ? window.location.origin : undefined
  try {
    const url = new URL(src, own ?? 'http://invalid.local')
    return trustedOrigins(own).has(url.origin)
  } catch {
    return false
  }
}

function trustedOrigins(own: string | undefined): Set<string> {
  const origins = new Set<string>()
  if (own) origins.add(own)
  for (const raw of [process.env.NEXT_PUBLIC_MINIO_URL, process.env.NEXT_PUBLIC_API_URL]) {
    if (!raw) continue
    try {
      origins.add(new URL(raw).origin)
    } catch {
      // Битая переменная окружения — просто не доверяем этому источнику.
    }
  }
  return origins
}
