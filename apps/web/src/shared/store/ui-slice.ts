import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

// ui-slice: только локальный UI-стейт (сайдбар, модалки). Серверные данные — в React Query (§15).
export interface UiState {
  sidebarOpen: boolean
}

const initialState: UiState = {
  sidebarOpen: true,
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
  },
})

export const { toggleSidebar, setSidebarOpen } = uiSlice.actions
export const uiReducer = uiSlice.reducer
