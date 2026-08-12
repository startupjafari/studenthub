import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as QRCode from 'qrcode'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { signToken, verifyToken, type SignedPayload } from '../../common/crypto/signed-token'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'

// TTL токена верификации: дольше, чем у QR-отметки — сотрудник сканирует «вживую».
const ID_TTL_MS = 300_000

// Дискриминатор назначения токена: тот же секрет подписывает и QR-отметку, поэтому проверяем typ.
const ID_TYP = 'student-id'

interface IdPayload extends SignedPayload {
  typ: typeof ID_TYP
  sub: string
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
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  /** Моя карта (студент/староста): данные + подписанный QR для верификации личности. */
  async myCard(viewer: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: viewer.sub },
      select: CARD_SELECT,
    })
    if (!user) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    const exp = Date.now() + ID_TTL_MS
    const token = signToken<IdPayload>({ typ: ID_TYP, sub: viewer.sub, exp }, this.secret())
    const qr = await QRCode.toDataURL(
      `${this.webBase()}/verify-id?t=${encodeURIComponent(token)}`,
      {
        margin: 1,
        width: 320,
      },
    )
    return {
      ...this.toCard(user),
      token,
      qr,
      expiresAt: new Date(exp).toISOString(),
      ttlSeconds: ID_TTL_MS / 1000,
    }
  }

  /** Верификация карты сотрудником: сверяем подпись + область видимости (тот же вуз). */
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
    return { valid: true, ...this.toCard(user) }
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
      enrollmentYear: user.enrollmentYear,
      graduationYear: user.graduationYear,
      group: user.group?.name ?? null,
      faculty: user.faculty?.name ?? null,
      university: user.university?.name ?? null,
      universityShort: user.university?.shortName ?? null,
    }
  }

  private secret(): string {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true })
  }

  private verifyIdToken(token: string): IdPayload {
    const res = verifyToken<IdPayload>(token, this.secret(), Date.now())
    if (!res.ok) {
      if (res.reason === 'expired') {
        throw new AppException('BAD_REQUEST', 'Код истёк — обновите карту')
      }
      if (res.reason === 'invalid') throw new AppException('UNAUTHORIZED', 'Недействительный код')
      throw new AppException('BAD_REQUEST', 'Некорректный код')
    }
    // Токен другого назначения (напр. QR-отметки), но с той же подписью — не наш.
    if (res.payload.typ !== ID_TYP || typeof res.payload.sub !== 'string') {
      throw new AppException('BAD_REQUEST', 'Некорректный код')
    }
    return res.payload
  }

  private webBase(): string {
    return this.config.get('CORS_ORIGIN', { infer: true }).split(',')[0]?.trim() ?? ''
  }
}
