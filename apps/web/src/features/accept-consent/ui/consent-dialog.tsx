'use client'

import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ShieldCheck } from 'lucide-react'
import { AcceptConsentSchema, isAdult, type AcceptConsentInput } from '@studenthub/shared-schemas'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
  Label,
  LegalLinks,
  FieldError,
} from '../../../shared/ui'
import { useErrorToast } from '../../../shared/lib'
import { endSession } from '../../../shared/session'
import { acceptConsentRequest, userKeys, type ConsentState } from '../../../entities/user'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Окно принятия действующей редакции документов. Показывать ли — решает `ConsentGate`. */
export function ConsentDialog({
  state,
  birthDate,
}: {
  state: ConsentState
  birthDate: string | null
}) {
  const t = useTranslations('Consent')
  const tAuth = useTranslations('Auth')
  const qc = useQueryClient()
  const { show: showApiError } = useErrorToast('consent-gate')

  // Схема-SSOT решает возраст только по дате из формы. Дата из профиля известна лишь
  // серверу и этому окну, поэтому «нужна дата» и «нужен представитель» добавляются здесь —
  // тем же приёмом, что у формы регистрации (сервер всё равно проверит сам).
  const schema = useMemo(
    () =>
      AcceptConsentSchema.superRefine((v, ctx) => {
        if (state.birthDateRequired && !v.birthDate) {
          ctx.addIssue({ code: 'custom', path: ['birthDate'], message: t('birthDateRequired') })
        }
        if (state.guardianRequired && v.guardianConsent !== true) {
          ctx.addIssue({
            code: 'custom',
            path: ['guardianConsent'],
            message: t('guardianRequired'),
          })
        }
      }),
    [state.birthDateRequired, state.guardianRequired, t],
  )

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AcceptConsentInput>({ resolver: zodResolver(schema) })

  // Вторая галочка — только тому, за кого согласие даёт представитель: по дате из профиля
  // или по только что введённой.
  const typedBirthDate = watch('birthDate') ?? ''
  const needsGuardian =
    state.guardianRequired ||
    (state.birthDateRequired && ISO_DATE.test(typedBirthDate) && !isAdult(typedBirthDate))

  async function onSubmit(values: AcceptConsentInput) {
    try {
      const next = await acceptConsentRequest({
        consent: true,
        guardianConsent: needsGuardian ? values.guardianConsent : undefined,
        birthDate: state.birthDateRequired ? values.birthDate : undefined,
      })
      // Дату рождения форма могла дописать в профиль — тогда меняется и ключ состояния.
      if (state.birthDateRequired) {
        await qc.invalidateQueries({ queryKey: userKeys.me() })
      } else {
        qc.setQueryData(userKeys.consent(birthDate), next)
      }
    } catch (err) {
      showApiError(err)
    }
  }

  async function logout(): Promise<void> {
    await endSession()
    window.location.assign('/login')
  }

  const description =
    state.reason === 'VERSION'
      ? t('versionText')
      : state.guardianRequired
        ? t('minorText')
        : t('adultText')

  return (
    // Окно не закрывается ни фоном, ни Escape: без согласия платформой пользоваться нельзя,
    // а выход — отдельная кнопка.
    <AlertDialog open>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden />
              {state.reason === 'VERSION' ? t('versionTitle') : t('ageTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>

          <LegalLinks className="justify-start sm:justify-start" />

          {state.birthDateRequired && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="consent-birth-date">{tAuth('birthDate')}</Label>
              <Input
                id="consent-birth-date"
                type="date"
                autoComplete="bday"
                aria-invalid={!!errors.birthDate}
                {...register('birthDate')}
              />
              <p className="text-xs text-muted-foreground">{tAuth('birthDateHint')}</p>
              <FieldError>{errors.birthDate && errors.birthDate.message}</FieldError>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
                aria-invalid={!!errors.consent}
                {...register('consent')}
              />
              <span className="text-muted-foreground">{tAuth('consent')}</span>
            </label>
            <FieldError>{errors.consent && t('consentRequired')}</FieldError>

            {needsGuardian && (
              <>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
                    aria-invalid={!!errors.guardianConsent}
                    {...register('guardianConsent')}
                  />
                  <span className="text-muted-foreground">{tAuth('guardianConsent')}</span>
                </label>
                <FieldError>{errors.guardianConsent && errors.guardianConsent.message}</FieldError>
              </>
            )}
          </div>

          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={logout} disabled={isSubmitting}>
              {t('logout')}
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {t('accept')}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
