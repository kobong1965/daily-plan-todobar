# Release Verification v0.1.18

This page records the local Windows verification for the long-term task visual
and note-editor update. No public release was created in this pass.

## Scope

- Long-term task rows use a vivid blue-purple gradient surface while retaining
  the selected task-color dot for classification.
- Long-term task title and metadata typography are 1.5 times the normal task
  size.
- The always-visible long-term note textarea is replaced by a compact book
  button. Clicking it opens an accessible note editor popover; the note remains
  stored in the existing task data.
- The note and color popovers close each other when switching actions, so the
  row does not show overlapping editors.
- The desktop binary and shortcut were updated in place without moving task
  data.

## Checks

- `npm run build`
- `npm run lint`
- `npm run verify`
- `npm run test:native`
- `PLAYWRIGHT_BROWSERS_PATH=E:\\Codex工作盘\\caches\\playwright npm run test:smoke`
  - 10 tests passed on Windows.
- Installed binary reports version `0.1.18` at
  `E:\\Codex工作盘\\apps\\Todobar\\todobar.exe`.
- Desktop shortcut `D:\\桌面\\每日计划 Todobar.lnk` targets the updated binary.

