'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Link2 } from 'lucide-react'
import type { PlanSpace } from '@studenthub/campus-core'
import { createRoomRequest, roomKeys, type Room } from '../../../entities/room'
import { Button, useConfirm } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { planRoomLinks, type FloorContext } from '../model/link-rooms'
import { useEditor, type EditorStore } from '../model/store'

/**
 * «Связать по номерам»: все помещения этажа разом получают аудитории вуза с тем же номером,
 * недостающие учебные — создаются (после подтверждения: это новые записи в реестре вуза).
 * Одна кнопка вместо выбора аудитории у каждой комнаты.
 */
export function LinkRoomsButton({
  store,
  rooms,
  context,
}: {
  store: EditorStore
  rooms: Room[] | undefined
  context: FloorContext
}) {
  const t = useTranslations('CampusEditor')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const readonly = useEditor(store, (s) => s.saveState === 'readonly')
  // Связывать есть что, пока у помещения с номером нет аудитории.
  const pending = useEditor(
    store,
    (s) => Object.values(s.doc.spaces).filter((sp: PlanSpace) => !sp.roomId && !!sp.number).length,
  )
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    if (!rooms) return
    const plan = planRoomLinks(store.getState().doc, rooms, context)
    const linked = Object.keys(plan.links).length
    if (linked === 0 && plan.create.length === 0) {
      toast.info(t('linkNothing'))
      return
    }
    let created: Record<string, string> = {}
    if (plan.create.length > 0) {
      const ok = await confirm({
        title: t('linkCreateConfirm', { count: plan.create.length }),
        description: t('linkCreateHint'),
      })
      if (ok) {
        setBusy(true)
        try {
          for (const item of plan.create) {
            const room = await createRoomRequest(item.input)
            created = { ...created, [item.spaceId]: room.id }
          }
        } catch (e) {
          toast.error(tErr(toApiError(e).code))
        } finally {
          setBusy(false)
          void qc.invalidateQueries({ queryKey: roomKeys.all })
        }
      }
    }
    const all = { ...plan.links, ...created }
    if (Object.keys(all).length === 0) return
    store.apply('linkRooms', (d) => {
      const spaces = { ...d.spaces }
      for (const [spaceId, roomId] of Object.entries(all)) {
        const sp = spaces[spaceId]
        if (sp && !sp.roomId) spaces[spaceId] = { ...sp, roomId }
      }
      return { ...d, spaces }
    })
    toast.success(t('linkDone', { linked, created: Object.keys(created).length }))
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="md"
      className="w-full"
      disabled={readonly || busy || !rooms || pending === 0}
      loading={busy}
      onClick={() => void run()}
    >
      <Link2 aria-hidden />
      {t('linkByNumber')}
    </Button>
  )
}
