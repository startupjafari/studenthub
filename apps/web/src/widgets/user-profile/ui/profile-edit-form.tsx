'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Briefcase,
  ClipboardList,
  FileText,
  GraduationCap,
  Mail,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import type { UpdateProfileInput } from '@studenthub/shared-schemas'
import type { MeResponse } from '../../../shared/api'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  CountryFlag,
  DatePicker,
  DictSingleSelect,
  Input,
  Label,
  LanguageFlag,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../../shared/ui'
import {
  ACADEMIC_STATUS_DICT,
  COUNTRY_VALUES,
  DORMITORY_DICT,
  EDUCATION_LEVEL_DICT,
  FUNDING_TYPE_DICT,
  INTERESTS_DICT,
  LANGUAGE_VALUES,
  MARITAL_STATUS_DICT,
  SKILLS_DICT,
  STUDY_FORM_DICT,
  TIMEZONE_DICT,
  countryCodeOf,
  languageFlagOf,
  yearOptions,
} from '../../../shared/config'
import { fetchSpecialties, specialtyKeys } from '../../../entities/specialty'
import { cn } from '../../../shared/lib/utils'
import type { FieldDef, Section } from './sections'
import { DictMultiSelect } from './dict-multi-select'
import { PhoneInput } from './phone-input'
import { HandleInput } from './handle-input'

const DICT_OPTIONS: Record<string, string[]> = {
  skills: SKILLS_DICT,
  interests: INTERESTS_DICT,
  languages: LANGUAGE_VALUES,
  countries: COUNTRY_VALUES,
  maritalStatus: MARITAL_STATUS_DICT,
  timezone: TIMEZONE_DICT,
  educationLevel: EDUCATION_LEVEL_DICT,
  studyForm: STUDY_FORM_DICT,
  fundingType: FUNDING_TYPE_DICT,
  academicStatus: ACADEMIC_STATUS_DICT,
  dormitory: DORMITORY_DICT,
}

// Иконки секций — те же, что в просмотре профиля (чтобы форма читалась как будущий результат).
const SECTION_META: Record<string, LucideIcon> = {
  sectionAbout: FileText,
  sectionContacts: Mail,
  sectionPersonal: UserRound,
  sectionStudy: GraduationCap,
  sectionStarosta: ClipboardList,
  sectionWork: Briefcase,
  sectionInterests: Sparkles,
}

// Числовые поля профиля — приводятся к числу на сохранении (остальные dict/text — строки).
const NUMERIC_KEYS = new Set(['course', 'enrollmentYear', 'graduationYear', 'gpa'])

function languageItem(v: string): React.ReactNode {
  const flag = languageFlagOf(v)
  return (
    <span className="inline-flex items-center gap-1.5">
      {flag && <LanguageFlag code={flag} />}
      {v}
    </span>
  )
}

function countryItem(v: string): React.ReactNode {
  const code = countryCodeOf(v)
  return (
    <span className="inline-flex items-center gap-1.5">
      {code && <CountryFlag code={code} />}
      {v}
    </span>
  )
}

// id формы — чтобы кнопка «Сохранить» жила в шапке профиля (submit по form-атрибуту).
export const PROFILE_EDIT_FORM_ID = 'profile-edit-form'

interface ProfileEditFormProps {
  me: MeResponse
  sections: Section[]
  onSave: (payload: UpdateProfileInput) => void
}

