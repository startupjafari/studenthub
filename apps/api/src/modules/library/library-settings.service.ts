import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type {
  LibrarySettingsResponse,
  UpdateLibrarySettingsInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { libraryConflict, managedLibrary, memberLibrary } from './library-scope'

const SETTINGS_SELECT = {
  enabled: true,
  defaultLoanDays: true,
  maxLoanDays: true,
  maxActiveLoans: true,
  maxActiveReservations: true,
  reservationHoldDays: true,
  maxRenewals: true,
  updatedAt: true,
} satisfies Prisma.LibrarySettingsSelect

/** Правила по умолчанию — те же, что в схеме: вуз, который ещё ничего не менял. */
const DEFAULTS: LibrarySettingsResponse = {
  enabled: false,
  defaultLoanDays: 14,
  maxLoanDays: 120,
  maxActiveLoans: 5,
  maxActiveReservations: 3,
  reservationHoldDays: 3,
  maxRenewals: 1,
  updatedAt: null,
}

type SettingsRow = Prisma.LibrarySettingsGetPayload<{ select: typeof SETTINGS_SELECT }>

function toResponse(row: SettingsRow | null): LibrarySettingsResponse {
  if (!row) return DEFAULTS
  return { ...row, updatedAt: row.updatedAt.toISOString() }
}

// Выключатель модуля и правила выдачи вуза (docs/PROJECT.md §3.11). По умолчанию модуль
// ВЫКЛЮЧЕН: нет записи — выключен, вуз включает библиотеку сам. Выключенный модуль
// закрывает выдачу, возврат и брони `409` (`details.field = module`), а каталог и история
// остаются — включили обратно, и всё на месте.
@Injectable()
export class LibrarySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Настройки вуза — их видят все, кому открыта библиотека: по ним клиент строит экраны. */
  async forActor(actor: JwtPayload): Promise<LibrarySettingsResponse> {
    return this.get(memberLibrary(actor))
  }

  async get(universityId: string): Promise<LibrarySettingsResponse> {
    const row = await this.prisma.librarySettings.findUnique({
      where: { universityId },
      select: SETTINGS_SELECT,
    })
    return toResponse(row)
  }

  /** Настройки включённого модуля; выключен — `409` с `details.field = module`. */
  async requireEnabled(universityId: string): Promise<LibrarySettingsResponse> {
    const settings = await this.get(universityId)
    if (!settings.enabled) throw libraryConflict('module', 'Библиотека вуза выключена')
    return settings
  }

  async update(
    actor: JwtPayload,
    input: UpdateLibrarySettingsInput,
    ctx: RequestContext,
  ): Promise<LibrarySettingsResponse> {
    const universityId = managedLibrary(actor)
    const current = await this.get(universityId)
    const next = { ...current, ...input }
    if (next.defaultLoanDays > next.maxLoanDays) {
      throw new AppException('VALIDATION_ERROR', 'Срок по умолчанию больше максимального', [
        { field: 'defaultLoanDays', message: 'Не больше максимального срока' },
      ])
    }
    const data = {
      enabled: next.enabled,
      defaultLoanDays: next.defaultLoanDays,
      maxLoanDays: next.maxLoanDays,
      maxActiveLoans: next.maxActiveLoans,
      maxActiveReservations: next.maxActiveReservations,
      reservationHoldDays: next.reservationHoldDays,
      maxRenewals: next.maxRenewals,
      updatedById: actor.sub,
    }
    const row = await this.prisma.librarySettings.upsert({
      where: { universityId },
      create: { universityId, ...data },
      update: data,
      select: SETTINGS_SELECT,
    })
    const toggled = input.enabled !== undefined && input.enabled !== current.enabled
    await this.audit.record({
      userId: actor.sub,
      action: toggled
        ? next.enabled
          ? 'library_enabled'
          : 'library_disabled'
        : 'library_settings_updated',
      entity: 'LibrarySettings',
      entityId: universityId,
      metadata: { universityId, changes: input },
      ...ctx,
    })
    return toResponse(row)
  }
}
