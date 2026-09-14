'use client'

import { useEffect } from 'react'

/**
 * Поведение страницы: реакция шапки на прокрутку и счётчики.
 *
 * Один компонент на весь сайт, без разметки — он только навешивает наблюдателей.
 *
 * Появление блоков отсюда ушло: им занимается Framer Motion (`Reveal` в ui/motion.tsx),
 * и держать рядом второй механизм на `data-reveal` значило бы иметь два разных порога
 * срабатывания и две кривые на одной странице. Здесь осталось то, что к анимации
 * компонентов отношения не имеет: полоса прогресса документа, поведение шапки и счётчики,
 * которые меняют текст узла, а не его стиль.
 *
 * Устройство повторяет редизайн Seven Hills (index.html в корне репозитория) — у команды
 * уже есть работающий язык движения, и второй заводить незачем.
 *
 * Всё отключается при `prefers-reduced-motion`: блоки просто показываются, числа сразу
 * стоят на конечном значении, шапка не ездит.
 */
export function SiteMotion() {
  useEffect(() => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const cleanups: (() => void)[] = []

    /* --- счётчики -------------------------------------------------------- */
    const counters = document.querySelectorAll<HTMLElement>('[data-count]')

    const runCounter = (el: HTMLElement) => {
      const target = Number(el.dataset.count)
      if (!Number.isFinite(target)) return

      const locale = document.documentElement.lang || 'ru'
      const format = (value: number) =>
        el.hasAttribute('data-plain') ? String(value) : value.toLocaleString(locale)

      if (calm) {
        el.textContent = format(target)
        return
      }

      const started = performance.now()
      const duration = 1500

      const step = (now: number) => {
        const progress = Math.min((now - started) / duration, 1)
        // Замедление к концу: число подъезжает к значению, а не втыкается в него.
        const eased = 1 - Math.pow(1 - progress, 3)
        el.textContent = format(Math.round(target * eased))
        if (progress < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return
            runCounter(entry.target as HTMLElement)
            io.unobserve(entry.target)
          })
        },
        // Порог выше, чем у появления: считать имеет смысл, когда число уже видно целиком.
        { threshold: 0.6 },
      )
      counters.forEach((el) => io.observe(el))
      cleanups.push(() => io.disconnect())
    } else {
      counters.forEach(runCounter)
    }

    /* --- прокрутка: поведение шапки --------------------------------------- */
    const header = document.querySelector<HTMLElement>('.sh-header')

    /*
      Пороги с запасом («гистерезис»). Инерционная прокрутка — трекпад, тач, плавный
      скролл — даёт колебания в доли пикселя туда-обратно. По одному порогу класс на
      таких колебаниях включался и выключался каждый кадр, и шапка мерцала.

      Поэтому включение и выключение разведены: тень появляется после 24 px и снимается
      только при возврате выше 8, а направление засчитывается лишь при смещении больше
      6 px за кадр.
    */
    const STUCK_ON = 24
    const STUCK_OFF = 8
    const DIRECTION_THRESHOLD = 6

    let lastY = window.scrollY
    let stuck = false
    let hidden = false
    let ticking = false

    const onScroll = () => {
      const y = window.scrollY

      if (header) {
        if (!stuck && y > STUCK_ON) {
          stuck = true
          header.classList.add('is-stuck')
        } else if (stuck && y < STUCK_OFF) {
          stuck = false
          header.classList.remove('is-stuck')
        }

        const delta = y - lastY

        if (!calm && Math.abs(delta) > DIRECTION_THRESHOLD) {
          // Уезжает шапка только при движении вниз и только после первого экрана: у
          // самого верха прятать её незачем, а при движении вверх она нужна сразу.
          const shouldHide = y > 420 && delta > 0
          if (shouldHide !== hidden) {
            hidden = shouldHide
            header.classList.toggle('is-hidden', hidden)
          }
          // lastY двигается только на значимом смещении — иначе дрожание в один пиксель
          // накапливается и направление определяется случайно.
          lastY = y
        } else if (calm) {
          lastY = y
        }
      } else {
        lastY = y
      }
    }

    const onScrollRaf = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        onScroll()
        ticking = false
      })
    }

    window.addEventListener('scroll', onScrollRaf, { passive: true })
    cleanups.push(() => window.removeEventListener('scroll', onScrollRaf))
    onScroll()

    return () => cleanups.forEach((fn) => fn())
  }, [])

  return null
}
