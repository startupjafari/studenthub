// Календарь праздников: единственный источник того, какой день оформляется и как.
//
// Почему таблица в коде, а не в БД. Набор праздников одинаков для всех вузов платформы и
// меняется раз в несколько лет законом — это справочник, а не настройка. Он обязан ехать
// человеку той же сборкой, что и код, который его читает: у PWA с домашнего экрана вкладка
// неделями живёт на старом бандле, и дата, прилетевшая из API раньше оформления, включила бы
// Наурыз на экране, который про Наурыз ничего не знает.
//
// Почему в apps/web, а не в packages/shared-config. Потребитель пока один — веб, а в пакетах
// нет тест-раннера: справочник дат без тестов на границы бессмысленен. Переедет в
// shared-config, когда даты понадобятся API (письма, напоминания).
//
// Чего здесь НЕТ намеренно: переноса выходных. Если праздник выпал на субботу, отдыхают в
// понедельник — но оформляем мы сам праздник, а перенос относится к производственному
// календарю и появится вместе с отметкой нерабочих дней в расписании.

/**
 * Что это за день. Определяет приоритет при совпадении дат и то, насколько громко можно
 * оформлять: `MEMORIAL` — день памяти, он гасит любое оформление, а не добавляет своё.
 */
export type HolidayTier = 'MEMORIAL' | 'STATE' | 'ACADEMIC' | 'OBSERVED' | 'SOFT'

/** Тон оформления: `solemn` — без палитры и без движения, только сдержанная строка. */
export type HolidayTone = 'festive' | 'national' | 'warm' | 'solemn'

/**
 * Когда праздник наступает. Три формы, потому что три разных природы даты:
 * фиксированная в законе, лунная (формулой не считается) и правило «N-й день недели месяца».
 */
export type HolidayDate =
  /** Фиксированные `MM-DD`; `to` — последний день диапазона подряд идущих дней. */
  | { kind: 'fixed'; from: string; to?: string }
  /** Лунный календарь: точный день объявляют ежегодно, поэтому он перечислен по годам. */
  | { kind: 'lunar'; byYear: Readonly<Record<string, string>> }
  /** `weekday` — ISO (1 = понедельник … 7 = воскресенье). */
  | { kind: 'nth'; month: number; weekday: number; nth: number }

export interface Holiday {
  /** Ключ праздника: он же значение `data-season` и префикс ключей i18n. */
  readonly id: string
  readonly tier: HolidayTier
  readonly tone: HolidayTone
  /** `KZ` — праздник Казахстана, `GLOBAL` — отмечается везде. */
  readonly scope: 'KZ' | 'GLOBAL'
  readonly when: HolidayDate
  /** Официально нерабочий день (ТК РК ст. 84 + Закон «О праздниках в РК»). */
  readonly dayOff: boolean
  /**
   * Оформляем ли этот день. `false` — праздник известен платформе, но ничего не рисует:
   * так выключены дни памяти (гасят чужое оформление собой) и праздники, по которым
   * решение принимает продукт, а не разработчик.
   */
  readonly decorated: boolean
}

/**
 * Приоритет при совпадении дат: побеждает больший. День памяти выигрывает у любого
 * праздника — это и есть способ гарантировать, что 31 мая интерфейс не поздравляет.
 */
const TIER_PRIORITY: Record<HolidayTier, number> = {
  MEMORIAL: 100,
  STATE: 80,
  ACADEMIC: 60,
  OBSERVED: 50,
  SOFT: 20,
}

/**
 * Лунные праздники: даты предварительные, точный день объявляет ДУМК за недели до него.
 * Таблица заполняется на годы вперёд, а тест `holidays.test.ts` падает, как только
 * покрытия не хватает на текущий и следующий год, — иначе праздник однажды молча исчез бы.
 */
const KURBAN_AIT_BY_YEAR = {
  '2026': '05-27',
  '2027': '05-16',
  '2028': '05-05',
} as const

const ORAZA_AIT_BY_YEAR = {
  '2026': '03-20',
  '2027': '03-09',
  '2028': '02-26',
} as const

