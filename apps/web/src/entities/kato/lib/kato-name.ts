import type { KatoUnit } from '@studenthub/shared-schemas'

// Название объекта на активной локали. Справочник двуязычный (ru/kk из самого КАТО);
// для `en` осмысленной формы в классификаторе нет, поэтому там русская — транслитерация
// на лету врала бы («Өскемен» → «Oskemen» ≠ «Ust-Kamenogorsk»).
export function katoName(unit: KatoUnit, locale: string): string {
  return locale === 'kk' ? unit.nameKk : unit.nameRu
}

// Подпись под названием: область, к которой относится объект. У областей и городов
// республиканского значения её нет — они сами верхний уровень.
export function katoRegionName(unit: KatoUnit, locale: string): string | null {
  return locale === 'kk' ? unit.regionNameKk : unit.regionNameRu
}
