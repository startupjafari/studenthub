import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Card, CardContent, CardHeader, CardTitle } from '../../../shared/ui'
import { NAV_BY_VARIANT, type NavVariant } from '../../../widgets/app-shell'

// Дашборд ролевого лендинга: карточки по разделам навигации (кроме самого «Дашборда»),
// каждая ведёт в раздел. До реализации фич — подпись «в разработке».
export async function RoleLanding({ variant }: { variant: NavVariant }) {
  const tNav = await getTranslations('Nav')
  const tDash = await getTranslations('Dashboard')
  const items = (NAV_BY_VARIANT[variant] ?? []).filter((i) => i.key !== 'dashboard')

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-bold">{tNav('dashboard')}</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <Link key={item.key} href={item.href} className="block">
              <Card className="h-full transition-colors hover:border-primary/40 hover:bg-muted/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="size-4 text-primary" aria-hidden />
                    {tNav(item.key)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{tDash('inDevelopment')}</p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
