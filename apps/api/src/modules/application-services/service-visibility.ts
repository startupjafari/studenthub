import type { Prisma } from '@prisma/client'
import type { PrismaService } from '../../common/prisma/prisma.service'

// Потолок числа услуг одного вуза для выборки кодов (BACKEND_RULES §5.3: findMany без take нельзя).
const UNIVERSITY_SERVICES_LIMIT = 500

/**
 * Какие услуги видит студент вуза: активные глобальные шаблоны и активные услуги его вуза.
 *
 * Вуз «настраивает» шаблон, получая копию с тем же кодом (catalog-admin.service.ts), и с этого
 * момента шаблон его студентам не показывается — ни в каталоге, ни при создании черновика.
 * Копия скрывает шаблон, даже если сама выключена: так вуз и убирает ненужную ему услугу.
 */
export async function visibleServicesWhere(
  prisma: PrismaService,
  universityId: string | null,
): Promise<Prisma.ApplicationServiceWhereInput> {
  if (!universityId) return { active: true, universityId: null }
  const own = await prisma.applicationService.findMany({
    where: { universityId },
    select: { code: true },
    take: UNIVERSITY_SERVICES_LIMIT,
  })
  const shadowed = own.map((s) => s.code)
  return {
    active: true,
    OR: [
      { universityId: null, ...(shadowed.length ? { code: { notIn: shadowed } } : {}) },
      { universityId },
    ],
  }
}
