import { getTranslations } from 'next-intl/server'
import { GroupsList } from '../../../widgets/groups-list'

export default async function Page() {
  const t = await getTranslations('Nav')
  // Декан назначает старост групп своего факультета (PATCH /groups/:id/starosta).
  return <GroupsList title={t('groups')} manageStarosta />
}
