import { Suspense } from 'react'
import { IssueView } from '../../../views/library-desk'

// Выдача книг библиотекарем (Фаза 20.4). useSearchParams требует Suspense.
export default function Page() {
  return (
    <Suspense>
      <IssueView />
    </Suspense>
  )
}
