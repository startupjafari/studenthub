// Генератор справочника КАТО (Классификатор административно-территориальных объектов РК).
//
// Вход  — выгрузка stat.gov.kz (~22 700 записей, ~4.8 МБ), в git не хранится.
// Выход — prisma/seed/data/kato.json: нормализованный справочник для сида (см. prisma/seed/steps/00-kato.mjs).
//
// Запуск: node scripts/gen-kato.mjs <путь-к-выгрузке> [--out prisma/seed/data/kato.json]
//
// Что чинится по дороге (дефекты исходной выгрузки, проверено 2026-08-26):
//   1. Ключ записи — то `id` (272 шт.), то `Id` (22 464 шт.).
//   2. В 20 названиях латинская `C` вместо кириллической `С` — поиск по ним не работал бы.
//   3. Поле `Level` не отражает иерархию: зимовки лежат на уровне областей. Не используется.
//   4. Поле `Parent` битое или пустое у 40 живых записей. Родитель берётся из структуры кода.
//   5. `AreaType` не отделяет административные единицы от населённых пунктов: районы есть
//      и в типе 4, и в типе 2. Вид определяется по названию.
//   6. Код 101010000 (Семей) встречается дважды — дедуп с приоритетом более конкретного вида.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [, , srcArg, ...rest] = process.argv
if (!srcArg) {
  console.error('Использование: node scripts/gen-kato.mjs <путь-к-выгрузке-КАТО> [--out <файл>]')
  process.exit(1)
}
const outIdx = rest.indexOf('--out')
const OUT = resolve(outIdx === -1 ? 'prisma/seed/data/kato.json' : rest[outIdx + 1])

// --- 1. Гомоглифы: латиница, попавшая в кириллический текст ---------------------------------
const HOMOGLYPHS = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
  Y: 'У',
  a: 'а',
  c: 'с',
  e: 'е',
  o: 'о',
  p: 'р',
  x: 'х',
  y: 'у',
}
const deLatin = (s) => String(s).replace(/[ABCEHKMOPTXYacepoxy]/g, (ch) => HOMOGLYPHS[ch] ?? ch)

// --- 2. Классификация -----------------------------------------------------------------------
// Суффикс административной единицы: Г.А. (городская администрация), П.А. (поселковая),
// С.О./А.О. (сельский/аульный округ), С.А., Р.А., С.Д. Такая запись — не населённый пункт.
const ADMIN_SUFFIX = /(?:\s|^)(?:[А-ЯЁӘҒҚҢӨҰҮҺІ]\.\s*[А-ЯЁӘҒҚҢӨҰҮҺІ]\.)$/
const KIND_BY_PREFIX = {
  'Г.': 'CITY',
  'П.': 'SETTLEMENT',
  'С.': 'VILLAGE',
  'А.': 'VILLAGE',
  'СТ.': 'STATION',
  'РЗД.': 'STATION',
  'УЧ.': 'OTHER',
  'КР.': 'OTHER',
  'ОТГ.': 'OTHER',
  'ОТД.': 'OTHER',
  'ЖИВ.': 'OTHER',
}
// Приоритет при дедупликации кода: конкретный вид важнее «прочего».
const KIND_RANK = {
  REGION: 6,
  DISTRICT: 5,
  CITY: 4,
  SETTLEMENT: 3,
  VILLAGE: 2,
  STATION: 1,
  ADMIN: 1,
  OTHER: 0,
}

function classify(nameRu) {
  const n = nameRu.trim().toUpperCase()
  // \b в JS — ASCII-граница слова и с кириллицей не работает; пробел/край строки явно.
  if (/(?:^|\s)ОБЛАСТЬ(?:\s|$)/.test(n)) return 'REGION'
  if (/(?:^|\s)РАЙОН(?:\s|$)/.test(n)) return 'DISTRICT'
  if (ADMIN_SUFFIX.test(n)) return 'ADMIN'
  const prefix = Object.keys(KIND_BY_PREFIX).find((p) => n.startsWith(p))
  return prefix ? KIND_BY_PREFIX[prefix] : 'OTHER'
}

