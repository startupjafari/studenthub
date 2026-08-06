import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from './store'

// Типизированные хуки Redux — использовать вместо голых useDispatch/useSelector.
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
