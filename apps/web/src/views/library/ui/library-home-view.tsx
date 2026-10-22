'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ChevronRight, Library, PowerOff, ScanQrCode } from 'lucide-react'
import { Card, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'
import { fetchLibrarySettings, libraryKeys } from '../../../entities/library'

// Главная библиотекаря (docs/PROJECT.md §2, Фаза 20). Каталог, выдача и возврат, брони и
// должники появятся здесь задачами 20.3–20.8. Модуль выключен — говорим об этом прямо:
// иначе пустой экран выглядел бы поломкой.
export function LibraryHomeView() {
  const t = useTranslations('Library')
  const settings = useQuery({ queryKey: libraryKeys.settings(), queryFn: fetchLibrarySettings })

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Link
        href="/scan"
        className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:max-w-md"
      >
        <Card className="h-full flex-row items-center gap-4 px-4 transition-colors group-hover:bg-muted/40">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ScanQrCode className="size-6" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-base font-semibold">{t('scanTitle')}</span>
            <span className="text-sm text-muted-foreground">{t('scanDescription')}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        </Card>
      </Link>
      {settings.isPending ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : settings.data?.enabled === false ? (
        <EmptyState
          icon={<PowerOff className="size-6" aria-hidden />}
          title={t('disabledTitle')}
          description={t('disabledDescription')}
        />
      ) : (
        <EmptyState
          icon={<Library className="size-6" aria-hidden />}
          title={t('soonTitle')}
          description={t('soonDescription')}
        />
      )}
    </div>
  )
}
