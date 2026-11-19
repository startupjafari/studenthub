import { prefersReducedMotion } from '../../../shared/lib'

/**
 * Прокрутить к началу ближайший прокручиваемый контейнер элемента (в оболочке это `<main>`,
 * а не окно) — после «N новых публикаций»: новые посты встают сверху, туда и поднимаемся.
 */
export function scrollContainerToTop(el: HTMLElement | null): void {
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
  let node = el?.parentElement ?? null
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      node.scrollTo({ top: 0, behavior })
      return
    }
    node = node.parentElement
  }
  window.scrollTo({ top: 0, behavior })
}