export const HOLIDAYS: readonly Holiday[] = [
  // ── Дни памяти: оформления не несут, но обязаны быть в таблице ───────────────
  // Их роль — выиграть приоритет у всего остального и выключить праздничный вид.
  {
    id: 'repression-victims-day',
    tier: 'MEMORIAL',
    tone: 'solemn',
    scope: 'KZ',
    when: { kind: 'fixed', from: '05-31' },
    dayOff: false,
    decorated: false,
  },

  // ── Государственные праздники и нерабочие дни РК ─────────────────────────────
  {
    id: 'new-year',
    tier: 'STATE',
    tone: 'festive',
    scope: 'GLOBAL',
    when: { kind: 'fixed', from: '01-01', to: '01-02' },
    dayOff: true,
    decorated: true,
  },
  {
    id: 'orthodox-christmas',
    tier: 'STATE',
    tone: 'solemn',
    scope: 'KZ',
    when: { kind: 'fixed', from: '01-07' },
    dayOff: true,
    decorated: true,
  },
  {
    id: 'womens-day',
    tier: 'STATE',
    tone: 'warm',
    scope: 'GLOBAL',
    when: { kind: 'fixed', from: '03-08' },
    dayOff: true,
    decorated: true,
  },
  {
    id: 'nauryz',
    tier: 'STATE',
    tone: 'festive',
    scope: 'KZ',
    when: { kind: 'fixed', from: '03-21', to: '03-23' },
    dayOff: true,
    decorated: true,
  },
  {
    id: 'unity-day',
    tier: 'STATE',
    tone: 'national',
    scope: 'KZ',
    when: { kind: 'fixed', from: '05-01' },
    dayOff: true,
    decorated: true,
  },
  {
    id: 'defender-day',
    tier: 'STATE',
    tone: 'solemn',
    scope: 'KZ',
    when: { kind: 'fixed', from: '05-07' },
    dayOff: true,
    decorated: true,
  },
  {
    id: 'victory-day',
    tier: 'STATE',
    tone: 'solemn',
    scope: 'KZ',
    when: { kind: 'fixed', from: '05-09' },
    dayOff: true,
    decorated: true,
  },
  {
    id: 'kurban-ait',
    tier: 'STATE',
    tone: 'solemn',
    scope: 'KZ',
    when: { kind: 'lunar', byYear: KURBAN_AIT_BY_YEAR },
    dayOff: true,
    decorated: true,
  },
  {
    id: 'capital-day',
    tier: 'STATE',
    tone: 'national',
    scope: 'KZ',
    when: { kind: 'fixed', from: '07-06' },
    dayOff: true,
    decorated: true,
  },
  {
    id: 'constitution-day',
    tier: 'STATE',
    tone: 'national',
    scope: 'KZ',
    when: { kind: 'fixed', from: '08-30' },
    dayOff: true,
    decorated: true,
  },
  {
    id: 'republic-day',
    tier: 'STATE',
    tone: 'national',
    scope: 'KZ',
    when: { kind: 'fixed', from: '10-25' },
    dayOff: true,
    decorated: true,
  },
  {
    id: 'independence-day',
    tier: 'STATE',
    tone: 'national',
    scope: 'KZ',
    when: { kind: 'fixed', from: '12-16' },
    dayOff: true,
    decorated: true,
  },

  // ── Академические: ради них платформа и существует ───────────────────────────
  {
    id: 'knowledge-day',
    tier: 'ACADEMIC',
    tone: 'warm',
    scope: 'KZ',
    when: { kind: 'fixed', from: '09-01' },
    dayOff: false,
    decorated: true,
  },
  {
    id: 'teachers-day',
    // В Казахстане — первое воскресенье октября, а не 5 октября (день ЮНЕСКО).
    tier: 'ACADEMIC',
    tone: 'warm',
    scope: 'KZ',
    when: { kind: 'nth', month: 10, weekday: 7, nth: 1 },
    dayOff: false,
    decorated: true,
  },

  // ── Отмечаемые, но рабочие дни ───────────────────────────────────────────────
  {
    id: 'oraza-ait',
    tier: 'OBSERVED',
    tone: 'solemn',
    scope: 'KZ',
    when: { kind: 'lunar', byYear: ORAZA_AIT_BY_YEAR },
    dayOff: false,
    decorated: true,
  },
  {
    id: 'languages-day',
    tier: 'OBSERVED',
    tone: 'national',
    scope: 'KZ',
    when: { kind: 'fixed', from: '09-22' },
    dayOff: false,
    decorated: true,
  },
  {
    id: 'students-day',
    tier: 'OBSERVED',
    tone: 'warm',
    scope: 'GLOBAL',
    when: { kind: 'fixed', from: '11-17' },
    dayOff: false,
    decorated: true,
  },
  {
    id: 'new-year-eve',
    // Отдельной строкой, а не хвостом `new-year`: 31 декабря — рабочий день, и диапазон
    // через границу года сделал бы `dayOff` враньём ровно для этих дней.
    tier: 'OBSERVED',
    tone: 'festive',
    scope: 'GLOBAL',
    when: { kind: 'fixed', from: '12-29', to: '12-31' },
    dayOff: false,
    decorated: true,
  },

  // ── Мягкие глобальные: выключены, пока продукт не решит иначе ────────────────
  // Оставлены в таблице сознательно: включение — смена одного флага, а не новый код.
  {
    id: 'valentines-day',
    tier: 'SOFT',
    tone: 'warm',
    scope: 'GLOBAL',
    when: { kind: 'fixed', from: '02-14' },
    dayOff: false,
    decorated: false,
  },
  {
    id: 'halloween',
    tier: 'SOFT',
    tone: 'festive',
    scope: 'GLOBAL',
    when: { kind: 'fixed', from: '10-31' },
    dayOff: false,
    decorated: false,
  },
]

