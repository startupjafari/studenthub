import { Injectable } from '@nestjs/common'
import { Prisma, type KatoKind } from '@prisma/client'
import type { KatoResolveQueryInput, KatoSearchQueryInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'

const KATO_SELECT = {
  code: true,
  kind: true,
  nameRu: true,
  nameKk: true,
  regionCode: true,
} satisfies Prisma.KatoUnitSelect

// Населённые пункты: то, что имеет смысл выбрать как «город». Районы, округа и области —
// административные уровни, в этот список не попадают.
const PLACE_KINDS: KatoKind[] = ['CITY', 'SETTLEMENT', 'VILLAGE', 'STATION', 'OTHER']

type KatoRow = Prisma.KatoUnitGetPayload<{ select: typeof KATO_SELECT }>

@Injectable()
export class KatoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Поиск по справочнику для комбобокса. Ищет по обоим языкам сразу: пользователь может
   * набрать «Оскемен» или «Усть-Каменогорск» — это один и тот же город.
   */
  async search(query: KatoSearchQueryInput) {
    const { search, scope, limit } = query

    if (scope === 'regions') {
      return this.toDto(await this.listRegions(search, limit))
    }

    // До первого символа показываем крупные города, а не первые попавшиеся по алфавиту:
    // пустой комбобокс с «Абралы» и «Акшабай» бесполезен, а вуз почти всегда в областном
    // центре. Полный справочник открывается, как только пользователь начал вводить.
    if (scope === 'places' && !search) {
      return this.toDto(await this.listMajorCities(limit))
    }

    const rows = await this.prisma.katoUnit.findMany({
      where: {
        ...(scope === 'places' ? { kind: { in: PLACE_KINDS } } : {}),
        ...(search
          ? {
              OR: [
                { nameRu: { contains: search, mode: 'insensitive' } },
                { nameKk: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      // Порядок значений KatoKind в enum'е Postgres задан так, что города идут раньше
      // сёл и станций — на первом экране комбобокса оказывается то, что ищут чаще.
      orderBy: [{ kind: 'asc' }, { nameRu: 'asc' }],
      take: limit,
      select: KATO_SELECT,
    })
    return this.toDto(rows)
  }

  /** Названия по списку кодов — для таблиц, где город уже сохранён. */
  async resolve(query: KatoResolveQueryInput) {
    const rows = await this.prisma.katoUnit.findMany({
      where: { code: { in: query.codes } },
      take: query.codes.length,
      select: KATO_SELECT,
    })
    return this.toDto(rows)
  }

  /**
   * Крупные города — дефолтная выдача комбобокса: 17 областных центров + Астана, Алматы
   * и Шымкент, ровно 20 записей.
   *
   * Областной центр вычисляется из структуры кода: в КАТО он всегда `RR1010000` (первый
   * город первого района области) — проверено по всем 17 областям. Отдельного признака
   * «центр» в классификаторе нет, а держать список из 20 кодов руками означало бы, что
   * при следующей смене областного центра (как Капчагай → Қонаев в 2022-м) справочник
   * и список разъедутся.
   */
  private listMajorCities(limit: number): Promise<KatoRow[]> {
    return this.prisma.$queryRaw<KatoRow[]>`
      SELECT "code", "kind", "name_ru" AS "nameRu", "name_kk" AS "nameKk",
             "region_code" AS "regionCode"
      FROM "kato_units"
      WHERE "kind" = 'CITY'::"KatoKind"
        AND ("code" LIKE '__1010000' OR "region_code" = "code")
      ORDER BY ("region_code" = "code") DESC, "name_ru"
      LIMIT ${limit}
    `
  }

  /**
   * Верхний уровень: 17 областей + Астана, Алматы и Шымкент. Именно `regionCode = code`,
   * а не `kind = 'REGION'` (три города республиканского значения — города, а не области)
   * и не `parentCode IS NULL` (под него попадают ещё 38 объектов с битой иерархией
   * в исходной выгрузке). Записей ровно 20, лимит применяется уже к найденному.
   */
  private async listRegions(search: string | undefined, limit: number): Promise<KatoRow[]> {
    const rows = await this.prisma.$queryRaw<KatoRow[]>`
      SELECT "code", "kind", "name_ru" AS "nameRu", "name_kk" AS "nameKk",
             "region_code" AS "regionCode"
      FROM "kato_units"
      WHERE "region_code" = "code"
      ORDER BY "name_ru"
    `
    const needle = search?.toLocaleLowerCase('ru')
    const filtered = needle
      ? rows.filter(
          (r) =>
            r.nameRu.toLocaleLowerCase('ru').includes(needle) ||
            r.nameKk.toLocaleLowerCase('ru').includes(needle),
        )
      : rows
    return filtered.slice(0, limit)
  }

  /** Дополняет записи названием региона — из чего собирается подпись «Кокшетау, Акмолинская». */
  private async toDto(rows: KatoRow[]) {
    const regionCodes = [...new Set(rows.map((r) => r.regionCode))]
    const regions = regionCodes.length
      ? await this.prisma.katoUnit.findMany({
          where: { code: { in: regionCodes } },
          take: regionCodes.length,
          select: { code: true, nameRu: true, nameKk: true },
        })
      : []
    const byCode = new Map(regions.map((r) => [r.code, r]))

    return rows.map((r) => {
      // Сам регион своим же регионом не подписывается — «Алматы, Алматы» бессмысленно.
      const region = r.code === r.regionCode ? undefined : byCode.get(r.regionCode)
      return {
        code: r.code,
        kind: r.kind,
        nameRu: r.nameRu,
        nameKk: r.nameKk,
        regionCode: r.regionCode,
        regionNameRu: region?.nameRu ?? null,
        regionNameKk: region?.nameKk ?? null,
      }
    })
  }
}
