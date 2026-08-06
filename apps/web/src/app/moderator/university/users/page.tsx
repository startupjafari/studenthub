import { getTranslations } from 'next-intl/server'
import { UsersTable } from '../../../../widgets/users-table'

export default async function Page() {
  const t = await getTranslations('Users')
  return <UsersTable title={t('title')} showRoleFilter />
}
