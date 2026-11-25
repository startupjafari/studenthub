'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { FileText } from 'lucide-react'
import {
  articleOwnerHref,
  articleWindowHref,
  fetchProfileArticle,
  profileContentKeys,
} from '../../../entities/profile-content'
import { Button, EmptyState, Skeleton } from '../../../shared/ui'

/**
 * Постоянная ссылка на статью — `/articles/<id>` («Скопировать ссылку», старые адреса).
 * Своей страницы у статьи нет: ссылка ведёт на страницу владельца (профиль автора или
 * страницу организации) и открывает там окно статьи. Запись этого адреса в истории
 * заменяется — «назад» из окна не возвращает сюда же.
 *
 * Видимость решает сервер: невидимая статья — «недоступна», без подробностей.
 */
export function ArticleLinkView({ articleId }: { articleId: string }) {
  const t = useTranslations('Article')
  const router = useRouter()
  const q = useQuery({
    queryKey: profileContentKeys.article(articleId),
    queryFn: () => fetchProfileArticle(articleId),
    // Недоступная статья повторными запросами доступной не станет.
    retry: false,
  })

  useEffect(() => {
    if (!q.data) return
    router.replace(articleWindowHref(articleOwnerHref(q.data), { mode: 'read', id: q.data.id }))
  }, [q.data, router])

  if (q.isError) {
    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center">
        <EmptyState
          icon={<FileText className="size-6" aria-hidden />}
          title={t('unavailableTitle')}
          description={t('unavailableText')}
          action={
            <Button asChild variant="outline">
              <Link href="/">{t('toFeed')}</Link>
            </Button>
          }
        />
      </div>
    )
  }
  return (
    <div className="mx-auto flex w-full max-w-[45rem] flex-1 flex-col gap-6" aria-busy>
      <Skeleton className="h-10 w-4/5" />
      <Skeleton className="h-5 w-3/5" />
      <Skeleton className="aspect-[16/9] w-full rounded-2xl" />
    </div>
  )
}
