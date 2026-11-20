'use client'

// Вкладка «Эмодзи» панели ввода — по образцу Telegram Web: сверху полоса разделов (недавние,
// смайлы и люди, животные, еда, спорт, транспорт, предметы, символы, флаги) с подсветкой
// того, что сейчас в кадре; поиск — первой строкой прокрутки; сетка крупных клеток. Нажатие
// на раздел ведёт к нему, прокрутка сама переключает подсветку.
//
// Данные — emojibase через frimousse (тот же источник, что у пикера реакций): здесь своя
// раскладка, потому что у frimousse нет навигации по разделам и раздела «Недавние».

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { defaultEmojiDataResolver } from 'frimousse'
import {
  Car,
  Cat,
  Clock3,
  Flag,
  Lightbulb,
  Loader2,
  Pizza,
  Search,
  Shapes,
  Smile,
  Volleyball,
} from 'lucide-react'
import { isEmojiSupported } from '../../../shared/lib/emoji-support'
import { cn } from '../../../shared/lib/utils'
import {
  DEFAULT_RECENT,
  buildSections,
  detectMaxVersion,
  pushRecent,
  searchEmojis,
  type CatalogEmoji,
  type EmojiSectionId,
} from '../lib/emoji-catalog'

const SECTION_ICONS: Record<EmojiSectionId, ReactNode> = {
  recent: <Clock3 className="size-5" aria-hidden />,
  people: <Smile className="size-5" aria-hidden />,
  nature: <Cat className="size-5" aria-hidden />,
  foods: <Pizza className="size-5" aria-hidden />,
  activity: <Volleyball className="size-5" aria-hidden />,
  places: <Car className="size-5" aria-hidden />,
  objects: <Lightbulb className="size-5" aria-hidden />,
  symbols: <Shapes className="size-5" aria-hidden />,
  flags: <Flag className="size-5" aria-hidden />,
}

/** Язык данных emojibase: казахского там нет — показываем русские названия (как у пикера реакций). */
const DATA_LOCALE: Record<string, 'ru' | 'en'> = { ru: 'ru', kk: 'ru', en: 'en' }

interface Catalog {
  emojis: CatalogEmoji[]
  groups: { index: number; label: string }[]
}

// Каталог грузится один раз на язык и живёт до перезагрузки страницы: повторное открытие
// панели не должно снова ждать сеть.
const catalogs = new Map<string, Promise<Catalog>>()
function loadCatalog(locale: 'ru' | 'en'): Promise<Catalog> {
  let p = catalogs.get(locale)
  if (!p) {
    p = Promise.resolve(defaultEmojiDataResolver(locale, {})).then((data) => ({
      emojis: data.emojis as CatalogEmoji[],
      groups: data.categories,
    }))
    // Неудача не должна залипать: следующее открытие попробует снова.
    p.catch(() => catalogs.delete(locale))
    catalogs.set(locale, p)
  }
  return p
}

const RECENT_KEY = 'chat:recent-emoji'

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string') && parsed.length) {
      return parsed as string[]
    }
  } catch {
    // Хранилище недоступно (приватное окно, запрет сайта) — панель работает и без него.
  }
  return [...DEFAULT_RECENT]
}

function writeRecent(list: string[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // Не сохранилось — «Недавние» просто начнутся заново в следующий раз.
  }
}

// Поддержка шрифтом считается один раз: это десяток отрисовок на canvas.
let supportCache: { maxVersion: number; flags: boolean } | null = null
function emojiSupport(): { maxVersion: number; flags: boolean } {
  supportCache ??= {
    maxVersion: detectMaxVersion(isEmojiSupported),
    flags: isEmojiSupported('🇰🇿'),
  }
  return supportCache
}

