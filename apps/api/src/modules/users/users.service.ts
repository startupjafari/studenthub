import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { UserListQueryInput, UpdateProfileInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { buildPublicObjectUrl } from '../../common/minio/public-url'
import { PasswordService } from '../../common/security/password.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import sharp from 'sharp'
import { FileService } from '../files/file.service'
import { RealtimeGateway } from '../../common/realtime'
import { QueueService, QUEUES, FILE_JOBS } from '../../common/queue'
// forwardRef: единственное разрешённое кольцо AuthModule ↔ UsersModule (§2.1) —
// смена пароля/удаление/блокировка обязаны погасить сессии, которыми владеет AuthService.
import { AuthService } from '../auth/auth.service'

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
}

const PROFILE_SELECT = {
  id: true,
  email: true,
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
> & { email: string | null; phone: string | null; access: ProfileAccessLevel }

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
  ) {}

  /** Статус присутствия пользователя (онлайн по активным WS-соединениям, docs/PROJECT.md §9). */
  getPresence(userId: string): { online: boolean } {
    return { online: this.realtime.isOnline(userId) }
  }

  /**
   * Для AuthService (LocalStrategy): запись с passwordHash по email ИЛИ username (Telegram-стиль вход).
   * username хранится в нижнем регистре — приводим идентификатор к нижнему для сопоставления.
   * passwordHash не покидает auth-домен.
   */
  findByLoginIdentifierForAuth(identifier: string): Promise<AuthUserRecord | null> {
    const normalized = identifier.trim().toLowerCase()
    return this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ email: identifier.trim() }, { username: normalized }],
      },
      select: {
        id: true,
        passwordHash: true,
        role: true,
        isBlocked: true,
        universityId: true,
        facultyId: true,
        groupId: true,
        twoFactorEnabled: true,
      },
    })
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
  async list(viewer: JwtPayload, query: UserListQueryInput): Promise<Paginated<unknown>> {
    // scope и клиентские фильтры — через AND: ?facultyId=/?groupId= обязаны СУЖАТЬ scope,
    // а не перезаписывать его (spread по общему ключу facultyId дал бы декану выборку
    // пользователей чужого факультета/вуза с email — cross-tenant PII). См. §14.7/§14.10.
    const where: Prisma.UserWhereInput = {
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
          createdAt: true,
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ])
    return new Paginated(rows, { total })
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

  // Обновление профиля: принимает валидированный расширенный DTO (Zod-strict), пишем как есть.
  // Роль и scope (university/faculty/group) здесь не меняются — только «самоописываемые» поля.
  async updateProfile(userId: string, data: UpdateProfileInput): Promise<UserProfile> {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: PROFILE_SELECT,
    })
  }

  /**
   * Загрузка аватара (docs/PROJECT.md §4, задача 4.3): изображение в публичный бакет avatars
   * через FileService, ссылка — прямой публичный URL. Прежний аватар удаляется (без сирот).
   * Превью (≈128px) генерируется асинхронно джобой generate-thumbnail; до готовности
   * avatarThumbUrl = null и клиент показывает полноразмерный avatarUrl.
   */
  async setAvatar(userId: string, buffer: Buffer): Promise<UserProfile> {
    const bucket = this.config.get('MINIO_BUCKET_AVATARS', { infer: true })
    await this.deleteExistingAvatars(userId, bucket)
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
    await this.prisma.user.updateMany({
      where: { id: data.userId, deletedAt: null },
      data: { avatarThumbUrl },
    })
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

  // Бакет avatars используется только под аватары, поэтому все файлы пользователя в нём —
  // его прежние аватары; удаляем их при замене/сбросе.
  private async deleteExistingAvatars(userId: string, bucket: string): Promise<void> {
    const existing = await this.prisma.file.findMany({
      where: { ownerId: userId, bucket },
      select: { id: true },
    })
    for (const f of existing) {
      await this.files.delete(f.id)
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

    let access = this.resolveAccess(viewer, target)
    // Дружба открывает профиль: принятая дружба — взаимно; ПЕНДИНГ-заявка ОТ владельца закрытого
    // профиля к смотрящему — открывает профиль владельца этому смотрящему (он решает, принять ли).
    if (access.level === 'limited' && viewer.sub !== target.id) {
      const link = await this.prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId: viewer.sub, addresseeId: target.id },
            { requesterId: target.id, addresseeId: viewer.sub },
          ],
        },
        select: { status: true, requesterId: true },
      })
      const opened =
        link?.status === 'ACCEPTED' ||
        (link?.status === 'PENDING' && link.requesterId === target.id)
      if (opened) access = { level: 'full', audit: false }
    }
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
      ...rest
    } = target
    void showEmail
    void studentCardNumber
    void employeeNumber
    void address
    // Наличие 2FA — приватная деталь владельца, не отдаём чужим.
    void twoFactorEnabled
    return {
      ...rest,
      email: this.canSeeEmail(viewer, target) ? email : null,
      phone: showPhone || viewer.sub === target.id ? phone : null,
      gpa: this.canSeeAcademicRecords(viewer, target) ? gpa : null,
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
  async setBackupCodes(userId: string, hashes: string[]): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorBackupCodes: hashes },
    })
  }

  /** Смена пароля: сверка текущего + инвалидация ВСЕХ сессий пользователя (§?). */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { passwordHash: true },
    })
    if (!user) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }
    const ok = await this.passwords.compare(currentPassword, user.passwordHash)
    if (!ok) {
      // 400, а не 401 — чтобы не триггерить авто-refresh на фронте.
      throw new AppException('BAD_REQUEST', 'Неверный текущий пароль')
    }
    const passwordHash = await this.passwords.hash(newPassword)
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } })
    await this.authService.revokeAllUserSessions(userId)
  }

  /**
   * Мягкое удаление + анонимизация ПДн (§11.3) + разлогин всех устройств.
   * Затираем ВСЕ персональные поля (не только email/имя), гасим 2FA и приватность,
   * а также сносим объекты аватара и обложки в MinIO. Структурные поля (role, scope,
   * createdAt) сохраняем: строка нужна для целостности FK контента (посты/сообщения
   * остаются с автором-«tombstone»). Очистка файлов — best-effort: недоступность MinIO
   * не должна блокировать удаление аккаунта (ПДн в БД затираются в любом случае).
   */
  async softDeleteSelf(userId: string): Promise<void> {
    await this.deleteUserMedia(userId)
    const anonymizedEmail = `deleted+${userId}@studenthub.invalid`
    // Пароль забиваем невосстановимым хешем случайной строки.
    const anonymizedHash = await this.passwords.hash(`${userId}-${Date.now()}-deleted`)
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        email: anonymizedEmail,
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
    })
    await this.authService.revokeAllUserSessions(userId)
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
   * Блокировка/разблокировка модератором в своём scope. Платформенные роли — глобально;
   * админ/модератор вуза — только свой университет. Блокировка гасит активные сессии.
   */
  async setBlocked(viewer: JwtPayload, userId: string, blocked: boolean): Promise<void> {
    if (userId === viewer.sub) {
      throw new AppException('BAD_REQUEST', 'Нельзя заблокировать самого себя')
    }
    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, universityId: true },
    })
    if (!target) {
      throw new AppException('NOT_FOUND', 'Пользователь не найден')
    }
    const isPlatform =
      viewer.role === Role.PLATFORM_ADMIN || viewer.role === Role.PLATFORM_MODERATOR
    if (!isPlatform && target.universityId !== viewer.universityId) {
      throw new AppException('WRONG_SCOPE', 'Пользователь другого университета')
    }
    await this.prisma.user.update({ where: { id: userId }, data: { isBlocked: blocked } })
    if (blocked) {
      await this.authService.revokeAllUserSessions(userId)
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
  // студенты/старосты/модераторы — в пределах вуза (UNIVERSITY). Владелец меняет в настройках.
  private defaultVisibilityFor(role: Role): string {
    switch (role) {
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
