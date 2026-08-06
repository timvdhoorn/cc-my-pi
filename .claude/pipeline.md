deploy_mode: manual
deploy_target: GitHub Release + npm
prod_url: https://www.npmjs.com/package/cc-my-pi
version_file: package.json
release_files: package.json package-lock.json CHANGELOG.md
check_cmd: npm run typecheck
test_cmd: npm test
install_cmd: npm install
changelog_cmd: manual
lock_name: cc-my-pi-release

## Release pipeline

Release runs through explicit CLI steps: annotated Git tag and push, GitHub Release creation, then public npm publication.

## Scoped commands

- `node --test --experimental-strip-types <test-files>`
