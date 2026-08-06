import { getTranslations } from 'next-intl/server'
import { WifiOff } from 'lucide-react'
import { StatusScreen } from '../../shared/ui'

// Офлайн-фолбэк PWA (задача 13.2): отдаётся service worker'ом при отсутствии сети.
export default async function OfflinePage() {
  const t = await getTranslations('Offline')
  return <StatusScreen icon={WifiOff} title={t('title')} description={t('description')} />
}
