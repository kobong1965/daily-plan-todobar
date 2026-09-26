# Release Verification v0.1.17

This page records the local v0.1.17 verification for daily must-do tasks, long-term notes, per-color swatches, and native two-monitor docking.

## Scope

- Red daily tasks carry across calendar days and reset to unfinished.
- Non-red daily tasks are cleared at the local calendar-day boundary.
- Long-term tasks keep editable notes and no longer render a progress control.
- Color swatches use the selected task color in rows and palettes.
- Open palettes render above the following long-term section.
- Native positioning prefers the monitor that owns the window, which avoids cursor-seam placement across two monitors.

## Checks

- `npm run lint`
- `npm run build`
- `npm run verify`
- `npm run test:native`
- `npm run test:smoke` with the E-drive cached Chromium executable
