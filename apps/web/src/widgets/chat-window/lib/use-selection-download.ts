'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  useAttachmentLinkSource,
  type ChatMessage,
  type MessageAttachment,
} from '../../../entities/chat'
import { downloadAndSaveFiles } from '../../../shared/lib'

/** Вложения выбранных сообщений, которые есть что скачать: отправленные, не временные. */
export function downloadableAttachments(
  messages: readonly ChatMessage[],
): { message: ChatMessage; attachment: MessageAttachment }[] {
  return messages.flatMap((message) =>
    message.id.startsWith('tmp:')
      ? []
      : message.media
          .filter((a) => !!a.id && !a.uploading && !a.id.startsWith('tmp'))
          .map((attachment) => ({ message, attachment })),
  )
}

/**
 * «Скачать» в панели выбора (Telegram: MessageSelectToolbar): все медиа и файлы выбранных
 * сообщений в порядке ленты. Подписанные ссылки берутся тем же запросом и ключом кэша, что
 * у вложений в ленте, сами файлы — общим хранилищем скачиваний (shared/lib/file-download):
 * уже скачанное не качается второй раз, прогресс виден и на значках вложений.
 */
export function useSelectionDownload() {
  const t = useTranslations('Chats')
  const qc = useQueryClient()
  const source = useAttachmentLinkSource()
  const [busy, setBusy] = useState(false)

  const download = async (messages: readonly ChatMessage[]): Promise<void> => {
    const items = downloadableAttachments(messages)
    if (items.length === 0 || busy) return
    setBusy(true)
    toast(t('tgListHeader.downloadingSelected', { count: items.length }))
    try {
      const { failed } = await downloadAndSaveFiles(
        items.map(({ attachment: a }) => ({
          key: `file:${a.id}`,
          source: {
            url: async () => {
              const link = await qc.fetchQuery({
                queryKey: [source.scope, a.id],
                queryFn: () => source.fetch(a.id),
                staleTime: 10 * 60 * 1000,
              })
              return link.url
            },
            name: a.name || t('attachment'),
            mime: a.mime,
          },
        })),
      )
      if (failed > 0) toast.error(t('tgListHeader.downloadFailedSome', { count: failed }))
    } finally {
      setBusy(false)
    }
  }

  return { download, busy }
}
