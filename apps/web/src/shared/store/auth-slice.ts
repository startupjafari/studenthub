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
    // Профиль в сторе — зеркало серверного `me`, и его надо обновлять при правке профиля:
    // иначе аватар и имя, взятые отсюда (композер комментариев, чат), остаются такими,
    // какими были на момент входа, пока пользователь не перезагрузит страницу.
    setSessionUser(state, action: PayloadAction<AuthUser>) {
      state.user = action.payload
    },
    clearAuth() {
      return initialState
    },
  },
})

export const { setAuth, setAccessToken, setSessionUser, clearAuth } = authSlice.actions
export const authReducer = authSlice.reducer
