import { Suspense } from 'react'
import { VerifyIdView } from '../../../views/student-id'

// Верификация студенческого сотрудником (задача 20). useSearchParams требует Suspense.
export default function Page() {
  return (
    <Suspense>
      <VerifyIdView />
    </Suspense>
  )
}
