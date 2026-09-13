// Типы карьерных мероприятий — зеркало ответов API (GET /career/events).
import type { CareerEventKind, CareerReportPeriod } from '@studenthub/shared-schemas'

export interface CareerEvent {
  id: string
  careerKind: CareerEventKind | null
  title: string
  description: string
  location: string | null
  isOnline: boolean
  startsAt: string
  endsAt: string | null
  organizer: { id: string; firstName: string; lastName: string }
  registered: boolean
  participantsCount: number
}

/** Шаги воронки откликов по возрастанию глубины. Порядок — как в самой воронке. */
export const FUNNEL_STAGES = [
  'SUBMITTED',
  'VIEWED',
  'SHORTLISTED',
  'INTERVIEW',
  'OFFER',
  'HIRED',
] as const
export type FunnelStage = (typeof FUNNEL_STAGES)[number]

/** Сводка карьерного модуля для вуза. Только агрегаты — персональных данных здесь нет. */
export interface UniversityCareerAnalytics {
  companies: Record<string, number>
  vacancies: Record<string, number>
  /** Где отклики лежат СЕЙЧАС, включая отказы и отзывы. Для воронки не годится. */
  funnel: Record<string, number>
  /** Сколько откликов ДОШЛО до шага — накопительно, по журналу переходов. */
  reached: Record<FunnelStage, number>
  /** Очередь и сроки: то, на что сотрудник вуза может повлиять сегодня. */
  queue: {
    vacanciesPending: number
    /** Сколько дней ждёт старейшая заявка. null — очередь пуста. */
    oldestPendingDays: number | null
    /** Медиана времени решения за квартал, часы. null — решений ещё не было. */
    medianDecisionHours: number | null
    companiesRequested: number
    accessExpiringSoon: number
    staleApplications: number
    staleDays: number
    expiringDays: number
  }
  /** Ряды по неделям: ISO-даты начала недели и три параллельных массива значений. */
  weekly: { weeks: string[]; submitted: number[]; interview: number[]; hired: number[] }
  /**
   * Спрос вакансий против предложения студентов по навыкам. `*Share` — доли в процентах
   * (вакансий вуза и студентов): штуки несравнимы между собой, доли сравнимы.
   */
  skills: {
    skill: string
    demand: number
    supply: number
    demandShare: number | null
    supplyShare: number | null
  }[]
  profiles: { visible: number; total: number }
  /** Доли от числа отправленных откликов. */
  rates: { interview: number | null; offer: number | null; hired: number | null }
}

/** Сводка подбора для компании. */
export interface CompanyCareerAnalytics {
  vacancies: Record<string, number>
  funnel: Record<string, number>
  views: number
  rates: { apply: number | null; interview: number | null; hired: number | null }
}

/** Пара «за период / за предыдущий период» — из неё экран считает дельту. */
export interface PeriodValue {
  value: number
  previous: number
}

/**
 * Аналитический отчёт карьерного центра за период (GET /career/analytics/university/report).
 *
 * Часть блоков — за период (объём, скорость, воронка, исходы, факультеты, события),
 * часть — снимок на сегодня (витрина, зарплаты, студенты). Это разные вопросы, и на
 * экране они подписаны по-разному.
 */
export interface CareerReport {
  period: CareerReportPeriod
  from: string
  to: string
  totals: {
    applications: PeriodValue
    hired: PeriodValue
    vacancies: PeriodValue
    companies: PeriodValue
  }
  timing: {
    /** Медиана времени до первого просмотра отклика компанией, часы. */
    firstResponseHours: number | null
    hireDays: number | null
    /** Отклики, на которые компания не отреагировала вообще. */
    silent: number
    silentShare: number | null
    total: number
  }
  funnel: {
    stages: Record<FunnelStage, number>
    /** Потери между соседними шагами. */
    dropoff: { from: FunnelStage; lost: number }[]
  }
  outcomes: {
    hired: number
    rejected: number
    withdrawn: number
    active: number
    total: number
    rejectedShare: number | null
    withdrawnShare: number | null
  }
  faculties: {
    items: {
      id: string
      name: string
      students: number
      applied: number
      hired: number
      appliedShare: number | null
      hiredShare: number | null
    }[]
    /** Сколько факультетов скрыто порогом малых групп. */
    suppressed: number
    minCell: number
  }
  graduates: { year: number; students: number; hired: number; share: number | null }
  companies: { id: string; name: string; applications: number; hired: number }[]
  vacancyCuts: {
    employment: Record<string, number>
    format: Record<string, number>
    experience: Record<string, number>
    cities: { city: string; count: number }[]
  }
  salary: {
    offeredMin: number | null
    offeredMax: number | null
    desiredMin: number | null
    desiredMax: number | null
    currency: string | null
  }
  deadVacancies: { dead: number; shown: number }
  students: {
    readiness: { buckets: number[]; edges: number[] }
    seekers: Record<string, number>
    resumesPublished: number
    profiles: { visible: number; total: number; share: number | null; openedInPeriod: number }
  }
}
