import { expect, test } from '@playwright/test'

const viewports = [
  { height: 900, name: 'desktop', width: 1280 },
  { height: 780, name: 'narrow', width: 420 },
  { height: 480, name: 'short', width: 900 },
] as const

test('中文任务栏、设置和长期任务可用', async ({ page }) => {
  await page.goto('/?open=1')

  await expect(page).toHaveTitle(/todobar/i)
  await expect(page.getByText('每日计划').first()).toBeVisible()
  await expect(page.locator('#today-heading')).toBeVisible()
  await expect(page.locator('.task-row')).not.toHaveCount(0)
  await expect(
    page.locator('#today-section').getByLabel('添加任务', { exact: true }),
  ).toBeVisible()

  const taskTitles = page.locator('.task-row .task-body strong')
  await expect(taskTitles.first()).toHaveCSS('white-space', 'normal')
  await expect(taskTitles.first()).toHaveCSS('text-overflow', 'clip')
  await expect(
    page.locator('.task-row .task-body > span').filter({ hasText: '今天' }),
  ).toHaveCount(0)

  await page.getByRole('button', { name: '侧栏设置' }).click()
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible()
  await expect(page.getByText('显示已完成', { exact: true })).toBeVisible()
  await expect(page.getByText('通知', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '连接器' })).toHaveCount(0)
  await page.getByRole('button', { name: '关闭设置' }).click()

  const longTermSection = page.locator('.long-term-section')
  await expect(longTermSection).toBeVisible()
  await longTermSection.getByLabel('添加长期任务').fill('跨设备同步准备')
  await longTermSection.getByRole('button', { name: '添加任务' }).click()
  await expect(longTermSection.getByText('跨设备同步准备', { exact: true })).toBeVisible()

  const todayQuickAdd = page.locator(
    'section[aria-labelledby="today-heading"] .quick-add',
  )
  await todayQuickAdd.getByLabel(/选择任务颜色/).click()
  const redChoice = page.getByRole('button', { name: '红色', exact: true })
  await expect(redChoice).toBeVisible()
  await redChoice.click()
})

for (const viewport of viewports) {
  test(`任务栏布局保持在${viewport.name}视口内`, async ({ page }) => {
    await page.setViewportSize({
      height: viewport.height,
      width: viewport.width,
    })
    await page.goto('/?open=1')

    const sidebar = page.locator('.todo-sidebar')
    const handle = page.locator('.edge-handle')

    await expect(sidebar).toBeVisible()
    await expect(handle).toBeVisible()
    await expect(page.getByRole('separator', { name: '调整面板大小' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '侧栏设置' })).toBeVisible()
    await expect.poll(async () =>
      page.locator('.sidebar-rail button').evaluateAll((buttons) =>
        buttons.every((button) => {
          const rect = button.getBoundingClientRect()
          return Math.round(rect.width) === Math.round(rect.height)
        }),
      ),
    ).toBe(true)

    const sidebarBox = await sidebar.boundingBox()
    const handleBox = await handle.boundingBox()
    const documentWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    )

    expect(sidebarBox).not.toBeNull()
    expect(handleBox).not.toBeNull()
    expect(documentWidth).toBeLessThanOrEqual(viewport.width + 2)

    if (sidebarBox && handleBox) {
      expect(sidebarBox.x).toBeGreaterThanOrEqual(-1)
      expect(sidebarBox.x + sidebarBox.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(handleBox.x).toBeGreaterThanOrEqual(-1)
      expect(handleBox.x + handleBox.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(handleBox.y).toBeGreaterThanOrEqual(-1)
      expect(handleBox.y + handleBox.height).toBeLessThanOrEqual(viewport.height + 1)
    }
  })
}

test('原生关闭状态保留实色任务面板和圆角贴边按钮', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 442 })
  await page.goto('/?runtime=tauri')

  const path = await page.locator('.native-dock-surface path').getAttribute('d')

  expect(path).toContain('C')
  expect(path).toContain('Q 42')
  await expect(page.locator('.todo-sidebar')).toHaveCSS(
    'background-color',
    'rgb(252, 252, 251)',
  )
  await expect(page.locator('.native-dock-surface')).toHaveClass(/is-closed/)
  await expect(page.locator('.edge-handle')).toHaveCSS(
    'border-top-left-radius',
    '16px',
  )
  await expect(page.locator('.edge-handle')).toHaveCSS(
    'border-top-right-radius',
    '0px',
  )
})

test('原生左侧停靠把按钮放在外侧', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 442 })
  await page.goto('/?runtime=tauri&dock=left')

  const path = await page.locator('.native-dock-surface path').getAttribute('d')

  expect(path).toContain('C')
  expect(path).toContain('Q 392')
  await expect(page.locator('.edge-handle')).toHaveCSS(
    'border-top-left-radius',
    '0px',
  )
  await expect(page.locator('.edge-handle')).toHaveCSS(
    'border-top-right-radius',
    '16px',
  )
})

test('原生顶部停靠保留较宽的贴边按钮', async ({ page }) => {
  await page.setViewportSize({ height: 500, width: 900 })
  await page.goto('/?runtime=tauri&dock=top')

  await expect(page.locator('.native-dock-surface path')).toHaveAttribute('d', /Q/)
  await expect(page.locator('.edge-handle')).toHaveCSS(
    'border-top-left-radius',
    '0px',
  )
  await expect(page.locator('.edge-handle')).toHaveCSS(
    'border-bottom-left-radius',
    '16px',
  )
  await expect(page.locator('.todo-sidebar')).toHaveCSS('width', '800px')
})

test('悬停显示模式的触发区域只占贴边按钮宽度', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'todobar.sidebar.settings.v27',
      JSON.stringify({
        dockEdge: 'right',
        handleHeight: 84,
        panelWidth: 400,
        tabVisibility: 'hover',
        tabWidth: 42,
      }),
    )
  })
  await page.setViewportSize({ height: 900, width: 442 })

  await page.goto('/?runtime=tauri&dock=right')
  await expect(page.locator('.workspace')).toHaveClass(/tab-hover/)
  await expect(page.locator('.edge-hover-zone')).toHaveCSS('left', '0px')
  await expect(page.locator('.edge-hover-zone')).toHaveCSS('width', '42px')

  await page.goto('/?runtime=tauri&dock=left')
  await expect(page.locator('.edge-hover-zone')).toHaveCSS('left', '392px')
  await expect(page.locator('.edge-hover-zone')).toHaveCSS('width', '42px')

  await page.goto('/?runtime=tauri&dock=top')
  await expect(page.locator('.edge-hover-zone')).toHaveCSS('top', '400px')
  await expect(page.locator('.edge-hover-zone')).toHaveCSS('height', '42px')
})
