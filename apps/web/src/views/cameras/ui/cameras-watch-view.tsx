'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Settings2 } from 'lucide-react'
import { Button, PageHeader } from '../../../shared/ui'
import { CameraWall } from '../../../widgets/camera-wall'

// Просмотр камер вуза (docs/PROJECT.md §3.10) — охрана на посту и администратор вуза.
// Администратору — ссылка на управление камерами.
export function CamerasWatchView({ manageHref }: { manageHref?: string }) {
  const t = useTranslations('CameraWatch')
  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          manageHref ? (
            <Button asChild variant="outline" size="md">
              <Link href={manageHref}>
                <Settings2 className="size-4" aria-hidden />
                {t('manage')}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <CameraWall />
    </div>
  )
}
