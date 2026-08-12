import type { CreatePortfolioItemInput, UpdatePortfolioItemInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { PortfolioItem } from '../model/types'

export const portfolioKeys = {
  all: ['portfolio'] as const,
  mine: () => ['portfolio', 'mine'] as const,
  ofUser: (userId: string) => ['portfolio', 'user', userId] as const,
}

export async function fetchMyPortfolio(): Promise<PortfolioItem[]> {
  const { data } = await api.get<PortfolioItem[]>('/portfolio/mine')
  return data
}

export async function fetchUserPortfolio(userId: string): Promise<PortfolioItem[]> {
  const { data } = await api.get<PortfolioItem[]>(`/portfolio/user/${userId}`)
  return data
}

export async function createPortfolioItem(input: CreatePortfolioItemInput): Promise<PortfolioItem> {
  const { data } = await api.post<PortfolioItem>('/portfolio', input)
  return data
}

export async function updatePortfolioItem(
  id: string,
  input: UpdatePortfolioItemInput,
): Promise<PortfolioItem> {
  const { data } = await api.patch<PortfolioItem>(`/portfolio/${id}`, input)
  return data
}

export async function deletePortfolioItem(id: string): Promise<void> {
  await api.delete(`/portfolio/${id}`)
}
