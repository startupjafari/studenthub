import { api } from '../../../shared/api'

/** Что показывает страница проверки. Сервер намеренно отдаёт минимум — см. ExportRegistryService. */
export interface DocumentVerification {
  code: string
  /** Вид документа: `certificate` — справка; рабочие выгрузки сюда тоже попадают. */
  kind: string
  number: string | null
  issuer: string | null
  /** Фамилия с инициалами — сверить с бумагой, но не собрать базу ФИО. */
  subject: string | null
  issuedAt: string
  revokedAt: string | null
  status: 'VALID' | 'REVOKED'
}

export const verificationKeys = {
  byCode: (code: string) => ['document-verification', code] as const,
}

/** Проверка документа по коду из бланка. Эндпоинт публичный: токена у проверяющего нет. */
export async function verifyDocument(code: string): Promise<DocumentVerification> {
  const { data } = await api.get<DocumentVerification>(`/verify/${encodeURIComponent(code)}`)
  return data
}
