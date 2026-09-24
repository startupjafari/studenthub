'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowRight, Camera, Check, X } from 'lucide-react'
import { chatKeys, createChatRequest, setChatAvatarRequest } from '../../../entities/chat'
import { directoryKeys, fetchUserDirectory, type DirectoryUser } from '../../../entities/user'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Checkbox,
  ImageCropModal,
  Input,
  Skeleton,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { identityColor, useErrorToast } from '../../../shared/lib'
import { useAppSelector } from '../../../shared/store'
import {
  ColumnPanel,
  PanelHeader,
  PanelHeaderButton,
  PanelSearch,
  SectionTitle,
} from './column-panel'

const TITLE_MAX = 150

// Создание группы — экран левой колонки (см. ColumnPanel) в два шага, как в Telegram:
// сначала участники, потом имя и фото. Раньше это было одно модальное окно с полем
// автодополнения: набрать в нём десять человек значило десять раз открыть выпадающий
// список, а увидеть их всех сразу было негде.

export function CreateGroupPanel({
  embedded,
  hidden,
  onClose,
  onCreated,
}: {
  embedded: boolean
  hidden: boolean
  onClose: () => void
  onCreated: (chatId: string) => void
}) {
  const t = useTranslations('Chats')
  const qc = useQueryClient()
  const me = useAppSelector((s) => s.auth.user)
  const { show: showApiError } = useErrorToast('create-group')

  const [step, setStep] = useState<'members' | 'details'>('members')
  const [members, setMembers] = useState<DirectoryUser[]>([])
  const [title, setTitle] = useState('')
  // Название успели поправить руками — подставлять своё поверх больше нельзя.
  const [titleTouched, setTitleTouched] = useState(false)
  const [avatar, setAvatar] = useState<File | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)

  // Превью выбранного фото живёт по blob-ссылке — её обязательно отзывать, иначе файл
  // висит в памяти вкладки до перезагрузки.
  useEffect(() => {
    if (!avatar) return
    const url = URL.createObjectURL(avatar)
    setAvatarUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [avatar])

  /**
   * Имя по умолчанию — «я и остальные», как в Telegram: в подавляющем большинстве групп
   * его и оставляют, а придумывать название ради трёх человек не хочется никому. Как только
   * поле тронули руками, подстановка прекращается — иначе выбор ещё одного участника
   * затирал бы написанное.
   */
  const suggested = useMemo(() => {
    const names = [me?.firstName, ...members.map((m) => m.firstName)].filter(Boolean)
    return names.join(' & ').slice(0, TITLE_MAX)
  }, [me, members])

  const create = useMutation({
    mutationFn: async () => {
      const chat = await createChatRequest({
        type: 'GROUP',
        title: title.trim(),
        memberIds: members.map((m) => m.id),
      })
      // Фото ставится отдельным запросом: аватар грузится по id уже существующего чата.
      // Неудача здесь группу не отменяет — она уже создана, и человек доставит фото из
      // «изменить группу».
      if (avatar) {
        try {
          await setChatAvatarRequest(chat.id, avatar)
        } catch {
          toast.error(t('avatarUpdateFailed'))
        }
      }
      return chat
    },
    onSuccess: (chat) => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      toast.success(t('groupCreated'))
      onCreated(chat.id)
    },
    onError: (e) => showApiError(e),
  })

  // Кадрирование — поверх панели, а не вместо неё: окно портируется в body, колонка под ним
  // остаётся на месте, и черновик имени и состава никуда не девается. Аватар группы круглый,
  // без кадрирования в него попадала бы середина произвольного снимка.
  const crop = cropFile ? (
    <ImageCropModal
      file={cropFile}
      title={t('changeAvatar')}
      // Ждать нечего: файл никуда не уходит до создания группы, он просто ложится
      // в состояние панели.
      saving={false}
      onCancel={() => setCropFile(null)}
      onSave={(f) => {
        setAvatar(f)
        setCropFile(null)
      }}
    />
  ) : null

  if (step === 'members') {
    return (
      <ColumnPanel embedded={embedded} hidden={hidden}>
        <MembersScreen
          picked={members}
          onBack={onClose}
          onPicked={setMembers}
          onNext={() => {
            if (!titleTouched) setTitle(suggested)
            setStep('details')
          }}
        />
      </ColumnPanel>
    )
  }

  return (
    <ColumnPanel embedded={embedded} hidden={hidden}>
      <PanelHeader title={t('newGroup')} onBack={() => setStep('members')} />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-3 py-4">
        {/* Фото и название — одной карточкой: это одна мысль «как группа выглядит». */}
        <div className="flex shrink-0 flex-col items-center gap-4 rounded-2xl border border-border p-4">
          <label className="cursor-pointer">
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) setCropFile(f)
                // Сброс значения: тот же файл, выбранный второй раз, иначе не даст change.
                e.target.value = ''
              }}
            />
            <span className="flex size-24 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90">
              {avatarUrl ? (
                // Обычный img, а не next/image: это локальный blob выбранного файла —
                // оптимизировать и кэшировать в нём нечего.
                <img src={avatarUrl} alt="" className="size-full object-cover" />
              ) : (
                <Camera className="size-9" aria-hidden />
              )}
            </span>
            <span className="sr-only">{t('changeAvatar')}</span>
          </label>
          <Input
            autoFocus
            value={title}
            maxLength={TITLE_MAX}
            placeholder={t('groupNamePlaceholder')}
            aria-label={t('groupNamePlaceholder')}
            onChange={(e) => {
              setTitle(e.target.value)
              setTitleTouched(true)
            }}
          />
        </div>

        {members.length > 0 && (
          <div className="flex min-h-0 flex-1 flex-col">
            <SectionTitle>{t('groupMembersCount', { count: members.length })}</SectionTitle>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border">
              <ul className="min-h-0 flex-1 overflow-y-auto">
                {members.map((u, i) => (
                  <li
                    key={u.id}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2',
                      i > 0 && 'border-t border-border',
                    )}
                  >
                    <PersonAvatar user={u} />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {u.lastName} {u.firstName}
                    </span>
                    <button
                      type="button"
                      aria-label={t('removeMember')}
                      title={t('removeMember')}
                      onClick={() => setMembers((prev) => prev.filter((x) => x.id !== u.id))}
                      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Кнопка прижата к низу колонки: это итог экрана, а не продолжение списка. */}
        <Button
          className="mt-auto shrink-0 gap-2"
          loading={create.isPending}
          disabled={!title.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          <Check className="size-4" aria-hidden />
          {t('createGroup')}
        </Button>
      </div>
      {crop}
    </ColumnPanel>
  )
}

// ── Шаг 1: участники ─────────────────────────────────────────────────────────
/**
 * Люди из круга общения (GET /users/directory): без запроса — друзья и одногруппники,
 * с запросом — поиск по своему вузу. Список чатов сюда не годится: id собеседника он не
 * отдаёт, а по названию чата человека в группу не позвать.
 */
function MembersScreen({
  picked,
  onBack,
  onPicked,
  onNext,
}: {
  picked: DirectoryUser[]
  onBack: () => void
  onPicked: (users: DirectoryUser[]) => void
  onNext: () => void
}) {
  const t = useTranslations('Chats')
  const [query, setQuery] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setTerm(query.trim()), 300)
    return () => clearTimeout(id)
  }, [query])

  const people = useQuery({
    queryKey: directoryKeys.search(term),
    queryFn: () => fetchUserDirectory(term),
  })
  const items = people.data?.items ?? []
  const pickedIds = useMemo(() => new Set(picked.map((u) => u.id)), [picked])

  function toggle(u: DirectoryUser): void {
    onPicked(pickedIds.has(u.id) ? picked.filter((x) => x.id !== u.id) : [...picked, u])
  }

  return (
    <>
      <PanelHeader
        title={t('addMembers')}
        onBack={onBack}
        action={
          // Группа без участников не создаётся (сервер требует хотя бы одного), поэтому
          // «далее» до первой галочки выключено.
          <PanelHeaderButton label={t('next')} disabled={picked.length === 0} onClick={onNext}>
            <ArrowRight className="size-5" aria-hidden />
          </PanelHeaderButton>
        }
      />
      <PanelSearch value={query} onChange={setQuery} placeholder={t('search')} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border">
          {people.isLoading ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
              {t('noResults')}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {items.map((u, i) => (
                <li key={u.id} className={cn(i > 0 && 'border-t border-border')}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50">
                    <Checkbox
                      checked={pickedIds.has(u.id)}
                      onCheckedChange={() => toggle(u)}
                      aria-label={`${u.lastName} ${u.firstName}`}
                    />
                    <PersonAvatar user={u} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {u.lastName} {u.firstName}
                      </span>
                      {u.headline && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {u.headline}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button className="mt-4 shrink-0 gap-2" disabled={picked.length === 0} onClick={onNext}>
          {t('next')}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </>
  )
}

function PersonAvatar({ user }: { user: DirectoryUser }) {
  return (
    <Avatar className="size-10 shrink-0">
      {user.avatarThumbUrl && <AvatarImage src={user.avatarThumbUrl} alt="" />}
      <AvatarFallback className={cn('text-xs font-medium text-white', identityColor(user.id))}>
        {`${user.lastName[0] ?? ''}${user.firstName[0] ?? ''}`.toUpperCase() || '#'}
      </AvatarFallback>
    </Avatar>
  )
}
