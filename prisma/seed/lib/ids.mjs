// Детерминированные идентификаторы.
//
// Правило: id строки полностью определяется её местом в структуре (вуз → факультет →
// группа → студент), а не порядком генерации. Это и есть механизм идемпотентности:
// повторный прогон формирует те же id, и createMany({ skipDuplicates }) их пропускает.
//
// Формат: `u042-f-eco-g03-st012` — читается глазами в psql и в UI, и по префиксу видно,
// что строка создана генератором (а не человеком через интерфейс).
//
// ДЕМО-ВУЗ СТОИТ ОТДЕЛЬНО. `seed-university-001` со всей его структурой создаёт
// основной сид: на его исторические id ссылаются docs/PROJECT.md §14, dev-инвайт и
// e2e-тесты. Генератор его не трогает и не «достраивает» — он создаёт свои 100 вузов
// рядом (u001…u100). Иначе каждая сущность обросла бы ветками «а если это демо-вуз»,
// а демо-группа ИТ-23-1 получила бы вторые 25 студентов сверх своих 26.

export const DEMO_UNIVERSITY_ID = 'seed-university-001'
export const DEMO_FACULTY_ID = 'seed-faculty-001'
export const DEMO_GROUP_ID = 'seed-group-001'
export const DEMO_TERM_ID = 'seed-term-001'

// Индекс вуза 1..N → префикс. Ширина 3 знака держит лексикографический порядок id
// таким же, как числовой (u007 < u010), — сортировка в psql не путается.
export function uniPrefix(index) {
  return `u${String(index).padStart(3, '0')}`
}

export const universityId = uniPrefix

// Сущность вуза: id(42, 'room', 7) → 'u042-room-7'. Единая точка, чтобы префиксы не
// расползались по шагам строковыми литералами.
export function id(index, kind, ...parts) {
  return [uniPrefix(index), kind, ...parts].join('-')
}

// Дочерняя сущность по id родителя: child('u042-g-eco-3', 'st', 12) → 'u042-g-eco-3-st12'.
export function child(parentId, kind, ...parts) {
  return [parentId, kind, ...parts].join('-')
}

// Email пользователя: домен по индексу вуза, локальная часть — от роли и места в структуре.
export function emailFor(index, local) {
  return `${local}@${uniPrefix(index)}.edu.kz`
}

// username хранится в нижнем регистре и уникален глобально (User.username @unique),
// поэтому в него входит префикс вуза.
export function usernameFor(index, local) {
  return `${local}.${uniPrefix(index)}`.toLowerCase().replace(/[^a-z0-9._]/g, '')
}
