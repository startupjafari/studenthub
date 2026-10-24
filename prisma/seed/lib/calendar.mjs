// Учебный календарь сида — от даты прогона, а не от зашитого года.
//
// Раньше семестры генератора всегда назывались «Весна <год>» и «Осень <год>», а осенний
// был активным: прогон в марте заводил активный семестр, который начнётся только через
// полгода, а посещаемость и оценки ложились в «прошедшую» весну. Демо-вуз и вовсе застыл
// в «Осени 2025». Здесь одна точка, от которой считают и семестры, и курс студента.
//
// Учебный год начинается 1 сентября. С августа текущим считается осенний семестр (в
// августе он ещё не начался — до его начала посещаемости нет), с января по июль — весенний.

const AUTUMN_FROM_MONTH = 7 // август, месяцы UTC с нуля

const autumn = (year) => ({ name: `Осень ${year}`, from: `${year}-09-01`, to: `${year}-12-31` })
const spring = (year) => ({ name: `Весна ${year}`, from: `${year}-01-20`, to: `${year}-06-10` })

export function academicCalendar(now = new Date()) {
  const year = now.getUTCFullYear()
  const isAutumn = now.getUTCMonth() >= AUTUMN_FROM_MONTH
  // Год начала учебного года: 2026 и для октября 2026, и для марта 2027 (2026/27).
  const academicYear = isAutumn ? year : year - 1
  const next = String((academicYear + 1) % 100).padStart(2, '0')
  return {
    academicYear,
    // Прошлый семестр закрыт (транскрипт, история оценок), текущий — активен.
    prev: isAutumn ? spring(year) : autumn(year - 1),
    cur: isAutumn ? autumn(year) : spring(year),
    scheduleName: `${isAutumn ? 'Осенний' : 'Весенний'} семестр ${academicYear}/${next}`,
  }
}

// Курс студента набора `enrollmentYear` в текущем учебном году: 1..4.
export function courseOf(enrollmentYear, now = new Date()) {
  const course = academicCalendar(now).academicYear - enrollmentYear + 1
  return Math.max(1, Math.min(4, course))
}

// Годы набора четырёх курсов бакалавриата в текущем учебном году: от четвёртого к первому.
export function enrollmentYears(now = new Date()) {
  const { academicYear } = academicCalendar(now)
  return [academicYear - 3, academicYear - 2, academicYear - 1, academicYear]
}
