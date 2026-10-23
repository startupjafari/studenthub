import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import type Redis from 'ioredis'
import { Role, isHigherRole } from '@studenthub/shared-types'
import type {
  AcceptConsentInput,
  UserListQueryInput,
  UpdateProfileInput,
  UserDirectoryQueryInput,
  UserDirectorySectionValue,
  UpdateAcademicRecordInput,
} from '@studenthub/shared-schemas'
import {
  disallowedProfileFields,
  ignoredProfileFields,
  isAdult,
  LEGAL_VERSION,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { buildPublicObjectUrl } from '../../common/minio/public-url'
import { PasswordService } from '../../common/security/password.service'
import { AuditService } from '../../common/audit/audit.service'
import { ExportBrandingService } from '../../common/export/export-branding.service'
import { ExportRegistryService } from '../../common/export/export-registry.service'
import type { ExportContext, ExportLocale } from '../../common/export/export-branding.types'
import {
  buildCsv,
  buildWorkbook,
  type SpreadsheetColumn,
} from '../../common/export/spreadsheet.builder'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import sharp from 'sharp'
import { FileService } from '../files/file.service'
import { RealtimeGateway } from '../../common/realtime'
import { QueueService, QUEUES, EMAIL_JOBS, FILE_JOBS, NOTIFICATION_JOBS } from '../../common/queue'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
// forwardRef: единственное разрешённое кольцо AuthModule ↔ UsersModule (§2.1) —
// смена пароля/удаление/блокировка обязаны погасить сессии, которыми владеет AuthService.
import { AuthService } from '../auth/auth.service'
import { canonicalSpecialtyName } from '../specialties/specialty-name'
import { nextLeftUniversityAt } from './academic-status'
import { birthDateIso, CONSENT_SELECT, consentStateOf, type ConsentState } from './consent'

type PrismaTx = Prisma.TransactionClient

export interface AuthUserRecord {
  id: string
  passwordHash: string
  role: Role
  isBlocked: boolean
  universityId: string | null
  facultyId: string | null
  groupId: string | null
  // Нужно для флага tfa в access-токене (TwoFactorGuard). Без него refresh/логин выдавали
  // tfa:false даже при включённой 2FA → форс зацикливал привилегированную роль на /setup-2fa.
  twoFactorEnabled: boolean
}

// Данные для второго шага входа (2FA). Секрет — зашифрован, backup-коды — bcrypt-хэши.
export interface TwoFactorLoginRecord {
  id: string
  role: Role
  isBlocked: boolean
  universityId: string | null
  facultyId: string | null
  groupId: string | null
  twoFactorEnabled: boolean
  twoFactorSecret: string | null
  twoFactorBackupCodes: string[]
  // Компания работодателя уходит в токен (JwtPayload.companyId) так же, как при входе без 2FA:
  // без неё работодатель с 2FA до первого refresh получал «аккаунт не привязан к компании».
  companyMembership: { companyId: string } | null
}

// Потолок выборки старост одной группы при смене старосты (§5.3: findMany без take нельзя).
const GROUP_STAROSTA_SCAN_LIMIT = 50

// Смена пароля: столько неверных текущих паролей за окно — и проверка закрыта до конца окна
// (как подтверждение кодом 2FA, TwoFactorService.verifyWithLimit).
const PASSWORD_CHANGE_MAX_FAILS = 5
const PASSWORD_CHANGE_FAIL_WINDOW_SEC = 15 * 60

// Прежних аватаров у пользователя единицы (каждая замена удаляет предыдущие),
// но потолок обязателен и здесь (BACKEND_RULES §7.2).
const OLD_AVATARS_LIMIT = 100

// Ключ advisory-лока проверки «не последний ли администратор платформы» при удалении
// аккаунта: двое последних, удаляющих себя одновременно, иначе оба видели бы друг друга.
const LAST_PLATFORM_ADMIN_LOCK = 'users:last-platform-admin'

// Справочник людей (§50). Друзей и блокировок у человека десятки, но `take` обязателен
// везде (§18): при переполнении секция «друзья» просто не пометит хвост — выдача остаётся
// корректной, а не отваливается.
const FRIENDS_SCAN_LIMIT = 1000
const BLOCKS_SCAN_LIMIT = 1000

const SECTION_ORDER: Record<UserDirectorySectionValue, number> = {
  friend: 0,
  group: 1,
  university: 2,
}

// Визитка в справочнике: только публичные поля — эндпоинт открыт всем ролям.
export interface DirectoryItem {
  id: string
  firstName: string
  lastName: string
  middleName: string | null
  avatarUrl: string | null
  avatarThumbUrl: string | null
  role: Role
  headline: string | null
  groupId: string | null
  groupName: string | null
  facultyName: string | null
  isFriend: boolean
  section: UserDirectorySectionValue
}

const PROFILE_SELECT = {
  id: true,
  email: true,
  // Имя входа (Telegram-стиль). Приватная деталь владельца: в чужой карточке вырезается
  // в getProfileForViewer — знать чужой логин посторонним незачем.
  username: true,
  firstName: true,
  lastName: true,
  middleName: true,
  avatarUrl: true,
  avatarThumbUrl: true,
  coverUrl: true,
  role: true,
  showEmail: true,
  showPhone: true,
  profileVisibility: true,
  // Флаг 2FA — только владельцу (в getProfileForViewer вырезается из чужой карточки).
  twoFactorEnabled: true,
  phone: true,
  universityId: true,
  facultyId: true,
  groupId: true,
  createdAt: true,
  // общие поля профиля
  bio: true,
  birthDate: true,
  gender: true,
  languages: true,
  telegram: true,
  instagram: true,
  website: true,
  headline: true,
  timezone: true,
  locale: true,
  country: true,
  // студент / староста
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
  // сотрудники
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
} satisfies Prisma.UserSelect

/**
 * Поля владельца, по которым решается видимость контента профиля (статьи, опросы, медиа).
 * Модули контента выбирают их вместе с объектом — без отдельного запроса за автором.
 */
export const PROFILE_CONTENT_OWNER_SELECT = {
  id: true,
  role: true,
  profileVisibility: true,
  universityId: true,
  facultyId: true,
  groupId: true,
  deletedAt: true,
} satisfies Prisma.UserSelect

export type ProfileContentOwner = Prisma.UserGetPayload<{
  select: typeof PROFILE_CONTENT_OWNER_SELECT
}>

// Контент профиля, удаляемый вместе с аккаунтом, выбирается пачками (§7.2: take обязателен).
const ACCOUNT_CONTENT_BATCH = 100
// Потолок кругов: файл, который не удалось снести, вернётся в следующей пачке — без потолка
// цикл не закончился бы. Остаток подберёт ночная чистка осиротевших объектов.
const ACCOUNT_CONTENT_MAX_ROUNDS = 50

// Полный профиль (собственный) выводится из select. Публичный — прячет чувствительное.
export type UserProfile = Prisma.UserGetPayload<{ select: typeof PROFILE_SELECT }>
// access: 'full' — карточка целиком (по правам), 'limited' — только «визитка» закрытого профиля.
export type ProfileAccessLevel = 'full' | 'limited'
export type PublicProfile = Omit<
  UserProfile,
  | 'email'
  | 'phone'
  | 'showEmail'
  | 'showPhone'
  | 'studentCardNumber'
  | 'employeeNumber'
  | 'address'
  | 'twoFactorEnabled'
  | 'username'
  // Язык интерфейса — настройка владельца, а не признак профиля: другим пользователям
  // она ничего не говорит, а в карточке была бы лишним персональным полем. Наружу
  // уходит только в собственном профиле (/users/me, /auth/me).
  | 'locale'
> & { email: string | null; phone: string | null; access: ProfileAccessLevel }

// Сортировка списка пользователей: имя колонки таблицы → orderBy Prisma. Отображение
// через белый список, а не подстановка query.sort в orderBy: иначе клиент сортировал бы по
// любому полю модели, включая passwordHash, и по нему же утекал бы порядок значений.
// «Имя» — это фамилия + имя, поэтому две ступени; вторая ступень везде — id, чтобы страницы
// не перемешивались между запросами при равных значениях.
function userListOrderBy(query: UserListQueryInput): Prisma.UserOrderByWithRelationInput[] {
  const dir = query.order ?? 'asc'
  switch (query.sort) {
    case 'name':
      return [{ lastName: dir }, { firstName: dir }, { id: 'asc' }]
    case 'email':
      return [{ email: dir }, { id: 'asc' }]
    case 'role':
      return [{ role: dir }, { lastName: 'asc' }, { id: 'asc' }]
    case 'blocked':
      return [{ isBlocked: dir }, { lastName: 'asc' }, { id: 'asc' }]
    case 'createdAt':
      return [{ createdAt: dir }, { id: 'asc' }]
    default:
      return [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }]
  }
}

/**
 * Фильтр email без учёта регистра — запасной путь для строк, записанных до нормализации:
 * раньше адрес сохранялся как пришёл («Ivanov@Uni.kz» из таблицы деканата), теперь — в нижнем
 * регистре (схемы shared-schemas). Ищем им, только когда точное совпадение не нашлось.
 *
 * `in`, а не `equals`: `equals` с `mode: 'insensitive'` Prisma строит через ILIKE, где `_` и `%`
 * — шаблоны, и `ivan_ov@uni.kz` находил бы `ivanXov@uni.kz`. `in` даёт точное
 * `LOWER(email) IN (LOWER($1))` — и индекс по `lower(email)`, когда он появится.
 */
