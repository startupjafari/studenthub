import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ChevronRight, Library, ScanQrCode } from 'lucide-react'
import { Card, EmptyState, PageHeader } from '../../../shared/ui'

// Главная библиотекаря (docs/PROJECT.md §2, Фаза 20). Каталог, выдача и возврат, брони и
// должники появятся здесь задачами 20.3–20.8; пока у роли есть вход, свой аккаунт и сканер
// для подтверждения входа на компьютере.
export async function LibraryHomeView() {
  const t = await getTranslations('Library')

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
      <EmptyState
        icon={<Library className="size-6" aria-hidden />}
        title={t('soonTitle')}
        description={t('soonDescription')}
      />
    </div>
  )
}
