import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Role } from '@studenthub/shared-types'

// auth-slice: access-токен и профиль живут только в памяти (Redux), не в localStorage (§15, §6).
export interface AuthUser {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
}

export interface AuthState {
  user: AuthUser | null
  role: Role | null
  universityId: string | null
  facultyId: string | null
  groupId: string | null
  accessToken: string | null
}

const initialState: AuthState = {
  user: null,
  role: null,
  universityId: null,
  facultyId: null,
  groupId: null,
  accessToken: null,
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuth(
      state,
      action: PayloadAction<Omit<AuthState, 'accessToken'> & { accessToken: string }>,
    ) {
      return { ...action.payload }
    },
    setAccessToken(state, action: PayloadAction<string>) {
      state.accessToken = action.payload
    },
    clearAuth() {
      return initialState
    },
  },
})

export const { setAuth, setAccessToken, clearAuth } = authSlice.actions
export const authReducer = authSlice.reducer