function emailIgnoringCase(email: string) {
  return { in: [email], mode: 'insensitive' as const }
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly files: FileService,
    private readonly queue: QueueService,
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
    private readonly branding: ExportBrandingService,
    private readonly exports: ExportRegistryService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Статус присутствия пользователя (онлайн по активным WS-соединениям, docs/PROJECT.md §9). */
  getPresence(userId: string): { online: boolean } {
    return { online: this.realtime.isOnline(userId) }
  }

  /**
   * Присутствие по запросу зрителя: только человека своего вуза или друга (платформенным —
   * любого). Рассылку присутствия по WS уже ограничили комнатой вуза, а REST-ручка отдавала
   * «в сети ли» любого по id — работодателю и чужому вузу тоже. Вне охвата ответ тот же,
   * что «не в сети»: отказ сам по себе подсказывал бы, что такой id существует.
   */
  async getPresenceFor(viewer: JwtPayload, userId: string): Promise<{ online: boolean }> {
    if (userId === viewer.sub) return this.getPresence(userId)
    const platform = viewer.role === Role.PLATFORM_ADMIN || viewer.role === Role.PLATFORM_MODERATOR
    if (!platform) {
      const target = await this.prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { universityId: true },
      })
      const sameUniversity =
        !!target && viewer.universityId !== null && target.universityId === viewer.universityId
      if (!sameUniversity) {
        const friends = await this.prisma.friendship.findFirst({
          where: {
            status: 'ACCEPTED',
            OR: [
              { requesterId: viewer.sub, addresseeId: userId },
              { requesterId: userId, addresseeId: viewer.sub },
            ],
          },
          select: { id: true },
        })
        if (!friends) return { online: false }
      }
    }
    return this.getPresence(userId)
  }

  /**
   * Для AuthService (LocalStrategy): запись с passwordHash по email ИЛИ username (Telegram-стиль вход).
   * Оба сравниваются без учёта регистра (docs/PROJECT.md §7): username хранится в нижнем
   * регистре, email — тоже, кроме строк, записанных до нормализации (см. emailIgnoringCase).
   * passwordHash не покидает auth-домен.
   */
  async findByLoginIdentifierForAuth(identifier: string): Promise<AuthUserRecord | null> {
    const normalized = identifier.trim().toLowerCase()
    const select = {
      id: true,
      passwordHash: true,
      role: true,
      isBlocked: true,
      universityId: true,
      facultyId: true,
      groupId: true,
      twoFactorEnabled: true,
      // Ф18: компания работодателя уходит в токен (см. JwtPayload.companyId).
      companyMembership: { select: { companyId: true } },
    } satisfies Prisma.UserSelect
    // Сначала точное совпадение — по уникальным индексам email и username.
    const exact = await this.prisma.user.findFirst({
      where: { deletedAt: null, OR: [{ email: normalized }, { username: normalized }] },
      select,
    })
    // В username «@» не бывает — без неё искать старый email незачем.
    if (exact || !normalized.includes('@')) return exact
    const legacy = await this.prisma.user.findMany({
      where: { deletedAt: null, email: emailIgnoringCase(normalized) },
      select,
      take: 2,
    })
    return this.singleEmailOwner(legacy, 'Вход')
  }

  /** Для AuthService.refresh: актуальные роль/scope/блокировка/2FA по id (без passwordHash). */
  findByIdForAuth(id: string): Promise<Omit<AuthUserRecord, 'passwordHash'> | null> {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        role: true,
        isBlocked: true,
        universityId: true,
        facultyId: true,
        groupId: true,
        // Актуальный флаг 2FA → в токен (иначе refresh обнулял tfa и зацикливал форс).
        twoFactorEnabled: true,
        companyMembership: { select: { companyId: true } },
      },
    })
  }

  async findById(id: string): Promise<UserProfile> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: PROFILE_SELECT,
    })
    if (!user) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }
    return user
  }

  /**
   * Список пользователей (docs/PROJECT.md §12.2, только Admin+). Scope по роли смотрящего:
   * платформа — все, админ/модератор вуза — свой вуз, декан — свой факультет. passwordHash
   * не выбирается (§14.9). Роли гейтит @Roles на контроллере.
   */
  /**
   * Условие выборки списка: scope смотрящего И клиентские фильтры.
   *
   * Вынесено из `list`, потому что ровно та же выборка нужна выгрузке (§12.8): два
   * отдельных условия разошлись бы, и файл перестал бы совпадать с тем, что видно на
   * экране, — худший вид расхождения, потому что заметен он не сразу.
   */
  private listWhere(viewer: JwtPayload, query: UserListQueryInput): Prisma.UserWhereInput {
    // scope и клиентские фильтры — через AND: ?facultyId=/?groupId= обязаны СУЖАТЬ scope,
    // а не перезаписывать его (spread по общему ключу facultyId дал бы декану выборку
    // пользователей чужого факультета/вуза с email — cross-tenant PII). См. §14.7/§14.10.
    return {
      deletedAt: null,
      AND: [
        this.listScope(viewer),
        ...(query.role ? [{ role: query.role as Role }] : []),
        ...(query.facultyId ? [{ facultyId: query.facultyId }] : []),
        ...(query.groupId ? [{ groupId: query.groupId }] : []),
        ...(query.blocked !== undefined ? [{ isBlocked: query.blocked }] : []),
        ...(query.search
          ? [
              {
                OR: [
                  { firstName: { contains: query.search, mode: 'insensitive' as const } },
                  { lastName: { contains: query.search, mode: 'insensitive' as const } },
                  { email: { contains: query.search, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    }
  }

  /**
   * Учебные данные студента для официальной справки (этап B7).
   *
   * Отдельный метод, а не `findById`: там профиль для экрана, здесь — поля бланка, и
   * названия факультета, группы и вуза берутся связями (в профиле лежат только их id).
   * Модуль-владелец таблицы пользователей отдаёт их сам — прямой `prisma.user` из другого
   * модуля запрещён (§2.1).
   */
  async academicSubject(userId: string): Promise<AcademicSubject | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        firstName: true,
        lastName: true,
        middleName: true,
        specialty: true,
        course: true,
        educationLevel: true,
        studyForm: true,
        fundingType: true,
        enrollmentYear: true,
        graduationYear: true,
        academicStatus: true,
        studentCardNumber: true,
        group: { select: { name: true } },
        faculty: { select: { name: true } },
        university: { select: { name: true, shortName: true, city: true, timezone: true } },
      },
    })
    if (!user) return null
    return {
      // Отчество есть не у всех — склеиваем то, что заполнено, и не оставляем двойных пробелов.
      fullName: [user.lastName, user.firstName, user.middleName].filter(Boolean).join(' '),
      specialty: user.specialty,
      course: user.course,
      educationLevel: user.educationLevel,
      studyForm: user.studyForm,
      fundingType: user.fundingType,
      enrollmentYear: user.enrollmentYear,
      graduationYear: user.graduationYear,
      academicStatus: user.academicStatus,
      studentCardNumber: user.studentCardNumber,
      groupName: user.group?.name ?? null,
      facultyName: user.faculty?.name ?? null,
      universityName: user.university?.name ?? null,
      universityCity: user.university?.city ?? null,
      timezone: user.university?.timezone ?? 'UTC',
    }
  }

  async list(viewer: JwtPayload, query: UserListQueryInput): Promise<Paginated<unknown>> {
    const where = this.listWhere(viewer, query)
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          avatarUrl: true,
          avatarThumbUrl: true,
          universityId: true,
          facultyId: true,
          groupId: true,
          isBlocked: true,
          // Флаг, а не секрет: по нему таблица показывает «Сбросить 2FA» только тем, у кого
          // она включена. Секрет и backup-коды из сервиса не выходят.
          twoFactorEnabled: true,
          createdAt: true,
        },
        orderBy: userListOrderBy(query),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ])
    return new Paginated(rows, { total })
  }

  /**
   * Выгрузка списка пользователей в XLSX или CSV (задача 12.8).
   *
   * Выборка — ровно та же, что у таблицы на экране (`listWhere`), включая scope: декан
   * выгружает свой факультет и ничего кроме. Раньше файл собирал браузер по первой
   * странице ответа, то есть выгрузка молча обрывалась на 200 строках.
   */
  async exportList(
    viewer: JwtPayload,
    query: UserListQueryInput,
    locale: ExportLocale,
    format: 'xlsx' | 'csv',
    request: { ip?: string; userAgent?: string } = {},
  ): Promise<{ body: Buffer | string; filename: string }> {
    const where = this.listWhere(viewer, query)
    const total = await this.prisma.user.count({ where })
    if (total > EXPORT_MAX_ROWS) {
      // Честный отказ вместо тихого обрезания: неполный файл, который выглядит полным,
      // опаснее отсутствия файла — по нему принимают решения.
      throw new AppException(
        'BAD_REQUEST',
        `В выгрузку попало ${total} строк, предел — ${EXPORT_MAX_ROWS}. Сузьте фильтр.`,
      )
    }

    const rows: ExportUserRow[] = []
    // Страницами, а не одним findMany: выборка без потолка запрещена (§7.2), а держать в
    // памяти книгу целиком и так придётся — SheetJS иначе не умеет.
    while (rows.length < total) {
      const page = await this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isBlocked: true,
          createdAt: true,
        },
        orderBy: userListOrderBy(query),
        skip: rows.length,
        take: EXPORT_PAGE_SIZE,
      })
      if (page.length === 0) break
      rows.push(...page)
    }

    const context: ExportContext = {
      kind: 'users',
      actor: { id: viewer.sub, fullName: await this.fullName(viewer.sub) },
      locale,
      timezone: await this.viewerTimezone(viewer.sub),
      generatedAt: new Date(),
      // Фильтры уходят на лист «Инфо» и в журнал: через месяц по файлу должно быть
      // понятно, по какой выборке он собран.
      params: {
        role: query.role,
        facultyId: query.facultyId,
        groupId: query.groupId,
        blocked: query.blocked,
        search: query.search,
      },
    }
    const labels = this.branding.labels(locale)
    const columns = exportColumns(locale, context.timezone)

    const body =
      format === 'xlsx'
        ? buildWorkbook({
            columns,
            rows,
            labels,
            info: this.branding.infoRows(context),
            meta: this.branding.sheetMetadata(context),
          })
        : buildCsv({ columns, rows })

    // Выгрузка персональных данных — событие для двух журналов сразу. AuditLog ставит его
    // в общую ленту действий пользователя, реестр выгрузок — в перечень выданных файлов с
    // собственным кодом. Сами данные ни туда, ни туда не пишем (§13): только объём и условия.
    await this.audit.record({
      userId: viewer.sub,
      action: 'users_export',
      entity: 'User',
      metadata: { format, rows: rows.length, filters: context.params },
    })
    await this.exports.register({ context, format, rows: rows.length, ...request })

    return { body, filename: this.branding.filename(context, format) }
  }

  /**
   * Справочник людей своего вуза (§50) — «кому написать» в чатах. Доступен всем ролям,
   * поэтому отдаёт только визитку: ни email, ни username, ни служебных полей (§14.3).
   *
   * Секции задают и порядок: друзья → одногруппники → остальной вуз. Дружба выясняется
   * одним запросом по Friendship (в обе стороны), одногруппники — по groupId смотрящего;
   * остальные роли попадают в «вуз». Заблокировавшие меня и заблокированные мной
   * исключаются: писать им всё равно нельзя (UserBlock симметричен в PRIVATE).
   */
  async directory(
    viewer: JwtPayload,
    query: UserDirectoryQueryInput,
  ): Promise<{ items: DirectoryItem[]; hasMore: boolean }> {
    const q = query.q?.trim() ?? ''
    const contains = { contains: q, mode: 'insensitive' as const }

    const [friendships, blocks] = await Promise.all([
      this.prisma.friendship.findMany({
        where: {
          status: 'ACCEPTED',
          OR: [{ requesterId: viewer.sub }, { addresseeId: viewer.sub }],
        },
        select: { requesterId: true, addresseeId: true },
        take: FRIENDS_SCAN_LIMIT,
      }),
      this.prisma.userBlock.findMany({
        where: { OR: [{ blockerId: viewer.sub }, { blockedId: viewer.sub }] },
        select: { blockerId: true, blockedId: true },
        take: BLOCKS_SCAN_LIMIT,
      }),
    ])
    const friendIds = new Set(
      friendships.map((f) => (f.requesterId === viewer.sub ? f.addresseeId : f.requesterId)),
    )
    const blockedIds = new Set(
      blocks.map((b) => (b.blockerId === viewer.sub ? b.blockedId : b.blockerId)),
    )

    const base: Prisma.UserWhereInput[] = [
      this.directoryScope(viewer),
      { id: { notIn: [viewer.sub, ...blockedIds] } },
      { deletedAt: null, isBlocked: false },
    ]
    // +1 — чтобы отличить «ровно limit» от «есть ещё»: курсора здесь нет, и переполнение
    // клиент показывает подсказкой «уточните запрос», а не кнопкой «показать ещё».
    const take = query.limit + 1
    const find = (where: Prisma.UserWhereInput[]) =>
      this.prisma.user.findMany({
        where: { AND: where },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          middleName: true,
          avatarUrl: true,
          avatarThumbUrl: true,
          role: true,
          headline: true,
          groupId: true,
          group: { select: { name: true } },
          faculty: { select: { name: true } },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take,
      })

    let rows: Awaited<ReturnType<typeof find>>
    if (q) {
      rows = await find([
        ...base,
        { OR: [{ firstName: contains }, { lastName: contains }, { username: contains }] },
      ])
    } else {
      // Без запроса алфавитный срез вуза бесполезен: в списке на тысячу человек первые
      // тридцать фамилий на «А» — не те, кому пишут. Показываем круг общения; и только
      // если его нет вовсе (сотрудник без группы и друзей), падаем на общий список вуза,
      // чтобы окно не открывалось пустым.
      const circle: Prisma.UserWhereInput[] = [
        {
          OR: [
            { id: { in: [...friendIds] } },
            ...(viewer.groupId ? [{ groupId: viewer.groupId }] : []),
          ],
        },
      ]
      rows = friendIds.size > 0 || viewer.groupId ? await find([...base, ...circle]) : []
      if (rows.length === 0) rows = await find(base)
    }

    const hasMore = rows.length > query.limit
    const page = hasMore ? rows.slice(0, query.limit) : rows

    const items: DirectoryItem[] = page.map(({ group, faculty, ...u }) => ({
      ...u,
      groupName: group?.name ?? null,
      facultyName: faculty?.name ?? null,
      // Друзьям пишут сразу, остальным уходит запрос на переписку (§50) — независимо от роли.
      isFriend: friendIds.has(u.id),
      section: friendIds.has(u.id)
        ? 'friend'
        : viewer.groupId != null && u.groupId === viewer.groupId
          ? 'group'
          : 'university',
    }))
    // Секция — первичный ключ сортировки; внутри секции порядок уже задан запросом (по ФИО).
    items.sort((a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section])
    return { items, hasMore }
  }

  /**
   * Scope справочника. Обычные роли видят свой вуз; платформенные вуза не имеют и потому
   * ищут по всем (иначе поиск у них всегда пуст). EMPLOYER вне вуза — ему справочник
   * студентов не положен (доступ к ним считается по CompanyUniversityAccess, а не здесь).
   */
  private directoryScope(viewer: JwtPayload): Prisma.UserWhereInput {
    if (viewer.role === Role.PLATFORM_ADMIN || viewer.role === Role.PLATFORM_MODERATOR) return {}
    if (viewer.role === Role.EMPLOYER) return { id: '__none__' }
    return { universityId: viewer.universityId ?? '__none__' }
  }

  /**
   * Дата регистрации. Нужна модулю releases: релиз, вышедший до появления аккаунта,
   * новому человеку не показывают (ReleasesService.state).
   */
  async registeredAt(userId: string): Promise<Date | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { createdAt: true },
    })
    return user?.createdAt ?? null
  }

  /** ФИО пользователя одной строкой: в JWT имён нет, а шапке файла и журналу они нужны. */
  async fullName(userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    })
    return user ? `${user.firstName} ${user.lastName}` : ''
  }

  /**
   * Таймзона вуза выгружающего — в ней печатаются даты в файле и дата в его имени.
   * Нет вуза (платформенные роли) — UTC, и это честно написано на листе «Инфо».
   */
  private async viewerTimezone(userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { university: { select: { timezone: true } } },
    })
    return user?.university?.timezone ?? 'UTC'
  }

  private listScope(viewer: JwtPayload): Prisma.UserWhereInput {
    if (viewer.role === Role.PLATFORM_ADMIN || viewer.role === Role.PLATFORM_MODERATOR) {
      return {}
    }
    if (viewer.role === Role.DEAN) {
      return { facultyId: viewer.facultyId ?? '__none__' }
    }
    // UNIVERSITY_ADMIN / UNIVERSITY_MODERATOR — свой вуз.
    return { universityId: viewer.universityId ?? '__none__' }
  }

  // Обновление профиля: принимает валидированный расширенный DTO (Zod-strict).
  // Роль и scope (university/faculty/group) здесь не меняются — только «самоописываемые» поля.
  // Набор полей зависит от роли (PROFILE_FIELD_ROLES): у платформенных ролей нет кафедры,
  // предметов и табельного номера вуза. Роль берётся из JWT, а не из тела (§0) — Zod-схема
  // общая для всех ролей, поэтому без этой проверки прямой PATCH записал бы чужие поля.
  // Недоступные поля — ошибка 400, а не тихое отбрасывание: клиент должен узнать,
  // что данные не сохранены, иначе PATCH выглядит успешным.
  async updateProfile(userId: string, role: Role, data: UpdateProfileInput): Promise<UserProfile> {
    const disallowed = disallowedProfileFields(role, data)
    if (disallowed.length > 0) {
      throw new AppException(
        'BAD_REQUEST',
        `Поля недоступны для роли ${role}: ${disallowed.join(', ')}`,
        disallowed.map((field) => ({ field, message: 'Поле недоступно для вашей роли' })),
      )
    }
    // Общежитие студента теперь ведёт вуз (оно печатается в студенческом), но мобильные
    // клиенты могли присылать его в форме профиля: 400 сорвал бы им сохранение целиком.
    // Поэтому студенту и старосте поле не отклоняем, а молча отбрасываем — в базе остаётся
    // прежнее значение (COMPAT_IGNORED_STUDENT_FIELDS).
    const ignored = new Set<string>(ignoredProfileFields(role, data))
    const writable =
      ignored.size > 0
        ? (Object.fromEntries(
            Object.entries(data).filter(([key]) => !ignored.has(key)),
          ) as UpdateProfileInput)
        : data
    // Дата рождения решает основание согласия на обработку ПДн (сам человек или законный
    // представитель). Правка не отклоняется, но пересматривает его: согласие хранится с
    // основанием, и расхождение с новой датой делает `consentRequired` истинным, пока
    // согласие не примут заново (consentState, A-F29).
    return this.prisma.user.update({
      where: { id: userId },
      data: writable,
      select: PROFILE_SELECT,
    })
  }

  /**
   * Состояние согласия на обработку ПДн у владельца (A-F29): `GET /users/me/consent` и флаг
   * `consentRequired` в `/auth/me`. Отдельно от профиля: поля согласия в PROFILE_SELECT не
   * входят — карточка уходит и чужим, а им эти сведения ни к чему.
   */
  async consentState(userId: string): Promise<ConsentState> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: CONSENT_SELECT,
    })
    if (!user) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }
    return consentStateOf(user)
  }

  /**
   * Повторное согласие на действующую редакцию документов (A-F29). Правила — те же, что при
   * регистрации: возраст пересчитывается на сервере, и за несовершеннолетнего согласие даёт
   * законный представитель. Дату рождения форма согласия только дополняет (учётки, заведённые
   * до сентября 2026, её не имеют), а не меняет — её правят в профиле.
   */
  async acceptConsent(
    userId: string,
    input: AcceptConsentInput,
    ctx: { ip?: string; userAgent?: string },
  ): Promise<ConsentState> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: CONSENT_SELECT,
    })
    if (!user) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }
    if (input.birthDate && user.birthDate) {
      throw new AppException('BAD_REQUEST', 'Дата рождения уже указана — её меняют в профиле', [
        { field: 'birthDate', message: 'Дата рождения уже указана' },
      ])
    }
    const birthDate = user.birthDate ? birthDateIso(user.birthDate) : input.birthDate
    if (!birthDate) {
      throw new AppException('BAD_REQUEST', 'Укажите дату рождения', [
        { field: 'birthDate', message: 'Нужна, чтобы определить, чьё согласие требуется' },
      ])
    }
    const minor = !isAdult(birthDate)
    if (minor && input.guardianConsent !== true) {
      throw new AppException('BAD_REQUEST', 'Нужно согласие законного представителя', [
        { field: 'guardianConsent', message: 'Нужно согласие законного представителя' },
      ])
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        // Что подписали и когда — вместе с основанием, как при регистрации.
        consentAt: new Date(),
        consentVersion: LEGAL_VERSION,
        consentByGuardian: minor,
        ...(user.birthDate ? {} : { birthDate: new Date(`${birthDate}T00:00:00Z`) }),
      },
      select: CONSENT_SELECT,
    })
    await this.audit.record({
      userId,
      action: 'consent_accepted',
      entity: 'User',
      entityId: userId,
      metadata: { version: LEGAL_VERSION, byGuardian: minor },
      ...ctx,
    })
    return consentStateOf(updated)
  }

  /**
   * Смена имени пользователя (имени входа). Отдельно от updateProfile: у операции своя
   * ошибка «занято» и свой аудит — по нему видно, кто и когда сменил идентификатор входа.
   *
   * Уникальность обеспечивает БД (`username String? @unique`), а не предварительный SELECT:
   * проверка «свободно ли» и вставка — не атомарны, между ними имя может занять другой.
   * Ловим P2002 и переводим в USERNAME_TAKEN.
   */
  async updateUsername(userId: string, username: string): Promise<UserProfile> {
    // Схема уже приводит к нижнему регистру; trim на случай прямого вызова из кода.
    const normalized = username.trim().toLowerCase()
    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: { username: normalized },
        select: PROFILE_SELECT,
      })
      await this.audit.record({
        userId,
        action: 'change_username',
        entity: 'User',
        entityId: userId,
      })
      return updated
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('USERNAME_TAKEN', 'Это имя пользователя уже занято')
      }
      throw error
    }
  }

  /**
   * Загрузка аватара (docs/PROJECT.md §4, задача 4.3): изображение в публичный бакет avatars
   * через FileService, ссылка — прямой публичный URL. Прежний аватар удаляется (без сирот).
   * Превью (≈128px) генерируется асинхронно джобой generate-thumbnail; до готовности
   * avatarThumbUrl = null и клиент показывает полноразмерный avatarUrl.
   */
  async setAvatar(userId: string, buffer: Buffer): Promise<UserProfile> {
    const bucket = this.config.get('MINIO_BUCKET_AVATARS', { infer: true })
    // Сначала загрузка (проверка типа и размера — внутри), потом ссылка в профиле, и только
    // затем снос прежних — как у обложки. Раньше прежние удалялись первыми: файл с подменённым
    // расширением или сбой MinIO давали FILE_TYPE_NOT_ALLOWED, а avatarUrl в базе уже указывал
    // на снесённый объект — «битая» аватарка.
    const file = await this.files.upload({
      buffer,
      bucket,
      ownerId: userId,
      expectedCategory: 'IMAGE',
    })
    const avatarUrl = this.buildPublicUrl(bucket, file.key)
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl, avatarThumbUrl: null },
      select: PROFILE_SELECT,
    })
    await this.deleteExistingAvatars(userId, bucket, file.id)
    // Тяжёлый ресайз — в очередь (§9.1). Идемпотентность по jobId (один thumb на файл).
    await this.queue.enqueue(
      QUEUES.FILE_PROCESSING,
      FILE_JOBS.GENERATE_THUMBNAIL,
      { fileId: file.id, bucket, key: file.key, userId },
      { jobId: `thumb_${file.id}` },
    )
    return updated
  }

  /** Удаление аватара: снимает объект(ы) в MinIO и обнуляет avatarUrl + превью. */
  async removeAvatar(userId: string): Promise<UserProfile> {
    const bucket = this.config.get('MINIO_BUCKET_AVATARS', { infer: true })
    await this.deleteExistingAvatars(userId, bucket)
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null, avatarThumbUrl: null },
      select: PROFILE_SELECT,
    })
  }

  /**
   * Генерация превью аватара (джоба generate-thumbnail, очередь file-processing).
   * Читает оригинал из MinIO, ресайзит в квадрат ≈128px (webp), кладёт отдельной записью File
   * в тот же бакет avatars (чтобы orphan-клинер его не удалил, а deleteExistingAvatars снёс при
   * смене аватара) и проставляет avatarThumbUrl. Если оригинал уже удалён (аватар сменили) —
   * getObjectBuffer бросит, джоба упадёт и не запишет устаревшее превью.
   *
   * Превью пишется, только пока avatarUrl — всё ещё этот оригинал: прежний аватар может
   * пережить смену (снос объектов идёт после записи нового URL), и его превью, готовое позже,
   * перезаписывало бы превью нового — в списках оставалось старое лицо. Опоздавшее превью
   * сносится сразу, а не ждёт следующей смены аватара.
   */
  async generateAvatarThumbnail(data: {
    fileId: string
    bucket: string
    key: string
    userId: string
  }): Promise<void> {
    const original = await this.files.getObjectBuffer(data.bucket, data.key)
    const thumb = await sharp(original)
      .resize(128, 128, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer()
    const thumbFile = await this.files.upload({
      buffer: thumb,
      bucket: data.bucket,
      ownerId: data.userId,
      expectedCategory: 'IMAGE',
    })
    const avatarThumbUrl = this.buildPublicUrl(data.bucket, thumbFile.key)
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: data.userId,
        deletedAt: null,
        avatarUrl: { endsWith: `/${data.bucket}/${data.key}` },
      },
      data: { avatarThumbUrl },
    })
    if (count === 0) await this.files.delete(thumbFile.id)
  }

  /**
   * Обложка профиля (баннер, стиль ВК). Бакет profile-covers — общий (обложки статей/альбомов,
   * постеры видео), поэтому обложку профиля храним как raw-объект (putAuxImage, без записи File)
   * и удаляем точечно по ключу — как постеры видео. «Снести все файлы владельца в бакете»
   * (приём аватара) здесь применять нельзя: удалит и обложки статей.
   */
  async setCover(userId: string, buffer: Buffer): Promise<UserProfile> {
    const bucket = this.coversBucket
    const prev = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { coverUrl: true },
    })
    // Сначала загружаем новую (валидация типа/размера внутри) — при ошибке прежняя обложка цела.
    const key = await this.files.putAuxImage(bucket, buffer)
    const oldKey = prev?.coverUrl ? this.coverKeyFromUrl(prev.coverUrl) : null
    if (oldKey) await this.files.removeRawObject(bucket, oldKey)
    const coverUrl = this.buildPublicUrl(bucket, key)
    return this.prisma.user.update({
      where: { id: userId },
      data: { coverUrl },
      select: PROFILE_SELECT,
    })
  }

  /** Удаление обложки: снимает raw-объект в MinIO и обнуляет coverUrl. */
  async removeCover(userId: string): Promise<UserProfile> {
    const bucket = this.coversBucket
    const prev = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { coverUrl: true },
    })
    const oldKey = prev?.coverUrl ? this.coverKeyFromUrl(prev.coverUrl) : null
    if (oldKey) await this.files.removeRawObject(bucket, oldKey)
    return this.prisma.user.update({
      where: { id: userId },
      data: { coverUrl: null },
      select: PROFILE_SELECT,
    })
  }

  private get coversBucket(): string {
    return this.config.get('MINIO_BUCKET_PROFILE_COVERS', { infer: true })
  }

  // Ключ объекта (uuid.ext) — последний сегмент публичного URL; query отбрасываем.
  private coverKeyFromUrl(url: string): string | null {
    const seg = url.split('?')[0]?.split('/').pop()
    return seg ? seg : null
  }

  // Прежние аватары пользователя и их превью — все его файлы в бакете avatars, КРОМЕ аватаров
  // групп: их грузит админ группы (`setChatAvatar`), владельцем файла записан он же, и без
  // этого исключения смена своего аватара стирала картинки всех групп, где он их ставил.
  // `keepFileId` — только что загруженный аватар: снос прежних идёт уже после его записи.
  private async deleteExistingAvatars(
    userId: string,
    bucket: string,
    keepFileId?: string,
  ): Promise<void> {
    const existing = await this.prisma.file.findMany({
      where: { ownerId: userId, bucket, ...(keepFileId ? { id: { not: keepFileId } } : {}) },
      select: { id: true, key: true },
      take: OLD_AVATARS_LIMIT,
    })
    if (existing.length === 0) return
    const groupAvatars = await this.prisma.chat.findMany({
      where: { OR: existing.map((f) => ({ avatarUrl: { endsWith: `/${bucket}/${f.key}` } })) },
      select: { avatarUrl: true },
      take: existing.length,
    })
    const keep = new Set(groupAvatars.map((c) => c.avatarUrl?.split('/').pop()))
    for (const f of existing) {
      if (!keep.has(f.key)) await this.files.delete(f.id)
    }
  }

  // Публичный URL объекта в публичном бакете (avatars). Прод → MINIO_PUBLIC_ENDPOINT.
  private buildPublicUrl(bucket: string, key: string): string {
    return buildPublicObjectUrl(this.config, bucket, key)
  }

  /**
   * Профиль чужого пользователя с фильтрацией по правам смотрящего (docs/PROJECT.md §3.7, §11.1/§11.3).
   * Два уровня: `profileVisibility` («закрытый профиль») решает — отдать полную карточку или
   * только «визитку» (limited); поверх — полевая приватность (email/phone/gpa) и всегда-скрытое
   * (номера/адрес). Надзорные роли своего scope видят полный профиль даже при PRIVATE — с аудитом.
   */
  async getProfileForViewer(targetId: string, viewer: JwtPayload): Promise<PublicProfile> {
    const target = await this.prisma.user.findFirst({
      where: { id: targetId, deletedAt: null },
      select: PROFILE_SELECT,
    })
    if (!target) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }

    const access = await this.resolveAccessWithFriendship(viewer, target)
    if (access.level === 'limited') {
      return this.toLimitedProfile(target)
    }

    // Доступ к закрытому (PRIVATE) профилю силой надзорной роли — пишем в журнал (§11.1).
    if (access.audit) {
      await this.audit.record({
        userId: viewer.sub,
        action: 'PROFILE_VIEW_PRIVATE',
        entity: 'User',
        entityId: target.id,
        metadata: { role: viewer.role, visibility: target.profileVisibility },
      })
    }

    // Полная карточка: чувствительные поля прячем по приватности; номера/адрес — не отдаём чужим.
    const {
      showEmail,
      showPhone,
      email,
      phone,
      studentCardNumber,
      employeeNumber,
      address,
      gpa,
      twoFactorEnabled,
      username,
      birthDate,
      fundingType,
      academicStatus,
      dormitory,
      locale,
      ...rest
    } = target
    // Всё, что осталось в rest, уходит в карточку как есть. Поле, которое тип PublicProfile
    // прячет, а разбор выше забыл вынуть (так утекал locale), не соберёт сборку.
    const leaked: Exclude<keyof typeof rest, keyof PublicProfile> extends never ? true : never =
      true
    void leaked
    const academic = this.canSeeAcademicRecords(viewer, target)
    void showEmail
    void studentCardNumber
    void employeeNumber
    void address
    // Наличие 2FA — приватная деталь владельца, не отдаём чужим.
    void twoFactorEnabled
    // Имя входа — тоже: это половина учётных данных, а не публичный хэндл.
    void username
    // Язык интерфейса — настройка владельца, наружу только в /users/me.
    void locale
    return {
      ...rest,
      email: this.canSeeEmail(viewer, target) ? email : null,
      phone: showPhone || viewer.sub === target.id ? phone : null,
      gpa: academic ? gpa : null,
      // Дата рождения, форма оплаты (грант/платное), учебный статус и общежитие — личные
      // сведения, а не визитка: «полная» карточка открыта всему вузу (у сотрудников — всей
      // платформе, включая работодателей). Видят их владелец и те, кто ведёт его учёбу.
      birthDate: academic ? birthDate : null,
      fundingType: academic ? fundingType : null,
      academicStatus: academic ? academicStatus : null,
      dormitory: academic ? dormitory : null,
      access: 'full',
    }
  }

  // Скоуп-отношение смотрящего к владельцу (совпадение вуза/факультета/группы).
  private scopeRelation(
    viewer: JwtPayload,
    target: { universityId: string | null; facultyId: string | null; groupId: string | null },
  ): { sameUni: boolean; sameFac: boolean; sameGroup: boolean } {
    return {
      sameUni: viewer.universityId !== null && viewer.universityId === target.universityId,
      sameFac: viewer.facultyId !== null && viewer.facultyId === target.facultyId,
      sameGroup: viewer.groupId !== null && viewer.groupId === target.groupId,
    }
  }

  // Надзорные роли (пробивают PRIVATE, доступ пишется в аудит): платформа — глобально,
  // админ/модератор вуза — свой вуз, декан — свой факультет.
  private hasAuthorityOver(
    viewer: JwtPayload,
    rel: { sameUni: boolean; sameFac: boolean },
  ): boolean {
    if (viewer.role === Role.PLATFORM_ADMIN || viewer.role === Role.PLATFORM_MODERATOR) return true
    if (
      (viewer.role === Role.UNIVERSITY_ADMIN || viewer.role === Role.UNIVERSITY_MODERATOR) &&
      rel.sameUni
    ) {
      return true
    }
    if (viewer.role === Role.DEAN && rel.sameFac) return true
    return false
  }

  // «Естественная» аудитория полного профиля по настройке видимости владельца.
  private isInVisibilityAudience(
    visibility: string,
    rel: { sameUni: boolean; sameFac: boolean; sameGroup: boolean },
  ): boolean {
    switch (visibility) {
      case 'PUBLIC':
        return true
      case 'UNIVERSITY':
        return rel.sameUni
      case 'FACULTY':
        return rel.sameFac
      case 'GROUP':
        return rel.sameGroup
      case 'PRIVATE':
        return false
      default:
        return rel.sameUni
    }
  }

  // «Мягкий» доступ (полный профиль в рамках scope, НЕ пробивает PRIVATE, без аудита):
  // преподаватель — по своему вузу; староста — по своей группе (только студенты/старосты).
  private hasSoftView(
    viewer: JwtPayload,
    target: { role: Role },
    rel: { sameUni: boolean; sameGroup: boolean },
  ): boolean {
    if (viewer.role === Role.TEACHER && rel.sameUni) return true
    if (
      viewer.role === Role.STAROSTA &&
      rel.sameGroup &&
      (target.role === Role.STUDENT || target.role === Role.STAROSTA)
    ) {
      return true
    }
    return false
  }

  /** Уровень доступа к профилю: full/limited + нужен ли аудит (надзор пробил PRIVATE). */
  private resolveAccess(
    viewer: JwtPayload,
    target: {
      id: string
      role: Role
      profileVisibility: string
      universityId: string | null
      facultyId: string | null
      groupId: string | null
    },
  ): { level: ProfileAccessLevel; audit: boolean } {
    if (viewer.sub === target.id) return { level: 'full', audit: false }
    const rel = this.scopeRelation(viewer, target)
    if (this.hasAuthorityOver(viewer, rel)) {
      const pierced =
        target.profileVisibility === 'PRIVATE' &&
        !this.isInVisibilityAudience(target.profileVisibility, rel)
      return { level: 'full', audit: pierced }
    }
    if (this.isInVisibilityAudience(target.profileVisibility, rel)) {
      return { level: 'full', audit: false }
    }
    if (target.profileVisibility !== 'PRIVATE' && this.hasSoftView(viewer, target, rel)) {
      return { level: 'full', audit: false }
    }
    return { level: 'limited', audit: false }
  }

  /**
   * Доступ к профилю с учётом дружбы: принятая дружба открывает профиль взаимно; ПЕНДИНГ-заявка ОТ
   * владельца закрытого профиля к смотрящему тоже открывает (тот решает, принимать ли).
   */
  private async resolveAccessWithFriendship(
    viewer: JwtPayload,
    target: {
      id: string
      role: Role
      profileVisibility: string
      universityId: string | null
      facultyId: string | null
      groupId: string | null
    },
  ): Promise<{ level: ProfileAccessLevel; audit: boolean }> {
    const access = this.resolveAccess(viewer, target)
    if (access.level !== 'limited' || viewer.sub === target.id) return access
    const opened = await this.openedByFriendship(viewer.sub, [target.id])
    return opened.has(target.id) ? { level: 'full', audit: false } : access
  }

  /**
   * Кому из targetIds смотрящего открывает дружба: принятая — взаимно, заявка ОТ владельца — до
   * ответа. Личная блокировка в любую сторону дружбу гасит: иначе заблокированный бывший друг
   * продолжал бы видеть закрытый профиль, фото и альбомы того, кто от него закрылся. Блокировка
   * и так удаляет дружбу (ChatsService.blockUser), проверка здесь — для пар, заблокированных
   * раньше, и на случай гонки «заявку приняли одновременно с блокировкой».
   * Пачкой: два запроса на любое число владельцев (закладки читают статьи разных авторов).
   */
  private async openedByFriendship(viewerId: string, targetIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(targetIds)].filter((id) => id !== viewerId)
    if (ids.length === 0) return new Set()
    const links = await this.prisma.friendship.findMany({
      where: {
        OR: [
          { status: 'ACCEPTED', requesterId: viewerId, addresseeId: { in: ids } },
          { requesterId: { in: ids }, addresseeId: viewerId },
        ],
      },
      select: { requesterId: true, addresseeId: true },
      // По паре — не больше двух строк (по одной в каждую сторону, @@unique).
      take: ids.length * 2,
    })
    const opened = new Set(
      links.map((l) => (l.requesterId === viewerId ? l.addresseeId : l.requesterId)),
    )
    if (opened.size === 0) return opened
    const candidates = [...opened]
    const blocks = await this.prisma.userBlock.findMany({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: { in: candidates } },
          { blockerId: { in: candidates }, blockedId: viewerId },
        ],
      },
      select: { blockerId: true, blockedId: true },
      take: candidates.length * 2,
    })
    for (const b of blocks) opened.delete(b.blockerId === viewerId ? b.blockedId : b.blockerId)
    return opened
  }

  /**
   * Виден ли смотрящему КОНТЕНТ профиля (медиа, альбомы, статьи, опросы) — по тому же правилу,
   * что решает, отдать полную карточку или «визитку». Отдельный метод нужен модулям контента:
   * фото, статьи и опросы — такие же персональные данные, как поля карточки, и закрытый профиль
   * обязан скрывать и их (docs/BACKEND_RULES.md §14.7). Контент удалённого аккаунта не виден никому.
   */
  async canViewProfileContent(viewer: JwtPayload, targetId: string): Promise<boolean> {
    if (viewer.sub === targetId) return true
    const target = await this.prisma.user.findFirst({
      where: { id: targetId, deletedAt: null },
      select: PROFILE_CONTENT_OWNER_SELECT,
    })
    if (!target) return false
    return this.canViewProfileContentOf(viewer, target)
  }

  /**
   * То же, что canViewProfileContent, по уже выбранному владельцу (PROFILE_CONTENT_OWNER_SELECT
   * вместе со статьёй или опросом) — без лишнего запроса за автором.
   */
  async canViewProfileContentOf(viewer: JwtPayload, owner: ProfileContentOwner): Promise<boolean> {
    if (owner.deletedAt) return false
    if (viewer.sub === owner.id) return true
    const access = await this.resolveAccessWithFriendship(viewer, owner)
    return access.level === 'full'
  }

  /**
   * Пакетный canViewProfileContentOf: id владельцев, чей контент смотрящему виден. Для списков
   * со статьями разных авторов (закладки) — дружба и блокировки проверяются одним запросом на
   * всю пачку, а не по запросу на автора.
   */
  async viewableProfileContentOwners(
    viewer: JwtPayload,
    owners: ProfileContentOwner[],
  ): Promise<Set<string>> {
    const visible = new Set<string>()
    const viaFriendship: string[] = []
    for (const owner of owners) {
      if (owner.deletedAt || visible.has(owner.id)) continue
      if (viewer.sub === owner.id || this.resolveAccess(viewer, owner).level === 'full') {
        visible.add(owner.id)
      } else {
        viaFriendship.push(owner.id)
      }
    }
    for (const id of await this.openedByFriendship(viewer.sub, viaFriendship)) visible.add(id)
    return visible
  }

  // Академические записи (gpa) видят только владелец и надзорные роли — не одногруппники/староста.
  private canSeeAcademicRecords(
    viewer: JwtPayload,
    target: { id: string; universityId: string | null; facultyId: string | null },
  ): boolean {
    if (viewer.sub === target.id) return true
    return this.hasAuthorityOver(viewer, this.scopeRelation(viewer, { ...target, groupId: null }))
  }

  // «Визитка» закрытого профиля: имя, аватар, роль, вуз/факультет, headline — остальное скрыто.
  private toLimitedProfile(target: UserProfile): PublicProfile {
    return {
      id: target.id,
      firstName: target.firstName,
      lastName: target.lastName,
      middleName: target.middleName,
      avatarUrl: target.avatarUrl,
      avatarThumbUrl: target.avatarThumbUrl,
      coverUrl: target.coverUrl,
      role: target.role,
      universityId: target.universityId,
      facultyId: target.facultyId,
      groupId: target.groupId,
      headline: target.headline,
      createdAt: target.createdAt,
      profileVisibility: target.profileVisibility,
      access: 'limited',
      email: null,
      phone: null,
      bio: null,
      birthDate: null,
      gender: null,
      languages: [],
      telegram: null,
      instagram: null,
      website: null,
      timezone: null,
      country: null,
      course: null,
      enrollmentYear: null,
      graduationYear: null,
      educationLevel: null,
      studyForm: null,
      fundingType: null,
      specialty: null,
      academicStatus: null,
      gpa: null,
      interests: [],
      skills: [],
      dormitory: null,
      starostaSince: null,
      duties: null,
      position: null,
      academicDegree: null,
      academicTitle: null,
      department: null,
      subjects: [],
      officeRoom: null,
      officeHours: null,
      researchInterests: null,
      publicationsUrl: null,
      appointmentDate: null,
      workPhone: null,
      jobTitle: null,
      responsibilities: null,
      moderationAreas: null,
    }
  }

  private canSeeEmail(
    viewer: JwtPayload,
    target: {
      id: string
      showEmail: boolean
      universityId: string | null
      facultyId: string | null
    },
  ): boolean {
    if (viewer.sub === target.id) return true
    if (viewer.role === Role.PLATFORM_ADMIN || viewer.role === Role.PLATFORM_MODERATOR) return true
    if (
      (viewer.role === Role.UNIVERSITY_ADMIN || viewer.role === Role.UNIVERSITY_MODERATOR) &&
      viewer.universityId !== null &&
      viewer.universityId === target.universityId
    ) {
      return true
    }
    if (
      viewer.role === Role.DEAN &&
      viewer.facultyId !== null &&
      viewer.facultyId === target.facultyId
    ) {
      return true
    }
    return target.showEmail
  }

  // ── 2FA (TOTP) ─────────────────────────────────────────────────────────────
  // Секрет/backup-коды не входят в PROFILE_SELECT и не покидают этот сервис
  // (изоляция как у passwordHash). Наружу отдаётся только флаг twoFactorEnabled.

  /** Включена ли 2FA (для ветвления login). */
  async isTwoFactorEnabled(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { twoFactorEnabled: true },
    })
    return u?.twoFactorEnabled ?? false
  }

  /** Состояние 2FA для setup/enable/disable (флаг + зашифрованный секрет). */
  getTwoFactorState(
    userId: string,
  ): Promise<{ twoFactorEnabled: boolean; twoFactorSecret: string | null } | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { twoFactorEnabled: true, twoFactorSecret: true },
    })
  }

  /** Данные для второго шага входа: scope/роль + секрет + backup-коды. */
  getTwoFactorForLogin(userId: string): Promise<TwoFactorLoginRecord | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        role: true,
        universityId: true,
        facultyId: true,
        groupId: true,
        isBlocked: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
        companyMembership: { select: { companyId: true } },
      },
    })
  }

  /** Сохранить «ожидающий» секрет (setup): секрет есть, но 2FA ещё не включена. */
  async setPendingTwoFactorSecret(userId: string, encSecret: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: encSecret, twoFactorEnabled: false, twoFactorBackupCodes: [] },
    })
  }

  /** Включить 2FA после подтверждения кодом: сохранить bcrypt-хэши backup-кодов. */
  async enableTwoFactor(userId: string, backupHashes: string[]): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true, twoFactorBackupCodes: backupHashes },
    })
  }

  /** Отключить 2FA: очистить секрет, флаг и backup-коды. */
  async disableTwoFactor(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [] },
    })
  }

  /** Обновить набор backup-кодов (при «сжигании» использованного). */
  /**
   * Сжечь backup-код: убрать хэш из набора, только если он там ещё есть. Чтение и запись
   * набора целиком («прочитать → отфильтровать → записать») давали двум параллельным входам
   * с одним кодом пройти оба. Возвращает, был ли код списан этим вызовом.
   */
  async consumeBackupCode(userId: string, hash: string): Promise<boolean> {
    const count = await this.prisma.$executeRaw`
      UPDATE users
      SET two_factor_backup_codes = array_remove(two_factor_backup_codes, ${hash})
      WHERE id = ${userId} AND ${hash} = ANY(two_factor_backup_codes)`
    return count > 0
  }

  /** Заменить набор backup-кодов целиком (перевыпуск владельцем, TwoFactorService). */
  async setBackupCodes(userId: string, hashes: string[]): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorBackupCodes: hashes },
    })
  }

  /**
   * Смена пароля: сверка текущего + инвалидация ВСЕХ сессий пользователя (§?).
   *
   * Промахи по текущему паролю считаются по пользователю: с украденным access-токеном его
   * перебирали под общим лимитом 100 запросов в минуту, а угаданный пароль тут же менялся —
   * захват учётки. Пять промахов за 15 минут закрывают проверку до конца окна, даже с
   * верным паролем. Redis недоступен — проверяем без счётчика, как и 2FA.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ctx: { ip?: string; userAgent?: string } = {},
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { passwordHash: true },
    })
    if (!user) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }
    await this.assertCurrentPassword(userId, currentPassword, user.passwordHash)
    const passwordHash = await this.passwords.hash(newPassword)
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } })
    await this.authService.revokeAllUserSessions(userId)
    // Кто и когда сменил пароль — первое, что спрашивают при разборе угона. Без паролей.
    await this.audit.record({
      userId,
      action: 'password_changed',
      entity: 'User',
      entityId: userId,
      ...ctx,
    })
  }

  /**
   * Сверка текущего пароля — для смены пароля и удаления аккаунта. Счётчик промахов общий:
   * перебирать пароль через удаление вместо смены ничего не даёт. Пять промахов за 15 минут
   * закрывают проверку до конца окна, даже с верным паролем; Redis недоступен — проверяем
   * без счётчика.
   */
  private async assertCurrentPassword(
    userId: string,
    password: string,
    passwordHash: string,
  ): Promise<void> {
    const failKey = `password-change:fails:${userId}`
    const fails = Number((await this.redis.get(failKey).catch(() => null)) ?? 0)
    if (fails >= PASSWORD_CHANGE_MAX_FAILS) {
      throw new AppException('RATE_LIMIT', 'Слишком много неверных паролей — попробуйте позже')
    }
    const ok = await this.passwords.compare(password, passwordHash)
    if (!ok) {
      await this.redis
        .multi()
        .incr(failKey)
        .expire(failKey, PASSWORD_CHANGE_FAIL_WINDOW_SEC)
        .exec()
        .catch(() => undefined)
      // 400, а не 401 — чтобы не триггерить авто-refresh на фронте.
      throw new AppException('BAD_REQUEST', 'Неверный текущий пароль')
    }
    await this.redis.del(failKey).catch(() => undefined)
  }

  /**
   * Кому слать ссылку сброса пароля (AuthModule, docs/PROJECT.md §7.2). Без passwordHash:
   * для письма нужны только адрес, имя и язык. Удалённые не находятся — их почта затёрта.
   */
  async findForPasswordReset(email: string): Promise<{
    id: string
    email: string
    username: string | null
    firstName: string
    locale: string
    isBlocked: boolean
  } | null> {
    const normalized = email.trim().toLowerCase()
    const select = {
      id: true,
      email: true,
      username: true,
      firstName: true,
      locale: true,
      isBlocked: true,
    } satisfies Prisma.UserSelect
    const exact = await this.prisma.user.findFirst({
      where: { email: normalized, deletedAt: null },
      select,
    })
    if (exact) return exact
    // Письмо уходит на адрес из базы (`email` записи), а не на введённый: найденная без учёта
    // регистра учётка получает ссылку туда же, куда и всегда.
    const legacy = await this.prisma.user.findMany({
      where: { email: emailIgnoringCase(normalized), deletedAt: null },
      select,
      take: 2,
    })
    return this.singleEmailOwner(legacy, 'Сброс пароля')
  }

  /**
   * Чей это email — без учёта регистра (регистрация по инвайту: проверка, что адрес не занят).
   * Несколько совпадений здесь не отказ, а ответ «занят»: важно лишь, что адрес чей-то.
   */
  async findEmailOwnerId(email: string): Promise<string | null> {
    const normalized = email.trim().toLowerCase()
    const exact = await this.prisma.user.findFirst({
      where: { email: normalized },
      select: { id: true },
    })
    if (exact) return exact.id
    const legacy = await this.prisma.user.findFirst({
      where: { email: emailIgnoringCase(normalized) },
      select: { id: true },
    })
    return legacy?.id ?? null
  }

  /**
   * Единственный владелец email из запасного поиска без учёта регистра. Два и больше —
   * `Ivanov@…` и `ivanov@…` заведены разными учётками ещё до нормализации: угадывать, чья
   * это почта, нельзя, поэтому отказ (вход не проходит, письмо не уходит) и запись в лог —
   * такие пары разводит владелец данных.
   */
  private singleEmailOwner<T extends { id: string }>(matches: T[], purpose: string): T | null {
    if (matches.length > 1) {
      this.logger.warn(
        `${purpose}: email без учёта регистра совпал у нескольких учёток ` +
          `(${matches.map((m) => m.id).join(', ')}) — отказ`,
      )
      return null
    }
    return matches[0] ?? null
  }

  /**
   * Сотрудники, которым можно поручить заявку (домен «Услуги», назначение ответственного):
   * админ и модератор вуза, а для заявки факультета — ещё и декан этого факультета. Только
   * id, ФИО и роль: список рисуется в выпадающем меню обработчика.
   */
  listApplicationAssignees(
    universityId: string,
    facultyId: string | null,
  ): Promise<Array<{ id: string; firstName: string; lastName: string; role: Role }>> {
    return this.prisma.user.findMany({
      where: {
        universityId,
        deletedAt: null,
        isBlocked: false,
        OR: [
          { role: { in: [Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR] } },
          ...(facultyId ? [{ role: Role.DEAN, facultyId }] : []),
        ],
      },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 100,
    })
  }

  /** Кого назначают ответственным: роль и scope — для проверки, что он вправе вести заявку. */
  findAssigneeScope(userId: string): Promise<{
    id: string
    role: Role
    universityId: string | null
    facultyId: string | null
  } | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isBlocked: false },
      select: { id: true, role: true, universityId: true, facultyId: true },
    })
  }

  /**
   * Новый пароль по ссылке из письма — без старого: одноразовый токен уже проверил и погасил
   * AuthModule. Все сессии гаснут, как при обычной смене пароля: сброс часто делают именно
   * потому, что пароль утёк, и открытая у злоумышленника сессия не должна пережить его.
   */
  async setPasswordAfterReset(
    userId: string,
    newPassword: string,
  ): Promise<{ email: string; username: string | null }> {
    // Аккаунт могли удалить, пока письмо лежало в ящике: затёртой учётке пароль не задаём.
    const alive = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    })
    if (!alive) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }
    const passwordHash = await this.passwords.hash(newPassword)
    // Возвращаем, чем человек входит: AuthModule снимет по ним блокировку подбора.
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
      select: { email: true, username: true },
    })
    await this.authService.revokeAllUserSessions(userId)
    return user
  }

  /**
   * Староста группы — это роль, а не только отметка в группе: права старосты (инвайты в
   * группу, групповые обращения, его меню) держатся на `User.role`. Вызывается GroupService
   * внутри его транзакции вместе с `Group.starostaId`.
   *
   * В группе один староста: остальные со старостинской ролью (в том числе пришедшие по
   * инвайту и к группе не привязанные) возвращаются в студенты. Возвращает их id — после
   * коммита им гасятся сессии (`afterStarostaChange`).
   */
  async syncGroupStarosta(
    tx: Prisma.TransactionClient,
    groupId: string,
    starostaId: string | null,
  ): Promise<string[]> {
    const demoted = await tx.user.findMany({
      where: {
        groupId,
        role: Role.STAROSTA,
        deletedAt: null,
        ...(starostaId ? { id: { not: starostaId } } : {}),
      },
      select: { id: true },
      take: GROUP_STAROSTA_SCAN_LIMIT,
    })
    const demotedIds = demoted.map((u) => u.id)
    if (demotedIds.length) {
      await tx.user.updateMany({
        where: { id: { in: demotedIds } },
        data: { role: Role.STUDENT, starostaSince: null },
      })
    }
    if (starostaId) {
      // Только из студентов: уже действующий староста сохраняет дату начала полномочий.
      await tx.user.updateMany({
        where: { id: starostaId, role: Role.STUDENT },
        data: { role: Role.STAROSTA, starostaSince: new Date() },
      })
    }
    return demotedIds
  }

  /**
   * Староста, зарегистрировавшийся по инвайту (AuthService, в транзакции регистрации),
   * становится старостой своей группы: отметка `Group.starostaId` и единственная
   * старостинская роль в группе — как при назначении деканом (`syncGroupStarosta`).
   * Возвращает разжалованных: после коммита им — `afterStarostaChange`.
   */
  async assignInvitedStarosta(
    tx: Prisma.TransactionClient,
    groupId: string,
    userId: string,
  ): Promise<string[]> {
    // updateMany: группы уже может не быть — регистрацию это не роняет, отмечать некого.
    await tx.group.updateMany({ where: { id: groupId }, data: { starostaId: userId } })
    return this.syncGroupStarosta(tx, groupId, userId)
  }

  /**
   * После смены старосты: разжалованным гасим сессии. В их access-токене ещё 15 минут жила
   * бы роль старосты — с инвайтами в группу и списком её обращений. Новый староста получит
   * роль при ближайшем обновлении токена (refresh читает роль из БД).
   */
  async afterStarostaChange(
    actorId: string,
    groupId: string,
    promotedId: string | null,
    demotedIds: string[],
  ): Promise<void> {
    for (const id of demotedIds) {
      await this.authService.revokeAllUserSessions(id)
      await this.audit.record({
        userId: actorId,
        action: 'user_role_changed',
        entity: 'User',
        entityId: id,
        metadata: { from: Role.STAROSTA, to: Role.STUDENT, groupId },
      })
    }
    if (promotedId) {
      await this.audit.record({
        userId: actorId,
        action: 'user_role_changed',
        entity: 'User',
        entityId: promotedId,
        metadata: { to: Role.STAROSTA, groupId },
      })
    }
  }

  /**
   * Учебные данные студента — правит вуз (STAFF_MANAGED_STUDENT_FIELDS): декан своего
   * факультета или админ своего вуза. Из этих полей печатаются справка об обучении и
   * студенческий, поэтому каждая правка пишется в аудит со списком изменённых полей.
   */
  async updateAcademicRecord(
    actor: JwtPayload,
    userId: string,
    data: UpdateAcademicRecordInput,
    ctx: { ip?: string; userAgent?: string } = {},
  ): Promise<UserProfile> {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        role: true,
        universityId: true,
        facultyId: true,
        specialty: true,
        leftUniversityAt: true,
      },
    })
    if (!target) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    if (target.role !== Role.STUDENT && target.role !== Role.STAROSTA) {
      throw new AppException('BAD_REQUEST', 'Учебные данные ведутся только у студентов')
    }
    const inScope =
      actor.role === Role.DEAN
        ? target.facultyId !== null && target.facultyId === actor.facultyId
        : actor.role === Role.UNIVERSITY_ADMIN
          ? target.universityId !== null && target.universityId === actor.universityId
          : false
    if (!inScope) throw new AppException('WRONG_SCOPE', 'Студент вне вашей области')

    // Дата ухода из вуза — служебное поле, не часть контракта: из неё уборка считает сроки
    // хранения (PERSONAL_DATA §4), поэтому ставится здесь, на единственном пути смены статуса.
    const leftUniversityAt = nextLeftUniversityAt(data.academicStatus, target.leftUniversityAt)
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(await this.withDictionarySpecialty(target, data)),
        ...(leftUniversityAt !== undefined ? { leftUniversityAt } : {}),
      },
      select: PROFILE_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'user_academic_updated',
      entity: 'User',
      entityId: userId,
      metadata: { fields: Object.keys(data) },
      ...ctx,
    })
    return updated
  }

  /**
   * Специальность в учебных данных — из справочника вуза, в его написании: иначе после
   * переименования в справочнике (каскад — `renameSpecialty`) студент со «своим» текстом
   * остался бы со старым названием в справке. Прежнее значение пропускается как есть —
   * правка курса не должна упираться в специальность, вписанную до справочника. У вуза без
   * справочника — свободный текст, как раньше.
   */
  private async withDictionarySpecialty(
    target: { universityId: string | null; specialty: string | null },
    data: UpdateAcademicRecordInput,
  ): Promise<UpdateAcademicRecordInput> {
    if (data.specialty === undefined || data.specialty === target.specialty) return data
    if (!target.universityId) return data
    const specialty = await canonicalSpecialtyName(this.prisma, target.universityId, data.specialty)
    if (specialty === null) {
      throw new AppException('VALIDATION_ERROR', 'Специальности нет в справочнике вуза', [
        { field: 'specialty', message: 'Выберите специальность из справочника вуза' },
      ])
    }
    return { ...data, specialty }
  }

  /**
   * Переименование специальности в справочнике вуза доходит до учебных данных студентов
   * (зовёт SpecialtiesService.update в своей транзакции). Специальность в профиле —
   * строка-название, а не ссылка на справочник, поэтому без каскада в справках и
   * студенческих оставалось старое название. Сравнение без учёта регистра — как и выбор
   * из справочника.
   */
  async renameSpecialty(
    tx: PrismaTx,
    universityId: string,
    from: string,
    to: string,
  ): Promise<number> {
    const { count } = await tx.user.updateMany({
      where: { universityId, specialty: { in: [from], mode: 'insensitive' } },
      data: { specialty: to },
    })
    return count
  }

  /**
   * Удаление своего аккаунта по запросу владельца (DELETE /users/me) — с повторной
   * аутентификацией: текущий пароль и, если включена 2FA, её код (`verifyCode` — проверка
   * с общим счётчиком неверных кодов). Раньше необратимую анонимизацию запускал любой, у кого
   * в руках открытая вкладка или access-токен.
   *
   * Порядок — от отказов, которые ничего не тратят, к тем, что тратят: последний админ
   * платформы (409) → пароль (счётчик промахов) → код 2FA последним: резервный код при
   * проверке сгорает, тратить его на запрос, который всё равно отклонён, незачем.
   */
  async deleteOwnAccount(
    userId: string,
    input: { password?: string; code?: string },
    verifyCode: (code: string) => Promise<boolean>,
    ctx: { ip?: string; userAgent?: string } = {},
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { role: true, passwordHash: true, twoFactorEnabled: true },
    })
    if (!user) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }
    if (user.role === Role.PLATFORM_ADMIN) {
      await this.assertNotLastPlatformAdmin(this.prisma, userId)
    }
    const { password, code } = input
    if (!password) {
      throw new AppException('BAD_REQUEST', 'Для удаления аккаунта введите текущий пароль')
    }
    if (user.twoFactorEnabled && !code) {
      throw new AppException('BAD_REQUEST', 'Для удаления аккаунта введите код 2FA')
    }
    await this.assertCurrentPassword(userId, password, user.passwordHash)
    if (user.twoFactorEnabled && !(await verifyCode(code ?? ''))) {
      throw new AppException('INVALID_2FA_CODE', 'Неверный код подтверждения')
    }
    await this.softDeleteSelf(userId, ctx)
  }

  /**
   * Не последний ли это действующий (не удалён, не заблокирован) администратор платформы.
   * Нового выдаёт только сид — инвайтом PLATFORM_ADMIN не завести (ALLOWED_ISSUERS), — и
   * платформа без него остаётся без управления.
   */
  private async assertNotLastPlatformAdmin(db: PrismaTx, userId: string): Promise<void> {
    const others = await db.user.count({
      where: {
        role: Role.PLATFORM_ADMIN,
        deletedAt: null,
        isBlocked: false,
        id: { not: userId },
      },
    })
    if (others === 0) {
      throw new AppException('CONFLICT', 'Нельзя удалить последнего администратора платформы')
    }
  }

  /**
   * Мягкое удаление + анонимизация ПДн (§11.3) + разлогин всех устройств.
   * Затираем ВСЕ персональные поля (не только email/имя), гасим 2FA и приватность,
   * сносим объекты аватара и обложки в MinIO, а также контент профиля: фото/видео, статьи,
   * опросы, альбомы, портфолио и закладки. Структурные поля (role, scope,
   * createdAt) сохраняем: строка нужна для целостности FK контента (посты/сообщения
   * остаются с автором-«tombstone»). Очистка файлов — best-effort: недоступность MinIO
   * не должна блокировать удаление аккаунта (ПДн в БД затираются в любом случае).
   *
   * Повторную аутентификацию проверяет deleteOwnAccount — снаружи звать его, а не этот метод.
   * Последнего администратора платформы не удаляет: проверка до сноса медиа и ещё раз в
   * транзакции под advisory-локом (двое последних, удаляющих себя разом).
   */
  async softDeleteSelf(
    userId: string,
    ctx: { ip?: string; userAgent?: string } = {},
  ): Promise<void> {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    })
    const isPlatformAdmin = current?.role === Role.PLATFORM_ADMIN
    if (isPlatformAdmin) await this.assertNotLastPlatformAdmin(this.prisma, userId)
    await this.deleteUserMedia(userId)
    await this.deleteProfileMedia(userId)
    const anonymizedEmail = `deleted+${userId}@studenthub.invalid`
    // Пароль забиваем невосстановимым хешем случайной строки.
    const anonymizedHash = await this.passwords.hash(`${userId}-${Date.now()}-deleted`)
    // Староста — роль и отметка в группе; удалённому не остаётся ни того, ни другого.
    const demoted = current?.role === Role.STAROSTA ? { role: Role.STUDENT } : {}
    const anonymizeArgs = {
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        email: anonymizedEmail,
        // Имя входа — тоже ПДн, и без обнуления оно оставалось занятым навсегда.
        username: null,
        // Из группы удалённый выходит: иначе группу нельзя было удалить (FK Restrict), а
        // он сам числился в её составе. Оценки и посещаемость привязаны к студенту, не к группе.
        groupId: null,
        ...demoted,
        passwordHash: anonymizedHash,
        firstName: 'Удалённый',
        lastName: 'пользователь',
        avatarUrl: null,
        avatarThumbUrl: null,
        coverUrl: null,
        // Приватность и 2FA
        showEmail: false,
        showPhone: false,
        profileVisibility: 'PRIVATE',
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: [],
        // Общий профиль
        middleName: null,
        phone: null,
        bio: null,
        birthDate: null,
        gender: null,
        languages: [],
        telegram: null,
        instagram: null,
        website: null,
        headline: null,
        timezone: null,
        country: null,
        // Профиль студента/старосты
        course: null,
        enrollmentYear: null,
        graduationYear: null,
        educationLevel: null,
        studyForm: null,
        fundingType: null,
        specialty: null,
        studentCardNumber: null,
        academicStatus: null,
        gpa: null,
        interests: [],
        skills: [],
        dormitory: null,
        address: null,
        starostaSince: null,
        duties: null,
        // Профиль сотрудника
        position: null,
        academicDegree: null,
        academicTitle: null,
        department: null,
        subjects: [],
        officeRoom: null,
        officeHours: null,
        employeeNumber: null,
        researchInterests: null,
        publicationsUrl: null,
        appointmentDate: null,
        workPhone: null,
        jobTitle: null,
        responsibilities: null,
        moderationAreas: null,
      },
    } satisfies Prisma.UserUpdateArgs
    await this.prisma.$transaction(async (tx) => {
      if (isPlatformAdmin) {
        await advisoryXactLock(tx, LAST_PLATFORM_ADMIN_LOCK)
        await this.assertNotLastPlatformAdmin(tx, userId)
      }
      await tx.user.update(anonymizeArgs)
      await tx.group.updateMany({ where: { starostaId: userId }, data: { starostaId: null } })
      // Привязка Telegram — отдельный канал доступа, и разлогин его не гасит: бот и
      // мини-апп узнают человека по telegramId, а не по сессии. Без этого удалённый
      // сотрудник платформы продолжал бы получать уведомления, брать жалобы кнопкой и
      // читать очередь командами. Строку удаляем, а не отзываем: telegramId и username —
      // тоже ПДн, а история «этот Telegram здесь уже был» у удалённого аккаунта никому
      // не нужна и только держала бы уникальный telegramId занятым.
      await tx.telegramAccount.deleteMany({ where: { userId } })
      // Контент профиля — личное, а не общее: статьи, опросы, альбомы и портфолио после
      // удаления продолжали отдаваться с исходным текстом под «Удалённым пользователем».
      // Чужие комментарии к ним, голоса и закладки уходят каскадом. Посты, комментарии
      // и сообщения остаются tombstone-ом — так решено для общих лент и переписки.
      await tx.profileArticle.deleteMany({ where: { userId } })
      await tx.poll.deleteMany({ where: { userId } })
      await tx.album.deleteMany({ where: { userId } })
      await tx.portfolioItem.deleteMany({ where: { userId } })
      await tx.bookmark.deleteMany({ where: { userId } })
    })
    await this.authService.revokeAllUserSessions(userId)
    // Строка журнала переживает анонимизацию: в ней только id, без ПДн удалённого.
    await this.audit.record({
      userId,
      action: 'account_deleted',
      entity: 'User',
      entityId: userId,
      ...ctx,
    })
  }

  /**
   * Фото и видео профиля и обложки статей удаляемого аккаунта (§11.3). Бакеты публичные, ссылки
   * постоянные и уже разошлись (лайтбокс, обложки статей) — затёртое имя в карточке их не прячет.
   * Сносим записи File владельца вместе с объектами: FileService.delete не трогает объект, на
   * который ещё ссылаются другие записи (общий пул сида). Постер видео — raw-объект без записи,
   * его убираем точечно по ключу. Best-effort, как и аватар: недоступность MinIO не должна
   * блокировать удаление аккаунта; что не снеслось, подберёт ночная чистка осиротевших объектов.
   */
  private async deleteProfileMedia(userId: string): Promise<void> {
    const covers = this.coversBucket
    for (const bucket of [this.config.get('MINIO_BUCKET_PROFILE_MEDIA', { infer: true }), covers]) {
      try {
        for (let round = 0; round < ACCOUNT_CONTENT_MAX_ROUNDS; round++) {
          const batch = await this.files.listByOwnerAndBucket(userId, bucket, ACCOUNT_CONTENT_BATCH)
          if (batch.length === 0) break
          let removed = 0
          for (const file of batch) {
            try {
              if (file.posterKey) await this.files.removeRawObject(covers, file.posterKey)
              await this.files.delete(file.id)
              removed++
            } catch (err) {
              this.logger.warn(
                `Не удалось снести файл ${file.id} пользователя ${userId}: ${String(err)}`,
              )
            }
          }
          // Ни один файл пачки не снёсся — дальше те же самые, крутить незачем.
          if (removed === 0) break
        }
      } catch (err) {
        this.logger.warn(`Не удалось снести медиа профиля пользователя ${userId}: ${String(err)}`)
      }
    }
  }

  /** Best-effort снос объектов аватара (+превью) и обложки в MinIO при удалении аккаунта. */
  private async deleteUserMedia(userId: string): Promise<void> {
    try {
      await this.deleteExistingAvatars(
        userId,
        this.config.get('MINIO_BUCKET_AVATARS', { infer: true }),
      )
    } catch (err) {
      this.logger.warn(`Не удалось снести аватары пользователя ${userId}: ${String(err)}`)
    }
    try {
      const prev = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { coverUrl: true },
      })
      const oldKey = prev?.coverUrl ? this.coverKeyFromUrl(prev.coverUrl) : null
      if (oldKey) await this.files.removeRawObject(this.coversBucket, oldKey)
    } catch (err) {
      this.logger.warn(`Не удалось снести обложку пользователя ${userId}: ${String(err)}`)
    }
  }

  /**
   * Карточка человека для модератора: кто он и попадался ли раньше.
   *
   * Отдельно от `GET /users/:id`: тот отдаёт профиль в полсотни полей и без `isBlocked`,
   * а решение по жалобе или обращению принимается по четырём — роль, вуз, состояние
   * доступа и счётчик жалоб. Читает её мини-апп с телефона, поэтому лишних ПДн в ответе
   * нет: ни почты, ни телефона, ни учебных данных.
   *
   * Предупреждения считаются по своей таблице — они переживают чистку журнала аудита,
   * и «второе за месяц» от «первого за два года» отличает именно она.
   *
   * Счётчик жалоб считает жалобы НА САМОГО человека. Жалобы на его посты и сообщения сюда не
   * попадают: собрать их значило бы пройти по всем его сущностям на каждое открытие
   * карточки. Историю по конкретной цели показывает `GET /complaints?targetId=`.
   */
  async moderationCard(viewer: JwtPayload, userId: string) {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        isBlocked: true,
        blockedUntil: true,
        createdAt: true,
        universityId: true,
        university: { select: { id: true, name: true } },
      },
    })
    if (!target) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }
    const isPlatform =
      viewer.role === Role.PLATFORM_ADMIN || viewer.role === Role.PLATFORM_MODERATOR
    if (!isPlatform && target.universityId !== viewer.universityId) {
      throw new AppException('WRONG_SCOPE', 'Пользователь другого университета')
    }

    const [complaints, upheld, warnings] = await this.prisma.$transaction([
      this.prisma.complaint.count({ where: { targetType: 'USER', targetId: userId } }),
      this.prisma.complaint.count({
        where: { targetType: 'USER', targetId: userId, status: 'RESOLVED' },
      }),
      this.prisma.moderationWarning.count({ where: { userId } }),
    ])

    const { universityId, ...rest } = target
    void universityId
    return { ...rest, warnings, complaints: { total: complaints, upheld } }
  }

  /**
   * Блокировка/разблокировка модератором в своём scope. Платформенные роли — глобально;
   * админ/модератор вуза — только свой университет. Блокировка гасит активные сессии.
   *
   * `until` делает блокировку временной: по истечении срока её снимет крон
   * (`CleanupService.liftExpiredBlocks`). Без срока блокировка бессрочная — как была.
   * Разблокировка срок стирает: иначе снятая руками блокировка «снялась» бы второй раз.
   */
  async setBlocked(
    viewer: JwtPayload,
    userId: string,
    blocked: boolean,
    until: Date | null = null,
  ): Promise<void> {
    if (userId === viewer.sub) {
      throw new AppException('BAD_REQUEST', 'Нельзя заблокировать самого себя')
    }
    await this.assertModeratable(viewer, userId)
    await this.prisma.user.update({
      where: { id: userId },
      data: { isBlocked: blocked, blockedUntil: blocked ? until : null },
    })
    if (blocked) {
      await this.authService.revokeAllUserSessions(userId)
    }
    // BACKEND_RULES §13 требует аудита блокировки — записи не было, а это одно из немногих
    // действий, необратимо отключающих человека от платформы. Только id, без ФИО и email.
    await this.audit.record({
      userId: viewer.sub,
      action: blocked ? 'user_blocked' : 'user_unblocked',
      entity: 'User',
      entityId: userId,
      ...(blocked && until ? { metadata: { until: until.toISOString() } } : {}),
    })
  }

  /**
   * Предупреждение — промежуточная мера между «нарушения нет» и блокировкой.
   *
   * Человеку уходит уведомление о самом факте: внутренний комментарий модератора сюда не
   * копируется — его писали не нарушителю. Запись остаётся навсегда, потому что «второе
   * предупреждение за месяц» и «первое за два года» — разные случаи, а по журналу аудита
   * их не отличить: он чистится по расписанию.
   */
  async warn(
    viewer: JwtPayload,
    userId: string,
    complaintId: string | null = null,
  ): Promise<{ total: number }> {
    if (userId === viewer.sub) {
      throw new AppException('BAD_REQUEST', 'Нельзя предупредить самого себя')
    }
    await this.assertModeratable(viewer, userId)

    const warning = await this.prisma.moderationWarning.create({
      data: { userId, issuedById: viewer.sub, complaintId },
      select: { id: true },
    })
    const total = await this.prisma.moderationWarning.count({ where: { userId } })

    await this.queue.enqueue(
      QUEUES.NOTIFICATIONS,
      NOTIFICATION_JOBS.MODERATION_WARNING,
      {
        recipientIds: [userId],
        type: 'SYSTEM',
        titleKey: 'moderation.warning.title',
        bodyKey: 'moderation.warning.body',
        data: { warningId: warning.id },
        dedupeKey: `moderation-warning:${warning.id}`,
      },
      { jobId: `moderation-warning:${warning.id}` },
    )

    await this.audit.record({
      userId: viewer.sub,
      action: 'user_warned',
      entity: 'User',
      entityId: userId,
      metadata: { warningId: warning.id, ...(complaintId ? { complaintId } : {}) },
    })

    return { total }
  }

  /**
   * Завершить все сессии пользователя, не отбирая у него доступ.
   *
   * Угнанный аккаунт до этого останавливали блокировкой целиком — то есть наказывали
   * пострадавшего. Сброс сессий выгоняет чужого и оставляет хозяину возможность войти
   * заново, сменив пароль.
   */
  async revokeSessions(viewer: JwtPayload, userId: string): Promise<void> {
    // Свои сессии завершить можно всегда; чужие — только того, кто ниже по роли.
    if (userId !== viewer.sub) await this.assertModeratable(viewer, userId)

    await this.authService.revokeAllUserSessions(userId)
    await this.audit.record({
      userId: viewer.sub,
      action: 'user_sessions_revoked',
      entity: 'User',
      entityId: userId,
    })
  }

  /**
   * Сброс 2FA человека, потерявшего аутентификатор и не сохранившего backup-коды. Без него
   * выход был один — ручная правка базы разработчиком, а для пяти ролей 2FA обязательна.
   *
   * Кто: строго старший по роли в своём охвате (assertModeratable — те же правила, что у
   * блокировки). Подтверждение — СВОИМ вторым фактором (`confirm`): сброс снимает с чужой
   * учётки защиту, и одной угнанной сессии администратора для этого хватать не должно. Если
   * у самого администратора 2FA нет — отказ: подтвердить ему нечем.
   *
   * Код спрашиваем последним, после всех проверок: backup-код при проверке сгорает, и
   * тратить его на запрос, который всё равно отклонён, незачем.
   *
   * Что делает: выключает 2FA, стирает секрет и backup-коды, гасит все сессии человека
   * (тот, кто вошёл с его паролем и украденным телефоном, вылетает), пишет аудит и шлёт
   * владельцу письмо — если сброс просил не он, он узнает сразу. Привилегированной роли
   * при следующем входе TwoFactorGuard снова предложит настроить 2FA.
   */
  async resetTwoFactor(
    viewer: JwtPayload,
    userId: string,
    confirm: () => Promise<boolean>,
    ctx: { ip?: string; userAgent?: string } = {},
  ): Promise<void> {
    if (userId === viewer.sub) {
      throw new AppException('BAD_REQUEST', 'Свою 2FA отключают в настройках аккаунта')
    }
    await this.assertModeratable(viewer, userId)
    if (!(await this.isTwoFactorEnabled(viewer.sub))) {
      throw new AppException(
        'FORBIDDEN',
        'Сбросить 2FA другому может только тот, у кого она включена',
      )
    }
    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { twoFactorEnabled: true, email: true, firstName: true, locale: true },
    })
    if (!target) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    if (!target.twoFactorEnabled) {
      throw new AppException(
        'BAD_REQUEST',
        'У пользователя двухфакторная аутентификация не включена',
      )
    }
    if (!(await confirm())) {
      throw new AppException('INVALID_2FA_CODE', 'Неверный код подтверждения')
    }

    await this.disableTwoFactor(userId)
    await this.authService.revokeAllUserSessions(userId)
    await this.audit.record({
      userId: viewer.sub,
      action: 'user_2fa_reset',
      entity: 'User',
      entityId: userId,
      ...ctx,
    })
    // jobId с отметкой времени: сбросов одному человеку может быть несколько, и каждый —
    // отдельное письмо. Защита от дубля здесь не нужна — повтор запроса упрётся в «не включена».
    await this.queue.enqueue(
      QUEUES.EMAIL,
      EMAIL_JOBS.SEND_TWO_FACTOR_RESET,
      { to: target.email, locale: target.locale, firstName: target.firstName },
      { jobId: `two-factor-reset:${userId}:${Date.now()}` },
    )
  }

  /**
   * Над кем модератор вправе применить меру (блокировка, предупреждение, сброс сессий и 2FA):
   * человек его вуза (платформенным — любой) и СТРОГО ниже по роли. Без проверки ранга
   * модератор вуза блокировал админа своего вуза, а модератор платформы — её админа, и
   * блокировка тут же гасила все их сессии.
   */
  private async assertModeratable(viewer: JwtPayload, userId: string): Promise<void> {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, universityId: true, role: true },
    })
    if (!target) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }
    const isPlatform =
      viewer.role === Role.PLATFORM_ADMIN || viewer.role === Role.PLATFORM_MODERATOR
    if (!isPlatform && target.universityId !== viewer.universityId) {
      throw new AppException('WRONG_SCOPE', 'Пользователь другого университета')
    }
    if (!isHigherRole(viewer.role, target.role)) {
      throw new AppException('FORBIDDEN', 'Мера доступна только к роли ниже вашей')
    }
  }

  /** Создание пользователя при регистрации по инвайту (в транзакции AuthService). */
  async createInvitedUser(
    tx: PrismaTx,
    data: {
      email: string
      username: string
      passwordHash: string
      firstName: string
      lastName: string
      role: Role
      universityId: string | null
      facultyId: string | null
      groupId: string | null
      birthDate: Date
      consentAt: Date
      consentVersion: string
      consentByGuardian: boolean
    },
  ): Promise<JwtPayload> {
    try {
      const user = await tx.user.create({
        // username нормализуем в нижний регистр (регистронезависимая уникальность).
        data: {
          ...data,
          username: data.username.trim().toLowerCase(),
          profileVisibility: this.defaultVisibilityFor(data.role),
        },
        select: { id: true, role: true, universityId: true, facultyId: true, groupId: true },
      })
      return {
        sub: user.id,
        role: user.role,
        universityId: user.universityId,
        facultyId: user.facultyId,
        groupId: user.groupId,
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Какое поле конфликтует — email или username (target из meta).
        const target = (error.meta?.target as string[] | string | undefined) ?? ''
        const conflictsUsername = Array.isArray(target)
          ? target.includes('username')
          : String(target).includes('username')
        throw new AppException(
          'CONFLICT',
          conflictsUsername
            ? 'Это имя пользователя уже занято'
            : 'Пользователь с таким email уже существует',
        )
      }
      throw error
    }
  }

  // Дефолт видимости профиля по роли: сотрудники/руководство — открыты (PUBLIC),
  // студенты/старосты/модераторы — в пределах вуза (UNIVERSITY), охрана и библиотекарь —
  // закрыт (PRIVATE): их профиль на платформе никому не нужен, а кто дежурит на вахте или
  // выдаёт книги — сведения вуза.
  // Владелец меняет в настройках.
  private defaultVisibilityFor(role: Role): string {
    switch (role) {
      case Role.SECURITY_GUARD:
      case Role.LIBRARIAN:
        return 'PRIVATE'
      case Role.PLATFORM_ADMIN:
      case Role.UNIVERSITY_ADMIN:
      case Role.DEAN:
      case Role.TEACHER:
        return 'PUBLIC'
      default:
        return 'UNIVERSITY'
    }
  }
}

