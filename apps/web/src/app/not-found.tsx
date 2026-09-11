'use client'

import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Compass } from 'lucide-react'
import { StatusScreen } from '../shared/ui'

// Клиентский компонент: StatusScreen получает иконку-функцию (lucide), которую нельзя
// сериализовать из серверного компонента (RSC-ограничение) — иначе ошибка на dev.
export default function NotFound() {
  const t = useTranslations('Common')
  const pathname = usePathname()

  return (
    <StatusScreen
      code="404"
      icon={Compass}
      title={t('notFound')}
      description={t('notFoundDesc')}
      // Показываем, какой адрес не нашёлся: чаще всего сюда приходят по битой ссылке из
      // чата или закладке, и увидеть сам путь — первый шаг к пониманию, что пошло не так.
      detail={pathname ? { label: t('notFoundPath'), value: pathname } : undefined}
      showHome
      showBack
    />
  )
}
