import { redirect } from 'next/navigation'
import { normalizeVerificationCode } from '../../entities/document-verification'
import { VerifyCodeFormView } from '../../views/verify-document'

interface PageProps {
  // Next 15: searchParams — промис; повтор параметра в адресе даёт массив.
  searchParams: Promise<{ code?: string | string[] }>
}

/**
 * `/verify` без кода — форма ввода. На этот адрес ведут лендинг и бланк справки.
 * С `?code=` (так отправляет форма) — сразу на страницу результата `/verify/<код>`.
 */
export default async function VerifyCodePage({ searchParams }: PageProps) {
  const { code } = await searchParams
  const value = normalizeVerificationCode(Array.isArray(code) ? (code[0] ?? '') : (code ?? ''))
  if (value) redirect(`/verify/${encodeURIComponent(value)}`)
  return <VerifyCodeFormView />
}
