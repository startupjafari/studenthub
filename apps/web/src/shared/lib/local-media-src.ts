/**
 * Адрес локального превью медиа для `src` у <img> и <video>: только `blob:` из
 * `URL.createObjectURL`. Остальное — undefined, чтобы в `src` не попали ни `javascript:`,
 * ни `data:text/html`, ни чужой адрес. Строку с HTML-метасимволами тоже не пропускаем:
 * в настоящем blob-адресе (origin + uuid) их не бывает.
 */
export function localMediaSrc(url: string | null | undefined): string | undefined {
  if (!url || !url.startsWith('blob:') || /["'&<>]/.test(url)) return undefined
  return url
}
