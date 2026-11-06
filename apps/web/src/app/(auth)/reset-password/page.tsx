import { ResetPasswordForm } from '../../../features/password-reset'

// Посадочная страница из письма сброса: токен в ?token= (Next 15: searchParams — промис).
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return <ResetPasswordForm token={token ?? ''} />
}
