import { Inject, Injectable, Logger } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type Redis from 'ioredis'
import { renderQrDataUrl } from '../../common/qr/qr-image'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { CryptoService } from '../../common/security/crypto.service'
import { AuditService } from '../../common/audit/audit.service'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { ConfigService } from '@nestjs/config'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { webBaseUrl } from '../../config/web-base'

// TTL токена верификации ~2 мин: QR на фронте ротируется каждые ~45с (принцип «динамический QR
// каждые 30-60с»), TTL держим чуть длиннее интервала, чтобы только что показанный код был
// действителен при живом сканировании и не «истекал в руках» сотрудника.
const ID_TTL_MS = 120_000

// Дискриминатор назначения токена (в зашифрованном payload): защита от подмены токеном
// другого назначения.
const ID_TYP = 'student-id'

interface IdPayload {
  typ: typeof ID_TYP
  sub: string
  exp: number
}

const CARD_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  middleName: true,
  avatarUrl: true,
  avatarThumbUrl: true,
  role: true,
  studentCardNumber: true,
  academicStatus: true,
  educationLevel: true,
  studyForm: true,
  // Специальность, финансирование и общежитие: реквизиты бумажного билета, по которым
  // сотрудник на вахте и в деканате опознаёт студента. Карту видит либо сам студент,
  // либо сотрудник своего вуза (scope проверяется ниже) — наружу они не уходят. Все три
  // ведёт вуз (STAFF_MANAGED_STUDENT_FIELDS); дату рождения — сам студент, см. SELF_DECLARED.
  specialty: true,
  fundingType: true,
  dormitory: true,
  birthDate: true,
  course: true,
  enrollmentYear: true,
  graduationYear: true,
  universityId: true,
  group: { select: { name: true } },
  faculty: { select: { name: true } },
  university: { select: { name: true, shortName: true } },
} satisfies Prisma.UserSelect

/**
 * Поля карты, которые студент заполняет сам (PATCH /users/me), а вуз не проверял. Результат
 * проверки перечисляет их в `selfDeclared`, и клиент помечает «со слов студента»: иначе
 * охранник видел дату рождения рядом с «билет действителен» и принимал её за проверенную
 * вузом (проверка возраста). Учебные данные и общежитие ведёт вуз — их здесь нет.
 */
