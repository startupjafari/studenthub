'use client'

import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  UpdateUniversityPageSchema,
  type UpdateUniversityPageInput,
} from '@studenthub/shared-schemas'
import {
  universityKeys,
  updateMyUniversityPage,
  type UniversityPage,
} from '../../../entities/university'
import { Card, CardContent, FormAlert } from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'
import { ENTER } from './profile-content'
import { OrgPageFieldsForm } from './org-page-fields'

type UniversityFormValues = z.input<typeof UpdateUniversityPageSchema>

/** Форма отправляется кнопкой «Сохранить» в шапке страницы университета. */
export const UNIVERSITY_EDIT_FORM_ID = 'university-edit-form'

// Пустые текстовые поля — пустые строки: так поле можно очистить (схема переводит '' в null).
function toFormValues(u: UniversityPage): UniversityFormValues {
  return {
    description: u.description ?? '',
    website: u.website ?? '',
    foundedYear: u.foundedYear ?? undefined,
    contactEmail: u.contactEmail ?? '',
    contactPhone: u.contactPhone ?? '',
    address: u.address ?? '',
    telegram: u.telegram ?? '',
    instagram: u.instagram ?? '',
    linkedin: u.linkedin ?? '',
  }
}

/** Правка страницы университета — админ своего вуза (сервер проверяет это сам). */
export function UniversityEditForm({
  university,
  onSaved,
}: {
  university: UniversityPage
  onSaved: () => void
}) {
  const t = useTranslations('University')
  const tOrg = useTranslations('OrgPage')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UniversityFormValues, unknown, UpdateUniversityPageInput>({
    resolver: zodResolver(UpdateUniversityPageSchema),
    defaultValues: toFormValues(university),
  })

  const save = useMutation({
    mutationFn: updateMyUniversityPage,
    onMutate: resetApiError,
    onSuccess: (updated) => {
      qc.setQueryData(universityKeys.page(university.id), updated)
      toast.success(tOrg('saved'))
      onSaved()
    },
    onError: showApiError,
  })

  return (
    <Card className={ENTER}>
      <CardContent>
        <form
          id={UNIVERSITY_EDIT_FORM_ID}
          // Кнопка «Сохранить» — в шапке, вне fieldset: повторное нажатие гасим здесь.
          onSubmit={handleSubmit((values) => {
            if (!save.isPending) save.mutate(values)
          })}
          className="flex flex-col gap-6"
        >
          <FormAlert error={apiError} />
          <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-6">
            {/* Название и город — реквизиты вуза: их меняет платформа, не админ вуза. */}
            <p className="text-sm text-muted-foreground">{t('requisitesHint')}</p>
            <OrgPageFieldsForm
              aboutTitle={t('about')}
              binding={{ register, hasError: (name) => !!errors[name] }}
            />
          </fieldset>
        </form>
      </CardContent>
    </Card>
  )
}
