/** Ответ `GET /releases/me`: даты приходят строками ISO (JSON). */
export interface ReleaseState {
  version: string | null
  seenAt: string | null
  accountCreatedAt: string | null
}

/** Ответ `POST /releases/seen`. */
export interface ReleaseSeen {
  version: string
  seenAt: string
}
