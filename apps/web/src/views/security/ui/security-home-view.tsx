import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Cctv, ChevronRight, DoorClosed, ScanLine, ScanQrCode, type LucideIcon } from 'lucide-react'
import { Card, PageHeader } from '../../../shared/ui'

interface PostAction {
  href: string
  icon: LucideIcon
  title: string
  description: string
}

// «Пост охраны» — главная роли SECURITY_GUARD (docs/PROJECT.md §2). Не дашборд с
// цифрами, а крупные действия: на вахте экран открывают с телефона на ходу, и нужное
// должно нажиматься с первого раза.
export async function SecurityHomeView() {
  const t = await getTranslations('Security')
  const actions: PostAction[] = [
    {
      href: '/security/cameras',
      icon: Cctv,
      title: t('camerasTitle'),
      description: t('camerasDescription'),
    },
    {
      href: '/scan',
      icon: ScanQrCode,
      title: t('scanTitle'),
      description: t('scanDescription'),
    },
    {
      href: '/verify-id',
      icon: ScanLine,
      title: t('verifyTitle'),
      description: t('verifyDescription'),
    },
    {
      href: '/security/rooms',
      icon: DoorClosed,
      title: t('roomsTitle'),
      description: t('roomsDescription'),
    },
  ]

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map(({ href, icon: Icon, title, description }) => (
          <li key={href}>
            <Link
              href={href}
              className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <Card className="h-full flex-row items-center gap-4 px-4 transition-colors group-hover:bg-muted/40">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-6" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-base font-semibold">{title}</span>
                  <span className="text-sm text-muted-foreground">{description}</span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
