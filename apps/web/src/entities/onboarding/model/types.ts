import type {
  DemoRejectionReasonValue,
  DemoRequestStatusValue,
  OnboardingStep,
} from '@studenthub/shared-schemas'

/** Заявка вуза так, как её видит платформенный админ в очереди. */
export interface DemoRequest {
  id: string
  universityName: string
  city: string | null
  country: string | null
  website: string | null
  studentsEstimate: number | null
  contactName: string
  contactRole: string | null
  email: string
  phone: string | null
  comment: string | null
  status: DemoRequestStatusValue
  consentAt: string
  consentVersion: string
  reviewedAt: string | null
  reviewedById: string | null
  rejectionReason: DemoRejectionReasonValue | null
  reviewNote: string | null
  universityId: string | null
  createdAt: string
}

export interface OnboardingStepState {
  step: OnboardingStep
  done: boolean
  skipped: boolean
  skippable: boolean
  count: number | null
}

export interface OnboardingState {
  university: {
    id: string
    name: string
    shortName: string | null
    city: string | null
    timezone: string
    status: 'PENDING' | 'ACTIVE' | 'BLOCKED'
  }
  steps: OnboardingStepState[]
  currentStep: OnboardingStep
  blocking: OnboardingStep[]
  canLaunch: boolean
  dismissedAt: string | null
  completedAt: string | null
}
