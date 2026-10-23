import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { InviteStatus, type Prisma } from '@prisma/client'
import type { Client as MinioClient } from 'minio'
import type Redis from 'ioredis'
import { PrismaService } from '../../common/prisma/prisma.service'
import { MINIO_CLIENT } from '../../common/minio/minio.constants'
import { CronLockService } from '../../common/redis/cron-lock.service'
import { AuditService } from '../../common/audit/audit.service'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import type { EnvVars } from '../../config/env.schema'
import { EventsService } from '../events/events.service'
import { PostsService } from '../posts/posts.service'
import { StoriesService } from '../stories/stories.service'
import { DocumentsService } from '../documents/documents.service'
import { DocumentRequestsService } from '../documents/document-requests.service'
import { UserService } from '../users/users.service'
import { ChatsService } from '../chats/chats.service'
import { SupportService } from '../chats/support.service'
import { ComplaintsService } from '../complaints/complaints.service'
import { DemoRequestsService } from '../onboarding/demo-requests.service'
import { CompaniesService } from '../career/companies.service'
import { ApplicationNotifier } from '../application-services/application-notifier'
import { countServerErrors } from '../../common/monitoring/error-rate'
import { TelegramNotifyService, platformHour } from '../../common/telegram/telegram-notify.service'
import { digestText, humanAge } from '../../common/telegram/digest'
import {
  PLATFORM_STATE,
  PLATFORM_TIME_ZONE,
  type PlatformStateReader,
} from '../platform/platform.constants'
import { MediaService } from '../media/media.service'
import { LibraryRemindersService } from '../library/library-reminders.service'
import { LibraryReservationsService } from '../library/library-reservations.service'
import { variantOwnerId } from '../media/media-keys'
import { PdRetentionService, type RetentionCounts } from './pd-retention.service'

// Единственный дом для cron-задач (docs/PROJECT.md §10.2, docs/BACKEND_RULES.md §9.3).
// Разбрасывать @Cron по модулям запрещено. Все задачи работают батчами и логируют счётчик.
//
// Каждая задача идёт под Redis-локом (`CronLockService`): при нескольких инстансах API
// расписание живёт в каждом процессе и без лока задача стартует одновременно везде.
// Возврат `null` из метода = «лок занят, задача идёт на другом инстансе».
const BATCH_SIZE = 500

// Страховочные TTL локов: с запасом больше ожидаемой работы, но меньше интервала запуска
// (иначе следующий тик наткнётся на собственный несnятый лок).
const LOCK_TTL_MS = {
  scheduleEventReminders: 10 * 60 * 1000,
  publishScheduledPosts: 55 * 1000,
  // Меньше получасового интервала задачи: следующий тик не должен упереться в
  // собственный неснятый лок.
  deleteExpiredStories: 25 * 60 * 1000,
  deliverScheduledMessages: 55 * 1000,
  sweepDocumentExpiry: 15 * 60 * 1000,
  closeOverdueDocumentRequests: 10 * 60 * 1000,
  expireInvites: 10 * 60 * 1000,
  purgePasswordResetTokens: 10 * 60 * 1000,
  purgeRefreshTokens: 10 * 60 * 1000,
  cleanOldNotifications: 30 * 60 * 1000,
  cleanAuditLogs: 30 * 60 * 1000,
  cleanDetachedFiles: 10 * 60 * 1000,
  purgeDeviceTokens: 10 * 60 * 1000,
  cleanOrphanFiles: 60 * 60 * 1000,
  sweepIncompleteUploads: 60 * 60 * 1000,
  sendDailyDigest: 10 * 60 * 1000,
  alertQueueBacklog: 10 * 60 * 1000,
  closeStaleTickets: 10 * 60 * 1000,
  purgeUnconfirmedDemoRequests: 10 * 60 * 1000,
  expireCompanyAccess: 10 * 60 * 1000,
  // Удаление аккаунта — анонимизация и снос медиа: секунды на человека, а не миллисекунды.
  purgeUnverifiedEmployers: 30 * 60 * 1000,
  notifyOverdueApplications: 10 * 60 * 1000,
  liftExpiredBlocks: 4 * 60 * 1000,
  rotateDuty: 10 * 60 * 1000,
  watchServices: 4 * 60 * 1000,
  reportStorageUsage: 10 * 60 * 1000,
  resumeMediaProcessing: 9 * 60 * 1000,
  remindLibraryLoans: 30 * 60 * 1000,
  expireLibraryHolds: 30 * 60 * 1000,
  // Сроки хранения ПДн: первый прогон после включения флага разбирает хвост за годы, отсюда
  // запас. Задачи ежедневные, так что TTL меньше интервала заведомо.
  purgeClosedLoans: 30 * 60 * 1000,
  purgeViewLogs: 30 * 60 * 1000,
  purgeDepartedAcademicRecords: 30 * 60 * 1000,
  purgeDepartedApplications: 30 * 60 * 1000,
  purgeDepartedMessages: 30 * 60 * 1000,
  purgeDepartedDocuments: 30 * 60 * 1000,
  purgeDepartedProfiles: 30 * 60 * 1000,
} as const
const NOTIFICATION_RETENTION_DAYS = 30
// Непрочитанные живут дольше прочитанных, но не вечно: кто три месяца не открывал
// колокольчик, тому старые записи уже не нужны, а таблица без этого росла без границы.
// Свёрнутое уведомление чата при каждом сообщении получает свежее время — живой чат
// своё уведомление не теряет.
const UNREAD_NOTIFICATION_RETENTION_DAYS = 90
const AUDIT_RETENTION_DAYS = 90
// Потолок удаления refresh-сессий за один прогон: 100 батчей, 50 тысяч строк. Каждый refresh
// пишет строку, и хвост, накопленный до появления задачи, может исчисляться миллионами — он
// уходит за несколько ежечасных прогонов, а не одним многоминутным циклом под локом. Обычный
// суточный приток в разы меньше пропускной способности 24 прогонов.
const REFRESH_TOKEN_PURGE_MAX_BATCHES = 100
// Сколько ждём подтверждения адреса в заявке вуза, прежде чем удалить её (§31).
//
// Неделя, а не сутки: ссылка живёт 24 часа, но человек мог подать заявку в пятницу и
// открыть почту в понедельник — переотправка письма ему тогда ещё доступна. Дальше
// хранить незачем: заявку не подтвердили, а персональные данные в ней настоящие.
const DEMO_REQUEST_UNCONFIRMED_DAYS = 7
// Не трогаем свежие объекты MinIO — они могут быть в процессе загрузки (запись File ещё не создана).
const ORPHAN_SAFETY_MINUTES = 60
// Не трогаем свежие непривязанные вложения чата: запись File уже есть, а сообщения ещё нет —
// чат принимает все файлы альбома и только потом заводит сообщение и привязывает их.
const DETACHED_CHAT_FILE_SAFETY_MINUTES = 60

// Вложения сообщений, удалённых «для всех», живут ещё столько дней (F-F21): срок на разбор
// жалобы и на ошибку модерации. Дальше байты (до 500 МБ на файл) хранить незачем — само
// сообщение и его вложения никому уже не показываются.
const DELETED_MESSAGE_FILES_RETENTION_DAYS = 30

// Загрузка через общий /files в бакеты постов, сторис и заявок, так и не привязанная к
// сущности (загрузили — пост не создали), живёт сутки: столько же клиент держит и
// незаконченную многочастную загрузку. Дольше черновик с уже загруженным файлом не ждёт.
const DETACHED_UPLOAD_TTL_HOURS = 24

// Медиа постов, удалённых больше стольких дней назад (E-F15): тот же срок, что у вложений
// удалённых сообщений, — на разбор жалобы и ошибку модерации. Восстановления поста нет, и
// дальше файл никому не показывается.
const DELETED_POST_MEDIA_RETENTION_DAYS = 30

// Документы (D-F21). Сканы удалённого документа живут ещё месяц: сотруднику по заявке и
// запросу и админу платформы удалённый документ уже не открывается, срок — запас на разбор
// спора и на ошибку. Дальше паспорт, который владелец удалил, хранить незачем.
const DELETED_DOCUMENT_FILES_RETENTION_DAYS = 30
// Скан, так и не привязанный к документу (мастер не дошёл до сохранения, результат заявки
// не выдался из-за ошибки), — неделя, а не сутки, как у постов: это персональные данные, но
// и мастер документа человек может закрыть и вернуться к нему через несколько дней.
const DETACHED_DOCUMENT_UPLOAD_DAYS = 7

