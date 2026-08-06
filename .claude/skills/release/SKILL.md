---
name: release
description: Release a new version of cc-my-pi to npm, GitHub and pi.dev. Use when the user says "release", "publish a new version", "cut a release", or asks to ship the current state of cc-my-pi. Canonical workflow lives in ../deploy/SKILL.md.
---

# Release cc-my-pi

Use [../deploy/SKILL.md](../deploy/SKILL.md) as canonical workflow. It includes mandatory annotated tag and GitHub Release creation, which must not be skipped.

## Preconditions

1. Working tree clean on `master` (`git status`), all feature work merged.
2. Tests green: `npm run typecheck` exits 0 and `npm test` all pass.
3. npm auth: `npm whoami` → `timvdhoorn`. Publish needs a 2FA/OTP browser step — the USER must run `npm publish` interactively (`! npm publish`); a non-interactive publish fails with EOTP.

## Steps

1. **Pick the version** (semver): features → minor, fixes only → patch. Ask if unclear.
2. **CHANGELOG.md**: move/summarize the changes since the last release under a new `## [X.Y.Z] - YYYY-MM-DD` heading (categories Added/Changed/Fixed/Removed, newest release on top, below the IMPORTANT banner). If an `## Unreleased` section exists, rename it.
3. **Bump**: `npm version X.Y.Z --no-git-tag-version` (updates package.json + package-lock.json).
4. **Sanity**: `npm pack --dry-run` — verify tarball contents look right (files list in package.json is an explicit allowlist; new source files must be added there or they won't ship).
5. **Commit + tag + push**:
   ```
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore: release X.Y.Z"
   git tag vX.Y.Z
   git push && git push --tags
   ```
6. **npm publish**: ask the user to run `! npm publish` (OTP). Verify afterwards: `npm view cc-my-pi version` → new version.
7. **GitHub release**: `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <(…)` with the new CHANGELOG section as the notes body (strip the heading line).
8. **Verify**: `gh release view vX.Y.Z` and (later) https://pi.dev/packages search "cc-my-pi".

## Notes

- The in-app update check (`extensions/update-check.ts`) notifies users of new versions by comparing against the npm registry — a version bump per release is required for it to fire.
- Local dev installs (path entry in `~/.pi/agent/settings.json`) are unaffected by npm releases; the update notice tells clone users to pull instead.
