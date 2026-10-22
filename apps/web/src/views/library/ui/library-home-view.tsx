'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  BookOpen,
  BookUp,
  ChevronRight,
  ListChecks,
  PowerOff,
  ScanQrCode,
  type LucideIcon,
} from 'lucide-react'
import { Card, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'
import { fetchLibrarySettings, libraryKeys } from '../../../entities/library'

interface DeskAction {
  href: string
  icon: LucideIcon
  title: string
  description: string
}

// Главная библиотекаря (docs/PROJECT.md §2, Фаза 20). Не дашборд с цифрами, а крупные
// действия, как пост охраны: за стойкой выдачи экран открывают на ходу, и нужное должно
// нажиматься с первого раза. Модуль выключен — говорим об этом прямо.
export function LibraryHomeView() {
  const t = useTranslations('Library')
  const settings = useQuery({ queryKey: libraryKeys.settings(), queryFn: fetchLibrarySettings })

  const actions: DeskAction[] = [
    {
      href: '/library/issue',
      icon: BookUp,
      title: t('issueTitle'),
      description: t('issueDescription'),
    },
    {
      href: '/library/loans',
      icon: ListChecks,
      title: t('loansTitle'),
      description: t('loansDescription'),
    },
    {
      href: '/library/catalog',
      icon: BookOpen,
      title: t('catalogTitle'),
      description: t('catalogDescription'),
    },
    { href: '/scan', icon: ScanQrCode, title: t('scanTitle'), description: t('scanDescription') },
  ]

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {settings.isPending ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : settings.data?.enabled === false ? (
        <EmptyState
          icon={<PowerOff className="size-6" aria-hidden />}
          title={t('disabledTitle')}
          description={t('disabledDescription')}
        />
      ) : null}
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
