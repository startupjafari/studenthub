'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { toApiError } from '../../../shared/lib'
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
  const tErr = useTranslations('Errors')
  const [openId, setOpenId] = useState<string | null>(null)

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
    <section aria-label={t('highlightsTitle')}>
      <ul className="-mx-1 flex gap-3 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
