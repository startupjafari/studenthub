// Крупный шрифт.
//
// Телефон в руке на ходу — не то же, что монитор на столе, и системная настройка размера
// шрифта до содержимого мини-аппа не доходит: Telegram открывает его во встроенном
// браузере со своими правилами.
//
// Масштаб живёт в localStorage этого мини-аппа, а не на сервере: это настройка устройства,
// а не человека — с телефона он хочет крупнее, с планшета может и нет.

const KEY = 'mini:font-scale'
const LARGE = 1.15

export function isLargeFont(): boolean {
  try {
    return localStorage.getItem(KEY) === 'large'
  } catch {
    // Приватный режим или запрет на хранилище — не повод падать: просто обычный размер.
    return false
  }
}

export function applyFontScale(large: boolean): void {
  // Через переменную, а не через font-size документа: кегль тела задан в rem от базового
  // размера (styles.css, --font-scale), и вся шкала --text-* считается от него. Процент
  // на документе разошёлся бы с абсолютным кеглем тела и не менял бы ничего.
  const root = document.documentElement
  if (large) root.style.setProperty('--font-scale', String(LARGE))
  else root.style.removeProperty('--font-scale')
  try {
    if (large) localStorage.setItem(KEY, 'large')
    else localStorage.removeItem(KEY)
  } catch {
    // Настройка не переживёт перезапуск — но текущий сеанс уже крупнее.
  }
}

/** Вызывается один раз при старте, до первой отрисовки. */
export function restoreFontScale(): void {
  if (isLargeFont()) applyFontScale(true)
}
