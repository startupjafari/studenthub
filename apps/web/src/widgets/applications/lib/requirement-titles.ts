import {
  pickLocale,
  type ApplicationDetail,
  type ApplicationRequirementRef,
  type TimelineEvent,
} from '../../../entities/application-service'

/**
 * Чек-лист документов заявки: действующие требования услуги и те, к которым документ уже
 * приложен (требование могли выключить после подачи). Строится по требованиям, а не по
 * приложенным строкам: убранный в исправлении документ иначе пропадал вместе со своим
 * требованием, и приложить его заново было негде.
 */
export function applicationRequirements(app: ApplicationDetail): ApplicationRequirementRef[] {
  const out: ApplicationRequirementRef[] = [...(app.service.requirements ?? [])]
  const known = new Set(out.map((r) => r.id))
  for (const d of app.documents) {
    if (known.has(d.requirementId)) continue
    known.add(d.requirementId)
    out.push({
      id: d.requirement.id,
      documentType: null,
      titleRu: d.requirement.titleRu,
      titleKk: d.requirement.titleKk,
      titleEn: d.requirement.titleEn,
      required: d.requirement.required,
    })
  }
  return out
}

/**
 * Пояснение к событию истории. У событий документа comment — русское название требования
 * (так его пишет сервер для прежних клиентов); если требование известно, подписываем его на
 * языке интерфейса. У назначения comment не текст (старые записи хранили там id сотрудника).
 */
export function eventComment(
  e: TimelineEvent,
  app: ApplicationDetail,
  locale: string,
): string | null {
  if (e.action === 'ASSIGNED') return null
  if (e.requirementId) {
    const req = applicationRequirements(app).find((r) => r.id === e.requirementId)
    if (req) return pickLocale(req as unknown as Record<string, unknown>, 'title', locale)
  }
  return e.comment
}
