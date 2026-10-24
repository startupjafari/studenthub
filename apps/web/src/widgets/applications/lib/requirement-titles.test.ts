import { describe, expect, it } from 'vitest'
import type {
  ApplicationDetail,
  ApplicationDocumentItem,
  TimelineEvent,
} from '../../../entities/application-service'
import { applicationRequirements, eventComment } from './requirement-titles'

const passport = {
  id: 'r1',
  documentType: 'ID_CARD',
  titleRu: 'Удостоверение',
  titleKk: 'Куәлік',
  titleEn: 'ID card',
  required: true,
}

function attached(requirementId: string): ApplicationDocumentItem {
  return {
    id: `ad-${requirementId}`,
    requirementId,
    documentId: 'doc',
    source: 'STORAGE',
    status: 'PENDING',
    reviewComment: null,
    snapshotTitle: 'Мой документ',
    requirement: {
      id: requirementId,
      titleRu: 'Старое требование',
      titleKk: 'Ескі талап',
      titleEn: 'Old requirement',
      required: false,
    },
  }
}

function app(documents: ApplicationDocumentItem[]): ApplicationDetail {
  return {
    id: 'a1',
    number: 'SH-2026-000001',
    status: 'NEEDS_CORRECTION',
    deliveryType: 'ELECTRONIC',
    formData: {},
    studentId: 'stud',
    facultyId: null,
    universityId: 'uni',
    assignedToId: null,
    submittedAt: null,
    dueAt: null,
    readyAt: null,
    issuedAt: null,
    cancelledAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    service: {
      id: 's1',
      code: 'ref',
      nameRu: 'Справка',
      nameKk: 'Анықтама',
      nameEn: 'Certificate',
      slaHours: 24,
      requirements: [passport],
    },
    rejectionReason: null,
    pickupLocation: null,
    pickupInstructions: null,
    events: [],
    documents,
    results: [],
  }
}

const event = (over: Partial<TimelineEvent>): TimelineEvent => ({
  id: 'e1',
  action: 'DOCUMENT_ADDED',
  fromStatus: null,
  toStatus: null,
  comment: 'Удостоверение',
  actorId: 'stud',
  createdAt: '2026-10-01T10:00:00.000Z',
  ...over,
})

describe('applicationRequirements', () => {
  // Регрессия: убранный в исправлении документ пропадал из чек-листа вместе с требованием.
  it('требование остаётся в чек-листе и без приложенного документа', () => {
    expect(applicationRequirements(app([])).map((r) => r.id)).toEqual(['r1'])
  })

  it('добавляет требование, выключенное после подачи, если к нему приложен документ', () => {
    const ids = applicationRequirements(app([attached('r1'), attached('r-old')])).map((r) => r.id)
    expect(ids).toEqual(['r1', 'r-old'])
  })
})

describe('eventComment', () => {
  it('событие документа подписывается требованием на языке интерфейса', () => {
    expect(eventComment(event({ requirementId: 'r1' }), app([]), 'en')).toBe('ID card')
  })

  it('без requirementId — comment как есть, у назначения — ничего', () => {
    expect(eventComment(event({}), app([]), 'en')).toBe('Удостоверение')
    expect(eventComment(event({ action: 'ASSIGNED', comment: 'id' }), app([]), 'en')).toBeNull()
  })
})
