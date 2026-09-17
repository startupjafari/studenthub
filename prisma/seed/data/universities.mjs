// Пул вузов: названия, города, статусы.
//
// «Алатау» в пуле нет намеренно: так называется демо-вуз основного сида.
//
// ДВА ИСТОЧНИКА НАЗВАНИЙ, в таком порядке:
//   1. Реальные вузы Казахстана — `KZ_UNIVERSITIES` (130 организаций, см. шапку
//      universities-kz.mjs: источник, дата снятия и границы точности). Вуз №1 — ЕНУ,
//      №9 — КазНУ и так далее, порядок фиксирован файлом.
//   2. Синтетические названия ниже — для индексов ЗА пределами реестра. Раньше они были
//      единственным источником именно для того, чтобы не приписывать выдуманных
//      студентов, оценки и жалобы существующим организациям; решение сменить это принято
//      17.09.2026 владельцем продукта (стенд для демонстрации на узнаваемых данных).
//
// Ограничение, которое из этого осталось: статус BLOCKED реальному вузу не выдаётся —
// «заблокирован» читается как наказание конкретной организации. Он достаётся только
// синтетическим. PENDING реальным можно: это заявка на подключение, а не оценка.
//
// Города в обоих случаях реальные — иначе `University.city` не резолвится в справочнике
// КАТО и селект «Город» в интерфейсе пустой.

import { readFileSync } from 'node:fs'
import { KZ_UNIVERSITIES } from './universities-kz.mjs'

// Ядро названия: топонимы и понятия, из которых складываются имена вузов.
const CORES = ['Алаколь','Тұран','Сарыарқа','Жетісу','Байтерек','Көкжиек','Улытау','Каратау','Есіл','Ертіс','Жайық','Арқа','Тараз','Отырар','Сайрам','Балхаш','Алтай','Мангистау','Аркалык','Шыңғыс','Хантау','Мұғалжар','Бетпак','Кокшетау','Зайсан','Аральск','Тобол','Нура','Шидерты','Каспий','Талас','Шу','Асар','Достык','Бирлик','Ынтымак','Жаңа Дәуір','Парасат','Даналык','Мирас','Кемел','Ұлағат','Санат','Жігер','Табыс','Өркен','Мұрагер','Асыл','Тұғыр','Керемет'] // prettier-ignore

// Тип организации + аббревиатура для shortName.
const TYPES = [
  { name: 'Университет', abbr: 'У' },
  { name: 'Технический университет', abbr: 'ТУ' },
  { name: 'Педагогический университет', abbr: 'ПУ' },
  { name: 'Медицинский университет', abbr: 'МУ' },
  { name: 'Аграрный университет', abbr: 'АУ' },
  { name: 'Гуманитарный университет', abbr: 'ГУ' },
  { name: 'Академия', abbr: 'А' },
  { name: 'Институт', abbr: 'И' },
]

// Три города республиканского значения — там вузов реально больше всего, поэтому они
// повторяются в списке несколько раз (иначе 100 вузов размазало бы по стране ровным слоем).
const CAPITAL_CODES = ['710000000', '750000000', '790000000']

// Города из справочника КАТО: kind = CITY. Порядок фиксирован сортировкой по коду —
// от прогона к прогону вуз №42 оказывается в том же городе.
export function loadCities(katoPath) {
  const all = JSON.parse(readFileSync(katoPath, 'utf8'))
  const byCode = new Map(all.map((u) => [u.code, u]))
  const cities = all.filter((u) => u.kind === 'CITY').sort((a, b) => a.code.localeCompare(b.code))
  const capitals = CAPITAL_CODES.map((code) => byCode.get(code)).filter(Boolean)
  // Столицы идут первыми и с трёхкратным весом.
  return [...capitals, ...capitals, ...capitals, ...cities].map((c) => ({
    code: c.code,
    name: c.nameRu,
  }))
}

// Реальные вузы с кодами КАТО вместо названий городов. Читает тот же kato.json, что и
// loadCities. Падает громко: тихо записанный неверный код города дал бы пустой селект
// «Город» у всех вузов этого прогона, и выяснилось бы это уже в интерфейсе.
export function resolveKzUniversities(katoPath) {
  const all = JSON.parse(readFileSync(katoPath, 'utf8'))
  const byName = new Map(all.filter((u) => u.kind === 'CITY').map((u) => [u.nameRu, u.code]))
  return KZ_UNIVERSITIES.map((u) => {
    const code = byName.get(u.city)
    if (!code) throw new Error(`universities-kz: город "${u.city}" не найден в справочнике КАТО`)
    return {
      name: u.name,
      shortName: u.shortName,
      // Каждый 37-й — заявка на подключение, иначе экран модерации платформы пуст.
      // BLOCKED здесь не бывает — см. шапку файла.
      status: 'ACTIVE',
      country: 'Казахстан',
      city: code,
      cityName: u.city,
      // Казахстан с марта 2024 живёт в одном часовом поясе (UTC+5).
      timezone: 'Asia/Almaty',
      kind: u.kind,
    }
  })
}

// Профиль вуза по его индексу (1..N). Детерминирован: индекс → одно и то же название.
// `real` — реестр из resolveKzUniversities; индексы в его пределах берут реальный вуз,
// за пределами достаётся синтетическое название.
export function universityProfile(index, cities, real = []) {
  if (index <= real.length) {
    const profile = real[index - 1]
    return { ...profile, status: index % 37 === 0 ? 'PENDING' : 'ACTIVE' }
  }

  const core = CORES[(index - 1) % CORES.length]
  const type = TYPES[Math.floor((index - 1) / CORES.length) % TYPES.length]
  const city = cities[(index - 1) % cities.length]
  // Латиница в аббревиатуре не нужна: shortName показывается рядом с названием.
  const shortName = `${core.slice(0, 3)}${type.abbr}`

  // Статусы: почти все вузы рабочие, но модерация платформы должна видеть и заявки
  // на подключение (PENDING), и заблокированный вуз — иначе эти экраны пустые.
  const status = index % 17 === 0 ? 'PENDING' : index % 29 === 0 ? 'BLOCKED' : 'ACTIVE'

  return {
    name: `${type.name} «${core}»`,
    shortName,
    status,
    country: 'Казахстан',
    city: city.code,
    cityName: city.name,
    timezone: 'Asia/Almaty',
  }
}

export { CORES, TYPES }
