import '@testing-library/jest-dom/vitest'

// jsdom не реализует window.matchMedia — её там нет вовсе. До vitest 4 заглушку
// подставлял сам раннер в своём jsdom-окружении; в 4 этого больше не происходит, и
// тесты, которые делают vi.spyOn(window, 'matchMedia'), падали с «can only spy on a
// function. Received undefined».
//
// Ставим минимальную заглушку сами: так окружение тестов описано явно и не зависит от
// того, что раннер делает за нас. Поведение по умолчанию — «медиазапрос не совпал»;
// тесты, которым нужен другой ответ, перекрывают его через spyOn.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    media: query,
    matches: false,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
