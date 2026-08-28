import { mapGithubHook } from './github.mapper'

// docs/TELEGRAM_BOT.md §7.5. Payload — форма вебхука `workflow_run` GitHub Actions.

const payload = (conclusion: string, action = 'completed') => ({
  action,
  workflow_run: {
    id: 981234,
    name: 'CI',
    conclusion,
    head_branch: 'feat/ops-telegram',
    head_sha: '2c7a86e1f9d0b4a5c6e7d8f9a0b1c2d3e4f5a6b7',
    html_url: 'https://github.com/startupjafari/studenthub/actions/runs/981234',
  },
})

describe('mapGithubHook', () => {
  it('упавший прогон — событие с веткой, коротким SHA и ссылкой на прогон', () => {
    expect(mapGithubHook(payload('failure'))).toEqual({
      event: 'ciFailed',
      data: {
        runId: '981234',
        step: 'CI',
        branch: 'feat/ops-telegram',
        sha: '2c7a86e',
        runUrl: 'https://github.com/startupjafari/studenthub/actions/runs/981234',
      },
    })
  })

  it('зелёный CI в канал не идёт: о норме служебный канал молчит', () => {
    expect(mapGithubHook(payload('success'))).toBeNull()
  })

  it('отменённый и пропущенный прогон — тоже молчание', () => {
    expect(mapGithubHook(payload('cancelled'))).toBeNull()
    expect(mapGithubHook(payload('skipped'))).toBeNull()
  })

  it('незавершённый прогон игнорируется — падать ещё нечему', () => {
    expect(mapGithubHook(payload('failure', 'requested'))).toBeNull()
  })

  it('чужие события GitHub (push, pull_request) не наши', () => {
    expect(mapGithubHook({ action: 'opened', pull_request: { number: 97 } })).toBeNull()
    expect(mapGithubHook({})).toBeNull()
  })
})
