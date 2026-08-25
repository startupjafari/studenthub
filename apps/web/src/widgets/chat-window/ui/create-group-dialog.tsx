'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { chatKeys, createChatRequest } from '../../../entities/chat'
import { UserPicker, type PickedUser } from '../../../entities/user'
import { Button, FormAlert, Input, Modal } from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'

// Диалог создания собственной группы (Ф9+): название + мультивыбор участников (приглашение сразу).
export function CreateGroupDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (chatId: string) => void
}) {
  const t = useTranslations('Chats')
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [members, setMembers] = useState<PickedUser[]>([])
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()

  const create = useMutation({
    mutationFn: () =>
      createChatRequest({
        type: 'GROUP',
        title: title.trim(),
        memberIds: members.map((m) => m.id),
      }),
    onMutate: () => resetApiError(),
    onSuccess: (chat) => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      toast.success(t('groupCreated'))
      onCreated(chat.id)
    },
    onError: (e) => showApiError(e),
  })

  const canCreate = title.trim().length > 0 && members.length > 0 && !create.isPending

  return (
    <Modal onClose={onClose} title={t('newGroup')} size="lg">
      <div className="flex flex-col gap-3">
        <FormAlert error={apiError} />

        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('groupNamePlaceholder')}
          aria-label={t('groupNamePlaceholder')}
          maxLength={150}
          autoFocus
        />

        {members.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <span
                key={m.id}
                className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs"
              >
                {m.lastName} {m.firstName}
                <button
                  type="button"
                  aria-label={t('removeAttachment')}
                  onClick={() => setMembers((prev) => prev.filter((x) => x.id !== m.id))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}

        <UserPicker
          value={null}
          placeholder={t('addMember')}
          onSelect={(u) => {
            if (u) setMembers((prev) => (prev.some((x) => x.id === u.id) ? prev : [...prev, u]))
          }}
        />

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            loading={create.isPending}
            disabled={!canCreate}
            onClick={() => create.mutate()}
          >
            {t('create')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
