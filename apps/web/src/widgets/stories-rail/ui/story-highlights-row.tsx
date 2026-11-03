'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
} from '../../../entities/story'
import { StoryViewer } from './story-viewer'

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
  // Подборка открывается по клику: сторис-снимки грузятся только тогда, когда их смотрят.
  const detail = useQuery({
    queryKey: storyKeys.highlight(openId ?? ''),
    queryFn: () => fetchStoryHighlight(openId ?? ''),
    enabled: !!openId,
  })
  // Подборку удалили или скрыли блокировкой между выдачами — говорим и закрываем.
  const failure = openId && detail.isError ? toApiError(detail.error).code : null
  useEffect(() => {
    if (!failure) return
    toast.error(tErr(failure))
    setOpenId(null)
  }, [failure, tErr])

  // Пока грузится — ничего: у большинства подборок нет, и заглушка мигала бы впустую.
  const highlights = list.data ?? []
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
              'absolute top-10 z-10 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-sm transition-[opacity,background-color] duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none sm:flex',
              'opacity-0 group-hover/highlights:opacity-100 focus-visible:opacity-100',
              side === 'left' ? 'left-0' : 'right-0',
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

      {openId && detail.data && detail.data.items.length > 0 && (
        <StoryViewer
          key={openId}
          rings={[highlightRing(detail.data)]}
          startIndex={0}
          highlight={{ id: detail.data.id, title: detail.data.title, canEdit: detail.data.canEdit }}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  )
}
