import type { FloorPlanDoc, SitePlanDoc, ViewerLevel } from '@studenthub/campus-core'

// Типы ответов API кампуса (docs/PROJECT.md §3.13). Геометрия — форматы @studenthub/campus-core.

export interface CampusPoint {
  x: number
  y: number
}

export interface CampusTransform {
  x: number
  y: number
  rotationDeg: number
}

export interface CampusSummary {
  id: string
  universityId: string
  name: string
  description: string | null
  publishedVersionId: string | null
  updatedAt: string
  buildingsCount: number
  canEdit: boolean
}

export interface CampusFloorRow {
  id: string
  buildingId: string
  level: number
  label: string
  kind: 'regular' | 'basement' | 'technical'
  elevationMm: number
  heightMm: number
  plan: { revision: number; updatedAt: string; sizeBytes: number } | null
}

export interface CampusBuildingRow {
  id: string
  campusId: string
  name: string
  code: string | null
  outline: CampusPoint[]
  transform: CampusTransform
  sortOrder: number
  floors: CampusFloorRow[]
}

export interface CampusTree {
  id: string
  universityId: string
  name: string
  description: string | null
  publishedVersionId: string | null
  buildings: CampusBuildingRow[]
  site: { revision: number; updatedAt: string } | null
  publishedVersion: { id: string; number: number; publishedAt: string } | null
}

export interface CampusPlan {
  floorId: string
  campusId: string
  buildingId: string
  label: string
  heightMm: number
  format: number
  revision: number
  document: FloorPlanDoc
  updatedAt: string | null
}

export interface CampusSite {
  campusId: string
  revision: number
  document: SitePlanDoc
}

export interface CampusVersionRow {
  id: string
  number: number
  note: string | null
  publishedAt: string
  spaces: number
  current: boolean
}

export interface CampusManifestFloor {
  id: string
  level: number
  label: string
  kind: string
  elevationMm: number
  heightMm: number
}

export interface CampusManifestBuilding {
  id: string
  name: string
  code: string | null
  outline: CampusPoint[]
  transform: CampusTransform
  floors: CampusManifestFloor[]
}

export interface CampusPublished {
  campus: { id: string; name: string; description: string | null }
  version: { id: string; number: number; publishedAt: string }
  level: ViewerLevel
  manifest: { buildings: CampusManifestBuilding[]; site: SitePlanDoc | null }
}

export interface CampusSpaceHit {
  campusId: string
  campusName: string
  spaceId: string
  roomId: string | null
  number: string | null
  name: string | null
  kind: string
  building: { id: string; name: string; code: string | null } | null
  floor: { id: string; level: number; label: string } | null
  center: CampusPoint
}

export interface CampusPresence {
  mine: boolean
  holder: { userId: string; since: string } | null
}
