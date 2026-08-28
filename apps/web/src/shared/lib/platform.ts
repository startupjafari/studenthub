'use client'

// Определение платформы и режима запуска. Вынесено отдельно, потому что нужно двум
// несвязанным местам: кнопке установки на главный экран и проверке доступности push.

/**
 * iOS/iPadOS. iPadOS 13+ представляется маком, поэтому отличаем по тач-экрану:
 * настоящий macOS отдаёт `maxTouchPoints === 0`.
 */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** Приложение запущено с главного экрана (не вкладка браузера). */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  const byMedia =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  // Safari на iOS не поддерживает display-mode и отдаёт нестандартное navigator.standalone.
  return byMedia || (navigator as Navigator & { standalone?: boolean }).standalone === true
}
