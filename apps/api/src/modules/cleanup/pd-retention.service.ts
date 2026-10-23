import { Injectable, Logger } from '@nestjs/common'
import { LoanStatus, type Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { UserService } from '../users/users.service'

// Сроки хранения персональных данных (docs/PERSONAL_DATA.md §4).
//
// Решение владельца: данные живут год после того, как достигнута цель обработки. Для
// библиотеки цель достигнута закрытием выдачи, для журналов просмотров — самой записью,
// для учебных данных, переписки, документов и профиля студента — его уходом из вуза
// (`User.leftUniversityAt`). Действующие студенты не теряют ничего: у них даты ухода нет.
//
// Расписание и локи — в CleanupService (§9.3: @Cron только там), здесь только отбор и
// удаление. Каждая задача принимает `dryRun`: при выключенном PD_RETENTION_ENABLED она
// лишь считает, сколько удалила бы, — удаление необратимо, и цифры сначала сверяют.
//
// Файлы: задача удаляет строки `File`, а объекты MinIO без строки снимает `cleanOrphanFiles`
// в 04:00 той же ночью. Поэтому все задачи стоят в расписании раньше 04:00 — объект не
// переживает свою запись дольше нескольких часов.
export const PD_RETENTION_DAYS = 365

const BATCH_SIZE = 500
// Потолок батчей на одну цель за прогон: первый прогон после включения разбирает хвост за
// все годы — пусть за несколько ночей, но не одним многоминутным циклом под локом.
const MAX_BATCHES = 200
// Профиль удаляется штатным softDeleteSelf: снос медиа в MinIO и разлогин — секунды на
// человека, поэтому потолок в людях, а не в строках.
const PROFILE_MAX_PER_RUN = 200
// Физическое удаление «надгробия» уносит каскадом всё, что на нём держится (сообщения, посты,
// заявки), — это одна тяжёлая транзакция на человека. Потолок — тоже в людях.
const TOMBSTONE_MAX_PER_RUN = 200
// Отдельная транзакция на человека может удалять десятки тысяч строк каскадом: штатных
// пяти секунд интерактивной транзакции Prisma на это не хватает.
const TOMBSTONE_TX_TIMEOUT_MS = 120_000

/**
 * Связи, из-за которых «надгробие» удалять НЕЛЬЗЯ: они объявлены `onDelete: Cascade`, а на
 * них держатся данные ДРУГИХ людей или вуза. Удаление автора колонки журнала унесло бы
 * оценки всей группы, автора экзамена — результаты студентов, автора запроса документов —
 * комплекты студентов. Такой аккаунт остаётся надгробием, пока схема не изменится (связь
 * станет SetNull) или вуз сам не удалит эти записи. Список — `_count` модели User.
 */
const TOMBSTONE_BLOCKERS = [
  'gradeColumnsMade',
  'examsCreated',
  'assignmentsCreated',
  'materials',
  'scheduleChangesCreated',
  'documentRequestsAuthored',
  'eventsOrganized',
  'consultationSlots',
] as const satisfies readonly (keyof Prisma.UserCountOutputType)[]

const DAY_MS = 24 * 60 * 60 * 1000

/** Счётчики по таблицам: сколько удалено (или удалилось бы в dry-run). */
export type RetentionCounts = Record<string, number>

interface RetentionTarget {
  /** Имя в логе и в счётчиках — модель Prisma. */
  label: string
  count: () => Promise<number>
  findBatch: () => Promise<{ id: string }[]>
  /** Удаляет строки пачки; условие отбора обязано повторяться внутри (гонка с правкой). */
  deleteByIds: (ids: string[]) => Promise<number>
}

/**
 * Строки, которые удаляются попутно с другой целью (вложения вместе с сообщением). В dry-run
 * их считает `count`, в боевом прогоне — сама цель-хозяин, прибавляя к `deleted`.
 */
interface CompanionCount {
  label: string
  count: () => Promise<number>
  deleted: number
}

/** Граница срока: всё, чьё событие раньше неё, отжило свой год. */
export function retentionCutoff(now: number = Date.now()): Date {
  return new Date(now - PD_RETENTION_DAYS * DAY_MS)
}

/**
 * Студент, ушедший из вуза раньше `cutoff`. Роль — в условии намеренно: выпускник, которого
 * вуз потом взял на работу, остаётся с датой ухода, но преподавательский аккаунт уборка
 * трогать не должна. `lt` не совпадает с NULL — у действующих студентов даты нет.
 */
export function departedStudentWhere(cutoff: Date): Prisma.UserWhereInput {
  return { role: { in: [Role.STUDENT, Role.STAROSTA] }, leftUniversityAt: { lt: cutoff } }
}

@Injectable()
export class PdRetentionService {
  private readonly logger = new Logger(PdRetentionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly users: UserService,
  ) {}

  /**
   * Закрытые выдачи книг (возврат, утеря, отмена) — год после закрытия. В выдаче снимок
   * читателя: ФИО, группа, номер билета. Год — запас на спор о долге и жалобу «это не я».
   * Открытые выдачи не трогаются никогда: долг ушедшего студента всё ещё долг.
   * Утеря закрывается с `returnedAt` (LibraryLoansService.markLost), отмена — `cancelledAt`.
   */
  async purgeClosedLoans(dryRun: boolean): Promise<RetentionCounts> {
    const cutoff = retentionCutoff()
    const where: Prisma.LoanWhereInput = {
      OR: [
        { status: { in: [LoanStatus.RETURNED, LoanStatus.LOST] }, returnedAt: { lt: cutoff } },
        { status: LoanStatus.CANCELLED, cancelledAt: { lt: cutoff } },
      ],
    }
    return this.run('purgeClosedLoans', dryRun, [
      {
        label: 'Loan',
        count: () => this.prisma.loan.count({ where }),
        findBatch: () =>
          this.prisma.loan.findMany({ where, select: { id: true }, take: BATCH_SIZE }),
        deleteByIds: async (ids) =>
          (await this.prisma.loan.deleteMany({ where: { id: { in: ids }, ...where } })).count,
      },
    ])
  }

  /**
   * Журналы просмотров чужих ПДн — год после записи: кто из библиотекарей открывал
   * удостоверение читателя и кто смотрел камеры. Год — срок разбора жалобы на доступ.
   */
  async purgeViewLogs(dryRun: boolean): Promise<RetentionCounts> {
    const cutoff = retentionCutoff()
    const idAccess: Prisma.LibraryIdAccessLogWhereInput = { createdAt: { lt: cutoff } }
    const camera: Prisma.CameraViewSessionWhereInput = { startedAt: { lt: cutoff } }
    return this.run('purgeViewLogs', dryRun, [
      {
        label: 'LibraryIdAccessLog',
        count: () => this.prisma.libraryIdAccessLog.count({ where: idAccess }),
        findBatch: () =>
          this.prisma.libraryIdAccessLog.findMany({
            where: idAccess,
            select: { id: true },
            take: BATCH_SIZE,
          }),
        deleteByIds: async (ids) =>
          (await this.prisma.libraryIdAccessLog.deleteMany({ where: { id: { in: ids } } })).count,
      },
      {
        label: 'CameraViewSession',
        count: () => this.prisma.cameraViewSession.count({ where: camera }),
        findBatch: () =>
          this.prisma.cameraViewSession.findMany({
            where: camera,
            select: { id: true },
            take: BATCH_SIZE,
          }),
        deleteByIds: async (ids) =>
          (await this.prisma.cameraViewSession.deleteMany({ where: { id: { in: ids } } })).count,
      },
    ])
  }

  /**
   * Учебные данные ушедшего студента — год после ухода: оценки, результаты экзаменов,
   * посещаемость, сдачи заданий. Колонки журнала и сами экзамены — общие для группы и
   * остаются. Файлы сдач уходят каскадом (`File.submission` — Cascade), их объекты снимет
   * cleanOrphanFiles. Архив, который вуз обязан хранить дольше, — в его учётной системе,
   * а не здесь (PERSONAL_DATA §4).
   */
  async purgeDepartedAcademicRecords(dryRun: boolean): Promise<RetentionCounts> {
    const student = departedStudentWhere(retentionCutoff())
    return this.run('purgeDepartedAcademicRecords', dryRun, [
      this.byStudent('Grade', this.prisma.grade, { student }),
      this.byStudent('ExamResult', this.prisma.examResult, { student }),
      this.byStudent('Attendance', this.prisma.attendance, { student }),
      this.byStudent('Submission', this.prisma.submission, { student }),
    ])
  }

  /**
   * Заявки и ответы на запросы документов ушедшего студента — год после ухода. История,
   * вложения-привязки и результаты заявки уходят каскадом. Сами документы (в том числе
   * выданные вузом справки) — у `purgeDepartedDocuments`. Реестр выданных справок
   * (`DocumentExport`) не трогается: по нему проверяют подлинность бумаги на руках.
   */
  async purgeDepartedApplications(dryRun: boolean): Promise<RetentionCounts> {
    const student = departedStudentWhere(retentionCutoff())
    return this.run('purgeDepartedApplications', dryRun, [
      this.byStudent('Application', this.prisma.application, { student }),
      this.byStudent('DocumentSubmission', this.prisma.documentSubmission, { student }),
    ])
  }

  /**
   * Переписка ушедшего студента — год после ухода: его сообщения во ВСЕХ чатах (личных,
   * групповых, официальных, поддержке), вложения к ним и отложенные сообщения.
   *
   * Чужие сообщения не трогаются: у собеседника свой срок, и действующий студент не должен
   * терять свою половину переписки. Личный чат двух ушедших опустеет сам, когда истечёт
   * срок у второго. В ответах на удалённые сообщения стирается цитата (`replyQuote`) — это
   * копия чужого текста; ссылка `replyToId` обнулится сама (SetNull). Пересланные копии —
   * сообщения переславшего, и остаются у него. Черновики ушедшего в его чатах — тоже его
   * текст, они стираются.
   */
  async purgeDepartedMessages(dryRun: boolean): Promise<RetentionCounts> {
    const sender = departedStudentWhere(retentionCutoff())
    const messages: Prisma.MessageWhereInput = { sender }
    const scheduled: Prisma.ScheduledMessageWhereInput = { sender }
    const drafts: Prisma.ChatMemberWhereInput = { user: sender, draft: { not: null } }
    const files: CompanionCount = {
      label: 'File',
      count: () => this.prisma.file.count({ where: { message: messages } }),
      deleted: 0,
    }
    return this.run(
      'purgeDepartedMessages',
      dryRun,
      [
        {
          label: 'Message',
          count: () => this.prisma.message.count({ where: messages }),
          findBatch: () =>
            this.prisma.message.findMany({
              where: messages,
              select: { id: true },
              take: BATCH_SIZE,
            }),
          deleteByIds: (ids) =>
            this.prisma.$transaction(async (tx) => {
              // Перечитываем под транзакцией: студента могли восстановить после выборки, и
              // вложения не должны уйти раньше, чем станет ясно, что уходит само сообщение.
              const live = await tx.message.findMany({
                where: { id: { in: ids }, ...messages },
                select: { id: true },
                take: ids.length,
              })
              const liveIds = live.map((m) => m.id)
              if (liveIds.length === 0) return 0
              // Строки вложений — до сообщений: связь SetNull оставила бы их без владельца.
              files.deleted += (
                await tx.file.deleteMany({ where: { messageId: { in: liveIds } } })
              ).count
              await tx.message.updateMany({
                where: { replyToId: { in: liveIds }, replyQuote: { not: null } },
                data: { replyQuote: null },
              })
              return (await tx.message.deleteMany({ where: { id: { in: liveIds } } })).count
            }),
        },
        {
          label: 'ScheduledMessage',
          count: () => this.prisma.scheduledMessage.count({ where: scheduled }),
          findBatch: () =>
            this.prisma.scheduledMessage.findMany({
              where: scheduled,
              select: { id: true },
              take: BATCH_SIZE,
            }),
          deleteByIds: async (ids) =>
            (
              await this.prisma.scheduledMessage.deleteMany({
                where: { id: { in: ids }, ...scheduled },
              })
            ).count,
        },
        {
          label: 'ChatMember.draft',
          count: () => this.prisma.chatMember.count({ where: drafts }),
          findBatch: () =>
            this.prisma.chatMember.findMany({
              where: drafts,
              select: { id: true },
              take: BATCH_SIZE,
            }),
          deleteByIds: async (ids) =>
            (
              await this.prisma.chatMember.updateMany({
                where: { id: { in: ids }, ...drafts },
                data: { draft: null },
              })
            ).count,
        },
      ],
      [files],
    )
  }

  /**
   * Документы ушедшего студента — год после ухода: сканы личных документов и выданные вузом
   * справки, включая уже удалённые им самим. Журнал и гранты документа уходят каскадом.
   *
   * Исключения «вуз обязан хранить» в коде нет: `retentionDays` у типа документа — это срок
   * до АРХИВАЦИИ истёкшего документа, а не обязательство хранить. Платформа — не архив вуза:
   * оригиналы и личные дела ведёт он сам.
   */
  async purgeDepartedDocuments(dryRun: boolean): Promise<RetentionCounts> {
    const owner = departedStudentWhere(retentionCutoff())
    const documents: Prisma.DocumentWhereInput = { owner }
    const files: CompanionCount = {
      label: 'File',
      count: () => this.prisma.file.count({ where: { document: documents } }),
      deleted: 0,
    }
    return this.run(
      'purgeDepartedDocuments',
      dryRun,
      [
        {
          label: 'Document',
          count: () => this.prisma.document.count({ where: documents }),
          findBatch: () =>
            this.prisma.document.findMany({
              where: documents,
              select: { id: true },
              take: BATCH_SIZE,
            }),
          deleteByIds: (ids) =>
            this.prisma.$transaction(async (tx) => {
              const live = await tx.document.findMany({
                where: { id: { in: ids }, ...documents },
                select: { id: true },
                take: ids.length,
              })
              const liveIds = live.map((d) => d.id)
              if (liveIds.length === 0) return 0
              // Скан справки, выданной вузом, заведён на сотрудника (issueToOwner), поэтому
              // отбираем по документу, а не по владельцу файла.
              files.deleted += (
                await tx.file.deleteMany({ where: { documentId: { in: liveIds } } })
              ).count
              return (await tx.document.deleteMany({ where: { id: { in: liveIds } } })).count
            }),
        },
      ],
      [files],
    )
  }

  /**
   * Профиль ушедшего студента — год после ухода. Удаление штатное (`softDeleteSelf`):
   * затираются все персональные поля, сносятся аватар, обложка и медиа профиля, сессии
   * отзываются. Остаётся «надгробие», которое физически удалит `purgeAccountTombstones`
   * ещё через год. Дата ухода при этом сохраняется — по ней доберутся остальные задачи,
   * если в эту ночь они не успели.
   */
  async purgeDepartedProfiles(dryRun: boolean): Promise<RetentionCounts> {
    const where: Prisma.UserWhereInput = {
      ...departedStudentWhere(retentionCutoff()),
      deletedAt: null,
    }
    if (dryRun) {
      const counts = { User: await this.prisma.user.count({ where }) }
      this.report('purgeDepartedProfiles', true, counts)
      return counts
    }
    const failed: string[] = []
    const removed: string[] = []
    while (removed.length + failed.length < PROFILE_MAX_PER_RUN) {
      const batch = await this.prisma.user.findMany({
        where: failed.length > 0 ? { ...where, id: { notIn: failed } } : where,
        select: { id: true },
        take: Math.min(BATCH_SIZE, PROFILE_MAX_PER_RUN - removed.length - failed.length),
      })
      if (batch.length === 0) break
      for (const { id } of batch) {
        try {
          await this.users.softDeleteSelf(id)
          removed.push(id)
        } catch (err) {
          // Один сбойный аккаунт не должен останавливать остальных; он вернётся завтра.
          failed.push(id)
          this.logger.warn(`purgeDepartedProfiles: профиль ${id} не удалён: ${String(err)}`)
        }
      }
    }
    const counts: RetentionCounts = { User: removed.length }
    if (failed.length > 0) counts['User.failed'] = failed.length
    this.report('purgeDepartedProfiles', false, counts)
    if (removed.length > 0) {
      await this.audit.record({
        action: 'pd_retention_purged',
        entity: 'User',
        metadata: { task: 'purgeDepartedProfiles', counts, userIds: removed },
      })
    }
    return counts
  }

  /**
   * «Надгробия» удалённых аккаунтов — физическое удаление через год после `deletedAt`
   * (задача 14.6). Удаление аккаунта (`softDeleteSelf`) уже затёрло ПДн в самой строке, но
   * на ней держатся сообщения, посты, заявки и прочее содержимое человека — с удалением
   * строки оно уходит каскадом. Год — тот же срок, что у остальных групп: запас на жалобу,
   * спор и ошибку.
   *
   * Что делается перед удалением, чтобы каскад не унёс чужое:
   * - аккаунт с «блокирующими» связями (TOMBSTONE_BLOCKERS) пропускается — см. список;
   * - аккаунт, владеющий чужими файлами (обложка книги библиотеки, медиа чужого поста,
   *   вложение чужого сообщения и т. п.), пропускается: `File.owner` — Cascade;
   * - сканы чужих документов, заведённые на этого человека (справка, выданная им как
   *   сотрудником вуза, — issueToOwner), переписываются на владельца документа;
   * - в чужих ответах на его сообщения стирается цитата — копия его текста;
   * - персональные гранты на чужие документы, выданные ему, удаляются.
   * Скаляры без FK (`AuditLog.userId`, `DocumentEvent.actorId`, `ApplicationEvent.actorId`,
   * `DocumentExport.userId` …) остаются висеть: так они и задуманы — журнал переживает
   * удаление человека, а ПДн в них нет.
   */
  async purgeAccountTombstones(dryRun: boolean): Promise<RetentionCounts> {
    const cutoff = retentionCutoff()
    const where: Prisma.UserWhereInput = { deletedAt: { lt: cutoff } }
    const counts: RetentionCounts = { 'User.tombstones': await this.prisma.user.count({ where }) }
    const removed: string[] = []
    let checked = 0
    let afterId: string | null = null
    // Курсор по id, а не «первые N»: пропущенные надгробия остаются в таблице, и выборка
    // с начала крутилась бы на них же.
    while (checked < TOMBSTONE_MAX_PER_RUN) {
      const batch: { id: string }[] = await this.prisma.user.findMany({
        where: afterId ? { ...where, id: { gt: afterId } } : where,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: Math.min(BATCH_SIZE, TOMBSTONE_MAX_PER_RUN - checked),
      })
      if (batch.length === 0) break
      for (const { id } of batch) {
        checked++
        afterId = id
        const blockers = await this.tombstoneBlockers(id)
        if (blockers.length > 0) {
          for (const reason of blockers) {
            counts[`blocked.${reason}`] = (counts[`blocked.${reason}`] ?? 0) + 1
          }
          continue
        }
        if (dryRun) {
          counts.User = (counts.User ?? 0) + 1
          continue
        }
        try {
          if (await this.deleteTombstone(id, cutoff)) removed.push(id)
        } catch (err) {
          counts['User.failed'] = (counts['User.failed'] ?? 0) + 1
          this.logger.warn(`purgeAccountTombstones: ${id} не удалён: ${String(err)}`)
        }
      }
    }
    if (!dryRun) counts.User = removed.length
    this.report('purgeAccountTombstones', dryRun, counts)
    if (removed.length > 0) {
      await this.audit.record({
        action: 'pd_retention_purged',
        entity: 'User',
        metadata: { task: 'purgeAccountTombstones', counts, userIds: removed },
      })
    }
    return counts
  }

  /** Почему надгробие удалять нельзя: имена связей, пустой список — можно. */
  private async tombstoneBlockers(userId: string): Promise<string[]> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        _count: {
          select: Object.fromEntries(TOMBSTONE_BLOCKERS.map((k) => [k, true])) as Record<
            (typeof TOMBSTONE_BLOCKERS)[number],
            true
          >,
        },
      },
    })
    if (!row) return []
    const counts = row._count as Record<string, number>
    const reasons: string[] = TOMBSTONE_BLOCKERS.filter((k) => (counts[k] ?? 0) > 0)
    // Файлы человека, привязанные к ЧУЖОМУ: удалились бы каскадом по File.owner. Сканы
    // чужих документов сюда не входят — их переписывают на владельца документа.
    const foreignFiles = await this.prisma.file.count({
      where: {
        ownerId: userId,
        OR: [
          { bookCovers: { some: {} } },
          { post: { authorId: { not: userId } } },
          { message: { senderId: { not: userId } } },
          { material: { teacherId: { not: userId } } },
          { submission: { studentId: { not: userId } } },
          { album: { userId: { not: userId } } },
          { stories: { some: { authorId: { not: userId } } } },
        ],
      },
    })
    if (foreignFiles > 0) reasons.push('foreignFiles')
    return reasons
  }

  /** Физически удалить одно надгробие; false — его успели восстановить или удалить. */
  private async deleteTombstone(userId: string, cutoff: Date): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        // Скан справки, выданной этим сотрудником студенту, заведён на сотрудника
        // (DocumentsService.issueToOwner) — без переписи он ушёл бы каскадом вместе с ним.
        await tx.$executeRaw`
          UPDATE "files" AS f SET "owner_id" = d."owner_id"
          FROM "documents" AS d
          WHERE f."document_id" = d."id" AND f."owner_id" = ${userId} AND d."owner_id" <> ${userId}
        `
        await tx.message.updateMany({
          where: { replyTo: { senderId: userId }, replyQuote: { not: null } },
          data: { replyQuote: null },
        })
        await tx.documentAccess.deleteMany({ where: { granteeType: 'USER', granteeId: userId } })
        // Условие срока — и здесь: строку могли тронуть между выборкой и удалением.
        const { count } = await tx.user.deleteMany({
          where: { id: userId, deletedAt: { lt: cutoff } },
        })
        return count > 0
      },
      { timeout: TOMBSTONE_TX_TIMEOUT_MS },
    )
  }

  /** Цель «строки ушедшего студента»: условие отбора повторяется и в самом удалении. */
  private byStudent<W>(
    label: string,
    delegate: {
      count: (args: { where: W }) => Promise<number>
      findMany: (args: {
        where: W
        select: { id: true }
        take: number
      }) => Promise<{ id: string }[]>
      deleteMany: (args: { where: W }) => Promise<{ count: number }>
    },
    where: W,
  ): RetentionTarget {
    return {
      label,
      count: () => delegate.count({ where }),
      findBatch: () => delegate.findMany({ where, select: { id: true }, take: BATCH_SIZE }),
      deleteByIds: async (ids) =>
        (await delegate.deleteMany({ where: { id: { in: ids }, ...where } as W })).count,
    }
  }

  /** Прогон целей задачи: в dry-run — только счёт, иначе удаление батчами под потолком. */
  private async run(
    task: string,
    dryRun: boolean,
    targets: RetentionTarget[],
    companions: CompanionCount[] = [],
  ): Promise<RetentionCounts> {
    const counts: RetentionCounts = {}
    for (const target of targets) {
      counts[target.label] = dryRun ? await target.count() : await this.deleteInBatches(target)
    }
    for (const c of companions) counts[c.label] = dryRun ? await c.count() : c.deleted
    this.report(task, dryRun, counts)
    const total = Object.values(counts).reduce((acc, n) => acc + n, 0)
    if (!dryRun && total > 0) {
      // Одна сводная запись на прогон, без ПДн — только счётчики.
      await this.audit.record({ action: 'pd_retention_purged', metadata: { task, counts } })
    }
    return counts
  }

  private async deleteInBatches(target: RetentionTarget): Promise<number> {
    let total = 0
    for (let batches = 0; batches < MAX_BATCHES; batches++) {
      const batch = await target.findBatch()
      if (batch.length === 0) break
      total += await target.deleteByIds(batch.map((b) => b.id))
      if (batch.length < BATCH_SIZE) break
    }
    return total
  }

  private report(task: string, dryRun: boolean, counts: RetentionCounts): void {
    const detail = Object.entries(counts)
      .map(([label, n]) => `${label} ${n}`)
      .join(', ')
    this.logger.log(
      dryRun
        ? `${task}: dry-run (PD_RETENTION_ENABLED=false), удалил бы: ${detail}`
        : `${task}: удалено: ${detail}`,
    )
  }
}
