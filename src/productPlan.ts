import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  Cable,
  Command,
  Database,
  MonitorCog,
  Pin,
  ShieldCheck,
} from 'lucide-react'

export type ProductNote = {
  icon: LucideIcon
  title: string
  text: string
}

export const platformNotes: ProductNote[] = [
  {
    icon: MonitorCog,
    title: '原生外壳',
    text: '小型开源应用优先使用 Tauri；如果悬浮窗口 API 成为瓶颈，再把 Electron 作为备用方案。',
  },
  {
    icon: Pin,
    title: '随处可用的侧栏',
    text: '无边框置顶窗口可以贴靠当前显示器右侧，并记住每块屏幕的位置。',
  },
  {
    icon: Command,
    title: '全局控制',
    text: '桌面版本原生注册 Alt + T；快捷键冲突时可使用 Alt + Shift + T。',
  },
]

export const runtimeCards: ProductNote[] = [
  {
    icon: Database,
    title: '本地优先任务',
    text: '先使用本地持久化，任务模型稳定后再增加同步。',
  },
  {
    icon: Cable,
    title: 'MCP 连接器',
    text: '通过受权限控制的 MCP 适配器连接 GitHub、日历、笔记、文件或项目工具。',
  },
  {
    icon: Bot,
    title: 'AI 计划层',
    text: '让 AI 总结收件箱、拆分下一步行动并提出今天的建议，同时保留任务的真实来源。',
  },
  {
    icon: ShieldCheck,
    title: '权限边界',
    text: '每次外部读取、写入、同步或 AI 操作都需要限定权限和清晰的用户批准。',
  },
]
