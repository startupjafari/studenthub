'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { ChevronDown, Plus, Trash2, Users } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  EmptyState,
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
import { fetchFaculties, facultyKeys, type Faculty } from '../../../entities/faculty'
import { CreateGroupModal } from './create-group-modal'
import {
  assignStarostaRequest,
  deleteGroupRequest,
  fetchGroupMembers,
  fetchGroups,
  groupKeys,
  type Group,
} from '../../../entities/group'
import { ProfileLink } from '../../../entities/user'
import { cn } from '../../../shared/lib/utils'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

function initials(f: string, l: string): string {
  return `${f[0] ?? ''}${l[0] ?? ''}`.toUpperCase()
}

// Строка группы: имя/факультет/курс + разворот участников с назначением старосты + удаление.
function GroupRow({ group, facultyName }: { group: Group; facultyName?: string }) {
  const qc = useQueryClient()
  const t = useTranslations('UniAdmin')
  const tErr = useTranslations('Errors')
  const tRoles = useTranslations('Roles')
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)

  const members = useQuery({
    queryKey: groupKeys.members(group.id),
    queryFn: () => fetchGroupMembers(group.id),
    enabled: open,
  })

  const starostaMut = useMutation({
    mutationFn: (starostaId: string | null) => assignStarostaRequest(group.id, { starostaId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: groupKeys.list() })
      toast.success(t('starostaUpdated'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteGroupRequest(group.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: groupKeys.list() })
      toast.success(t('groupDeleted'))
    },
    onError: (e) => {
      const code = errCode(e)
      toast.error(code === 'CONFLICT' ? t('groupHasStudents') : tErr(code))
    },
  })

  return (
    <Card className="gap-0 p-0">
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 cursor-pointer items-center gap-3 text-left"
          aria-expanded={open}
        >
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="font-medium">{group.name}</p>
            <p className="text-xs text-muted-foreground">
              {facultyName ?? '—'}
              {group.year ? ` · ${group.year}` : ''}
            </p>
          </div>
        </button>
        {group.starostaId && <Badge variant="info">{t('hasStarosta')}</Badge>}
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={t('delete')}
          loading={deleteMut.isPending}
          onClick={() => {
            void confirm({
              title: t('deleteGroupConfirm', { name: group.name }),
              destructive: true,
            }).then((ok) => {
              if (ok) deleteMut.mutate()
            })
          }}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border p-4">
          {members.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : members.data && members.data.length > 0 ? (
            <>
              <div className="flex flex-col gap-2">
                {members.data.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-sm">
                    <ProfileLink userId={m.id} className="flex items-center gap-2">
                      <Avatar className="size-7">
                        {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                        <AvatarFallback className="text-xs">
                          {initials(m.firstName, m.lastName)}
                        </AvatarFallback>
                      </Avatar>
                      <span>
                        {m.firstName} {m.lastName}
                      </span>
                    </ProfileLink>
                    <span className="text-xs text-muted-foreground">{tRoles(m.role)}</span>
                    {group.starostaId === m.id && (
                      <Badge variant="info" className="ml-auto">
                        {t('starosta')}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <Label>{t('assignStarosta')}</Label>
                  <Select
                    value={group.starostaId ?? ''}
                    onValueChange={(v) => starostaMut.mutate(v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('selectStarosta')} />
                    </SelectTrigger>
                    <SelectContent>
                      {members.data.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.firstName} {m.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {group.starostaId && (
                  <Button
                    variant="outline"
                    onClick={() => starostaMut.mutate(null)}
                    loading={starostaMut.isPending}
                  >
                    {t('clearStarosta')}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <EmptyState title={t('noMembers')} className="border-0 p-6" />
          )}
        </div>
      )}
    </Card>
  )
}

export function GroupsAdminView() {
  const t = useTranslations('UniAdmin')
  const tErr = useTranslations('Errors')

  const faculties = useQuery({ queryKey: facultyKeys.list(), queryFn: () => fetchFaculties() })
  const groups = useQuery({ queryKey: groupKeys.list(), queryFn: () => fetchGroups() })

  const facultyName = (id: string): string | undefined =>
    faculties.data?.find((f: Faculty) => f.id === id)?.name

  const [createOpen, setCreateOpen] = useState(false)

  const noFaculties = faculties.data && faculties.data.length === 0

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('groupsTitle')}
        actions={
          // Без факультетов группу создать нельзя — у неё обязательный facultyId.
          // Кнопка заблокирована, а причина написана в пустом состоянии ниже.
          <Button
            type="button"
            size="md"
            disabled={noFaculties}
            title={noFaculties ? t('needFacultyFirst') : undefined}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" aria-hidden />
            {t('addGroup')}
          </Button>
        }
      />

      {groups.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : groups.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : groups.data && groups.data.length > 0 ? (
        <div className="flex flex-col gap-2">
          {groups.data.map((g) => (
            <GroupRow key={g.id} group={g} facultyName={facultyName(g.facultyId)} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Users className="size-6" aria-hidden />}
          title={t('noGroups')}
          description={noFaculties ? t('needFacultyFirst') : t('noGroupsHint')}
          action={
            noFaculties ? null : (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden />
                {t('addGroup')}
              </Button>
            )
          }
        />
      )}

      {createOpen && <CreateGroupModal onClose={() => setCreateOpen(false)} />}
    </div>
  )
}
