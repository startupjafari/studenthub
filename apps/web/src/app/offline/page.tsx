'use client'

import { useTranslations } from 'next-intl'
import { WifiOff } from 'lucide-react'
import { StatusScreen } from '../../shared/ui'

// Офлайн-фолбэк PWA (задача 13.2): отдаётся service worker'ом при отсутствии сети.
// Клиентский компонент: StatusScreen принимает иконку-функцию (lucide), которую нельзя
// сериализовать из серверного компонента (RSC-ограничение) — иначе ошибка рендера
// «Functions cannot be passed directly to Client Components» (ср. not-found.tsx).
export default function OfflinePage() {
  const t = useTranslations('Offline')
  return <StatusScreen icon={WifiOff} title={t('title')} description={t('description')} />
}
