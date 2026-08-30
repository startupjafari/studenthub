import type { UpdateResumeInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { PublicResume, ResumeSettings } from '../model/types'

export const resumeKeys = {
  all: ['resume'] as const,
  mine: () => ['resume', 'mine'] as const,
  public: (slug: string) => ['resume', 'public', slug] as const,
}

export async function fetchResumeSettings(): Promise<ResumeSettings> {
  const { data } = await api.get<ResumeSettings>('/career/resume')
  return data
}

export async function updateResume(input: UpdateResumeInput): Promise<ResumeSettings> {
  const { data } = await api.patch<ResumeSettings>('/career/resume', input)
  return data
}

export async function fetchPublicResume(slug: string): Promise<PublicResume> {
  const { data } = await api.get<PublicResume>(`/career/resume/public/${slug}`)
  return data
}

/**
 * Скачивание PDF. Идёт через axios (а не по прямой ссылке), потому что эндпоинт требует
 * Bearer-токен: он живёт в памяти, и обычная ссылка ушла бы без него.
 *
 * Подписи разделов передаём с фронта: язык интерфейса знает он, и третья копия переводов
 * в API разошлась бы с messages/*.json.
 */
export async function downloadResumePdf(labels: Record<string, string>): Promise<Blob> {
  const { data } = await api.get<Blob>('/career/resume/pdf', {
    params: labels,
    responseType: 'blob',
  })
  return data
}
