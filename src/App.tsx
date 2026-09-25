import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  ExternalLink,
  GripVertical,
  ImagePlus,
  Inbox,
  ListTodo,
  Mail,
  Maximize2,
  Moon,
  Minus,
  Palette,
  Pencil,
  Pin,
  RefreshCw,
  RotateCcw,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
} from 'react'
import './App.css'
import { useGmailConnector } from './gmail'
import type { GmailConnectorController, GmailThreadSuggestion } from './gmail'
import { themePresetsByMode, useSidebarSettings } from './sidebarSettings'
import type {
  DockEdge,
  SectionId,
  SidebarSettings,
  TabVisibility,
  TaskSortMode,
  ThemeMode,
  ThemePreset,
} from './sidebarSettings'
import { scheduleLocalStorageWrite } from './storage'
import {
  initialToday,
  longTermTask,
  monthPlan,
  TASK_COLOR_OPTIONS,
} from './tasks'
import type { Task, TaskColor } from './tasks'
import { usePersistentTasks } from './usePersistentTasks'

const DRAG_THRESHOLD = 5
const NATIVE_HIT_TEST_EDGE_INTERVAL_MS = 72
const NATIVE_HIT_TEST_IDLE_INTERVAL_MS = 128
const TASK_STORAGE_KEYS = {
  today: 'todobar.today.v1',
  month: 'todobar.month.v1',
} as const
const LONG_TERM_STORAGE_KEY = 'todobar.long-term.v1'
const CUSTOM_LISTS_STORAGE_KEY = 'todobar.custom-lists.v1'
const NOTIFIED_REMINDERS_STORAGE_KEY = 'todobar.notified-reminders.v1'
const SETTINGS_GROUPS_STORAGE_KEY = 'todobar.settings.groups.v1'
const GMAIL_CONNECTOR_VISIBLE = false
const TOP_DOCK_MIN_PANEL_WIDTH = 720
const TOP_DOCK_MAX_PANEL_WIDTH = 1120
const TOP_DOCK_WIDTH_MULTIPLIER = 2
const SECTION_LABELS: Record<SectionId, string> = {
  calendar: '日历',
  lists: '清单',
  today: '今天',
}
const THEME_PRESETS = [
  {
    id: 'codex',
    label: '工作室',
    mode: 'light',
    note: '中性简洁',
  },
  {
    id: 'porcelain',
    label: '瓷白',
    mode: 'light',
    note: '柔和白',
  },
  {
    id: 'frost',
    label: '霜蓝',
    mode: 'light',
    note: '清冷蓝',
  },
  {
    id: 'paper',
    label: '纸张',
    mode: 'light',
    note: '温暖哑光',
  },
  {
    id: 'clay',
    label: '陶土',
    mode: 'light',
    note: '低饱和暖色',
  },
  {
    id: 'blueprint',
    label: '蓝图',
    mode: 'light',
    note: '浅色网格',
  },
  {
    id: 'codex',
    label: '曜石',
    mode: 'dark',
    note: '深色中性',
  },
  {
    id: 'carbon',
    label: '炭黑',
    mode: 'dark',
    note: '柔和黑',
  },
  {
    id: 'graphite',
    label: '石墨',
    mode: 'dark',
    note: '深度专注',
  },
  {
    id: 'midnight',
    label: '夜幕',
    mode: 'dark',
    note: '蓝黑',
  },
  {
    id: 'clay',
    label: '余烬',
    mode: 'dark',
    note: '暖色深调',
  },
  {
    id: 'blueprint',
    label: '网格',
    mode: 'dark',
    note: '深色网格',
  },
] as const satisfies Array<{
  id: ThemePreset
  label: string
  mode: ThemeMode
  note: string
}>
type ThemePresetOption = (typeof THEME_PRESETS)[number]

type TaskListId = keyof typeof TASK_STORAGE_KEYS
type TaskDrafts = Record<TaskListId, string>
type ReminderDrafts = Record<TaskListId, string>
type TaskColorDrafts = Record<TaskListId, TaskColor>
type CollapsedSections = Record<TaskListId, boolean>
type CalendarEntryMode = 'task' | 'event'
type SettingsGroupId =
  | 'theme'
  | 'edge'
  | 'layout'
  | 'desktop'
  | 'connectors'
  | 'backdrop'
  | 'window'
  | 'tasks'
  | 'feel'
type CustomTaskList = {
  id: string
  title: string
  tasks: Task[]
  collapsed?: boolean
  showOnToday?: boolean
}
type CalendarTaskRef = {
  listId?: string
  listTitle: string
  source: TaskListId | 'custom'
  task: Task
}
type ReminderToast = {
  id: string
  title: string
  body: string
  dueLabel: string
  listId?: string
  reminderAt?: string
  source: CalendarTaskRef['source']
  taskId: number
}

const defaultCustomLists: CustomTaskList[] = [
  {
    id: 'general',
    title: '常规',
    tasks: [],
    collapsed: false,
  },
]

const isTauriRuntime = () =>
  new URLSearchParams(window.location.search).get('runtime') === 'tauri' ||
  window.location.protocol === 'tauri:' ||
  navigator.userAgent.includes('Tauri') ||
  '__TAURI_INTERNALS__' in window ||
  '__TAURI__' in window

type NativeWindowHandle<Position> = {
  setPosition: (position: Position) => Promise<void>
}
type HandleDragState = {
  startScreenY: number
  startHandleY: number
  height: number
  moved: boolean
  latestHandleY: number | null
}

const DEFAULT_TASK_COLOR: TaskColor = 'white'
const TASK_COLOR_ORDER: Record<TaskColor, number> = {
  red: 0,
  gold: 1,
  purple: 2,
  blue: 3,
  white: 4,
}

function colorForTask(task: Task): TaskColor {
  const savedColor =
    typeof task.color === 'string' ? (task.color as string) : ''

  if (
    savedColor === 'red' ||
    savedColor === 'gold' ||
    savedColor === 'purple' ||
    savedColor === 'blue' ||
    savedColor === 'white'
  ) {
    return savedColor
  }

  // Migrate colors from the previous picker without rewriting saved tasks.
  if (savedColor === 'orange') {
    return 'gold'
  }

  if (savedColor === 'green' || savedColor === 'gray') {
    return 'white'
  }

  // Older tasks only carried priority. Use that value once as a display fallback.
  if (task.priority === 'focus') {
    return 'red'
  }

  if (task.priority === 'later') {
    return 'white'
  }

  return 'blue'
}

function progressForTask(task: Task) {
  const progress = typeof task.progress === 'number' ? task.progress : 0

  return Math.min(100, Math.max(0, Math.round(progress)))
}

function sortTasks(tasks: Task[], sortMode: TaskSortMode = 'color') {
  return [...tasks].sort((a, b) => {
    if (sortMode === 'newest') {
      if (Boolean(a.done) !== Boolean(b.done)) {
        return a.done ? 1 : -1
      }

      return b.id - a.id
    }

    if (sortMode === 'oldest') {
      if (Boolean(a.done) !== Boolean(b.done)) {
        return a.done ? 1 : -1
      }

      return a.id - b.id
    }

    const colorDelta =
      TASK_COLOR_ORDER[colorForTask(a)] - TASK_COLOR_ORDER[colorForTask(b)]

    if (colorDelta !== 0) {
      return colorDelta
    }

    if (Boolean(a.done) !== Boolean(b.done)) {
      return a.done ? 1 : -1
    }

    return b.id - a.id
  })
}

function createTask(
  title: string,
  meta: string,
  reminderAt?: string,
  color: TaskColor = DEFAULT_TASK_COLOR,
): Task {
  return {
    id: Date.now(),
    title,
    meta,
    color,
    reminderAt: reminderAt || undefined,
  }
}

function createGmailTask(suggestion: GmailThreadSuggestion): Task {
  return {
    id: Date.now(),
    title: suggestion.subject,
    meta: `Gmail · ${suggestion.from}`,
    color: DEFAULT_TASK_COLOR,
    source: {
      from: suggestion.from,
      threadId: suggestion.threadId,
      type: 'gmail',
      url: suggestion.gmailUrl,
    },
  }
}

function createCalendarTask(
  title: string,
  date: Date,
  reminderAt: string,
  kind: CalendarEntryMode,
  color: TaskColor = DEFAULT_TASK_COLOR,
): Task {
  const isEvent = kind === 'event'

  return {
    id: Date.now(),
    title,
    kind,
    meta: `${formatCalendarDay(date)} · ${isEvent ? '事件' : '日历'}`,
    color,
    reminderAt,
  }
}

function toLocalDateTimeValue(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)

  return offsetDate.toISOString().slice(0, 16)
}

function nextQuickReminder(current?: string) {
  if (!current) {
    const next = new Date()
    next.setMinutes(next.getMinutes() + 30)
    next.setSeconds(0, 0)
    return toLocalDateTimeValue(next)
  }

  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(9, 0, 0, 0)

  const currentTime = new Date(current).getTime()
  const tomorrowTime = next.getTime()

  return Number.isFinite(currentTime) && currentTime < tomorrowTime
    ? toLocalDateTimeValue(next)
    : undefined
}

function reminderPresetValue(
  kind: 'soon' | 'tomorrow' | 'nextWeek',
  current?: string,
) {
  const currentDate = current ? new Date(current) : null
  const date =
    currentDate && Number.isFinite(currentDate.getTime())
      ? new Date(currentDate)
      : new Date()

  if (kind === 'soon') {
    date.setTime(Date.now())
    date.setMinutes(date.getMinutes() + 30)
  }

  if (kind === 'tomorrow') {
    date.setDate(date.getDate() + 1)
  }

  if (kind === 'nextWeek') {
    date.setDate(date.getDate() + 7)
  }

  date.setSeconds(0, 0)

  return toLocalDateTimeValue(date)
}

function formatReminder(reminderAt?: string) {
  if (!reminderAt) {
    return ''
  }

  const date = new Date(reminderAt)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(date)
}

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function parseReminderDate(reminderAt?: string) {
  if (!reminderAt) {
    return null
  }

  const date = new Date(reminderAt)

  return Number.isNaN(date.getTime()) ? null : date
}

function formatCalendarMonth(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function formatCalendarDay(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric',
    month: 'short',
  }).format(date)
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function buildCalendarDays(
  cursor: Date,
  tasks: Array<{ listTitle: string; task: Task }>,
) {
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const gridStart = new Date(monthStart)
  const mondayOffset = (monthStart.getDay() + 6) % 7
  const todayKey = formatDateKey(new Date())
  const taskCountsByDate = new Map<
    string,
    {
      doneCount: number
      eventCount: number
      taskCount: number
    }
  >()

  for (const { task } of tasks) {
    const reminderDate = parseReminderDate(task.reminderAt)

    if (!reminderDate) {
      continue
    }

    const key = formatDateKey(reminderDate)
    const counts = taskCountsByDate.get(key) ?? {
      doneCount: 0,
      eventCount: 0,
      taskCount: 0,
    }

    counts.taskCount += 1
    counts.doneCount += task.done ? 1 : 0
    counts.eventCount += task.kind === 'event' ? 1 : 0
    taskCountsByDate.set(key, counts)
  }

  gridStart.setDate(monthStart.getDate() - mondayOffset)

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)

    const key = formatDateKey(date)
    const counts = taskCountsByDate.get(key)

    return {
      date,
      doneCount: counts?.doneCount ?? 0,
      eventCount: counts?.eventCount ?? 0,
      isCurrentMonth: date.getMonth() === cursor.getMonth(),
      isToday: key === todayKey,
      key,
      taskCount: counts?.taskCount ?? 0,
    }
  })
}

