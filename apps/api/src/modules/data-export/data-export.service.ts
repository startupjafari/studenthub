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
 * но не его контакты; из выданных приглашений — роль и статус, но не адрес приглашённого.
 *
 * ПОЛНОТА СВЕРЯЕТСЯ СО СХЕМОЙ (D-F26): каждая связь «таблица → User» перечислена в
 * USER_RELATIONS — либо разделом архива, либо исключением с причиной. Тест проходит по
 * схеме Prisma и падает на новой связи, которой там нет.
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
      stories,
      storyViews,
      storyReactions,
      storyPollVotes,
      auditLog,
      social,
      career,
      services,
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
        // Токена приглашения здесь нет: он ключ регистрации, а не данные о человеке. Адреса
        // приглашённого — тоже: у декана или старосты это сотни чужих email (D-F26).
        select: {
          role: true,
          status: true,
          expiresAt: true,
          usedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.story.findMany({
        where: { authorId: userId },
        // Сторис живёт сутки, поэтому в архиве её обычно уже нет — но пока она жива,
        // это такая же публикация человека, как пост.
        select: {
          id: true,
          audience: true,
          text: true,
          background: true,
          linkUrl: true,
          linkLabel: true,
          createdAt: true,
          expiresAt: true,
          fileId: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.storyView.findMany({
        // Что человек смотрел — данные о нём, а не о владельце сторис.
        where: { userId },
        select: { storyId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.storyReaction.findMany({
        where: { userId },
        select: { storyId: true, emoji: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.storyPollVote.findMany({
        where: { userId },
        select: { pollId: true, optionId: true, createdAt: true },
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
      this.collectSocial(userId, take),
      this.collectCareer(userId, take),
      this.collectServices(userId, take),
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
      stories: section(stories.map(storyView), SECTION_LIMIT),
      storyViews: section(storyViews, SECTION_LIMIT),
      storyReactions: section(storyReactions, SECTION_LIMIT),
      storyPollVotes: section(storyPollVotes, SECTION_LIMIT),
      ...social,
      ...career,
      ...services,
      auditLog: section(auditLog, AUDIT_LIMIT),
    }
  }

  /** Профиль и общение вне ленты: статьи, опросы, альбомы, реакции и голоса в чатах. */
  private async collectSocial(
    userId: string,
    take: number,
  ): Promise<Record<string, ExportSection>> {
    const [
      chatReactions,
      chatPollVotes,
      chatFolders,
      scheduledMessages,
      eventsOrganized,
      eventComments,
      articles,
      contentComments,
      articleBookmarks,
      albums,
      polls,
      pollVotes,
    ] = await Promise.all([
      this.prisma.messageReaction.findMany({
        where: { userId },
        select: { messageId: true, emoji: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.chatPollVote.findMany({
        where: { userId },
        select: { pollId: true, optionId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.chatFolder.findMany({
        where: { userId },
        select: { name: true, position: true, createdAt: true },
        orderBy: { position: 'asc' },
        take,
      }),
      this.prisma.scheduledMessage.findMany({
        // Отложенное сообщение — такое же своё сообщение, просто ещё не отправленное.
        where: { senderId: userId },
        select: { chatId: true, content: true, scheduledAt: true, createdAt: true },
        orderBy: { scheduledAt: 'desc' },
        take,
      }),
      this.prisma.event.findMany({
        where: { organizerId: userId },
        select: {
          id: true,
          audience: true,
          title: true,
          description: true,
          location: true,
          isOnline: true,
          startsAt: true,
          endsAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.eventComment.findMany({
        where: { authorId: userId },
        select: { eventId: true, content: true, createdAt: true, deletedAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.profileArticle.findMany({
        where: { userId },
        select: {
          id: true,
          title: true,
          description: true,
          content: true,
          category: true,
          tags: true,
          visibility: true,
          status: true,
          views: true,
          publishedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.contentComment.findMany({
        where: { authorId: userId },
        select: { articleId: true, pollId: true, content: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.bookmark.findMany({
        where: { userId },
        select: { articleId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.album.findMany({
        where: { userId },
        select: { id: true, title: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.poll.findMany({
        where: { userId },
        select: {
          id: true,
          question: true,
          multiple: true,
          anonymous: true,
          visibility: true,
          status: true,
          closesAt: true,
          createdAt: true,
          options: { select: { text: true, order: true }, orderBy: { order: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.pollVote.findMany({
        where: { userId },
        select: { pollId: true, optionId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
    ])
    return {
      chatReactions: section(chatReactions, SECTION_LIMIT),
      chatPollVotes: section(chatPollVotes, SECTION_LIMIT),
      chatFolders: section(chatFolders, SECTION_LIMIT),
      scheduledMessages: section(scheduledMessages, SECTION_LIMIT),
      eventsOrganized: section(eventsOrganized, SECTION_LIMIT),
      eventComments: section(eventComments, SECTION_LIMIT),
      articles: section(articles, SECTION_LIMIT),
      contentComments: section(contentComments, SECTION_LIMIT),
      articleBookmarks: section(articleBookmarks, SECTION_LIMIT),
      albums: section(albums, SECTION_LIMIT),
      polls: section(polls, SECTION_LIMIT),
      pollVotes: section(pollVotes, SECTION_LIMIT),
    }
  }

  /** Карьера: профиль, согласия, отклики, резюме и — у работодателя — его компания. */
  private async collectCareer(
    userId: string,
    take: number,
  ): Promise<Record<string, ExportSection>> {
    const [profile, consents, applications, resume, companies] = await Promise.all([
      this.prisma.careerProfile.findMany({
        where: { userId },
        select: {
          visibility: true,
          employmentStatus: true,
          desiredPositions: true,
          employmentTypes: true,
          workFormats: true,
          relocationReady: true,
          desiredSalaryMin: true,
          desiredSalaryMax: true,
          salaryCurrency: true,
          about: true,
          readinessScore: true,
          createdAt: true,
          updatedAt: true,
        },
        take: 1,
      }),
      this.prisma.careerConsent.findMany({
        where: { userId },
        select: { field: true, companyId: true, grantedAt: true, revokedAt: true },
        orderBy: { grantedAt: 'desc' },
        take,
      }),
      this.prisma.careerApplication.findMany({
        where: { studentId: userId },
        select: {
          vacancyId: true,
          status: true,
          coverLetter: true,
          createdAt: true,
          updatedAt: true,
          vacancy: { select: { title: true, company: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.resume.findMany({
        where: { userId },
        select: {
          title: true,
          publicSlug: true,
          publishedAt: true,
          includeContacts: true,
          createdAt: true,
        },
        take: 1,
      }),
      this.prisma.companyMember.findMany({
        where: { userId },
        // Работодатель получает и сведения о своей компании — без хэша подтверждения почты.
        select: {
          role: true,
          createdAt: true,
          company: {
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              website: true,
              city: true,
              status: true,
              createdAt: true,
            },
          },
        },
        take,
      }),
    ])
    return {
      careerProfile: section(profile, SECTION_LIMIT),
      careerConsents: section(consents, SECTION_LIMIT),
      careerApplications: section(applications.map(careerApplicationView), SECTION_LIMIT),
      resume: section(resume, SECTION_LIMIT),
      companies: section(companies, SECTION_LIMIT),
    }
  }

  /**
   * Обращения к вузу и платформе: жалобы, предупреждения модерации, поддержка, записи в
   * деканат, консультации, привязка Telegram, приглашение, по которому человек пришёл.
   */
  private async collectServices(
    userId: string,
    take: number,
  ): Promise<Record<string, ExportSection>> {
    const [
      complaints,
      warnings,
      supportTickets,
      appointments,
      consultations,
      telegram,
      inviteUsed,
      notificationSettings,
    ] = await Promise.all([
      this.prisma.complaint.findMany({
        where: { reporterId: userId },
        select: {
          targetType: true,
          targetId: true,
          reason: true,
          status: true,
          resolution: true,
          resolvedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.moderationWarning.findMany({
        where: { userId },
        select: { complaintId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.chat.findMany({
        // Обращение в поддержку платформы — чат, который человек открыл сам. Сообщения в нём
        // уже в разделе messages; здесь — сами обращения и их закрытие.
        where: { type: 'SUPPORT_PLATFORM', createdById: userId },
        select: { id: true, title: true, createdAt: true, supportClosedAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.deaneryAppointment.findMany({
        // Служебная заметка сотрудника (staffNote) — его рабочая запись, не выгружается.
        where: { studentId: userId },
        select: {
          type: true,
          status: true,
          topic: true,
          requestedAt: true,
          scheduledAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.consultationSlot.findMany({
        where: { studentId: userId },
        select: {
          startsAt: true,
          endsAt: true,
          location: true,
          isOnline: true,
          status: true,
          topic: true,
        },
        orderBy: { startsAt: 'desc' },
        take,
      }),
      this.prisma.telegramAccount.findMany({
        where: { userId },
        select: {
          telegramId: true,
          username: true,
          linkedAt: true,
          lastSeenAt: true,
          revokedAt: true,
        },
        take: 1,
      }),
      this.prisma.invite.findMany({
        where: { usedById: userId },
        select: { role: true, createdAt: true, usedAt: true },
        take: 1,
      }),
      this.prisma.notificationSettings.findMany({
        where: { userId },
        select: {
          emailEnabled: true,
          pushEnabled: true,
          scheduleChangeEnabled: true,
          appUpdateEnabled: true,
          messageEnabled: true,
          postEnabled: true,
          eventEnabled: true,
          systemEnabled: true,
          updatedAt: true,
        },
        take: 1,
      }),
    ])
    return {
      complaintsFiled: section(complaints, SECTION_LIMIT),
      moderationWarnings: section(warnings, SECTION_LIMIT),
      supportTickets: section(supportTickets, SECTION_LIMIT),
      deaneryAppointments: section(appointments, SECTION_LIMIT),
      consultations: section(consultations, SECTION_LIMIT),
      // telegramId — BigInt: JSON.stringify его не умеет, в архив — строкой.
      telegram: section(
        telegram.map((t) => ({ ...t, telegramId: t.telegramId.toString() })),
        SECTION_LIMIT,
      ),
      inviteUsed: section(inviteUsed, SECTION_LIMIT),
      notificationSettings: section(notificationSettings, SECTION_LIMIT),
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
  'контактов, из выданных приглашений — роль и статус без адреса приглашённого. ' +
  'Не выгружаются ключи доступа (хэш пароля, секрет двухфакторной ' +
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

/**
 * Сторис в архиве. `fileId` наружу не уходит: сам файл человек найдёт в разделе `files`
 * (он его владелец), а внутренний идентификатор вложения ему ничего не объясняет —
 * важно лишь то, была ли сторис с медиа или текстовой.
 */
function storyView<T extends { fileId: string | null }>(
  story: T,
): Omit<T, 'fileId'> & {
  hasMedia: boolean
} {
  const { fileId, ...rest } = story
  return { ...rest, hasMedia: fileId !== null }
}

/** Отклик одной строкой: вакансия и компания по названию, без вложенного дерева (§5.3). */
function careerApplicationView(row: {
  vacancyId: string
  status: string
  coverLetter: string | null
  createdAt: Date
  updatedAt: Date
  vacancy: { title: string; company: { name: string } } | null
}): Record<string, unknown> {
  const { vacancy, ...rest } = row
  return { ...rest, vacancy: vacancy?.title ?? null, company: vacancy?.company.name ?? null }
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

// Причины исключения — общие для нескольких связей.
const ACCESS_KEY = 'ключ доступа или токен доставки, а не данные о человеке'
const STAFF_WORK =
  'рабочее действие сотрудника над чужими записями — данные вуза и других людей, не субъекта'

/**
 * Сверка выгрузки со схемой (D-F26). Ключ — «модель.поле» внешнего ключа на User; значение —
 * раздел архива или причина исключения. Тест data-export.service.spec проходит по схеме
 * Prisma и падает, если связь с User есть в схеме, но не названа здесь, — решение о новой
 * таблице с персональными данными принимается осознанно, а не теряется молча.
 */
export const USER_RELATIONS: Readonly<Record<string, { section: string } | { excluded: string }>> =
  {
    'RefreshToken.userId': { excluded: ACCESS_KEY },
    'PasswordResetToken.userId': { excluded: ACCESS_KEY },
    'PushSubscription.userId': { excluded: ACCESS_KEY },
    'DeviceToken.userId': { excluded: ACCESS_KEY },
    'Invite.createdById': { section: 'invitesIssued' },
    'Invite.usedById': { section: 'inviteUsed' },
    'Group.starostaId': { excluded: 'староство отражено в account (group, starostaSince)' },
    'Pair.teacherId': { excluded: STAFF_WORK },
    'ScheduleChange.newTeacherId': { excluded: STAFF_WORK },
    'ScheduleChange.createdById': { excluded: STAFF_WORK },
    'Post.authorId': { section: 'posts' },
    'Post.targetUserId': { excluded: 'публикация другого человека, адресованная субъекту' },
    'Post.pinnedById': { excluded: STAFF_WORK },
    'Reaction.userId': { section: 'reactions' },
    'PostBookmark.userId': { section: 'bookmarks' },
    'Comment.authorId': { section: 'comments' },
    'ChatMember.userId': { section: 'chats' },
    'Message.senderId': { section: 'messages' },
    'Message.pinnedById': { excluded: STAFF_WORK },
    'MessageReaction.userId': { section: 'chatReactions' },
    'ChatFolder.userId': { section: 'chatFolders' },
    'ChatPollVote.userId': { section: 'chatPollVotes' },
    'ScheduledMessage.senderId': { section: 'scheduledMessages' },
    'Event.organizerId': { section: 'eventsOrganized' },
    'EventParticipant.userId': { section: 'events' },
    'EventComment.authorId': { section: 'eventComments' },
    'File.ownerId': { section: 'files' },
    'Notification.userId': { section: 'notifications' },
    'NotificationSettings.userId': { section: 'notificationSettings' },
    'Complaint.reporterId': { section: 'complaintsFiled' },
    'Complaint.reviewingById': { excluded: STAFF_WORK },
    'Complaint.resolvedById': { excluded: STAFF_WORK },
    'ModerationWarning.userId': { section: 'moderationWarnings' },
    'ModerationWarning.issuedById': { excluded: STAFF_WORK },
    'Material.teacherId': { excluded: STAFF_WORK },
    'ProfileArticle.userId': { section: 'articles' },
    'ContentComment.authorId': { section: 'contentComments' },
    'Bookmark.userId': { section: 'articleBookmarks' },
    'Album.userId': { section: 'albums' },
    'Poll.userId': { section: 'polls' },
    'PollVote.userId': { section: 'pollVotes' },
    'Document.ownerId': { section: 'documents' },
    'DocumentRequest.createdById': { excluded: STAFF_WORK },
    'DocumentSubmission.studentId': { section: 'documentSubmissions' },
    'Friendship.requesterId': { section: 'friends' },
    'Friendship.addresseeId': { section: 'friends' },
    'Application.studentId': { section: 'applications' },
    'Course.teacherId': { excluded: STAFF_WORK },
    'Assignment.createdById': { excluded: STAFF_WORK },
    'Submission.studentId': { section: 'assignmentSubmissions' },
    'Submission.gradedById': { excluded: STAFF_WORK },
    'Attendance.studentId': { section: 'attendance' },
    'Attendance.markedById': { excluded: STAFF_WORK },
    'GradeColumn.createdById': { excluded: STAFF_WORK },
    'Grade.studentId': { section: 'grades' },
    'Exam.createdById': { excluded: STAFF_WORK },
    'Exam.examinerId': { excluded: STAFF_WORK },
    'ExamResult.studentId': { section: 'examResults' },
    'ConsultationSlot.teacherId': { excluded: STAFF_WORK },
    'ConsultationSlot.studentId': { section: 'consultations' },
    'DeaneryAppointment.studentId': { section: 'deaneryAppointments' },
    'DeaneryAppointment.assignedToId': { excluded: STAFF_WORK },
    'PortfolioItem.userId': { section: 'portfolio' },
    'CompanyMember.userId': { section: 'companies' },
    'CareerProfile.userId': { section: 'careerProfile' },
    'CareerConsent.userId': { section: 'careerConsents' },
    'CareerApplication.studentId': { section: 'careerApplications' },
    'Resume.userId': { section: 'resume' },
    'ReleaseView.userId': { excluded: 'служебная отметка интерфейса «что нового» о версии' },
    'TelegramAccount.userId': { section: 'telegram' },
    'UniversityDemoRequest.reviewedById': { excluded: STAFF_WORK },
    'Story.authorId': { section: 'stories' },
    'StoryPollVote.userId': { section: 'storyPollVotes' },
    'StoryView.userId': { section: 'storyViews' },
    'StoryReaction.userId': { section: 'storyReactions' },
    // Камеры вуза (§3.10): кто завёл агента и кто переключал модуль — работа админа вуза.
    'CameraAgent.createdById': { excluded: STAFF_WORK },
    'CameraSettings.updatedById': { excluded: STAFF_WORK },
  }
