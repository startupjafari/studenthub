import { CamerasWatchView } from '../../../../views/cameras'

// Просмотр камер вуза администратором (docs/PROJECT.md §3.10).
export default function Page() {
  return <CamerasWatchView backHref="/university-admin/cameras" />
}
