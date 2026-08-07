'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { CreateApplicationSchema, type CreateApplicationInput } from '@studenthub/shared-schemas'
import { applicationKeys, APP_TYPES, createApplicationRequest } from '../../../entities/application'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormAlert,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'

export function SubmitApplicationForm({ onCreated }: { onCreated?: (id: string) => void }) {
  const t = useTranslations('Applications')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const form = useForm<CreateApplicationInput>({
    resolver: zodResolver(CreateApplicationSchema),
    defaultValues: { type: 'CERTIFICATE' },
  })

  const mutation = useMutation({
    mutationFn: createApplicationRequest,
    onMutate: () => resetApiError(),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: applicationKeys.all })
      form.reset({ type: 'CERTIFICATE', subject: '', body: '' })
      toast.success(t('created'))
      onCreated?.(created.id)
    },
    onError: (e) => showApiError(e),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('newApplication')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          className="flex flex-col gap-3"
        >
          <FormAlert error={apiError} />
          <div className="flex flex-col gap-2">
            <Label>{t('type')}</Label>
            <Controller
              control={form.control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APP_TYPES.map((tp) => (
                      <SelectItem key={tp} value={tp}>
                        {t(`type${tp}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="subject">{t('subject')}</Label>
            <Input id="subject" {...form.register('subject')} />
            {form.formState.errors.subject && (
              <p className="text-xs text-destructive">{t('required')}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="body">{t('body')}</Label>
            <textarea
              id="body"
              rows={4}
              {...form.register('body')}
              className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
            />
            {form.formState.errors.body && (
              <p className="text-xs text-destructive">{t('required')}</p>
            )}
          </div>

          <div>
            <Button type="submit" loading={mutation.isPending}>
              {t('submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