// Форма редактирования профиля: карточки-секции как в просмотре (Контакты/Учёба/Личное…).
export function ProfileEditForm({ me, sections, onSave }: ProfileEditFormProps) {
  const t = useTranslations('Profile')

  const initial = (): Record<string, string> => {
    const o: Record<string, string> = {
      firstName: me.firstName,
      lastName: me.lastName,
      middleName: me.middleName ?? '',
      headline: me.headline ?? '',
    }
    for (const s of sections) {
      for (const f of s.fields) {
        const raw = (me as unknown as Record<string, unknown>)[f.key]
        o[f.key] =
          f.type === 'list'
            ? Array.isArray(raw)
              ? raw.join(', ')
              : ''
            : raw == null
              ? ''
              : String(raw)
      }
    }
    return o
  }

  // Специальности вуза (справочник, который ведёт админ) — для Select поля «Специальность».
  const specialtiesQuery = useQuery({ queryKey: specialtyKeys.list(), queryFn: fetchSpecialties })
  const specialtyOptions = (specialtiesQuery.data ?? []).map((s) => s.name)

  const [form, setForm] = useState<Record<string, string>>(initial)
  const [showEmail, setShowEmail] = useState(me.showEmail)
  const [showPhone, setShowPhone] = useState(me.showPhone ?? false)
  const set = (k: string, v: string): void => setForm((p) => ({ ...p, [k]: v }))

  function submit(): void {
    const p: Record<string, unknown> = {
      firstName: form.firstName?.trim(),
      lastName: form.lastName?.trim(),
      middleName: form.middleName ?? '',
      headline: form.headline ?? '',
      showEmail,
      showPhone,
    }
    for (const s of sections) {
      for (const f of s.fields) {
        const v = form[f.key] ?? ''
        if (f.type === 'list')
          p[f.key] = v
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        else if (NUMERIC_KEYS.has(f.key)) p[f.key] = v === '' ? null : Number(v)
        else if (f.type === 'date') p[f.key] = v === '' ? null : v
        else p[f.key] = v
      }
    }
    onSave(p as unknown as UpdateProfileInput)
  }

  // Верхняя граница для дат (дата рождения не может быть в будущем).
  const todayStr = new Date().toISOString().slice(0, 10)

  const field = (f: FieldDef): React.ReactNode => {
    const val = form[f.key] ?? ''
    if (f.type === 'phone')
      return <PhoneInput id={f.key} value={val} onChange={(v) => set(f.key, v)} />
    if (f.type === 'date')
      // Кастомный DatePicker. Значение из API может быть полным ISO — берём YYYY-MM-DD.
      return (
        <DatePicker
          aria-label={t(f.key)}
          max={todayStr}
          value={val ? val.slice(0, 10) : ''}
          onChange={(v) => set(f.key, v)}
        />
      )
    if (f.type === 'telegram' || f.type === 'instagram')
      return (
        <HandleInput id={f.key} platform={f.type} value={val} onChange={(v) => set(f.key, v)} />
      )
    if (f.type === 'url')
      return (
        <Input
          id={f.key}
          type="url"
          value={val}
          onChange={(e) => set(f.key, e.target.value)}
          placeholder="https://"
        />
      )
    if (f.type === 'year')
      return (
        <DictSingleSelect value={val} onChange={(v) => set(f.key, v)} options={yearOptions()} />
      )
    if (f.type === 'textarea')
      return (
        <Textarea id={f.key} value={val} onChange={(e) => set(f.key, e.target.value)} rows={6} />
      )
    if (f.type === 'gender')
      return (
        <Select value={val || undefined} onValueChange={(v) => set(f.key, v === '__none' ? '' : v)}>
          <SelectTrigger id={f.key}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">—</SelectItem>
            <SelectItem value="MALE">{t('gender_MALE')}</SelectItem>
            <SelectItem value="FEMALE">{t('gender_FEMALE')}</SelectItem>
            <SelectItem value="OTHER">{t('gender_OTHER')}</SelectItem>
          </SelectContent>
        </Select>
      )
    if (f.dict) {
      if (f.type === 'list') {
        const arr = val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        return (
          <DictMultiSelect
            value={arr}
            onChange={(next) => set(f.key, next.join(', '))}
            options={DICT_OPTIONS[f.dict] ?? []}
            renderItem={f.dict === 'languages' ? languageItem : undefined}
          />
        )
      }
      return (
        <DictSingleSelect
          value={val}
          onChange={(v) => set(f.key, v)}
          options={f.dict === 'specialty' ? specialtyOptions : (DICT_OPTIONS[f.dict] ?? [])}
          renderItem={f.dict === 'countries' ? countryItem : undefined}
        />
      )
    }
    return (
      <Input
        id={f.key}
        type={f.type === 'number' ? 'number' : 'text'}
        value={val}
        onChange={(e) => set(f.key, e.target.value)}
      />
    )
  }

  const nameField = (key: 'lastName' | 'firstName' | 'middleName') => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={key}>{t(key)}</Label>
      <Input id={key} value={form[key] ?? ''} onChange={(e) => set(key, e.target.value)} />
    </div>
  )

  return (
    <form
      id={PROFILE_EDIT_FORM_ID}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex flex-col gap-5"
    >
      {/* Основное: ФИО + статус + приватность */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound className="size-4 text-primary" aria-hidden />
            {t('sectionMain')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {nameField('lastName')}
            {nameField('firstName')}
            {nameField('middleName')}
            <div className="flex flex-col gap-2">
              <Label htmlFor="headline">{t('headline')}</Label>
              <DictSingleSelect
                value={form.headline ?? ''}
                onChange={(v) => set('headline', v)}
                options={MARITAL_STATUS_DICT}
              />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={showEmail} onCheckedChange={(v) => setShowEmail(v === true)} />
              {t('showEmail')}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={showPhone} onCheckedChange={(v) => setShowPhone(v === true)} />
              {t('showPhone')}
            </label>
          </div>
        </CardContent>
      </Card>

      {sections.map((s) => {
        const Icon = SECTION_META[s.title] ?? UserRound
        return (
          <Card key={s.title}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon className="size-4 text-primary" aria-hidden />
                {t(s.title)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={cn('grid gap-4', s.fields.length > 1 && 'sm:grid-cols-2')}>
                {s.fields.map((f) => (
                  <div
                    key={f.key}
                    className={cn(
                      'flex flex-col gap-2',
                      (f.type === 'textarea' || f.type === 'list') && 'sm:col-span-2',
                    )}
                  >
                    <Label htmlFor={f.key}>{t(f.key)}</Label>
                    {field(f)}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </form>
  )
}