// Работодатель, не подтвердивший почту компании (D-F28), удаляется через столько дней.
// Ссылка живёт сутки, но новую можно запросить со страницы входа; месяц — с запасом на
// отпуск и на тех, кто зарегистрировался до того, как вход стал ждать подтверждения.
const EMPLOYER_UNVERIFIED_DAYS = 30

// Потолок батчей на одну цель уборки File за прогон: первый прогон после выкатки разбирает
// накопленный за всё время хвост — пусть за несколько ночей, но не одним многоминутным
// циклом под локом.
const DETACHED_FILES_MAX_BATCHES = 200

// Ни одной связи, кроме поста: медиа удалённого поста уходит, только если на файл не
// ссылается ничто другое (сторис, альбом, сообщение, обложка книги).
const NO_OWNER_BUT_POST_WHERE = {
  messageId: null,
  materialId: null,
  albumId: null,
  documentId: null,
  submissionId: null,
  stories: { none: {} },
  albumsCovered: { none: {} },
  bookCovers: { none: {} },
} satisfies Prisma.FileWhereInput

// Ни одной связи с сущностью-владельцем — та же проверка, что у FileService.deleteDetached.
// Повторяется и в самом удалении: файл могли привязать между выборкой и DELETE.
const NO_OWNER_WHERE = {
  postId: null,
  ...NO_OWNER_BUT_POST_WHERE,
} satisfies Prisma.FileWhereInput

// Токен телефона, который приложение не подтверждало столько дней, мёртв: приложение
// подтверждает его при каждом запуске (prisma/schema/10-notifications.prisma, DeviceToken).
const DEVICE_TOKEN_STALE_DAYS = 90

// Через сколько часов брошенная многочастная загрузка считается мусором (Фаза 19).
//
// Незавершённая загрузка НЕ ВИДНА как объект: `cleanOrphanFiles` перечисляет объекты бакета и
// её не найдёт, а место её части занимают. Сутки — потолок осмысленной докачки: клиент хранит
// состояние ровно столько же, дальше продолжать всё равно нечего.
const INCOMPLETE_UPLOAD_TTL_HOURS = 24

const DAY_MS = 24 * 60 * 60 * 1000

// Учёт занятого хранилища.
//
// Лимиты стоят на КАЖДЫЙ файл (изображение 10 МБ, видео и документ по 500), а на общий
// объём — ни одного: тысяча студентов с видео в чатах наполняет том незаметно, и упор в
// него выглядит как случайный сбой загрузки в середине дня. Сводка в логе даёт скорость
// роста, сигнал — повод заказать место заранее.
//
// Сутки молчания после сигнала: место не появляется само, и повторять каждый час нечего.
const STORAGE_ALERT_KEY = 'platform:storage-alerted'
const STORAGE_ALERT_SILENCE_SEC = 24 * 60 * 60
const GB = 1024 * 1024 * 1024

// Сигнал о накоплении очереди жалоб.
//
// Порог и пауза подобраны так, чтобы уведомление означало «очередь вышла из-под контроля»,
// а не «пришло ещё три жалобы». Сигналить на каждый час превышения бессмысленно: разгрести
// два десятка жалоб за час нельзя, и пять одинаковых сообщений подряд учат их не читать.
const QUEUE_BACKLOG_THRESHOLD = 20
const QUEUE_BACKLOG_SILENCE_SEC = 6 * 60 * 60
const QUEUE_BACKLOG_KEY = 'platform:queue-backlog-alerted'

// Через сколько молчания обращение закрывается само. Две недели — достаточно, чтобы
// человек успел вернуться с уточнением, и достаточно мало, чтобы очередь не превращалась
// в кладбище отвеченного.
const SUPPORT_STALE_DAYS = 14

// Наблюдение за зависимостями и ошибками.
//
// Сигналим только на ПЕРЕХОД: «упало» и «поднялось». Повторять «всё ещё лежит» каждые
// пять минут бессмысленно — починка идёт, а поток одинаковых сообщений учит их не читать.
const SERVICES_STATE_KEY = 'platform:services-down'
// Порог всплеска: столько серверных ошибок за час означает, что сломалось что-то общее,
// а не один запрос одного человека.
const ERROR_SPIKE_THRESHOLD = 25
const ERROR_SPIKE_KEY = 'platform:error-spike-alerted'
const ERROR_SPIKE_SILENCE_SEC = 60 * 60