/**
 * Потолок одной выгрузки. Пять тысяч строк — это книга примерно на мегабайт, которую
 * SheetJS собирает в памяти целиком; выше начинается риск для процесса, а не польза для
 * деканата. Больше — повод сузить фильтр или просить постраничную выдачу.
 */
const EXPORT_MAX_ROWS = 5000
const EXPORT_PAGE_SIZE = 500

interface ExportUserRow {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  isBlocked: boolean
  createdAt: Date
}

/**
 * Заголовки колонок выгрузки. Живут в модуле-владельце отчёта, а не в общем словаре
 * брендирования: состав колонок — это про пользователей, и общий слой о нём знать не
 * должен. Когда отчётов станет много, их стоит собрать в один справочник.
 *
 * Роль остаётся кодом (`STUDENT`), а не переводится: по ней фильтруют и сверяют с API,
 * а перевод превратил бы значение в текст, зависящий от языка выгрузки.
 */
const EXPORT_HEADERS: Record<ExportLocale, Record<keyof ExportUserRow, string>> = {
  ru: {
    id: 'ID',
    email: 'Email',
    lastName: 'Фамилия',
    firstName: 'Имя',
    role: 'Роль',
    isBlocked: 'Заблокирован',
    createdAt: 'Дата регистрации',
  },
  kk: {
    id: 'ID',
    email: 'Email',
    lastName: 'Тегі',
    firstName: 'Аты',
    role: 'Рөлі',
    isBlocked: 'Бұғатталған',
    createdAt: 'Тіркелген күні',
  },
  en: {
    id: 'ID',
    email: 'Email',
    lastName: 'Last name',
    firstName: 'First name',
    role: 'Role',
    isBlocked: 'Blocked',
    createdAt: 'Registered at',
  },
}

