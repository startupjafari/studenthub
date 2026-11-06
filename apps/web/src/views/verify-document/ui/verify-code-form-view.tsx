'use client'

import { useTranslations } from 'next-intl'
import { ShieldCheck } from 'lucide-react'
import { Button, Input, Label } from '../../../shared/ui'

/**
 * Ввод кода из бланка — вход на проверку документа без QR.
 *
 * На эту страницу ведут лендинг («Страница проверки») и сам бланк: QR сканируют не все,
 * а банк или посольство чаще переписывают код руками. Без неё `/verify` отдавал 404, и
 * проверить справку можно было только по готовой ссылке с кодом.
 *
 * Обычная GET-форма, без состояния и запросов: код уходит в `?code=`, а страница
 * (app/verify/page.tsx) уводит на `/verify/<код>`, где и идёт проверка. Так ввод работает
 * и без JavaScript — проверяющий открывает страницу в чём угодно.
 */
export function VerifyCodeFormView() {
  const t = useTranslations('Verify')

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 p-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ShieldCheck className="size-7" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold">{t('enterTitle')}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t('enterHint')}</p>
      </div>

      <form method="get" action="/verify" className="flex w-full flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="verify-code">{t('codeLabel')}</Label>
          {/* Код сверяют с бумагой глазами — крупно и с разрядкой, как на экране результата. */}
          <Input
            id="verify-code"
            name="code"
            required
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={32}
            className="text-center font-mono tracking-[0.3em] uppercase"
          />
        </div>
        <Button type="submit" className="w-full">
          {t('submit')}
        </Button>
      </form>
    </div>
  )
}
