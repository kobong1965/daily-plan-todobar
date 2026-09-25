import { useCallback, useEffect, useMemo, useState } from 'react'

const GMAIL_ACTIVITY_STORAGE_KEY = 'todobar.gmail.activity.v1'
const GMAIL_IGNORED_STORAGE_KEY = 'todobar.gmail.ignored.v1'
const GMAIL_MOCK_STORAGE_KEY = 'todobar.gmail.mock.v1'
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

export type GmailConnectionState =
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'needs_reconnect'
  | 'unconfigured'

export type GmailSyncState =
  | 'idle'
  | 'refresh-ready'
  | 'syncing'
  | 'error'

export type GmailConnectionStatus = {
  accountEmail?: string | null
  message: string
  scope: string
  state: GmailConnectionState
  syncState: GmailSyncState
}

export type GmailThreadSuggestion = {
  date: string
  from: string
  gmailUrl: string
  snippet: string
  subject: string
  threadId: string
}

export type GmailSuggestionsResponse = {
  accountEmail: string
  fetchedAt: string
  suggestions: GmailThreadSuggestion[]
}

export type GmailActivity = {
  action: 'connect' | 'convert' | 'disconnect' | 'error' | 'ignore' | 'read'
  at: string
  detail: string
  id: string
}

export type GmailConnectorController = {
  activities: GmailActivity[]
  clearError: () => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  error: string
  ignoredThreadIds: string[]
  ignoreSuggestion: (threadId: string, subject: string) => void
  isLoading: boolean
  loadSuggestions: () => Promise<void>
  recordActivity: (action: GmailActivity['action'], detail: string) => void
  refreshStatus: () => Promise<void>
  status: GmailConnectionStatus
  suggestions: GmailThreadSuggestion[]
}

const isTauriRuntime = () =>
  new URLSearchParams(window.location.search).get('runtime') === 'tauri' ||
  window.location.protocol === 'tauri:' ||
  navigator.userAgent.includes('Tauri') ||
  '__TAURI_INTERNALS__' in window ||
  '__TAURI__' in window

const defaultDisconnectedStatus: GmailConnectionStatus = {
  accountEmail: null,
  message: '连接 Gmail 以查看未读收件箱建议。',
  scope: GMAIL_SCOPE,
  state: 'disconnected',
  syncState: 'idle',
}

const defaultMockSuggestions: GmailThreadSuggestion[] = [
  {
    date: '今天',
    from: 'Maya Chen',
    gmailUrl: 'https://mail.google.com/mail/u/0/#inbox/mock-thread-1',
    snippet: '可以把桌面侧栏评审整理成一份简短的行动清单吗？',
    subject: '评审每日计划演示笔记',
    threadId: 'mock-thread-1',
  },
  {
    date: '今天',
    from: 'GitHub',
    gmailUrl: 'https://mail.google.com/mail/u/0/#inbox/mock-thread-2',
    snippet: '发布检查清单中还有一条评论需要跟进。',
    subject: '跟进开源发布事项',
    threadId: 'mock-thread-2',
  },
]

function loadJson<T>(key: string, fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key)

    if (!stored) {
      return fallback
    }

    const parsed = JSON.parse(stored) as T
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function saveJson<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Connector audit state is helpful, but it must not block the UI.
  }
}

async function invokeNative<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core')

  return invoke<T>(command, args)
}

