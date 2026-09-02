// Детерминированный PRNG и производные хелперы выборки.
//
// Зачем не Math.random: сид должен давать одни и те же данные между прогонами — иначе
// повторный запуск переписывает «те же» строки другими значениями, диффы в БД нечитаемы,
// а скриншоты UI-аудита пляшут от прогона к прогону.
//
// Важно для масштаба: у каждого вуза СВОЙ генератор (makeRng(SEED_BASE + index)).
// Общий поток случайных чисел означал бы, что данные вуза №40 зависят от того, сколько
// строк сгенерировал вуз №39 — то есть догенерация порциями (SEED_FROM/SEED_TO) и
// параллельная генерация ломали бы воспроизводимость.

// Базовое зерно платформы. Меняется только осознанно: после смены весь сид другой.
export const SEED_BASE = 20260902

// mulberry32 — быстрый 32-битный PRNG с хорошим распределением для наших целей.
export function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Набор хелперов вокруг одного генератора: удобнее передавать шагам одним объектом.
export function makeRandom(seed) {
  const rng = makeRng(seed)
  const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1))
  const pick = (arr) => arr[Math.floor(rng() * arr.length)]

  return {
    rng,
    randInt,
    pick,
    chance: (p) => rng() < p,
    // Случайные n элементов без повторов (частичный Фишер–Йетс по копии).
    sample: (arr, n) => {
      const copy = [...arr]
      const take = Math.min(n, copy.length)
      for (let i = 0; i < take; i += 1) {
        const j = i + Math.floor(rng() * (copy.length - i))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return copy.slice(0, take)
    },
    // Перемешать на месте (для раздачи ролей/аватаров по списку людей).
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      return arr
    },
    // Взвешенный выбор: pickWeighted([['PRESENT', 80], ['LATE', 10], ['ABSENT', 10]]).
    pickWeighted: (pairs) => {
      const total = pairs.reduce((sum, [, w]) => sum + w, 0)
      let roll = rng() * total
      for (const [value, weight] of pairs) {
        roll -= weight
        if (roll < 0) return value
      }
      return pairs[pairs.length - 1][0]
    },
    // Дата со сдвигом в днях от «сейчас». Все даты сида относительны текущему дню:
    // иначе окна дашбордов («за последние 12 недель») со временем становятся пустыми.
    daysFromNow: (n) => new Date(Date.now() + n * 86_400_000),
    randomDate: (minDays, maxDays) => new Date(Date.now() + randInt(minDays, maxDays) * 86_400_000),
  }
}

// Генератор для конкретного вуза: детерминирован по его индексу, независим от остальных.
export function universityRandom(index) {
  return makeRandom(SEED_BASE + index * 7919)
}
