import { Suspense } from 'react'
import { DemoVerifyView } from '../../../views/demo'

// useSearchParams требует границы Suspense: без неё страница уходит в client-side
// рендер целиком и валит сборку.
export default function Page() {
  return (
    <Suspense>
      <DemoVerifyView />
    </Suspense>
  )
}
