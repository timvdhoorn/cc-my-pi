deploy_mode: manual
deploy_target: GitHub Release + npm
prod_url: https://www.npmjs.com/package/cc-my-pi
version_file: package.json
release_files: package.json package-lock.json CHANGELOG.md
check_cmd: npm run typecheck
test_cmd: npm test
install_cmd: npm install
changelog_cmd: manual
readme_whats_new: true
github_release: true
npm_publish: true
lock_name: cc-my-pi-release

## Release pipeline

Release runs through explicit CLI steps: update the plain-language latest-version README section, create an annotated Git tag and push, create the GitHub Release from the matching changelog section, then run `npm publish --access public` for `cc-my-pi`. Verify both remote versions before reporting success.

## Scoped commands

- `node --test --experimental-strip-types <test-files>`
