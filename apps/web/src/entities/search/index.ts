export { searchKeys, fetchSearch } from './api/search-api'
export { useSearchItems, SEARCH_MIN_QUERY, SEARCH_DEBOUNCE_MS } from './model/use-search-items'
export type { SearchItem, SearchItemsState } from './model/use-search-items'
export type {
  SearchResults,
  SearchPerson,
  SearchCourse,
  SearchAssignment,
  SearchMaterial,
} from './model/types'
