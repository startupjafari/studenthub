'use client'

import dynamic from 'next/dynamic'

// three — только ленивым чанком: экраны, где 3D не открыли, его не скачивают.
export const CampusScene3D = dynamic(() => import('./ui/campus-scene').then((m) => m.CampusScene), {
  ssr: false,
})
export type { CampusSceneProps } from './ui/campus-scene'
export type { SceneFloor, SceneMode } from './model/scene'
