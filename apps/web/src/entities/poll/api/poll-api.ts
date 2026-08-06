import type { CreatePollInput, UpdatePollInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

export const pollKeys = {
  byUser: (userId: string) => ['polls', 'by-user', userId] as const,
  detail: (id: string) => ['polls', 'detail', id] as const,
  comments: (id: string) => ['polls', id, 'comments'] as const,
}

export interface PollComment {
  id: string
  content: string
  createdAt: string
  authorId: string
  author: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}

export interface PollOptionView {
  id: string
  text: string
  order: number
  votes: number
}

export interface PollView {
  id: string
  question: string
  multiple: boolean
  anonymous: boolean
  allowRevote: boolean
  resultsVisibility: string
  visibility: string
  status: string
  closesAt: string | null
  createdAt: string
  closed: boolean
  author: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  options: PollOptionView[]
  totalVotes: number
  participants: number
  commentCount: number
  myVotes: string[]
  canSeeResults: boolean
  canVote: boolean
}

export async function fetchPollsByUser(userId: string): Promise<PollView[]> {
  const { data } = await api.get<PollView[]>(`/polls/by-user/${userId}`)
  return data
}

export async function fetchPoll(id: string): Promise<PollView> {
  const { data } = await api.get<PollView>(`/polls/${id}`)
  return data
}

export async function createPoll(input: CreatePollInput): Promise<PollView> {
  const { data } = await api.post<PollView>('/polls', input)
  return data
}

export async function updatePoll(id: string, input: UpdatePollInput): Promise<PollView> {
  const { data } = await api.patch<PollView>(`/polls/${id}`, input)
  return data
}

export async function votePoll(id: string, optionIds: string[]): Promise<PollView> {
  const { data } = await api.post<PollView>(`/polls/${id}/vote`, { optionIds })
  return data
}

export async function cancelPollVote(id: string): Promise<PollView> {
  const { data } = await api.delete<PollView>(`/polls/${id}/vote`)
  return data
}

export async function deletePoll(id: string): Promise<void> {
  await api.delete(`/polls/${id}`)
}

export async function fetchPollComments(id: string): Promise<PollComment[]> {
  const { data } = await api.get<PollComment[]>(`/polls/${id}/comments`)
  return data
}

export async function addPollComment(id: string, content: string): Promise<PollComment> {
  const { data } = await api.post<PollComment>(`/polls/${id}/comments`, { content })
  return data
}

export async function deletePollComment(id: string, commentId: string): Promise<void> {
  await api.delete(`/polls/${id}/comments/${commentId}`)
}
