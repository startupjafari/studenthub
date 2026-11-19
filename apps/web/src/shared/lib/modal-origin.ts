import type { Ref, RefCallback } from 'react'

// Окно вырастает из того, на что нажали (как в iOS и Telegram): кнопка «Удалить» — из
// кнопки, плитка — из плитки, и уходит обратно туда же. Так видно, откуда окно и куда
// вернётся фокус.
//
// Как это устроено. Все окна системы (`Modal`, `Dialog`, `AlertDialog`, `PromptDialog`,
// а значит и `useConfirm`) въезжают кейфреймами tw-animate-css: стартовый сдвиг и масштаб
// берутся из переменных `--tw-enter-translate-*` и `--tw-enter-scale`, финальный при уходе —
// из `--tw-exit-*`. Окно стоит по центру экрана, поэтому достаточно в момент появления
// записать в эти переменные «где был элемент относительно центра» — и вход начинается
// с элемента, а уход в него возвращается. Ни замеров на каждом кадре, ни своей анимации.
//
// Откуда известен элемент. Один слушатель на весь документ (в фазе захвата) запоминает,
// куда нажали последним: ближайший интерактивный элемент под пальцем, а без него — точку
// нажатия. Окно, открытое не по нажатию (через секунды, по таймеру, по событию сокета),
// берёт обычный вход из центра: запись считается свежей недолго.
//
// Уменьшенное движение: глобальное правило в globals.css гасит эти переменные `!important`,
// остаётся кроссфейд — инлайн-стиль без `!important` его не перебивает.

/** Что считаем «элементом, на который нажали»: окно растёт из него целиком, а не из точки. */
const INTERACTIVE =
  'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="option"], summary, label, input, select'
/** Окно, открытое позже этого после нажатия, — не ответ на него: вход обычный. */
const FRESH_MS = 1000
/** Пределы стартового масштаба: из иконки окно не начинается точкой, из плитки — не в полный рост. */
const MIN_SCALE = 0.15
const MAX_SCALE = 0.6

interface Origin {
  x: number
  y: number
  width: number
  at: number
}

let last: Origin | null = null
let installed = false
/**
 * Узлы, которым старт уже записан. Ref-колбэк зовётся на каждом ререндере окна, а точку
 * входа решает только первое появление: нажатие внутри окна не должно перенацеливать уход.
 */
const configured = new WeakSet<HTMLElement>()

function remember(el: Element | null, x: number, y: number): void {
  const r = el?.getBoundingClientRect()
  last =
    r && r.width > 0 && r.height > 0
      ? { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, at: performance.now() }
      : { x, y, width: 0, at: performance.now() }
}

/** Повесить слушатели нажатий один раз на документ. Повторный вызов ничего не делает. */
export function installModalOriginTracker(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null
      remember(target, e.clientX, e.clientY)
    },
    true,
  )
  // С клавиатуры окно открывают Enter или пробелом на элементе в фокусе — растём из него.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const el = document.activeElement
      if (!el || el === document.body) return
      const r = el.getBoundingClientRect()
      remember(el, r.left + r.width / 2, r.top + r.height / 2)
    },
    true,
  )
}

/** Записать в узел окна старт и финиш анимации от последнего нажатия (если оно свежее). */
function applyOrigin(node: HTMLElement): void {
  if (configured.has(node)) return
  configured.add(node)
  if (!last || performance.now() - last.at > FRESH_MS) return
  const dx = last.x - window.innerWidth / 2
  const dy = last.y - window.innerHeight / 2
  const width = node.offsetWidth || 1
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, last.width / width))
  const set = (name: string, value: string): void => node.style.setProperty(name, value)
  set('--tw-enter-translate-x', `${dx}px`)
  set('--tw-enter-translate-y', `${dy}px`)
  set('--tw-enter-scale', String(scale))
  set('--tw-exit-translate-x', `${dx}px`)
  set('--tw-exit-translate-y', `${dy}px`)
  set('--tw-exit-scale', String(scale))
}

/**
 * Ref для контента окна: при появлении узла окно настраивается расти из нажатого элемента.
 * Чужой ref (если окну его передали) получает узел как обычно.
 */
export function modalOriginRef<T extends HTMLElement>(ref?: Ref<T>): RefCallback<T> {
  return (node) => {
    if (node) applyOrigin(node)
    if (typeof ref === 'function') ref(node)
    else if (ref) (ref as { current: T | null }).current = node
  }
}

// Слушатель нужен с первого нажатия, а не с первого открытого окна: модуль окна часто
// грузится отдельным чанком уже после клика. Поэтому подключение — побочным эффектом
// импорта, а оболочка импортирует модуль заранее (app/providers.tsx).
if (typeof document !== 'undefined') installModalOriginTracker()
