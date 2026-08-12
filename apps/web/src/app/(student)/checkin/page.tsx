import { Suspense } from 'react'
import { CheckinView } from '../../../views/attendance'

// Самоотметка по QR (задача 6). useSearchParams требует Suspense-границу.
export default function Page() {
  return (
    <Suspense>
      <CheckinView />
    </Suspense>
  )
}
