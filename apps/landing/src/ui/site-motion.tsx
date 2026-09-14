'use client'

import { useEffect } from 'react'

/**
 * Поведение страницы: появление блоков, индикатор прокрутки, реакция шапки, счётчики.
 *
 * Один компонент на весь сайт, без разметки — он только навешивает наблюдателей. Так
 * механизм появления ровно один: иначе каждая секция заводила бы свой IntersectionObserver
 * и свой порог, и блоки начали бы всплывать вразнобой.
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

    /* --- появление блоков ------------------------------------------------ */
    const revealables = document.querySelectorAll<HTMLElement>('[data-reveal]')

    if (calm || !('IntersectionObserver' in window)) {
      revealables.forEach((el) => el.classList.add('in'))
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return
            entry.target.classList.add('in')
            // Появление одноразовое: блок, который уплыл и приплыл обратно, не должен
            // проявляться заново — это выглядит как сбой, а не как приём.
            io.unobserve(entry.target)
          })
        },
        { rootMargin: '0px 0px -6% 0px', threshold: 0 },
      )
      revealables.forEach((el) => io.observe(el))
      cleanups.push(() => io.disconnect())
    }

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

    /* --- прокрутка: индикатор и шапка ------------------------------------ */
    const bar = document.querySelector<HTMLElement>('.sh-progress-bar')
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

      if (bar) {
        const height = document.documentElement.scrollHeight - window.innerHeight
        bar.style.transform = `scaleX(${height > 0 ? y / height : 0})`
      }

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

/** Полоса прогресса прокрутки. Рисуется в разметке, двигается из SiteMotion. */
export function ProgressBar() {
  return <div className="sh-progress-bar" aria-hidden />
}
