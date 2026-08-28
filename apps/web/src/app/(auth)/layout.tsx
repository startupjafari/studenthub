import type { ReactNode } from 'react'
import { GraduationCap } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { MeshBrandPanel } from '../../shared/ui'

// Split-лейаут экранов входа/регистрации: слева интерактивная брендовая панель
// (меш-сетка за мышью, скрыта на мобильном), справа — форма по центру.
export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('Auth')

  return (
    <div className="flex min-h-dvh">
      <MeshBrandPanel
        title={t('brandSlogan')}
        subtitle={t('brandSubtitle')}
        copyright={t('copyright')}
      />

      {/* Мобильный: логотип у самого верха, форма — по центру оставшегося пространства, на фоне —
          мягкая анимированная сетка точек. Десктоп: форма по центру правой части (точки/лого скрыты). */}
      <main className="relative flex flex-1 flex-col overflow-hidden p-6">
        <div className="auth-dots lg:hidden" aria-hidden />
        <div className="relative z-10 mt-[calc(1rem+env(safe-area-inset-top))] flex items-center justify-center gap-3 lg:hidden">
          <GraduationCap className="size-9 text-primary" aria-hidden />
          <span className="text-2xl font-bold">StudentHub</span>
        </div>
        <div className="relative z-10 flex flex-1 items-center justify-center">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
