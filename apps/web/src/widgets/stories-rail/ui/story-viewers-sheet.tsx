'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Avatar, AvatarFallback, AvatarImage, Button, Modal, Skeleton } from '../../../shared/ui'
import { fetchStoryViewers, storyKeys } from '../../../entities/story'

/**
 * Кто смотрел сторис. Открывается только автору — сервер чужому отвечает FORBIDDEN,
 * и кнопка у него не рисуется (§14.7: кто смотрел, видит лишь автор).
 */
export function StoryViewersSheet({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const t = useTranslations('Stories')
  const tCommon = useTranslations('Common')

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: storyKeys.viewers(storyId),
    queryFn: ({ pageParam }) => fetchStoryViewers(storyId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })

  const viewers = (data?.pages ?? []).flatMap((page) => page.items)

  return (
    <Modal onClose={onClose} title={t('viewers')} size="md">
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      ) : viewers.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('noViewers')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {viewers.map((viewer) => (
            <li key={viewer.id} className="flex items-center gap-3">
              <Avatar className="size-9">
                {viewer.user.avatarUrl && <AvatarImage src={viewer.user.avatarUrl} alt="" />}
                <AvatarFallback>
                  {viewer.user.firstName.charAt(0)}
                  {viewer.user.lastName.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 truncate text-sm">
                {viewer.user.firstName} {viewer.user.lastName}
              </span>
            </li>
          ))}
        </ul>
      )}

      {hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          size="md"
          className="mt-3 w-full"
          loading={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {tCommon('next')}
        </Button>
      )}
    </Modal>
  )
}