const SELF_DECLARED = ['birthDate'] as const

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class StudentIdService {
  private readonly logger = new Logger(StudentIdService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Моя карта (студент/староста): данные + ЗАШИФРОВАННЫЙ QR-токен для верификации личности.
   * Токен — AES-256-GCM(payload) (см. CryptoService), поэтому в QR не читается ни прямой id
   * пользователя, ни персональные данные — только непрозрачный шифртекст с TTL внутри.
   */
  async myCard(viewer: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: viewer.sub },
      select: CARD_SELECT,
    })
    if (!user) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    const exp = Date.now() + ID_TTL_MS
    const payload: IdPayload = { typ: ID_TYP, sub: viewer.sub, exp }
    const token = this.crypto.encrypt(JSON.stringify(payload))
    const qr = renderQrDataUrl(
      `${webBaseUrl(this.config)}/verify-id?t=${encodeURIComponent(token)}`,
      { margin: 1, width: 320 },
    )
    return {
      ...this.toCard(user),
      token,
      qr,
      expiresAt: new Date(exp).toISOString(),
      ttlSeconds: ID_TTL_MS / 1000,
    }
  }

  /** Верификация карты сотрудником: расшифровка токена + область видимости (тот же вуз). */
  async verify(verifier: JwtPayload, token: string, ctx: { ip?: string; userAgent?: string } = {}) {
    const payload = this.verifyIdToken(token)
    // Исключаем удалённых/заблокированных: их билет недействителен даже в пределах TTL токена.
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, isBlocked: false },
      select: CARD_SELECT,
    })
    if (!user) throw new AppException('NOT_FOUND', 'Студент не найден или билет недействителен')
    if (!isPlatform(verifier.role) && user.universityId !== verifier.universityId) {
      throw new AppException('WRONG_SCOPE', 'Студент другого университета')
    }
    // После проверки области: сотрудник чужого вуза код не «забирает».
    await this.claimToken(token, payload.exp, verifier.sub)
    const card = this.toCard(user)
    // Староста, преподаватель и охрана проверяют, что перед ними студент вуза (на паре, на
    // мероприятии, на входе, на выдаче книг) — им хватает ФИО, фото, группы и статуса. Дата
    // рождения, грант/платное и общежитие нужны деканату и администрации, а не однокурснику,
    // лектору, вахте или библиотеке.
    const narrow =
      verifier.role === Role.STAROSTA ||
      verifier.role === Role.TEACHER ||
      verifier.role === Role.SECURITY_GUARD ||
      verifier.role === Role.LIBRARIAN
    const shown = {
      ...card,
      ...(narrow ? { birthDate: null, fundingType: null, dormitory: null } : {}),
    }
    // Проверка отдаёт сотруднику учебные данные студента, а широкая — ещё дату рождения,
    // форму оплаты и общежитие: доступ к ПДн пишется в журнал, как просмотр закрытого
    // профиля (PROFILE_VIEW_PRIVATE). В записи — кто и кого, без самих данных.
    await this.audit.record({
      userId: verifier.sub,
      action: 'student_id_verified',
      entity: 'User',
      entityId: user.id,
      metadata: { role: verifier.role, scope: narrow ? 'narrow' : 'full' },
      ...ctx,
    })
    // Время проверки — для отображения на странице верификации (когда сотрудник сканировал).
    // selfDeclared — только те поля «со слов студента», что реально есть в ответе.
    return {
      valid: true,
      verifiedAt: new Date().toISOString(),
      ...shown,
      selfDeclared: SELF_DECLARED.filter((field) => shown[field] != null),
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /**
   * QR студенческого — разовый пропуск: код «забирает» первый проверивший сотрудник, и
   * скриншот, пересланный другому, больше не проходит, хотя двухминутный срок не вышел.
   * Тот же сотрудник может открыть результат снова (перезагрузка, возврат назад) — это не
   * новый пропуск. Ключ — хэш токена: карта шифруется при каждом показе заново (случайный
   * IV), токены не повторяются. Redis недоступен — пропускаем без отметки: проверка карты
   * на вахте важнее, а срок токена всё равно короткий.
   */
  private async claimToken(token: string, exp: number, verifierId: string): Promise<void> {
    const key = `student-id:used:${createHash('sha256').update(token).digest('hex')}`
    try {
      const first = await this.redis.set(
        key,
        verifierId,
        'PX',
        Math.max(exp - Date.now(), 1000),
        'NX',
      )
      if (first === 'OK' || (await this.redis.get(key)) === verifierId) return
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Redis недоступен — одноразовость кода студенческого не проверена',
      )
      return
    }
    throw new AppException('CONFLICT', 'Код уже проверен — попросите студента обновить карту')
  }

  private toCard(user: Prisma.UserGetPayload<{ select: typeof CARD_SELECT }>) {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      middleName: user.middleName,
      avatarUrl: user.avatarThumbUrl ?? user.avatarUrl,
      role: user.role,
      studentCardNumber: user.studentCardNumber,
      academicStatus: user.academicStatus,
      educationLevel: user.educationLevel,
      studyForm: user.studyForm,
      specialty: user.specialty,
      fundingType: user.fundingType,
      dormitory: user.dormitory,
      // Дата рождения — ISO-строка: на карте показывается только день, но формат даты
      // выбирает клиент по своей локали.
      birthDate: user.birthDate?.toISOString() ?? null,
      course: user.course,
      enrollmentYear: user.enrollmentYear,
      graduationYear: user.graduationYear,
      group: user.group?.name ?? null,
      faculty: user.faculty?.name ?? null,
      university: user.university?.name ?? null,
      universityShort: user.university?.shortName ?? null,
    }
  }

  private verifyIdToken(token: string): IdPayload {
    let payload: IdPayload
    try {
      payload = JSON.parse(this.crypto.decrypt(token)) as IdPayload
    } catch {
      // Битый/подделанный/чужой шифртекст — decrypt бросит на неверном auth-tag.
      throw new AppException('UNAUTHORIZED', 'Недействительный код')
    }
    if (payload.typ !== ID_TYP || typeof payload.sub !== 'string') {
      throw new AppException('BAD_REQUEST', 'Некорректный код')
    }
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
      throw new AppException('BAD_REQUEST', 'Код истёк — обновите карту')
    }
    return payload
  }
}
