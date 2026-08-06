import { getTranslations } from 'next-intl/server'
import { GroupsList } from '../../../widgets/groups-list'

export default async function Page() {
  const t = await getTranslations('Nav')
  return <GroupsList title={t('groups')} />
}
