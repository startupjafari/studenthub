import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import {
  FLOOR_PLAN_FORMAT,
  FloorPlanSchema,
  SITE_PLAN_FORMAT,
  checkOutline,
  cloneFloorPlan,
  emptySitePlan,
  floorFromOutline,
  normalizeOutline,
  validateFloor,
  type FloorPlanDoc,
  type SitePlanDoc,
} from '@studenthub/campus-core'
import type {
  CreateCampusBuildingInput,
  CreateCampusFloorInput,
  CreateCampusInput,
  SaveCampusFloorPlanInput,
  SaveCampusSitePlanInput,
  UpdateCampusBuildingInput,
  UpdateCampusFloorInput,
  UpdateCampusInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { isPlatformRole } from '../../common/auth/group-scope'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { assertCanEdit, assertCanView, isCampusEditor } from './campus-access'

/** Документ этажа до 2 МиБ (решение владельца) — тот же предел, что у тела маршрута. */
export const CAMPUS_PLAN_MAX_BYTES = 2 * 1024 * 1024
/** Снимок черновика — не чаще раза в 10 минут правки этажа (§10.7). */
const SNAPSHOT_EVERY_MS = 10 * 60_000
/** Сколько снимков держим на этаж; старше — удаляются при записи нового. */
const SNAPSHOTS_KEEP = 30
/** Мягкая блокировка этажа: кто правит сейчас (§20.3). Продлевается сердцебиением. */
const PRESENCE_TTL_S = 60

// Ошибки, с которыми черновик не сохраняется: документ сломан, а не «не готов». Остальное
// (комнаты без Room, проёмы за стеной) — нормальное состояние черновика, их ловит публикация.
const INTEGRITY_CODES = new Set([
  'BROKEN_REF',
  'DUPLICATE_NODE',
  'ZERO_LENGTH_WALL',
  'DUPLICATE_WALL',
])

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue

export interface CampusPresence {
  mine: boolean
  holder: { userId: string; since: string } | null
}

@Injectable()
export class CampusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ── Кампус ────────────────────────────────────────────────────────────────────────

  async create(viewer: JwtPayload, input: CreateCampusInput, ctx: RequestContext) {
    const platform = isPlatformRole(viewer.role as Role)
    const universityId = platform ? input.universityId : viewer.universityId
    if (!universityId) {
      throw new AppException('VALIDATION_ERROR', 'Не указан вуз', [
        { field: 'universityId', message: 'required' },
      ])
    }
    assertCanEdit(viewer, universityId)
    const campus = await this.prisma.campus.create({
      data: {
        universityId,
        name: input.name,
        description: input.description ?? null,
        createdById: viewer.sub,
        site: {
          create: {
            format: SITE_PLAN_FORMAT,
            document: json(emptySitePlan()),
            updatedById: viewer.sub,
          },
        },
      },
    })
    await this.audit.record({
      userId: viewer.sub,
      action: 'campus_created',
      entity: 'Campus',
      entityId: campus.id,
      ...ctx,
    })
    return campus
  }

  /**
   * Кампусы вуза. Редактору — все, с черновым статусом; зрителю — только опубликованные:
   * черновик карты — рабочий материал администрации.
   */
  async list(viewer: JwtPayload, universityId?: string) {
    if (viewer.role === Role.EMPLOYER) throw new AppException('FORBIDDEN', 'Карта вуза недоступна')
    const platform = isPlatformRole(viewer.role as Role)
    const scope = platform ? universityId : (viewer.universityId ?? '__none__')
    const editor = isCampusEditor(viewer)
    const rows = await this.prisma.campus.findMany({
      where: {
        deletedAt: null,
        ...(scope ? { universityId: scope } : {}),
        ...(editor ? {} : { publishedVersionId: { not: null } }),
      },
      select: {
        id: true,
        universityId: true,
        name: true,
        description: true,
        publishedVersionId: true,
        updatedAt: true,
        _count: { select: { buildings: { where: { deletedAt: null } } } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
    return rows.map(({ _count, ...c }) => ({
      ...c,
      buildingsCount: _count.buildings,
      canEdit: editor,
    }))
  }

  /** Кампус для редактора: корпуса, этажи с ревизиями планов, территория, публикация. */
  async tree(viewer: JwtPayload, id: string) {
    const campus = await this.load(id)
    assertCanEdit(viewer, campus.universityId)
    const [buildings, site, version] = await Promise.all([
      this.prisma.campusBuilding.findMany({
        where: { campusId: id, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: 500,
        include: {
          floors: {
            orderBy: { level: 'asc' },
            include: { plan: { select: { revision: true, updatedAt: true, sizeBytes: true } } },
          },
        },
      }),
      this.prisma.campusSitePlan.findUnique({
        where: { campusId: id },
        select: { revision: true, updatedAt: true },
      }),
      campus.publishedVersionId
        ? this.prisma.campusVersion.findUnique({
            where: { id: campus.publishedVersionId },
            select: { id: true, number: true, publishedAt: true },
          })
        : null,
    ])
    return { ...campus, buildings, site, publishedVersion: version }
  }

  async update(viewer: JwtPayload, id: string, input: UpdateCampusInput) {
    const campus = await this.load(id)
    assertCanEdit(viewer, campus.universityId)
    return this.prisma.campus.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.geoAnchor !== undefined
          ? { geoAnchor: input.geoAnchor === null ? Prisma.DbNull : json(input.geoAnchor) }
          : {}),
      },
    })
  }

  /** Мягкое удаление: ссылки на помещения отвечают «кампус убран», а не 500. */
  async remove(viewer: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const campus = await this.load(id)
    assertCanEdit(viewer, campus.universityId)
    await this.prisma.campus.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.audit.record({
      userId: viewer.sub,
      action: 'campus_deleted',
      entity: 'Campus',
      entityId: id,
      ...ctx,
    })
  }

  // ── Корпуса ───────────────────────────────────────────────────────────────────────

  /**
   * Корпус с этажами. Каждый новый этаж стартует с наружных стен по контуру (§12.9): подложки
   * нет, и каркас берётся из корпуса. Отметки этажей — от первого вверх по высоте этажа.
   */
  async createBuilding(
    viewer: JwtPayload,
    campusId: string,
    input: CreateCampusBuildingInput,
    ctx: RequestContext,
  ) {
    const campus = await this.load(campusId)
    assertCanEdit(viewer, campus.universityId)
    const outline = this.validOutline(input.outline)
    const { count, firstLevel, heightMm } = input.floors
    const building = await this.prisma.$transaction(async (tx) => {
      const created = await tx.campusBuilding.create({
        data: {
          campusId,
          name: input.name,
          code: input.code ?? null,
          outline: json(outline),
          transform: json(input.transform),
        },
      })
      for (let i = 0; i < count; i++) {
        const level = firstLevel + i
        const doc = floorFromOutline(outline)
        const body = JSON.stringify(doc)
        await tx.campusFloor.create({
          data: {
            buildingId: created.id,
            level,
            label: String(level),
            kind: level < 0 ? 'basement' : 'regular',
            elevationMm: (level - Math.max(firstLevel, 1)) * heightMm,
            heightMm,
            plan: {
              create: {
                format: FLOOR_PLAN_FORMAT,
                document: json(doc),
                sizeBytes: Buffer.byteLength(body),
                updatedById: viewer.sub,
              },
            },
          },
        })
      }
      return created
    })
    await this.audit.record({
      userId: viewer.sub,
      action: 'campus_building_created',
      entity: 'CampusBuilding',
      entityId: building.id,
      metadata: { campusId, floors: count },
      ...ctx,
    })
    return building
  }

  /**
   * Правка корпуса. Новый контур не перерисовывает этажи: стены этажей — работа автора, их
   * не трогаем молча (проверка покажет стены за контуром).
   */
  async updateBuilding(viewer: JwtPayload, id: string, input: UpdateCampusBuildingInput) {
    const building = await this.loadBuilding(id)
    assertCanEdit(viewer, building.campus.universityId)
    return this.prisma.campusBuilding.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.outline ? { outline: json(this.validOutline(input.outline)) } : {}),
        ...(input.transform ? { transform: json(input.transform) } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    })
  }

  async removeBuilding(viewer: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const building = await this.loadBuilding(id)
    assertCanEdit(viewer, building.campus.universityId)
    await this.prisma.campusBuilding.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.audit.record({
      userId: viewer.sub,
      action: 'campus_building_deleted',
      entity: 'CampusBuilding',
      entityId: id,
      ...ctx,
    })
  }

  // ── Этажи ─────────────────────────────────────────────────────────────────────────

  /**
   * Новый этаж: пустой каркас по контуру или копия этажа того же корпуса с новыми id и
   * сброшенной связью с Room (§12.7). Отметка по умолчанию — над ближайшим нижним этажом.
   */
  async createFloor(viewer: JwtPayload, buildingId: string, input: CreateCampusFloorInput) {
    const building = await this.loadBuilding(buildingId)
    assertCanEdit(viewer, building.campus.universityId)
    let doc: FloorPlanDoc
    if (input.copyFromFloorId) {
      const source = await this.prisma.campusFloor.findFirst({
        where: { id: input.copyFromFloorId, buildingId },
        include: { plan: true },
      })
      if (!source?.plan) throw new AppException('NOT_FOUND', 'Этаж-образец не найден')
      doc = cloneFloorPlan(this.parsePlan(source.plan.document), undefined, {
        renumber: input.renumber,
      })
    } else {
      doc = floorFromOutline(building.outline as unknown as { x: number; y: number }[])
    }
    const below = await this.prisma.campusFloor.findFirst({
      where: { buildingId, level: { lt: input.level } },
      orderBy: { level: 'desc' },
    })
    const heightMm = input.heightMm ?? below?.heightMm ?? 3_300
    const elevationMm =
      input.elevationMm ??
      (below ? below.elevationMm + below.heightMm : (input.level - 1) * heightMm)
    const body = JSON.stringify(doc)
    try {
      return await this.prisma.campusFloor.create({
        data: {
          buildingId,
          level: input.level,
          label: input.label ?? String(input.level),
          kind: input.kind ?? (input.level < 0 ? 'basement' : 'regular'),
          elevationMm,
          heightMm,
          plan: {
            create: {
              format: FLOOR_PLAN_FORMAT,
              document: json(doc),
              sizeBytes: Buffer.byteLength(body),
              updatedById: viewer.sub,
            },
          },
        },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('CONFLICT', 'Этаж с таким уровнем уже есть', [
          { field: 'level', message: 'taken' },
        ])
      }
      throw error
    }
  }

  async updateFloor(viewer: JwtPayload, id: string, input: UpdateCampusFloorInput) {
    const floor = await this.loadFloor(id)
    assertCanEdit(viewer, floor.building.campus.universityId)
    return this.prisma.campusFloor.update({ where: { id }, data: input })
  }

  async removeFloor(viewer: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const floor = await this.loadFloor(id)
    assertCanEdit(viewer, floor.building.campus.universityId)
    await this.prisma.campusFloor.delete({ where: { id } })
    await this.audit.record({
      userId: viewer.sub,
      action: 'campus_floor_deleted',
      entity: 'CampusFloor',
      entityId: id,
      ...ctx,
    })
  }

  // ── План этажа ────────────────────────────────────────────────────────────────────

  async getPlan(viewer: JwtPayload, floorId: string) {
    const floor = await this.loadFloor(floorId)
    assertCanEdit(viewer, floor.building.campus.universityId)
    const plan = await this.prisma.campusFloorPlan.findUnique({ where: { floorId } })
    return {
      floorId,
      // Контекст этажа для редактора: переключатель этажей и высота для проверки окон.
      campusId: floor.building.campus.id,
      buildingId: floor.building.id,
      label: floor.label,
      heightMm: floor.heightMm,
      format: plan?.format ?? FLOOR_PLAN_FORMAT,
      revision: plan?.revision ?? 0,
      document: plan
        ? this.parsePlan(plan.document)
        : floorFromOutline(floor.building.outline as never),
      updatedAt: plan?.updatedAt ?? null,
    }
  }

  /**
   * Сохранение черновика с оптимистичной конкуренцией (§20.3): запись проходит, только если
   * в БД та же ревизия, от которой шла правка; иначе — 409 с текущей ревизией. Сломанный
   * документ (висячие ссылки, дубли) не сохраняется; «неготовый» (комната без Room) —
   * сохраняется, его остановит публикация.
   */
  async savePlan(viewer: JwtPayload, floorId: string, input: SaveCampusFloorPlanInput) {
    const floor = await this.loadFloor(floorId)
    assertCanEdit(viewer, floor.building.campus.universityId)
    const body = JSON.stringify(input.document)
    const sizeBytes = Buffer.byteLength(body)
    if (sizeBytes > CAMPUS_PLAN_MAX_BYTES) {
      throw new AppException('VALIDATION_ERROR', 'План этажа слишком большой', [
        { field: 'document', message: 'too_large' },
      ])
    }
    const broken = validateFloor(input.document).filter((p) => INTEGRITY_CODES.has(p.code))
    if (broken.length > 0) {
      throw new AppException(
        'VALIDATION_ERROR',
        'План этажа повреждён',
        broken.slice(0, 50).map((p) => ({ field: `document.${p.path}`, message: p.code })),
      )
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.campusFloorPlan.findUnique({ where: { floorId } })
      if (!current) {
        if (input.baseRevision !== 0) this.conflict(0)
        const created = await tx.campusFloorPlan.create({
          data: {
            floorId,
            format: FLOOR_PLAN_FORMAT,
            revision: 1,
            document: json(input.document),
            sizeBytes,
            updatedById: viewer.sub,
          },
        })
        return { revision: created.revision, updatedAt: created.updatedAt }
      }
      const updated = await tx.campusFloorPlan.updateMany({
        where: { floorId, revision: input.baseRevision },
        data: {
          format: FLOOR_PLAN_FORMAT,
          revision: { increment: 1 },
          document: json(input.document),
          sizeBytes,
          updatedById: viewer.sub,
        },
      })
      if (updated.count === 0) this.conflict(current.revision)
      await this.maybeSnapshot(tx, current, viewer.sub)
      return { revision: current.revision + 1, updatedAt: new Date() }
    })
  }

  async getSite(viewer: JwtPayload, campusId: string) {
    const campus = await this.load(campusId)
    assertCanEdit(viewer, campus.universityId)
    const site = await this.prisma.campusSitePlan.findUnique({ where: { campusId } })
    return {
      campusId,
      revision: site?.revision ?? 0,
      document: (site?.document as unknown as SitePlanDoc | undefined) ?? emptySitePlan(),
    }
  }

  async saveSite(viewer: JwtPayload, campusId: string, input: SaveCampusSitePlanInput) {
    const campus = await this.load(campusId)
    assertCanEdit(viewer, campus.universityId)
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.campusSitePlan.findUnique({ where: { campusId } })
      if (!current) {
        if (input.baseRevision !== 0) this.conflict(0)
        const created = await tx.campusSitePlan.create({
          data: {
            campusId,
            format: SITE_PLAN_FORMAT,
            revision: 1,
            document: json(input.document),
            updatedById: viewer.sub,
          },
        })
        return { revision: created.revision }
      }
      const updated = await tx.campusSitePlan.updateMany({
        where: { campusId, revision: input.baseRevision },
        data: {
          revision: { increment: 1 },
          document: json(input.document),
          updatedById: viewer.sub,
        },
      })
      if (updated.count === 0) this.conflict(current.revision)
      return { revision: current.revision + 1 }
    })
  }

  /**
   * Мягкая блокировка этажа: первый открывший — «правит», остальные видят, кто. `force` —
   * «забрать правку» (тот, у кого забрали, узнает об этом на следующем сердцебиении).
   * Данные защищает ревизия, блокировка — только подсказка людям.
   */
  async presence(viewer: JwtPayload, floorId: string, force = false): Promise<CampusPresence> {
    const floor = await this.loadFloor(floorId)
    assertCanEdit(viewer, floor.building.campus.universityId)
    const key = `campus:editing:${floorId}`
    const raw = await this.redis.get(key)
    const holder = raw ? (JSON.parse(raw) as { userId: string; since: string }) : null
    if (holder && holder.userId !== viewer.sub && !force) return { mine: false, holder }
    const mine = {
      userId: viewer.sub,
      since: holder?.userId === viewer.sub ? holder.since : new Date().toISOString(),
    }
    await this.redis.set(key, JSON.stringify(mine), 'EX', PRESENCE_TTL_S)
    return { mine: true, holder: mine }
  }

  // ── Внутреннее ────────────────────────────────────────────────────────────────────

  parsePlan(raw: unknown): FloorPlanDoc {
    const parsed = FloorPlanSchema.safeParse(raw)
    if (!parsed.success) throw new AppException('INTERNAL_ERROR', 'План этажа не читается')
    return parsed.data
  }

  async load(id: string) {
    const campus = await this.prisma.campus.findFirst({ where: { id, deletedAt: null } })
    if (!campus) throw new AppException('NOT_FOUND', 'Кампус не найден')
    return campus
  }

  /** Кампус для зрителя: свой вуз (или платформа). */
  async loadForView(viewer: JwtPayload, id: string) {
    const campus = await this.load(id)
    assertCanView(viewer, campus.universityId)
    return campus
  }

  private async loadBuilding(id: string) {
    const building = await this.prisma.campusBuilding.findFirst({
      where: { id, deletedAt: null, campus: { deletedAt: null } },
      include: { campus: { select: { id: true, universityId: true } } },
    })
    if (!building) throw new AppException('NOT_FOUND', 'Корпус не найден')
    return building
  }

  private async loadFloor(id: string) {
    const floor = await this.prisma.campusFloor.findFirst({
      where: { id, building: { deletedAt: null, campus: { deletedAt: null } } },
      include: {
        building: {
          select: { id: true, outline: true, campus: { select: { id: true, universityId: true } } },
        },
      },
    })
    if (!floor) throw new AppException('NOT_FOUND', 'Этаж не найден')
    return floor
  }

  private validOutline(outline: { x: number; y: number }[]) {
    const problem = checkOutline(outline)
    if (problem)
      throw new AppException('VALIDATION_ERROR', 'Контур корпуса некорректен', [
        { field: 'outline', message: problem },
      ])
    return normalizeOutline(outline)
  }

  private conflict(current: number): never {
    throw new AppException('CONFLICT', 'План изменили, пока вы его правили', [
      { field: 'baseRevision', message: String(current) },
    ])
  }

  private async maybeSnapshot(
    tx: Prisma.TransactionClient,
    previous: { floorId: string; revision: number; format: number; document: Prisma.JsonValue },
    userId: string,
  ): Promise<void> {
    const last = await tx.campusFloorPlanSnapshot.findFirst({
      where: { floorId: previous.floorId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    if (last && Date.now() - last.createdAt.getTime() < SNAPSHOT_EVERY_MS) return
    await tx.campusFloorPlanSnapshot.create({
      data: {
        floorId: previous.floorId,
        revision: previous.revision,
        format: previous.format,
        document: json(previous.document),
        reason: 'autosave',
        createdById: userId,
      },
    })
    const stale = await tx.campusFloorPlanSnapshot.findMany({
      where: { floorId: previous.floorId },
      orderBy: { createdAt: 'desc' },
      skip: SNAPSHOTS_KEEP,
      take: 100,
      select: { id: true },
    })
    if (stale.length > 0)
      await tx.campusFloorPlanSnapshot.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } })
  }
}
