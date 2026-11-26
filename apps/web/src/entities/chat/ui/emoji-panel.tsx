'use client'

// Панель эмодзи — по образцу Telegram Web A: вкладка «Эмодзи» панели ввода и полный набор
// реакций в меню сообщения (там над разделами — крупная сетка реакций, `featured`). Сверху полоса: кнопка «Недавних»
// и «пилюля» разделов (смайлы и люди, животные, еда, спорт, транспорт, предметы, символы,
// флаги). Пока в кадре «Недавние», пилюля свёрнута в один значок; стоит докрутить до разделов —
// раскрывается и держит активный по центру. Поиск — первой строкой ленты; при фокусе полоса
// уезжает вверх, и поле встаёт на её место. Сетка — семь клеток по 36 px.
//
// Данные — emojibase через frimousse (тот же источник, что у пикера реакций): здесь своя
// раскладка, потому что у frimousse нет навигации по разделам и раздела «Недавние».

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { Locale } from '@studenthub/shared-config'
import { useAppLocale } from '../../../shared/i18n/app-locale'
import { defaultEmojiDataResolver } from 'frimousse'
import {
  Apple,
  Car,
  Cat,
  Clock3,
  Flag,
  Lightbulb,
  Loader2,
  Search,
  Shapes,
  Smile,
  Volleyball,
  X,
} from 'lucide-react'
import { isEmojiSupported } from '../../../shared/lib/emoji-support'
import { prefersReducedMotion } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  DEFAULT_RECENT,
  buildSections,
  detectMaxVersion,
  pillScrollLeft,
  pushRecent,
  searchEmojis,
  sectionAt,
  type CatalogEmoji,
  type EmojiSectionId,
} from '../lib/emoji-catalog'

const SECTION_ICONS: Record<EmojiSectionId, ReactNode> = {
  recent: <Clock3 className="size-5" aria-hidden />,
  people: <Smile className="size-5" aria-hidden />,
  nature: <Cat className="size-5" aria-hidden />,
  foods: <Apple className="size-5" aria-hidden />,
  activity: <Volleyball className="size-5" aria-hidden />,
  places: <Car className="size-5" aria-hidden />,
  objects: <Lightbulb className="size-5" aria-hidden />,
  symbols: <Shapes className="size-5" aria-hidden />,
  flags: <Flag className="size-5" aria-hidden />,
}

/**
 * Язык данных emojibase по коду приложения: казахского набора там нет — показываем русские
 * названия (как у пикера реакций). `ru` и `en` справа — имена наборов emojibase, а не локали.
 */
const DATA_LOCALE: Record<Locale, 'ru' | 'en'> = { ru: 'ru', kz: 'ru', en: 'en' }

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

/** Кнопка полосы разделов: круг 34 px; активная — серая подложка, остальные чуть приглушены. */
const sectionButton =
  'flex size-[2.125rem] shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/20'
const sectionIdle = 'text-foreground/70 hover:bg-muted-foreground/[0.08] hover:text-foreground'
const sectionActive = 'bg-muted-foreground/[0.12] text-foreground'

export interface EmojiPanelProps {
  variant: 'popover' | 'dock'
  onPick: (emoji: string) => void
  /**
   * Реакции чата — первым блоком, без заголовка, над «Недавними» (Telegram: полный набор
   * реакций открывается сеткой доступных реакций). Нет — обычная панель эмодзи.
   */
  featured?: readonly string[]
  /** Уже поставленные мной реакции — отмечены подложкой. */
  chosen?: ReadonlySet<string>
}

