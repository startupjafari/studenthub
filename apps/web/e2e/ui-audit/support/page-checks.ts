import type { Page } from '@playwright/test'
import { THRESHOLDS, type AuditViewport } from '../config'
import type { Category, Severity } from './findings'

// Проверки, выполняемые внутри страницы. Всё в одном page.evaluate на каждую ширину:
// обход DOM стоит дорого, а десяток отдельных вызовов через мост Playwright стоит дороже.

export interface RawFinding {
  category: Category
  severity: Severity
  message: string
  selector?: string
  snippet?: string
}

export interface InspectResult {
  findings: RawFinding[]
  /** Категория → сколько находок отброшено сверх потолка. */
  truncated: Record<string, number>
}

/**
 * Раскладка на конкретной ширине: горизонтальная прокрутка (и её виновники), обрезанное
 * содержимое, цели нажатия, нечитаемо мелкий текст.
 */
export async function inspectLayout(page: Page, viewport: AuditViewport): Promise<InspectResult> {
  return page.evaluate(
    ({ vw, touch, t }) => {
      const findings: {
        category: string
        severity: string
        message: string
        selector?: string
        snippet?: string
      }[] = []
      const truncated: Record<string, number> = {}

      // ── Вспомогательное ────────────────────────────────────────────────────
      function shortPath(el: Element): string {
        const parts: string[] = []
        let node: Element | null = el
        for (let depth = 0; node && depth < 3; depth += 1) {
          let part = node.tagName.toLowerCase()
          if (node.id) part += `#${node.id}`
          else {
            // Первые два класса: в Tailwind-проекте класс — это и есть то, что грепается
            // в коде компонента, поэтому он полезнее, чем nth-child.
            const cls = Array.from(node.classList).slice(0, 2).join('.')
            if (cls) part += `.${cls}`
          }
          parts.unshift(part)
          node = node.parentElement
        }
        return parts.join(' > ')
      }

      function snippetOf(el: Element): string {
        return el.outerHTML.replace(/\s+/g, ' ').slice(0, 140)
      }

      function isVisible(el: Element): boolean {
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        if (Number(style.opacity) === 0) return false
        if (el.closest('[aria-hidden="true"]') !== null) return false
        if (el.closest('[inert]') !== null) return false
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }

      /** Контейнер, который сам обрезает или прокручивает содержимое по горизонтали. */
      function clipsHorizontally(el: Element): boolean {
        const overflowX = getComputedStyle(el).overflowX
        return overflowX !== 'visible'
      }

      /** Записать находку, соблюдая потолок на категорию. */
      const counts: Record<string, number> = {}
      function push(f: {
        category: string
        severity: string
        message: string
        selector?: string
        snippet?: string
      }): void {
        const seen = counts[f.category] ?? 0
        counts[f.category] = seen + 1
        if (seen >= t.maxPerCategory) {
          truncated[f.category] = (truncated[f.category] ?? 0) + 1
          return
        }
        findings.push(f)
      }

      const all = Array.from(document.body.querySelectorAll<HTMLElement>('*'))

      // ── 1. Горизонтальная прокрутка страницы ───────────────────────────────
      const doc = document.documentElement
      const overflow = doc.scrollWidth - doc.clientWidth
      if (overflow > t.overflowPx) {
        push({
          category: 'overflow',
          severity: 'HIGH',
          message: `страница шире окна на ${overflow}px — появилась горизонтальная прокрутка`,
        })

        // Ищем виновника. Элемент за правой границей виноват только если ни один его предок
        // не обрезает и не прокручивает содержимое: под overflow-x:auto длинный ряд табов
        // или таблица скроллятся сами и ширину документа не увеличивают (DESIGN_SYSTEM §15).
        // Без этого фильтра каждый такой ряд попадал бы в отчёт ложной находкой.
        const culprits: { el: Element; over: number }[] = []
        for (const el of all) {
          if (!isVisible(el)) continue
          const style = getComputedStyle(el)
          // Фиксированный элемент не входит в область прокрутки документа — он не может
          // быть причиной, даже если торчит за край (выехавшая шторка, тост).
          if (style.position === 'fixed') continue
          const rect = el.getBoundingClientRect()
          const over = Math.round(Math.max(rect.right - vw, -rect.left))
          if (over <= t.overflowPx) continue
          let clipped = false
          for (let p = el.parentElement; p !== null && p !== doc; p = p.parentElement) {
            if (clipsHorizontally(p)) {
              clipped = true
              break
            }
          }
          if (!clipped) culprits.push({ el, over })
        }
        // Потомок вылезает вместе с родителем — виноват внешний, его и показываем.
        const outer = culprits.filter(
          (c) => !culprits.some((other) => other !== c && other.el.contains(c.el)),
        )
        for (const c of outer) {
          push({
            category: 'overflow',
            severity: 'HIGH',
            message: `элемент выходит за правую границу окна на ${c.over}px`,
            selector: shortPath(c.el),
            snippet: snippetOf(c.el),
          })
        }
      }

      // ── 2. Обрезанное содержимое ───────────────────────────────────────────
      // Контейнер с overflow:hidden, внутри которого содержимое не помещается: прокрутить
      // нельзя, многоточия нет — текст просто исчезает. Осознанные обрезки (line-clamp,
      // text-overflow: ellipsis) пропускаем: это приём, а не дефект.
      for (const el of all) {
        if (!isVisible(el)) continue
        const style = getComputedStyle(el)
        // Подпись только для скринридера (`sr-only`) обрезана по определению: коробка 1×1px
        // с overflow:hidden — так текст и прячут от глаз, оставляя его озвучиваемым. Без
        // этой ветки каждая таблица со скрытым заголовком колонки «Действия» давала находку.
        if (el.clientWidth <= 1 || el.clientHeight <= 1) continue
        const hasClamp = style.webkitLineClamp !== 'none' && style.webkitLineClamp !== ''
        if (hasClamp || style.textOverflow === 'ellipsis') continue
        const text = (el.textContent ?? '').trim()
        if (text.length === 0) continue

        const clippedY = style.overflowY === 'hidden' && el.scrollHeight - el.clientHeight > 2
        const clippedX = style.overflowX === 'hidden' && el.scrollWidth - el.clientWidth > 2
        if (!clippedY && !clippedX) continue
        // Внутри лежит собственный скролл-контейнер, который и уносит переполнение: до
        // содержимого читатель доберётся прокруткой, обрезки нет. Так каркас приложения
        // (`div.fixed.inset-0`) выглядел «обрезанным на 26000px» ровно потому, что внутри
        // него прокручивается `main`. Сравниваем величину переполнения, а не сам факт
        // вложенного скроллера: иначе проверка замолчит и там, где режет по-настоящему.
        const overflow = clippedY
          ? el.scrollHeight - el.clientHeight
          : el.scrollWidth - el.clientWidth
        const absorbedByInnerScroll = Array.from(el.querySelectorAll('*')).some((inner) => {
          const s = getComputedStyle(inner)
          const scrollsY = s.overflowY === 'auto' || s.overflowY === 'scroll'
          const scrollsX = s.overflowX === 'auto' || s.overflowX === 'scroll'
          if (clippedY && scrollsY) return inner.scrollHeight - inner.clientHeight >= overflow - 8
          if (clippedX && scrollsX) return inner.scrollWidth - inner.clientWidth >= overflow - 8
          return false
        })
        if (absorbedByInnerScroll) continue
        // Отсекаем «обрезан» у элементов, чьё содержимое обрезано выше по дереву: сообщение
        // о внешнем контейнере точнее.
        const axis = clippedY ? 'по высоте' : 'по ширине'
        const amount = clippedY
          ? el.scrollHeight - el.clientHeight
          : el.scrollWidth - el.clientWidth
        push({
          category: 'clipped',
          severity: 'MEDIUM',
          message: `содержимое обрезано ${axis} на ${amount}px без прокрутки и многоточия`,
          selector: shortPath(el),
          snippet: snippetOf(el),
        })
      }

      // ── 3. Цели нажатия (только тач-ширины) ────────────────────────────────
      if (touch) {
        const INTERACTIVE = [
          'a[href]',
          'button',
          'input:not([type="hidden"])',
          'select',
          'textarea',
          'summary',
          '[role="button"]',
          '[role="link"]',
          '[role="tab"]',
          '[role="switch"]',
          '[role="checkbox"]',
          '[role="radio"]',
          '[role="menuitem"]',
        ].join(',')

        /**
         * Исключение «инлайновая цель» из WCAG 2.5.8: цель внутри предложения ограничена
         * высотой строки соседнего текста, и увеличить её нельзя, не разорвав абзац.
         * Проверяем буквально это — есть ли рядом непустой текст, — а не display: inline:
         * ссылку в тексте часто делают inline-block или flex ради иконки, и проверка по
         * display пропускала бы её мимо исключения.
         */
        function isInlineTarget(el: Element): boolean {
          if (getComputedStyle(el).display === 'inline') return true
          const parent = el.parentElement
          if (parent === null) return false
          for (const node of Array.from(parent.childNodes)) {
            if (node === el) continue
            if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '') {
              return true
            }
          }
          return false
        }

        for (const el of Array.from(document.body.querySelectorAll<HTMLElement>(INTERACTIVE))) {
          if (!isVisible(el)) continue
          if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') continue
          if (isInlineTarget(el)) continue

          const rect = el.getBoundingClientRect()
          const side = Math.round(Math.min(rect.width, rect.height))
          if (side >= t.touchTargetIdealPx) continue

          const size = `${Math.round(rect.width)}×${Math.round(rect.height)}px`
          const hard = side < t.touchTargetHardPx
          push({
            category: 'touch',
            severity: hard ? 'HIGH' : 'LOW',
            message: hard
              ? `цель нажатия ${size} меньше минимума WCAG 2.5.8 (${t.touchTargetHardPx}×${t.touchTargetHardPx}) — область нажатия увеличивают отступами, не размером иконки`
              : `цель нажатия ${size} меньше нормы проекта ${t.touchTargetIdealPx}×${t.touchTargetIdealPx} (DESIGN_SYSTEM §13)`,
            selector: shortPath(el),
            snippet: snippetOf(el),
          })
        }
      }

      // ── 4. Нечитаемо мелкий текст ──────────────────────────────────────────
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const reported = new Set<Element>()
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = (node.textContent ?? '').trim()
        if (text.length === 0) continue
        const parent = node.parentElement
        if (parent === null || reported.has(parent) || !isVisible(parent)) continue
        const size = parseFloat(getComputedStyle(parent).fontSize)
        if (Number.isNaN(size) || size >= t.minFontSizePx) continue
        reported.add(parent)
        push({
          category: 'typography',
          severity: 'MEDIUM',
          message: `размер шрифта ${size}px меньше читаемого минимума ${t.minFontSizePx}px: «${text.slice(0, 40)}»`,
          selector: shortPath(parent),
        })
      }

      return { findings, truncated }
    },
    { vw: viewport.width, touch: viewport.touch, t: THRESHOLDS },
  ) as Promise<InspectResult>
}