function loadBrowserMockStatus(): GmailConnectionStatus {
  const params = new URLSearchParams(window.location.search)
  const forcedState = params.get('gmail')
  const stored = loadJson<Partial<GmailConnectionStatus> & {
    suggestions?: GmailThreadSuggestion[]
  }>(GMAIL_MOCK_STORAGE_KEY, {})

  if (forcedState === 'connected' || stored.state === 'connected') {
    return {
      accountEmail: stored.accountEmail ?? 'alex@example.com',
      message: '浏览器测试用 Gmail 模拟连接已建立。',
      scope: GMAIL_SCOPE,
      state: 'connected',
      syncState: 'idle',
    }
  }

  if (forcedState === 'revoked' || stored.state === 'needs_reconnect') {
    return {
      accountEmail: stored.accountEmail ?? 'alex@example.com',
      message: 'Gmail 授权已过期，请重新连接。',
      scope: GMAIL_SCOPE,
      state: 'needs_reconnect',
      syncState: 'error',
    }
  }

  if (forcedState === 'unconfigured' || stored.state === 'unconfigured') {
    return {
      accountEmail: null,
      message:
        stored.message ??
        'Gmail 登录功能已接入，但此版本还没有配置每日计划的 Google OAuth 客户端 ID。',
      scope: GMAIL_SCOPE,
      state: 'unconfigured',
      syncState: 'idle',
    }
  }

  return defaultDisconnectedStatus
}

function loadBrowserMockSuggestions() {
  const stored = loadJson<{
    suggestions?: GmailThreadSuggestion[]
  }>(GMAIL_MOCK_STORAGE_KEY, {})

  return stored.suggestions?.length
    ? stored.suggestions
    : defaultMockSuggestions
}

function filterIgnoredSuggestions(
  suggestions: GmailThreadSuggestion[],
  ignoredThreadIds: string[],
) {
  const ignored = new Set(ignoredThreadIds)

  return suggestions.filter((suggestion) => !ignored.has(suggestion.threadId))
}

