'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ShieldCheck } from 'lucide-react'
import { Button, Input, Label } from '../../../shared/ui'
import { setup2faRequest, enable2faRequest } from '../../../shared/api'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

// Обязательная настройка 2FA для привилегированных ролей (форс через TwoFactorGuard на бэке:
// 403 TWO_FACTOR_SETUP_REQUIRED → сюда). После включения — жёсткий переход на «/»: холодная
// загрузка перевыпустит токен через SessionInitializer (tfa=true), и форс снимется.
export function SetupTwoFactorGate() {
  const tS = useTranslations('Settings')
  const tG = useTranslations('SetupTwoFactor')
  const tErr = useTranslations('Errors')
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)

  const setupMut = useMutation({
    mutationFn: setup2faRequest,
    onSuccess: (data) => setSetup({ qr: data.qr, secret: data.secret }),
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const enableMut = useMutation({
    mutationFn: () => enable2faRequest(code.trim()),
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes)
      setSetup(null)
      setCode('')
      toast.success(tS('twoFactorEnabledToast'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  // Шаг 3: backup-коды (один раз) → продолжить в приложение (жёсткий reload за свежим токеном).
  if (backupCodes) {
    return (
      <div className="flex flex-col gap-4">
        <Header title={tS('backupCodesTitle')} subtitle={tS('backupCodesDesc')} />
        <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-3 font-mono text-sm">
          {backupCodes.map((c) => (
            <li key={c} className="tracking-widest">
              {c}
            </li>
          ))}
        </ul>
        <Button type="button" onClick={() => window.location.assign('/')}>
          {tG('continueToApp')}
        </Button>
      </div>
    )
  }

  // Шаг 2: QR + секрет + ввод кода.
  if (setup) {
    return (
      <div className="flex flex-col gap-4">
        <Header title={tG('title')} subtitle={tS('twoFactorScanQr')} />
        {/* Data-URL от бэкенда — обычный img (оптимизатор не нужен). */}
        <img
          src={setup.qr}
          alt={tS('twoFactor')}
          width={200}
          height={200}
          className="mx-auto rounded-lg border border-border bg-white p-2"
        />
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{tS('twoFactorOrSecret')}</span>
          <code className="rounded bg-muted px-2 py-1 font-mono text-sm break-all">
            {setup.secret}
          </code>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="enable2fa">{tS('twoFactorEnterCode')}</Label>
          <Input
            id="enable2fa"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <Button
          type="button"
          loading={enableMut.isPending}
          disabled={!code.trim()}
          onClick={() => enableMut.mutate()}
        >
          {tS('twoFactorConfirm')}
        </Button>
      </div>
    )
  }

  // Шаг 1: объяснение, почему обязательно, и старт.
  return (
    <div className="flex flex-col gap-4">
      <Header title={tG('title')} subtitle={tG('subtitle')} />
      <Button type="button" loading={setupMut.isPending} onClick={() => setupMut.mutate()}>
        {tS('twoFactorSetup')}
      </Button>
    </div>
  )
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <ShieldCheck className="size-6" aria-hidden />
      </span>
      <h1 className="text-lg font-bold">{title}</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}
