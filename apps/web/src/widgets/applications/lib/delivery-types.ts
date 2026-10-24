import type { DeliveryType } from '@studenthub/shared-schemas'

/** Способы получения, из которых выбирает студент, по режимам выдачи услуги. */
export function allowedDeliveryTypes(modes: string[]): DeliveryType[] {
  const e = modes.includes('ELECTRONIC')
  const p = modes.includes('PAPER')
  const out: DeliveryType[] = []
  if (e) out.push('ELECTRONIC')
  if (p) out.push('PAPER')
  if (e && p) out.push('BOTH')
  return out
}
