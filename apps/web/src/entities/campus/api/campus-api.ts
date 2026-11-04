import type {
  CreateCampusBuildingInput,
  CreateCampusFloorInput,
  CreateCampusInput,
  PublishCampusInput,
  SaveCampusFloorPlanInput,
  SaveCampusSitePlanInput,
  UpdateCampusBuildingInput,
  UpdateCampusFloorInput,
  UpdateCampusInput,
} from '@studenthub/shared-schemas'
import type { FloorPlanDoc, NavGraph } from '@studenthub/campus-core'
import { api } from '../../../shared/api'
import type {
  CampusBuildingRow,
  CampusFloorRow,
  CampusPlan,
  CampusPresence,
  CampusPublished,
  CampusSite,
  CampusSpaceHit,
  CampusSummary,
  CampusTree,
  CampusVersionRow,
} from '../model/types'

export const campusKeys = {
  all: ['campus'] as const,
  list: () => ['campus', 'list'] as const,
  tree: (id: string) => ['campus', 'tree', id] as const,
  plan: (floorId: string) => ['campus', 'plan', floorId] as const,
  site: (id: string) => ['campus', 'site', id] as const,
  versions: (id: string) => ['campus', 'versions', id] as const,
  published: (id: string) => ['campus', 'published', id] as const,
  publishedFloor: (id: string, floorId: string, versionId: string) =>
    ['campus', 'published', id, 'floor', floorId, versionId] as const,
  search: (q: string, campusId?: string) => ['campus', 'search', q, campusId ?? ''] as const,
  roomLocation: (roomId: string) => ['campus', 'room', roomId] as const,
  nav: (id: string, versionId: string) => ['campus', 'published', id, 'nav', versionId] as const,
}

export async function fetchCampuses(): Promise<CampusSummary[]> {
  return (await api.get<CampusSummary[]>('/campus')).data
}

export async function createCampus(input: CreateCampusInput): Promise<CampusSummary> {
  return (await api.post<CampusSummary>('/campus', input)).data
}

export async function fetchCampusTree(id: string): Promise<CampusTree> {
  return (await api.get<CampusTree>(`/campus/${id}`)).data
}

export async function updateCampus(id: string, input: UpdateCampusInput): Promise<void> {
  await api.patch(`/campus/${id}`, input)
}

export async function deleteCampus(id: string): Promise<void> {
  await api.delete(`/campus/${id}`)
}

export async function createCampusBuilding(
  campusId: string,
  input: CreateCampusBuildingInput,
): Promise<CampusBuildingRow> {
  return (await api.post<CampusBuildingRow>(`/campus/${campusId}/buildings`, input)).data
}

export async function updateCampusBuilding(
  id: string,
  input: UpdateCampusBuildingInput,
): Promise<void> {
  await api.patch(`/campus/buildings/${id}`, input)
}

export async function deleteCampusBuilding(id: string): Promise<void> {
  await api.delete(`/campus/buildings/${id}`)
}

export async function createCampusFloor(
  buildingId: string,
  input: CreateCampusFloorInput,
): Promise<CampusFloorRow> {
  return (await api.post<CampusFloorRow>(`/campus/buildings/${buildingId}/floors`, input)).data
}

export async function updateCampusFloor(id: string, input: UpdateCampusFloorInput): Promise<void> {
  await api.patch(`/campus/floors/${id}`, input)
}

export async function deleteCampusFloor(id: string): Promise<void> {
  await api.delete(`/campus/floors/${id}`)
}

export async function fetchCampusPlan(floorId: string): Promise<CampusPlan> {
  return (await api.get<CampusPlan>(`/campus/floors/${floorId}/plan`)).data
}

export async function saveCampusPlan(
  floorId: string,
  input: SaveCampusFloorPlanInput,
): Promise<{ revision: number }> {
  return (await api.put<{ revision: number }>(`/campus/floors/${floorId}/plan`, input)).data
}

export async function campusPresence(floorId: string, force = false): Promise<CampusPresence> {
  return (await api.post<CampusPresence>(`/campus/floors/${floorId}/presence`, { force })).data
}

export async function fetchCampusSite(id: string): Promise<CampusSite> {
  return (await api.get<CampusSite>(`/campus/${id}/site`)).data
}

export async function saveCampusSite(
  id: string,
  input: SaveCampusSitePlanInput,
): Promise<{ revision: number }> {
  return (await api.put<{ revision: number }>(`/campus/${id}/site`, input)).data
}

export async function publishCampus(
  id: string,
  input: PublishCampusInput,
): Promise<{ id: string; number: number; spaces: number }> {
  return (
    await api.post<{ id: string; number: number; spaces: number }>(`/campus/${id}/publish`, input)
  ).data
}

export async function fetchCampusVersions(id: string): Promise<CampusVersionRow[]> {
  return (await api.get<CampusVersionRow[]>(`/campus/${id}/versions`)).data
}

export async function activateCampusVersion(id: string, versionId: string): Promise<void> {
  await api.post(`/campus/${id}/versions/${versionId}/activate`)
}

export async function restoreCampusVersion(
  id: string,
  versionId: string,
): Promise<{ restored: number }> {
  return (await api.post<{ restored: number }>(`/campus/${id}/versions/${versionId}/restore`)).data
}

export async function fetchCampusPublished(id: string): Promise<CampusPublished> {
  return (await api.get<CampusPublished>(`/campus/${id}/published`)).data
}

export async function fetchCampusPublishedFloor(
  id: string,
  floorId: string,
): Promise<{ floorId: string; versionId: string; document: FloorPlanDoc }> {
  return (await api.get(`/campus/${id}/published/floors/${floorId}`)).data as {
    floorId: string
    versionId: string
    document: FloorPlanDoc
  }
}

export async function searchCampus(q: string, campusId?: string): Promise<CampusSpaceHit[]> {
  return (
    await api.get<CampusSpaceHit[]>('/campus/search', {
      params: { q, ...(campusId ? { campusId } : {}) },
    })
  ).data
}

export async function fetchRoomLocation(roomId: string): Promise<CampusSpaceHit> {
  return (await api.get<CampusSpaceHit>(`/campus/rooms/${roomId}/location`)).data
}

/** Навигационный граф текущей версии под уровень зрителя; null — версия без графа. */
export async function fetchCampusNav(
  id: string,
): Promise<{ versionId: string; graph: NavGraph | null }> {
  return (
    await api.get<{ versionId: string; graph: NavGraph | null }>(`/campus/${id}/published/nav`)
  ).data
}
