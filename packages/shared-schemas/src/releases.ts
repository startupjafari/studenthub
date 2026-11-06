import { z } from 'zod'
import { vm } from './validation-messages.js'

// Версия релиза: SemVer без пререлизных суффиксов — ровно то, что стоит в ноте и в теге
// `vX.Y.Z` (docs/RELEASE.md). Строка приходит от клиента, поэтому формат проверяется:
// в таблицу не должно попасть «latest» или чужой идентификатор сборки.
export const ReleaseVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, vm('validation.version.format'))

// Отметка «прочитал «Что нового»»: клиент присылает версию ноты, которую показал.
// Строгий режим — лишние поля отклоняются (BACKEND_RULES §3).
export const MarkReleaseSeenSchema = z.object({ version: ReleaseVersionSchema }).strict()
export type MarkReleaseSeenInput = z.infer<typeof MarkReleaseSeenSchema>
