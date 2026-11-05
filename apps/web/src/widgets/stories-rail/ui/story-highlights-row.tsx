'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toApiError, useScrollRow } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  StoryThumb,
  fetchStoryHighlight,
  fetchStoryHighlights,
  highlightRing,
  storyKeys,
  type StoryHighlightDetail,
} from '../../../entities/story'
import { StoryViewer } from './story-viewer'

/**
 * Ответы по подборкам — одним значением: `combine` вне компонента, поэтому результат
 * стабилен между рендерами и меняется, только когда ответил какой-то запрос.
 */
function combineDetails(results: UseQueryResult<StoryHighlightDetail>[]): {
  settled: boolean
  data: (StoryHighlightDetail | undefined)[]
  errors: (Error | null)[]
} {
  return {
    settled: results.every((r) => !r.isPending),
    data: results.map((r) => r.data),
    errors: results.map((r) => r.error),
  }
}

/**
 * «Актуальное» в профиле: ряд кружков-подборок под шапкой, как в Instagram. Чужому
 * видны только подборки с хотя бы одной доступной ему сторис — это решает сервер.
 * Пустой ряд не рисуется вовсе: места под «ничего нет» в шапке профиля не держим.
 */
export function StoryHighlightsRow({ ownerId }: { ownerId: string }) {
  const t = useTranslations('Stories')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const [openId, setOpenId] = useState<string | null>(null)
  // Колесо и перетаскивание мышью — из общего хука; стрелки — как в ленте колец: подборок
  // бывает больше, чем влезает в шапку, и без них дальние мышью не достать.
  const row = useScrollRow<HTMLUListElement>()

  const list = useQuery({
    queryKey: storyKeys.highlights(ownerId),
    queryFn: () => fetchStoryHighlights(ownerId),
  })
  const highlights = useMemo(() => list.data ?? [], [list.data])
  // Подборки открываются по клику: снимки грузятся только тогда, когда их смотрят, — зато
  // сразу все, разом. Кончилась одна подборка — просмотр идёт в следующую, как в ленте колец,
  // и соседние видны превью по бокам; ждать каждую на переходе было бы заметно.
  const details = useQueries({
    queries: highlights.map((h) => ({
      queryKey: storyKeys.highlight(h.id),
      queryFn: () => fetchStoryHighlight(h.id),
      enabled: !!openId,
    })),
    combine: combineDetails,
  })
  const opened = highlights.findIndex((h) => h.id === openId)
  const openedError = opened >= 0 ? details.errors[opened] : null
  // Подборку удалили или скрыли блокировкой между выдачами — говорим и закрываем.
  const failure = openedError ? toApiError(openedError).code : null
  useEffect(() => {
    if (!failure) return
    toast.error(tErr(failure))
    setOpenId(null)
  }, [failure, tErr])

  // Цепочка для просмотра — когда ответили все: пока список дозревает, номера колец
  // съезжали бы под открытым кадром. Недоступные и пустые подборки в цепочку не входят.
  const chain = useMemo(() => {
    if (!openId || !details.settled) return []
    return details.data.flatMap((d) =>
      d && d.items.length > 0
        ? [
            {
              ring: highlightRing(d),
              highlight: { id: d.id, title: d.title, canEdit: d.canEdit },
            },
          ]
        : [],
    )
  }, [details, openId])
  const startIndex = chain.findIndex((c) => c.highlight.id === openId)

  // Пока грузится — ничего: у большинства подборок нет, и заглушка мигала бы впустую.
  if (highlights.length === 0) return null

  return (
    // Отступы и место в шапке задаёт профиль: ряд стоит справа от ФИО, а на телефоне — под ним.
    <section aria-label={t('highlightsTitle')} className="group/highlights relative">
      <ul
        ref={row.ref}
        className={cn(
          '-mx-1 flex gap-3 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          row.dragging && 'select-none',
        )}
      >
        {highlights.map((h) => (
          <li key={h.id} className="w-[4.75rem] shrink-0">
            <button
              type="button"
              onClick={() => setOpenId(h.id)}
              aria-label={t('openHighlight', { title: h.title })}
              className="group flex w-full flex-col items-center gap-1.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="rounded-full border border-border p-0.5 transition-transform duration-150 group-hover:scale-[1.03] motion-reduce:transition-none">
                <StoryThumb
                  media={h.cover?.media ?? null}
                  text={h.cover?.text ?? null}
                  background={h.cover?.background ?? null}
                  sizes="72px"
                  className="size-[4.25rem] rounded-full"
                />
              </span>
              <span className="w-full text-center text-xs leading-tight break-words">
                {h.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {(['left', 'right'] as const).map((side) =>
        row.overflowing && !(side === 'left' ? row.atStart : row.atEnd) ? (
          <button
            key={side}
            type="button"
            aria-label={side === 'left' ? tCommon('previous') : tCommon('next')}
            onClick={() => row.scrollPage(side === 'left' ? -1 : 1)}
            className={cn(
              // По центру кружка: поле ряда (0.25rem) + половина кружка с рамкой (2.25rem).
              'absolute top-10 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-sm transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
              // Видны всегда, а не по наведению: по стрелке сразу понятно, что ряд длиннее
              // экрана и в какую сторону листать. Стрелка есть только у той стороны, где ещё
              // есть подборки; появляется плавно, когда ряд докрутили от края.
              'animate-in fade-in-0 duration-150 motion-reduce:animate-none',
              // Наполовину за краем ряда (кружок 2rem — сдвиг на 1rem): стрелка не закрывает
              // крайнюю подборку и читается как управление рядом, а не его часть.
              side === 'left' ? '-left-4' : '-right-4',
            )}
          >
            {side === 'left' ? (
              <ChevronLeft className="size-4" aria-hidden />
            ) : (
              <ChevronRight className="size-4" aria-hidden />
            )}
          </button>
        ) : null,
      )}

      {openId && startIndex >= 0 && (
        <StoryViewer
          key={openId}
          rings={chain.map((c) => c.ring)}
          startIndex={startIndex}
          highlights={chain.map((c) => c.highlight)}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  )
}
