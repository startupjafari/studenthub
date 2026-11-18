'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ArrowLeft } from 'lucide-react'
import { canFileComplaint } from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import { StickerSetPreviewContent, useStickerSetPreview } from '../../../features/sticker-sets'
import { ReportModal } from '../../../features/report-content'
import { ROLE_HOME } from '../../../shared/config/routes'
import { useAppSelector } from '../../../shared/store'

/**
 * Страница ссылки на набор стикеров (`/addstickers/<slug>`), как t.me/addstickers в Telegram:
 * превью набора, «Добавить стикеры» / «Убрать», «Поделиться» и жалоба. Кто открыл ссылку —
 * добавляет набор себе в панель. Автор набора не показывается.
 */
export function StickerSetLinkView({ slug }: { slug: string }) {
  const t = useTranslations('Chats')
  const role = useAppSelector((s) => s.auth.role)
  const [reporting, setReporting] = useState<string | null>(null)
  const query = { slug }
  const preview = useStickerSetPreview(query)
  const home = role ? ROLE_HOME[role] : '/'
  // У работодателя раздела чатов с группами нет (см. join-chat) — назад на его главную.
  const chats = role === Role.EMPLOYER ? home : home === '/' ? '/chats' : `${home}/chats`

  return (
    <main className="flex min-h-dvh items-start justify-center bg-background px-4 py-8 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Link
            href={chats}
            aria-label={t('tgStickers.pageBack')}
            title={t('tgStickers.pageBack')}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
            {preview.data?.title ?? t('tgStickers.setTitle')}
          </h1>
        </div>
        <StickerSetPreviewContent
          query={query}
          onReport={canFileComplaint(role) ? setReporting : undefined}
        />
      </div>
      {reporting && (
        <ReportModal
          targetType="STICKER_SET"
          targetId={reporting}
          preview={preview.data?.title}
          onClose={() => setReporting(null)}
        />
      )}
    </main>
  )
}
