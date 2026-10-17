# Changelog

## [0.2.1](https://github.com/mshima/expect-node/compare/expect-node-v0.2.0...expect-node-v0.2.1) (2026-10-17)


### Bug Fixes

* the coverage whole after a mock: the modules imported before kept, and the coverage of instances merged ([#13](https://github.com/mshima/expect-node/issues/13)) ([b653fb3](https://github.com/mshima/expect-node/commit/b653fb318cfffd5f1b7c18389904d08d066ade15))

## [0.2.0](https://github.com/mshima/expect-node/compare/expect-node-v0.1.0...expect-node-v0.2.0) (2026-10-17)


### ⚠ BREAKING CHANGES

* the bin `extest` is now `exnode`, the export `extest` is now `exnode`.

### Features

* mochaHooks, the root hook plugins of mocha by their module ([#11](https://github.com/mshima/expect-node/issues/11)) ([a805766](https://github.com/mshima/expect-node/commit/a80576651e4cee54756b191c0df56060716a03f5))
* the bin and the mocks object named exnode, after the package ([#5](https://github.com/mshima/expect-node/issues/5)) ([ad32d34](https://github.com/mshima/expect-node/commit/ad32d3469a0c89acbcccf23c0d89904c402c1229))
* what a migration from esmocha needs, the this of mocha by the mocha configuration ([#8](https://github.com/mshima/expect-node/issues/8)) ([262299b](https://github.com/mshima/expect-node/commit/262299bd013186438fa32b73ebc8b0bbcef34549))
* workers, the test files by processes reused like mocha --parallel, setupFiles, and the code reorganized ([#10](https://github.com/mshima/expect-node/issues/10)) ([9333243](https://github.com/mshima/expect-node/commit/9333243ffa586081d9c7b6f025262be6ae76c54b))

## 0.1.0 (2026-10-16)


### Features

* node:test with the expect and mock API of Jest and Vitest ([b2df81a](https://github.com/mshima/expect-node/commit/b2df81a6da3b9fc26dced3bafd632d566a11ed65))
* the extest object, the vi of Vitest, the jest of Jest ([54550de](https://github.com/mshima/expect-node/commit/54550de06dff123da919447f4c783b7e7d2c04d1))
* the reporters of a run, of node:test or of a module, to the terminal or to a file ([04c3aac](https://github.com/mshima/expect-node/commit/04c3aac5356d0f86fcdb2f27d2ce88764fd9f5e5))
* the snapshots of Jest, and the mock API Jest and Vitest share ([496fc12](https://github.com/mshima/expect-node/commit/496fc12a460499eeb27d8ff9002701caa3096036))
