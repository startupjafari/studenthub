'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Users } from 'lucide-react'
import type { StoryAudienceValue } from '@studenthub/shared-schemas'
import { useAppSelector } from '../../../shared/store'
import {
  STORY_AUDIENCES_BY_ROLE,
  STORY_FACULTY_PICKER_ROLES,
  STORY_GROUP_PICKER_ROLES,
} from '../../../entities/story'
import { GroupSelect } from '../../../entities/group'
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import {
  Button,
  FieldError,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui'
import { RecipientsPicker, type StoryRecipient } from './recipients-picker'

export interface StoryAudienceState {
  audience: StoryAudienceValue
  groupId?: string
  facultyId?: string
  /** Получатели — только у аудитории «выбранные». */
  recipients: StoryRecipient[]
}

// Ключи подписей аудиторий — статично: имена ключей не собираются из значений.
const AUDIENCE_KEY: Record<StoryAudienceValue, string> = {
  ALL: 'audienceALL',
  UNIVERSITY: 'audienceUNIVERSITY',
  FACULTY: 'audienceFACULTY',
  GROUP: 'audienceGROUP',
  TEACHERS: 'audienceTEACHERS',
  FRIENDS: 'audienceFRIENDS',
  SELECTED: 'audienceSELECTED',
}

/** Подпись аудитории сторис (namespace Feed) — для меню и окна смены аудитории. */
export function useAudienceLabel(): (audience: StoryAudienceValue) => string {
  const tFeed = useTranslations('Feed')
  return (audience) => tFeed(AUDIENCE_KEY[audience])
}

/** Аудитории, доступные роли текущего пользователя (зеркало правила сервера). */
export function useStoryAudiences(): StoryAudienceValue[] {
  const role = useAppSelector((s) => s.auth.role)
  return role ? (STORY_AUDIENCES_BY_ROLE[role] ?? []) : []
}

/**
 * Выбор аудитории сторис: тип, а для него — группа, факультет или получатели. Общий у
 * публикации и у смены аудитории уже вышедшей сторис. Смена типа сбрасывает поля
 * прежнего: группа от «Группы» не должна уехать на сервер вместе с «Друзьями».
 */
export function StoryAudienceFields({
  value,
  onChange,
  recipientsError,
}: {
  value: StoryAudienceState
  onChange: (next: StoryAudienceState) => void
  recipientsError?: string
}) {
  const tFeed = useTranslations('Feed')
  const t = useTranslations('Stories')
  const role = useAppSelector((s) => s.auth.role)
  const audiences = useStoryAudiences()
  const label = useAudienceLabel()
  const [picking, setPicking] = useState(false)

  const showGroupPicker =
    value.audience === 'GROUP' && role !== null && STORY_GROUP_PICKER_ROLES.includes(role)
  const showFacultyPicker =
    value.audience === 'FACULTY' && role !== null && STORY_FACULTY_PICKER_ROLES.includes(role)
  const faculties = useQuery({
    queryKey: facultyKeys.list(),
    queryFn: () => fetchFaculties(),
    enabled: showFacultyPicker,
  })

  return (
    <>
      <Select
        value={value.audience}
        onValueChange={(next) =>
          onChange({
            audience: next as StoryAudienceValue,
            recipients: next === 'SELECTED' ? value.recipients : [],
          })
        }
      >
        <SelectTrigger size="md" aria-label={tFeed('audience')} className="w-full sm:w-44">
          <SelectValue placeholder={tFeed('audience')} />
        </SelectTrigger>
        <SelectContent>
          {audiences.map((a) => (
            <SelectItem key={a} value={a}>
              {label(a)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showGroupPicker && (
        // Поиск по группам на сервере, а не первые 100 по алфавиту.
        <div className="w-full sm:w-44">
          <GroupSelect
            value={value.groupId ?? null}
            onChange={(v) => onChange({ ...value, groupId: v ?? undefined })}
            placeholder={tFeed('audienceGROUP')}
            size="md"
          />
        </div>
      )}

      {showFacultyPicker && (
        <Select
          value={value.facultyId ?? ''}
          onValueChange={(v) => onChange({ ...value, facultyId: v })}
        >
          <SelectTrigger size="md" aria-label={tFeed('audienceFACULTY')} className="w-full sm:w-44">
            <SelectValue placeholder={tFeed('audienceFACULTY')} />
          </SelectTrigger>
          <SelectContent>
            {(faculties.data ?? []).map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {value.audience === 'SELECTED' && (
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <Button type="button" variant="outline" size="md" onClick={() => setPicking(true)}>
            <Users className="size-4" aria-hidden />
            {value.recipients.length > 0
              ? t('recipientsCount', { count: value.recipients.length })
              : t('pickRecipients')}
          </Button>
          <FieldError>{recipientsError}</FieldError>
        </div>
      )}

      {picking && (
        <RecipientsPicker
          initial={value.recipients}
          onClose={() => setPicking(false)}
          onDone={(recipients) => {
            onChange({ ...value, recipients })
            setPicking(false)
          }}
        />
      )}
    </>
  )
}
