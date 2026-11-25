import { describe, expect, it } from 'vitest'
import { Role } from '@studenthub/shared-types'
import { GROUP_PICKER_ROLES } from './audiences'

describe('GROUP_PICKER_ROLES', () => {
  it('декан выбирает группу факультета: своей группы в профиле у него нет', () => {
    expect(GROUP_PICKER_ROLES).toContain(Role.DEAN)
  })
})
