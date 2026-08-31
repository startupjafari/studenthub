'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CircleCheck, CircleX } from 'lucide-react'
import { verifyCompanyEmail } from '../../../entities/company'
import { Button, PageLoader } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

// Посадочная страница из письма: подтверждает адрес компании по одноразовому токену.
export function EmployerVerifyView() {
  const t = useTranslations('Employer')
  const tCommon = useTranslations('Common')
  const params = useSearchParams()
  const token = params.get('token')
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [message, setMessage] = useState('')
  // Токен одноразовый: второй запрос вернёт «ссылка недействительна». В dev StrictMode
  // эффект вызывается дважды, поэтому запрос отправляем ровно один раз.
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return
    sent.current = true
    if (!token) {
      setState('error')
      setMessage(t('verifyNoToken'))
      return
    }
    verifyCompanyEmail(token)
      .then(() => setState('ok'))
      .catch((err: unknown) => {
        setState('error')
        setMessage(toApiError(err).message)
      })
  }, [token, t])

  if (state === 'loading') return <PageLoader label={tCommon('loading')} />

  const ok = state === 'ok'
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span
        className={
          ok
            ? 'flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary'
            : 'flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive'
        }
      >
        {ok ? (
          <CircleCheck className="size-6" aria-hidden />
        ) : (
          <CircleX className="size-6" aria-hidden />
        )}
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{ok ? t('verifyOkTitle') : t('verifyFailTitle')}</h2>
        <p className="text-sm text-muted-foreground">{ok ? t('verifyOkText') : message}</p>
      </div>
      <Button asChild>
        <Link href="/login">{t('toLogin')}</Link>
      </Button>
    </div>
  )
}
