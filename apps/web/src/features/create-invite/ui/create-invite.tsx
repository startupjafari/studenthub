'use client'

import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Copy, Link2, Trash2 } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { CreateInviteSchema, type CreateInviteInput } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FieldError,
  FormAlert,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'
import { fetchMe, userKeys } from '../../../entities/user'
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import { fetchGroups, groupKeys } from '../../../entities/group'
import { fetchUniversities, universityKeys } from '../../../entities/university'
import {
  createInviteRequest,
  fetchInvites,
  inviteKeys,
  revokeInviteRequest,
  type CreatedInvite,
  type InviteStatus,
} from '../../../entities/invite'
import {
  FACULTY_ROLES,
  GROUP_ROLES,
  INVITABLE_ROLES,
  UNIVERSITY_ROLES,
} from '../model/invitable-roles'
import { BulkInvite } from './bulk-invite'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

const STATUS_VARIANT: Record<InviteStatus, 'info' | 'success' | 'secondary'> = {
  PENDING: 'info',
  USED: 'success',
  EXPIRED: 'secondary',
  REVOKED: 'secondary',
}

export function CreateInvite() {
  const t = useTranslations('Invites')
  const tErr = useTranslations('Errors')
  const tRoles = useTranslations('Roles')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const [created, setCreated] = useState<CreatedInvite | null>(null)

  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const faculties = useQuery({ queryKey: facultyKeys.list(), queryFn: () => fetchFaculties() })
  const groups = useQuery({ queryKey: groupKeys.list(), queryFn: () => fetchGroups() })
  const invites = useQuery({ queryKey: inviteKeys.list(), queryFn: fetchInvites })

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
      void qc.invalidateQueries({ queryKey: inviteKeys.list() })
      form.reset({
        role: undefined,
        email: undefined,
        universityId: undefined,
        facultyId: undefined,
        groupId: undefined,
      })
      toast.success(t('created'))
    },
    onError: (e) => showApiError(e),
  })

  const revokeMut = useMutation({
    mutationFn: revokeInviteRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inviteKeys.list() })
      toast.success(t('revoked'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
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

  if (invitable.length === 0 && !me.isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <EmptyState title={t('cannotInvite')} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">{t('createTitle')}</CardTitle>
            <BulkInvite />
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <FormAlert error={apiError} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>{t('roleLabel')}</Label>
                  <Controller
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <Select value={field.value ?? ''} onValueChange={field.onChange}>
                        <SelectTrigger>
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
                  {form.formState.errors.role && (
                    <p className="text-xs text-destructive">{t('selectRole')}</p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="inv-email">
                    {t('emailLabel')}{' '}
                    <span className="font-normal text-muted-foreground">
                      ({t('emailOptional')})
                    </span>
                  </Label>
                  <Input
                    id="inv-email"
                    type="email"
                    placeholder="user@example.com"
                    {...form.register('email')}
                  />
                </div>

                {needsUniversity && (
                  <div className="flex flex-col gap-2">
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
                  <div className="flex flex-col gap-2">
                    <Label>{t('faculty')}</Label>
                    <Controller
                      control={form.control}
                      name="facultyId"
                      render={({ field }) => (
                        <Select value={field.value ?? ''} onValueChange={field.onChange}>
                          <SelectTrigger>
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
                    {form.formState.errors.facultyId && (
                      <p className="text-xs text-destructive">{t('facultyRequired')}</p>
                    )}
                  </div>
                )}

                {needsGroup && (
                  <div className="flex flex-col gap-2">
                    <Label>{t('group')}</Label>
                    <Controller
                      control={form.control}
                      name="groupId"
                      render={({ field }) => (
                        <Select value={field.value ?? ''} onValueChange={field.onChange}>
                          <SelectTrigger>
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
                    {form.formState.errors.groupId && (
                      <p className="text-xs text-destructive">{t('groupRequired')}</p>
                    )}
                  </div>
                )}
              </div>

              <Button type="submit" loading={createMut.isPending} className="w-fit">
                {t('create')}
              </Button>
            </form>
          </CardContent>
        </Card>

        {created && (
          <Card className="border-primary/40 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="size-4 text-primary" aria-hidden />
                {t('inviteLinkTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <code className="truncate rounded-lg bg-background px-3 py-2 text-sm">
                /register?token={created.token}
              </code>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={copyLink}>
                  <Copy className="size-4" aria-hidden />
                  {t('copyLink')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
                  {t('dismiss')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t('listTitle')}</h2>
          {invites.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : invites.data && invites.data.length > 0 ? (
            invites.data.map((inv) => (
              <Card key={inv.id} className="flex-row items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{tRoles(inv.role)}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {inv.email ?? '—'} · {t('expires')}:{' '}
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[inv.status]}>{t(`status.${inv.status}`)}</Badge>
                  {inv.status === 'PENDING' && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('revoke')}
                      loading={revokeMut.isPending && revokeMut.variables === inv.id}
                      onClick={() => {
                        void confirm({ title: t('revokeConfirm'), destructive: true }).then(
                          (ok) => {
                            if (ok) revokeMut.mutate(inv.id)
                          },
                        )
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </Card>
            ))
          ) : (
            <EmptyState title={t('noInvites')} description={t('noInvitesHint')} />
          )}
        </div>
      </div>
    </div>
  )
}
