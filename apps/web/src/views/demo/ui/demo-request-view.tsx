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
  Input,
  Label,
  LegalLinks,
  Textarea,
} from '../../../shared/ui'
import { OPTIONAL_NUMBER, OPTIONAL_TEXT, useErrorToast } from '../../../shared/lib'

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
 *
 * Отказ сервера показывается всплывающим сообщением, а не полосой в начале формы: форма
 * длинная, кнопка отправки внизу, и полоса наверху оказывалась вне экрана — человек
 * нажимал «отправить» и не видел, что ничего не отправилось. Ошибки отдельных полей
 * остаются у полей.
 */
export function DemoRequestView() {
  const t = useTranslations('Demo')
  const [sentTo, setSentTo] = useState<string | null>(null)
  // id свой у формы: повторный отказ обновляет тот же тост, а не копит стопку.
  const { show: showError } = useErrorToast('demo-request')

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
          try {
            const result = await submitDemoRequest(values)
            setSentTo(result.email)
          } catch (err) {
            showError(err)
          }
        })}
        className="flex flex-col gap-4"
      >
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
              <OptionalLabel text={t('fieldCity')} optional={t('optional')} />
            </Label>
            <Input id="city" {...register('city', OPTIONAL_TEXT)} />
            <FieldError>{errors.city?.message}</FieldError>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="studentsEstimate">
              <OptionalLabel text={t('fieldStudents')} optional={t('optional')} />
            </Label>
            {/* inputMode numeric: на телефоне открывается цифровая клавиатура, но поле
                остаётся текстовым — type="number" крутится колесом мыши и теряет значение. */}
            {/* «Примерно» ушло из подписи в подсказку: в правой колонке пары подпись с
                пометкой «необязательно» не влезала в строку, переносилась, и поля пары
                разъезжались по вертикали. Смысл при этом не потерян — пример числа
                говорит о порядке величины прямее, чем слово «примерно». */}
            <Input
              id="studentsEstimate"
              inputMode="numeric"
              placeholder={t('fieldStudentsHint')}
              {...register('studentsEstimate', OPTIONAL_NUMBER)}
            />
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
              <OptionalLabel text={t('fieldContactRole')} optional={t('optional')} />
            </Label>
            <Input id="contactRole" {...register('contactRole', OPTIONAL_TEXT)} />
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
            <OptionalLabel text={t('fieldPhone')} optional={t('optional')} />
          </Label>
          <Input id="phone" type="tel" autoComplete="tel" {...register('phone', OPTIONAL_TEXT)} />
          <FieldError>{errors.phone?.message}</FieldError>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="comment">
            <OptionalLabel text={t('fieldComment')} optional={t('optional')} />
          </Label>
          <Textarea id="comment" rows={3} {...register('comment', OPTIONAL_TEXT)} />
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

/**
 * Подпись поля вместе с пометкой «необязательно».
 *
 * Обе части — один поток текста внутри `<span>`, а не два ребёнка `Label`. `Label` в
 * дизайн-системе это `flex`, и там пометка становилась отдельным флекс-элементом: когда
 * подпись не влезала в колонку («Примерно студентов» в правой половине формы), она
 * переносилась на две строки, а «(необязательно)» отрывалось к правому краю. Одним
 * потоком пометка переносится вместе с подписью, как часть фразы, которой и является.
 */
function OptionalLabel({ text, optional }: { text: string; optional: string }) {
  return (
    <span>
      {text} <span className="font-normal text-muted-foreground">({optional})</span>
    </span>
  )
}
