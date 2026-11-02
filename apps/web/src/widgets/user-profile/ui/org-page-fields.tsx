'use client'

import type { ComponentProps, ReactNode } from 'react'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { FieldError, Input, Label, Textarea } from '../../../shared/ui'

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

/** Поле формы: подключение к RHF (register) и ошибка — у вызывающего, разметка — здесь. */
export interface OrgFieldBinding {
  register: (name: OrgPageFieldName) => UseFormRegisterReturn
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
}: {
  binding: OrgFieldBinding
  before?: ReactNode
  aboutTitle: string
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
          {field('contactPhone', t('fieldContactPhone'), t('errPhone'), {
            type: 'tel',
            placeholder: '+7 700 000 00 00',
          })}
          {field('telegram', 'Telegram', t('errTelegram'), { placeholder: '@name' })}
          {field('instagram', 'Instagram', t('errHttps'), {
            placeholder: 'https://instagram.com/…',
          })}
          {field('linkedin', 'LinkedIn', t('errHttps'), {
            placeholder: 'https://linkedin.com/…',
          })}
        </div>
      </section>
    </>
  )
}
