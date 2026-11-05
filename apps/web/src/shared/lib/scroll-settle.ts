/**
 * Дождаться, пока прокрутка остановится, — чтобы подсветка цели вспыхивала после приезда, а не
 * в начале плавной прокрутки (тогда к приезду она уже гасла). Слушаем `scroll`/`scrollend` в
 * фазе захвата на документе: так ловится прокрутка любого контейнера, не только окна.
 * Тишина 120 мс после последнего события; не было прокрутки вовсе (цель уже на экране) —
 * через 150 мс; потолок — 2,5 с.
 */
export function afterScrollSettles(done: () => void): () => void {
  let fired = false
  let quiet = window.setTimeout(finish, 150)
  const cap = window.setTimeout(finish, 2500)
  function finish(): void {
    if (fired) return
    fired = true
    cleanup()
    done()
  }
  function onScroll(): void {
    window.clearTimeout(quiet)
    quiet = window.setTimeout(finish, 120)
  }
  function cleanup(): void {
    window.clearTimeout(quiet)
    window.clearTimeout(cap)
    document.removeEventListener('scroll', onScroll, true)
    document.removeEventListener('scrollend', finish, true)
  }
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  document.addEventListener('scrollend', finish, true)
  return () => {
    fired = true
    cleanup()
  }
}

/** Плавно прокрутить к элементу и подсветить его (`data-flash`) уже после остановки. */
export function scrollToAndFlash(el: HTMLElement, ms = 1600): void {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  afterScrollSettles(() => {
    el.dataset.flash = 'true'
    window.setTimeout(() => delete el.dataset.flash, ms)
  })
}
