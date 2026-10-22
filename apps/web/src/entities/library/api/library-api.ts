import type {
  LibrarySettingsResponse,
  UpdateLibrarySettingsInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

// Библиотека вуза (Фаза 20, docs/PROJECT.md §3.11). Ключи запросов — фабрика рядом с
// запросами, как у остальных сущностей.
export const libraryKeys = {
  all: ['library'] as const,
  settings: () => ['library', 'settings'] as const,
}

export async function fetchLibrarySettings(): Promise<LibrarySettingsResponse> {
  const { data } = await api.get<LibrarySettingsResponse>('/library/settings')
  return data
}

export async function updateLibrarySettingsRequest(
  input: UpdateLibrarySettingsInput,
): Promise<LibrarySettingsResponse> {
  const { data } = await api.patch<LibrarySettingsResponse>('/library/settings', input)
  return data
}
