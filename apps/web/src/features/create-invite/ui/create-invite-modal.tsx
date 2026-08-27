'use client'

import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Copy, Link2 } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { CreateInviteSchema, type CreateInviteInput } from '@studenthub/shared-schemas'
import {
  Button,
  FieldError,
  FormAlert,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { OPTIONAL_TEXT, useFormAlert } from '../../../shared/lib'
import { fetchMe, userKeys } from '../../../entities/user'
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import { fetchGroups, groupKeys } from '../../../entities/group'
import { fetchUniversities, universityKeys } from '../../../entities/university'
import { createInviteRequest, inviteKeys, type CreatedInvite } from '../../../entities/invite'
import {
  FACULTY_ROLES,
  GROUP_ROLES,
  INVITABLE_ROLES,
  UNIVERSITY_ROLES,
} from '../model/invitable-roles'

interface Props {
  onClose: () => void
}

/**
 * Выдача приглашения. Живёт в модалке, а не на странице: действие разовое, а список
 * выданных приглашений — то, ради чего экран открывают чаще.
 *
 * После создания окно не закрывается, а показывает ссылку: токен приходит ровно один раз,
 * в списке его уже нет (сервер не отдаёт `token` в `GET /invites`), и закрыть окно, не
 * скопировав ссылку, значило бы выдать приглашение впустую.
 */
export function CreateInviteModal({ onClose }: Props) {
  const t = useTranslations('Invites')
  const tCommon = useTranslations('Common')
  const tRoles = useTranslations('Roles')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const [created, setCreated] = useState<CreatedInvite | null>(null)

  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const faculties = useQuery({ queryKey: facultyKeys.list(), queryFn: () => fetchFaculties() })
  const groups = useQuery({ queryKey: groupKeys.list(), queryFn: () => fetchGroups() })

  const invitable = me.data ? (INVITABLE_ROLES[me.data.role] ?? []) : []

  const form = useForm<CreateInviteInput>({ resolver: zodResolver(CreateInviteSchema) })
  const role = form.watch('role')
  const needsFaculty = role !== undefined && FACULTY_ROLES.includes(role)
  const needsGroup = role !== undefined && GROUP_ROLES.includes(role)
  // Приглашение админа вуза выдаёт платформа — целевой вуз она указывает явно
  // (invite-hierarchy.ts: scope не выводится из выдающего).
  const needsUniversity = role !== undefined && UNIVERSITY_ROLES.includes(role)
  const universities = useQuery({
    queryKey: universityKeys.list(),
    queryFn: fetchUniversities,
    enabled: needsUniversity,
  })

  const createMut = useMutation({
    mutationFn: createInviteRequest,
    onMutate: () => resetApiError(),
    onSuccess: (invite) => {
      setCreated(invite)
      void qc.invalidateQueries({ queryKey: inviteKeys.all })
      toast.success(t('created'))
    },
    onError: (e) => showApiError(e),
  })

  function onSubmit(v: CreateInviteInput) {
    if (role === Role.DEAN && !v.facultyId) {
      form.setError('facultyId', { message: t('facultyRequired') })
      return
    }
    if (needsGroup && !v.groupId) {
      form.setError('groupId', { message: t('groupRequired') })
      return
    }
    if (needsUniversity && !v.universityId) {
      form.setError('universityId', { message: t('universityRequired') })
      return
    }
    createMut.mutate({
      role: v.role,
      email: v.email || undefined,
      universityId: needsUniversity ? v.universityId || undefined : undefined,
      facultyId: needsFaculty ? v.facultyId || undefined : undefined,
      groupId: needsGroup ? v.groupId || undefined : undefined,
    })
  }

  function copyLink() {
    if (!created) return
    const url = `${window.location.origin}/register?token=${created.token}`
    void navigator.clipboard.writeText(url)
    toast.success(t('linkCopied'))
  }

  if (created) {
    return (
      <Modal onClose={onClose} title={t('inviteLinkTitle')} size="md">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link2 className="size-4 shrink-0 text-primary" aria-hidden />
            {t('createdHint')}
          </div>
          <code className="truncate rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            /register?token={created.token}
          </code>
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" onClick={copyLink}>
              <Copy className="size-4" aria-hidden />
              {t('copyLink')}
            </Button>
            <Button type="button" onClick={onClose}>
              {t('done')}
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} title={t('createTitle')} size="md">
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormAlert error={apiError} />

        <div className="flex flex-col gap-1.5">
          <Label>{t('roleLabel')}</Label>
          <Controller
            control={form.control}
            name="role"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={field.onChange}>
                <SelectTrigger aria-invalid={!!form.formState.errors.role}>
                  <SelectValue placeholder={t('selectRole')} />
                </SelectTrigger>
                <SelectContent>
                  {invitable.map((r) => (
                    <SelectItem key={r} value={r}>
                      {tRoles(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {form.formState.errors.role && <FieldError>{t('selectRole')}</FieldError>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-email">
            {t('emailLabel')}{' '}
            <span className="font-normal text-muted-foreground">({t('emailOptional')})</span>
          </Label>
          <Input
            id="inv-email"
            type="email"
            placeholder="user@example.com"
            {...form.register('email', OPTIONAL_TEXT)}
          />
          {/* Ошибку показываем обязательно: без неё опечатка в адресе тоже приводила
              бы к «кнопка не нажимается». */}
          <FieldError>{form.formState.errors.email ? t('emailInvalid') : null}</FieldError>
        </div>

        {needsUniversity && (
          <div className="flex flex-col gap-1.5">
            <Label>{t('university')}</Label>
            <Controller
              control={form.control}
              name="universityId"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger aria-invalid={!!form.formState.errors.universityId}>
                    <SelectValue placeholder={t('selectUniversity')} />
                  </SelectTrigger>
                  <SelectContent>
                    {universities.data?.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError>{form.formState.errors.universityId?.message}</FieldError>
          </div>
        )}

        {needsFaculty && (
          <div className="flex flex-col gap-1.5">
            <Label>{t('faculty')}</Label>
            <Controller
              control={form.control}
              name="facultyId"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger aria-invalid={!!form.formState.errors.facultyId}>
                    <SelectValue placeholder={t('selectFaculty')} />
                  </SelectTrigger>
                  <SelectContent>
                    {faculties.data?.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {form.formState.errors.facultyId && <FieldError>{t('facultyRequired')}</FieldError>}
          </div>
        )}

        {needsGroup && (
          <div className="flex flex-col gap-1.5">
            <Label>{t('group')}</Label>
            <Controller
              control={form.control}
              name="groupId"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger aria-invalid={!!form.formState.errors.groupId}>
                    <SelectValue placeholder={t('selectGroup')} />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.data?.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {form.formState.errors.groupId && <FieldError>{t('groupRequired')}</FieldError>}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" loading={createMut.isPending}>
            {t('create')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