export function ComposerEmojiTab({
  variant,
  onPick,
}: {
  variant: 'popover' | 'dock'
  onPick: (emoji: string) => void
}) {
  const t = useTranslations('Chats')
  const locale = DATA_LOCALE[useLocale()] ?? 'ru'
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  // «Недавние» на экране — снимок на момент открытия: обновлять раздел прямо под курсором
  // значило бы сдвигать сетку после каждого нажатия (Telegram тоже перестраивает его потом).
  const [recentShown] = useState(readRecent)
  const recentRef = useRef<string[] | null>(null)
  const [active, setActive] = useState<EmojiSectionId>('recent')
  const viewportRef = useRef<HTMLDivElement>(null)
  // Пока лента едет к разделу по нажатию, подсветка уже стоит на нём и не мигает по пути.
  const jumpingRef = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    loadCatalog(locale).then(
      (c) => alive && setCatalog(c),
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
    }
  }, [locale])

  const support = useMemo(() => (catalog ? emojiSupport() : null), [catalog])
  const sections = useMemo(
    () =>
      catalog && support ? buildSections(catalog.emojis, catalog.groups, recentShown, support) : [],
    [catalog, support, recentShown],
  )
  const found = useMemo(
    () => (catalog && support ? searchEmojis(catalog.emojis, query, support) : []),
    [catalog, support, query],
  )

  function title(id: EmojiSectionId, groupLabel?: string): string {
    if (id === 'recent') return t('tgEmoji.recent')
    if (id === 'people') return t('tgEmoji.people')
    return groupLabel ?? t(`tgEmoji.${id}`)
  }

  function pick(emoji: string): void {
    onPick(emoji)
    const next = pushRecent(recentRef.current ?? readRecent(), emoji)
    recentRef.current = next
    writeRecent(next)
  }

  function syncActive(): void {
    if (jumpingRef.current !== null) return
    const vp = viewportRef.current
    if (!vp) return
    const blocks = vp.querySelectorAll<HTMLElement>('[data-emoji-section]')
    let current: EmojiSectionId | null = null
    for (const b of blocks) {
      if (b.offsetTop - vp.scrollTop <= 8) current = b.dataset.emojiSection as EmojiSectionId
      else break
    }
    if (current) setActive(current)
    else if (blocks[0]) setActive(blocks[0].dataset.emojiSection as EmojiSectionId)
  }

  function jumpTo(id: EmojiSectionId): void {
    const vp = viewportRef.current
    const block = vp?.querySelector<HTMLElement>(`[data-emoji-section="${id}"]`)
    if (!vp || !block) return
    setQuery('')
    setActive(id)
    if (jumpingRef.current !== null) window.clearTimeout(jumpingRef.current)
    jumpingRef.current = window.setTimeout(() => {
      jumpingRef.current = null
    }, 600)
    vp.scrollTo({ top: block.offsetTop, behavior: 'smooth' })
  }

  const cell = 'flex aspect-square w-full items-center justify-center rounded-lg leading-none'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Полоса разделов (Telegram: шапка EmojiPicker). */}
      <div
        role="toolbar"
        aria-label={t('tgEmoji.sections')}
        className="flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2 [scrollbar-width:none]"
      >
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-label={title(s.id, s.groupLabel)}
            title={title(s.id, s.groupLabel)}
            aria-pressed={active === s.id && !query}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => jumpTo(s.id)}
            className={cn(
              'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-4 focus-visible:ring-ring/20',
              active === s.id && !query
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {SECTION_ICONS[s.id]}
          </button>
        ))}
      </div>
      <div
        ref={viewportRef}
        onScroll={syncActive}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2"
      >
        {/* Поиск — первой строкой ленты, как в Telegram: он нужен реже, чем сетка. */}
        <div className="relative pb-1 pt-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 translate-y-[-30%] text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('emojiSearch')}
            aria-label={t('emojiSearch')}
            className="h-9 w-full rounded-full bg-muted pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-4 focus-visible:ring-ring/20"
          />
        </div>
        {!catalog ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            {failed ? (
              <span className="text-sm">{t('tgEmoji.loadFailed')}</span>
            ) : (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            )}
          </div>
        ) : query.trim() ? (
          found.length ? (
            <EmojiGrid variant={variant} emojis={found} cell={cell} onPick={pick} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('tgEmoji.nothingFound')}
            </p>
          )
        ) : (
          sections.map((s) => (
            <section key={s.id} data-emoji-section={s.id} aria-label={title(s.id, s.groupLabel)}>
              <h3 className="px-1.5 pb-1 pt-2 text-[0.8125rem] font-medium text-muted-foreground">
                {title(s.id, s.groupLabel)}
              </h3>
              <EmojiGrid variant={variant} emojis={s.emojis} cell={cell} onPick={pick} />
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function EmojiGrid({
  variant,
  emojis,
  cell,
  onPick,
}: {
  variant: 'popover' | 'dock'
  emojis: readonly string[]
  cell: string
  onPick: (emoji: string) => void
}) {
  return (
    <div
      className={cn(
        'grid',
        // Telegram: девять клеток в ряд на ПК; на телефоне — сколько влезет по ~42px.
        variant === 'popover'
          ? 'grid-cols-9'
          : 'grid-cols-[repeat(auto-fill,minmax(2.625rem,1fr))]',
      )}
      // Длинные разделы (флаги, символы) не рисуются, пока до них не докрутили.
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: `auto ${Math.ceil(emojis.length / 9) * 42}px`,
      }}
    >
      {emojis.map((e) => (
        <button
          key={e}
          type="button"
          // Нажатие не уводит фокус из поля ввода: курсор остаётся на месте вставки.
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => onPick(e)}
          className={cn(
            cell,
            'cursor-pointer text-[1.625rem] outline-none transition-transform hover:bg-muted focus-visible:bg-muted active:scale-90',
          )}
        >
          {e}
        </button>
      ))}
    </div>
  )
}
