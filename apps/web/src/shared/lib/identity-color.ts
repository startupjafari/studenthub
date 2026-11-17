// Цвет личности: устойчивый цвет кружка-аватара по идентификатору (как в Telegram).
//
// Почему не токены темы: это не статус и не действие, а способ различить людей и чаты
// в длинном списке — восемь равноправных оттенков, у которых нет семантики. Токенов
// такой роли в системе нет и быть не может (их всего четыре статуса), поэтому палитра
// живёт здесь одним списком — единственное разрешённое место сырой палитры Tailwind
// вне графиков (docs/DESIGN_SYSTEM.md §2.2).
//
// Раньше этот же список с той же хэш-функцией был скопирован в четырёх файлах чатов:
// добавление оттенка требовало четырёх правок, и цвет одного пользователя мог разъехаться
// между экранами.

/**
 * Оттенки различения: порядок фиксирован — от него зависит цвет конкретного человека.
 * На кружке белые инициалы 14px, поэтому у каждого оттенка контраст с белым не ниже 4.5
 * (WCAG AA, axe и Lighthouse): у 500-х он был 2.9–4.5, тёплые тона берутся на шаг-два темнее.
 */
export const IDENTITY_COLORS = [
  'bg-rose-600',
  'bg-orange-700',
  'bg-amber-700',
  'bg-emerald-700',
  'bg-teal-700',
  'bg-sky-700',
  'bg-indigo-600',
  'bg-fuchsia-600',
] as const

const FALLBACK = IDENTITY_COLORS[5]

/**
 * Цвет по идентификатору. Хэш детерминированный: один и тот же пользователь получает
 * один и тот же цвет на всех экранах и между сессиями.
 */
export function identityColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return IDENTITY_COLORS[h % IDENTITY_COLORS.length] ?? FALLBACK
}

/**
 * Акцент личности для текста и полос — имя автора в группе, цитата ответа, «Переслано от»
 * (Telegram красит их цветом человека). Порядок совпадает с IDENTITY_COLORS: у человека один
 * цвет и на кружке, и в имени. Текст мелкий (13px) и ложится на серый пузырь, да ещё на
 * подложку цитаты, поэтому он на ступень темнее заливки кружка (в тёмной теме — светлее):
 * у оттенков кружка контраст с серым пузырём проседал до 4.3 — ниже AA.
 */
export const IDENTITY_ACCENTS = [
  {
    text: 'text-rose-700 dark:text-rose-300',
    bar: 'bg-rose-600 dark:bg-rose-400',
    tint: 'bg-rose-600/10 dark:bg-rose-400/15',
  },
  {
    text: 'text-orange-800 dark:text-orange-300',
    bar: 'bg-orange-700 dark:bg-orange-400',
    tint: 'bg-orange-700/10 dark:bg-orange-400/15',
  },
  {
    text: 'text-amber-800 dark:text-amber-300',
    bar: 'bg-amber-700 dark:bg-amber-400',
    tint: 'bg-amber-700/10 dark:bg-amber-400/15',
  },
  {
    text: 'text-emerald-800 dark:text-emerald-300',
    bar: 'bg-emerald-700 dark:bg-emerald-400',
    tint: 'bg-emerald-700/10 dark:bg-emerald-400/15',
  },
  {
    text: 'text-teal-800 dark:text-teal-300',
    bar: 'bg-teal-700 dark:bg-teal-400',
    tint: 'bg-teal-700/10 dark:bg-teal-400/15',
  },
  {
    text: 'text-sky-800 dark:text-sky-300',
    bar: 'bg-sky-700 dark:bg-sky-400',
    tint: 'bg-sky-700/10 dark:bg-sky-400/15',
  },
  {
    text: 'text-indigo-700 dark:text-indigo-300',
    bar: 'bg-indigo-600 dark:bg-indigo-400',
    tint: 'bg-indigo-600/10 dark:bg-indigo-400/15',
  },
  {
    text: 'text-fuchsia-700 dark:text-fuchsia-300',
    bar: 'bg-fuchsia-600 dark:bg-fuchsia-400',
    tint: 'bg-fuchsia-600/10 dark:bg-fuchsia-400/15',
  },
] as const

export type IdentityAccent = (typeof IDENTITY_ACCENTS)[number]

/** Акцент по идентификатору — тот же хэш, что у identityColor, значит и тот же оттенок. */
export function identityAccent(id: string): IdentityAccent {
  const i = IDENTITY_COLORS.indexOf(identityColor(id))
  return IDENTITY_ACCENTS[i] ?? IDENTITY_ACCENTS[5]
}

/** Инициалы для кружка: максимум две буквы, «#» если имя пустое. */
export function identityInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((w) => w[0]?.toUpperCase() ?? '').join('') || '#'
}
