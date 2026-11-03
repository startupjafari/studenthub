'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Copy, Share2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../shared/ui'

/** Постоянный адрес статьи. На сервере window нет — там ссылка не нужна. */
function articleUrl(id: string): string {
  return typeof window === 'undefined' ? '' : `${window.location.origin}/articles/${id}`
}

/**
 * «Поделиться» статьёй: скопировать ссылку и системное меню устройства, где оно есть.
 * Репост — отдельной кнопкой: это публикация от своего имени, а не отправка ссылки.
 */
export function ArticleShareMenu({
  articleId,
  title,
  className,
}: {
  articleId: string
  title: string
  className?: string
}) {
  const t = useTranslations('Feed')
  // Системного меню нет на десктопе в Firefox и Safari — пункт условный.
  const [canNativeShare, setCanNativeShare] = useState(false)
  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [])

  function copy(): void {
    navigator.clipboard
      .writeText(articleUrl(articleId))
      .then(() => toast.success(t('linkCopied')))
      .catch(() => toast.error(t('copyFailed')))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={t('share')} title={t('share')} className={className}>
          <Share2 className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={copy}>
          <Copy className="size-4" aria-hidden />
          {t('copyLink')}
        </DropdownMenuItem>
        {canNativeShare && (
          <DropdownMenuItem
            onClick={() =>
              // Отмена системного меню — тоже reject; это не ошибка.
              void navigator.share({ title, url: articleUrl(articleId) }).catch(() => undefined)
            }
          >
            <Share2 className="size-4" aria-hidden />
            {t('shareMore')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
