import { EmployerJoinView } from '../../../../views/employer'

// Токен приходит из ссылки-приглашения в команду компании ?token=... (Next 15: searchParams —
// промис), как на странице регистрации по инвайту вуза.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return <EmployerJoinView token={token ?? ''} />
}
