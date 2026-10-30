'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CameraWall } from '../../../widgets/camera-wall'

// Просмотр камер вуза (docs/PROJECT.md §3.10) — охрана на посту и администратор вуза.
// Администратор приходит сюда из управления камерами — ему стрелка «назад» туда же.
export function CamerasWatchView({ backHref }: { backHref?: string }) {
  const t = useTranslations('CameraWatch')
  const router = useRouter()
  return (
    <CameraWall
      header={{
        title: t('title'),
        subtitle: t('subtitle'),
        onBack: backHref ? () => router.push(backHref) : undefined,
        backLabel: t('back'),
      }}
    />
  )
}
