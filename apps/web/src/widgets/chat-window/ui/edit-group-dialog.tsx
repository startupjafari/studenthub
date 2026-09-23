'use client'

import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Camera, Trash2 } from 'lucide-react'
import { CHAT_DESCRIPTION_MAX } from '@studenthub/shared-schemas'
import {
  chatKeys,
  editChatRequest,
  removeChatAvatarRequest,
  setChatAvatarRequest,
  type ChatListItem,
} from '../../../entities/chat'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Input,
  Label,
  Modal,
  Textarea,
} from '../../../shared/ui'
import { identityColor, identityInitials } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

const ImageCropModal = dynamic(
  () => import('../../../shared/ui/image-crop-modal').then((m) => m.ImageCropModal),
  { ssr: false },
)

/**
 * Редактирование группы — отдельным окном, как в мессенджерах.
 *
 * Раньше название правилось прямо в шапке панели: поле с двумя иконками распирало
 * колонку, аватар менялся наведением на картинку, а «Удалить фото» жило в ряду действий
 * рядом с «Покинуть». Три разных места для одной задачи. Теперь фото и название — в одном
 * окне, а в панели остаётся только «Изменить».
 */
export function EditGroupDialog({
  chat,
  title,
  onClose,
}: {
  chat: ChatListItem
  /** Отображаемое имя чата (у групп — своё, у прочих собирается родителем). */
  title: string
  onClose: () => void
}) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [name, setName] = useState(title)
  const [description, setDescription] = useState(chat.description ?? '')
  const fileRef = useRef<HTMLInputElement>(null)
  // Аватар группы круглый — без кадрирования в него попадала бы середина произвольного снимка.
  const [cropFile, setCropFile] = useState<File | null>(null)

  const err = (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
  const invalidateChat = () => {
    void qc.invalidateQueries({ queryKey: chatKeys.members(chat.id) })
    void qc.invalidateQueries({ queryKey: chatKeys.list() })
  }

  const avatarMut = useMutation({
    mutationFn: (file: File) => setChatAvatarRequest(chat.id, file),
    onSuccess: () => {
      invalidateChat()
      setCropFile(null)
      toast.success(t('avatarUpdated'))
    },
    onError: err,
  })

  const removeAvatar = useMutation({
    mutationFn: () => removeChatAvatarRequest(chat.id),
    onSuccess: () => {
      invalidateChat()
      toast.success(t('avatarRemoved'))
    },
    onError: err,
  })

  // Название и описание сохраняются одной правкой: человек открыл окно «изменить группу»
  // и жмёт «Сохранить» один раз — два запроса на одну кнопку означали бы и два исхода.
  const save = useMutation({
    mutationFn: (input: { title?: string; description?: string }) =>
      editChatRequest(chat.id, input),
    onSuccess: () => {
      invalidateChat()
      toast.success(t('titleUpdated'))
      onClose()
    },
    onError: err,
  })

  // Фото меняет владелец, название — любой админ. Окно открывается по любому из двух прав.
  const canEditAvatar = chat.isOwner
  const trimmed = name.trim()
  const trimmedDescription = description.trim()
  const nameChanged = trimmed.length > 0 && trimmed !== title
  const descriptionChanged = trimmedDescription !== (chat.description ?? '')
  const canSave = trimmed.length > 0 && (nameChanged || descriptionChanged) && !save.isPending

  function submit(): void {
    if (!canSave) return
    // Отправляем только изменившееся: иначе правка описания каждый раз переписывала бы
    // название тем же значением и рождала системное сообщение «название изменено».
    save.mutate({
      ...(nameChanged ? { title: trimmed } : {}),
      ...(descriptionChanged ? { description: trimmedDescription } : {}),
    })
  }

  // Кадрирование показываем ВМЕСТО окна, а не поверх него. Наложить не выйдет:
  // содержимое Modal центрируется через transform, а он делает элемент системой
  // координат для `position: fixed` внутри — оверлей кропа сжался бы до размеров окна.
  // Черновик названия при этом не теряется: состояние живёт в этом компоненте.
  if (cropFile) {
    return (
      <ImageCropModal
        file={cropFile}
        title={t('changeAvatar')}
        saving={avatarMut.isPending}
        onCancel={() => setCropFile(null)}
        onSave={(f) => avatarMut.mutate(f)}
      />
    )
  }

  return (
    <Modal onClose={onClose} title={t('editGroup')} size="md">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            <Avatar className="size-24">
              {chat.avatarUrl && <AvatarImage src={chat.avatarUrl} alt={title} />}
              <AvatarFallback
                className={cn('text-3xl font-medium text-white', identityColor(chat.id))}
              >
                {identityInitials(title)}
              </AvatarFallback>
            </Avatar>
            {canEditAvatar && (
              <>
                {/*
                  Затемнение с камерой видно всегда, а не по наведению: это экран
                  редактирования — здесь подсказка «фото можно сменить» и должна быть
                  видна сразу, да и на тач-экране наведения нет.
                */}
                <button
                  type="button"
                  aria-label={t('changeAvatar')}
                  onClick={() => fileRef.current?.click()}
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-100 transition-colors hover:bg-black/55"
                >
                  <Camera className="size-7" aria-hidden />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) setCropFile(file)
                    e.target.value = ''
                  }}
                />
              </>
            )}
          </div>

          {canEditAvatar && chat.avatarUrl && (
            <Button
              variant="ghost"
              size="sm"
              loading={removeAvatar.isPending}
              onClick={() => removeAvatar.mutate()}
            >
              <Trash2 className="size-3.5" aria-hidden />
              {t('removeAvatar')}
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-group-name">{t('groupNamePlaceholder')}</Label>
          <Input
            id="edit-group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={150}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        </div>

        {/* Описание группы (§3 карты): назначение чата, правила, ссылки. Многострочное —
            в него пишут список правил, а не одну фразу. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-group-description">{t('groupDescriptionLabel')}</Label>
          <Textarea
            id="edit-group-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={CHAT_DESCRIPTION_MAX}
            rows={4}
            placeholder={t('groupDescriptionPlaceholder')}
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" loading={save.isPending} disabled={!canSave} onClick={submit}>
            {t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
