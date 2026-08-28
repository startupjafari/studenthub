'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Check, Loader2, MonitorSmartphone, ShieldAlert, X } from 'lucide-react'
import { Button } from '../../shared/ui'
import { qrApproveRequest } from '../../shared/api'

type State = 'idle' | 'approving' | 'done' | 'rejected' | 'error'

function QrApprove() {
  const t = useTranslations('Auth')
  const params = useSearchParams()
  const token = params.get('t')
  const [state, setState] = useState<State>('idle')

  if (!token) {
    return <Message icon={X} tone="destructive" text={t('qrApproveInvalid')} />
  }
  if (state === 'done') {
    return <Message icon={Check} tone="success" text={t('qrApproveDone')} />
  }
  if (state === 'rejected') {
    return <Message icon={X} tone="muted" text={t('qrApproveRejected')} />
  }
  if (state === 'error') {
    return <Message icon={X} tone="destructive" text={t('qrApproveError')} />
  }

  async function approve() {
    setState('approving')
    try {
      await qrApproveRequest(token!)
      setState('done')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <MonitorSmartphone className="size-7" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t('qrApproveTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('qrApprovePrompt')}</p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-left text-xs text-foreground">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>{t('qrApproveWarning')}</span>
      </div>

      <div className="flex w-full gap-2">
        <Button type="button" className="flex-1" loading={state === 'approving'} onClick={approve}>
          <Check className="size-4" aria-hidden />
          {t('qrApproveConfirm')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => setState('rejected')}
        >
          <X className="size-4" aria-hidden />
          {t('qrApproveReject')}
        </Button>
      </div>
    </div>
  )
}

function Message({
  icon: Icon,
  tone,
  text,
}: {
  icon: typeof Check
  tone: 'success' | 'destructive' | 'muted'
  text: string
}) {
  const cls =
    tone === 'success'
      ? 'bg-success/10 text-success'
      : tone === 'destructive'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-muted text-muted-foreground'
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className={`flex size-14 items-center justify-center rounded-2xl ${cls}`}>
        <Icon className="size-7" aria-hidden />
      </span>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

export default function QrApprovePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <Suspense
          fallback={<Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />}
        >
          <QrApprove />
        </Suspense>
      </div>
    </main>
  )
}
