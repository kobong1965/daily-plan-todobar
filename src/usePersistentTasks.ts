import { useEffect, useRef, useState } from 'react'
import type { Task } from './tasks'
import { scheduleLocalStorageWrite } from './storage'

type PersistentTasksOptions = {
  resetOnDateChange?: boolean
  carryOverTask?: (task: Task) => Task | null
}

type DailyTaskStorage = {
  dateKey: string
  tasks: Task[]
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function resetTasksForNewDate(
  tasks: Task[],
  carryOverTask?: (task: Task) => Task | null,
) {
  if (!carryOverTask) {
    return []
  }

  return tasks
    .map(carryOverTask)
    .filter((task): task is Task => task !== null)
}

function readTasks(
  seedTasks: Task[],
  storageKey: string,
  resetOnDateChange: boolean,
  dateKey: string,
  carryOverTask?: (task: Task) => Task | null,
) {
  try {
    const stored = window.localStorage.getItem(storageKey)

    if (!stored) {
      return seedTasks
    }

    const parsed = JSON.parse(stored) as Task[] | DailyTaskStorage

    if (!resetOnDateChange) {
      return Array.isArray(parsed) ? parsed : seedTasks
    }

    if (Array.isArray(parsed)) {
      // Preserve data written by older builds once, then migrate it to the
      // dated format so the next calendar day can reset it safely.
      return parsed
    }

    if (!Array.isArray(parsed.tasks)) {
      return []
    }

    if (parsed.dateKey !== dateKey) {
      return resetTasksForNewDate(parsed.tasks, carryOverTask)
    }

    return parsed.tasks
  } catch {
    return seedTasks
  }
}

export function usePersistentTasks(
  seedTasks: Task[],
  storageKey: string,
  options: PersistentTasksOptions = {},
) {
  const resetOnDateChange = options.resetOnDateChange ?? false
  const carryOverTask = options.carryOverTask
  const initialDateKey = localDateKey()
  const dateKeyRef = useRef(initialDateKey)
  const [dateKey, setDateKey] = useState(initialDateKey)
  const [tasks, setTasks] = useState<Task[]>(() => {
    return readTasks(
      seedTasks,
      storageKey,
      resetOnDateChange,
      initialDateKey,
      carryOverTask,
    )
  })

  useEffect(() => {
    if (!resetOnDateChange) {
      return undefined
    }

    const checkForDateChange = () => {
      const nextDateKey = localDateKey()

      if (nextDateKey === dateKeyRef.current) {
        return
      }

      dateKeyRef.current = nextDateKey
      setDateKey(nextDateKey)
      setTasks((current) => resetTasksForNewDate(current, carryOverTask))
    }

    const timer = window.setInterval(checkForDateChange, 30_000)
    window.addEventListener('focus', checkForDateChange)
    document.addEventListener('visibilitychange', checkForDateChange)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', checkForDateChange)
      document.removeEventListener('visibilitychange', checkForDateChange)
    }
  }, [carryOverTask, resetOnDateChange])

  useEffect(() => {
    const value = resetOnDateChange
      ? JSON.stringify({ dateKey, tasks } satisfies DailyTaskStorage)
      : JSON.stringify(tasks)

    return scheduleLocalStorageWrite(storageKey, value)
  }, [dateKey, resetOnDateChange, storageKey, tasks])

  return [tasks, setTasks] as const
}
