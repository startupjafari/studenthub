import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import { ExportRegistryService } from '../../common/export/export-registry.service'
import type { ExportContext, ExportLocale } from '../../common/export/export-branding.types'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

/**
 * Потолок строк в одном разделе архива.
 *
 * Выгрузка идёт синхронно, и единственное, что здесь по-настоящему опасно, — переписка:
 * у активного студента это десятки тысяч строк. Потолок не прячет обрезание: раздел
 * честно сообщает `truncated: true` и своё число, чтобы человек видел, что архив неполон,
 * и мог запросить остаток у вуза (docs/PERSONAL_DATA.md §5).
 */
const SECTION_LIMIT = 5000

/** Журнал действий хранится 90 дней (cleanAuditLogs) — дальше в нём ничего и нет. */
const AUDIT_LIMIT = 2000

/**
 * Машинная выгрузка своих персональных данных (Ф14.6, docs/PERSONAL_DATA.md §5).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ, ЧИТАЮЩИЙ ЧУЖИЕ ТАБЛИЦЫ. Правило §2.1 (модуль владеет своими
 * таблицами) здесь отступает осознанно, и это единственное место с таким отступлением.
 * Выгрузка обязана быть ПОЛНОЙ: её смысл в том, что человек получает всё, что о нём
 * хранится. Собирать её из витринных методов десяти доменных сервисов значило бы
 * выгружать не строки, а экранные формы — с их фильтрами, масками и пагинацией. Хуже
 * того, новая таблица с персональными данными молча не попадала бы в архив, и заметить
 * это было бы нельзя. Здесь же перечень источников лежит в одном файле и читается
 * целиком — его можно сверить со схемой глазами, что и требуется от такой выгрузки.
 *
 * ЧТО НЕ ВЫГРУЖАЕТСЯ НИКОГДА: хэш пароля, секрет и резервные коды двухфакторной
 * аутентификации, refresh-сессии, токены приглашений и ПОЛНЫЙ номер личного документа
 * (только последние четыре цифры — как и везде в API, §14.9). Это не персональные
 * данные субъекта, а ключи доступа к ним: в файле, который уедет в почту или облако,
 * им не место.
 *
 * ЧУЖИЕ ДАННЫЕ: в архив попадают только собственные строки. Из переписки — свои
 * сообщения, но не ответы собеседников; из дружбы — имя друга (оно и так на экране),
 * но не его контакты.
 */
