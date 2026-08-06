## Release pipeline

deploy_mode: push-to-main
deploy_target: npm + GitHub Release
prod_url: https://www.npmjs.com/package/cc-my-pi
version_file: package.json
release_files: package.json, package-lock.json, CHANGELOG.md
changelog_cmd: manual
check_cmd: npm run typecheck && npm test
deploy_checklist: npm publish --access public; npm view cc-my-pi version
lock_name: cc-my-pi-release
