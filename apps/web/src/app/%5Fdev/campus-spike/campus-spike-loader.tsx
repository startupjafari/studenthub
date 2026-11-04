'use client'

import dynamic from 'next/dynamic'

// three — только в чанке этой страницы: проверяем, что общий бандл не растёт.
const CampusSpike = dynamic(() => import('./campus-spike').then((m) => m.CampusSpike), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-muted-foreground">Загружаем 3D…</p>,
})

export function CampusSpikeLoader() {
  return <CampusSpike />
}
