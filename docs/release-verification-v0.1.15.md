# Release Verification v0.1.15

This page records the public `v0.1.15` Windows portable release for the Chinese daily plan build.

## Release

- Repository: https://github.com/kobong1965/daily-plan-todobar
- Release: https://github.com/kobong1965/daily-plan-todobar/releases/tag/v0.1.15
- Windows asset: `daily-plan-todobar-v0.1.15-windows-x64.zip`

The archive contains `每日计划.exe` and a short usage note. It is a portable build and does not include local tasks, settings, account sessions, or credentials.

## Checks

```powershell
npm run verify
npm run lint
npm run build
```

The Windows archive SHA-256 is recorded in the release notes after upload.