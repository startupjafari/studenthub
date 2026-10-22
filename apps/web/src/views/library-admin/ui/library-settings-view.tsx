'use client'

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Power } from 'lucide-react'
import {
  LIBRARY_LIMITS,
  UpdateLibrarySettingsSchema,
  type LibrarySettingsResponse,
  type UpdateLibrarySettingsInput,
} from '@studenthub/shared-schemas'
import {
  Button,
  FieldError,
  Input,
  Label,
  PageHeader,
  SectionPanel,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { LibraryAdminTabs } from './library-admin-tabs'
import {
  fetchLibrarySettings,
  libraryKeys,
  updateLibrarySettingsRequest,
} from '../../../entities/library'

// Библиотека вуза для администратора (docs/PROJECT.md §3.11): выключатель модуля и правила
// выдачи. Каталог и выдачи ведёт библиотекарь; админ вуза настраивает и видит отчёты.

type RuleField = Exclude<keyof UpdateLibrarySettingsInput, 'enabled'>

const RULES: { field: RuleField; range: { min: number; max: number } }[] = [
  { field: 'defaultLoanDays', range: LIBRARY_LIMITS.loanDays },
  { field: 'maxLoanDays', range: LIBRARY_LIMITS.loanDays },
  { field: 'maxActiveLoans', range: LIBRARY_LIMITS.activeLoans },
  { field: 'maxActiveReservations', range: LIBRARY_LIMITS.activeReservations },
  { field: 'reservationHoldDays', range: LIBRARY_LIMITS.holdDays },
  { field: 'maxRenewals', range: LIBRARY_LIMITS.renewals },
]

function rulesOf(settings: LibrarySettingsResponse): UpdateLibrarySettingsInput {
  return Object.fromEntries(RULES.map(({ field }) => [field, settings[field]]))
}

export function LibrarySettingsView() {
  const t = useTranslations('LibraryAdmin')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const qc = useQueryClient()

  const settings = useQuery({ queryKey: libraryKeys.settings(), queryFn: fetchLibrarySettings })
  const form = useForm<UpdateLibrarySettingsInput>({
    resolver: zodResolver(UpdateLibrarySettingsSchema),
  })
  const { reset } = form
  useEffect(() => {
    if (settings.data) reset(rulesOf(settings.data))
  }, [settings.data, reset])

  const mutation = useMutation({
    mutationFn: updateLibrarySettingsRequest,
    onSuccess: (data, input) => {
      qc.setQueryData(libraryKeys.settings(), data)
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      if (input.enabled === undefined) toast.success(t('savedToast'))
      else toast.success(data.enabled ? t('enabledToast') : t('disabledToast'))
    },
    onError: (e) => {
      const err = toApiError(e)
      const field = err.details?.find((d) => RULES.some((r) => r.field === d.field))?.field
      if (err.code === 'VALIDATION_ERROR' && field) {
        form.setError(field as RuleField, { type: 'server', message: t('defaultOverMax') })
        return
      }
      toast.error(tErr(err.code))
    },
  })

  const enabled = settings.data?.enabled ?? false
  // Подписи — явными ключами: сборка ключа из имени поля запрещена (FRONTEND_RULES §10).
  const labels: Record<RuleField, { label: string; hint: string }> = {
    defaultLoanDays: { label: t('rule.defaultLoanDays'), hint: t('ruleHint.defaultLoanDays') },
    maxLoanDays: { label: t('rule.maxLoanDays'), hint: t('ruleHint.maxLoanDays') },
    maxActiveLoans: { label: t('rule.maxActiveLoans'), hint: t('ruleHint.maxActiveLoans') },
    maxActiveReservations: {
      label: t('rule.maxActiveReservations'),
      hint: t('ruleHint.maxActiveReservations'),
    },
    reservationHoldDays: {
      label: t('rule.reservationHoldDays'),
      hint: t('ruleHint.reservationHoldDays'),
    },
    maxRenewals: { label: t('rule.maxRenewals'), hint: t('ruleHint.maxRenewals') },
  }

  async function toggleModule(): Promise<void> {
    if (enabled) {
      const ok = await confirm({
        title: t('disableConfirmTitle'),
        description: t('disableConfirmDesc'),
        confirmLabel: t('disable'),
        destructive: true,
      })
      if (!ok) return
    }
    mutation.mutate({ enabled: !enabled })
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        tabs={<LibraryAdminTabs />}
        actions={
          settings.isPending ? (
            <Skeleton className="h-9 w-40" />
          ) : (
            <Button
              type="button"
              variant={enabled ? 'outline' : 'default'}
              loading={mutation.isPending && mutation.variables?.enabled !== undefined}
              onClick={() => void toggleModule()}
            >
              <Power className="size-4" aria-hidden />
              {enabled ? t('disable') : t('enable')}
            </Button>
          )
        }
      />

      <SectionPanel title={t('rulesTitle')} subtitle={t('rulesSubtitle')}>
        {settings.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RULES.map(({ field }) => (
              <Skeleton key={field} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            noValidate
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {RULES.map(({ field, range }) => {
                const error = form.formState.errors[field]
                return (
                  <div key={field} className="flex flex-col gap-1.5">
                    <Label htmlFor={`library-${field}`}>{labels[field].label}</Label>
                    <Input
                      id={`library-${field}`}
                      type="number"
                      inputMode="numeric"
                      min={range.min}
                      max={range.max}
                      aria-invalid={error ? true : undefined}
                      {...form.register(field, { valueAsNumber: true })}
                    />
                    <p className="text-xs text-muted-foreground">{labels[field].hint}</p>
                    <FieldError>
                      {error
                        ? error.type === 'server'
                          ? error.message
                          : t('ruleRange', { min: range.min, max: range.max })
                        : null}
                    </FieldError>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                loading={mutation.isPending && mutation.variables?.enabled === undefined}
                disabled={!form.formState.isDirty}
              >
                {t('save')}
              </Button>
            </div>
          </form>
        )}
      </SectionPanel>
    </div>
  )
}
