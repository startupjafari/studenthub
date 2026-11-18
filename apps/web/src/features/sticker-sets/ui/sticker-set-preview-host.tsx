'use client'

import { useTranslations } from 'next-intl'
import {
  closeStickerSetPreview,
  useStickerUi,
  type PanelSticker,
} from '../../../entities/sticker-set'
import { Modal } from '../../../shared/ui'
import { StickerSetPreviewContent, useStickerSetPreview } from './sticker-set-preview'

/**
 * Окно набора поверх чата — открывается нажатием на стикер в переписке (как в Telegram).
 * Жалоба и отправка — у окна чата: фичи не знают друг о друге, поэтому их передают сюда.
 */
export function StickerSetPreviewHost({
  onReport,
  onSend,
}: {
  onReport?: (setId: string) => void
  onSend?: (sticker: PanelSticker) => void
}) {
  const { preview } = useStickerUi()
  if (!preview) return null
  return <PreviewModal query={preview} onReport={onReport} onSend={onSend} />
}

function PreviewModal({
  query,
  onReport,
  onSend,
}: {
  query: NonNullable<ReturnType<typeof useStickerUi>['preview']>
  onReport?: (setId: string) => void
  onSend?: (sticker: PanelSticker) => void
}) {
  const t = useTranslations('Chats')
  const data = useStickerSetPreview(query)
  return (
    <Modal
      onClose={closeStickerSetPreview}
      title={data.data?.title ?? t('tgStickers.setTitle')}
      size="md"
    >
      <StickerSetPreviewContent
        query={query}
        onReport={
          onReport
            ? (id) => {
                closeStickerSetPreview()
                onReport(id)
              }
            : undefined
        }
        onSend={
          onSend
            ? (s) => {
                closeStickerSetPreview()
                onSend(s)
              }
            : undefined
        }
      />
    </Modal>
  )
}
