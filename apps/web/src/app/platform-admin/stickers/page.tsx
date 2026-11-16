import { StickerSetsView } from '../../../views/platform-admin'

// Каталог стикеров чатов (docs/PROJECT.md «Стикеры»): только PLATFORM_ADMIN — зону закрывает
// RoleGuard layout'а, ручки /admin/sticker-sets проверяет сервер.
export default function Page() {
  return <StickerSetsView />
}
