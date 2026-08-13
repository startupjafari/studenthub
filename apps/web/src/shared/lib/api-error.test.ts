import { describe, expect, it } from 'vitest'
import { toApiError } from './api-error'

describe('toApiError', () => {
  it('нормализует объект { code, message }', () => {
    expect(toApiError({ code: 'NOT_FOUND', message: 'нет' })).toEqual({
      code: 'NOT_FOUND',
      message: 'нет',
    })
  })

  it('details включаются только если это массив', () => {
    const details = [{ path: 'x', message: 'bad' }]
    expect(toApiError({ code: 'VALIDATION_ERROR', message: 'm', details })).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'm',
      details,
    })
    expect(toApiError({ code: 'VALIDATION_ERROR', message: 'm', details: 'nope' })).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'm',
    })
  })

  it('message не строка → пустая строка', () => {
    expect(toApiError({ code: 'X' })).toEqual({ code: 'X', message: '' })
    expect(toApiError({ code: 'X', message: 42 })).toEqual({ code: 'X', message: '' })
  })

  it('нестроковый code / не объект / null → INTERNAL_ERROR', () => {
    expect(toApiError({ code: 123 })).toEqual({ code: 'INTERNAL_ERROR', message: '' })
    expect(toApiError('boom')).toEqual({ code: 'INTERNAL_ERROR', message: '' })
    expect(toApiError(null)).toEqual({ code: 'INTERNAL_ERROR', message: '' })
    expect(toApiError(undefined)).toEqual({ code: 'INTERNAL_ERROR', message: '' })
  })
})
