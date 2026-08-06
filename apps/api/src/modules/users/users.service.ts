import { forwardRef, Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { UserListQueryInput, UpdateProfileInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PasswordService } from '../../common/security/password.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { FileService } from '../files/file.service'
import { RealtimeGateway } from '../../common/realtime'
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
}

const PROFILE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  middleName: true,
  avatarUrl: true,
  role: true,
  showEmail: true,
  showPhone: true,
  profileVisibility: true,
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
  'email' | 'phone' | 'showEmail' | 'showPhone' | 'studentCardNumber' | 'employeeNumber' | 'address'
> & { email: string | null; phone: string | null; access: ProfileAccessLevel }

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly files: FileService,
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
  ) {}

  /** Статус присутствия пользователя (онлайн по активным WS-соединениям, docs/PROJECT.md §9). */
  getPresence(userId: string): { online: boolean } {
    return { online: this.realtime.isOnline(userId) }
  }

  /** Для AuthService (LocalStrategy): запись с passwordHash. passwordHash не покидает auth-домен. */
  findByEmailForAuth(email: string): Promise<AuthUserRecord | null> {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: {
        id: true,
        passwordHash: true,
        role: true,
        isBlocked: true,
        universityId: true,
        facultyId: true,
        groupId: true,
      },
    })
  }

  /** Для AuthService.refresh: актуальные роль/scope/блокировка по id (без passwordHash). */
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
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...this.listScope(viewer),
      ...(query.role ? { role: query.role as Role } : {}),
      ...(query.facultyId ? { facultyId: query.facultyId } : {}),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.blocked !== undefined ? { isBlocked: query.blocked } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
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
   * Генерация превью (job generate-thumbnail) отложена до появления очередей (Ф3).
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
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: PROFILE_SELECT,
    })
  }

  /** Удаление аватара: снимает объект(ы) в MinIO и обнуляет avatarUrl. */
  async removeAvatar(userId: string): Promise<UserProfile> {
    const bucket = this.config.get('MINIO_BUCKET_AVATARS', { infer: true })
    await this.deleteExistingAvatars(userId, bucket)
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
      select: PROFILE_SELECT,
    })
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

  // Публичный URL объекта в публичном бакете (avatars). В dev — прямой адрес MinIO.
  private buildPublicUrl(bucket: string, key: string): string {
    const scheme = this.config.get('MINIO_USE_SSL', { infer: true }) ? 'https' : 'http'
    const endpoint = this.config.get('MINIO_ENDPOINT', { infer: true })
    const port = this.config.get('MINIO_PORT', { infer: true })
    return `${scheme}://${endpoint}:${port}/${bucket}/${key}`
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

    const access = this.resolveAccess(viewer, target)
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
      ...rest
    } = target
    void showEmail
    void studentCardNumber
    void employeeNumber
    void address
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

  /** Мягкое удаление + анонимизация ПДн (§11.3) + разлогин всех устройств. */
  async softDeleteSelf(userId: string): Promise<void> {
    const anonymizedEmail = `deleted+${userId}@studenthub.invalid`
    // Пароль забиваем невосстановимым хешем случайной строки.
    const anonymizedHash = await this.passwords.hash(`${userId}-${Date.now()}-deleted`)
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        email: anonymizedEmail,
        firstName: 'Удалённый',
        lastName: 'пользователь',
        avatarUrl: null,
        passwordHash: anonymizedHash,
      },
    })
    await this.authService.revokeAllUserSessions(userId)
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
        data: { ...data, profileVisibility: this.defaultVisibilityFor(data.role) },
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
        throw new AppException('CONFLICT', 'Пользователь с таким email уже существует')
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
