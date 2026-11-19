import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { RealtimeGateway } from '../../common/realtime'

// Живые документы (docs/PROJECT.md §9.2d, `document.changed`). Раньше «Открытые мне» у декана
// не знали о новом гранте, студент не видел нового запроса документов и вердикта проверки,
// а автор запроса — сданного комплекта, пока не перезагрузят страницу. Сигнал без содержимого:
// в data только вид изменения, клиент перечитывает свой список по своим правам.

/**
 * Вид изменения. Документ: открыт доступ (`shared`), доступ отозван (`unshared`), владелец
 * изменил или удалил документ (`updated` / `deleted`), вуз выдал документ (`issued`).
 * Запрос (entityId — id запроса): новый (`requested`), закрыт (`closed`), сдан комплект
 * (`submitted`), вынесен вердикт или завершена проверка (`reviewed`).
 */
export type DocumentChangeKind =
  | 'shared'
  | 'unshared'
  | 'updated'
  | 'deleted'
  | 'issued'
  | 'requested'
  | 'closed'
  | 'submitted'
  | 'reviewed'

/** Грант доступа — как в DocumentAccess: человек, факультет (деканы) или весь вуз. */
export interface GrantRef {
  granteeType: string
  granteeId: string | null
}

// Грантов на документ — единицы (как DOCUMENT_ACCESS_LIMIT в DocumentsService).
const GRANTS_LIMIT = 200
// Деканы факультетов и модераторы вуза — получатели грантов «Факультет» и «Университет».
const GRANTEE_STAFF_LIMIT = 200
// Группы факультета — адресаты запроса «на факультет»; потолок как у адресатов запроса.
const FACULTY_GROUPS_LIMIT = 500
const REQUEST_TARGETS_LIMIT = 200

// Кто видит документ по гранту «Университет» — тот же набор, что UNIVERSITY_GRANT_ROLES
// в DocumentsService (админу вуза содержимое не открывается, ему сигнал не нужен).
const UNIVERSITY_GRANTEE_ROLES = [Role.UNIVERSITY_MODERATOR, Role.DEAN]

@Injectable()
export class DocumentEvents {
  private readonly logger = new Logger(DocumentEvents.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Сигнал конкретным людям: владельцу выданного документа, автору запроса, студенту. */
  toUsers(userIds: readonly string[], entityId: string, kind: DocumentChangeKind): void {
    const ids = [...new Set(userIds)]
    if (ids.length === 0) return
    this.safe(entityId, kind, () => {
      this.realtime.emitEventToUsers(ids, REALTIME_EVENTS.documentChanged, entityId, { kind })
    })
  }

  /**
   * Сигнал получателям доступа к документу — их «Открытые мне» показывают его метаданные.
   * `grants` передают, когда грант уже отозван (активных он среди них не найдёт); иначе
   * читаются активные гранты документа. Владелец исключается: изменение — его же действие.
   */
  async toGrantees(
    documentId: string,
    kind: DocumentChangeKind,
    grants?: readonly GrantRef[],
  ): Promise<void> {
    await this.safeAsync(documentId, kind, async () => {
      const doc = await this.prisma.document.findUnique({
        where: { id: documentId },
        select: { ownerId: true, universityId: true },
      })
      if (!doc) return
      const now = new Date()
      const list =
        grants ??
        (await this.prisma.documentAccess.findMany({
          where: {
            documentId,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { granteeType: true, granteeId: true },
          take: GRANTS_LIMIT,
        }))
      const userIds = await this.granteeUsers(list, doc.universityId)
      const recipients = userIds.filter((id) => id !== doc.ownerId)
      if (recipients.length === 0) return
      this.realtime.emitEventToUsers(recipients, REALTIME_EVENTS.documentChanged, documentId, {
        kind,
      })
    })
  }

  /**
   * Сигнал адресатам запроса документов — комнатами, а не поимённо: запрос «на весь вуз»
   * иначе раскрывался бы в тысячи id. Весь вуз — `university:{id}`, группа — `group:{id}`,
   * студент — `user:{id}`; у факультета своей комнаты нет — его группы. Чужие в комнате
   * (преподаватели вуза) просто перечитают свой прежний список.
   */
  async toRequestTargets(
    requestId: string,
    universityId: string,
    kind: DocumentChangeKind,
  ): Promise<void> {
    await this.safeAsync(requestId, kind, async () => {
      const targets = await this.prisma.documentRequestTarget.findMany({
        where: { requestId },
        select: { targetType: true, targetId: true },
        take: REQUEST_TARGETS_LIMIT,
      })
      const rooms = new Set<string>()
      const facultyIds: string[] = []
      for (const t of targets) {
        if (t.targetType === 'UNIVERSITY') rooms.add(`university:${universityId}`)
        else if (t.targetType === 'FACULTY' && t.targetId) facultyIds.push(t.targetId)
        else if (t.targetType === 'GROUP' && t.targetId) rooms.add(`group:${t.targetId}`)
        else if (t.targetType === 'USER' && t.targetId) rooms.add(`user:${t.targetId}`)
      }
      if (facultyIds.length > 0 && !rooms.has(`university:${universityId}`)) {
        const groups = await this.prisma.group.findMany({
          where: { facultyId: { in: facultyIds }, faculty: { universityId } },
          select: { id: true },
          take: FACULTY_GROUPS_LIMIT,
        })
        for (const g of groups) rooms.add(`group:${g.id}`)
      }
      this.realtime.emitEventToRooms([...rooms], REALTIME_EVENTS.documentChanged, requestId, {
        kind,
      })
    })
  }

  // Люди за грантами: «Пользователь» — сам id; «Факультет» — деканы факультета; «Университет»
  // — модераторы и деканы вуза документа. Только живые и не заблокированные, в вузе документа.
  private async granteeUsers(
    grants: readonly GrantRef[],
    universityId: string | null,
  ): Promise<string[]> {
    const ids = new Set<string>()
    const or: Prisma.UserWhereInput[] = []
    const facultyIds: string[] = []
    for (const g of grants) {
      if (g.granteeType === 'USER' && g.granteeId) ids.add(g.granteeId)
      else if (g.granteeType === 'DEPARTMENT' && g.granteeId) facultyIds.push(g.granteeId)
      else if (g.granteeType === 'UNIVERSITY') or.push({ role: { in: UNIVERSITY_GRANTEE_ROLES } })
    }
    if (facultyIds.length > 0) or.push({ role: Role.DEAN, facultyId: { in: facultyIds } })
    if (or.length > 0 && universityId) {
      const staff = await this.prisma.user.findMany({
        where: { universityId, deletedAt: null, isBlocked: false, OR: or },
        select: { id: true },
        take: GRANTEE_STAFF_LIMIT,
      })
      for (const u of staff) ids.add(u.id)
    }
    return [...ids]
  }

  // Рассылка best-effort: действие уже записано, сбой сокета или чтения адресатов его не
  // откатывает — получатель увидит изменение при следующем открытии.
  private safe(entityId: string, kind: DocumentChangeKind, emit: () => void): void {
    try {
      emit()
    } catch (error) {
      this.warn(entityId, kind, error)
    }
  }

  private async safeAsync(
    entityId: string,
    kind: DocumentChangeKind,
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await run()
    } catch (error) {
      this.warn(entityId, kind, error)
    }
  }

  private warn(entityId: string, kind: DocumentChangeKind, error: unknown): void {
    this.logger.warn(
      `Документы ${entityId} (${kind}): не удалось разослать сигнал — ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}
