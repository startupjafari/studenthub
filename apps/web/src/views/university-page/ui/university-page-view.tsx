'use client'

import { UniversityProfile } from '../../../widgets/user-profile'

// Страница университета: своим — витрина вуза и его объявления, компаниям с допуском — с кем
// они работают. Остальным сервер отвечает 404 — экран показывает «недоступна».
export function UniversityPageView({ universityId }: { universityId: string }) {
  return <UniversityProfile universityId={universityId} />
}