/**
 * Проверки, не зависящие от ширины окна: доступные имена, подписи полей, alt, дубли id,
 * иерархия заголовков. Гоняются один раз на экран — на всех семи ширинах они дали бы
 * семь копий одной находки.
 */
export async function inspectSemantics(page: Page): Promise<InspectResult> {
  return page.evaluate(
    ({ t }) => {
      const findings: {
        category: string
        severity: string
        message: string
        selector?: string
        snippet?: string
      }[] = []
      const truncated: Record<string, number> = {}
      const counts: Record<string, number> = {}

      function shortPath(el: Element): string {
        const parts: string[] = []
        let node: Element | null = el
        for (let depth = 0; node && depth < 3; depth += 1) {
          let part = node.tagName.toLowerCase()
          if (node.id) part += `#${node.id}`
          else {
            const cls = Array.from(node.classList).slice(0, 2).join('.')
            if (cls) part += `.${cls}`
          }
          parts.unshift(part)
          node = node.parentElement
        }
        return parts.join(' > ')
      }

      function snippetOf(el: Element): string {
        return el.outerHTML.replace(/\s+/g, ' ').slice(0, 140)
      }

      function isVisible(el: Element): boolean {
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }

      function push(f: {
        category: string
        severity: string
        message: string
        selector?: string
        snippet?: string
      }): void {
        const key = `${f.category}:${f.message.slice(0, 20)}`
        const seen = counts[key] ?? 0
        counts[key] = seen + 1
        if (seen >= t.maxPerCategory) {
          truncated[f.category] = (truncated[f.category] ?? 0) + 1
          return
        }
        findings.push(f)
      }

      /**
       * Подпись элемента через `<label>`: связанная по `for`/`id` либо охватывающая.
       * Текст самого элемента из результата вычитается — иначе кнопка «получит имя» от
       * собственного содержимого и проверка перестанет ловить настоящие безымянные иконки.
       */
      function labelText(el: Element): string {
        const id = el.getAttribute('id')
        const labels: Element[] = []
        if (id !== null && id !== '') {
          labels.push(...Array.from(document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)))
        }
        const wrapper = el.closest('label')
        if (wrapper !== null) labels.push(wrapper)
        const own = (el.textContent ?? '').trim()
        for (const label of labels) {
          const text = (label.textContent ?? '').trim()
          const withoutOwn = own === '' ? text : text.replace(own, '').trim()
          if (withoutOwn !== '') return withoutOwn
        }
        return ''
      }

      /** Доступное имя: то, что объявит скринридер. */
      function accessibleName(el: Element): string {
        const labelledBy = el.getAttribute('aria-labelledby')
        if (labelledBy !== null) {
          const parts = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
          if (parts.trim() !== '') return parts.trim()
        }
        const aria = el.getAttribute('aria-label')
        if (aria !== null && aria.trim() !== '') return aria.trim()
        const title = el.getAttribute('title')
        if (title !== null && title.trim() !== '') return title.trim()
        const text = (el.textContent ?? '').trim()
        if (text !== '') return text
        // Подпись через <label>. Кнопка — labelable-элемент HTML, поэтому и `label[for]`,
        // и обёртка `<label>` дают ей доступное имя: Chromium объявляет такой Radix-чекбокс
        // (<button role="checkbox">) именем из подписи. Без этой ветки проверка считала
        // «безымянным» каждый корректно подписанный чекбокс проекта.
        const fromLabel = labelText(el)
        if (fromLabel !== '') return fromLabel
        // Иконка с подписью внутри кнопки: <button><img alt="Закрыть"></button>.
        const img = el.querySelector('img[alt]')
        const alt = img?.getAttribute('alt') ?? ''
        if (alt.trim() !== '') return alt.trim()
        const svgTitle = el.querySelector('svg > title')?.textContent ?? ''
        return svgTitle.trim()
      }

      // ── Кнопки и ссылки без доступного имени ───────────────────────────────
      // Скринридер объявит такой элемент как «кнопка» — что она делает, понять нельзя.
      for (const el of Array.from(
        document.querySelectorAll('button, a[href], [role="button"], [role="link"]'),
      )) {
        if (!isVisible(el)) continue
        if (accessibleName(el) !== '') continue
        push({
          category: 'a11y',
          severity: 'HIGH',
          message: 'интерактивный элемент без доступного имени',
          selector: shortPath(el),
          snippet: snippetOf(el),
        })
      }

      // ── Изображения без alt ────────────────────────────────────────────────
      // alt="" — валидно (декоративная картинка), отсутствие атрибута — нет.
      for (const img of Array.from(document.querySelectorAll('img'))) {
        if (!isVisible(img)) continue
        if (img.hasAttribute('alt')) continue
        if (
          img.getAttribute('aria-hidden') === 'true' ||
          img.getAttribute('role') === 'presentation'
        )
          continue
        push({
          category: 'a11y',
          severity: 'MEDIUM',
          message: 'изображение без атрибута alt',
          selector: shortPath(img),
          snippet: snippetOf(img),
        })
      }

      // ── Поля без подписи ───────────────────────────────────────────────────
      const FIELD =
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
      for (const field of Array.from(document.querySelectorAll(FIELD))) {
        if (!isVisible(field)) continue
        const id = field.getAttribute('id')
        const hasLabelFor =
          id !== null && document.querySelector(`label[for="${CSS.escape(id)}"]`) !== null
        const wrapped = field.closest('label') !== null
        const named = accessibleName(field) !== ''
        if (hasLabelFor || wrapped || named) continue
        const placeholder = field.getAttribute('placeholder')
        push({
          category: 'a11y',
          severity: placeholder !== null ? 'LOW' : 'MEDIUM',
          message:
            placeholder !== null
              ? 'у поля только placeholder вместо подписи — она исчезает при вводе'
              : 'поле без связанной подписи (<label for>, aria-label)',
          selector: shortPath(field),
          snippet: snippetOf(field),
        })
      }

      // ── Дубли id ───────────────────────────────────────────────────────────
      // Ломают label[for], aria-labelledby и querySelector: связь уходит к первому элементу.
      const byId: Record<string, number> = {}
      for (const el of Array.from(document.querySelectorAll('[id]'))) {
        const id = el.id
        if (id === '') continue
        byId[id] = (byId[id] ?? 0) + 1
      }
      for (const [id, count] of Object.entries(byId)) {
        if (count < 2) continue
        push({
          category: 'a11y',
          severity: 'MEDIUM',
          message: `id="${id}" встречается ${count} раза — ломает label[for] и aria-labelledby`,
        })
      }

      // ── Иерархия заголовков ────────────────────────────────────────────────
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(
        isVisible,
      )
      const levels = headings.map((h) => Number(h.tagName.slice(1)))
      const h1Count = levels.filter((l) => l === 1).length
      if (headings.length > 0 && h1Count === 0) {
        push({
          category: 'a11y',
          severity: 'LOW',
          message: 'на экране нет h1 — непонятно, что это за страница',
        })
      }
      if (h1Count > 1) {
        push({
          category: 'a11y',
          severity: 'LOW',
          message: `на экране ${h1Count} заголовка h1 — главный должен быть один`,
        })
      }
      for (let i = 1; i < levels.length; i += 1) {
        const prev = levels[i - 1]
        const current = levels[i]
        if (prev === undefined || current === undefined) continue
        if (current - prev > 1) {
          const el = headings[i]
          push({
            category: 'a11y',
            severity: 'LOW',
            message: `уровень заголовков прыгает с h${prev} на h${current}`,
            selector: el ? shortPath(el) : undefined,
          })
        }
      }

      return { findings, truncated }
    },
    { t: THRESHOLDS },
  ) as Promise<InspectResult>
}
