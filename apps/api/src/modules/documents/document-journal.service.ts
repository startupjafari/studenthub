import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  DocumentJournalItem,
  DocumentJournalQueryInput,
  DocumentJournalVia,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { Paginated } from '../../common/http/paginated'
import { documentEventAction } from './documents.service'

// Сколько людей вуза подбирается по поиску ФИО. Поиск — сужение журнала до конкретного
// человека, а не выгрузка списка: больше совпадений означает «уточните запрос».
const NAME_MATCH_LIMIT = 200

type Meta = Record<string, unknown> | null

/**
 * Через что совершено действие — по тому, что о себе пишет событие (см. logEvent в
 * DocumentsService и сервисе запросов). Старые события без пометок: просмотр чужим — это
 * доступ по гранту (иного пути к файлу чужого документа нет), остальное по актору.
 */
export function journalVia(
  e: { action: string; actorId: string; requestId: string | null; metadata: Meta },
  ownerId: string,
): DocumentJournalVia {
  const m = e.metadata ?? {}
  if (m.platformMode) return 'PLATFORM'
  if (m.viaApplication) return 'APPLICATION'
  if (e.requestId || m.viaSubmission) return 'REQUEST'
  if (e.action === 'EXPIRE' || e.action === 'EXPIRING' || m.retention !== undefined) {
    return 'SYSTEM'
  }
  if (e.actorId === ownerId) return 'OWNER'
  if (e.action === 'VIEW' || e.action === 'DOWNLOAD' || m.accessId) return 'GRANT'
  return 'STAFF'
}

function fullName(u: { firstName: string; lastName: string }): string {
  return `${u.lastName} ${u.firstName}`.trim()
}

/**
 * Журнал документов вуза для админа вуза (§15.2: «читает журнал», содержимое — нет).
 * Кто, над чьим документом, что сделал, когда и через что (грант/запрос/заявка/спец-режим).
 * Документ описан только типом и категорией: ни названия, ни номера, ни файлов, ни
 * metadata события (там бывают причины отклонения и id файлов) наружу не уходит —
 * админ вуза не видит содержимое чужих документов (CONTENT_BARRED_ROLES).
 * Scope — вуз документа из JWT админа, чужой вуз не виден ни фильтром, ни поиском.
 */
@Injectable()
export class DocumentJournalService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actor: JwtPayload,
    query: DocumentJournalQueryInput,
  ): Promise<Paginated<DocumentJournalItem>> {
    // Guard уже пустил только UNIVERSITY_ADMIN; проверка повторяется здесь (§6.1), а вуз —
    // только из токена.
    if (actor.role !== Role.UNIVERSITY_ADMIN || !actor.universityId) {
      throw new AppException('FORBIDDEN', 'Журнал документов доступен администратору вуза')
    }
    const universityId = actor.universityId
    const and: Prisma.DocumentEventWhereInput[] = [{ document: { universityId } }]
    // «Архивирование» в фильтре — и возврат из архива: отдельного пункта для него в фильтре
    // нет, а прежние события возврата и так записаны как ARCHIVE.
    if (query.action === 'ARCHIVE') and.push({ action: { in: ['ARCHIVE', 'UNARCHIVE'] } })
    else if (query.action) and.push({ action: query.action })
    if (query.from || query.to) {
      and.push({
        createdAt: {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        },
      })
    }
    if (query.userId) {
      and.push({ OR: [{ actorId: query.userId }, { document: { ownerId: query.userId } }] })
    }
    if (query.q) {
      const ids = await this.matchPeople(universityId, query.q)
      if (ids.length === 0) return new Paginated([], { total: 0 })
      and.push({ OR: [{ actorId: { in: ids } }, { document: { ownerId: { in: ids } } }] })
    }
    const where: Prisma.DocumentEventWhereInput = { AND: and }
    const { page, limit } = query
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.documentEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          createdAt: true,
          action: true,
          actorId: true,
          requestId: true,
          metadata: true,
          document: {
            select: {
              id: true,
              category: true,
              type: true,
              deletedAt: true,
              ownerId: true,
              owner: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.prisma.documentEvent.count({ where }),
    ])

    const actorIds = [...new Set(rows.map((r) => r.actorId))]
    const requestIds = [...new Set(rows.map((r) => r.requestId).filter((r): r is string => !!r))]
    const [actors, requests] = await Promise.all([
      actorIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, firstName: true, lastName: true, role: true },
            take: actorIds.length,
          })
        : [],
      requestIds.length
        ? this.prisma.documentRequest.findMany({
            where: { id: { in: requestIds }, universityId },
            select: { id: true, title: true },
            take: requestIds.length,
          })
        : [],
    ])
    const actorById = new Map(actors.map((a) => [a.id, a]))
    const requestById = new Map(requests.map((r) => [r.id, r]))

    const items: DocumentJournalItem[] = []
    for (const r of rows) {
      const doc = r.document
      // Событие без документа в выборку не попадает (условие по вузу документа), но тип
      // поля допускает null — пропускаем явно.
      if (!doc) continue
      const meta = (r.metadata ?? null) as Meta
      const who = actorById.get(r.actorId)
      const granteeType = typeof meta?.granteeType === 'string' ? meta.granteeType : null
      items.push({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        action: documentEventAction(r.action, meta),
        actor: {
          id: r.actorId,
          name: who ? fullName(who) : '',
          role: who?.role ?? null,
        },
        owner: { id: doc.ownerId, name: fullName(doc.owner) },
        document: { id: doc.id, category: doc.category, type: doc.type, deleted: !!doc.deletedAt },
        via: journalVia({ ...r, metadata: meta }, doc.ownerId),
        granteeType,
        request: r.requestId ? (requestById.get(r.requestId) ?? null) : null,
      })
    }
    return new Paginated(items, { total })
  }

  // Люди вуза по ФИО: каждое слово запроса — в имени или фамилии.
  private async matchPeople(universityId: string, q: string): Promise<string[]> {
    const words = q.split(/\s+/).filter(Boolean).slice(0, 4)
    const users = await this.prisma.user.findMany({
      where: {
        universityId,
        AND: words.map((w) => ({
          OR: [
            { firstName: { contains: w, mode: 'insensitive' as const } },
            { lastName: { contains: w, mode: 'insensitive' as const } },
          ],
        })),
      },
      select: { id: true },
      take: NAME_MATCH_LIMIT,
    })
    return users.map((u) => u.id)
  }
}
