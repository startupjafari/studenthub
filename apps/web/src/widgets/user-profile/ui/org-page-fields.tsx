'use client'

import type { ComponentProps, ReactNode } from 'react'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { FieldError, Input, Label, PhoneInput, Textarea } from '../../../shared/ui'
import { SocialLinkInput } from './social-link-input'

/** Общие поля формы страницы организации (OrgPageFieldsShape): их имена в форме. */
export type OrgPageFieldName =
  | 'description'
  | 'website'
  | 'foundedYear'
  | 'contactEmail'
  | 'contactPhone'
  | 'address'
  | 'telegram'
  | 'instagram'
  | 'linkedin'

/** Значение и обработчики управляемого поля (RHF Controller у вызывающего). */
export interface ControlledField {
  value: unknown
  onChange: (value: string) => void
  onBlur: () => void
}

/** Поле формы: подключение к RHF и ошибка — у вызывающего, разметка — здесь. */
export interface OrgFieldBinding {
  register: (name: OrgPageFieldName) => UseFormRegisterReturn
  /** Поле с маской (телефон, соцсети) — через Controller: маска отдаёт готовое значение. */
  controlled: (name: OrgPageFieldName, render: (field: ControlledField) => ReactNode) => ReactNode
  hasError: (name: OrgPageFieldName) => boolean
}

/**
 * Описание, год, адрес, контакты и соцсети — одинаковые у страницы компании и вуза. Своё у
 * каждой (название, отрасль, численность) форма рисует сама и передаёт в `before`.
 */
export function OrgPageFieldsForm({
  binding,
  before,
  aboutTitle,
  linkedinKind,
}: {
  binding: OrgFieldBinding
  before?: ReactNode
  aboutTitle: string
  /** Страница LinkedIn: у компании — company, у вуза — school. */
  linkedinKind: 'company' | 'school'
}) {
  const t = useTranslations('OrgPage')
  const field = (
    name: OrgPageFieldName,
    label: string,
    error: string,
    props: ComponentProps<typeof Input> = {},
  ) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`org-${name}`}>{label}</Label>
      <Input
        id={`org-${name}`}
        aria-invalid={binding.hasError(name)}
        {...props}
        {...binding.register(name)}
      />
      <FieldError>{binding.hasError(name) ? error : null}</FieldError>
    </div>
  )

  const masked = (
    name: OrgPageFieldName,
    label: string,
    error: string,
    render: (field: ControlledField) => ReactNode,
  ) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`org-${name}`}>{label}</Label>
      {binding.controlled(name, render)}
      <FieldError>{binding.hasError(name) ? error : null}</FieldError>
    </div>
  )
  const social = (name: 'telegram' | 'instagram' | 'linkedin', label: string, error: string) =>
    masked(name, label, error, (f) => (
      <SocialLinkInput
        id={`org-${name}`}
        platform={name}
        linkedinKind={linkedinKind}
        value={f.value as string | null | undefined}
        onChange={f.onChange}
        onBlur={f.onBlur}
        invalid={binding.hasError(name)}
      />
    ))

  return (
    <>
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">{aboutTitle}</h2>
        {before}
        <div className="flex flex-col gap-2">
          <Label htmlFor="org-description">{t('fieldDescription')}</Label>
          <Textarea id="org-description" rows={5} {...binding.register('description')} />
          <FieldError>{binding.hasError('description') ? t('errDescription') : null}</FieldError>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('foundedYear', t('fieldFounded'), t('errYear'), {
            inputMode: 'numeric',
            placeholder: '2015',
          })}
          {field('address', t('fieldAddress'), t('errText'))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">{t('contacts')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('website', t('fieldWebsite'), t('errWebsite'), { placeholder: 'https://' })}
          {field('contactEmail', t('fieldContactEmail'), t('errEmail'), {
            type: 'email',
            autoComplete: 'email',
          })}
          {masked('contactPhone', t('fieldContactPhone'), t('errPhone'), (f) => (
            <PhoneInput
              id="org-contactPhone"
              value={f.value as string | null | undefined}
              onChange={f.onChange}
              onBlur={f.onBlur}
              aria-invalid={binding.hasError('contactPhone')}
            />
          ))}
          {social('telegram', 'Telegram', t('errTelegram'))}
          {social('instagram', 'Instagram', t('errInstagram'))}
          {social('linkedin', 'LinkedIn', t('errLinkedin'))}
        </div>
      </section>
    </>
  )
}
