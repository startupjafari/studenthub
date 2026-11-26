import type { KatoUnit } from '@studenthub/shared-schemas'

// Название объекта на языке приложения (`useAppLocale()`). Справочник двуязычный (ru/kz из
// самого КАТО); для `en` осмысленной формы в классификаторе нет, поэтому там русская —
// транслитерация на лету врала бы («Өскемен» → «Oskemen» ≠ «Ust-Kamenogorsk»).
export function katoName(unit: KatoUnit, locale: string): string {
  return locale === 'kz' ? unit.nameKz : unit.nameRu
}

// Подпись под названием: область, к которой относится объект. У областей и городов
// республиканского значения её нет — они сами верхний уровень.
export function katoRegionName(unit: KatoUnit, locale: string): string | null {
  return locale === 'kz' ? unit.regionNameKz : unit.regionNameRu
}
