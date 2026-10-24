'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { PROFILE_MEDIA_QUOTA, PROFILE_MEDIA_QUOTA_FIELD } from '@studenthub/shared-config'
import { profileContentKeys, type ProfileMedia } from '../../../entities/profile-content'
import { formatBytes, toApiError, useByteUnitLabel } from '../../../shared/lib'

/**
 * Квота медиа профиля (PROFILE_MEDIA_QUOTA): сколько фото и видео и на какой объём можно
 * держать в профиле. Решает сервер (409 с полем квоты), а клиент проверяет заранее — по
 * уже загруженному списку, — чтобы человек не кадрировал фото и не выбирал обложку видео
 * ради загрузки, которая всё равно не пройдёт.
 */

export type MediaQuotaLimit = 'files' | 'bytes'

export interface MediaUsage {
  files: number
  bytes: number
}

/** Использовано по списку медиа владельца (он отдаётся с потолком, равным квоте числа). */
export function mediaUsage(items: readonly { size: number }[]): MediaUsage {
  return { files: items.length, bytes: items.reduce((sum, m) => sum + m.size, 0) }
}

/** Какой предел превысит ещё один файл на `incoming` байт; null — влезает. */
export function mediaQuotaExceeded(usage: MediaUsage, incoming: number): MediaQuotaLimit | null {
  if (usage.files + 1 > PROFILE_MEDIA_QUOTA.MAX_FILES) return 'files'
  if (usage.bytes + incoming > PROFILE_MEDIA_QUOTA.MAX_BYTES) return 'bytes'
  return null
}

/** Показывать ли подсказку о заполненности: от 80 % любого из пределов. */
export function mediaQuotaNear(usage: MediaUsage): boolean {
  return (
    usage.files >= PROFILE_MEDIA_QUOTA.MAX_FILES * 0.8 ||
    usage.bytes >= PROFILE_MEDIA_QUOTA.MAX_BYTES * 0.8
  )
}

/** Отказ сервера по квоте: 409 с полем квоты в details. Иначе null. */
export function mediaQuotaFromError(error: unknown): MediaQuotaLimit | null {
  const api = toApiError(error)
  if (api.code !== 'CONFLICT') return null
  const detail = api.details?.find((d) => d.field === PROFILE_MEDIA_QUOTA_FIELD)
  if (!detail) return null
  return detail.message === 'bytes' ? 'bytes' : 'files'
}

export interface MediaQuotaApi {
  /** Текст о превышении предела — для тоста. */
  message: (limit: MediaQuotaLimit) => string
  /** Строка «занято столько-то из стольких» — для владельца у сетки медиа. */
  usageLabel: (usage: MediaUsage) => string
  /**
   * Влезет ли файл — по списку медиа из кэша; не влезает — тост и false. Списка в кэше
   * нет (вкладку ещё не открывали) — true: проверит сервер.
   */
  fits: (file: File, toastId?: string) => boolean
  /** Ошибка квоты от сервера — тост со своим текстом и true; иная ошибка — false. */
  handleError: (error: unknown, toastId?: string) => boolean
}

export function useMediaQuota(userId: string): MediaQuotaApi {
  const t = useTranslations('Profile')
  const unit = useByteUnitLabel()
  const qc = useQueryClient()

  const message = useCallback(
    (limit: MediaQuotaLimit): string =>
      limit === 'files'
        ? t('mediaQuotaFiles', { max: PROFILE_MEDIA_QUOTA.MAX_FILES })
        : t('mediaQuotaBytes', { max: formatBytes(PROFILE_MEDIA_QUOTA.MAX_BYTES, unit) }),
    [t, unit],
  )

  const usageLabel = useCallback(
    (usage: MediaUsage): string =>
      t('mediaQuotaUsage', {
        used: formatBytes(usage.bytes, unit),
        max: formatBytes(PROFILE_MEDIA_QUOTA.MAX_BYTES, unit),
        files: usage.files,
        maxFiles: PROFILE_MEDIA_QUOTA.MAX_FILES,
      }),
    [t, unit],
  )

  const fits = useCallback(
    (file: File, toastId?: string): boolean => {
      const items = qc.getQueryData<ProfileMedia[]>(profileContentKeys.media(userId))
      const over = items ? mediaQuotaExceeded(mediaUsage(items), file.size) : null
      if (over) toast.error(message(over), toastId ? { id: toastId } : undefined)
      return !over
    },
    [qc, userId, message],
  )

  const handleError = useCallback(
    (error: unknown, toastId?: string): boolean => {
      const limit = mediaQuotaFromError(error)
      if (!limit) return false
      toast.error(message(limit), toastId ? { id: toastId } : undefined)
      return true
    },
    [message],
  )

  return { message, usageLabel, fits, handleError }
}
