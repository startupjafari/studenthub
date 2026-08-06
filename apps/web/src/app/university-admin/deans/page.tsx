import { getTranslations } from 'next-intl/server'
import { UsersTable } from '../../../widgets/users-table'
import { Role } from '@studenthub/shared-types'

export default async function Page() {
  const t = await getTranslations('UniAdmin')
  return <UsersTable title={t('deansTitle')} role={Role.DEAN} />
}
