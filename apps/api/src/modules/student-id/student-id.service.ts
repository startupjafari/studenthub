import { Injectable } from '@nestjs/common'
import * as QRCode from 'qrcode'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { CryptoService } from '../../common/security/crypto.service'
import { ConfigService } from '@nestjs/config'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'

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
  course: true,
  enrollmentYear: true,
  graduationYear: true,
  universityId: true,
  group: { select: { name: true } },
  faculty: { select: { name: true } },
  university: { select: { name: true, shortName: true } },
} satisfies Prisma.UserSelect

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class StudentIdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<EnvVars, true>,
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
    const qr = await QRCode.toDataURL(
      `${this.webBase()}/verify-id?t=${encodeURIComponent(token)}`,
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
  async verify(verifier: JwtPayload, token: string) {
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
    // Время проверки — для отображения на странице верификации (когда сотрудник сканировал).
    return { valid: true, verifiedAt: new Date().toISOString(), ...this.toCard(user) }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

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

  private webBase(): string {
    return this.config.get('CORS_ORIGIN', { infer: true }).split(',')[0]?.trim() ?? ''
  }
}
