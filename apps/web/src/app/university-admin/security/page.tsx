import { SecurityHomeView } from '../../../views/security'

// Журналы поста охраны (docs/PROJECT.md §3.12): ведёт охрана, админ вуза только читает.
export default function UniversityAdminSecurityPage() {
  return <SecurityHomeView readOnly />
}