// --- 3. Нормализация названий ----------------------------------------------------------------
const RU_STRIP_PREFIX = /^(?:Г|П|С|А|СТ|РЗД|УЧ|КР|ОТГ|ОТД|ЖИВ)\.\s*/i
const RU_STRIP_WORD = /^(?:ОБЛАСТЬ|РАЙОН)\s+|\s+(?:ОБЛАСТЬ|РАЙОН)$/gi
const KK_STRIP_SUFFIX =
  /\s*(?:ҚАЛАСЫ|АУЫЛЫ|АУДАНЫ|ОБЛЫСЫ|КЕНТІ|СТАНЦИЯСЫ|[А-ЯЁӘҒҚҢӨҰҮҺІ]\.\s*[А-ЯЁӘҒҚҢӨҰҮҺІ]\.|[ҚАКСПЖ]\.)\s*$/iu

// «УСТЬ-КАМЕНОГОРСК» → «Усть-Каменогорск». Слова короче 2 букв (предлоги, инициалы) не трогаем.
const titleCase = (s) =>
  s
    .toLocaleLowerCase('ru')
    .replace(/(^|[\s\-–—«"(.])(\p{L})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase('ru'))

// Аффикс срезается только у видов, которые UI и так подписывает («город», «район», «село»).
// У станций, разъездов, участков, зимовок и отгонов он остаётся частью названия: развернуть
// казахские сокращения (Ж., ШАРҚОЖ, АТЫН.) без риска ошибиться в терминологии нельзя, а
// «Рзд.27» без слова превратилось бы в «27».
const STRIP_AFFIX = new Set(['REGION', 'DISTRICT', 'ADMIN', 'CITY', 'SETTLEMENT', 'VILLAGE'])

function cleanRu(raw, kind) {
  let s = deLatin(raw).trim()
  if (STRIP_AFFIX.has(kind)) {
    s = s.replace(RU_STRIP_WORD, '').replace(RU_STRIP_PREFIX, '').replace(ADMIN_SUFFIX, '')
  }
  return titleCase(s.trim())
}
function cleanKk(raw, kind, fallback) {
  const s = deLatin(raw).trim()
  if (!s || /^\d+$/.test(s)) return fallback
  const stripped = STRIP_AFFIX.has(kind) ? s.replace(KK_STRIP_SUFFIX, '') : s
  return titleCase(stripped.trim()) || fallback
}

// --- 4. Иерархия из структуры кода: RR|DD|OO|NNN ---------------------------------------------
function parentOf(code) {
  const [rr, dd, oo, nnn] = [code.slice(0, 2), code.slice(2, 4), code.slice(4, 6), code.slice(6, 9)]
  if (nnn !== '000') return rr + dd + oo + '000'
  if (oo !== '00') return rr + dd + '00000'
  if (dd !== '00') return rr + '0000000'
  return null
}

// --- 5. Сборка --------------------------------------------------------------------------------
const raw = JSON.parse(readFileSync(resolve(srcArg), 'utf8'))
const alive = raw.filter((r) => !r.IsMarkedToDelete)

const byCode = new Map()
for (const r of alive) {
  const code = String(r.Code).padStart(9, '0')
  const nameRu = deLatin(String(r.NameRus))
  const kind = classify(nameRu)
  const ru = cleanRu(nameRu, kind)
  const entry = {
    code,
    kind,
    nameRu: ru,
    nameKk: cleanKk(r.NameKaz, kind, ru),
    parentCode: parentOf(code),
    regionCode: code.slice(0, 2) + '0000000',
  }
  const prev = byCode.get(code)
  if (!prev || KIND_RANK[kind] > KIND_RANK[prev.kind]) byCode.set(code, entry)
}

// Родитель, которого нет в справочнике (38 сирот), обнуляется — иначе внешний ключ не сойдётся.
const codes = new Set(byCode.keys())
let orphans = 0
for (const e of byCode.values()) {
  if (e.parentCode && !codes.has(e.parentCode)) {
    e.parentCode = null
    orphans += 1
  }
}

const items = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))
writeFileSync(OUT, JSON.stringify(items), 'utf8')

const stats = items.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {})
console.log(
  `Исходных записей: ${raw.length}, живых: ${alive.length}, после дедупа: ${items.length}`,
)
console.log(`Сирот без родителя: ${orphans}`)
console.log('По видам:', stats)
console.log(`Записано: ${OUT}`)
