// Хелперы «дня» расписания переехали в entities/schedule (их использует ещё и страница
// помещения по QR, Ф16 — а импорт view→view запрещён, §2.1). Здесь только реэкспорт,
// чтобы не переписывать существующие импорты экранов «Сегодня»/«Задачи»/«Календарь».
export {
  buildDayPairs,
  nextPair,
  nowInTz,
  isoWeekParity,
  type DayPair,
  type PairState,
  type NowInTz,
} from '../../../entities/schedule'
