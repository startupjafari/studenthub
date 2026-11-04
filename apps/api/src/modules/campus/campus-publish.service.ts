import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import {
  canSeeSpace,
  floorForViewer,
  spaceIndex,
  validateFloor,
  type BuildingTransform,
  type FloorPlanDoc,
} from '@studenthub/campus-core'
import type { CampusSearchInput, PublishCampusInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { isPlatformRole } from '../../common/auth/group-scope'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { assertCanEdit, viewerLevel } from './campus-access'
import { CampusService } from './campus.service'

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue
/** Сколько проблем отдаём в ответе VALIDATION_ERROR: остальное редактор покажет сам. */
const MAX_DETAILS = 100

/** Манифест версии: корпуса и этажи без геометрии — для Campus View и навигации по этажам. */
export interface CampusManifest {
  buildings: {
    id: string
    name: string
    code: string | null
    outline: { x: number; y: number }[]
    transform: BuildingTransform
    floors: {
      id: string
      level: number
      label: string
      kind: string
      elevationMm: number
      heightMm: number
    }[]
  }[]
  site: unknown
}

@Injectable()
export class CampusPublishService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly campus: CampusService,
  ) {}

  /**
   * Публикация (§20.5): все этажи и территория проверяются той же функцией, что в редакторе
   * (ошибки блокируют), строится индекс помещений, и всё пишется неизменяемой версией под
   * локом кампуса. Ревизии в теле — гарантия, что публикуется то, что автор проверил.
   */
  async publish(
    viewer: JwtPayload,
    campusId: string,
    input: PublishCampusInput,
    ctx: RequestContext,
  ) {
    const campus = await this.campus.load(campusId)
    assertCanEdit(viewer, campus.universityId)
    const [buildings, site] = await Promise.all([
      this.prisma.campusBuilding.findMany({
        where: { campusId, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: 500,
        include: { floors: { orderBy: { level: 'asc' }, include: { plan: true } } },
      }),
      this.prisma.campusSitePlan.findUnique({ where: { campusId } }),
    ])
    if (buildings.length === 0) {
      throw new AppException('VALIDATION_ERROR', 'В кампусе нет ни одного корпуса', [
        { field: 'buildings', message: 'EMPTY' },
      ])
    }

    const details: { field: string; message: string }[] = []
    const floors: {
      floorId: string
      buildingId: string
      doc: FloorPlanDoc
      transform: BuildingTransform
    }[] = []
    for (const b of buildings) {
      for (const f of b.floors) {
        if (!f.plan) continue
        const expected = input.floorRevisions?.[f.id]
        if (expected !== undefined && expected !== f.plan.revision) {
          throw new AppException('CONFLICT', 'План этажа изменился после проверки', [
            { field: `floors.${f.id}`, message: String(f.plan.revision) },
          ])
        }
        const doc = this.campus.parsePlan(f.plan.document)
        for (const p of validateFloor(doc, { floorHeightMm: f.heightMm })) {
          if (p.severity === 'error')
            details.push({ field: `floors.${f.id}.${p.path}`, message: p.code })
        }
        floors.push({
          floorId: f.id,
          buildingId: b.id,
          doc,
          transform: b.transform as unknown as BuildingTransform,
        })
      }
    }

    // Связи с Room: существуют, принадлежат вузу кампуса, и каждая — у одного помещения.
    const roomOwners = new Map<string, string>()
    for (const { floorId, doc } of floors) {
      for (const [spaceId, s] of Object.entries(doc.spaces)) {
        if (!s.roomId) continue
        const owner = roomOwners.get(s.roomId)
        if (owner)
          details.push({
            field: `floors.${floorId}.spaces.${spaceId}.roomId`,
            message: 'DUPLICATE_ROOM',
          })
        else roomOwners.set(s.roomId, `${floorId}.${spaceId}`)
      }
    }
    if (roomOwners.size > 0) {
      const rooms = await this.prisma.room.findMany({
        where: { id: { in: [...roomOwners.keys()] }, universityId: campus.universityId },
        select: { id: true },
        take: roomOwners.size,
      })
      const known = new Set(rooms.map((r) => r.id))
      for (const [roomId, owner] of roomOwners) {
        if (!known.has(roomId))
          details.push({ field: `floors.${owner}.roomId`, message: 'ROOM_NOT_FOUND' })
      }
    }
    if (details.length > 0) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Карта не готова к публикации',
        details.slice(0, MAX_DETAILS),
      )
    }

    const manifest: CampusManifest = {
      buildings: buildings.map((b) => ({
        id: b.id,
        name: b.name,
        code: b.code,
        outline: b.outline as unknown as { x: number; y: number }[],
        transform: b.transform as unknown as BuildingTransform,
        floors: b.floors.map((f) => ({
          id: f.id,
          level: f.level,
          label: f.label,
          kind: f.kind,
          elevationMm: f.elevationMm,
          heightMm: f.heightMm,
        })),
      })),
      site: site?.document ?? null,
    }
    const index = floors.flatMap(({ floorId, buildingId, doc, transform }) =>
      spaceIndex(doc, transform).map((e) => ({ ...e, floorId, buildingId })),
    )

    const version = await this.prisma.$transaction(
      async (tx) => {
        await advisoryXactLock(tx, `campus-publish:${campusId}`)
        const last = await tx.campusVersion.findFirst({
          where: { campusId },
          orderBy: { number: 'desc' },
          select: { number: true },
        })
        const created = await tx.campusVersion.create({
          data: {
            campusId,
            number: (last?.number ?? 0) + 1,
            note: input.note ?? null,
            manifest: json(manifest),
            publishedById: viewer.sub,
          },
        })
        await tx.campusVersionFloor.createMany({
          data: floors.map(({ floorId, doc }) => ({
            versionId: created.id,
            floorId,
            format: doc.format,
            document: json(doc),
          })),
        })
        if (index.length > 0) {
          await tx.campusSpaceIndex.createMany({
            data: index.map((e) => ({
              versionId: created.id,
              spaceId: e.spaceId,
              buildingId: e.buildingId,
              floorId: e.floorId,
              roomId: e.roomId,
              number: e.number,
              name: e.name,
              kind: e.kind,
              visibility: e.visibility,
              centerX: e.center.x,
              centerY: e.center.y,
              areaMm2: BigInt(e.areaMm2),
            })),
          })
        }
        await tx.campus.update({
          where: { id: campusId },
          data: { publishedVersionId: created.id },
        })
        return created
      },
      { timeout: 30_000 },
    )
    await this.audit.record({
      userId: viewer.sub,
      action: 'campus_published',
      entity: 'Campus',
      entityId: campusId,
      metadata: {
        versionId: version.id,
        number: version.number,
        floors: floors.length,
        spaces: index.length,
      },
      ...ctx,
    })
    return {
      id: version.id,
      number: version.number,
      publishedAt: version.publishedAt,
      spaces: index.length,
    }
  }

  async versions(viewer: JwtPayload, campusId: string) {
    const campus = await this.campus.load(campusId)
    assertCanEdit(viewer, campus.universityId)
    const rows = await this.prisma.campusVersion.findMany({
      where: { campusId },
      orderBy: { number: 'desc' },
      take: 100,
      select: {
        id: true,
        number: true,
        note: true,
        publishedById: true,
        publishedAt: true,
        _count: { select: { spaces: true } },
      },
    })
    return rows.map(({ _count, ...v }) => ({
      ...v,
      spaces: _count.spaces,
      current: v.id === campus.publishedVersionId,
    }))
  }

  /** Откат публикации: зрителям снова показывается выбранная версия. Черновики не трогаются. */
  async activate(viewer: JwtPayload, campusId: string, versionId: string, ctx: RequestContext) {
    const campus = await this.campus.load(campusId)
    assertCanEdit(viewer, campus.universityId)
    await this.versionOf(campusId, versionId)
    await this.prisma.campus.update({
      where: { id: campusId },
      data: { publishedVersionId: versionId },
    })
    await this.audit.record({
      userId: viewer.sub,
      action: 'campus_version_activated',
      entity: 'Campus',
      entityId: campusId,
      metadata: { versionId },
      ...ctx,
    })
    return { publishedVersionId: versionId }
  }

  /**
   * Восстановить черновик из версии: документы этажей версии ложатся поверх черновиков
   * (ревизия +1), прежний черновик уходит в снимок «before_restore». Этажи, удалённые после
   * публикации, пропускаются.
   */
  async restoreToDraft(
    viewer: JwtPayload,
    campusId: string,
    versionId: string,
    ctx: RequestContext,
  ) {
    const campus = await this.campus.load(campusId)
    assertCanEdit(viewer, campus.universityId)
    await this.versionOf(campusId, versionId)
    const floors = await this.prisma.campusVersionFloor.findMany({
      where: { versionId },
      take: 2_000,
    })
    let restored = 0
    await this.prisma.$transaction(
      async (tx) => {
        for (const vf of floors) {
          const current = await tx.campusFloorPlan.findUnique({ where: { floorId: vf.floorId } })
          if (!current) continue
          await tx.campusFloorPlanSnapshot.create({
            data: {
              floorId: vf.floorId,
              revision: current.revision,
              format: current.format,
              document: json(current.document),
              reason: 'before_restore',
              createdById: viewer.sub,
            },
          })
          await tx.campusFloorPlan.update({
            where: { floorId: vf.floorId },
            data: {
              document: json(vf.document),
              format: vf.format,
              revision: { increment: 1 },
              sizeBytes: Buffer.byteLength(JSON.stringify(vf.document)),
              updatedById: viewer.sub,
            },
          })
          restored++
        }
      },
      { timeout: 30_000 },
    )
    await this.audit.record({
      userId: viewer.sub,
      action: 'campus_version_restored',
      entity: 'Campus',
      entityId: campusId,
      metadata: { versionId, floors: restored },
      ...ctx,
    })
    return { restored }
  }

  // ── Зрителю ───────────────────────────────────────────────────────────────────────

  /** Опубликованная карта: манифест текущей версии. Черновики зрителю не видны. */
  async published(viewer: JwtPayload, campusId: string) {
    const campus = await this.campus.loadForView(viewer, campusId)
    if (!campus.publishedVersionId) throw new AppException('NOT_FOUND', 'Карта ещё не опубликована')
    const version = await this.prisma.campusVersion.findUnique({
      where: { id: campus.publishedVersionId },
      select: { id: true, number: true, publishedAt: true, manifest: true },
    })
    if (!version) throw new AppException('NOT_FOUND', 'Карта ещё не опубликована')
    const manifest = version.manifest as unknown as CampusManifest
    const level = viewerLevel(viewer)
    return {
      campus: { id: campus.id, name: campus.name, description: campus.description },
      version: { id: version.id, number: version.number, publishedAt: version.publishedAt },
      level,
      manifest: {
        ...manifest,
        buildings: manifest.buildings.map((b) => ({
          ...b,
          // Технические этажи — только сотрудникам.
          floors: level === 'public' ? b.floors.filter((f) => f.kind !== 'technical') : b.floors,
        })),
      },
    }
  }

  /** Этаж опубликованной версии, очищенный под уровень зрителя (§19.2). */
  async publishedFloor(viewer: JwtPayload, campusId: string, floorId: string) {
    const campus = await this.campus.loadForView(viewer, campusId)
    if (!campus.publishedVersionId) throw new AppException('NOT_FOUND', 'Карта ещё не опубликована')
    const row = await this.prisma.campusVersionFloor.findUnique({
      where: { versionId_floorId: { versionId: campus.publishedVersionId, floorId } },
    })
    if (!row) throw new AppException('NOT_FOUND', 'Этаж не найден')
    const level = viewerLevel(viewer)
    const doc = this.campus.parsePlan(row.document)
    return { floorId, versionId: campus.publishedVersionId, document: floorForViewer(doc, level) }
  }

  /**
   * Поиск помещений по номеру и названию в текущих версиях кампусов своего вуза. Скрытых в
   * индексе нет, служебные — только сотрудникам.
   */
  async search(viewer: JwtPayload, input: CampusSearchInput) {
    const versions = await this.currentVersions(viewer, input.campusId)
    if (versions.length === 0) return []
    const level = viewerLevel(viewer)
    const q = input.q
    const rows = await this.prisma.campusSpaceIndex.findMany({
      where: {
        versionId: { in: versions.map((v) => v.versionId) },
        ...(level === 'public' ? { visibility: 'public' } : {}),
        OR: [
          { number: { startsWith: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ number: 'asc' }],
      take: 20,
    })
    return rows.map((r) => this.hit(r, versions))
  }

  /** «Где помещение»: мост из расписания, экзаменов и QR-страницы — по id Room. */
  async roomLocation(viewer: JwtPayload, roomId: string) {
    const versions = await this.currentVersions(viewer)
    if (versions.length === 0) throw new AppException('NOT_FOUND', 'Помещения нет на карте')
    const level = viewerLevel(viewer)
    const row = await this.prisma.campusSpaceIndex.findFirst({
      where: { roomId, versionId: { in: versions.map((v) => v.versionId) } },
    })
    if (!row || !canSeeSpace(row.visibility as 'public' | 'staff', level)) {
      throw new AppException('NOT_FOUND', 'Помещения нет на карте')
    }
    return this.hit(row, versions)
  }

  private async currentVersions(viewer: JwtPayload, campusId?: string) {
    if (viewer.role === Role.EMPLOYER) throw new AppException('FORBIDDEN', 'Карта вуза недоступна')
    const platform = isPlatformRole(viewer.role as Role)
    const campuses = await this.prisma.campus.findMany({
      where: {
        deletedAt: null,
        publishedVersionId: { not: null },
        ...(platform ? {} : { universityId: viewer.universityId ?? '__none__' }),
        ...(campusId ? { id: campusId } : {}),
      },
      select: { id: true, name: true, publishedVersionId: true },
      take: 50,
    })
    if (campuses.length === 0) return []
    const manifests = await this.prisma.campusVersion.findMany({
      where: { id: { in: campuses.map((c) => c.publishedVersionId!) } },
      select: { id: true, manifest: true },
      take: campuses.length,
    })
    const byVersion = new Map(manifests.map((m) => [m.id, m.manifest as unknown as CampusManifest]))
    return campuses.map((c) => ({
      campusId: c.id,
      campusName: c.name,
      versionId: c.publishedVersionId!,
      manifest: byVersion.get(c.publishedVersionId!)!,
    }))
  }

  private hit(
    r: {
      versionId: string
      spaceId: string
      buildingId: string
      floorId: string
      roomId: string | null
      number: string | null
      name: string | null
      kind: string
      centerX: number
      centerY: number
    },
    versions: Awaited<ReturnType<CampusPublishService['currentVersions']>>,
  ) {
    const v = versions.find((x) => x.versionId === r.versionId)!
    const building = v.manifest?.buildings.find((b) => b.id === r.buildingId)
    const floor = building?.floors.find((f) => f.id === r.floorId)
    return {
      campusId: v.campusId,
      campusName: v.campusName,
      spaceId: r.spaceId,
      roomId: r.roomId,
      number: r.number,
      name: r.name,
      kind: r.kind,
      building: building ? { id: building.id, name: building.name, code: building.code } : null,
      floor: floor ? { id: floor.id, level: floor.level, label: floor.label } : null,
      center: { x: r.centerX, y: r.centerY },
    }
  }

  private async versionOf(campusId: string, versionId: string) {
    const v = await this.prisma.campusVersion.findFirst({
      where: { id: versionId, campusId },
      select: { id: true },
    })
    if (!v) throw new AppException('NOT_FOUND', 'Версия не найдена')
    return v
  }
}