function exportColumns(locale: ExportLocale, timezone: string): SpreadsheetColumn<ExportUserRow>[] {
  const header = EXPORT_HEADERS[locale]
  // Дата в таймзоне вуза и без её подписи в каждой ячейке: таймзона названа один раз на
  // листе «Инфо». Строкой, а не датой Excel: серийная дата у SheetJS пишется без зоны,
  // и файл, открытый в другой стране, показал бы другое время.
  const dateFormat = new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return [
    { header: header.id, value: (r) => r.id, width: 38 },
    { header: header.email, value: (r) => r.email, width: 28 },
    { header: header.lastName, value: (r) => r.lastName, width: 18 },
    { header: header.firstName, value: (r) => r.firstName, width: 18 },
    { header: header.role, value: (r) => r.role, width: 22 },
    { header: header.isBlocked, value: (r) => r.isBlocked, width: 14 },
    { header: header.createdAt, value: (r) => dateFormat.format(r.createdAt), width: 18 },
  ]
}

/** Поля бланка справки об обучении: всё, что платформа знает о студенте как об учащемся. */
export interface AcademicSubject {
  fullName: string
  specialty: string | null
  course: number | null
  educationLevel: string | null
  studyForm: string | null
  fundingType: string | null
  enrollmentYear: number | null
  graduationYear: number | null
  academicStatus: string | null
  studentCardNumber: string | null
  groupName: string | null
  facultyName: string | null
  universityName: string | null
  universityCity: string | null
  timezone: string
}
