export type Task = {
  id: number
  title: string
  meta: string
  /** Kept only so tasks saved by older builds can still be read safely. */
  priority?: 'focus' | 'normal' | 'later'
  color?: TaskColor
  /** Completion percentage used by long-term tasks. */
  progress?: number
  kind?: 'task' | 'event'
  reminderAt?: string
  source?: {
    from?: string
    threadId?: string
    type: 'gmail'
    url?: string
  }
  done?: boolean
}

export type TaskColor = 'red' | 'gold' | 'purple' | 'blue' | 'white'

export const TASK_COLOR_OPTIONS: Array<{ value: TaskColor; label: string }> = [
  { value: 'red', label: '红色' },
  { value: 'gold', label: '金色' },
  { value: 'purple', label: '紫色' },
  { value: 'blue', label: '蓝色' },
  { value: 'white', label: '白色' },
]

export const initialToday: Task[] = [
  {
    id: 1,
    title: '设计侧栏框架',
    meta: '今天 · 40 分钟',
    color: 'red',
  },
  {
    id: 2,
    title: '制作桌面快捷方式原型',
    meta: '今天 · 原生入口',
    color: 'gold',
  },
  {
    id: 3,
    title: '整理收件箱',
    meta: '快速添加',
    color: 'white',
    done: true,
  },
]

export const monthPlan: Task[] = [
  {
    id: 4,
    title: '开源项目路线图',
    meta: '五月 · 里程碑 0.1',
    color: 'purple',
  },
  {
    id: 5,
    title: '稍后处理',
    meta: '先记录想法，不急着完成',
    color: 'blue',
  },
]

export const longTermTask: Task = {
  id: 6,
  title: '长期任务',
  meta: '长期 · 持续推进',
  color: 'purple',
}
