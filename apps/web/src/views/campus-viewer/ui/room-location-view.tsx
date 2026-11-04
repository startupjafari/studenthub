'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { MapPinOff } from 'lucide-react'
import { campusKeys, fetchRoomLocation } from '../../../entities/campus'
import { EmptyState, PageLoader } from '../../../shared/ui'

/**
 * Мост «Показать на карте» из расписания, экзаменов и QR-страницы помещения: id Room →
 * кампус, этаж и помещение опубликованной карты (§17).
 */
export function RoomLocationView({ roomId }: { roomId: string }) {
  const t = useTranslations('CampusMap')
  const router = useRouter()
  const loc = useQuery({
    queryKey: campusKeys.roomLocation(roomId),
    queryFn: () => fetchRoomLocation(roomId),
    retry: false,
  })
  useEffect(() => {
    const d = loc.data
    if (d?.floor) router.replace(`/campus/${d.campusId}?floor=${d.floor.id}&space=${d.spaceId}`)
  }, [loc.data, router])
  if (loc.isError) {
    return (
      <EmptyState
        icon={<MapPinOff className="size-6" aria-hidden />}
        title={t('roomNotOnMap')}
        description={t('roomNotOnMapText')}
      />
    )
  }
  return <PageLoader label={t('loading')} />
}
