import type Redis from 'ioredis'
import type { OpsNotifier } from '../../common/monitoring'
import { DeployTrackerService } from './deploy-tracker.service'
import type { BranchComparison, GithubApiService } from './github-api.service'

// T-9 (docs/TELEGRAM_BOT.md §8): «После успешного деплоя — список коммитов с прошлого».

const comparison: BranchComparison = {
  aheadBy: 3,
  commits: ['2c7a86e feat(ops): служебный канал', 'd82419c fix(web): компактный composer'],
  compareUrl: 'https://github.com/o/r/compare/aaa...bbb',
}

function setup(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
  }
  const github = {
    compare: jest.fn(async (_base: string, _head: string) => comparison as BranchComparison | null),
    failedStep: jest.fn(async (_runId: string) => 'Test (e2e)' as string | null),
  }
  const notifier: OpsNotifier & { emit: jest.Mock } = { emit: jest.fn() }
  const tracker = new DeployTrackerService(
    github as unknown as GithubApiService,
    redis as unknown as Redis,
    notifier,
  )
  return { tracker, github, notifier, store }
}

const deployed = (fullSha: string) => ({ service: 'api', deploymentId: 'dep-1', fullSha })

describe('DeployTrackerService — changelog', () => {
  it('первый деплой: SHA запоминается, но сравнивать не с чем — молчим', async () => {
    const { tracker, notifier, store } = setup()

    await tracker.onDeployEvent('deploySucceeded', deployed('bbb'))

    expect(notifier.emit).not.toHaveBeenCalled()
    expect(store.get('ops:deploy:sha:api')).toBe('bbb')
  })

  it('второй деплой: список коммитов с прошлого успешного', async () => {
    const { tracker, notifier, github } = setup({ 'ops:deploy:sha:api': 'aaa' })

    await tracker.onDeployEvent('deploySucceeded', deployed('bbb'))

    expect(github.compare).toHaveBeenCalledWith('aaa', 'bbb')
    expect(notifier.emit).toHaveBeenCalledWith('deployChangelog', {
      count: 3,
      commits: comparison.commits.join('\n'),
      compareUrl: comparison.compareUrl,
    })
  })

  it('передеплой того же коммита changelog не порождает', async () => {
    const { tracker, notifier } = setup({ 'ops:deploy:sha:api': 'bbb' })

    await tracker.onDeployEvent('deploySucceeded', deployed('bbb'))

    expect(notifier.emit).not.toHaveBeenCalled()
  })

  it('ручной деплой без SHA: момент релиза помним, changelog не выдумываем', async () => {
    const { tracker, notifier, store } = setup({ 'ops:deploy:sha:api': 'aaa' })

    await tracker.onDeployEvent('deploySucceeded', { service: 'api', deploymentId: 'dep-2' })

    expect(notifier.emit).not.toHaveBeenCalled()
    expect(store.has('ops:deploy:at')).toBe(true)
  })

  it('GitHub недоступен — сообщение о деплое уже ушло, changelog просто не приходит', async () => {
    const { tracker, notifier, github } = setup({ 'ops:deploy:sha:api': 'aaa' })
    github.compare.mockResolvedValueOnce(null)

    await tracker.onDeployEvent('deploySucceeded', deployed('bbb'))

    expect(notifier.emit).not.toHaveBeenCalled()
  })

  it('сбой дополнения не всплывает наружу: событие уже доставлено', async () => {
    const { tracker, github } = setup({ 'ops:deploy:sha:api': 'aaa' })
    github.compare.mockRejectedValueOnce(new Error('сеть'))

    await expect(tracker.onDeployEvent('deploySucceeded', deployed('bbb'))).resolves.toBeUndefined()
  })

  it('начавшийся и упавший деплой changelog не трогают', async () => {
    const { tracker, notifier } = setup({ 'ops:deploy:sha:api': 'aaa' })

    await tracker.onDeployEvent('deployStarted', deployed('bbb'))
    await tracker.onDeployEvent('deployFailed', deployed('bbb'))

    expect(notifier.emit).not.toHaveBeenCalled()
  })
})

describe('DeployTrackerService — шаг упавшего CI', () => {
  it('дочитывает шаг и переписывает то же сообщение', async () => {
    const { tracker, notifier } = setup()

    await tracker.onDeployEvent('ciFailed', { runId: '42', step: 'CI', branch: 'develop' })

    expect(notifier.emit).toHaveBeenCalledWith('ciFailed', {
      runId: '42',
      step: 'Test (e2e)',
      branch: 'develop',
    })
  })

  it('шаг не дочитался — в канале остаётся имя workflow, второго сообщения нет', async () => {
    const { tracker, notifier, github } = setup()
    github.failedStep.mockResolvedValueOnce(null)

    await tracker.onDeployEvent('ciFailed', { runId: '42', step: 'CI' })

    expect(notifier.emit).not.toHaveBeenCalled()
  })

  it('шаг совпал с уже показанным — не переписываем впустую', async () => {
    const { tracker, notifier, github } = setup()
    github.failedStep.mockResolvedValueOnce('CI')

    await tracker.onDeployEvent('ciFailed', { runId: '42', step: 'CI' })

    expect(notifier.emit).not.toHaveBeenCalled()
  })
})
