'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { LOCALES, localePath, type Locale } from '../config/site'
import { Flag } from './flag'
import { getDictionary } from '../content'

/**
 * Выбор языка — компактный список под кнопкой «RU ▾».
 *
 * Раньше три языка стояли рядом тремя кнопками и по весу спорили с навигацией и «Войти»:
 * три равнозначных пункта отвлекали от единственного действия, ради которого сюда чаще
 * всего приходят. Свёрнутый вид оставляет на виду только текущий язык.
 *
 * Пункты остаются ссылками, а не кнопками с обработчиком: у каждой версии свой адрес,
 * её можно открыть в новой вкладке и сохранить в закладки.
 */
export function LanguageMenu({ current }: { current: Locale }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const label = getDictionary(current).footer.language

  // Клик мимо и Esc закрывают список — иначе он остаётся висеть поверх страницы.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-foreground/70 uppercase outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/20"
      >
        <Flag locale={current} className="h-3 w-[1.125rem]" />
        {current}
        <ChevronDown
          className={`size-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''} motion-reduce:transition-none`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="sh-swap absolute top-full right-0 z-50 mt-1.5 flex min-w-40 flex-col rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
        >
          {LOCALES.map((locale) => {
            const isCurrent = locale === current
            return (
              <a
                key={locale}
                role="menuitem"
                href={localePath(locale)}
                hrefLang={locale}
                aria-current={isCurrent ? 'true' : undefined}
                className={[
                  'flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none',
                  'hover:bg-foreground/[0.06] focus-visible:ring-4 focus-visible:ring-ring/20',
                  isCurrent ? 'font-medium text-primary' : 'text-foreground/80',
                ].join(' ')}
              >
                <Flag locale={locale} className="h-3.5 w-[1.3125rem]" />
                <span className="flex-1">{getDictionary(locale).meta.languageName}</span>
                {isCurrent && <Check className="size-3.5 shrink-0" aria-hidden />}
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