export function EmojiPanel({ variant, onPick, featured, chosen }: EmojiPanelProps) {
  const t = useTranslations('Chats')
  const locale = DATA_LOCALE[useAppLocale()]
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  // «Недавние» на экране — снимок на момент открытия: обновлять раздел прямо под курсором
  // значило бы сдвигать сетку после каждого нажатия (Telegram тоже перестраивает его потом).
  const [recentShown] = useState(readRecent)
  const recentRef = useRef<string[] | null>(null)
  const [active, setActive] = useState<EmojiSectionId>('recent')
  const [atTop, setAtTop] = useState(true)
  const viewportRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
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

  useEffect(
    () => () => {
      if (jumpingRef.current !== null) window.clearTimeout(jumpingRef.current)
    },
    [],
  )

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
  const hasQuery = !!query.trim()
  // Telegram: поиск «активен», пока в поле фокус или текст, — полоса разделов уезжает вверх.
  const searchActive = searchFocused || hasQuery
  const recent = sections.find((s) => s.id === 'recent')
  const categories = sections.filter((s) => s.id !== 'recent')
  const pillIndex = categories.findIndex((s) => s.id === active)
  const pillExpanded = pillIndex >= 0

  function title(id: EmojiSectionId, groupLabel?: string): string {
    if (id === 'recent') return t('tgEmoji.recent')
    if (id === 'people') return t('tgEmoji.people')
    return groupLabel ?? t(`tgEmoji.${id}`)
  }

  // Ссылка на выбор постоянная: сетки не перерисовываются, когда прокрутка меняет подсветку.
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const pick = useCallback((emoji: string): void => {
    onPickRef.current(emoji)
    const next = pushRecent(recentRef.current ?? readRecent(), emoji)
    recentRef.current = next
    writeRecent(next)
  }, [])

  function onScroll(): void {
    const vp = viewportRef.current
    if (!vp) return
    setAtTop(vp.scrollTop <= 0)
    if (jumpingRef.current !== null || hasQuery) return
    const blocks = vp.querySelectorAll<HTMLElement>('[data-emoji-section]')
    const tops = Array.from(blocks, (b) => ({
      id: b.dataset.emojiSection as EmojiSectionId,
      top: b.offsetTop,
    }))
    const current = sectionAt(tops, vp.scrollTop)
    if (current) setActive(current)
  }

  function jumpTo(id: EmojiSectionId): void {
    const vp = viewportRef.current
    const block = vp?.querySelector<HTMLElement>(`[data-emoji-section="${id}"]`)
    if (!vp || !block) return
    setActive(id)
    if (jumpingRef.current !== null) window.clearTimeout(jumpingRef.current)
    jumpingRef.current = window.setTimeout(() => {
      jumpingRef.current = null
    }, 600)
    vp.scrollTo({ top: block.offsetTop, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  function clearSearch(): void {
    setQuery('')
    searchRef.current?.focus()
  }

  // Новый запрос — выдача с начала, как в Telegram (resetScroll при смене результата).
  useEffect(() => {
    const vp = viewportRef.current
    if (vp && hasQuery) vp.scrollTop = 0
  }, [query, hasQuery])

  const dock = variant === 'dock'

  return (
    <div className="h-full overflow-hidden">
      {/* Полоса + лента на высоту панели и ещё полосу: при активном поиске всё уезжает вверх
          ровно на полосу (только transform), и поле поиска встаёт на её место. */}
      <div
        className={cn(
          'flex h-[calc(100%+3rem)] flex-col transition-transform duration-(--motion-page)',
          searchActive && '-translate-y-12',
        )}
      >
        <div
          role="toolbar"
          aria-label={t('tgEmoji.sections')}
          className={cn(
            'flex h-12 shrink-0 items-center border-b px-1.5 transition-colors',
            // Разделитель — только когда лента уехала под полосу (Telegram `with-top-border`).
            atTop ? 'border-transparent' : 'border-border',
            searchActive && 'pointer-events-none',
          )}
          inert={searchActive || undefined}
        >
          {recent && (
            <button
              type="button"
              aria-label={title('recent')}
              title={title('recent')}
              aria-pressed={active === 'recent' && !hasQuery}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => jumpTo('recent')}
              className={cn(
                sectionButton,
                'mx-1',
                active === 'recent' && !hasQuery ? sectionActive : sectionIdle,
              )}
            >
              {SECTION_ICONS.recent}
            </button>
          )}
          {categories.length > 0 && (
            <CategoryPill
              categories={categories.map((s) => ({ id: s.id, label: title(s.id, s.groupLabel) }))}
              activeIndex={hasQuery ? -1 : pillIndex}
              expanded={pillExpanded && !hasQuery}
              onSelect={jumpTo}
            />
          )}
        </div>
        <div
          ref={viewportRef}
          onScroll={onScroll}
          className={cn(
            'relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-8 [scrollbar-gutter:stable]',
            dock ? 'px-1' : 'px-3',
          )}
        >
          {/* Поиск — первой строкой ленты, как в Telegram: он нужен реже, чем сетка. */}
          <div className="my-3 flex h-[2.375rem] items-center rounded-full bg-foreground/[0.06] pl-3">
            <Search
              className="pointer-events-none size-5 shrink-0 text-foreground/80"
              aria-hidden
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={(e) => {
                // Escape в поиске чистит его, а не закрывает всю панель.
                if (e.key === 'Escape' && query) {
                  e.preventDefault()
                  e.stopPropagation()
                  e.nativeEvent.stopImmediatePropagation()
                  setQuery('')
                }
              }}
              placeholder={t('emojiSearch')}
              aria-label={t('emojiSearch')}
              className="h-full min-w-0 flex-1 bg-transparent pl-2 pr-3 text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query && (
              <button
                type="button"
                aria-label={t('tgEmoji.clearSearch')}
                title={t('tgEmoji.clearSearch')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={clearSearch}
                className="mr-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground/70 outline-none hover:bg-muted-foreground/[0.08] focus-visible:ring-4 focus-visible:ring-ring/20"
              >
                <X className="size-5" aria-hidden />
              </button>
            )}
          </div>
          {!catalog ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              {failed ? (
                <span className="text-sm">{t('tgEmoji.loadFailed')}</span>
              ) : (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              )}
            </div>
          ) : hasQuery ? (
            found.length ? (
              <section aria-label={t('tgEmoji.searchResults')}>
                <SectionTitle>{t('tgEmoji.searchResults')}</SectionTitle>
                <EmojiGrid dock={dock} emojis={found} onPick={pick} />
              </section>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t('tgEmoji.nothingFound')}
              </p>
            )
          ) : (
            <>
              {featured && featured.length > 0 && (
                <section aria-label={t('tgReactions.title')} className="mb-3">
                  <EmojiGrid dock={dock} emojis={featured} chosen={chosen} onPick={pick} />
                </section>
              )}
              {sections.map((s) => (
                <section
                  key={s.id}
                  data-emoji-section={s.id}
                  aria-label={title(s.id, s.groupLabel)}
                  className="mb-3"
                >
                  <SectionTitle>{title(s.id, s.groupLabel)}</SectionTitle>
                  <EmojiGrid dock={dock} emojis={s.emojis} onPick={pick} />
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Заголовок раздела (Telegram `symbol-set-title`): 16 px, приглушённый, без липкости. */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="truncate px-1 pb-0.5 text-base font-medium leading-[1.6875rem] text-muted-foreground/75">
      {children}
    </h3>
  )
}

/**
 * «Пилюля» разделов (Telegram EmojiCategoryPill). Свёрнутая — один значок первого раздела;
 * раскрытая — серая капсула шириной в 4,5 значка, внутри полоса со всеми разделами, активный
 * по центру. Ширина места под неё постоянная: раскрытие рисуется обрезкой (clip-path), а не
 * ростом ширины, — соседи не двигаются. Колесо мыши листает полосу вбок.
 */
function CategoryPill({
  categories,
  activeIndex,
  expanded,
  onSelect,
}: {
  categories: { id: EmojiSectionId; label: string }[]
  activeIndex: number
  expanded: boolean
  onSelect: (id: EmojiSectionId) => void
}) {
  const stripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const left = pillScrollLeft(activeIndex, strip.clientWidth, expanded)
    strip.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [activeIndex, expanded])

  // Свёрнутая видна окном 2,5rem у левого края, раскрытая — целиком.
  const clip = expanded
    ? 'inset(0px 0px 0px 0px round 999px)'
    : 'inset(0px calc(100% - 2.5rem) 0px 0px round 999px)'

  return (
    <div className="relative h-10 w-40 shrink-0">
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-0 inset-y-[0.3125rem] rounded-full bg-muted transition-[clip-path,opacity] duration-(--motion-page)',
          expanded ? 'opacity-100' : 'opacity-0',
        )}
        style={{ clipPath: clip }}
      />
      <div
        ref={stripRef}
        onWheel={(e) => {
          const strip = stripRef.current
          if (!strip || !expanded || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
          strip.scrollLeft += e.deltaY
        }}
        className="relative flex h-full items-center overflow-x-auto overflow-y-hidden overscroll-contain transition-[clip-path] duration-(--motion-page) [scrollbar-width:none]"
        style={{ clipPath: clip }}
      >
        {categories.map((c, i) => (
          <button
            key={c.id}
            type="button"
            aria-label={c.label}
            title={c.label}
            aria-pressed={expanded && i === activeIndex}
            // Свёрнутая пилюля — это одна кнопка: скрытые разделы не ловят Tab.
            tabIndex={!expanded && i > 0 ? -1 : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(c.id)}
            className={cn(
              sectionButton,
              'mx-px transition-[transform,background-color,color] duration-(--motion-page)',
              expanded && 'scale-80',
              expanded && i === activeIndex ? sectionActive : sectionIdle,
            )}
          >
            {SECTION_ICONS[c.id]}
          </button>
        ))}
      </div>
    </div>
  )
}

const EmojiGrid = memo(function EmojiGrid({
  dock,
  emojis,
  chosen,
  onPick,
}: {
  dock: boolean
  emojis: readonly string[]
  chosen?: ReadonlySet<string>
  onPick: (emoji: string) => void
}) {
  return (
    <div
      className={cn(
        // Telegram: клетки по 36 px, лишнее место — поровну между ними (в панели ПК выходит
        // семь в ряд); на телефоне промежутки плотнее.
        'grid auto-rows-[2.25rem] grid-cols-[repeat(auto-fill,2.25rem)] justify-between',
        dock ? 'gap-2' : 'gap-x-2.5 gap-y-1',
      )}
      // Длинные разделы (флаги, символы) не рисуются, пока до них не докрутили.
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: `auto ${Math.ceil(emojis.length / 7) * 40}px`,
      }}
    >
      {emojis.map((e) => (
        <button
          key={e}
          type="button"
          // Нажатие не уводит фокус из поля ввода: курсор остаётся на месте вставки.
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => onPick(e)}
          aria-pressed={chosen ? chosen.has(e) : undefined}
          className={cn(
            'flex size-9 cursor-pointer items-center justify-center rounded-md text-[1.875rem] leading-none outline-none hover:bg-muted focus-visible:bg-muted motion-safe:active:scale-90',
            chosen?.has(e) && 'bg-primary/15 hover:bg-primary/20',
          )}
        >
          {e}
        </button>
      ))}
    </div>
  )
})
