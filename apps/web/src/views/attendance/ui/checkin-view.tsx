'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CheckCircle2, Info, Loader2, TriangleAlert } from 'lucide-react'
import { Button, Card, CardContent } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { attendanceKeys, checkInRequest, type CheckInResult } from '../../../entities/attendance'

type State =
  | { kind: 'loading' }
  | { kind: 'noToken' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; result: CheckInResult }

// Экран самоотметки по QR (задача 6): камера телефона открывает /checkin?t=…,
// страница разбирает токен и делает отметку присутствия.
export function CheckinView() {
  const t = useTranslations('Attendance')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const params = useSearchParams()
  const token = params.get('t')
  const [state, setState] = useState<State>({ kind: 'loading' })
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true
    if (!token) {
      setState({ kind: 'noToken' })
      return
    }
    checkInRequest(token)
      .then((result) => {
        setState({ kind: 'done', result })
        qc.invalidateQueries({ queryKey: attendanceKeys.me() })
      })
      .catch((e) => setState({ kind: 'error', message: tErr(toApiError(e).code) }))
  }, [token, qc, tErr])

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md items-center justify-center">
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          {state.kind === 'loading' && (
            <>
              <Loader2 className="size-10 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">{t('checkinLoading')}</p>
            </>
          )}

          {state.kind === 'noToken' && (
            <>
              <Info className="size-10 text-muted-foreground" aria-hidden />
              <h1 className="text-lg font-semibold">{t('checkinNoToken')}</h1>
              <p className="text-sm text-muted-foreground">{t('checkinNoTokenHint')}</p>
            </>
          )}

          {state.kind === 'error' && (
            <>
              <TriangleAlert className="size-10 text-destructive" aria-hidden />
              <h1 className="text-lg font-semibold">{t('checkinFailed')}</h1>
              <p className="text-sm text-muted-foreground">{state.message}</p>
            </>
          )}

          {state.kind === 'done' && (
            <>
              <CheckCircle2 className="size-12 text-success" aria-hidden />
              <h1 className="text-lg font-semibold">
                {state.result.already ? t('checkinAlready') : t('checkinSuccess')}
              </h1>
              <p className="text-sm text-muted-foreground">{state.result.subject}</p>
            </>
          )}

          {state.kind !== 'loading' && (
            <Button asChild variant="outline" className="mt-2 w-full">
              <Link href="/attendance">{t('checkinToAttendance')}</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
