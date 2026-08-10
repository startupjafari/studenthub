import type { Role } from '@studenthub/shared-types'
import { SECTIONS, sectionVisible } from './sections'

// Подсчёт заполненности профиля. Единый источник полей — SECTIONS (тот же,
// что и форма редактирования), плюс фото и подпись из шапки. Роль определяет
// набор релевантных секций (студенту не считаем «работу» и наоборот).

export interface CompletionField {
  key: string
  // i18n-ключ (Profile namespace) с подписью поля. avatarUrl не входит в SECTIONS —
  // ему назначается отдельный ключ, остальным подходит t(key).
  labelKey: string
}

export interface CompletionResult {
  total: number
  filled: number
  percent: number
  missing: CompletionField[]
}

function isFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  return true
}

export function computeProfileCompletion(
  data: Record<string, unknown>,
  role: Role,
): CompletionResult {
  const fields: CompletionField[] = [
    { key: 'avatarUrl', labelKey: 'completionAvatar' },
    { key: 'headline', labelKey: 'headline' },
  ]
  for (const section of SECTIONS) {
    if (!sectionVisible(section.when, role)) continue
    for (const f of section.fields) fields.push({ key: f.key, labelKey: f.key })
  }

  const missing = fields.filter((f) => !isFilled(data[f.key]))
  const filled = fields.length - missing.length
  const percent = fields.length ? Math.round((filled / fields.length) * 100) : 100
  return { total: fields.length, filled, percent, missing }
}
