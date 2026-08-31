import type { ReactNode } from 'react'
import { GraduationCap } from 'lucide-react'

// Публичные страницы работодателя: регистрация и подтверждение почты. Сессии здесь нет,
// поэтому ни RoleGuard, ни AppShell не подключаются — только карточка по центру.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2">
        <GraduationCap className="size-7 text-primary" aria-hidden />
        <span className="text-xl font-bold">StudentHub</span>
      </div>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        {children}
      </div>
    </main>
  )
}
