'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Mail, UserPlus, UsersRound } from 'lucide-react'
import {
  CreateCompanyInviteSchema,
  type CompanyMemberRole,
  type CreateCompanyInviteInput,
} from '@studenthub/shared-schemas'
import {
  companyKeys,
  fetchCompanyTeam,
  fetchMyCompany,
  inviteCompanyMember,
  isCompanyOwner,
  removeCompanyMember,
  revokeCompanyInvite,
  type CompanyInvite,
  type CompanyMember,
} from '../../../entities/company'
import {
  Badge,
  Button,
  EmptyState,
  FieldError,
  Input,
  Label,
  PageHeader,
  PageLoader,
  SectionPanel,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

/**
 * Команда компании (21.D2): владелец приглашает коллег по почте, видит ожидающие
 * приглашения и исключает участников. Приглашённый регистрируется по ссылке из письма и
 * становится рекрутёром — работает с вакансиями и кандидатами, но не с командой и допусками.
 */
export function EmployerTeamView() {
  const t = useTranslations('EmployerTeam')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')

  const company = useQuery({ queryKey: companyKeys.mine(), queryFn: fetchMyCompany })
  const owner = isCompanyOwner(company.data)

  if (company.isLoading) return <PageLoader label={tCommon('loading')} />

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {company.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} description={tErr('retryHint')} />
      ) : owner ? (
        <OwnerTeam />
      ) : (
        // Рекрутёр командой не управляет (API отвечает 403) — говорим, к кому идти, а не
        // показываем пустой список.
        <EmptyState
          icon={<UsersRound className="size-6" aria-hidden />}
          title={t('ownerOnlyTitle')}
          description={t('ownerOnlyText')}
        />
      )}
    </div>
  )
}

function OwnerTeam() {
  const t = useTranslations('EmployerTeam')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()

  const team = useQuery({ queryKey: companyKeys.team(), queryFn: fetchCompanyTeam })

  const form = useForm<CreateCompanyInviteInput>({
    resolver: zodResolver(CreateCompanyInviteSchema),
    defaultValues: { email: '' },
  })

  const refresh = () => qc.invalidateQueries({ queryKey: companyKeys.team() })
  const onError = (error: unknown) => toast.error(tErr(toApiError(error).code))

  const invite = useMutation({
    mutationFn: (email: string) => inviteCompanyMember(email),
    onSuccess: async (_data, email) => {
      toast.success(t('invited', { email }))
      form.reset({ email: '' })
      await refresh()
    },
    onError,
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeCompanyInvite(id),
    onSuccess: async () => {
      toast.success(t('inviteRevoked'))
      await refresh()
    },
    onError,
  })
  const remove = useMutation({
    mutationFn: (userId: string) => removeCompanyMember(userId),
    onSuccess: async () => {
      toast.success(t('memberRemoved'))
      await refresh()
    },
    onError,
  })
  const busy = invite.isPending || revoke.isPending || remove.isPending

  return (
    <>
      <SectionPanel title={t('inviteTitle')} subtitle={t('inviteText')}>
        <form
          onSubmit={form.handleSubmit((values) => invite.mutate(values.email))}
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="inviteEmail" className="sr-only">
              {t('emailLabel')}
            </Label>
            <Input
              id="inviteEmail"
              type="email"
              autoComplete="off"
              placeholder={t('emailPlaceholder')}
              aria-invalid={!!form.formState.errors.email}
              {...form.register('email')}
            />
            <FieldError>{form.formState.errors.email ? t('emailInvalid') : null}</FieldError>
          </div>
          <Button type="submit" loading={invite.isPending}>
            <UserPlus className="size-4" aria-hidden /> {t('invite')}
          </Button>
        </form>
      </SectionPanel>

      {team.isLoading ? (
        <PageLoader label={t('title')} />
      ) : team.isError || !team.data ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} description={tErr('retryHint')} />
      ) : (
        <>
          <SectionPanel title={t('membersTitle')} subtitle={t('membersText')}>
            <ul className="flex flex-col divide-y divide-border">
              {team.data.members.map((member) => (
                <MemberRow
                  key={member.userId}
                  member={member}
                  busy={busy}
                  onRemove={() =>
                    void confirm({
                      title: t('removeConfirm', {
                        name: `${member.firstName} ${member.lastName}`,
                      }),
                      description: t('removeConfirmText'),
                      confirmLabel: t('remove'),
                      destructive: true,
                    }).then((ok) => {
                      if (ok) remove.mutate(member.userId)
                    })
                  }
                />
              ))}
            </ul>
          </SectionPanel>

          {team.data.invites.length > 0 && (
            <SectionPanel title={t('invitesTitle')} subtitle={t('invitesText')}>
              <ul className="flex flex-col divide-y divide-border">
                {team.data.invites.map((item) => (
                  <InviteRow
                    key={item.id}
                    invite={item}
                    busy={busy}
                    onResend={() => invite.mutate(item.email)}
                    onRevoke={() => revoke.mutate(item.id)}
                  />
                ))}
              </ul>
            </SectionPanel>
          )}
        </>
      )}
    </>
  )
}

function useRoleLabel(): Record<CompanyMemberRole, string> {
  const t = useTranslations('EmployerTeam')
  return { OWNER: t('roleOwner'), RECRUITER: t('roleRecruiter') }
}

function MemberRow({
  member,
  busy,
  onRemove,
}: {
  member: CompanyMember
  busy: boolean
  onRemove: () => void
}) {
  const t = useTranslations('EmployerTeam')
  const roleLabel = useRoleLabel()
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">
            {member.firstName} {member.lastName}
          </p>
          <Badge variant={member.role === 'OWNER' ? 'secondary' : 'outline'}>
            {roleLabel[member.role]}
          </Badge>
          {member.isMe && <span className="text-xs text-muted-foreground">{t('you')}</span>}
        </div>
        <p className="truncate text-sm text-muted-foreground">{member.email}</p>
      </div>
      {/* Себя и владельца исключить нельзя: компания осталась бы без управляющего. */}
      {!member.isMe && member.role !== 'OWNER' && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
          {t('remove')}
        </Button>
      )}
    </li>
  )
}

function InviteRow({
  invite,
  busy,
  onResend,
  onRevoke,
}: {
  invite: CompanyInvite
  busy: boolean
  onResend: () => void
  onRevoke: () => void
}) {
  const t = useTranslations('EmployerTeam')
  const locale = useLocale()
  const until = new Date(invite.expiresAt).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2">
        <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate font-medium">{invite.email}</p>
          <p className="text-sm text-muted-foreground">
            {invite.expired ? t('inviteExpired') : t('inviteUntil', { date: until })}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {/* Повторное приглашение того же адреса — новая ссылка и срок, прежняя гаснет. */}
        <Button size="sm" variant="outline" disabled={busy} onClick={onResend}>
          {t('resend')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRevoke}>
          {t('revoke')}
        </Button>
      </div>
    </li>
  )
}
