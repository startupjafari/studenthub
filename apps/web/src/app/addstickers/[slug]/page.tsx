import { StickerSetLinkView } from '../../../views/sticker-set-link'

// Ссылка на набор стикеров `/addstickers/<slug>` (как t.me/addstickers в Telegram).
export default async function StickerSetLinkPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <StickerSetLinkView slug={decodeURIComponent(slug)} />
}