const pad = (value: number): string => String(value).padStart(2, '0')

/** Дата N-го дня недели месяца в виде `MM-DD`. */
function nthWeekday(year: number, month: number, weekday: number, nth: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1))
  // getUTCDay(): 0 = воскресенье; приводим к ISO, где воскресенье — 7.
  const firstIso = first.getUTCDay() === 0 ? 7 : first.getUTCDay()
  const day = 1 + ((weekday - firstIso + 7) % 7) + (nth - 1) * 7
  return `${pad(month)}-${pad(day)}`
}

function matches(holiday: Holiday, year: string, monthDay: string): boolean {
  const { when } = holiday
  if (when.kind === 'fixed') return monthDay >= when.from && monthDay <= (when.to ?? when.from)
  if (when.kind === 'lunar') return when.byYear[year] === monthDay
  return nthWeekday(Number(year), when.month, when.weekday, when.nth) === monthDay
}

/**
 * Праздники этого дня. Дата — `YYYY-MM-DD` в таймзоне платформы: считать её обязан
 * вызывающий (`shared/lib/tz-date.ts`), иначе у человека в другом часовом поясе праздник
 * начнётся и кончится не тогда, когда у его вуза.
 */
export function holidaysOn(date: string): Holiday[] {
  const year = date.slice(0, 4)
  const monthDay = date.slice(5)
  return HOLIDAYS.filter((holiday) => matches(holiday, year, monthDay))
}

/**
 * Праздник дня, один: при совпадении дат побеждает старший tier, при равном — тот, что
 * выше в таблице. Один день — одно оформление; выбирать его в разметке нельзя.
 */
export function activeHoliday(date: string): Holiday | null {
  let best: Holiday | null = null
  for (const holiday of holidaysOn(date)) {
    if (!best || TIER_PRIORITY[holiday.tier] > TIER_PRIORITY[best.tier]) best = holiday
  }
  return best
}

/**
 * Значение `data-season` для этого дня или `null`, если день не оформляется. День памяти
 * возвращает `null` именно потому, что выигрывает приоритет у праздника рядом.
 */
export function activeSeason(date: string): Holiday | null {
  const holiday = activeHoliday(date)
  return holiday?.decorated ? holiday : null
}
