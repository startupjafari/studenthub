'use client'

import { useTranslations } from 'next-intl'
import { Compass } from 'lucide-react'
import { StatusScreen } from '../shared/ui'

// Клиентский компонент: StatusScreen получает иконку-функцию (lucide), которую нельзя
// сериализовать из серверного компонента (RSC-ограничение) — иначе ошибка на dev.
export default function NotFound() {
  const t = useTranslations('Common')
  return (
    <StatusScreen
      code="404"
      icon={Compass}
      title={t('notFound')}
      description={t('notFoundDesc')}
      showHome
      showBack
    />
  )
}
