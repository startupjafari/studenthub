import { api } from '../../../shared/api'

// Обращение в поддержку платформы: приватная переписка с командой StudentHub.
// Не путать с чатом «Помощь вуза» — там общая комната, где состоят все.

export interface OpenedTicket {
  id: string
  /** false — дописали в уже открытое обращение, а не завели второе. */
  created: boolean
}

export async function openSupportTicket(text: string): Promise<OpenedTicket> {
  const { data } = await api.post<OpenedTicket>('/support', { text })
  return data
}
