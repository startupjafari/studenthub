'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { MailCheck } from 'lucide-react'
import { SubmitDemoRequestSchema, type SubmitDemoRequestInput } from '@studenthub/shared-schemas'
import { submitDemoRequest } from '../../../entities/onboarding'
import {
  Button,
  Checkbox,
  FieldError,
  FormAlert,
  Input,
  Label,
  LegalLinks,
  Textarea,
} from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'

/**
 * Заявка вуза на тестирование платформы.
 *
 * Форма живёт здесь, а не на лендинге, и это решение, а не случайность. Лендинг —
 * статическая страница без единой формы: у него другой домен, другой деплой и другой
 * набор рисков. Перенос формы на платформу снимает CORS с чужого origin и оставляет
 * персональные данные там, где для них уже есть правила.
 *
 * Полей ровно столько, чтобы человек на той стороне понял, кто пишет и о каком вузе
 * речь. Всё остальное выясняется разговором, а длинная форма на незнакомом домене не
 * заполняется до конца.
 *
 * Что будет дальше, сказано прямо на экране: подтверждение почты, рассмотрение,
 * письмо с доступом. Без этого человек ждёт мгновенного входа и считает, что сломалось.
 */
export function DemoRequestView() {
  const t = useTranslations('Demo')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SubmitDemoRequestInput>({ resolver: zodResolver(SubmitDemoRequestSchema) })

  const consent = watch('consent')

  if (sentTo) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t('sentTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('sentText', { email: sentTo })}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/login">{t('toLogin')}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <form
        onSubmit={handleSubmit(async (values) => {
          resetApiError()
          try {
            const result = await submitDemoRequest(values)
            setSentTo(result.email)
          } catch (err) {
            showApiError(err)
          }
        })}
        className="flex flex-col gap-4"
      >
        <FormAlert error={apiError} />

        <div className="flex flex-col gap-2">
          <Label htmlFor="universityName">{t('fieldUniversity')}</Label>
          <Input
            id="universityName"
            aria-invalid={!!errors.universityName}
            {...register('universityName')}
          />
          <FieldError>{errors.universityName?.message}</FieldError>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="city">
              {t('fieldCity')} <Optional label={t('optional')} />
            </Label>
            <Input id="city" {...register('city')} />
            <FieldError>{errors.city?.message}</FieldError>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="studentsEstimate">
              {t('fieldStudents')} <Optional label={t('optional')} />
            </Label>
            {/* inputMode numeric: на телефоне открывается цифровая клавиатура, но поле
                остаётся текстовым — type="number" крутится колесом мыши и теряет значение. */}
            <Input id="studentsEstimate" inputMode="numeric" {...register('studentsEstimate')} />
            <FieldError>{errors.studentsEstimate?.message}</FieldError>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="contactName">{t('fieldContactName')}</Label>
            <Input
              id="contactName"
              autoComplete="name"
              aria-invalid={!!errors.contactName}
              {...register('contactName')}
            />
            <FieldError>{errors.contactName?.message}</FieldError>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="contactRole">
              {t('fieldContactRole')} <Optional label={t('optional')} />
            </Label>
            <Input id="contactRole" {...register('contactRole')} />
            <FieldError>{errors.contactRole?.message}</FieldError>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">{t('fieldEmail')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...register('email')}
          />
          {/* Подпись, а не плейсхолдер: на этот адрес уйдёт и подтверждение, и доступ. */}
          <p className="text-xs text-muted-foreground">{t('emailHint')}</p>
          <FieldError>{errors.email?.message}</FieldError>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">
            {t('fieldPhone')} <Optional label={t('optional')} />
          </Label>
          <Input id="phone" type="tel" autoComplete="tel" {...register('phone')} />
          <FieldError>{errors.phone?.message}</FieldError>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="comment">
            {t('fieldComment')} <Optional label={t('optional')} />
          </Label>
          <Textarea id="comment" rows={3} {...register('comment')} />
          <FieldError>{errors.comment?.message}</FieldError>
        </div>

        {/* Согласие — обязательное поле, а не приписка под кнопкой: без отметки форма
            не отправляется, и схема отвечает на пустую галочку ошибкой валидации. */}
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3">
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="consent"
              checked={consent === true}
              onCheckedChange={(next) =>
                setValue('consent', next === true, { shouldValidate: true })
              }
              aria-invalid={!!errors.consent}
              className="mt-0.5"
            />
            <Label htmlFor="consent" className="text-xs leading-relaxed font-normal">
              {t('consent')}
            </Label>
          </div>
          <FieldError>{errors.consent ? t('consentRequired') : null}</FieldError>
          <LegalLinks className="justify-start sm:justify-start" />
        </div>

        <Button type="submit" size="xl" loading={isSubmitting} className="mt-2 w-full">
          {t('submit')}
        </Button>

        <p className="text-center text-xs text-muted-foreground">{t('note')}</p>
      </form>
    </div>
  )
}

function Optional({ label }: { label: string }) {
  return <span className="font-normal text-muted-foreground">({label})</span>
}