@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branding: ExportBrandingService,
    private readonly exports: ExportRegistryService,
  ) {}

  async exportPersonalData(
    viewer: JwtPayload,
    locale: ExportLocale,
    request: { ip?: string; userAgent?: string } = {},
  ): Promise<{ body: string; filename: string; rows: number }> {
    const userId = viewer.sub
    const account = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: ACCOUNT_SELECT,
    })
    if (!account) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }

    const sections = await this.collect(userId)
    const generatedAt = new Date()
    const context: ExportContext = {
      kind: 'my-data',
      actor: { id: userId, fullName: `${account.lastName} ${account.firstName}`.trim() },
      locale,
      timezone: resolveTimezone(account),
      generatedAt,
      // В журнал уходят только условия выгрузки, не её содержимое (§13).
      params: { sections: Object.keys(sections).length },
    }

    const rows = Object.values(sections).reduce((sum, section) => sum + section.count, 0)
    const document = {
      generatedAt: generatedAt.toISOString(),
      platform: {
        name: this.branding.brand,
        url: this.branding.publicUrl,
        version: this.branding.version,
      },
      subject: {
        id: account.id,
        fullName: context.actor.fullName,
        email: account.email,
      },
      notice: NOTICE,
      account: this.accountView(account),
      sections,
    }
    const body = JSON.stringify(document, null, 2)

    // Выгрузка персональных данных — событие для обоих журналов, как и выгрузка списка
    // пользователей: в ленте действий человека и в реестре выданных файлов.
    await this.audit.record({
      userId,
      action: 'personal_data_export',
      entity: 'User',
      entityId: userId,
      metadata: { rows },
      ...request,
    })
    await this.exports.register({ context, format: 'json', rows, ...request })

    this.logger.log(`Выгрузка персональных данных: пользователь ${userId}, строк ${rows}`)
    return { body, filename: this.branding.filename(context, 'json'), rows }
  }

  // ── Сбор разделов ───────────────────────────────────────────────────────────

  /**
   * Каждый раздел — отдельный индексный запрос по своему `userId`. Потолок берётся с
   * запасом в одну строку: она не попадает в файл, но показывает, что данные кончились
   * не сами по себе.
   */
  private async collect(userId: string): Promise<Record<string, ExportSection>> {
    const take = SECTION_LIMIT + 1

    const [
      files,
      posts,
      comments,
      reactions,
      bookmarks,
      chatMemberships,
      messages,
      documents,
      documentSubmissions,
      grades,
      attendance,
      submissions,
      examResults,
      applications,
      eventParticipations,
      portfolio,
      friends,
      notifications,
      invitesIssued,
      auditLog,
    ] = await Promise.all([
      this.prisma.file.findMany({
        where: { ownerId: userId },
        // Ключ объекта — внутренний путь в хранилище, человеку он не говорит ничего,
        // а в чужих руках становится половиной ссылки на файл.
        select: { id: true, bucket: true, name: true, mime: true, size: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.post.findMany({
        where: { authorId: userId },
        select: {
          id: true,
          audience: true,
          title: true,
          content: true,
          status: true,
          views: true,
          createdAt: true,
          deletedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.comment.findMany({
        where: { authorId: userId },
        select: { id: true, postId: true, content: true, createdAt: true, deletedAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.reaction.findMany({
        where: { userId },
        select: { postId: true, emoji: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.postBookmark.findMany({
        where: { userId },
        select: { postId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.chatMember.findMany({
        where: { userId },
        select: {
          chatId: true,
          isAdmin: true,
          mutedAt: true,
          lastReadAt: true,
          createdAt: true,
          chat: { select: { type: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.message.findMany({
        // Только свои сообщения: ответы собеседников — их персональные данные.
        where: { senderId: userId },
        select: {
          id: true,
          chatId: true,
          content: true,
          createdAt: true,
          editedAt: true,
          deletedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.document.findMany({
        where: { ownerId: userId },
        select: {
          id: true,
          category: true,
          type: true,
          title: true,
          // Полного номера здесь нет намеренно — см. комментарий к классу.
          number: true,
          issuedBy: true,
          issuedAt: true,
          expiresAt: true,
          status: true,
          createdAt: true,
          deletedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.documentSubmission.findMany({
        where: { studentId: userId },
        select: {
          id: true,
          requestId: true,
          status: true,
          submittedAt: true,
          reviewedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.grade.findMany({
        where: { studentId: userId },
        select: {
          score: true,
          createdAt: true,
          column: {
            select: {
              title: true,
              kind: true,
              maxScore: true,
              published: true,
              course: { select: { subject: { select: { name: true } } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.attendance.findMany({
        where: { studentId: userId },
        select: { date: true, status: true, note: true, pairId: true },
        orderBy: { date: 'desc' },
        take,
      }),
      this.prisma.submission.findMany({
        where: { studentId: userId },
        select: {
          id: true,
          assignmentId: true,
          status: true,
          text: true,
          linkUrl: true,
          attemptNumber: true,
          score: true,
          feedback: true,
          submittedAt: true,
          gradedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.examResult.findMany({
        where: { studentId: userId },
        select: {
          examId: true,
          admitted: true,
          status: true,
          score: true,
          attempt: true,
          note: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.application.findMany({
        where: { studentId: userId },
        select: {
          id: true,
          number: true,
          status: true,
          deliveryType: true,
          formData: true,
          submittedAt: true,
          readyAt: true,
          issuedAt: true,
          createdAt: true,
          service: { select: { code: true, nameRu: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.eventParticipant.findMany({
        where: { userId },
        select: {
          createdAt: true,
          event: { select: { id: true, title: true, startsAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.portfolioItem.findMany({
        where: { userId },
        select: {
          kind: true,
          title: true,
          organization: true,
          description: true,
          url: true,
          startDate: true,
          endDate: true,
          visibility: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.friendship.findMany({
        where: {
          status: 'ACCEPTED',
          OR: [{ requesterId: userId }, { addresseeId: userId }],
        },
        // Имя друга человек и так видит в интерфейсе; контактов друга здесь нет.
        select: {
          createdAt: true,
          requester: { select: { id: true, firstName: true, lastName: true } },
          addressee: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.notification.findMany({
        where: { userId },
        select: { type: true, title: true, body: true, isRead: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.invite.findMany({
        where: { createdById: userId },
        // Токена приглашения здесь нет: он ключ регистрации, а не данные о человеке.
        select: {
          role: true,
          email: true,
          status: true,
          expiresAt: true,
          usedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.auditLog.findMany({
        where: { userId },
        select: {
          action: true,
          entity: true,
          entityId: true,
          ip: true,
          userAgent: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: AUDIT_LIMIT + 1,
      }),
    ])

    return {
      files: section(files, SECTION_LIMIT),
      posts: section(posts, SECTION_LIMIT),
      comments: section(comments, SECTION_LIMIT),
      reactions: section(reactions, SECTION_LIMIT),
      bookmarks: section(bookmarks, SECTION_LIMIT),
      chats: section(chatMemberships, SECTION_LIMIT),
      messages: section(messages, SECTION_LIMIT),
      documents: section(documents.map(maskDocument), SECTION_LIMIT),
      documentSubmissions: section(documentSubmissions, SECTION_LIMIT),
      grades: section(grades.map(gradeView), SECTION_LIMIT),
      attendance: section(attendance, SECTION_LIMIT),
      assignmentSubmissions: section(submissions, SECTION_LIMIT),
      examResults: section(examResults, SECTION_LIMIT),
      applications: section(applications, SECTION_LIMIT),
      events: section(eventParticipations, SECTION_LIMIT),
      portfolio: section(portfolio, SECTION_LIMIT),
      friends: section(
        friends.map((row) => friendView(row, userId)),
        SECTION_LIMIT,
      ),
      notifications: section(notifications, SECTION_LIMIT),
      invitesIssued: section(invitesIssued, SECTION_LIMIT),
      auditLog: section(auditLog, AUDIT_LIMIT),
    }
  }

  /** Учётная запись и профиль: всё, что лежит в самой строке User, кроме ключей доступа. */
  private accountView(account: AccountRow): Record<string, unknown> {
    const { university, faculty, group, ...rest } = account
    return {
      ...rest,
      university: university?.name ?? null,
      faculty: faculty?.name ?? null,
      group: group?.name ?? null,
    }
  }
}

/**
 * Таймзона для даты в имени файла: вуза → своя из профиля → серверная.
 *
 * Пустая строка здесь — не теоретический случай: у платформенных ролей вуза нет, а
 * `User.timezone` в таких строках хранит `''`. Проверка через `??` его пропускала, и
 * `Intl.DateTimeFormat` падал с «Invalid time zone specified» — выгрузка отвечала 500
 * тем, у кого вуза нет. Отсюда `||` и `trim()`: пустое значение — это отсутствующее.
 */
function resolveTimezone(account: AccountRow): string {
  return account.university?.timezone?.trim() || account.timezone?.trim() || 'UTC'
}

/** Что архив сообщает о себе человеку, который его откроет. */
const NOTICE =
  'Это машинная выгрузка ваших персональных данных. В файле только ваши собственные ' +
  'записи: из переписки — отправленные вами сообщения, из дружбы — имена друзей без их ' +
  'контактов. Не выгружаются ключи доступа (хэш пароля, секрет двухфакторной ' +
  'аутентификации, сессии, токены приглашений) и полный номер личного документа — ' +
  'в разделе documents остаются последние четыре цифры. Разделы с пометкой ' +
  '"truncated": true показаны не целиком: остаток можно запросить у вашего университета.'

interface ExportSection {
  count: number
  truncated: boolean
  items: unknown[]
}

/** Отрезает страховочную строку и честно помечает усечение. */
function section(rows: unknown[], limit: number): ExportSection {
  const truncated = rows.length > limit
  const items = truncated ? rows.slice(0, limit) : rows
  return { count: items.length, truncated, items }
}

/** Номер документа — только последние четыре цифры, как и в остальном API (§14.9). */
function maskDocument<T extends { number: string | null }>(
  doc: T,
): Omit<T, 'number'> & {
  numberLast4: string | null
} {
  const { number, ...rest } = doc
  return { ...rest, numberLast4: number ? number.slice(-4) : null }
}

/**
 * Оценка одной строкой: дисциплина, контрольная точка, балл.
 *
 * Разворачивается здесь, а не отдаётся деревом `column → course → subject`: в ответе
 * API больше двух уровней вложенности не бывает (§5.3), да и читать архив человеку
 * удобнее плоской строкой.
 */
function gradeView(row: {
  score: number | null
  createdAt: Date
  column: {
    title: string
    kind: string
    maxScore: number | null
    published: boolean
    course: { subject: { name: string } | null } | null
  } | null
}): Record<string, unknown> {
  return {
    subject: row.column?.course?.subject?.name ?? null,
    column: row.column?.title ?? null,
    kind: row.column?.kind ?? null,
    maxScore: row.column?.maxScore ?? null,
    published: row.column?.published ?? null,
    score: row.score,
    createdAt: row.createdAt,
  }
}

/** Друг — это другая сторона связи; кто из двоих, зависит от того, кто звал. */
function friendView(
  row: {
    createdAt: Date
    requester: { id: string; firstName: string; lastName: string }
    addressee: { id: string; firstName: string; lastName: string }
  },
  userId: string,
): Record<string, unknown> {
  const friend = row.requester.id === userId ? row.addressee : row.requester
  return {
    id: friend.id,
    firstName: friend.firstName,
    lastName: friend.lastName,
    since: row.createdAt,
  }
}

// Поля учётной записи и профиля. Перечислены поимённо, а не через исключение лишнего:
// при добавлении колонки в User новое поле не попадёт в файл само, и это правильный
// порядок — решение о выгрузке персонального поля принимается осознанно.
const ACCOUNT_SELECT = {
  id: true,
  email: true,
  username: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  lastSeenAt: true,
  locale: true,
  isBlocked: true,
  blockedUntil: true,
  twoFactorEnabled: true,
  profileVisibility: true,
  showEmail: true,
  showPhone: true,
  consentAt: true,
  consentVersion: true,
  consentByGuardian: true,
  firstName: true,
  lastName: true,
  middleName: true,
  phone: true,
  bio: true,
  birthDate: true,
  gender: true,
  languages: true,
  telegram: true,
  instagram: true,
  website: true,
  headline: true,
  timezone: true,
  country: true,
  avatarUrl: true,
  coverUrl: true,
  course: true,
  enrollmentYear: true,
  graduationYear: true,
  educationLevel: true,
  studyForm: true,
  fundingType: true,
  specialty: true,
  studentCardNumber: true,
  academicStatus: true,
  gpa: true,
  interests: true,
  skills: true,
  dormitory: true,
  address: true,
  starostaSince: true,
  duties: true,
  position: true,
  academicDegree: true,
  academicTitle: true,
  department: true,
  subjects: true,
  officeRoom: true,
  officeHours: true,
  employeeNumber: true,
  researchInterests: true,
  publicationsUrl: true,
  appointmentDate: true,
  workPhone: true,
  jobTitle: true,
  responsibilities: true,
  moderationAreas: true,
  university: { select: { name: true, timezone: true } },
  faculty: { select: { name: true } },
  group: { select: { name: true } },
} as const

type AccountRow = {
  id: string
  email: string
  firstName: string
  lastName: string
  timezone: string | null
  university: { name: string; timezone: string } | null
  faculty: { name: string } | null
  group: { name: string } | null
} & Record<string, unknown>