function loadNotifiedReminderKeys() {
  try {
    const stored = window.localStorage.getItem(NOTIFIED_REMINDERS_STORAGE_KEY)
    const parsed = stored ? (JSON.parse(stored) as Record<string, boolean>) : {}

    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function moveSectionOrder(
  sections: SectionId[],
  section: SectionId,
  direction: -1 | 1,
) {
  const currentIndex = sections.indexOf(section)
  const nextIndex = currentIndex + direction

  if (
    currentIndex < 0 ||
    nextIndex < 0 ||
    nextIndex >= sections.length
  ) {
    return sections
  }

  const next = [...sections]
  const [item] = next.splice(currentIndex, 1)
  next.splice(nextIndex, 0, item)

  return next
}

function moveSectionOrderToIndex(
  sections: SectionId[],
  section: SectionId,
  targetIndex: number,
) {
  const currentIndex = sections.indexOf(section)

  if (currentIndex === -1 || currentIndex === targetIndex) {
    return sections
  }

  const next = sections.filter((item) => item !== section)
  const boundedIndex = Math.min(Math.max(targetIndex, 0), next.length)

  next.splice(boundedIndex, 0, section)
  return next
}

function getSectionMotionDirection(
  sections: SectionId[],
  current: SectionId,
  next: SectionId,
) {
  const currentIndex = sections.indexOf(current)
  const nextIndex = sections.indexOf(next)

  if (currentIndex === -1 || nextIndex === -1) {
    return 'forward'
  }

  return nextIndex >= currentIndex ? 'forward' : 'backward'
}

function getThemeOptions(theme: ThemeMode) {
  const allowed = themePresetsByMode[theme]

  return THEME_PRESETS.filter(
    (preset) => preset.mode === theme && allowed.includes(preset.id),
  )
}

function getNextThemePatch(
  currentTheme: ThemeMode,
  currentPreset: ThemePreset,
) {
  const theme: ThemeMode = currentTheme === 'dark' ? 'light' : 'dark'
  const allowed = themePresetsByMode[theme]

  return {
    theme,
    visualStyle: allowed.includes(currentPreset)
      ? currentPreset
      : allowed[0],
  }
}

function getDockPanelWidth(
  dockEdge: DockEdge,
  panelWidth: number,
  tabWidth: number,
  viewportWidth: number,
) {
  const isTopDock = dockEdge === 'top'
  const reservedWidth = isTopDock ? 16 : tabWidth + 8
  const availableWidth = Math.max(280, viewportWidth - reservedWidth)
  const requestedWidth = isTopDock
    ? Math.max(
        TOP_DOCK_MIN_PANEL_WIDTH,
        Math.round(panelWidth * TOP_DOCK_WIDTH_MULTIPLIER),
      )
    : panelWidth

  return Math.min(
    requestedWidth,
    availableWidth,
    isTopDock ? TOP_DOCK_MAX_PANEL_WIDTH : Number.POSITIVE_INFINITY,
  )
}

function getLayoutPanelWidth(panelWidth: number, longTermWide: boolean) {
  return longTermWide ? Math.min(panelWidth * 2, 960) : panelWidth
}

function loadCustomLists() {
  try {
    const stored = window.localStorage.getItem(CUSTOM_LISTS_STORAGE_KEY)

    if (!stored) {
      return defaultCustomLists
    }

    const parsed = JSON.parse(stored) as CustomTaskList[]

    if (!Array.isArray(parsed)) {
      return defaultCustomLists
    }

    return parsed
      .filter((list) => list && typeof list.id === 'string')
      .map((list) => ({
        id: list.id,
        title: typeof list.title === 'string' ? list.title : '清单',
        tasks: Array.isArray(list.tasks) ? list.tasks : [],
        collapsed: Boolean(list.collapsed),
        showOnToday: Boolean(list.showOnToday),
      }))
  } catch {
    return defaultCustomLists
  }
}

function animateNativePosition<Position>(
  windowHandle: NativeWindowHandle<Position>,
  createPosition: (x: number, y: number) => Position,
  startX: number,
  endX: number,
  startY: number,
  endY: number,
  duration: number,
) {
  return new Promise<void>((resolve) => {
    const startTime = performance.now()
    let lastX = Number.NaN
    let lastY = Number.NaN

    const step = (time: number) => {
      const progress = Math.min((time - startTime) / duration, 1)
      const eased = progress * progress * (3 - 2 * progress)
      const nextX = Math.round(startX + (endX - startX) * eased)
      const nextY = Math.round(startY + (endY - startY) * eased)

      if (nextX !== lastX || nextY !== lastY) {
        lastX = nextX
        lastY = nextY
        void windowHandle.setPosition(createPosition(nextX, nextY))
      }

      if (progress < 1) {
        requestAnimationFrame(step)
      } else {
        resolve()
      }
    }

    requestAnimationFrame(step)
  })
}

function App() {
  const [isNative] = useState(() => isTauriRuntime())
  const [isOpen, setIsOpen] = useState(
    () => new URLSearchParams(window.location.search).get('open') === '1',
  )
  const [isSettingsOpen, setIsSettingsOpen] = useState(
    () => new URLSearchParams(window.location.search).get('settings') === '1',
  )
  const [activeRailSection, setActiveRailSection] = useState<SectionId>('today')
  const [sectionMotion, setSectionMotion] = useState<'forward' | 'backward'>(
    'forward',
  )
  const [calendarCursor, setCalendarCursor] = useState(() => new Date())
  const [selectedCalendarKey, setSelectedCalendarKey] = useState(() =>
    formatDateKey(new Date()),
  )
  const [calendarEntryMode, setCalendarEntryMode] =
    useState<CalendarEntryMode>('task')
  const [settings, updateSettings, resetSettings] = useSidebarSettings()
  const gmail = useGmailConnector()
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  const [dragHandleY, setDragHandleY] = useState<number | null>(null)
  const [edgeRevealVisible, setEdgeRevealVisible] = useState(false)
  const didNativeLayout = useRef(false)
  const previousOpenState = useRef(isOpen)
  const dragState = useRef<HandleDragState | null>(null)
  const hoverRevealUntil = useRef(0)
  const edgeRevealVisibleRef = useRef(false)
  const suppressNextClick = useRef(false)
  const [todayTasks, setTodayTasks] = usePersistentTasks(
    initialToday,
    TASK_STORAGE_KEYS.today,
    { resetOnDateChange: true },
  )
  const [monthTasks, setMonthTasks] = usePersistentTasks(
    monthPlan,
    TASK_STORAGE_KEYS.month,
  )
  const [longTermTasks, setLongTermTasks] = usePersistentTasks(
    [longTermTask],
    LONG_TERM_STORAGE_KEY,
  )
  const [customLists, setCustomLists] = useState<CustomTaskList[]>(loadCustomLists)
  const [drafts, setDrafts] = useState<TaskDrafts>({ today: '', month: '' })
  const [colorDrafts, setColorDrafts] = useState<TaskColorDrafts>({
    today: DEFAULT_TASK_COLOR,
    month: DEFAULT_TASK_COLOR,
  })
  const [reminderDrafts, setReminderDrafts] = useState<ReminderDrafts>({
    today: '',
    month: '',
  })
  const [longTermDraft, setLongTermDraft] = useState('')
  const [longTermColorDraft, setLongTermColorDraft] =
    useState<TaskColor>('purple')
  const [customDrafts, setCustomDrafts] = useState<Record<string, string>>({})
  const [customColorDrafts, setCustomColorDrafts] = useState<
    Record<string, TaskColor>
  >({})
  const [customReminderDrafts, setCustomReminderDrafts] = useState<
    Record<string, string>
  >({})
  const [newListDraft, setNewListDraft] = useState('')
  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [pendingCustomListDelete, setPendingCustomListDelete] = useState<
    string | null
  >(null)
  const [reminderToasts, setReminderToasts] = useState<ReminderToast[]>([])
  const [listTitleDraft, setListTitleDraft] = useState('')
  const notifiedReminderKeys = useRef<Record<string, boolean>>(
    loadNotifiedReminderKeys(),
  )
  useEffect(() => {
    const legacyLongTermTasks = monthTasks.filter(
      (task) =>
        task.id === longTermTask.id ||
        (task.title === longTermTask.title && task.meta.startsWith('长期')),
    )

    if (legacyLongTermTasks.length === 0) {
      return
    }

    setMonthTasks((current) =>
      current.filter(
        (task) =>
          task.id !== longTermTask.id &&
          !(task.title === longTermTask.title && task.meta.startsWith('长期')),
      ),
    )
    setLongTermTasks((current) => {
      const legacyTask = legacyLongTermTasks[0]
      const existingIndex = current.findIndex(
        (task) => task.title === longTermTask.title,
      )

      if (existingIndex >= 0) {
        return current.map((task, index) =>
          index === existingIndex
            ? {
                ...task,
                done: task.done ?? legacyTask.done,
                color: task.color ?? legacyTask.color,
              }
            : task,
        )
      }

      const existingIds = new Set(current.map((task) => task.id))
      const additions = legacyLongTermTasks.filter(
        (task) => !existingIds.has(task.id),
      )

      return additions.length > 0 ? [...current, ...additions] : current
    })
  }, [monthTasks, setLongTermTasks, setMonthTasks])
  const dismissReminderToast = useCallback((id: string) => {
    setReminderToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])
  const pushReminderToast = useCallback((item: CalendarTaskRef) => {
    const { listId, listTitle, source, task } = item
    const id = `${task.id}:${task.reminderAt ?? 'now'}`
    const toast: ReminderToast = {
      id,
      listId,
      title: task.title,
      body: `${listTitle} · ${task.meta}`,
      dueLabel: formatReminder(task.reminderAt) || '现在',
      reminderAt: task.reminderAt,
      source,
      taskId: task.id,
    }

    setReminderToasts((current) => [
      toast,
      ...current.filter((item) => item.id !== id),
    ].slice(0, 3))

    window.setTimeout(() => {
      setReminderToasts((current) =>
        current.filter((item) => item.id !== id),
      )
    }, 9000)
  }, [])
  const [collapsedSections, setCollapsedSections] =
    useState<CollapsedSections>({
      today: false,
      month: false,
    })
  const completed = useMemo(
    () => todayTasks.filter((task) => task.done).length,
    [todayTasks],
  )
  const progressPercent =
    todayTasks.length === 0 ? 0 : Math.round((completed / todayTasks.length) * 100)
  const sortedTodayTasks = useMemo(
    () => sortTasks(todayTasks, settings.taskSortMode),
    [settings.taskSortMode, todayTasks],
  )
  const sortedMonthTasks = useMemo(
    () => sortTasks(monthTasks, settings.taskSortMode),
    [monthTasks, settings.taskSortMode],
  )
  const sortedLongTermTasks = useMemo(
    () => sortTasks(longTermTasks, settings.taskSortMode),
    [longTermTasks, settings.taskSortMode],
  )
  const visibleTodayTasks = useMemo(
    () =>
      settings.showCompleted
        ? sortedTodayTasks
        : sortedTodayTasks.filter((task) => !task.done),
    [settings.showCompleted, sortedTodayTasks],
  )
  const visibleMonthTasks = useMemo(
    () =>
      settings.showCompleted
        ? sortedMonthTasks
        : sortedMonthTasks.filter((task) => !task.done),
    [settings.showCompleted, sortedMonthTasks],
  )
  const visibleLongTermTasks = useMemo(
    () =>
      settings.showCompleted
        ? sortedLongTermTasks
        : sortedLongTermTasks.filter((task) => !task.done),
    [settings.showCompleted, sortedLongTermTasks],
  )
  const reminderTasks = useMemo(
    (): CalendarTaskRef[] => [
      ...todayTasks.map((task) => ({
        listTitle: '今天',
        source: 'today' as const,
        task,
      })),
      ...monthTasks.map((task) => ({
        listTitle: '日历',
        source: 'month' as const,
        task,
      })),
      ...customLists.flatMap((list) =>
        list.tasks.map((task) => ({
          listId: list.id,
          listTitle: list.title,
          source: 'custom' as const,
          task,
        })),
      ),
    ],
    [customLists, monthTasks, todayTasks],
  )
  const pinnedTodayLists = useMemo(
    () => customLists.filter((list) => list.showOnToday),
    [customLists],
  )
  const calendarDays = useMemo(
    () => buildCalendarDays(calendarCursor, reminderTasks),
    [calendarCursor, reminderTasks],
  )
  const selectedCalendarDate = useMemo(
    () => new Date(`${selectedCalendarKey}T09:00:00`),
    [selectedCalendarKey],
  )
  const selectedCalendarTasks = useMemo(
    () =>
      reminderTasks
        .filter(({ task }) => {
          const reminderDate = parseReminderDate(task.reminderAt)

          return reminderDate
            ? formatDateKey(reminderDate) === selectedCalendarKey
            : false
        })
        .sort((a, b) => {
          const aTime = parseReminderDate(a.task.reminderAt)?.getTime() ?? 0
          const bTime = parseReminderDate(b.task.reminderAt)?.getTime() ?? 0

          return aTime - bTime
        }),
    [reminderTasks, selectedCalendarKey],
  )
  const selectedCalendarEventCount = useMemo(
    () =>
      selectedCalendarTasks.filter(({ task }) => task.kind === 'event').length,
    [selectedCalendarTasks],
  )
  const selectedCalendarOpenCount = useMemo(
    () => selectedCalendarTasks.filter(({ task }) => !task.done).length,
    [selectedCalendarTasks],
  )
  const unscheduledMonthTasks = useMemo(
    () => monthTasks.filter((task) => !task.reminderAt),
    [monthTasks],
  )
  const visibleHandleY = dragHandleY ?? settings.handleY
  const effectivePanelWidth = useMemo(() => {
    return getDockPanelWidth(
      settings.dockEdge,
      getLayoutPanelWidth(settings.panelWidth, settings.longTermWide),
      settings.tabWidth,
      viewportWidth,
    )
  }, [
    settings.dockEdge,
    settings.longTermWide,
    settings.panelWidth,
    settings.tabWidth,
    viewportWidth,
  ])
  const effectivePanelDepth = useMemo(() => {
    const availableHeight = Math.max(280, viewportHeight - settings.tabWidth - 8)

    return Math.min(settings.panelWidth, availableHeight, 560)
  }, [settings.panelWidth, settings.tabWidth, viewportHeight])
  const nativeHandleCenter = useMemo(() => {
    const height = Math.max(settings.handleHeight, viewportHeight || 0)
    const half = settings.handleHeight / 2
    const travel = Math.max(0, height - settings.handleHeight)

    return Math.min(
      height - half - 8,
      Math.max(half + 8, half + (travel * visibleHandleY) / 100),
    )
  }, [settings.handleHeight, visibleHandleY, viewportHeight])
  const dockSurface = useMemo(() => {
    const isLeftDock = settings.dockEdge === 'left'
    const handleRadius = Math.max(
      12,
      Math.min(16, settings.tabWidth * 0.4, settings.handleHeight * 0.24),
    )

    if (settings.dockEdge === 'top' || settings.dockEdge === 'bottom') {
      const width = effectivePanelWidth
      const height = settings.tabWidth + effectivePanelDepth
      const panelRadius = Math.max(
        0,
        Math.min(settings.panelRadius, width / 2, effectivePanelDepth / 2),
      )
      const handleLength = Math.min(
        settings.handleHeight,
        Math.max(72, width - 24),
      )
      const left = (width - handleLength) / 2
      const right = left + handleLength
      const dockRadius = Math.max(
        0,
        Math.min(18, settings.tabWidth * 0.5, left, width - right),
      )
      const isTopDock = settings.dockEdge === 'top'

      if (isTopDock) {
        const y = effectivePanelDepth
        const closedPath = [
          `M ${left - dockRadius} ${y}`,
          `Q ${left} ${y} ${left} ${y + dockRadius}`,
          `V ${height - handleRadius}`,
          `Q ${left} ${height} ${left + handleRadius} ${height}`,
          `H ${right - handleRadius}`,
          `Q ${right} ${height} ${right} ${height - handleRadius}`,
          `V ${y + dockRadius}`,
          `Q ${right} ${y} ${right + dockRadius} ${y}`,
          'Z',
        ].join(' ')
        const openPath = [
          `M ${panelRadius} 0`,
          `H ${width - panelRadius}`,
          `Q ${width} 0 ${width} ${panelRadius}`,
          `V ${y - panelRadius}`,
          `Q ${width} ${y} ${width - panelRadius} ${y}`,
          `H ${right + dockRadius}`,
          `Q ${right} ${y} ${right} ${y + dockRadius}`,
          `V ${height - handleRadius}`,
          `Q ${right} ${height} ${right - handleRadius} ${height}`,
          `H ${left + handleRadius}`,
          `Q ${left} ${height} ${left} ${height - handleRadius}`,
          `V ${y + dockRadius}`,
          `Q ${left} ${y} ${left - dockRadius} ${y}`,
          `H ${panelRadius}`,
          `Q 0 ${y} 0 ${y - panelRadius}`,
          `V ${panelRadius}`,
          `Q 0 0 ${panelRadius} 0`,
          'Z',
        ].join(' ')

        return {
          height,
          path: isOpen ? openPath : closedPath,
          width,
        }
      }

      const y = settings.tabWidth
      const closedPath = [
        `M ${left - dockRadius} ${y}`,
        `Q ${left} ${y} ${left} ${y - dockRadius}`,
        `V ${handleRadius}`,
        `Q ${left} 0 ${left + handleRadius} 0`,
        `H ${right - handleRadius}`,
        `Q ${right} 0 ${right} ${handleRadius}`,
        `V ${y - dockRadius}`,
        `Q ${right} ${y} ${right + dockRadius} ${y}`,
        'Z',
      ].join(' ')
      const openPath = [
        `M ${left - dockRadius} ${y}`,
        `Q ${left} ${y} ${left} ${y - dockRadius}`,
        `V ${handleRadius}`,
        `Q ${left} 0 ${left + handleRadius} 0`,
        `H ${right - handleRadius}`,
        `Q ${right} 0 ${right} ${handleRadius}`,
        `V ${y - dockRadius}`,
        `Q ${right} ${y} ${right + dockRadius} ${y}`,
        `H ${width - panelRadius}`,
        `Q ${width} ${y} ${width} ${y + panelRadius}`,
        `V ${height - panelRadius}`,
        `Q ${width} ${height} ${width - panelRadius} ${height}`,
        `H ${panelRadius}`,
        `Q 0 ${height} 0 ${height - panelRadius}`,
        `V ${y + panelRadius}`,
        `Q 0 ${y} ${panelRadius} ${y}`,
        'Z',
      ].join(' ')

      return {
        height,
        path: isOpen ? openPath : closedPath,
        width,
      }
    }

    const width = settings.tabWidth + effectivePanelWidth
    const height = Math.max(settings.handleHeight, viewportHeight || 0)
    const x = isLeftDock ? effectivePanelWidth : settings.tabWidth
    const half = settings.handleHeight / 2
    const travel = Math.max(0, height - settings.handleHeight)
    const center = Math.min(
      height - half - 8,
      Math.max(half + 8, half + (travel * visibleHandleY) / 100),
    )
    const top = center - half
    const bottom = center + half
    const topDockRadius = Math.max(
      0,
      Math.min(22, settings.tabWidth * 0.58, top),
    )
    const bottomDockRadius = Math.max(
      0,
      Math.min(22, settings.tabWidth * 0.58, height - bottom),
    )
    const topPanelRadius = Math.max(
      0,
      Math.min(settings.panelRadius, top - topDockRadius),
    )
    const bottomPanelRadius = Math.max(
      0,
      Math.min(settings.panelRadius, height - bottom - bottomDockRadius),
    )
    const closedPath = isLeftDock
      ? [
          `M ${x} ${top - topDockRadius}`,
          `Q ${x} ${top} ${x + topDockRadius} ${top}`,
          `H ${width - handleRadius}`,
          `C ${width - handleRadius * 0.45} ${top} ${width} ${top + handleRadius * 0.45} ${width} ${top + handleRadius}`,
          `V ${bottom - handleRadius}`,
          `C ${width} ${bottom - handleRadius * 0.45} ${width - handleRadius * 0.45} ${bottom} ${width - handleRadius} ${bottom}`,
          `H ${x + bottomDockRadius}`,
          `Q ${x} ${bottom} ${x} ${bottom + bottomDockRadius}`,
          'Z',
        ].join(' ')
      : [
          `M ${x} ${top - topDockRadius}`,
          `Q ${x} ${top} ${x - topDockRadius} ${top}`,
          `H ${handleRadius}`,
          `C ${handleRadius * 0.45} ${top} 0 ${top + handleRadius * 0.45} 0 ${top + handleRadius}`,
          `V ${bottom - handleRadius}`,
          `C 0 ${bottom - handleRadius * 0.45} ${handleRadius * 0.45} ${bottom} ${handleRadius} ${bottom}`,
          `H ${x - bottomDockRadius}`,
          `Q ${x} ${bottom} ${x} ${bottom + bottomDockRadius}`,
          'Z',
        ].join(' ')
    const openPath = isLeftDock
      ? [
          `M 0 0`,
          `H ${x - topPanelRadius}`,
          `Q ${x} 0 ${x} ${topPanelRadius}`,
          `V ${top - topDockRadius}`,
          `Q ${x} ${top} ${x + topDockRadius} ${top}`,
          `H ${width - handleRadius}`,
          `Q ${width} ${top} ${width} ${top + handleRadius}`,
          `V ${bottom - handleRadius}`,
          `Q ${width} ${bottom} ${width - handleRadius} ${bottom}`,
          `H ${x + bottomDockRadius}`,
          `Q ${x} ${bottom} ${x} ${bottom + bottomDockRadius}`,
          `V ${height - bottomPanelRadius}`,
          `Q ${x} ${height} ${x - bottomPanelRadius} ${height}`,
          `H 0`,
          'Z',
        ].join(' ')
      : [
          `M ${x + topPanelRadius} 0`,
          `H ${width}`,
          `V ${height}`,
          `H ${x + bottomPanelRadius}`,
          `Q ${x} ${height} ${x} ${height - bottomPanelRadius}`,
          `V ${bottom + bottomDockRadius}`,
          `Q ${x} ${bottom} ${x - bottomDockRadius} ${bottom}`,
          `H ${handleRadius}`,
          `Q 0 ${bottom} 0 ${bottom - handleRadius}`,
          `V ${top + handleRadius}`,
          `Q 0 ${top} ${handleRadius} ${top}`,
          `H ${x - topDockRadius}`,
          `Q ${x} ${top} ${x} ${top - topDockRadius}`,
          `V ${topPanelRadius}`,
          `Q ${x} 0 ${x + topPanelRadius} 0`,
          'Z',
        ].join(' ')

    return {
      height,
      path: isOpen ? openPath : closedPath,
      width,
    }
  }, [
    settings.dockEdge,
    isOpen,
    settings.handleHeight,
    settings.panelRadius,
    settings.tabWidth,
    effectivePanelDepth,
    effectivePanelWidth,
    visibleHandleY,
    viewportHeight,
  ])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const shortcut =
        event.altKey &&
        event.key.toLowerCase() === 't' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      const fallbackShortcut =
        event.altKey &&
        event.shiftKey &&
        event.key.toLowerCase() === 't' &&
        !event.ctrlKey &&
        !event.metaKey

      if (shortcut || fallbackShortcut || event.key === 'Escape') {
        event.preventDefault()
        setIsOpen((current) => (event.key === 'Escape' ? false : !current))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    let frame = 0
    const syncViewportSize = () => {
      if (frame) {
        return
      }

      frame = window.requestAnimationFrame(() => {
        frame = 0
        setViewportWidth(window.innerWidth)
        setViewportHeight(window.innerHeight)
      })
    }

    syncViewportSize()
    window.addEventListener('resize', syncViewportSize)
    return () => {
      window.removeEventListener('resize', syncViewportSize)

      if (frame) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.runtime = isNative ? 'tauri' : 'web'

    return () => {
      delete document.documentElement.dataset.runtime
    }
  }, [isNative])

  useEffect(() => {
    return scheduleLocalStorageWrite(
      CUSTOM_LISTS_STORAGE_KEY,
      JSON.stringify(customLists),
    )
  }, [customLists])

  useEffect(() => {
    if (!settings.notificationsEnabled) {
      return
    }

    const checkReminders = () => {
      const now = Date.now()

      for (const item of reminderTasks) {
        const { task } = item

        if (!task.reminderAt || task.done) {
          continue
        }

        const dueTime = new Date(task.reminderAt).getTime()

        if (!Number.isFinite(dueTime) || dueTime > now) {
          continue
        }

        const key = `${task.id}:${task.reminderAt}`

        if (notifiedReminderKeys.current[key]) {
          continue
        }

        notifiedReminderKeys.current[key] = true
        window.localStorage.setItem(
          NOTIFIED_REMINDERS_STORAGE_KEY,
          JSON.stringify(notifiedReminderKeys.current),
        )
        pushReminderToast(item)
      }
    }

    checkReminders()
    const interval = window.setInterval(checkReminders, 30000)

    return () => {
      window.clearInterval(interval)
    }
  }, [pushReminderToast, reminderTasks, settings.notificationsEnabled])

  useEffect(() => {
    if (!isNative) {
      return
    }

    let unlistenToggle: (() => void) | undefined
    let unlistenSettings: (() => void) | undefined

    const setupTrayListeners = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')

        unlistenToggle = await listen('todobar-tray-toggle', () => {
          setIsOpen((current) => !current)
        })
        unlistenSettings = await listen('todobar-tray-settings', () => {
          setIsOpen(true)
          setIsSettingsOpen(true)
        })
      } catch {
        // Tray events are only available in the native desktop shell.
      }
    }

    void setupTrayListeners()

    return () => {
      unlistenToggle?.()
      unlistenSettings?.()
    }
  }, [isNative])

  useEffect(() => {
    if (!isNative || import.meta.env.DEV) {
      return
    }

    const enableAutostart = async () => {
      try {
        const { disable, enable, isEnabled } = await import(
          '@tauri-apps/plugin-autostart'
        )
        const enabled = await isEnabled()

        if (settings.launchAtLogin) {
          if (enabled) {
            await disable()
          }

          await enable()
          return
        }

        if (!settings.launchAtLogin && enabled) {
          await disable()
        }
      } catch {
        // Autostart is best-effort; the UI stays usable if the OS denies it.
      }
    }

    void enableAutostart()
  }, [isNative, settings.launchAtLogin])

  useEffect(() => {
    if (!isNative) {
      return
    }

    const syncNativeWindow = async () => {
      try {
        const {
          PhysicalPosition,
          PhysicalSize,
          currentMonitor,
          cursorPosition,
          getCurrentWindow,
          monitorFromPoint,
        } = await import('@tauri-apps/api/window')
        const appWindow = getCurrentWindow()
        let monitor = null

        try {
          const cursor = await cursorPosition()

          monitor = await monitorFromPoint(cursor.x, cursor.y)
        } catch {
          monitor = null
        }

        monitor ??= await currentMonitor()

        if (!monitor) {
          return
        }

        const workArea = monitor.workArea
        const scaleFactor = monitor.scaleFactor || 1
        const fullCssWidth = Math.round(workArea.size.width / scaleFactor)
        const fullCssHeight = Math.round(workArea.size.height / scaleFactor)
        const isHorizontalDock =
          settings.dockEdge === 'top' || settings.dockEdge === 'bottom'
        const panelCssWidth = getDockPanelWidth(
          settings.dockEdge,
          getLayoutPanelWidth(settings.panelWidth, settings.longTermWide),
          settings.tabWidth,
          fullCssWidth,
        )
        const panelCssDepth = Math.min(
          settings.panelWidth,
          Math.max(280, fullCssHeight - settings.tabWidth - 8),
          560,
        )
        const sideWindowWidth = Math.round(
          (settings.tabWidth + panelCssWidth) * scaleFactor,
        )
        const horizontalWindowWidth = Math.round(panelCssWidth * scaleFactor)
        const horizontalWindowHeight = Math.round(
          (settings.tabWidth + panelCssDepth) * scaleFactor,
        )
        const windowWidth = isHorizontalDock
          ? horizontalWindowWidth
          : sideWindowWidth
        const tabWidth = Math.round(settings.tabWidth * scaleFactor)
        const panelWidth = Math.round(panelCssWidth * scaleFactor)
        const panelDepth = Math.round(panelCssDepth * scaleFactor)
        const closedOffset = Math.round(2 * scaleFactor)
        const horizontalX =
          workArea.position.x +
          Math.round(
            Math.max(0, workArea.size.width - windowWidth) *
              (visibleHandleY / 100),
          )
        const openX = isHorizontalDock
          ? horizontalX
          : settings.dockEdge === 'left'
            ? workArea.position.x
            : workArea.position.x + workArea.size.width - windowWidth
        const closedX = isHorizontalDock
          ? horizontalX
          : settings.dockEdge === 'left'
            ? workArea.position.x - panelWidth - closedOffset
            : workArea.position.x +
              workArea.size.width -
              tabWidth +
              closedOffset
        const openY =
          settings.dockEdge === 'bottom'
            ? workArea.position.y + workArea.size.height - horizontalWindowHeight
            : workArea.position.y
        const closedY =
          settings.dockEdge === 'top'
            ? workArea.position.y - panelDepth - closedOffset
            : settings.dockEdge === 'bottom'
              ? workArea.position.y +
                workArea.size.height -
                tabWidth +
                closedOffset
              : openY
        const targetX = isOpen ? openX : closedX
        const targetY = isOpen ? openY : closedY
        const startX = isOpen ? closedX : openX
        const startY = isOpen ? closedY : openY
        const targetHeight = isHorizontalDock
          ? horizontalWindowHeight
          : workArea.size.height

        const setTarget = async () => {
          await appWindow.setSize(new PhysicalSize(windowWidth, targetHeight))
          await appWindow.setPosition(new PhysicalPosition(targetX, targetY))
        }
        const didOpenStateChange = previousOpenState.current !== isOpen
        previousOpenState.current = isOpen

        if (!didNativeLayout.current) {
          didNativeLayout.current = true
          setViewportWidth(fullCssWidth)
          setViewportHeight(fullCssHeight)
          await setTarget()
          return
        }

        if (!didOpenStateChange) {
          setViewportWidth(fullCssWidth)
          setViewportHeight(fullCssHeight)
          await setTarget()
          return
        }

        if (isOpen) {
          setViewportWidth(fullCssWidth)
          setViewportHeight(fullCssHeight)
          await Promise.all([
            appWindow.setSize(new PhysicalSize(windowWidth, targetHeight)),
            appWindow.setPosition(new PhysicalPosition(startX, startY)),
          ])
          await animateNativePosition(
            appWindow,
            (x, y) => new PhysicalPosition(x, y),
            startX,
            openX,
            startY,
            openY,
            settings.motionMs,
          )
          await appWindow.setFocus()
          return
        }

        setViewportWidth(fullCssWidth)
        setViewportHeight(fullCssHeight)
        await animateNativePosition(
          appWindow,
          (x, y) => new PhysicalPosition(x, y),
          startX,
          closedX,
          startY,
          closedY,
          settings.motionMs,
        )
        await setTarget()
      } catch {
        // Native window control can fail when the app is inspected in a browser.
      }
    }

    void syncNativeWindow()
  }, [
    isNative,
    isOpen,
    settings.dockEdge,
    settings.longTermWide,
    settings.motionMs,
    settings.panelWidth,
    settings.tabWidth,
    visibleHandleY,
  ])

  useEffect(() => {
    if (!isNative) {
      return
    }

    let cancelled = false
    let isChecking = false
    let lastIgnored: boolean | null = null

    const syncHitTest = async () => {
      if (isChecking) {
        return
      }

      isChecking = true

      try {
        const { cursorPosition, currentMonitor, getCurrentWindow, monitorFromPoint } =
          await import('@tauri-apps/api/window')
        const appWindow = getCurrentWindow()

        // An expanded native window must remain interactive across its whole
        // visible surface. Calculating the panel hit box from physical cursor
        // coordinates is fragile on Windows when the monitor uses DPI scaling:
        // the webview can be painted in logical pixels while the native window
        // APIs report physical pixels. In that state the old code could mark
        // an open panel as click-through, leaving the UI visible but sending
        // clicks to the application behind it. The closed state still uses the
        // precise edge hit-test below so the overlay does not block the desktop.
        if (isOpen) {
          if (!cancelled && lastIgnored !== false) {
            lastIgnored = false
            await appWindow.setIgnoreCursorEvents(false)
          }
          return
        }

        const [cursor, position] = await Promise.all([
          cursorPosition(),
          appWindow.outerPosition(),
        ])
        let monitor = await monitorFromPoint(cursor.x, cursor.y)

        monitor ??= await currentMonitor()
        const scaleFactor = monitor?.scaleFactor || 1
        const relativeX = cursor.x - position.x
        const relativeY = cursor.y - position.y
        const tabWidth = settings.tabWidth * scaleFactor
        const panelWidth = effectivePanelWidth * scaleFactor
        const panelDepth = effectivePanelDepth * scaleFactor
        const handleHitSlop = 3 * scaleFactor
        const edgeRevealSlop = 14 * scaleFactor
        const isHorizontalDock =
          settings.dockEdge === 'top' || settings.dockEdge === 'bottom'
        const horizontalHandleLength =
          Math.min(
            settings.handleHeight,
            Math.max(72, effectivePanelWidth - 24),
          ) * scaleFactor
        const handleLeft = isHorizontalDock
          ? (panelWidth - horizontalHandleLength) / 2
          : settings.dockEdge === 'left'
            ? panelWidth
            : 0
        const handleRight = isHorizontalDock
          ? handleLeft + horizontalHandleLength
          : handleLeft + tabWidth
        const handleTop = isHorizontalDock
          ? settings.dockEdge === 'top'
            ? panelDepth
            : 0
          : (nativeHandleCenter - settings.handleHeight / 2) * scaleFactor
        const handleBottom = isHorizontalDock
          ? settings.dockEdge === 'top'
            ? panelDepth + tabWidth
            : tabWidth
          : (nativeHandleCenter + settings.handleHeight / 2) * scaleFactor
        const panelLeft = isHorizontalDock
          ? 0
          : settings.dockEdge === 'left'
            ? 0
            : tabWidth
        const panelRight = isHorizontalDock ? panelWidth : panelLeft + panelWidth
        const panelTop = isHorizontalDock
          ? settings.dockEdge === 'top'
            ? 0
            : tabWidth
          : 0
        const panelBottom = isHorizontalDock
          ? panelTop + panelDepth
          : Number.POSITIVE_INFINITY
        const isOnHandle =
          relativeX >= handleLeft - handleHitSlop &&
          relativeX <= handleRight + handleHitSlop &&
          relativeY >= handleTop - handleHitSlop &&
          relativeY <= handleBottom + handleHitSlop
        const isHoverOnlyClosed =
          settings.tabVisibility === 'hover' && !isOpen
        const revealLeft = isHorizontalDock
          ? 0
          : settings.dockEdge === 'left'
            ? panelWidth
            : 0
        const revealRight = isHorizontalDock ? panelWidth : revealLeft + tabWidth
        const revealTop = isHorizontalDock
          ? settings.dockEdge === 'top'
            ? panelDepth
            : 0
          : 0
        const revealBottom = isHorizontalDock
          ? revealTop + tabWidth
          : Number.POSITIVE_INFINITY
        const isOnRevealEdge =
          relativeX >= revealLeft - edgeRevealSlop &&
          relativeX <= revealRight + edgeRevealSlop &&
          relativeY >= revealTop - edgeRevealSlop &&
          relativeY <= revealBottom + edgeRevealSlop

        const now = Date.now()

        if (isHoverOnlyClosed && isOnRevealEdge) {
          hoverRevealUntil.current = now + 650
        }

        const shouldShowEdgeReveal =
          isHoverOnlyClosed && now <= hoverRevealUntil.current

        if (
          !cancelled &&
          edgeRevealVisibleRef.current !== shouldShowEdgeReveal
        ) {
          edgeRevealVisibleRef.current = shouldShowEdgeReveal
          setEdgeRevealVisible(shouldShowEdgeReveal)
        }

        const isHandleActive = isHoverOnlyClosed
          ? isOnHandle && shouldShowEdgeReveal
          : isOnHandle
        const isRevealStripActive = isHoverOnlyClosed && isOnRevealEdge
        const isOnPanel =
          isOpen &&
          relativeX >= panelLeft &&
          relativeX <= panelRight &&
          relativeY >= panelTop &&
          relativeY <= panelBottom
        const shouldIgnore = dragState.current
          ? false
          : !(isHandleActive || isOnPanel || isRevealStripActive)

        if (!cancelled && shouldIgnore !== lastIgnored) {
          lastIgnored = shouldIgnore
          await appWindow.setIgnoreCursorEvents(shouldIgnore)
        }
      } catch {
        // Pointer passthrough is best-effort; the app still works without it.
      } finally {
        isChecking = false
      }
    }

    void syncHitTest()
    const interval = window.setInterval(
      syncHitTest,
      settings.tabVisibility === 'hover' && !isOpen
        ? NATIVE_HIT_TEST_EDGE_INTERVAL_MS
        : NATIVE_HIT_TEST_IDLE_INTERVAL_MS,
    )

    return () => {
      cancelled = true
      edgeRevealVisibleRef.current = false
      setEdgeRevealVisible(false)
      window.clearInterval(interval)
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) =>
          getCurrentWindow().setIgnoreCursorEvents(false),
        )
        .catch(() => undefined)
    }
  }, [
    isNative,
    isOpen,
    nativeHandleCenter,
    settings.dockEdge,
    settings.longTermWide,
    settings.handleHeight,
    settings.tabWidth,
    settings.tabVisibility,
    effectivePanelDepth,
    effectivePanelWidth,
  ])

  const updateDraft = (listId: TaskListId, value: string) => {
    setDrafts((current) => ({ ...current, [listId]: value }))
  }

  const updateReminderDraft = (listId: TaskListId, value: string) => {
    setReminderDrafts((current) => ({ ...current, [listId]: value }))
  }

  const updateColorDraft = (listId: TaskListId, value: TaskColor) => {
    setColorDrafts((current) => ({ ...current, [listId]: value }))
  }

  const updateTasks = (
    listId: TaskListId,
    updater: (tasks: Task[]) => Task[],
  ) => {
    const setter = listId === 'today' ? setTodayTasks : setMonthTasks

    setter(updater)
  }

  const addTask = (listId: TaskListId) => {
    const title = drafts[listId].trim()

    if (!title) {
      return
    }

    updateTasks(listId, (tasks) => [
      createTask(
        title,
        listId === 'today' ? '今天' : '日历',
        reminderDrafts[listId],
        colorDrafts[listId],
      ),
      ...tasks,
    ])
    setDrafts((current) => ({ ...current, [listId]: '' }))
    setReminderDrafts((current) => ({ ...current, [listId]: '' }))
    setColorDrafts((current) => ({
      ...current,
      [listId]: DEFAULT_TASK_COLOR,
    }))
    setCollapsedSections((current) => ({ ...current, [listId]: false }))
    setIsOpen(true)
  }

  const convertGmailSuggestionToTask = (suggestion: GmailThreadSuggestion) => {
    setTodayTasks((tasks) => [createGmailTask(suggestion), ...tasks])
    gmail.ignoreSuggestion(suggestion.threadId, suggestion.subject)
    gmail.recordActivity(
      'convert',
      `已从 Gmail 邮件创建本地任务：${suggestion.subject}`,
    )
    setCollapsedSections((current) => ({ ...current, today: false }))
    activateRailSection('today')
    setIsOpen(true)
  }

  const addCalendarTask = () => {
    const title = drafts.month.trim()

    if (!title) {
      return
    }

    const fallbackReminder = `${selectedCalendarKey}T09:00`

    setMonthTasks((tasks) => [
      createCalendarTask(
        title,
        selectedCalendarDate,
        reminderDrafts.month || fallbackReminder,
        calendarEntryMode,
        colorDrafts.month,
      ),
      ...tasks,
    ])
    setDrafts((current) => ({ ...current, month: '' }))
    setReminderDrafts((current) => ({ ...current, month: '' }))
    setColorDrafts((current) => ({ ...current, month: DEFAULT_TASK_COLOR }))
    setIsOpen(true)
  }

  const addLongTermTask = () => {
    const title = longTermDraft.trim()

    if (!title) {
      return
    }

    setLongTermTasks((tasks) => [
      createTask(title, '长期 · 持续推进', undefined, longTermColorDraft),
      ...tasks,
    ])
    setLongTermDraft('')
    setLongTermColorDraft('purple')
  }

  const onDraftKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    listId: TaskListId,
  ) => {
    if (event.key === 'Enter') {
      addTask(listId)
    }
  }

  const onCalendarDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      addCalendarTask()
    }
  }

  const toggleTask = (listId: TaskListId, id: number) => {
    updateTasks(listId, (tasks) =>
      tasks.map((task) =>
        task.id === id ? { ...task, done: !task.done } : task,
      ),
    )
  }

  const setTaskColor = (listId: TaskListId, id: number, color: TaskColor) => {
    updateTasks(listId, (tasks) =>
      tasks.map((task) => (task.id === id ? { ...task, color } : task)),
    )
  }

  const toggleLongTermTask = (id: number) => {
    setLongTermTasks((tasks) =>
      tasks.map((task) =>
        task.id === id ? { ...task, done: !task.done } : task,
      ),
    )
  }

  const setLongTermTaskColor = (id: number, color: TaskColor) => {
    setLongTermTasks((tasks) =>
      tasks.map((task) => (task.id === id ? { ...task, color } : task)),
    )
  }

  const setLongTermTaskProgress = (id: number, progress: number) => {
    const nextProgress = Math.min(100, Math.max(0, Math.round(progress)))

    setLongTermTasks((tasks) =>
      tasks.map((task) =>
        task.id === id ? { ...task, progress: nextProgress } : task,
      ),
    )
  }

  const deleteLongTermTask = (id: number) => {
    setLongTermTasks((tasks) => tasks.filter((task) => task.id !== id))
  }

  const renameLongTermTask = (id: number, title: string) => {
    setLongTermTasks((tasks) =>
      tasks.map((task) => (task.id === id ? { ...task, title } : task)),
    )
  }

  const cycleTaskReminder = (listId: TaskListId, id: number) => {
    updateTasks(listId, (tasks) =>
      tasks.map((task) =>
        task.id === id
          ? { ...task, reminderAt: nextQuickReminder(task.reminderAt) }
          : task,
      ),
    )
  }

  const deleteTask = (listId: TaskListId, id: number) => {
    updateTasks(listId, (tasks) => tasks.filter((task) => task.id !== id))
  }

  const renameTask = (listId: TaskListId, id: number, title: string) => {
    updateTasks(listId, (tasks) =>
      tasks.map((task) => (task.id === id ? { ...task, title } : task)),
    )
  }

  const toggleSection = (listId: TaskListId) => {
    setCollapsedSections((current) => ({
      ...current,
      [listId]: !current[listId],
    }))
  }

  const addCustomList = () => {
    const title = newListDraft.trim()

    if (!title) {
      return
    }

    const id = `${Date.now()}`

    setCustomLists((lists) => [
      ...lists,
      {
        id,
        title,
        tasks: [],
        collapsed: false,
      },
    ])
    setCustomDrafts((current) => ({ ...current, [id]: '' }))
    setNewListDraft('')
  }

  const onNewListKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      addCustomList()
    }
  }

  const updateCustomDraft = (listId: string, value: string) => {
    setCustomDrafts((current) => ({ ...current, [listId]: value }))
  }

  const updateCustomReminderDraft = (listId: string, value: string) => {
    setCustomReminderDrafts((current) => ({ ...current, [listId]: value }))
  }

  const updateCustomColorDraft = (listId: string, value: TaskColor) => {
    setCustomColorDrafts((current) => ({ ...current, [listId]: value }))
  }

  const updateCustomListTasks = (
    listId: string,
    updater: (tasks: Task[]) => Task[],
  ) => {
    setCustomLists((lists) =>
      lists.map((list) =>
        list.id === listId ? { ...list, tasks: updater(list.tasks) } : list,
      ),
    )
  }

  const addCustomTask = (listId: string) => {
    const title = (customDrafts[listId] ?? '').trim()
    const list = customLists.find((item) => item.id === listId)

    if (!title || !list) {
      return
    }

    updateCustomListTasks(listId, (tasks) => [
      createTask(
        title,
        list.title,
        customReminderDrafts[listId],
        customColorDrafts[listId] ?? DEFAULT_TASK_COLOR,
      ),
      ...tasks,
    ])
    setCustomDrafts((current) => ({ ...current, [listId]: '' }))
    setCustomReminderDrafts((current) => ({ ...current, [listId]: '' }))
    setCustomColorDrafts((current) => ({
      ...current,
      [listId]: DEFAULT_TASK_COLOR,
    }))
    setCustomLists((lists) =>
      lists.map((item) =>
        item.id === listId ? { ...item, collapsed: false } : item,
      ),
    )
  }

  const onCustomDraftKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    listId: string,
  ) => {
    if (event.key === 'Enter') {
      addCustomTask(listId)
    }
  }

  const toggleCustomTask = (listId: string, taskId: number) => {
    updateCustomListTasks(listId, (tasks) =>
      tasks.map((task) =>
        task.id === taskId ? { ...task, done: !task.done } : task,
      ),
    )
  }

  const setCustomTaskColor = (
    listId: string,
    taskId: number,
    color: TaskColor,
  ) => {
    updateCustomListTasks(listId, (tasks) =>
      tasks.map((task) => (task.id === taskId ? { ...task, color } : task)),
    )
  }

  const cycleCustomTaskReminder = (listId: string, taskId: number) => {
    updateCustomListTasks(listId, (tasks) =>
      tasks.map((task) =>
        task.id === taskId
          ? { ...task, reminderAt: nextQuickReminder(task.reminderAt) }
          : task,
      ),
    )
  }

  const deleteCustomTask = (listId: string, taskId: number) => {
    updateCustomListTasks(listId, (tasks) =>
      tasks.filter((task) => task.id !== taskId),
    )
  }

  const renameCustomTask = (
    listId: string,
    taskId: number,
    title: string,
  ) => {
    updateCustomListTasks(listId, (tasks) =>
      tasks.map((task) =>
        task.id === taskId ? { ...task, title } : task,
      ),
    )
  }

  const toggleCustomList = (listId: string) => {
    setCustomLists((lists) =>
      lists.map((list) =>
        list.id === listId ? { ...list, collapsed: !list.collapsed } : list,
      ),
    )
  }

  const deleteCustomList = (listId: string) => {
    setCustomLists((lists) => lists.filter((list) => list.id !== listId))
    setPendingCustomListDelete(null)
    setCustomDrafts((current) => {
      const next = { ...current }
      delete next[listId]
      return next
    })
    setCustomReminderDrafts((current) => {
      const next = { ...current }
      delete next[listId]
      return next
    })
  }

  const toggleCustomListOnToday = (listId: string) => {
    setCustomLists((lists) =>
      lists.map((list) =>
        list.id === listId
          ? { ...list, showOnToday: !list.showOnToday }
          : list,
      ),
    )
  }

  const startRenameCustomList = (list: CustomTaskList) => {
    setEditingListId(list.id)
    setListTitleDraft(list.title)
  }

  const cancelRenameCustomList = () => {
    setEditingListId(null)
    setListTitleDraft('')
  }

  const commitRenameCustomList = (listId: string) => {
    const nextTitle = listTitleDraft.trim()

    if (nextTitle) {
      setCustomLists((lists) =>
        lists.map((list) =>
          list.id === listId ? { ...list, title: nextTitle } : list,
        ),
      )
    }

    cancelRenameCustomList()
  }

  const toggleCalendarTask = (
    source: CalendarTaskRef['source'],
    listId: string | undefined,
    taskId: number,
  ) => {
    if (source === 'custom') {
      if (listId) {
        toggleCustomTask(listId, taskId)
      }

      return
    }

    toggleTask(source, taskId)
  }

  const setCalendarTaskColor = (
    source: CalendarTaskRef['source'],
    listId: string | undefined,
    taskId: number,
    color: TaskColor,
  ) => {
    if (source === 'custom') {
      if (listId) {
        setCustomTaskColor(listId, taskId, color)
      }

      return
    }

    setTaskColor(source, taskId, color)
  }

  const cycleCalendarTaskReminder = (
    source: CalendarTaskRef['source'],
    listId: string | undefined,
    taskId: number,
  ) => {
    if (source === 'custom') {
      if (listId) {
        cycleCustomTaskReminder(listId, taskId)
      }

      return
    }

    cycleTaskReminder(source, taskId)
  }

  const deleteCalendarTask = (
    source: CalendarTaskRef['source'],
    listId: string | undefined,
    taskId: number,
  ) => {
    if (source === 'custom') {
      if (listId) {
        deleteCustomTask(listId, taskId)
      }

      return
    }

    deleteTask(source, taskId)
  }

  const renameCalendarTask = (
    source: CalendarTaskRef['source'],
    listId: string | undefined,
    taskId: number,
    title: string,
  ) => {
    if (source === 'custom') {
      if (listId) {
        renameCustomTask(listId, taskId, title)
      }

      return
    }

    renameTask(source, taskId, title)
  }

  const jumpCalendarToToday = () => {
    const today = new Date()

    setCalendarCursor(today)
    setSelectedCalendarKey(formatDateKey(today))
  }

  const focusSection = (section: SectionId) => {
    activateRailSection(section)
    setIsSettingsOpen(false)
    setIsOpen(true)
  }

  const activateRailSection = (section: SectionId) => {
    if (section !== activeRailSection) {
      setSectionMotion(
        getSectionMotionDirection(
          settings.sectionOrder,
          activeRailSection,
          section,
        ),
      )
    }

    setActiveRailSection(section)
  }

  const openReminderToast = (toast: ReminderToast) => {
    const reminderDate = parseReminderDate(toast.reminderAt)

    if (reminderDate) {
      setCalendarCursor(reminderDate)
      setSelectedCalendarKey(formatDateKey(reminderDate))
    }

    activateRailSection('calendar')
    setIsSettingsOpen(false)
    setIsOpen(true)
    dismissReminderToast(toast.id)
  }

  const snoozeReminderToast = (toast: ReminderToast, minutes = 10) => {
    const nextReminder = new Date()
    nextReminder.setMinutes(nextReminder.getMinutes() + minutes)
    nextReminder.setSeconds(0, 0)

    const updateReminder = (tasks: Task[]) =>
      tasks.map((task) =>
        task.id === toast.taskId
          ? { ...task, reminderAt: toLocalDateTimeValue(nextReminder) }
          : task,
      )

    if (toast.source === 'custom') {
      if (toast.listId) {
        updateCustomListTasks(toast.listId, updateReminder)
      }
    } else {
      updateTasks(toast.source, updateReminder)
    }

    dismissReminderToast(toast.id)
  }

  const openSettings = () => {
    setIsOpen(true)
    setIsSettingsOpen(true)
  }

  const closeSettings = () => {
    setIsSettingsOpen(false)
  }

  const onHandlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!isNative) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    suppressNextClick.current = false

    const isHorizontalDock =
      settings.dockEdge === 'top' || settings.dockEdge === 'bottom'
    const drag: HandleDragState = {
      startScreenY: isHorizontalDock ? event.screenX : event.screenY,
      startHandleY: visibleHandleY,
      height: isHorizontalDock ? window.innerWidth : window.innerHeight,
      moved: false,
      latestHandleY: null,
    }

    dragState.current = drag
  }

  const onHandlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragState.current

    if (!drag) {
      return
    }

    const isHorizontalDock =
      settings.dockEdge === 'top' || settings.dockEdge === 'bottom'
    const screenAxis = isHorizontalDock ? event.screenX : event.screenY
    const deltaY = screenAxis - drag.startScreenY

    if (Math.abs(deltaY) < DRAG_THRESHOLD && !drag.moved) {
      return
    }

    drag.moved = true
    suppressNextClick.current = true

    const travel = Math.max(1, drag.height - settings.handleHeight)
    const nextHandleY = Math.min(
      100,
      Math.max(0, drag.startHandleY + (deltaY / travel) * 100),
    )

    drag.latestHandleY = Math.round(nextHandleY)
    setDragHandleY(nextHandleY)
  }

  const onHandlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragState.current
    const shouldToggle = drag && !drag.moved

    if (drag?.moved && drag.latestHandleY !== null) {
      updateSettings({ handleY: drag.latestHandleY })
    }

    setDragHandleY(null)
    dragState.current = null

    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture can already be gone after native pointer handoff.
    }

    if (shouldToggle) {
      suppressNextClick.current = true
      setIsOpen((current) => !current)
    }
  }

  const onHandleClick = () => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false
      return
    }

    setIsOpen((current) => !current)
  }

  const appStyle = {
    '--panel-width': `${effectivePanelWidth}px`,
    '--panel-base-width': `${Math.min(
      settings.panelWidth,
      viewportWidth,
    )}px`,
    '--section-base-width': `${Math.max(
      240,
      Math.min(settings.panelWidth, viewportWidth) - 46,
    )}px`,
    '--long-term-section-width': `${Math.min(
      Math.max(240, Math.min(settings.panelWidth, viewportWidth) - 46) * 2,
      Math.max(240, effectivePanelWidth - 46),
    )}px`,
    '--panel-half': `${effectivePanelWidth / 2}px`,
    '--panel-depth': `${effectivePanelDepth}px`,
    '--tab-width': `${settings.tabWidth}px`,
    '--handle-height': `${settings.handleHeight}px`,
    '--handle-half': `${settings.handleHeight / 2}px`,
    '--handle-y': `${visibleHandleY}%`,
    '--native-handle-y-px': `${nativeHandleCenter}px`,
    '--motion-ms': `${settings.motionMs}ms`,
    '--panel-radius': `${settings.panelRadius}px`,
    '--surface-alpha': `${settings.surfaceAlpha / 100}`,
    '--surface-alpha-percent': `${settings.surfaceAlpha}%`,
    '--task-row-height': `${settings.taskRowHeight}px`,
    '--task-gap': `${settings.taskGap}px`,
    '--task-title-size': `${settings.taskTextSize}px`,
    '--task-meta-size': `${Math.max(10, settings.taskTextSize - 1.5)}px`,
    '--custom-backdrop-image': settings.backdropImage
      ? `url("${settings.backdropImage}")`
      : 'none',
    '--backdrop-opacity': settings.backdropImage
      ? `${settings.backdropOpacity / 100}`
      : '0',
    '--backdrop-blur': `${settings.backdropBlur}px`,
    '--backdrop-dim': `${settings.backdropDim / 100}`,
  } as CSSProperties

  return (
    <main
      className={`workspace ${isNative ? 'is-native' : 'is-web-preview'} ${
        isOpen ? 'is-sidebar-open' : 'is-sidebar-closed'
      } ${edgeRevealVisible ? 'is-edge-revealed' : ''} ${
        settings.backdropImage ? 'has-custom-backdrop' : ''
      } dock-${settings.dockEdge} tab-${settings.tabVisibility} theme-${settings.theme} style-${settings.visualStyle}`}
      style={appStyle}
    >
      <section
        className="desktop-preview"
        aria-label="每日计划桌面预览"
        aria-hidden={isNative}
      >
        <nav className="system-bar" aria-label="桌面菜单">
          <div className="window-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="system-title">
            <ListTodo size={16} />
            <span>每日计划</span>
          </div>
          <div className="system-actions">
            <button type="button" aria-label="搜索">
              <Search size={16} />
            </button>
            <button type="button" aria-label="设置">
              <Settings size={16} />
            </button>
          </div>
        </nav>

        <section className="canvas" aria-label="桌面工作区">
          <div className="desk-copy">
            <div className="mark">
              <PanelRightOpen size={22} />
            </div>
            <h1>贴靠屏幕边缘的专注任务栏</h1>
            <p>
              浏览器页面仅用于开发预览。正式版本是适用于 macOS 和 Windows 的原生工具，支持快捷键、悬浮窗口、连接器和 AI 计划。
            </p>
            <div className="shortcut-row" aria-label="键盘快捷键">
              <kbd>Alt</kbd>
              <kbd>T</kbd>
            </div>
          </div>

          <div className="mock-window mock-window-a">
            <div />
            <span />
            <span />
          </div>
          <div className="mock-window mock-window-b">
            <span />
            <span />
            <span />
          </div>
        </section>
      </section>

      {isNative ? (
        <svg
          className={`native-dock-surface ${isOpen ? 'is-open' : 'is-closed'}`}
          width={dockSurface.width}
          height={dockSurface.height}
          viewBox={`0 0 ${dockSurface.width} ${dockSurface.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {settings.backdropImage ? (
            <defs>
              <pattern
                id="todobar-dock-backdrop"
                patternUnits="userSpaceOnUse"
                width={dockSurface.width}
                height={dockSurface.height}
              >
                <rect
                  className="dock-backdrop-base"
                  width={dockSurface.width}
                  height={dockSurface.height}
                />
                <image
                  href={settings.backdropImage}
                  width={dockSurface.width}
                  height={dockSurface.height}
                  preserveAspectRatio="xMidYMid slice"
                  opacity={Math.min(0.14, settings.backdropOpacity / 620)}
                />
              </pattern>
            </defs>
          ) : null}
          <path
            d={dockSurface.path}
            style={
              settings.backdropImage
                ? { fill: 'url(#todobar-dock-backdrop)' }
                : undefined
            }
          />
        </svg>
      ) : null}

      <span className="edge-hover-zone" aria-hidden="true" />

      <button
        className={`edge-handle ${isOpen ? 'is-open' : ''}`}
        type="button"
        aria-label={isOpen ? '收起每日计划' : '打开每日计划'}
        aria-expanded={isOpen}
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        onClick={onHandleClick}
      >
        <span className="handle-symbol" aria-hidden="true">
          <PanelRightOpen className="handle-icon-open" size={15} />
          <PanelRightClose className="handle-icon-close" size={15} />
        </span>
        {reminderToasts.length > 0 ? (
          <span className="handle-badge" aria-label={`${reminderToasts.length} 条提醒`}>
            {Math.min(reminderToasts.length, 9)}
          </span>
        ) : null}
      </button>

      <ReminderToastStack
        toasts={reminderToasts}
        onClose={dismissReminderToast}
        onOpen={openReminderToast}
        onSnooze={snoozeReminderToast}
      />

      <aside
        className={`todo-sidebar ${isOpen ? 'is-open' : ''} ${
          isSettingsOpen ? 'is-settings-open' : ''
        }`}
        aria-label="每日计划侧栏"
        aria-hidden={!isOpen}
      >
        {isSettingsOpen ? (
          <div className="settings-drawer" role="dialog" aria-label="设置">
            <SidebarSettingsPanel
              gmail={gmail}
              settings={settings}
              onChange={updateSettings}
              onReset={resetSettings}
              onClose={closeSettings}
            />
          </div>
        ) : (
          <div className="sidebar-content">
            <header className="sidebar-header">
              <div className="app-lockup">
                <span className="app-icon">
                  <Check size={15} />
                </span>
                <div>
                  <strong>每日计划</strong>
                </div>
              </div>
            </header>

            <section
              className="focus-strip"
              aria-label={`今天进度 ${progressPercent}%`}
            >
              <span style={{ width: `${progressPercent}%` }} />
            </section>

            <div
              className={`view-stack ${settings.longTermWide ? 'long-term-wide' : ''}`}
              data-motion={sectionMotion}
              data-view={activeRailSection}
              key={activeRailSection}
            >
              {activeRailSection === 'today' ? (
                <>
                  <section
                  className="panel-section"
                  aria-labelledby="today-heading"
                  id="today-section"
                >
                  <div className="section-heading">
                    <div>
                      <span id="today-heading">
                        <Clock3 size={15} />
                        今天
                        <em>
                          {completed} 项已完成 · 共 {todayTasks.length} 项
                        </em>
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={
                        collapsedSections.today
                          ? '展开今天'
                          : '收起今天'
                      }
                      aria-expanded={!collapsedSections.today}
                      onClick={() => toggleSection('today')}
                    >
                      {collapsedSections.today ? (
                        <Plus size={15} />
                      ) : (
                        <Minus size={15} />
                      )}
                    </button>
                  </div>
                  <div
                    className={`section-content ${
                      collapsedSections.today ? 'is-collapsed' : ''
                    }`}
                    aria-hidden={collapsedSections.today}
                  >
                    <div className="section-content-inner">
                      <QuickAdd
                        ariaLabel="在今天添加任务"
                        value={drafts.today}
                        colorValue={colorDrafts.today}
                        reminderValue={reminderDrafts.today}
                        suggestedReminderValue=""
                        placeholder="添加任务…"
                        onChange={(value) => updateDraft('today', value)}
                        onColorChange={(value) => updateColorDraft('today', value)}
                        onReminderChange={(value) =>
                          updateReminderDraft('today', value)
                        }
                        onSubmit={() => addTask('today')}
                        onKeyDown={(event) => onDraftKeyDown(event, 'today')}
                      />
                      {GMAIL_CONNECTOR_VISIBLE ? (
                        <GmailInboxSuggestions
                          gmail={gmail}
                          onConvert={convertGmailSuggestionToTask}
                        />
                      ) : null}
                      <div className="task-list">
                        {visibleTodayTasks.length > 0 ? (
                          visibleTodayTasks.map((task, index) => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              index={index}
                              onToggle={(id) => toggleTask('today', id)}
                              onColor={(id, color) => setTaskColor('today', id, color)}
                              onReminder={(id) => cycleTaskReminder('today', id)}
                              onDelete={(id) => deleteTask('today', id)}
                              onRename={(id, title) =>
                                renameTask('today', id, title)
                              }
                            />
                          ))
                        ) : (
                          <div className="empty-task-list">
                            <Check size={14} />
                            <span>这里没有未完成的任务。</span>
                          </div>
                        )}
                      </div>
                      {pinnedTodayLists.length > 0 ? (
                        <section
                          className="today-goals"
                          aria-label="今天显示的置顶清单"
                        >
                          <div className="mini-heading">
                            <strong>置顶清单</strong>
                            <span>{pinnedTodayLists.length} 个置顶</span>
                          </div>
                          <div className="pinned-list-stack">
                            {pinnedTodayLists.map((list) => {
                              const sortedTasks = sortTasks(
                                list.tasks,
                                settings.taskSortMode,
                              )
                              const visibleTasks = settings.showCompleted
                                ? sortedTasks
                                : sortedTasks.filter((task) => !task.done)

                              return (
                                <section
                                  className="today-goal-list"
                                  key={list.id}
                                  aria-label={`${list.title} 目标`}
                                >
                                  <div className="today-goal-list-title">
                                    <strong>{list.title}</strong>
                                    <span>{list.tasks.length} 项任务</span>
                                  </div>
                                  {visibleTasks.length > 0 ? (
                                    <div className="task-list compact-task-list pinned-task-list">
                                      {visibleTasks.map((task, index) => (
                                        <TaskRow
                                          key={task.id}
                                          task={task}
                                          index={index}
                                          onToggle={(id) =>
                                            toggleCustomTask(list.id, id)
                                          }
                                          onColor={(id, color) =>
                                            setCustomTaskColor(list.id, id, color)
                                          }
                                          onReminder={(id) =>
                                            cycleCustomTaskReminder(list.id, id)
                                          }
                                          onDelete={(id) =>
                                            deleteCustomTask(list.id, id)
                                          }
                                          onRename={(id, title) =>
                                            renameCustomTask(list.id, id, title)
                                          }
                                        />
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="empty-list-note">
                                      这个清单里没有任务。
                                    </p>
                                  )}
                                </section>
                              )
                            })}
                          </div>
                        </section>
                      ) : null}
                    </div>
                  </div>
                </section>
                <section
                  className="panel-section long-term-section"
                  aria-labelledby="long-term-heading"
                >
                  <div className="section-heading">
                    <div>
                      <span id="long-term-heading">
                        <Clock3 size={15} />
                        长期任务
                        <em>{longTermTasks.length} 项常驻</em>
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`long-term-width-toggle ${
                        settings.longTermWide ? 'is-selected' : ''
                      }`}
                      aria-label="长期任务双倍宽"
                      aria-pressed={settings.longTermWide}
                      title={settings.longTermWide ? '恢复标准宽度' : '展开为双倍宽度'}
                      onClick={() =>
                        updateSettings({ longTermWide: !settings.longTermWide })
                      }
                    >
                      <Maximize2 size={14} />
                      <span>宽版</span>
                    </button>
                  </div>
                  <div className="section-content-inner">
                    <QuickAdd
                      ariaLabel="添加长期任务"
                      value={longTermDraft}
                      colorValue={longTermColorDraft}
                      reminderValue=""
                      showReminder={false}
                      placeholder="添加长期任务…"
                      onChange={setLongTermDraft}
                      onColorChange={setLongTermColorDraft}
                      onReminderChange={() => undefined}
                      onSubmit={addLongTermTask}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          addLongTermTask()
                        }
                      }}
                    />
                    <div className="task-list long-term-task-list">
                      {visibleLongTermTasks.length > 0 ? (
                        visibleLongTermTasks.map((task, index) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            index={index}
                            showReminder={false}
                            showProgress
                            onToggle={toggleLongTermTask}
                            onColor={setLongTermTaskColor}
                            onProgress={setLongTermTaskProgress}
                            onDelete={deleteLongTermTask}
                            onRename={renameLongTermTask}
                          />
                        ))
                      ) : (
                        <div className="empty-task-list">
                          <Clock3 size={14} />
                          <span>还没有长期任务。</span>
                        </div>
                      )}
                    </div>
                  </div>
                  </section>
                </>
              ) : null}

              {activeRailSection === 'calendar' ? (
                <section
                  className="panel-section calendar-section"
                  aria-labelledby="calendar-heading"
                  id="calendar-section"
                >
                  <div className="section-heading">
                    <div>
                      <span id="calendar-heading">
                        <CalendarDays size={15} />
                        日历
                        <em>{formatCalendarMonth(calendarCursor)}</em>
                      </span>
                    </div>
                    <div className="calendar-toolbar" aria-label="日历月份">
                      <div className="calendar-nav">
                        <button
                          type="button"
                          aria-label="上个月"
                          onClick={() =>
                            setCalendarCursor((current) => addMonths(current, -1))
                          }
                        >
                          <ChevronLeft size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label="下个月"
                          onClick={() =>
                            setCalendarCursor((current) => addMonths(current, 1))
                          }
                        >
                          <ChevronRight size={15} />
                        </button>
                      </div>
                      <button
                        type="button"
                        className="calendar-today-button"
                        aria-label="跳转到今天"
                        onClick={jumpCalendarToToday}
                      >
                        今天
                      </button>
                    </div>
                  </div>

                  <div className="calendar-board">
                    <div className="calendar-weekdays" aria-hidden="true">
                      {['一', '二', '三', '四', '五', '六', '日'].map(
                        (day) => (
                          <span key={day}>{day}</span>
                        ),
                      )}
                    </div>
                    <div
                      className="calendar-grid"
                      role="grid"
                      aria-label={formatCalendarMonth(calendarCursor)}
                    >
                      {calendarDays.map((day) => (
                        <button
                          type="button"
                          key={day.key}
                          className={[
                            day.isCurrentMonth ? '' : 'is-muted',
                            day.isToday ? 'is-today' : '',
                            day.key === selectedCalendarKey ? 'is-selected' : '',
                            day.taskCount > 0 ? 'has-task' : '',
                            day.eventCount > 0 ? 'has-event' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          aria-label={`${formatCalendarDay(day.date)}, ${
                            day.taskCount
                          } 项安排`}
                          aria-selected={day.key === selectedCalendarKey}
                          role="gridcell"
                          onClick={() => {
                            setSelectedCalendarKey(day.key)

                            if (!day.isCurrentMonth) {
                              setCalendarCursor(
                                new Date(
                                  day.date.getFullYear(),
                                  day.date.getMonth(),
                                  1,
                                ),
                              )
                            }
                          }}
                        >
                          <span>{day.date.getDate()}</span>
                          {day.taskCount > 0 ? (
                            <em>
                              {day.doneCount}/{day.taskCount}
                            </em>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="calendar-day-panel">
                    <div>
                      <strong>{formatCalendarDay(selectedCalendarDate)}</strong>
                      <span>
                        {selectedCalendarTasks.length === 0
                          ? '没有提醒'
                          : `${selectedCalendarOpenCount} 项未完成 · ${selectedCalendarEventCount} 个事件`}
                      </span>
                    </div>
                    <div className="calendar-day-summary" aria-label="所选日期摘要">
                      <span>
                        <Clock3 size={11} />
                        {selectedCalendarTasks.length} 项安排
                      </span>
                      <span>
                        <CalendarDays size={11} />
                        {selectedCalendarEventCount} 个事件
                      </span>
                    </div>
                    <div className="calendar-entry-mode" aria-label="日历条目类型">
                      <button
                        type="button"
                        className={calendarEntryMode === 'task' ? 'is-selected' : ''}
                        aria-pressed={calendarEntryMode === 'task'}
                        onClick={() => setCalendarEntryMode('task')}
                      >
                        任务
                      </button>
                      <button
                        type="button"
                        className={calendarEntryMode === 'event' ? 'is-selected' : ''}
                        aria-pressed={calendarEntryMode === 'event'}
                        onClick={() => setCalendarEntryMode('event')}
                      >
                        事件
                      </button>
                    </div>
                    <QuickAdd
                      ariaLabel="在所选日期添加任务"
                      value={drafts.month}
                      colorValue={colorDrafts.month}
                      reminderValue={
                        reminderDrafts.month
                      }
                      suggestedReminderValue={`${selectedCalendarKey}T09:00`}
                      placeholder={
                        calendarEntryMode === 'event'
                          ? '添加事件…'
                          : '添加任务…'
                      }
                      onChange={(value) => updateDraft('month', value)}
                      onColorChange={(value) => updateColorDraft('month', value)}
                      onReminderChange={(value) =>
                        updateReminderDraft('month', value)
                      }
                      onSubmit={addCalendarTask}
                      onKeyDown={onCalendarDraftKeyDown}
                    />
                    {selectedCalendarTasks.length > 0 ? (
                      <div className="calendar-agenda">
                        <div className="task-list calendar-task-list">
                          {selectedCalendarTasks.map(
                            ({ listId, listTitle, source, task }, index) => (
                              <TaskRow
                                key={`${source}-${listId ?? 'base'}-${task.id}`}
                                task={{
                                  ...task,
                                  meta: `${formatReminder(task.reminderAt)} · ${
                                    task.kind === 'event' ? '事件' : listTitle
                                  }`,
                                }}
                                index={index}
                                onToggle={(id) =>
                                  toggleCalendarTask(source, listId, id)
                                }
                                onColor={(id, color) =>
                                  setCalendarTaskColor(source, listId, id, color)
                                }
                                onReminder={(id) =>
                                  cycleCalendarTaskReminder(source, listId, id)
                                }
                                onDelete={(id) =>
                                  deleteCalendarTask(source, listId, id)
                                }
                                onRename={(id, title) =>
                                  renameCalendarTask(source, listId, id, title)
                                }
                              />
                            ),
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="calendar-empty-state">
                        <Clock3 size={14} />
                        <strong>这天没有提醒</strong>
                        <span>在上方添加任务，或选择其他日期。</span>
                      </div>
                    )}
                  </div>

                  {unscheduledMonthTasks.length > 0 ? (
                    <div className="calendar-backlog">
                      <div className="mini-heading">
                        <strong>待安排</strong>
                        <span>{unscheduledMonthTasks.length} 项未完成</span>
                      </div>
                      <div className="task-list month-list">
                        {visibleMonthTasks
                          .filter((task) => !task.reminderAt)
                          .map((task, index) => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              index={index}
                              onToggle={(id) => toggleTask('month', id)}
                              onColor={(id, color) => setTaskColor('month', id, color)}
                              onReminder={(id) => cycleTaskReminder('month', id)}
                              onDelete={(id) => deleteTask('month', id)}
                              onRename={(id, title) =>
                                renameTask('month', id, title)
                              }
                            />
                          ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {activeRailSection === 'lists' ? (
                <section
                  className="panel-section list-section"
                  aria-labelledby="lists-heading"
                  id="lists-section"
                >
                  <div className="section-heading">
                    <div>
                      <span id="lists-heading">
                        <ListTodo size={15} />
                        清单
                        <em>{customLists.length} 个自定义</em>
                      </span>
                    </div>
                  </div>

                  <div className="quick-add list-create">
                    <ListTodo size={16} />
                    <input
                      aria-label="创建自定义清单"
                      placeholder="新建清单…"
                      value={newListDraft}
                      onChange={(event) => setNewListDraft(event.target.value)}
                      onKeyDown={onNewListKeyDown}
                    />
                    <button
                      type="button"
                      aria-label="创建清单"
                      onClick={addCustomList}
                    >
                      <Plus size={16} />
                    </button>
                  </div>

                  <div className="custom-list-stack">
                    {customLists.map((list) => {
                      const sortedTasks = sortTasks(
                        list.tasks,
                        settings.taskSortMode,
                      )
                      const visibleTasks = settings.showCompleted
                        ? sortedTasks
                        : sortedTasks.filter((task) => !task.done)

                      return (
                        <section className="custom-list" key={list.id}>
                          <div className="custom-list-header">
                            {editingListId === list.id ? (
                              <input
                                className="custom-list-edit-input"
                                aria-label={`重命名${list.title}`}
                                value={listTitleDraft}
                                autoFocus
                                onBlur={() => commitRenameCustomList(list.id)}
                                onChange={(event) =>
                                  setListTitleDraft(event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    commitRenameCustomList(list.id)
                                  }

                                  if (event.key === 'Escape') {
                                    cancelRenameCustomList()
                                  }
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                className="custom-list-title"
                                aria-expanded={!list.collapsed}
                                onClick={() => toggleCustomList(list.id)}
                              >
                                <span>{list.title}</span>
                                <em>{list.tasks.length}</em>
                              </button>
                            )}
                            <button
                              type="button"
                              className={`custom-list-pin ${
                                list.showOnToday ? 'is-pinned' : ''
                              }`}
                              aria-label={
                                list.showOnToday
                                  ? `从今天移除${list.title}`
                                  : `在今天显示${list.title}`
                              }
                              aria-pressed={Boolean(list.showOnToday)}
                              onClick={() => toggleCustomListOnToday(list.id)}
                            >
                              <Pin size={13} />
                            </button>
                            <button
                              type="button"
                              className="edit-button custom-list-edit"
                              aria-label={`重命名${list.title}`}
                              onClick={() => startRenameCustomList(list)}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              className="delete-button custom-list-delete"
                              aria-label={`删除${list.title}`}
                              aria-expanded={pendingCustomListDelete === list.id}
                              onClick={(event) => {
                                if (event.shiftKey) {
                                  deleteCustomList(list.id)
                                  return
                                }

                                setPendingCustomListDelete(list.id)
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                            {pendingCustomListDelete === list.id ? (
                              <div
                                className="delete-confirm-popover list-delete-confirm"
                                role="alertdialog"
                                aria-label={`确认删除${list.title}`}
                              >
                                <span>删除清单？</span>
                                <div>
                                  <button
                                    type="button"
                                    onClick={() => setPendingCustomListDelete(null)}
                                  >
                                    取消
                                  </button>
                                  <button
                                    type="button"
                                    className="is-danger"
                                    onClick={() => deleteCustomList(list.id)}
                                  >
                                    删除
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>

                          <div
                            className={`section-content ${
                              list.collapsed ? 'is-collapsed' : ''
                            }`}
                            aria-hidden={Boolean(list.collapsed)}
                          >
                            <div className="section-content-inner">
                              <QuickAdd
                                ariaLabel={`在${list.title}中添加任务`}
                                value={customDrafts[list.id] ?? ''}
                                colorValue={
                                  customColorDrafts[list.id] ?? DEFAULT_TASK_COLOR
                                }
                                reminderValue={
                                  customReminderDrafts[list.id] ?? ''
                                }
                                placeholder={`添加到${list.title}…`}
                                onChange={(value) =>
                                  updateCustomDraft(list.id, value)
                                }
                                onColorChange={(value) =>
                                  updateCustomColorDraft(list.id, value)
                                }
                                onReminderChange={(value) =>
                                  updateCustomReminderDraft(list.id, value)
                                }
                                onSubmit={() => addCustomTask(list.id)}
                                onKeyDown={(event) =>
                                  onCustomDraftKeyDown(event, list.id)
                                }
                              />
                              {visibleTasks.length > 0 ? (
                                <div className="task-list">
                                  {visibleTasks.map((task, index) => (
                                    <TaskRow
                                      key={task.id}
                                      task={task}
                                      index={index}
                                      onToggle={(id) =>
                                        toggleCustomTask(list.id, id)
                                      }
                                      onColor={(id, color) =>
                                        setCustomTaskColor(list.id, id, color)
                                      }
                                      onReminder={(id) =>
                                        cycleCustomTaskReminder(list.id, id)
                                      }
                                      onDelete={(id) =>
                                        deleteCustomTask(list.id, id)
                                      }
                                      onRename={(id, title) =>
                                        renameCustomTask(list.id, id, title)
                                      }
                                    />
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </section>
                      )
                    })}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        )}
        <SidebarRail
          activeSection={activeRailSection}
          isSettingsOpen={isSettingsOpen}
          sectionOrder={settings.sectionOrder}
          onFocusSection={focusSection}
          onOpenSettings={openSettings}
        />
      </aside>
    </main>
  )
}

function ReminderToastStack({
  toasts,
  onClose,
  onOpen,
  onSnooze,
}: {
  toasts: ReminderToast[]
  onClose: (id: string) => void
  onOpen: (toast: ReminderToast) => void
  onSnooze: (toast: ReminderToast) => void
}) {
  return (
    <section
      className="reminder-toast-stack"
      aria-label="提醒通知"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <article className="reminder-toast" key={toast.id} role="status">
          <span className="reminder-toast-icon" aria-hidden="true">
            <BellRing size={15} />
          </span>
          <div className="reminder-toast-copy">
            <strong>{toast.title}</strong>
            <span>{toast.body}</span>
            <em>到期：{toast.dueLabel}</em>
          </div>
          <div className="reminder-toast-actions">
            <button
              type="button"
              className="is-subtle"
              aria-label={`将${toast.title}延后 10 分钟`}
              onClick={() => onSnooze(toast)}
            >
              10 分钟
            </button>
            <button type="button" onClick={() => onOpen(toast)}>
              打开
            </button>
            <button
              type="button"
              className="is-icon"
              aria-label={`关闭${toast.title}的提醒`}
              onClick={() => onClose(toast.id)}
            >
              <X size={13} />
            </button>
          </div>
        </article>
      ))}
    </section>
  )
}

function SidebarRail({
  activeSection,
  isSettingsOpen,
  sectionOrder,
  onFocusSection,
  onOpenSettings,
}: {
  activeSection: SectionId
  isSettingsOpen: boolean
  sectionOrder: SectionId[]
  onFocusSection: (section: SectionId) => void
  onOpenSettings: () => void
}) {
  return (
    <nav className="sidebar-rail" aria-label="每日计划导航">
      <div className="rail-stack">
        {sectionOrder.map((section) => (
          <button
            type="button"
            key={section}
            className={activeSection === section && !isSettingsOpen ? 'is-active' : ''}
            aria-label={`跳转到${SECTION_LABELS[section]}`}
            aria-current={activeSection === section && !isSettingsOpen ? 'true' : undefined}
            title={SECTION_LABELS[section]}
            onClick={() => onFocusSection(section)}
          >
            {section === 'today' ? <Clock3 size={16} /> : null}
            {section === 'calendar' ? <CalendarDays size={16} /> : null}
            {section === 'lists' ? <ListTodo size={16} /> : null}
            <span>{SECTION_LABELS[section].split(' ')[0]}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className={isSettingsOpen ? 'is-active' : ''}
        aria-label="侧栏设置"
        aria-pressed={isSettingsOpen}
        title="设置"
        onClick={onOpenSettings}
      >
        <Settings size={16} />
        <span>设置</span>
      </button>
    </nav>
  )
}

function QuickAdd({
  ariaLabel,
  colorValue,
  value,
  reminderValue,
  showReminder = true,
  suggestedReminderValue,
  placeholder,
  onChange,
  onColorChange,
  onReminderChange,
  onSubmit,
  onKeyDown,
}: {
  ariaLabel: string
  colorValue: TaskColor
  value: string
  reminderValue: string
  showReminder?: boolean
  suggestedReminderValue?: string
  placeholder: string
  onChange: (value: string) => void
  onColorChange: (value: TaskColor) => void
  onReminderChange: (value: string) => void
  onSubmit: () => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  const [isColorOpen, setIsColorOpen] = useState(false)
  const [isReminderOpen, setIsReminderOpen] = useState(false)
  const hasReminder = showReminder && Boolean(reminderValue)
  const reminderInputValue = reminderValue || suggestedReminderValue || ''

  return (
    <div
      className={`quick-add ${showReminder ? '' : 'no-reminder'} ${
        isReminderOpen ? 'is-reminder-open' : ''
      } ${
        hasReminder ? 'has-reminder' : ''
      } ${isColorOpen ? 'is-color-open' : ''}`}
    >
      <Inbox size={16} />
      <input
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          onKeyDown(event)

          if (event.key === 'Enter' && value.trim()) {
            setIsReminderOpen(false)
          }
        }}
      />
      <button
        type="button"
        className={`color-toggle task-color-${colorValue}`}
        aria-label={`选择任务颜色：${taskColorLabel(colorValue)}`}
        aria-expanded={isColorOpen}
        onClick={() => {
          setIsColorOpen((current) => !current)
          setIsReminderOpen(false)
        }}
      >
        <span className="task-color-swatch" aria-hidden="true" />
      </button>
      {showReminder ? (
        <button
          type="button"
          className="reminder-toggle"
          aria-label={
            isReminderOpen
              ? '关闭提醒时间'
              : hasReminder
                ? '编辑提醒时间'
                : '添加提醒时间'
          }
          aria-pressed={hasReminder}
          aria-expanded={isReminderOpen}
          onClick={() => setIsReminderOpen((current) => !current)}
        >
          {hasReminder ? <BellRing size={15} /> : <Bell size={15} />}
        </button>
      ) : null}
      <button
        type="button"
        className="submit-task"
        aria-label="添加任务"
        onClick={() => {
          onSubmit()
          setIsReminderOpen(false)
        }}
      >
        <Plus size={16} />
      </button>
      {isColorOpen ? (
        <div className="quick-add-color-popover">
          <TaskColorPalette
            value={colorValue}
            onChange={(nextColor) => {
              onColorChange(nextColor)
              setIsColorOpen(false)
            }}
          />
        </div>
      ) : null}
      {showReminder && isReminderOpen ? (
        <div className="reminder-popover">
          <div className="reminder-presets" aria-label="提醒快捷选项">
            <button
              type="button"
              aria-label="从现在起 30 分钟后"
              onClick={() =>
                onReminderChange(reminderPresetValue('soon', reminderInputValue))
              }
            >
              <strong>30 分钟</strong>
              <span>稍后</span>
            </button>
            <button
              type="button"
              aria-label="明天同一时间"
              onClick={() =>
                onReminderChange(
                  reminderPresetValue('tomorrow', reminderInputValue),
                )
              }
            >
              <strong>明天</strong>
              <span>同一时间</span>
            </button>
            <button
              type="button"
              aria-label="下周同一时间"
              onClick={() =>
                onReminderChange(
                  reminderPresetValue('nextWeek', reminderInputValue),
                )
              }
            >
              <strong>下周</strong>
              <span>同一时间</span>
            </button>
          </div>
          <label>
            <span>提醒时间</span>
            <input
              aria-label="提醒时间"
              type="datetime-local"
              value={reminderInputValue}
              onChange={(event) => onReminderChange(event.target.value)}
            />
          </label>
          {hasReminder ? (
            <button
              type="button"
              aria-label="清除提醒"
              onClick={() => onReminderChange('')}
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function taskColorLabel(color: TaskColor) {
  return (
    TASK_COLOR_OPTIONS.find((option) => option.value === color)?.label ??
    '白色'
  )
}

function TaskColorPalette({
  value,
  onChange,
}: {
  value: TaskColor
  onChange: (value: TaskColor) => void
}) {
  return (
    <div className="task-color-palette" aria-label="任务颜色">
      {TASK_COLOR_OPTIONS.map((option) => (
        <button
          type="button"
          key={option.value}
          className={`task-color-choice task-color-${option.value} ${
            value === option.value ? 'is-selected' : ''
          }`}
          aria-label={option.label}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          <span className="task-color-swatch" aria-hidden="true" />
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  )
}

function SidebarSettingsPanel({
  gmail,
  settings,
  onChange,
  onReset,
  onClose,
}: {
  gmail: GmailConnectorController
  settings: SidebarSettings
  onChange: (patch: Partial<SidebarSettings>) => void
  onReset: () => void
  onClose: () => void
}) {
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)
  const [collapsedSettingsGroups, setCollapsedSettingsGroups] = useState<
    Partial<Record<SettingsGroupId, boolean>>
  >(() => {
    try {
      const stored = window.localStorage.getItem(SETTINGS_GROUPS_STORAGE_KEY)
      const parsed = stored
        ? (JSON.parse(stored) as Partial<Record<SettingsGroupId, boolean>>)
        : {}

      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  })
  const [panelWidthDraft, setPanelWidthDraft] = useState(() => ({
    base: settings.panelWidth,
    value: settings.panelWidth,
  }))
  const availableThemes = getThemeOptions(settings.theme)
  const selectedTheme =
    availableThemes.find((preset) => preset.id === settings.visualStyle) ??
    availableThemes[0] ??
    THEME_PRESETS[0]
  const draftPanelWidth =
    panelWidthDraft.base === settings.panelWidth
      ? panelWidthDraft.value
      : settings.panelWidth
  const hasPanelWidthDraft = draftPanelWidth !== settings.panelWidth
  const updateDraftPanelWidth = (value: number) => {
    setPanelWidthDraft({
      base: settings.panelWidth,
      value,
    })
  }
  const applyPanelWidth = () => {
    onChange({ panelWidth: draftPanelWidth })
    setPanelWidthDraft({
      base: draftPanelWidth,
      value: draftPanelWidth,
    })
  }
  const toggleSettingsGroup = (group: SettingsGroupId) => {
    setCollapsedSettingsGroups((current) => {
      const next = {
        ...current,
        [group]: !current[group],
      }

      try {
        window.localStorage.setItem(
          SETTINGS_GROUPS_STORAGE_KEY,
          JSON.stringify(next),
        )
      } catch {
        // A failed preference write should not block the settings UI.
      }

      return next
    })
  }

  useEffect(() => {
    return scheduleLocalStorageWrite(
      SETTINGS_GROUPS_STORAGE_KEY,
      JSON.stringify(collapsedSettingsGroups),
      180,
    )
  }, [collapsedSettingsGroups])
  const [backdropError, setBackdropError] = useState('')
  const onBackdropUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''

    if (!file) {
      return
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setBackdropError('请使用 PNG、JPG 或 WebP 图片。')
      return
    }

    if (file.size > 1_500_000) {
      setBackdropError('图片大小不能超过 1.5 MB。')
      return
    }

    const reader = new FileReader()

    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''

      if (!result.startsWith('data:image/')) {
        setBackdropError('无法读取这张图片。')
        return
      }

      setBackdropError('')
      onChange({
        backdropImage: result,
        backdropImageName: file.name,
      })
    }

    reader.onerror = () => setBackdropError('无法读取这张图片。')
    reader.readAsDataURL(file)
  }

  return (
    <section className="settings-panel" aria-label="侧栏设置">
      <div className="settings-panel-header">
        <div>
          <strong>任务设置</strong>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="mode-toggle"
            aria-label={
              settings.theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'
            }
            onClick={() =>
              onChange(getNextThemePatch(settings.theme, settings.visualStyle))
            }
          >
            {settings.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            type="button"
            aria-label="重置设置"
            aria-expanded={isResetConfirmOpen}
            onClick={() => setIsResetConfirmOpen((current) => !current)}
          >
            <RotateCcw size={15} />
          </button>
          <button type="button" aria-label="关闭设置" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </div>

      {isResetConfirmOpen ? (
        <div
          className="settings-confirm-popover"
          role="alertdialog"
          aria-label="确认重置设置"
        >
          <strong>重置设置？</strong>
          <span>布局、主题、动效和尺寸将恢复默认值。</span>
          <div>
            <button type="button" onClick={() => setIsResetConfirmOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={() => {
                onReset()
                setIsResetConfirmOpen(false)
              }}
            >
              重置
            </button>
          </div>
        </div>
      ) : null}

      <SettingsGroup
        id="theme"
        title="主题"
        icon={<Palette size={12} />}
        collapsed={Boolean(collapsedSettingsGroups.theme)}
        className="settings-appearance"
        onToggle={toggleSettingsGroup}
      >
        <div className="theme-picker-panel">
          <div className="theme-mode-row" aria-label="颜色模式">
            <span>{settings.theme === 'dark' ? '深色模式' : '浅色模式'}</span>
            <em>{selectedTheme?.note}</em>
          </div>
          <ThemePresetDropdown
            key={settings.theme}
            options={availableThemes}
            selectedTheme={selectedTheme}
            value={settings.visualStyle}
            onChange={(visualStyle) => onChange({ visualStyle })}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        id="edge"
        title="屏幕边缘"
        icon={<PanelRightOpen size={12} />}
        collapsed={Boolean(collapsedSettingsGroups.edge)}
        onToggle={toggleSettingsGroup}
      >
        <DockEdgeSetting
          value={settings.dockEdge}
          onChange={(dockEdge) => onChange({ dockEdge })}
        />
      </SettingsGroup>

      <SettingsGroup
        id="layout"
        title="布局"
        icon={<ListTodo size={12} />}
        collapsed={Boolean(collapsedSettingsGroups.layout)}
        onToggle={toggleSettingsGroup}
      >
        <SectionOrderSetting
          order={settings.sectionOrder}
          onReorder={(section, targetIndex) =>
            onChange({
              sectionOrder: moveSectionOrderToIndex(
                settings.sectionOrder,
                section,
                targetIndex,
              ),
            })
          }
          onMove={(section, direction) =>
            onChange({
              sectionOrder: moveSectionOrder(
                settings.sectionOrder,
                section,
                direction,
              ),
            })
          }
        />
      </SettingsGroup>

      <SettingsGroup
        id="desktop"
        title="桌面"
        icon={<Settings size={12} />}
        collapsed={Boolean(collapsedSettingsGroups.desktop)}
        onToggle={toggleSettingsGroup}
      >
        <ToggleSetting
          label="开机启动"
          checked={settings.launchAtLogin}
          onChange={(launchAtLogin) => onChange({ launchAtLogin })}
        />
        <ToggleSetting
          label="通知"
          checked={settings.notificationsEnabled}
          onChange={(notificationsEnabled) => onChange({ notificationsEnabled })}
        />
      </SettingsGroup>

      {GMAIL_CONNECTOR_VISIBLE ? (
        <SettingsGroup
          id="connectors"
          title="连接器"
          icon={<Mail size={12} />}
          collapsed={Boolean(collapsedSettingsGroups.connectors)}
          onToggle={toggleSettingsGroup}
        >
          <ConnectorSetting gmail={gmail} />
        </SettingsGroup>
      ) : null}

      <SettingsGroup
        id="backdrop"
        title="背景图"
        icon={<ImagePlus size={12} />}
        collapsed={Boolean(collapsedSettingsGroups.backdrop)}
        className="settings-backdrop-group"
        onToggle={toggleSettingsGroup}
      >
        <BackdropSetting
          error={backdropError}
          settings={settings}
          onClear={() =>
            onChange({
              backdropImage: '',
              backdropImageName: '',
            })
          }
          onUpload={onBackdropUpload}
        />
        {settings.backdropImage ? (
          <div className="settings-range-grid">
            <SliderSetting
              label="图片强度"
              value={settings.backdropOpacity}
              min={30}
              max={100}
              step={1}
              suffix="%"
              onChange={(backdropOpacity) => onChange({ backdropOpacity })}
            />
            <SliderSetting
              label="背景压暗"
              value={settings.backdropDim}
              min={0}
              max={70}
              step={1}
              suffix="%"
              onChange={(backdropDim) => onChange({ backdropDim })}
            />
            <SliderSetting
              label="柔和模糊"
              value={settings.backdropBlur}
              min={0}
              max={18}
              step={1}
              suffix="px"
              onChange={(backdropBlur) => onChange({ backdropBlur })}
            />
          </div>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        id="window"
        title="窗口与边缘按钮"
        icon={<PanelRightClose size={12} />}
        collapsed={Boolean(collapsedSettingsGroups.window)}
        className="settings-size-group"
        onToggle={toggleSettingsGroup}
      >
        <div className="deferred-setting">
          <SliderSetting
            label="面板宽度"
            value={draftPanelWidth}
            min={320}
            max={560}
            step={4}
            suffix="px"
            onChange={updateDraftPanelWidth}
          />
          <button
            type="button"
            className="apply-setting"
            disabled={!hasPanelWidthDraft}
            onClick={applyPanelWidth}
          >
            保存宽度
          </button>
        </div>
        <div className="settings-range-grid">
          <ToggleSetting
            label="仅悬停显示按钮"
            checked={settings.tabVisibility === 'hover'}
            onChange={(checked) =>
              onChange({
                tabVisibility: (checked ? 'hover' : 'always') as TabVisibility,
              })
            }
          />
          <SliderSetting
            label="按钮宽度"
            value={settings.tabWidth}
            min={22}
            max={112}
            step={2}
            suffix="px"
            onChange={(tabWidth) => onChange({ tabWidth })}
          />
          <SliderSetting
            label="按钮高度"
            value={settings.handleHeight}
            min={56}
            max={176}
            step={2}
            suffix="px"
            onChange={(handleHeight) => onChange({ handleHeight })}
          />
          <SliderSetting
            label="边缘位置"
            value={settings.handleY}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onChange={(handleY) => onChange({ handleY })}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        id="tasks"
        title="任务"
        icon={<Check size={12} />}
        collapsed={Boolean(collapsedSettingsGroups.tasks)}
        onToggle={toggleSettingsGroup}
      >
        <TaskSortSetting
          value={settings.taskSortMode}
          onChange={(taskSortMode) => onChange({ taskSortMode })}
        />
        <ToggleSetting
          label="显示已完成"
          checked={settings.showCompleted}
          onChange={(showCompleted) => onChange({ showCompleted })}
        />
        <SliderSetting
          label="行高"
          value={settings.taskRowHeight}
          min={40}
          max={62}
          step={1}
          suffix="px"
          onChange={(taskRowHeight) => onChange({ taskRowHeight })}
        />
        <SliderSetting
          label="行间距"
          value={settings.taskGap}
          min={4}
          max={14}
          step={1}
          suffix="px"
          onChange={(taskGap) => onChange({ taskGap })}
        />
        <SliderSetting
          label="文字大小"
          value={settings.taskTextSize}
          min={11}
          max={14}
          step={0.5}
          suffix="px"
          onChange={(taskTextSize) => onChange({ taskTextSize })}
        />
      </SettingsGroup>

      <SettingsGroup
        id="feel"
        title="外观细节"
        icon={<Palette size={12} />}
        collapsed={Boolean(collapsedSettingsGroups.feel)}
        onToggle={toggleSettingsGroup}
      >
        <SliderSetting
          label="动效"
          value={settings.motionMs}
          min={140}
          max={360}
          step={10}
          suffix="ms"
          onChange={(motionMs) => onChange({ motionMs })}
        />
        <SliderSetting
          label="圆角半径"
          value={settings.panelRadius}
          min={12}
          max={28}
          step={1}
          suffix="px"
          onChange={(panelRadius) => onChange({ panelRadius })}
        />
        <SliderSetting
          label="面板不透明度"
          value={settings.surfaceAlpha}
          min={58}
          max={100}
          step={1}
          suffix="%"
          description="数值越低，越能看到桌面背景。"
          onChange={(surfaceAlpha) => onChange({ surfaceAlpha })}
        />
      </SettingsGroup>
    </section>
  )
}

function SettingsGroup({
  children,
  className = '',
  collapsed,
  icon,
  id,
  title,
  onToggle,
}: {
  children: ReactNode
  className?: string
  collapsed: boolean
  icon?: ReactNode
  id: SettingsGroupId
  title: string
  onToggle: (id: SettingsGroupId) => void
}) {
  return (
    <section className={`settings-group ${className} ${collapsed ? 'is-collapsed' : ''}`}>
      <button
        type="button"
        className="settings-group-toggle"
        aria-expanded={!collapsed}
        onClick={() => onToggle(id)}
      >
        <span className="settings-group-title">
          {icon}
          {title}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div className="settings-group-content" aria-hidden={collapsed}>
        {children}
      </div>
    </section>
  )
}

function ConnectorSetting({ gmail }: { gmail: GmailConnectorController }) {
  const isConnected = gmail.status.state === 'connected'
  const needsReconnect = gmail.status.state === 'needs_reconnect'
  const isUnconfigured = gmail.status.state === 'unconfigured'
  const statusLabel =
    isConnected && gmail.status.accountEmail
      ? gmail.status.accountEmail
      : needsReconnect
        ? '需要重新连接'
        : isUnconfigured
          ? '此版本未启用 Gmail 登录'
          : '未连接'

  return (
    <div className={`connector-setting gmail-connector state-${gmail.status.state}`}>
      <div className="connector-summary">
        <div className="connector-mark" aria-hidden="true">
          <Mail size={17} />
        </div>
        <div className="connector-copy">
          <strong>Gmail</strong>
          <span>以只读方式读取收件箱，为本地任务提供建议。</span>
          <em>{statusLabel}</em>
        </div>
        <div className="connector-actions">
          {isConnected ? (
            <>
              <button
                type="button"
                disabled={gmail.isLoading}
                onClick={gmail.loadSuggestions}
              >
                同步
              </button>
              <button
                type="button"
                disabled={gmail.isLoading}
                onClick={gmail.disconnect}
              >
                断开连接
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={gmail.isLoading || isUnconfigured}
              onClick={gmail.connect}
            >
              {isUnconfigured
                ? '缺少 OAuth 配置'
                : needsReconnect
                  ? '重新连接 Gmail'
                  : '连接 Gmail'}
            </button>
          )}
        </div>
      </div>

      <div className="connector-permission-note">
        <strong>权限范围</strong>
        <span>
          每日计划只请求 Gmail 收件箱的只读权限，可读取最近未读邮件用于生成建议，但此版本不能发送、删除、添加标签或归档邮件。
        </span>
      </div>

      <div className="connector-status" role="status">
        <span className={isConnected ? 'is-ready' : ''} />
        {gmail.isLoading
          ? '正在处理 Gmail…'
          : gmail.error || gmail.status.message}
      </div>

      <div className="connector-activity" aria-label="Gmail 连接器活动记录">
        <div className="mini-heading">
          <strong>活动记录</strong>
          <span>{gmail.activities.length} 个事件</span>
        </div>
        {gmail.activities.length > 0 ? (
          <ol>
            {gmail.activities.slice(0, 4).map((activity) => (
              <li key={activity.id}>
                <span>{activity.detail}</span>
                <time dateTime={activity.at}>
                  {new Intl.DateTimeFormat('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(activity.at))}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p>还没有读取 Gmail。</p>
        )}
      </div>

      <p className="connector-advanced-note">
        此版本缺少每日计划的 Google OAuth 应用凭据。普通用户无需创建自己的 Google 项目；正式公开版本需要维护者提供经过验证的应用身份。
      </p>
    </div>
  )
}

function GmailInboxSuggestions({
  gmail,
  onConvert,
}: {
  gmail: GmailConnectorController
  onConvert: (suggestion: GmailThreadSuggestion) => void
}) {
  const isConnected = gmail.status.state === 'connected'
  const needsReconnect = gmail.status.state === 'needs_reconnect'

  if (
    gmail.status.state === 'disconnected' &&
    gmail.suggestions.length === 0 &&
    !gmail.error
  ) {
    return null
  }

  return (
    <section className="gmail-suggestions" aria-label="收件箱建议">
      <div className="gmail-suggestions-header">
        <div>
          <strong>
            <Inbox size={14} />
            收件箱建议
          </strong>
          <span>
            {isConnected && gmail.status.accountEmail
              ? gmail.status.accountEmail
              : needsReconnect
                ? '请在设置中重新连接 Gmail'
                : 'Gmail 只读'}
          </span>
        </div>
        <button
          type="button"
          aria-label="同步 Gmail 收件箱建议"
          disabled={!isConnected || gmail.isLoading}
          onClick={gmail.loadSuggestions}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="gmail-boundary">
        <span>只读</span>
        <em>不能发送、删除、添加标签或归档邮件。</em>
      </div>

      {gmail.error || needsReconnect ? (
        <div className="gmail-state-message" role="status">
          <strong>{needsReconnect ? '需要重新连接' : 'Gmail 已暂停'}</strong>
          <span>{gmail.error || gmail.status.message}</span>
        </div>
      ) : null}

      {gmail.isLoading ? (
        <div className="gmail-state-message" role="status">
          <strong>正在检查收件箱…</strong>
          <span>仅读取最近未读邮件。</span>
        </div>
      ) : null}

      {!gmail.isLoading && isConnected && gmail.suggestions.length === 0 ? (
        <div className="gmail-state-message">
          <strong>没有未读建议</strong>
          <span>忽略的建议只保存在此设备上。</span>
        </div>
      ) : null}

      {gmail.suggestions.length > 0 ? (
        <div className="gmail-suggestion-list">
          {gmail.suggestions.map((suggestion) => (
            <article className="gmail-suggestion-row" key={suggestion.threadId}>
              <div className="gmail-suggestion-copy">
                <strong>{suggestion.subject}</strong>
                <span>
                  {suggestion.from}
                  {suggestion.date ? ` · ${suggestion.date}` : ''}
                </span>
                <p>{suggestion.snippet}</p>
              </div>
              <div className="gmail-suggestion-actions">
                <a
                  aria-label={`打开 Gmail 邮件线程：${suggestion.subject}`}
                  href={suggestion.gmailUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink size={12} />
                </a>
                <button
                  type="button"
                  onClick={() => onConvert(suggestion)}
                >
                  添加任务
                </button>
                <button
                  type="button"
                  aria-label={`忽略${suggestion.subject}`}
                  onClick={() =>
                    gmail.ignoreSuggestion(
                      suggestion.threadId,
                      suggestion.subject,
                    )
                  }
                >
                  忽略
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function ThemeSwatch({ id }: { id: ThemePreset }) {
  return (
    <span className={`theme-swatch theme-preview-${id}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

function ThemePresetDropdown({
  options,
  selectedTheme,
  value,
  onChange,
}: {
  options: ThemePresetOption[]
  selectedTheme: ThemePresetOption
  value: ThemePreset
  onChange: (value: ThemePreset) => void
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div
      className={`theme-dropdown ${isOpen ? 'is-open' : ''}`}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget

        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setIsOpen(false)
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) {
          event.preventDefault()
          event.stopPropagation()
          setIsOpen(false)
        }
      }}
    >
      <button
        type="button"
        className="theme-dropdown-trigger"
        aria-label="主题预设"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <ThemeSwatch id={selectedTheme.id} />
        <span className="theme-dropdown-current">
          <strong>{selectedTheme.label}</strong>
          <em>{options.length} 个精选预设</em>
        </span>
        <ChevronDown
          className="theme-dropdown-chevron"
          size={16}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <div
          className="theme-dropdown-menu"
          role="listbox"
          aria-label="主题预设"
        >
          {options.map((preset) => (
            <button
              type="button"
              key={`${preset.mode}-${preset.id}`}
              role="option"
              aria-label={`选择${preset.label}`}
              aria-selected={value === preset.id}
              className={value === preset.id ? 'is-selected' : ''}
              onClick={() => {
                onChange(preset.id)
                setIsOpen(false)
              }}
            >
              <ThemeSwatch id={preset.id} />
              <span>
                <strong>{preset.label}</strong>
                <em>{preset.note}</em>
              </span>
              {value === preset.id ? (
                <Check size={14} aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function BackdropSetting({
  error,
  settings,
  onClear,
  onUpload,
}: {
  error: string
  settings: SidebarSettings
  onClear: () => void
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="backdrop-setting">
      <div
        className={`backdrop-preview ${
          settings.backdropImage ? 'has-image' : ''
        }`}
        style={
          settings.backdropImage
            ? { backgroundImage: `url("${settings.backdropImage}")` }
            : undefined
        }
        aria-hidden="true"
      >
        {settings.backdropImage ? null : <ImagePlus size={18} />}
      </div>
      <div className="backdrop-copy">
        <strong>
          {settings.backdropImageName || '未设置背景图'}
        </strong>
        <span>
          {settings.backdropImage
            ? '背景图会柔和地显示在预览和侧栏表面。'
            : '上传一张本地小图片，用作工作区和面板纹理。'}
        </span>
        {error ? <em>{error}</em> : null}
      </div>
      <div className="backdrop-actions">
        <label>
          上传
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onUpload}
          />
        </label>
        <button
          type="button"
          disabled={!settings.backdropImage}
          onClick={onClear}
        >
          清除
        </button>
      </div>
    </div>
  )
}

function DockEdgeSetting({
  value,
  onChange,
}: {
  value: DockEdge
  onChange: (value: DockEdge) => void
}) {
  return (
    <div className="dock-edge-setting" aria-label="停靠边缘">
      <button
        type="button"
        className={value === 'left' ? 'is-selected' : ''}
        aria-pressed={value === 'left'}
        aria-label="停靠到左侧"
        onClick={() => onChange('left')}
      >
        <span className="dock-edge-glyph" aria-hidden="true" />
        <span>左侧</span>
      </button>
      <button
        type="button"
        className={value === 'top' ? 'is-selected' : ''}
        aria-pressed={value === 'top'}
        aria-label="停靠到顶部"
        onClick={() => onChange('top')}
      >
        <span className="dock-edge-glyph" aria-hidden="true" />
        <span>顶部</span>
      </button>
      <button
        type="button"
        className={value === 'right' ? 'is-selected' : ''}
        aria-pressed={value === 'right'}
        aria-label="停靠到右侧"
        onClick={() => onChange('right')}
      >
        <span className="dock-edge-glyph" aria-hidden="true" />
        <span>右侧</span>
      </button>
    </div>
  )
}

function TaskSortSetting({
  value,
  onChange,
}: {
  value: TaskSortMode
  onChange: (value: TaskSortMode) => void
}) {
  const options: Array<{ label: string; value: TaskSortMode }> = [
    { label: '颜色顺序', value: 'color' },
    { label: '最新', value: 'newest' },
    { label: '最早', value: 'oldest' },
  ]

  return (
    <div className="task-sort-setting" aria-label="任务排序方式">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? 'is-selected' : ''}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function SectionOrderSetting({
  order,
  onMove,
  onReorder,
}: {
  order: SectionId[]
  onMove: (section: SectionId, direction: -1 | 1) => void
  onReorder: (section: SectionId, targetIndex: number) => void
}) {
  const [draggingSection, setDraggingSection] = useState<SectionId | null>(null)
  const [pointerDraggingSection, setPointerDraggingSection] =
    useState<SectionId | null>(null)
  const labels: Record<SectionId, string> = {
    calendar: '日历',
    lists: '清单',
    today: '今天',
  }
  const onDragOverRow = (
    event: DragEvent<HTMLDivElement>,
    section: SectionId,
  ) => {
    if (!draggingSection || draggingSection === section) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  useEffect(() => {
    if (!pointerDraggingSection) {
      return undefined
    }

    const stopDragging = () => setPointerDraggingSection(null)

    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)

    return () => {
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
    }
  }, [pointerDraggingSection])

  return (
    <div className="section-order-list" aria-label="区块顺序">
      {order.map((section, index) => (
        <div
          className={`section-order-row ${
            draggingSection === section || pointerDraggingSection === section
              ? 'is-dragging'
              : ''
          }`}
          draggable
          key={section}
          onDragStart={(event) => {
            setDraggingSection(section)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', section)
          }}
          onDragEnd={() => setDraggingSection(null)}
          onDragOver={(event) => onDragOverRow(event, section)}
          onPointerEnter={() => {
            if (pointerDraggingSection && pointerDraggingSection !== section) {
              onReorder(pointerDraggingSection, index)
            }
          }}
          onDrop={(event) => {
            event.preventDefault()

            const droppedSection =
              (event.dataTransfer.getData('text/plain') as SectionId) ||
              draggingSection

            if (droppedSection) {
              onReorder(droppedSection, index)
            }

            setDraggingSection(null)
          }}
        >
          <span
            className="section-order-grip"
            aria-hidden="true"
            onPointerDown={(event) => {
              event.preventDefault()
              setPointerDraggingSection(section)
            }}
          >
            <GripVertical size={13} />
          </span>
          <span>{labels[section]}</span>
          <div>
            <button
              type="button"
              aria-label={`将${labels[section]}上移`}
              disabled={index === 0}
              onClick={() => onMove(section, -1)}
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              aria-label={`将${labels[section]}下移`}
              disabled={index === order.length - 1}
              onClick={() => onMove(section, 1)}
            >
              <ArrowDown size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function ToggleSetting({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="toggle-setting">
      <span>
        <strong>{label}</strong>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <em aria-hidden="true" />
    </label>
  )
}

function SliderSetting({
  description,
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  description?: string
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (value: number) => void
}) {
  return (
    <label className="slider-setting">
      <span>
        <strong>{label}</strong>
        <em>
          {value}
          {suffix}
        </em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {description ? <small>{description}</small> : null}
    </label>
  )
}

const TaskRow = memo(function TaskRow({
  task,
  index = 0,
  showReminder = true,
  showProgress = false,
  onToggle,
  onColor,
  onProgress,
  onReminder,
  onDelete,
  onRename,
}: {
  task: Task
  index?: number
  showReminder?: boolean
  showProgress?: boolean
  onToggle?: (id: number) => void
  onColor?: (id: number, color: TaskColor) => void
  onProgress?: (id: number, progress: number) => void
  onReminder?: (id: number) => void
  onDelete?: (id: number) => void
  onRename?: (id: number, title: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [isColorOpen, setIsColorOpen] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [togglePulse, setTogglePulse] = useState<'complete' | 'open' | null>(null)
  const [draft, setDraft] = useState(task.title)
  const pulseTimeout = useRef<number | null>(null)
  const reminderLabel = formatReminder(task.reminderAt)
  const taskColor = colorForTask(task)
  const taskProgress = progressForTask(task)
  const visibleMeta = task.meta
    .split('·')
    .map((part) => part.trim())
    .filter((part) => part && part !== '今天')
    .join(' · ')
  const hasTaskDetails = Boolean(
    visibleMeta ||
      task.kind === 'event' ||
      reminderLabel ||
      (task.source?.type === 'gmail' && task.source.url),
  )
  const commitRename = () => {
    const nextTitle = draft.trim()

    if (nextTitle && nextTitle !== task.title) {
      onRename?.(task.id, nextTitle)
    } else {
      setDraft(task.title)
    }

    setIsEditing(false)
  }
  const cancelRename = () => {
    setDraft(task.title)
    setIsEditing(false)
  }
  const requestDelete = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey) {
      onDelete?.(task.id)
      return
    }

    setIsDeleteConfirmOpen(true)
  }
  const toggleTaskDone = () => {
    if (pulseTimeout.current) {
      window.clearTimeout(pulseTimeout.current)
    }

    setTogglePulse(task.done ? 'open' : 'complete')
    pulseTimeout.current = window.setTimeout(() => {
      setTogglePulse(null)
      pulseTimeout.current = null
    }, 340)
    onToggle?.(task.id)
  }

  useEffect(
    () => () => {
      if (pulseTimeout.current) {
        window.clearTimeout(pulseTimeout.current)
      }
    },
    [],
  )

  return (
    <article
      className={`task-row task-color-${taskColor} ${
        task.done ? 'is-complete' : ''
      } ${togglePulse ? `is-pulse-${togglePulse}` : ''} ${
        isColorOpen ? 'is-color-open' : ''
      }`}
      style={{ '--row-delay': `${Math.min(index, 8) * 18}ms` } as CSSProperties}
    >
      <button
        type="button"
        className="check-button"
        aria-label={task.done ? `将${task.title}标记为未完成` : `完成${task.title}`}
        onClick={toggleTaskDone}
      >
        {task.done ? <Check size={13} /> : <Circle size={13} />}
      </button>
      <div className="task-body">
        {isEditing ? (
          <input
            className="task-edit-input"
            aria-label={`编辑${task.title}`}
            value={draft}
            autoFocus
            onBlur={commitRename}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitRename()
              }

              if (event.key === 'Escape') {
                cancelRename()
              }
            }}
          />
        ) : (
          <strong className={task.done ? 'is-done' : ''}>{task.title}</strong>
        )}
        {hasTaskDetails ? (
          <span>
            {visibleMeta}
            {task.kind === 'event' ? (
              <em className="task-kind-pill">事件</em>
            ) : null}
            {reminderLabel ? (
              <em className="task-reminder">
                <Bell size={10} />
                {reminderLabel}
              </em>
            ) : null}
            {task.source?.type === 'gmail' && task.source.url ? (
              <a
                className="task-source-link"
                href={task.source.url}
                rel="noreferrer"
                target="_blank"
                onClick={(event) => event.stopPropagation()}
              >
                Gmail
              </a>
            ) : null}
          </span>
        ) : null}
        {showProgress ? (
          <div className="task-progress-control">
            <label>
              <span>进度</span>
              <input
                type="number"
                min="0"
                max="100"
                inputMode="numeric"
                aria-label={`长期任务${task.title}进度`}
                value={taskProgress}
                onChange={(event) =>
                  onProgress?.(task.id, Number(event.target.value))
                }
              />
              <span>%</span>
            </label>
            <div
              className="task-progress-track"
              role="progressbar"
              aria-label={`${task.title}完成进度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={taskProgress}
            >
              <span style={{ width: `${taskProgress}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      <div className="row-actions">
        {onRename ? (
          <button
            type="button"
            className="edit-button"
            data-tooltip="编辑"
            aria-label={`编辑${task.title}`}
            onClick={() => {
              setDraft(task.title)
              setIsEditing(true)
            }}
          >
            <Pencil size={13} />
          </button>
        ) : null}
        {onColor ? (
          <button
            type="button"
            className={`color-button task-color-${taskColor}`}
            data-tooltip="颜色"
            aria-label={`颜色：${taskColorLabel(taskColor)}。点击更改`}
            aria-expanded={isColorOpen}
            onClick={() => setIsColorOpen((current) => !current)}
          >
            <span className="task-color-swatch" aria-hidden="true" />
          </button>
        ) : null}
        {showReminder ? (
          <button
            type="button"
            className={`reminder-button ${task.reminderAt ? 'is-set' : ''}`}
            data-tooltip={task.reminderAt ? '已设置提醒' : '提醒'}
            aria-label={
              task.reminderAt
                ? `提醒时间为${reminderLabel}。点击修改`
                : `为${task.title}添加提醒`
            }
            onClick={() => onReminder?.(task.id)}
          >
            {task.reminderAt ? <BellRing size={13} /> : <Bell size={13} />}
          </button>
        ) : null}
        <button
          type="button"
          className="delete-button"
          data-tooltip="删除"
          aria-label={`删除${task.title}`}
          aria-expanded={isDeleteConfirmOpen}
          onClick={requestDelete}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {onColor && isColorOpen ? (
        <div className="task-color-popover">
          <TaskColorPalette
            value={taskColor}
            onChange={(nextColor) => {
              onColor(task.id, nextColor)
              setIsColorOpen(false)
            }}
          />
        </div>
      ) : null}
      {isDeleteConfirmOpen ? (
        <div
          className="delete-confirm-popover"
          role="alertdialog"
          aria-label={`确认删除${task.title}`}
        >
          <span>删除任务？</span>
          <div>
            <button
              type="button"
              onClick={() => setIsDeleteConfirmOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={() => onDelete?.(task.id)}
            >
              删除
            </button>
          </div>
        </div>
      ) : null}
    </article>
  )
}, areTaskRowsEqual)

function areTaskRowsEqual(
  previous: {
    task: Task
    index?: number
  },
  next: {
    task: Task
    index?: number
  },
) {
  return previous.task === next.task && previous.index === next.index
}

export default App