// Итог ночной уборки сирот живёт двое суток: сводка читает его раз в день, и пропуск
// одного запуска не должен превращаться в пустую строку навсегда.

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name)
  // Состояние наблюдения за зависимостями в памяти процесса (F-F26): признак «упало» живёт
  // в Redis, и при упавшем самом Redis его ни прочитать, ни записать — сигнал «не отвечает:
  // Redis» уходил каждые пять минут. `servicesDown` — что этот процесс объявил последним;
  // `servicesDownUnsynced` — объявил «упало», но записать в Redis не смог.
  private servicesDown = false
  private servicesDownUnsynced = false

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MINIO_CLIENT) private readonly minio: MinioClient,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly events: EventsService,
    private readonly posts: PostsService,
    private readonly stories: StoriesService,
    private readonly documents: DocumentsService,
    private readonly chats: ChatsService,
    private readonly locks: CronLockService,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly support: SupportService,
    private readonly complaints: ComplaintsService,
    private readonly demoRequests: DemoRequestsService,
    private readonly telegram: TelegramNotifyService,
    @Inject(PLATFORM_STATE) private readonly platform: PlatformStateReader,
    private readonly media: MediaService,
    private readonly companies: CompaniesService,
    private readonly applications: ApplicationNotifier,
    private readonly documentRequests: DocumentRequestsService,
    private readonly users: UserService,
    private readonly libraryReminders: LibraryRemindersService,
    private readonly libraryReservations: LibraryReservationsService,
    private readonly retention: PdRetentionService,
  ) {}

  // Напоминания за час до события (docs/BACKEND_RULES.md §9.3): каждые 15 мин, окно (now, now+70] —
  // всё ещё не напомненное, так что пропущенный тик догоняет следующий; дедуп через
  // Event.reminderSentAt. Логика — в EventsService.remindDue (владелец домена).
  @Cron('*/15 * * * *', { name: 'scheduleEventReminders' })
  async scheduleEventReminders(): Promise<number | null> {
    return this.locks.run('scheduleEventReminders', LOCK_TTL_MS.scheduleEventReminders, () =>
      this.events.remindDue(),
    )
  }

  // Напоминания библиотеки о сроке (Фаза 20.7): ежечасно, в 10 минут. Шлём только днём по
  // часам вуза; за два дня, в последний день и о просрочке — по отметкам в выдаче, так что
  // пропущенный тик догоняет следующий. Логика — в LibraryRemindersService (владелец домена).
  @Cron('10 * * * *', { name: 'remindLibraryLoans' })
  async remindLibraryLoans(): Promise<{
    dueSoon: number
    dueToday: number
    overdue: number
  } | null> {
    return this.locks.run('remindLibraryLoans', LOCK_TTL_MS.remindLibraryLoans, () =>
      this.libraryReminders.remindDue(),
    )
  }

  // Готовые брони библиотеки, которые не забрали к сроку (Фаза 20.8): ежечасно, в 20 минут.
  // Бронь держится до конца дня по часам вуза — час задержки ничего не меняет. Экземпляр
  // уходит следующему в очереди. Тем же прогоном досылается «бронь готова», которую очередь
  // не приняла (Redis лежал). Логика — в LibraryReservationsService.
  @Cron('20 * * * *', { name: 'expireLibraryHolds' })
  async expireLibraryHolds(): Promise<number | null> {
    return this.locks.run('expireLibraryHolds', LOCK_TTL_MS.expireLibraryHolds, async () => {
      const expired = await this.libraryReservations.expireDue()
      await this.libraryReservations.notifyReadyPending()
      return expired
    })
  }

  // Отложенная публикация постов: каждую минуту публикуем посты, у которых наступил scheduledAt.
  @Cron('* * * * *', { name: 'publishScheduledPosts' })
  async publishScheduledPosts(): Promise<number | null> {
    return this.locks.run('publishScheduledPosts', LOCK_TTL_MS.publishScheduledPosts, () =>
      this.posts.publishDueScheduled(),
    )
  }

  // Истёкшие сторисы (Ф14.1): каждые 30 минут (docs/BACKEND_RULES.md §9.3). Логика — в
  // StoriesService.deleteExpired (владелец домена), здесь только расписание и лок.
  // TTL бакета stories-media снимает сами объекты, но записи Story и File — за этой задачей.
  @Cron('*/30 * * * *', { name: 'deleteExpiredStories' })
  async deleteExpiredStories(): Promise<number | null> {
    return this.locks.run('deleteExpiredStories', LOCK_TTL_MS.deleteExpiredStories, () =>
      this.stories.deleteExpired(),
    )
  }

  // Отложенные сообщения чатов — тем же минутным тиком, что и отложенные посты.
  // Расписание живёт здесь, а не в ChatsModule: разбрасывать @Cron по модулям запрещено (§9.3).
  @Cron('* * * * *', { name: 'deliverScheduledMessages' })
  async deliverScheduledMessages(): Promise<number | null> {
    return this.locks.run('deliverScheduledMessages', LOCK_TTL_MS.deliverScheduledMessages, () =>
      this.chats.deliverDueScheduled(),
    )
  }

  // Документы по сроку `expiresAt` → EXPIRING/EXPIRED + уведомления владельцам (§15.19).
  // Ежедневно в 03:30. Логика — в DocumentsService.sweepExpiry (владелец домена).
  @Cron('30 3 * * *', { name: 'sweepDocumentExpiry' })
  async sweepDocumentExpiry(): Promise<{ expired: number; expiring: number } | null> {
    return this.locks.run('sweepDocumentExpiry', LOCK_TTL_MS.sweepDocumentExpiry, () =>
      this.documents.sweepExpiry(),
    )
  }

  // Запросы документов с прошедшим сроком → CLOSED (D-F25). Ежедневно в 03:35, следом за
  // сроками самих документов. Логика — в DocumentRequestsService.closeOverdue (владелец домена).
  @Cron('35 3 * * *', { name: 'closeOverdueDocumentRequests' })
  async closeOverdueDocumentRequests(): Promise<number | null> {
    return this.locks.run(
      'closeOverdueDocumentRequests',
      LOCK_TTL_MS.closeOverdueDocumentRequests,
      () => this.documentRequests.closeOverdue(),
    )
  }

  // Временные блокировки: снимаем те, у которых вышел срок. Каждые пять минут — так же,
  // как техработы: человек, отсидевший сутки, не должен ждать до ночного прогона.
  @Cron('*/5 * * * *', { name: 'liftExpiredBlocks' })
  async liftExpiredBlocks(): Promise<number | null> {
    return this.locks.run('liftExpiredBlocks', LOCK_TTL_MS.liftExpiredBlocks, () =>
      this.liftExpiredBlocksTask(),
    )
  }

  private async liftExpiredBlocksTask(): Promise<number> {
    const now = new Date()
    let total = 0
    for (;;) {
      const batch = await this.prisma.user.findMany({
        where: { isBlocked: true, blockedUntil: { lte: now } },
        select: { id: true },
        take: BATCH_SIZE,
      })
      if (batch.length === 0) break
      const ids = batch.map((row) => row.id)
      const { count } = await this.prisma.user.updateMany({
        where: { id: { in: ids } },
        data: { isBlocked: false, blockedUntil: null },
      })
      total += count
      // Снятие блокировки — событие того же веса, что и сама блокировка: без записи в
      // журнале человек «разблокировался сам», и через месяц никто не объяснит, почему.
      for (const id of ids) {
        await this.audit.record({ action: 'user_unblocked_expired', entity: 'User', entityId: id })
      }
      if (batch.length < BATCH_SIZE) break
    }
    if (total > 0) this.logger.log(`liftExpiredBlocks: снято блокировок ${total}`)
    return total
  }

  // Передача дежурства: по понедельникам в 9 утра дежурным становится следующий в
  // очереди. Раньше дежурного назначали руками — то есть он оставался прежним, пока
  // кто-нибудь не вспоминал, что дежурит уже месяц. Девять утра — по часам команды, а не
  // сервера: в UTC смена приходилась на 14:00 по Алматы.
  @Cron('0 9 * * 1', { name: 'rotateDuty', timeZone: PLATFORM_TIME_ZONE })
  async rotateDuty(): Promise<string | null> {
    return this.locks.run('rotateDuty', LOCK_TTL_MS.rotateDuty, async () => {
      const next = await this.platform.rotateDuty()
      if (next) this.logger.log('rotateDuty: дежурство передано следующему')
      return next
    })
  }

  // Просроченные PENDING-инвайты → EXPIRED. Ежечасно.
  @Cron('0 * * * *', { name: 'expireInvites' })
  async expireInvites(): Promise<number | null> {
    return this.locks.run('expireInvites', LOCK_TTL_MS.expireInvites, () =>
      this.expireInvitesTask(),
    )
  }

  private async expireInvitesTask(): Promise<number> {
    const now = new Date()
    let total = 0
    for (;;) {
      const batch = await this.prisma.invite.findMany({
        where: { status: InviteStatus.PENDING, expiresAt: { lt: now } },
        select: { id: true },
        take: BATCH_SIZE,
      })
      if (batch.length === 0) break
      // Статус — и в WHERE записи: инвайт, занятый регистрацией между выборкой и записью
      // (USED), иначе переписывался бы в EXPIRED при живом пользователе.
      const expired = await this.prisma.invite.updateManyAndReturn({
        where: { id: { in: batch.map((b) => b.id) }, status: InviteStatus.PENDING },
        data: { status: InviteStatus.EXPIRED },
        select: { id: true },
      })
      total += expired.length
      // Истечение инвайта — в журнал (BACKEND_RULES §7): одна сводная запись на пачку,
      // id — только реально истёкших.
      if (expired.length > 0) {
        await this.audit.record({
          action: 'invites_expired',
          entity: 'Invite',
          metadata: { count: expired.length, inviteIds: expired.map((row) => row.id) },
        })
      }
      if (batch.length < BATCH_SIZE) break
    }
    this.logger.log(`expireInvites: помечено EXPIRED ${total}`)
    return total
  }

  // Ссылки сброса пароля, истёкшие или использованные больше суток назад. Ежедневно, 03:15.
  // Сутки запаса — чтобы по свежей строке можно было разобрать жалобу «ссылка не сработала».
  @Cron('15 3 * * *', { name: 'purgePasswordResetTokens' })
  async purgePasswordResetTokens(): Promise<number | null> {
    return this.locks.run('purgePasswordResetTokens', LOCK_TTL_MS.purgePasswordResetTokens, () =>
      this.purgePasswordResetTokensTask(),
    )
  }

  private async purgePasswordResetTokensTask(): Promise<number> {
    const cutoff = new Date(Date.now() - DAY_MS)
    const total = await this.deleteInBatches(
      () =>
        this.prisma.passwordResetToken.findMany({
          where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] },
          select: { id: true },
          take: BATCH_SIZE,
        }),
      (ids) => this.prisma.passwordResetToken.deleteMany({ where: { id: { in: ids } } }),
    )
    this.logger.log(`purgePasswordResetTokens: удалено ${total}`)
    return total
  }

  // Refresh-сессии, истёкшие больше суток назад. Ежечасно, в :25. Без этой задачи таблица
  // росла вечно: каждый refresh добавляет строку, а старая лишь помечается `revokedAt`.
  @Cron('25 * * * *', { name: 'purgeRefreshTokens' })
  async purgeRefreshTokens(): Promise<number | null> {
    return this.locks.run('purgeRefreshTokens', LOCK_TTL_MS.purgeRefreshTokens, () =>
      this.purgeRefreshTokensTask(),
    )
  }

  /**
   * Критерий — только срок, а не `revokedAt`, и это намеренно. Погашенный токен живой цепочки —
   * улика для детектора повтора (BACKEND_RULES §6.2): укравший токен ротирует его первым, а
   * жертва, вернувшись через неделю со старой cookie, предъявляет погашенный — и цепочка вора
   * рвётся. Удали мы погашенные через сутки, жертва получила бы «сессия не найдена», а сессия
   * вора жила бы дальше. Строка перестаёт быть нужна, когда истекла и cookie с ней — после
   * `expiresAt`; сутки сверху — запас на разбор жалоб «выкинуло из системы».
   *
   * Размер таблицы так ограничен сроком жизни refresh (30 дней ротаций), а не растёт вечно.
   */
  private async purgeRefreshTokensTask(): Promise<number> {
    const cutoff = new Date(Date.now() - DAY_MS)
    const total = await this.deleteInBatches(
      () =>
        this.prisma.refreshToken.findMany({
          where: { expiresAt: { lt: cutoff } },
          select: { id: true },
          take: BATCH_SIZE,
        }),
      (ids) => this.prisma.refreshToken.deleteMany({ where: { id: { in: ids } } }),
      REFRESH_TOKEN_PURGE_MAX_BATCHES,
    )
    this.logger.log(`purgeRefreshTokens: удалено ${total}`)
    return total
  }

  // Прочитанные уведомления старше 30 дней, непрочитанные — старше 90. Еженедельно (вс, 02:00).
  @Cron('0 2 * * 0', { name: 'cleanOldNotifications' })
  async cleanOldNotifications(): Promise<number | null> {
    return this.locks.run('cleanOldNotifications', LOCK_TTL_MS.cleanOldNotifications, () =>
      this.cleanOldNotificationsTask(),
    )
  }

  private async cleanOldNotificationsTask(): Promise<number> {
    // Два прохода, а не OR: каждый идёт своим диапазоном индекса [isRead, createdAt].
    let total = 0
    for (const [isRead, days] of [
      [true, NOTIFICATION_RETENTION_DAYS],
      [false, UNREAD_NOTIFICATION_RETENTION_DAYS],
    ] as const) {
      const cutoff = new Date(Date.now() - days * DAY_MS)
      total += await this.deleteInBatches(
        () =>
          this.prisma.notification.findMany({
            where: { isRead, createdAt: { lt: cutoff } },
            select: { id: true },
            take: BATCH_SIZE,
          }),
        // Условие повторяем: свёрнутое уведомление могло подняться между выборкой и удалением.
        (ids) =>
          this.prisma.notification.deleteMany({
            where: { id: { in: ids }, isRead, createdAt: { lt: cutoff } },
          }),
      )
    }
    this.logger.log(`cleanOldNotifications: удалено ${total}`)
    return total
  }

  // AuditLog старше 90 дней. Раз в месяц (1-е число, 01:00).
  @Cron('0 1 1 * *', { name: 'cleanAuditLogs' })
  async cleanAuditLogs(): Promise<number | null> {
    return this.locks.run('cleanAuditLogs', LOCK_TTL_MS.cleanAuditLogs, () =>
      this.cleanAuditLogsTask(),
    )
  }

  private async cleanAuditLogsTask(): Promise<number> {
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * DAY_MS)
    const total = await this.deleteInBatches(
      () =>
        this.prisma.auditLog.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take: BATCH_SIZE,
        }),
      (ids) => this.prisma.auditLog.deleteMany({ where: { id: { in: ids } } }),
    )
    this.logger.log(`cleanAuditLogs: удалено ${total}`)
    return total
  }

  // Записи File, потерявшие владельца. Ежедневно, 03:45 — перед чисткой сирот.
  @Cron('45 3 * * *', { name: 'cleanDetachedFiles' })
  async cleanDetachedFiles(): Promise<number | null> {
    return this.locks.run('cleanDetachedFiles', LOCK_TTL_MS.cleanDetachedFiles, () =>
      this.cleanDetachedFilesTask(),
    )
  }

  /**
   * Связь вложений чатов и файлов материалов с владельцем (`messageId`, `materialId`)
   * объявлена `onDelete: SetNull`. Удалили чат или материал — строка File остаётся без
   * владельца, и `cleanOrphanFiles` её объект не трогает: он убирает только объекты БЕЗ
   * строки. Так вложения удалённых чатов лежали в хранилище вечно.
   *
   * Здесь удаляются такие строки; их объекты (и варианты медиа — они сверяются по живой
   * строке-владельцу) снимет `cleanOrphanFiles` в 04:00. Цели уборки:
   * - вложения чата без сообщения и файлы материалов без материала;
   * - вложения сообщений, удалённых «для всех» больше DELETED_MESSAGE_FILES_RETENTION_DAYS
   *   назад (F-F21): мягкое удаление скрывало файл, но байты хранились бессрочно;
   * - загрузки в бакеты постов, сторис и заявок, так и не привязанные ни к чему за сутки
   *   (F-F21, E-F15): «загрузил — пост не создал»;
   * - медиа постов, удалённых больше DELETED_POST_MEDIA_RETENTION_DAYS назад (E-F15), — если
   *   на файл не ссылается ничто другое (сторис, альбом);
   * - сканы документов, удалённых больше DELETED_DOCUMENT_FILES_RETENTION_DAYS назад, и
   *   сканы, не привязанные к документу за DETACHED_DOCUMENT_UPLOAD_DAYS (D-F21).
   * Аватары и медиа профиля сюда не входят: там строка без связей — норма.
   *
   * Вложение чата живёт без `messageId` и законно: чат сначала принимает все файлы
   * сообщения и только потом одной транзакцией заводит сообщение и привязывает их (отказ
   * любого файла не оставляет пустого сообщения). Свежие строки поэтому не трогаем — иначе
   * чистка, пришедшаяся на этот миг, срывала бы отправку. Условие цели повторяется и в
   * самом удалении: строку могли привязать между выборкой и DELETE.
   */
  private async cleanDetachedFilesTask(): Promise<number> {
    const now = Date.now()
    const chatBucket = this.config.get('MINIO_BUCKET_CHAT', { infer: true })
    const documentsBucket = this.config.get('MINIO_BUCKET_DOCUMENTS', { infer: true })
    const targets: Prisma.FileWhereInput[] = [
      {
        bucket: chatBucket,
        messageId: null,
        createdAt: { lt: new Date(now - DETACHED_CHAT_FILE_SAFETY_MINUTES * 60 * 1000) },
      },
      { bucket: this.config.get('MINIO_BUCKET_MATERIALS', { infer: true }), materialId: null },
      {
        bucket: chatBucket,
        message: {
          deletedAt: { lt: new Date(now - DELETED_MESSAGE_FILES_RETENTION_DAYS * DAY_MS) },
        },
      },
      {
        bucket: {
          in: [
            this.config.get('MINIO_BUCKET_POSTS', { infer: true }),
            this.config.get('MINIO_BUCKET_STORIES', { infer: true }),
            this.config.get('MINIO_BUCKET_APPLICATIONS', { infer: true }),
          ],
        },
        createdAt: { lt: new Date(now - DETACHED_UPLOAD_TTL_HOURS * 60 * 60 * 1000) },
        ...NO_OWNER_WHERE,
      },
      {
        bucket: this.config.get('MINIO_BUCKET_POSTS', { infer: true }),
        post: { deletedAt: { lt: new Date(now - DELETED_POST_MEDIA_RETENTION_DAYS * DAY_MS) } },
        ...NO_OWNER_BUT_POST_WHERE,
      },
      {
        bucket: documentsBucket,
        document: {
          deletedAt: { lt: new Date(now - DELETED_DOCUMENT_FILES_RETENTION_DAYS * DAY_MS) },
        },
      },
      {
        bucket: documentsBucket,
        createdAt: { lt: new Date(now - DETACHED_DOCUMENT_UPLOAD_DAYS * DAY_MS) },
        ...NO_OWNER_WHERE,
      },
    ]
    let total = 0
    for (const where of targets) {
      total += await this.deleteInBatches(
        () => this.prisma.file.findMany({ where, select: { id: true }, take: BATCH_SIZE }),
        (ids) => this.prisma.file.deleteMany({ where: { id: { in: ids }, ...where } }),
        DETACHED_FILES_MAX_BATCHES,
      )
    }
    this.logger.log(`cleanDetachedFiles: удалено записей ${total}`)
    return total
  }

  // Токены устройств: давно не подтверждённые и принадлежащие удалённым аккаунтам.
  // Ежедневно, 03:50 — после уборки файлов, в тихий час.
  @Cron('50 3 * * *', { name: 'purgeDeviceTokens' })
  async purgeDeviceTokens(): Promise<number | null> {
    return this.locks.run('purgeDeviceTokens', LOCK_TTL_MS.purgeDeviceTokens, () =>
      this.purgeDeviceTokensTask(),
    )
  }

  /**
   * Схема обещала чистку токенов по `lastSeenAt`, но ни одна задача её не делала (F-F25):
   * таблица копила телефоны, с которых годами не заходили, и каждый пуш стучался в них.
   *
   * Удаляются: токены телефонов, не подтверждённые DEVICE_TOKEN_STALE_DAYS дней, и
   * адреса пушей (телефоны и браузеры) удалённых аккаунтов — уведомления им не уходят
   * (процессор отсекает удалённых), а адрес устройства — это персональные данные.
   * Заблокированных не трогаем: блокировка бывает временной, и снятый с неё человек
   * остался бы без пушей до переустановки, а повторная привязка заново включила бы ему
   * выключенные пуши (PushService.registerDevice).
   */
  private async purgeDeviceTokensTask(): Promise<number> {
    const deviceWhere: Prisma.DeviceTokenWhereInput = {
      OR: [
        { lastSeenAt: { lt: new Date(Date.now() - DEVICE_TOKEN_STALE_DAYS * DAY_MS) } },
        { user: { deletedAt: { not: null } } },
      ],
    }
    const devices = await this.deleteInBatches(
      () =>
        this.prisma.deviceToken.findMany({
          where: deviceWhere,
          select: { id: true },
          take: BATCH_SIZE,
        }),
      // Условие повторяем: приложение могло подтвердить токен между выборкой и удалением.
      (ids) => this.prisma.deviceToken.deleteMany({ where: { id: { in: ids }, ...deviceWhere } }),
    )
    const subscriptionWhere: Prisma.PushSubscriptionWhereInput = {
      user: { deletedAt: { not: null } },
    }
    const subscriptions = await this.deleteInBatches(
      () =>
        this.prisma.pushSubscription.findMany({
          where: subscriptionWhere,
          select: { id: true },
          take: BATCH_SIZE,
        }),
      (ids) =>
        this.prisma.pushSubscription.deleteMany({
          where: { id: { in: ids }, ...subscriptionWhere },
        }),
    )
    this.logger.log(
      `purgeDeviceTokens: удалено токенов телефонов ${devices}, подписок браузеров ${subscriptions}`,
    )
    return devices + subscriptions
  }

  // Объекты MinIO без записи в File. Ежедневно, 04:00.
  @Cron('0 4 * * *', { name: 'cleanOrphanFiles' })
  async cleanOrphanFiles(): Promise<number | null> {
    return this.locks.run('cleanOrphanFiles', LOCK_TTL_MS.cleanOrphanFiles, () =>
      this.cleanOrphanFilesTask(),
    )
  }

  private async cleanOrphanFilesTask(): Promise<number> {
    // Все бакеты, а не четыре исторических: с прямой загрузкой вложений чата (Ф19.0) объект
    // попадает в `chat-media` ДО создания сообщения, и не дошедшая до отправки загрузка
    // осталась бы там навсегда — этот бакет в списке не значился.
    const buckets = this.mediaBuckets()
    const safetyBefore = new Date(Date.now() - ORPHAN_SAFETY_MINUTES * 60 * 1000)
    let removed = 0

    for (const bucket of buckets) {
      try {
        removed += await this.sweepOrphansInBucket(bucket, safetyBefore)
      } catch (err) {
        // MinIO недоступен/бакета нет — логируем и продолжаем (graceful degradation).
        this.logger.warn(`cleanOrphanFiles: бакет ${bucket} пропущен: ${(err as Error).message}`)
      }
    }
    this.logger.log(`cleanOrphanFiles: удалено осиротевших объектов ${removed}`)
    return removed
  }

  /**
   * Сироты одного бакета — по ходу чтения листинга, порциями по BATCH_SIZE.
   *
   * Листинг в память целиком не собирается: в медиа-бакетах у каждого видео постер и
   * рендишны HLS по сотне-другой сегментов, и у бакета с тысячами видео это миллионы
   * объектов — массив на них стоил бы сотен мегабайт кучи процессу, который в это же время
   * обслуживает HTTP и WS. `for await` тянет поток по мере разбора: следующую страницу
   * листинга MinIO отдаёт, когда разобрана текущая порция, так что в памяти — одна порция.
   */
  private async sweepOrphansInBucket(bucket: string, safetyBefore: Date): Promise<number> {
    // Вердикт «жив ли файл-владелец» для вариантов, переносимый между порциями.
    const variantOwners = new Map<string, boolean>()
    let chunk: string[] = []
    let removed = 0
    const stream = this.minio.listObjectsV2(bucket, '', true)
    for await (const obj of stream as AsyncIterable<{ name?: string; lastModified?: Date }>) {
      // Только объекты старше окна безопасности (не мешаем незавершённым загрузкам).
      if (!obj.name || (obj.lastModified ?? new Date(0)) >= safetyBefore) continue
      chunk.push(obj.name)
      if (chunk.length < BATCH_SIZE) continue
      removed += await this.removeOrphans(bucket, chunk, variantOwners)
      chunk = []
    }
    if (chunk.length > 0) removed += await this.removeOrphans(bucket, chunk, variantOwners)
    return removed
  }

  /**
   * Из порции ключей удаляет объекты, на которые никто не ссылается, одним запросом
   * `removeObjects`. Возвращает число действительно удалённых.
   *
   * Варианты (`variants/<fileId>/…`) сверяются по владельцу, остальные ключи — по `File.key`
   * и вспомогательным ссылкам: у варианта своей строки File нет, и гонять сотни ключей
   * сегментов через `key IN (…)` незачем.
   */
  private async removeOrphans(
    bucket: string,
    names: string[],
    variantOwners: Map<string, boolean>,
  ): Promise<number> {
    const plain = names.filter((name) => variantOwnerId(name) === null)
    const known = new Set<string>()
    if (plain.length > 0) {
      const existing = await this.prisma.file.findMany({
        where: { bucket, key: { in: plain } },
        select: { key: true },
        take: plain.length,
      })
      for (const e of existing) known.add(e.key)
      for (const key of await this.auxReferencedKeys(bucket, plain)) known.add(key)
    }
    for (const key of await this.liveVariantKeys(bucket, names, variantOwners)) known.add(key)

    const orphans = names.filter((name) => !known.has(name))
    if (orphans.length === 0) return 0
    // Ответ в «тихом» режиме — только ключи, которые удалить не удалось.
    const failed = (await this.minio.removeObjects(bucket, orphans)).filter(Boolean)
    if (failed.length > 0) {
      this.logger.warn(
        `cleanOrphanFiles: в ${bucket} не удалено ${failed.length} из ${orphans.length} объектов`,
      )
    }
    return orphans.length - failed.length
  }

  // Брошенные многочастные загрузки (Фаза 19). Ежедневно, 04:30 — следом за чисткой сирот.
  @Cron('30 4 * * *', { name: 'sweepIncompleteUploads' })
  async sweepIncompleteUploads(): Promise<number | null> {
    return this.locks.run('sweepIncompleteUploads', LOCK_TTL_MS.sweepIncompleteUploads, () =>
      this.sweepIncompleteUploadsTask(),
    )
  }

  /**
   * Отменить многочастные загрузки, начатые больше суток назад.
   *
   * Почему отдельной задачей, а не внутри `cleanOrphanFiles`: тот перечисляет ОБЪЕКТЫ, а
   * незавершённая загрузка объектом ещё не стала — её части лежат в хранилище отдельно и в
   * листинге не показываются. Найти их можно только запросом списка загрузок.
   *
   * Это второй рубеж. Первый — правило `AbortIncompleteMultipartUpload` на самом бакете:
   * оно работает, даже когда приложение лежит. Дублирование намеренное — место кончается
   * молча, и заметно это становится, когда уже поздно.
   */
  private async sweepIncompleteUploadsTask(): Promise<number> {
    const buckets = this.mediaBuckets()
    const before = new Date(Date.now() - INCOMPLETE_UPLOAD_TTL_HOURS * 60 * 60 * 1000)
    let aborted = 0

    for (const bucket of buckets) {
      try {
        let keyMarker = ''
        let uploadIdMarker = ''
        for (;;) {
          // Постраничный запрос, а не поток `listIncompleteUploads`: тот отдаёт только ключ,
          // uploadId и размер, а нам нужна дата начала — без неё свежую загрузку не отличить
          // от брошенной, и мы бы рвали то, что прямо сейчас грузится.
          const page = await this.minio.listIncompleteUploadsQuery(
            bucket,
            '',
            keyMarker,
            uploadIdMarker,
            '',
          )
          for (const upload of page.uploads) {
            if (upload.initiated >= before) continue
            await this.minio.abortMultipartUpload(bucket, upload.key, upload.uploadId)
            aborted += 1
          }
          if (!page.isTruncated) break
          keyMarker = page.nextKeyMarker
          uploadIdMarker = page.nextUploadIdMarker
        }
      } catch (err) {
        // MinIO недоступен/бакета нет — логируем и продолжаем (graceful degradation).
        this.logger.warn(
          `sweepIncompleteUploads: бакет ${bucket} пропущен: ${(err as Error).message}`,
        )
      }
    }
    this.logger.log(`sweepIncompleteUploads: отменено брошенных загрузок ${aborted}`)
    return aborted
  }

  /**
   * Ключи из `keys`, на которые ссылаются НЕ через `File.key`.
   *
   * В `profile-covers` `putAuxImage` кладёт объекты без записи File: постер видео профиля
   * (его ключ — в `File.posterKey`) и обложку пользователя (в `User.coverUrl` хранится
   * публичный URL, ключ — его последний сегмент). Без этой сверки чистка удаляла их через
   * час после загрузки. Сравниваем по окончанию URL, а не по целому адресу: домен MinIO
   * мог смениться, и старые URL с прежним хостом всё равно указывают на живой объект.
   */
  private async auxReferencedKeys(bucket: string, keys: string[]): Promise<string[]> {
    if (bucket !== this.config.get('MINIO_BUCKET_PROFILE_COVERS', { infer: true })) return []
    if (keys.length === 0) return []
    const [posters, covers] = await Promise.all([
      this.prisma.file.findMany({
        where: { posterKey: { in: keys } },
        select: { posterKey: true },
        take: keys.length,
      }),
      this.prisma.user.findMany({
        where: { OR: keys.map((key) => ({ coverUrl: { endsWith: `/${key}` } })) },
        select: { coverUrl: true },
        take: keys.length,
      }),
    ])
    const referenced: string[] = []
    for (const p of posters) if (p.posterKey) referenced.push(p.posterKey)
    for (const c of covers) {
      const key = c.coverUrl?.split('?')[0]?.split('/').pop()
      if (key) referenced.push(key)
    }
    return referenced
  }

  /**
   * Варианты медиа (`variants/<fileId>/…`) из `keys`, чья запись File ещё жива.
   *
   * У вариантов нет своей строки на каждый объект (сегментов HLS — сотни), владелец читается
   * из префикса ключа. Запись удалена, а префикс остался (удаление вариантов best-effort) —
   * объекты становятся сиротами и уходят здесь же.
   *
   * `verdicts` — память между порциями одного бакета: база спрашивается один раз на файл,
   * а не на каждый сегмент. Листинг идёт по возрастанию ключа, варианты одного файла лежат
   * подряд, и продолжиться в следующей порции может только префикс последнего владельца —
   * его вердикт и переносится, остальные забываются, чтобы память не росла с бакетом.
   */
  private async liveVariantKeys(
    bucket: string,
    keys: string[],
    verdicts: Map<string, boolean>,
  ): Promise<string[]> {
    const owners = new Map<string, string>()
    let last: string | null = null
    for (const key of keys) {
      const owner = variantOwnerId(key)
      if (!owner) continue
      owners.set(key, owner)
      last = owner
    }
    if (last === null) return []
    const unknown = [...new Set(owners.values())].filter((id) => !verdicts.has(id))
    if (unknown.length > 0) {
      const alive = await this.prisma.file.findMany({
        where: { bucket, id: { in: unknown } },
        select: { id: true },
        take: unknown.length,
      })
      const aliveIds = new Set(alive.map((f) => f.id))
      for (const id of unknown) verdicts.set(id, aliveIds.has(id))
    }
    const live = [...owners].filter(([, owner]) => verdicts.get(owner)).map(([key]) => key)

    const lastAlive = verdicts.get(last) ?? false
    verdicts.clear()
    verdicts.set(last, lastAlive)
    return live
  }

  /**
   * Догонялка медиа-обработки, каждые 10 минут: задачи, не дошедшие до очереди (постановка
   * best effort), и файлы, загруженные до появления медиа-системы (backfill, свежие первыми).
   * Сама обработка — в воркере; здесь только постановка, по 200 файлов за проход.
   */
  @Cron('*/10 * * * *', { name: 'resumeMediaProcessing' })
  async resumeMediaProcessing(): Promise<{ resumed: number; backfilled: number } | null> {
    return this.locks.run('resumeMediaProcessing', LOCK_TTL_MS.resumeMediaProcessing, async () => {
      const result = await this.media.resumeAndBackfill()
      this.logger.log(
        `resumeMediaProcessing: возвращено в очередь ${result.resumed}, поставлено впервые ${result.backfilled}`,
      )
      return result
    })
  }

  /**
   * Все бакеты с пользовательскими медиа. Многочастная загрузка возможна в любой из них,
   * поэтому список шире, чем у `cleanOrphanFiles` (тот исторически знает только четыре —
   * его расширение это отдельная задача, а не побочный эффект этой).
   */
  private mediaBuckets(): string[] {
    return [
      this.config.get('MINIO_BUCKET_AVATARS', { infer: true }),
      this.config.get('MINIO_BUCKET_POSTS', { infer: true }),
      this.config.get('MINIO_BUCKET_STORIES', { infer: true }),
      this.config.get('MINIO_BUCKET_APPLICATIONS', { infer: true }),
      this.config.get('MINIO_BUCKET_CHAT', { infer: true }),
      this.config.get('MINIO_BUCKET_MATERIALS', { infer: true }),
      this.config.get('MINIO_BUCKET_DOCUMENTS', { infer: true }),
      this.config.get('MINIO_BUCKET_PROFILE_MEDIA', { infer: true }),
      this.config.get('MINIO_BUCKET_PROFILE_COVERS', { infer: true }),
    ]
  }

  // Ежедневная сводка команде платформы. Ежечасно, а отправляет только в тот час,
  // который админ выбрал: хранить расписание в cron-выражении значило бы перезапускать
  // приложение ради смены времени.
  @Cron('5 * * * *', { name: 'sendDailyDigest' })
  async sendDailyDigest(): Promise<number | null> {
    return this.locks.run('sendDailyDigest', LOCK_TTL_MS.sendDailyDigest, () =>
      this.sendDailyDigestTask(),
    )
  }

  private async sendDailyDigestTask(): Promise<number> {
    const policy = await this.platform.notificationPolicy()
    // Час — по поясу платформы: «сводка утром» по часам сервера приходила в 14:05 по Алматы.
    if (policy.digestHour === null || policy.digestHour !== platformHour(new Date())) return 0

    // Числа спрашиваем у модулей-владельцев, а не считаем здесь: тот же ответ отдаёт
    // команда бота `/queue`, и две копии запроса разошлись бы при первой же правке
    // набора статусов «в очереди».
    const since = new Date(Date.now() - DAY_MS)
    const [complaints, tickets, complaintsDay, ticketsDay, duty] = await Promise.all([
      this.complaints.queueStats(),
      this.support.queueStats(),
      this.complaints.dayStats(since),
      this.support.dayStats(since),
      this.platform.duty(),
    ])

    // Сводку шлём, даже когда всё разобрано: «ноль и ноль» — это тоже новость, и по её
    // отсутствию нельзя отличить спокойный день от сломавшейся отправки. Текст собирает
    // общая функция: ту же сводку отдаёт команда бота `/digest`.
    await this.telegram.notifyStaff(
      'digest',
      digestText({
        complaints: { ...complaints, ...complaintsDay },
        tickets: { ...tickets, ...ticketsDay },
        dutyName: await this.dutyName(duty.dutyUserId),
      }),
    )
    this.logger.log(`sendDailyDigest: жалоб ${complaints.count}, обращений ${tickets.count}`)
    return 1
  }

  /** Имя дежурного для сводки. Только команда платформы — тех, о ком жалуются, здесь нет. */
  private async dutyName(userId: string | null): Promise<string | null> {
    if (!userId) return null
    const user = await this.prisma.user
      .findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } })
      .catch(() => null)
    return user ? `${user.firstName} ${user.lastName}`.trim() : null
  }

  // Очередь жалоб выросла сверх порога. Ежечасно, с паузой между сигналами.
  @Cron('15 * * * *', { name: 'alertQueueBacklog' })
  async alertQueueBacklog(): Promise<number | null> {
    return this.locks.run('alertQueueBacklog', LOCK_TTL_MS.alertQueueBacklog, () =>
      this.alertQueueBacklogTask(),
    )
  }

  private async alertQueueBacklogTask(): Promise<number> {
    const { count: pending, oldestAt } = await this.complaints.queueStats()
    if (pending < QUEUE_BACKLOG_THRESHOLD) {
      // Очередь разгребли — снимаем паузу, чтобы следующий всплеск не пропустить.
      await this.redis.del(QUEUE_BACKLOG_KEY).catch(() => undefined)
      return 0
    }

    // SET NX: между инстансами побеждает один, и повторного сигнала не будет даже если
    // задача каким-то образом выполнится дважды.
    const first = await this.redis
      .set(QUEUE_BACKLOG_KEY, String(pending), 'EX', QUEUE_BACKLOG_SILENCE_SEC, 'NX')
      .catch(() => null)
    if (first === null) return 0

    // С возрастом самого старого: «накопилось десять» за час и «накопилось десять» за
    // трое суток — разные поводы, а сигнал был один и тот же.
    await this.telegram.notifyStaff(
      'complaint',
      [
        `В очереди накопилось жалоб: ${pending}`,
        ...(oldestAt ? [`Старейшая ждёт: ${humanAge(Date.now() - oldestAt.getTime())}`] : []),
      ].join('\n'),
    )
    this.logger.log(`alertQueueBacklog: жалоб ${pending}`)
    return pending
  }

  // Неподтверждённые заявки вузов. Ежедневно в 04:30, до уборки обращений.
  //
  // Пока такая заявка жива, она занимает адрес: подать новую с него нельзя. Плюс в ней
  // лежат персональные данные из публичной формы, которые никто не подтвердил.
  @Cron('30 4 * * *', { name: 'purgeUnconfirmedDemoRequests' })
  async purgeUnconfirmedDemoRequests(): Promise<number | null> {
    return this.locks.run(
      'purgeUnconfirmedDemoRequests',
      LOCK_TTL_MS.purgeUnconfirmedDemoRequests,
      async () => {
        const removed = await this.demoRequests.purgeUnconfirmed(
          new Date(Date.now() - DEMO_REQUEST_UNCONFIRMED_DAYS * DAY_MS),
        )
        this.logger.log(`purgeUnconfirmedDemoRequests: удалено ${removed}`)
        return removed
      },
    )
  }

  // Допуски компаний к вузам с истёкшим сроком → REVOKED с каскадом на вакансии. Ежечасно,
  // в :40. Доступ к студентам по сроку закрывается и без задачи (проверка в каждом запросе),
  // она приводит в порядок состояние: решения по вакансиям, статус у компании, сводки вуза.
  // Логика — в CompaniesService.expireAccess (владелец домена).
  @Cron('40 * * * *', { name: 'expireCompanyAccess' })
  async expireCompanyAccess(): Promise<number | null> {
    return this.locks.run('expireCompanyAccess', LOCK_TTL_MS.expireCompanyAccess, () =>
      this.companies.expireAccess(),
    )
  }

  // Заявки с истёкшим сроком обработки (SLA): каждому обработчику — сводка с числом его
  // просроченных. Раньше просрочка была только фильтром очереди и молча копилась. Ежедневно
  // в 09:00 по часам команды — к началу рабочего дня деканатов. Логика — в
  // ApplicationNotifier.notifyOverdue (владелец домена).
  @Cron('0 9 * * *', { name: 'notifyOverdueApplications', timeZone: PLATFORM_TIME_ZONE })
  async notifyOverdueApplications(): Promise<number | null> {
    return this.locks.run('notifyOverdueApplications', LOCK_TTL_MS.notifyOverdueApplications, () =>
      this.applications.notifyOverdue(),
    )
  }

  // ── Сроки хранения ПДн (docs/PERSONAL_DATA.md §4) ──────────────────────────
  //
  // Год после того, как цель обработки достигнута. Логика — в PdRetentionService, здесь
  // расписание и локи. Все задачи — ночью, раньше cleanDetachedFiles (03:45) и
  // cleanOrphanFiles (04:00): объекты MinIO удалённых строк File снимаются той же ночью.
  //
  // Предохранитель PD_RETENTION_ENABLED (по умолчанию выключен): без него задачи всё равно
  // идут по расписанию, но только считают и пишут в лог, сколько удалили бы. Так цифры видны
  // заранее, а включение — осознанное действие (docs/RUNBOOK.md).

  // Закрытые выдачи книг — год после возврата, утери или отмены. Ежедневно, 02:05.
  @Cron('5 2 * * *', { name: 'purgeClosedLoans' })
  async purgeClosedLoans(): Promise<RetentionCounts | null> {
    return this.locks.run('purgeClosedLoans', LOCK_TTL_MS.purgeClosedLoans, () =>
      this.retention.purgeClosedLoans(this.pdRetentionDryRun()),
    )
  }

  // Журналы просмотров удостоверений и камер — год после записи. Ежедневно, 02:10.
  @Cron('10 2 * * *', { name: 'purgeViewLogs' })
  async purgeViewLogs(): Promise<RetentionCounts | null> {
    return this.locks.run('purgeViewLogs', LOCK_TTL_MS.purgeViewLogs, () =>
      this.retention.purgeViewLogs(this.pdRetentionDryRun()),
    )
  }

  // Оценки, экзамены, посещаемость, сдачи ушедшего студента — год после ухода. 02:20.
  @Cron('20 2 * * *', { name: 'purgeDepartedAcademicRecords' })
  async purgeDepartedAcademicRecords(): Promise<RetentionCounts | null> {
    return this.locks.run(
      'purgeDepartedAcademicRecords',
      LOCK_TTL_MS.purgeDepartedAcademicRecords,
      () => this.retention.purgeDepartedAcademicRecords(this.pdRetentionDryRun()),
    )
  }

  // Заявки и ответы на запросы документов ушедшего студента — год после ухода. 02:30.
  @Cron('30 2 * * *', { name: 'purgeDepartedApplications' })
  async purgeDepartedApplications(): Promise<RetentionCounts | null> {
    return this.locks.run('purgeDepartedApplications', LOCK_TTL_MS.purgeDepartedApplications, () =>
      this.retention.purgeDepartedApplications(this.pdRetentionDryRun()),
    )
  }

  // Сообщения ушедшего студента и вложения к ним — год после ухода. 02:40.
  @Cron('40 2 * * *', { name: 'purgeDepartedMessages' })
  async purgeDepartedMessages(): Promise<RetentionCounts | null> {
    return this.locks.run('purgeDepartedMessages', LOCK_TTL_MS.purgeDepartedMessages, () =>
      this.retention.purgeDepartedMessages(this.pdRetentionDryRun()),
    )
  }

  // Документы и сканы ушедшего студента — год после ухода. 02:50.
  @Cron('50 2 * * *', { name: 'purgeDepartedDocuments' })
  async purgeDepartedDocuments(): Promise<RetentionCounts | null> {
    return this.locks.run('purgeDepartedDocuments', LOCK_TTL_MS.purgeDepartedDocuments, () =>
      this.retention.purgeDepartedDocuments(this.pdRetentionDryRun()),
    )
  }

  // Профиль ушедшего студента — год после ухода, штатным удалением аккаунта. 03:00 —
  // последним: остальные задачи ищут его данные по дате ухода, а не по живому профилю.
  @Cron('0 3 * * *', { name: 'purgeDepartedProfiles' })
  async purgeDepartedProfiles(): Promise<RetentionCounts | null> {
    return this.locks.run('purgeDepartedProfiles', LOCK_TTL_MS.purgeDepartedProfiles, () =>
      this.retention.purgeDepartedProfiles(this.pdRetentionDryRun()),
    )
  }

  /**
   * Dry-run, пока флаг не включён явно. Сравнение строгое: всё, кроме настоящего `true`
   * (пропуск, опечатка, мок конфига в тесте), оставляет уборку считающей, а не удаляющей.
   */
  private pdRetentionDryRun(): boolean {
    return this.config.get('PD_RETENTION_ENABLED', { infer: true }) !== true
  }

  // Работодатели, не подтвердившие почту компании (D-F28). Ежедневно в 04:20.
  //
  // Пока такой аккаунт жив, он держит адрес: повторная регистрация на него молча ничего не
  // делает. Отбор и «захват» компании — у владельца домена (CompaniesService.purgeUnverified),
  // удаление аккаунтов — штатным путём (UserService.softDeleteSelf: анонимизация ПДн, снос
  // медиа, разлогин, запись в журнал). Отсюда он передаётся параметром: карьере тянуть
  // модуль пользователей нельзя — AuthModule уже импортирует CareerModule.
  @Cron('20 4 * * *', { name: 'purgeUnverifiedEmployers' })
  async purgeUnverifiedEmployers(): Promise<number | null> {
    // Удаляет аккаунты — только по явному флагу окружения (по умолчанию выключено).
    if (!this.config.get('CLEANUP_PURGE_UNVERIFIED_EMPLOYERS', { infer: true })) return null
    return this.locks.run(
      'purgeUnverifiedEmployers',
      LOCK_TTL_MS.purgeUnverifiedEmployers,
      async () => {
        const purged = await this.companies.purgeUnverified(
          new Date(Date.now() - EMPLOYER_UNVERIFIED_DAYS * DAY_MS),
          (userId) => this.users.softDeleteSelf(userId),
        )
        this.logger.log(`purgeUnverifiedEmployers: удалено компаний ${purged}`)
        return purged
      },
    )
  }

  // Обращения без движения. Ежедневно в 05:00, после уборки файлов.
  @Cron('0 5 * * *', { name: 'closeStaleTickets' })
  async closeStaleTickets(): Promise<number | null> {
    return this.locks.run('closeStaleTickets', LOCK_TTL_MS.closeStaleTickets, async () => {
      const closed = await this.support.closeStale(
        new Date(Date.now() - SUPPORT_STALE_DAYS * DAY_MS),
      )
      this.logger.log(`closeStaleTickets: закрыто ${closed}`)
      return closed
    })
  }

  /**
   * Живость зависимостей и всплеск ошибок. Каждые пять минут.
   *
   * Проверяются те же три зависимости, что и в `/health`, но своими клиентами: расписание
   * обязано жить здесь (§9.3), а тянуть сюда индикаторы terminus значило бы связать
   * уборку с модулем здоровья ради трёх строк.
   */
  @Cron('*/5 * * * *', { name: 'watchServices' })
  async watchServices(): Promise<number | null> {
    return this.locks.run('watchServices', LOCK_TTL_MS.watchServices, () => this.watchTask())
  }

  private async watchTask(): Promise<number> {
    const down: string[] = []
    await this.prisma.$queryRaw`SELECT 1`.catch(() => down.push('база данных'))
    await this.redis.ping().catch(() => down.push('Redis'))
    await this.minio
      .bucketExists(this.config.get('MINIO_BUCKET_AVATARS', { infer: true }))
      .catch(() => down.push('хранилище'))

    const wasDown = await this.wasServicesDown()
    if (down.length > 0 && !wasDown) {
      this.servicesDown = true
      this.servicesDownUnsynced = !(await this.redis
        .set(SERVICES_STATE_KEY, down.join(','), 'EX', DAY_MS / 1000)
        .then(() => true)
        .catch(() => false))
      await this.telegram.notifyStaff(
        'digest',
        `Не отвечает: ${down.join(', ')}`,
        undefined,
        new Date(),
        true,
      )
    } else if (down.length === 0 && wasDown) {
      this.servicesDown = false
      this.servicesDownUnsynced = false
      await this.redis.del(SERVICES_STATE_KEY).catch(() => undefined)
      await this.telegram.notifyStaff(
        'digest',
        'Все сервисы снова отвечают',
        undefined,
        new Date(),
        true,
      )
    }

    // Всплеск серверных ошибок за последний час.
    const errors = await countServerErrors(this.redis, 60)
    if (errors >= ERROR_SPIKE_THRESHOLD) {
      const first = await this.redis
        .set(ERROR_SPIKE_KEY, String(errors), 'EX', ERROR_SPIKE_SILENCE_SEC, 'NX')
        .catch(() => null)
      if (first !== null) {
        await this.telegram.notifyStaff('digest', `Всплеск ошибок: ${errors} за час`)
      }
    }

    if (down.length > 0) this.logger.warn(`watchServices: не отвечают ${down.join(', ')}`)
    return down.length
  }

  /**
   * Был ли объявлен сбой. Источник — Redis (общий для инстансов: «упало» объявляет один,
   * «поднялось» может объявить другой). Redis не отвечает — память процесса. Ответил, но
   * отметки нет, а процесс объявлял сбой, не сумев её записать (лежал сам Redis), — сбой
   * всё ещё объявлен: иначе «Все сервисы снова отвечают» после падения Redis не пришло бы.
   */
  private async wasServicesDown(): Promise<boolean> {
    const stored = await this.redis.get(SERVICES_STATE_KEY).then(
      (value) => value !== null,
      () => null,
    )
    if (stored === null) return this.servicesDown
    const wasDown = stored || this.servicesDownUnsynced
    this.servicesDown = wasDown
    return wasDown
  }

  // Занятое хранилище. Ежедневно в 04:45 — после уборки сирот и брошенных загрузок,
  // чтобы считать то, что осталось, а не то, что через минуту удалят.
  @Cron('45 4 * * *', { name: 'reportStorageUsage' })
  async reportStorageUsage(): Promise<number | null> {
    return this.locks.run('reportStorageUsage', LOCK_TTL_MS.reportStorageUsage, () =>
      this.reportStorageUsageTask(),
    )
  }

  /**
   * Сводка занятого места по бакетам и сигнал при превышении порога.
   *
   * Считаем по таблицам `File` и `FileVariant`, а не обходом бакетов: запись есть у каждого
   * объекта, который кому-то принадлежит, а перечисление девяти бакетов целиком — это
   * минуты работы и лишняя нагрузка на MinIO ради числа, которое уже лежит в базе.
   * Осиротевшие объекты в сумму не попадают, но их за полчаса до этого подмёл
   * `cleanOrphanFiles`.
   *
   * Варианты медиа — в той же сумме (F-F21): рендишны HLS, постеры и WebP-копии лежат в
   * бакете файла и по объёму сопоставимы с оригиналом. Без них порог STORAGE_ALERT_GB
   * срабатывал заметно позже реального заполнения тома.
   *
   * Возвращает суммарный объём в байтах — по нему видно движение в логе прогона.
   */
  private async reportStorageUsageTask(): Promise<number> {
    const [perBucket, variants] = await Promise.all([
      this.prisma.file.groupBy({ by: ['bucket'], _sum: { size: true } }),
      // Варианту своего бакета не положено — он живёт в бакете файла-владельца.
      this.prisma.$queryRaw<{ bucket: string; bytes: bigint | number | null }[]>`
        SELECT f."bucket" AS bucket, SUM(v."size")::bigint AS bytes
        FROM "file_variants" v
        JOIN "files" f ON f."id" = v."file_id"
        GROUP BY f."bucket"
      `,
    ])
    const byBucket = new Map<string, number>()
    for (const b of perBucket) byBucket.set(b.bucket, b._sum.size ?? 0)
    for (const v of variants) {
      byBucket.set(v.bucket, (byBucket.get(v.bucket) ?? 0) + Number(v.bytes ?? 0))
    }
    const rows = [...byBucket]
      .map(([bucket, bytes]) => ({ bucket, bytes }))
      .sort((a, b) => b.bytes - a.bytes)
    const bytes = rows.reduce((acc, r) => acc + r.bytes, 0)
    const detail = rows.map((r) => `${r.bucket} ${formatBytes(r.bytes)}`).join(', ')
    this.logger.log(`reportStorageUsage: всего ${formatBytes(bytes)} (${detail})`)

    const limitGb = this.config.get('STORAGE_ALERT_GB', { infer: true })
    if (!limitGb) return bytes

    if (bytes < limitGb * GB) {
      // Ушли под порог (место добавили или что-то удалили) — снимаем паузу, чтобы
      // следующий подход к порогу не пропустить.
      await this.redis.del(STORAGE_ALERT_KEY).catch(() => undefined)
      return bytes
    }

    // SET NX: между инстансами побеждает один, повторного сигнала не будет.
    const first = await this.redis
      .set(STORAGE_ALERT_KEY, String(bytes), 'EX', STORAGE_ALERT_SILENCE_SEC, 'NX')
      .catch(() => null)
    if (first === null) return bytes

    await this.telegram.notifyStaff(
      'digest',
      `Хранилище занято на ${formatBytes(bytes)} — порог ${limitGb} ГБ пройден\n${detail}`,
    )
    return bytes
  }

  /**
   * Удаление батчами по BATCH_SIZE: находим id → deleteMany → повторяем, пока есть записи.
   * `maxBatches` — потолок за один прогон; остаток доберёт следующий.
   */
  private async deleteInBatches(
    findBatch: () => Promise<{ id: string }[]>,
    deleteByIds: (ids: string[]) => Promise<{ count: number }>,
    maxBatches = Number.POSITIVE_INFINITY,
  ): Promise<number> {
    let total = 0
    for (let batches = 0; batches < maxBatches; batches++) {
      const batch = await findBatch()
      if (batch.length === 0) break
      const { count } = await deleteByIds(batch.map((b) => b.id))
      total += count
      if (batch.length < BATCH_SIZE) break
    }
    return total
  }
}

/** Байты по-человечески: до гигабайта — мегабайты, дальше гигабайты с десятой долей. */
function formatBytes(bytes: number): string {
  if (bytes < GB) return `${Math.round(bytes / (1024 * 1024))} МБ`
  return `${(bytes / GB).toFixed(1)} ГБ`
}
