'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  CreatePortfolioItemSchema,
  UpdatePortfolioItemSchema,
  type CreatePortfolioItemInput,
} from '@studenthub/shared-schemas'
import {
  Button,
  DatePicker,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  createPortfolioItem,
  portfolioKeys,
  updatePortfolioItem,
  type PortfolioItem,
  type PortfolioKind,
  type PortfolioVisibility,
} from '../../../entities/portfolio'
import { PORTFOLIO_KINDS, PORTFOLIO_VISIBILITY, kindKey, visibilityKey } from '../lib/visuals'

interface Props {
  // При редактировании — существующая запись; иначе создаём новую (с предвыбранным видом).
  item?: PortfolioItem
  defaultKind?: PortfolioKind
  onClose: () => void
}

// YMD (из DatePicker) → ISO с оффсетом для API; пусто → undefined.
function ymdToIso(ymd: string): string | undefined {
  if (!ymd) return undefined
  const d = new Date(`${ymd}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

// ISO → YMD для DatePicker.
function isoToYmd(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

// Модалка создания/редактирования записи портфолио (задача 21).
export function PortfolioItemModal({ item, defaultKind, onClose }: Props) {
  const t = useTranslations('Portfolio')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const [kind, setKind] = useState<PortfolioKind>(item?.kind ?? defaultKind ?? 'PROJECT')
  const [title, setTitle] = useState(item?.title ?? '')
  const [organization, setOrganization] = useState(item?.organization ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [url, setUrl] = useState(item?.url ?? '')
  const [startDate, setStartDate] = useState(isoToYmd(item?.startDate))
  const [endDate, setEndDate] = useState(isoToYmd(item?.endDate))
  const [visibility, setVisibility] = useState<PortfolioVisibility>(
    item?.visibility ?? 'UNIVERSITY',
  )
  const [pending, setPending] = useState(false)

  async function onSubmit() {
    setPending(true)
    try {
      if (item) {
        // Правка: пустые поля отправляем как null, чтобы их можно было очистить.
        const payload = {
          kind,
          title: title.trim(),
          organization: organization.trim() || null,
          description: description.trim() || null,
          url: url.trim() || null,
          startDate: ymdToIso(startDate) ?? null,
          endDate: ymdToIso(endDate) ?? null,
          visibility,
        }
        const parsed = UpdatePortfolioItemSchema.safeParse(payload)
        if (!parsed.success) {
          toast.error(t('formInvalid'))
          return
        }
        await updatePortfolioItem(item.id, parsed.data)
      } else {
        // Создание: пустые опциональные поля просто опускаем.
        const payload = {
          kind,
          title: title.trim(),
          ...(organization.trim() ? { organization: organization.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(url.trim() ? { url: url.trim() } : {}),
          ...(startDate ? { startDate: ymdToIso(startDate) } : {}),
          ...(endDate ? { endDate: ymdToIso(endDate) } : {}),
          visibility,
        }
        const parsed = CreatePortfolioItemSchema.safeParse(
          payload satisfies CreatePortfolioItemInput,
        )
        if (!parsed.success) {
          toast.error(t('formInvalid'))
          return
        }
        await createPortfolioItem(parsed.data)
      }
      await qc.invalidateQueries({ queryKey: portfolioKeys.mine() })
      toast.success(item ? t('saved') : t('created'))
      onClose()
    } catch (e) {
      toast.error(tErr(toApiError(e).code))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal onClose={onClose} title={item ? t('editItem') : t('newItem')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t('kind')}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as PortfolioKind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PORTFOLIO_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(kindKey(k))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pf-title">{t('titleField')}</Label>
          <Input
            id="pf-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('titlePlaceholder')}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pf-org">{t('organization')}</Label>
          <Input
            id="pf-org"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder={t('organizationPlaceholder')}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>{t('startDate')}</Label>
            <DatePicker value={startDate} onChange={setStartDate} max={endDate || undefined} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('endDate')}</Label>
            <DatePicker value={endDate} onChange={setEndDate} min={startDate || undefined} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pf-desc">{t('description')}</Label>
          <Textarea
            id="pf-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pf-url">{t('url')}</Label>
          <Input
            id="pf-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t('visibility')}</Label>
          <Select value={visibility} onValueChange={(v) => setVisibility(v as PortfolioVisibility)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PORTFOLIO_VISIBILITY.map((v) => (
                <SelectItem key={v} value={v}>
                  {t(visibilityKey(v))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={onSubmit} loading={pending} disabled={!title.trim()}>
            {t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
