'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Role } from '@studenthub/shared-types'
import {
  assignStarostaRequest,
  groupKeys,
  type Group,
  type GroupMember,
} from '../../../entities/group'
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

interface AssignStarostaProps {
  group: Pick<Group, 'id' | 'starostaId'>
  members: GroupMember[]
}

/**
 * Назначение старосты группы (админ вуза и декан факультета). Староста — роль: выбранный
 * студент получает права старосты, прежний возвращается в студенты (сервер делает это одной
 * транзакцией). Выбор — только из студентов группы.
 */
export function AssignStarosta({ group, members }: AssignStarostaProps) {
  const t = useTranslations('UniAdmin')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const candidates = members.filter((m) => m.role === Role.STUDENT || m.role === Role.STAROSTA)

  const assign = useMutation({
    mutationFn: (starostaId: string | null) => assignStarostaRequest(group.id, { starostaId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: groupKeys.list() })
      // Роли участников поменялись — бейджи «староста»/«студент» в списке тоже.
      void qc.invalidateQueries({ queryKey: groupKeys.members(group.id) })
      toast.success(t('starostaUpdated'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  if (candidates.length === 0) return null

  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-1 flex-col gap-1">
        <Label>{t('assignStarosta')}</Label>
        <Select
          value={group.starostaId ?? ''}
          onValueChange={(v) => assign.mutate(v)}
          disabled={assign.isPending}
        >
          <SelectTrigger aria-label={t('assignStarosta')}>
            <SelectValue placeholder={t('selectStarosta')} />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.firstName} {m.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {group.starostaId && (
        <Button variant="outline" onClick={() => assign.mutate(null)} loading={assign.isPending}>
          {t('clearStarosta')}
        </Button>
      )}
    </div>
  )
}
