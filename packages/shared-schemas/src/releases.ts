import { z } from 'zod'

// Версия релиза: SemVer без пререлизных суффиксов — ровно то, что ставит release-please
// в package.json и в тег `vX.Y.Z` (docs/RELEASE.md). Строка приходит от клиента, поэтому
// формат проверяется: в таблицу не должно попасть «latest» или чужой идентификатор сборки.
export const ReleaseVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'Версия должна быть в формате SemVer, например 1.7.0')

// Отметка «прочитал «Что нового»»: клиент присылает версию ноты, которую показал.
// Строгий режим — лишние поля отклоняются (BACKEND_RULES §3).
export const MarkReleaseSeenSchema = z.object({ version: ReleaseVersionSchema }).strict()
export type MarkReleaseSeenInput = z.infer<typeof MarkReleaseSeenSchema>
