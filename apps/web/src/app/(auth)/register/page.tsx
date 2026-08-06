import { RegisterByInviteForm } from '../../../features/auth-invite'

// Токен приходит из ссылки-приглашения ?token=... (Next 15: searchParams — промис).
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return <RegisterByInviteForm token={token ?? ''} />
}
