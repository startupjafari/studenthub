import type { CareerEventListQueryInput, CareerReportPeriod } from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import { requestFile, type DownloadedFile } from '../../../shared/lib'
import type {
  CareerEvent,
  CareerReport,
  CompanyCareerAnalytics,
  UniversityCareerAnalytics,
} from '../model/types'

export const careerEventKeys = {
  all: ['career-event'] as const,
  list: (params: Partial<CareerEventListQueryInput>) => ['career-event', 'list', params] as const,
  // Вуз входит в ключ: платформенная роль переключает область данных без перезагрузки,
  // и метрики разных вузов не должны подменять друг друга в кэше.
  universityAnalytics: (universityId?: string | null) =>
    ['career-analytics', 'university', universityId ?? 'own'] as const,
  companyAnalytics: () => ['career-analytics', 'company'] as const,
  // Период входит в ключ: переключение периода — это другая выборка, а не обновление той же.
  report: (universityId: string | null | undefined, period: CareerReportPeriod) =>
    ['career-analytics', 'report', universityId ?? 'own', period] as const,
}

export function fetchCareerEvents(
  params: Partial<CareerEventListQueryInput> = {},
): Promise<Paged<CareerEvent>> {
  return getPaged<CareerEvent>('/career/events', { page: 1, limit: 20, ...params })
}

export async function fetchUniversityCareerAnalytics(
  universityId?: string,
): Promise<UniversityCareerAnalytics> {
  const { data } = await api.get<UniversityCareerAnalytics>('/career/analytics/university', {
    params: universityId ? { universityId } : undefined,
  })
  return data
}

export async function fetchCompanyCareerAnalytics(): Promise<CompanyCareerAnalytics> {
  const { data } = await api.get<CompanyCareerAnalytics>('/career/analytics/company')
  return data
}

/** Аналитический отчёт за период — экран «Метрики». */
export async function fetchCareerReport(
  period: CareerReportPeriod,
  universityId?: string,
): Promise<CareerReport> {
  const { data } = await api.get<CareerReport>('/career/analytics/university/report', {
    params: { period, ...(universityId ? { universityId } : {}) },
  })
  return data
}

/**
 * Тот же отчёт файлом. Собирает его сервер: там те же запросы, что и у экрана, плюс лист
 * с происхождением выгрузки и единое имя файла.
 */
export async function exportCareerReport(
  period: CareerReportPeriod,
  universityId: string | undefined,
  locale: string,
  format: 'xlsx' | 'csv' = 'xlsx',
): Promise<DownloadedFile> {
  return requestFile('/career/analytics/university/report/export', {
    period,
    format,
    locale,
    ...(universityId ? { universityId } : {}),
  })
}
