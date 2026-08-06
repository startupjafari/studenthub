import { configureStore } from '@reduxjs/toolkit'
import { authReducer } from './auth-slice'
import { uiReducer } from './ui-slice'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
  },
})

export type AppStore = typeof store
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']
