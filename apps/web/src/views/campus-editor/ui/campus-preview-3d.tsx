'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { CampusScene3D, type SceneFloor } from '../../../widgets/campus-3d'
import { useEditor, type EditorStore } from '../../../features/campus-editor'

/**
 * 3D-превью этажа прямо в редакторе (§13.4): тот же документ, что на холсте, — видно,
 * как лягут проёмы и высоты. Клик по полу выделяет помещение и возвращает к его свойствам.
 */
export function CampusPreview3D({
  store,
  floorHeightMm,
}: {
  store: EditorStore
  floorHeightMm: number
}) {
  const t = useTranslations('CampusEditor')
  const doc = useEditor(store, (s) => s.doc)
  const selection = useEditor(store, (s) => s.selection)
  const floors = useMemo<SceneFloor[]>(
    () => [
      {
        id: 'current',
        buildingId: 'current',
        level: 0,
        doc,
        elevationMm: 0,
        heightMm: floorHeightMm,
      },
    ],
    [doc, floorHeightMm],
  )
  // Ссылки стабильны между ререндерами: каждое новое значение — пересборка сцены.
  const highlight = useMemo(
    () => (selection.kind === 'space' ? { floorId: 'current', spaceId: selection.id } : null),
    [selection],
  )
  const onPick = useMemo(
    () => (_floor: string, spaceId: string) =>
      store.set({ selection: { kind: 'space', id: spaceId } }),
    [store],
  )
  return (
    <CampusScene3D
      label={t('preview3d')}
      floors={floors}
      mode="floor"
      focusFloorId="current"
      highlight={highlight}
      route={null}
      site={null}
      onPick={onPick}
    />
  )
}