export function useGmailConnector(): GmailConnectorController {
  const [status, setStatus] = useState<GmailConnectionStatus>(
    defaultDisconnectedStatus,
  )
  const [suggestions, setSuggestions] = useState<GmailThreadSuggestion[]>([])
  const [activities, setActivities] = useState<GmailActivity[]>(() =>
    loadJson<GmailActivity[]>(GMAIL_ACTIVITY_STORAGE_KEY, []),
  )
  const [ignoredThreadIds, setIgnoredThreadIds] = useState<string[]>(() =>
    loadJson<string[]>(GMAIL_IGNORED_STORAGE_KEY, []),
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const recordActivity = useCallback(
    (action: GmailActivity['action'], detail: string) => {
      setActivities((current) => {
        const next = [
          {
            action,
            at: new Date().toISOString(),
            detail,
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          },
          ...current,
        ].slice(0, 8)

        saveJson(GMAIL_ACTIVITY_STORAGE_KEY, next)
        return next
      })
    },
    [],
  )

  const refreshStatus = useCallback(async () => {
    if (!isTauriRuntime()) {
      setStatus(loadBrowserMockStatus())
      return
    }

    try {
      const next = await invokeNative<GmailConnectionStatus>('gmail_status')

      setStatus(next)
      setError('')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)

      setError(message)
      setStatus({
        accountEmail: null,
        message,
        scope: GMAIL_SCOPE,
        state: 'error',
        syncState: 'error',
      })
      recordActivity('error', message)
    }
  }, [recordActivity])

  const loadSuggestions = useCallback(async () => {
    setIsLoading(true)
    setError('')

    try {
      if (!isTauriRuntime()) {
        const browserStatus = loadBrowserMockStatus()

        setStatus(browserStatus)

        if (browserStatus.state !== 'connected') {
          setSuggestions([])
          return
        }

        const filtered = filterIgnoredSuggestions(
          loadBrowserMockSuggestions(),
          ignoredThreadIds,
        )

        setSuggestions(filtered)
        recordActivity('read', `读取了 ${filtered.length} 条模拟未读 Gmail 邮件。`)
        return
      }

      const response = await invokeNative<GmailSuggestionsResponse>(
        'gmail_fetch_unread',
        { limit: 8 },
      )
      const filtered = filterIgnoredSuggestions(
        response.suggestions,
        ignoredThreadIds,
      )

      setStatus({
        accountEmail: response.accountEmail,
        message: `最近一次同步找到 ${filtered.length} 条未读建议。`,
        scope: GMAIL_SCOPE,
        state: 'connected',
        syncState: 'idle',
      })
      setSuggestions(filtered)
      recordActivity(
        'read',
        `读取了 ${response.suggestions.length} 条未读 Gmail 邮件。`,
      )
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      const needsReconnect =
        /reconnect|invalid_grant|401|403|authorization/i.test(message)

      setError(message)
      setStatus((current) => ({
        ...current,
        message: needsReconnect
          ? 'Gmail 授权已过期，请重新连接。'
          : message,
        state: needsReconnect ? 'needs_reconnect' : 'error',
        syncState: 'error',
      }))
      recordActivity('error', message)
    } finally {
      setIsLoading(false)
    }
  }, [ignoredThreadIds, recordActivity])

  const connect = useCallback(async () => {
    setIsLoading(true)
    setError('')

    try {
      if (!isTauriRuntime()) {
        const next = {
          accountEmail: 'alex@example.com',
          message: '浏览器测试用 Gmail 模拟连接已建立。',
          scope: GMAIL_SCOPE,
          state: 'connected' as const,
          syncState: 'idle' as const,
        }

        saveJson(GMAIL_MOCK_STORAGE_KEY, next)
        setStatus(next)
        recordActivity('connect', '已建立浏览器测试用 Gmail 模拟连接。')
        return
      }

      const next = await invokeNative<GmailConnectionStatus>('gmail_connect')

      setStatus(next)
      recordActivity(
        'connect',
        `已建立 Gmail 只读连接${next.accountEmail ? `（${next.accountEmail}）` : ''}。`,
      )
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)

      setError(message)
      setStatus((current) => ({
        ...current,
        message,
        state: message.includes('not configured') ? 'unconfigured' : 'error',
        syncState: 'error',
      }))
      recordActivity('error', message)
    } finally {
      setIsLoading(false)
    }
  }, [recordActivity])

  const disconnect = useCallback(async () => {
    setIsLoading(true)
    setError('')

    try {
      if (isTauriRuntime()) {
        await invokeNative<GmailConnectionStatus>('gmail_disconnect')
      } else {
        window.localStorage.removeItem(GMAIL_MOCK_STORAGE_KEY)
      }

      setStatus(defaultDisconnectedStatus)
      setSuggestions([])
      recordActivity('disconnect', '已断开 Gmail，并删除保存的 OAuth 令牌。')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)

      setError(message)
      recordActivity('error', message)
    } finally {
      setIsLoading(false)
    }
  }, [recordActivity])

  const ignoreSuggestion = useCallback(
    (threadId: string, subject: string) => {
      setIgnoredThreadIds((current) => {
        const next = [...new Set([...current, threadId])]

        saveJson(GMAIL_IGNORED_STORAGE_KEY, next)
        return next
      })
      setSuggestions((current) =>
        current.filter((suggestion) => suggestion.threadId !== threadId),
      )
      recordActivity('ignore', `已忽略 Gmail 建议：${subject}`)
    },
    [recordActivity],
  )

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void refreshStatus()
    }, 0)

    return () => window.clearTimeout(handle)
  }, [refreshStatus])

  useEffect(() => {
    if (status.state === 'connected') {
      const handle = window.setTimeout(() => {
        void loadSuggestions()
      }, 0)

      return () => window.clearTimeout(handle)
    }

    return undefined
  }, [loadSuggestions, status.state])

  return useMemo(
    () => ({
      activities,
      clearError: () => setError(''),
      connect,
      disconnect,
      error,
      ignoredThreadIds,
      ignoreSuggestion,
      isLoading,
      loadSuggestions,
      recordActivity,
      refreshStatus,
      status,
      suggestions,
    }),
    [
      activities,
      connect,
      disconnect,
      error,
      ignoredThreadIds,
      ignoreSuggestion,
      isLoading,
      loadSuggestions,
      recordActivity,
      refreshStatus,
      status,
      suggestions,
    ],
  )
}
