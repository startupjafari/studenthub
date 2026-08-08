import type { ReactNode } from 'react'
import { GraduationCap } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { AuthBackground, MeshBrandPanel } from '../../shared/ui'

// Split-лейаут экранов входа/регистрации: слева интерактивная брендовая панель
// (меш-сетка за мышью, скрыта на мобильном), справа — форма по центру.
export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('Auth')

  return (
    <div className="flex min-h-screen">
      <MeshBrandPanel
        title={t('brandSlogan')}
        subtitle={t('brandSubtitle')}
        copyright={t('copyright')}
      />

      <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden p-6">
        <AuthBackground />
        <div className="relative z-10 mb-8 flex items-center gap-2 lg:hidden">
          <GraduationCap className="size-6 text-primary" aria-hidden />
          <span className="text-lg font-bold">StudentHub</span>
        </div>
        <div className="relative z-10 w-full max-w-md">{children}</div>
      </main>
    </div>
  )
}
