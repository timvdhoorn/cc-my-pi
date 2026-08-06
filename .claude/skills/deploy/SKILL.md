---
name: deploy
description: Deploy and release cc-my-pi to GitHub, npm and pi.dev. Use when user asks to deploy, publish, release, bump version, or ship cc-my-pi.
---

# Deploy cc-my-pi

Guide user through every release. Never skip GitHub tag/release.

## 1. Inspect

```bash
git status --short --branch
git log -3 --oneline
npm whoami
```

Stop when working tree has unrelated changes. Explain what blocks release.

## 2. Verify

Run both:

```bash
npm run typecheck
npm test
npm pack --dry-run
```

Check `package.json` `files` allowlist includes every shipped source file.

## 3. Version + changelog

Choose semver with user:

- patch: fixes, docs, small UI changes
- minor: new functionality
- major: breaking changes

Update `CHANGELOG.md` first. Add newest dated section with `Added`, `Changed`, `Fixed`, or `Removed`. Then run:

```bash
npm version X.Y.Z --no-git-tag-version
```

Confirm package.json and package-lock.json match.

## 4. Commit + GitHub release

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m "chore: release X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin master --follow-tags
gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes
```

Verify:

```bash
gh release view vX.Y.Z
```

A version bump without annotated tag and GitHub Release is incomplete.

## 5. npm publish — user confirmation required

Tell user exact command. Do not publish silently; npm may require OTP:

```bash
npm publish --access public
```

After user runs it, verify:

```bash
npm view cc-my-pi version
```

## 6. Final report

Report version, commit, tag, GitHub Release URL, npm version, checks, and any remaining manual step. Never claim npm published without `npm view` confirmation.
