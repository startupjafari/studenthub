import { useTranslations } from 'next-intl'
import { PageLoader } from '../shared/ui/page-loader'

// Каждый route segment обязан иметь loading.tsx (docs/FRONTEND_RULES.md §2.2).
//
// Корневой лоадер встаёт и внутри оболочки (её держит корневой layout — PersistentShell),
// и на страницах без неё (вход, публичные ссылки). Без оболочки он занимает экран, в ней —
// только область контента: `min-h-dvh` в `main` дал бы прокрутку на величину её отступов.
export default function Loading() {
  const t = useTranslations('Common')
  return (
    <PageLoader
      label={t('loading')}
      className="min-h-dvh [.sh-scroll_&]:min-h-0 [.sh-scroll_&]:flex-1"
    />
  )
}
