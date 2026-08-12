import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from '../../../shared/ui'
import { NAV_BY_VARIANT, type NavVariant } from '../../../widgets/app-shell'

// Дашборд ролевого лендинга: плитки-навигация по разделам роли (кроме самого «Дашборда»).
export async function RoleLanding({ variant }: { variant: NavVariant }) {
  const tNav = await getTranslations('Nav')
  const tDash = await getTranslations('Dashboard')
  const items = (NAV_BY_VARIANT[variant] ?? []).filter((i) => i.key !== 'dashboard')

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title={tNav('dashboard')} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <Link key={item.key} href={item.href} className="group/tile block">
              <Card className="h-full transition-colors hover:border-primary/40 hover:bg-muted/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-base">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    {tNav(item.key)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="flex items-center gap-1 text-sm text-muted-foreground transition-colors group-hover/tile:text-foreground">
                    {tDash('openSection')}
                    <ArrowRight
                      className="size-3.5 transition-transform group-hover/tile:translate-x-0.5"
                      aria-hidden
                    />
                  </p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
