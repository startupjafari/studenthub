import { getTranslations } from 'next-intl/server'
import { UsersTable } from '../../../widgets/users-table'

// Все люди своего вуза с фильтром роли: экраны «Студенты», «Преподаватели», «Деканы»
// показывают по одной роли, а модераторы, охрана, библиотекари и старосты в них не входят.
export default async function Page() {
  const t = await getTranslations('Users')
  return <UsersTable title={t('title')} subtitle={t('subtitleUniversity')} showRoleFilter />
}
