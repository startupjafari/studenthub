import type { Prisma } from '@prisma/client'
import { isAdult, LEGAL_VERSION } from '@studenthub/shared-schemas'

/**
 * Согласие на обработку персональных данных у владельца аккаунта (A-F29).
 *
 * Согласие пишется при регистрации вместе с редакцией документов и основанием (сам человек
 * или законный представитель). Дальше оно может перестать подходить двумя путями: сменилась
 * редакция (`LEGAL_VERSION`), или дата рождения в профиле разошлась с основанием — человек
 * поставил дату несовершеннолетнего, хотя соглашался сам, либо ему исполнилось 18, а согласие
 * давал представитель. В обоих случаях клиент показывает экран принятия
 * (`POST /users/me/consent`).
 */
export interface ConsentState {
  /** Нужно принять согласие заново. */
  required: boolean
  /** Почему: новая редакция документов или основание разошлось с возрастом. */
  reason: 'VERSION' | 'AGE_BASIS' | null
  /** Действующая редакция документов. */
  version: string
  /** Редакция, на которую согласие дано; null — учётка заведена до появления согласия. */
  acceptedVersion: string | null
  acceptedAt: Date | null
  /** Согласие давал законный представитель. */
  byGuardian: boolean
  /** По дате рождения человеку нет 18 — принимать должен законный представитель. */
  guardianRequired: boolean
  /** Даты рождения в профиле нет — без неё не решить, чьё согласие нужно. */
  birthDateRequired: boolean
}

export interface ConsentRecord {
  consentAt: Date | null
  consentVersion: string | null
  consentByGuardian: boolean
  birthDate: Date | null
}

/** Поля пользователя, из которых складывается состояние согласия. */
export const CONSENT_SELECT = {
  consentAt: true,
  consentVersion: true,
  consentByGuardian: true,
  birthDate: true,
} satisfies Prisma.UserSelect

/** Дата рождения из БД (полночь UTC) — в ISO `YYYY-MM-DD`, как её понимает `isAdult`. */
export function birthDateIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function consentStateOf(record: ConsentRecord, now: Date = new Date()): ConsentState {
  const minor = record.birthDate ? !isAdult(birthDateIso(record.birthDate), now) : null
  // Учётки, заведённые до появления согласия (NULL), этим механизмом не спрашиваются:
  // задним числом согласие не выдумывается, а разом показать экран всем прежним
  // пользователям (и сиду стенда) — отдельное решение владельца продукта.
  const reason: ConsentState['reason'] =
    record.consentVersion === null
      ? null
      : record.consentVersion !== LEGAL_VERSION
        ? 'VERSION'
        : minor !== null && minor !== record.consentByGuardian
          ? 'AGE_BASIS'
          : null
  return {
    required: reason !== null,
    reason,
    version: LEGAL_VERSION,
    acceptedVersion: record.consentVersion,
    acceptedAt: record.consentAt,
    byGuardian: record.consentByGuardian,
    guardianRequired: minor === true,
    birthDateRequired: record.birthDate === null,
  }
}
