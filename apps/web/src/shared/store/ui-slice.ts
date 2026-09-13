import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

// ui-slice: только локальный UI-стейт (сайдбар, модалки). Серверные данные — в React Query (§15).
export interface UiState {
  sidebarOpen: boolean
  /**
   * Вуз, в чьём scope открыт карьерный центр. Нужен только ролям без своего вуза
   * (платформенные админ и модератор) — у остальных область данных берётся из токена.
   * Здесь, а не на странице: это контекст всего продукта, один на все его разделы.
   */
  careerUniversityId: string | null
}

const initialState: UiState = {
  sidebarOpen: true,
  careerUniversityId: null,
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen
    },
    setSidebarOpen(state, action: PayloadAction<boolean>) {
      state.sidebarOpen = action.payload
    },
    setCareerUniversity(state, action: PayloadAction<string | null>) {
      state.careerUniversityId = action.payload
    },
  },
})

export const { toggleSidebar, setSidebarOpen, setCareerUniversity } = uiSlice.actions
export const uiReducer = uiSlice.reducer
