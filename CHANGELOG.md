# Changelog

## [0.3.2](https://github.com/mshima/expect-node/compare/expect-node-v0.3.1...expect-node-v0.3.2) (2026-10-20)


### Features

* the longest test files first, by a file of their durations, with and without workers ([#24](https://github.com/mshima/expect-node/issues/24)) ([6b156e7](https://github.com/mshima/expect-node/commit/6b156e7bc7d762f10b8cbbb67d47106a04d042c2))

## [0.3.1](https://github.com/mshima/expect-node/compare/expect-node-v0.3.0...expect-node-v0.3.1) (2026-10-19)


### Bug Fixes

* a snapshot that does not match fails its test; the snapshots of the test file running, a shared module's test too ([#22](https://github.com/mshima/expect-node/issues/22)) ([37c7587](https://github.com/mshima/expect-node/commit/37c758744275782924eacac7de5196fc4f4eb7b5))

## [0.3.0](https://github.com/mshima/expect-node/compare/expect-node-v0.2.1...expect-node-v0.3.0) (2026-10-18)


### ⚠ BREAKING CHANGES

* the timeouts are of node:test by default. A number after the function of a test or a hook, of Vitest and Jest, fails: `compatibility: 'vitest'` or `'jest'`, or `{ timeout }` (before the function of a test, after the one of a hook). The timeout of a suite is of the whole suite, as node:test's; of each test with `compatibility: 'vitest'`.

### Features

* --forbid-only, a test or a suite declared only failing ([#18](https://github.com/mshima/expect-node/issues/18)) ([c8174d3](https://github.com/mshima/expect-node/commit/c8174d30a4609763a8a774789c608f74ec2fd8e2))
* --watch, the test files run again when they change, by node:test ([#17](https://github.com/mshima/expect-node/issues/17)) ([58990f6](https://github.com/mshima/expect-node/commit/58990f65f1d9c2e23927826a5baa99b77b52cf2d))
* a directory given to the bin, its test files ([#16](https://github.com/mshima/expect-node/issues/16)) ([8f39f65](https://github.com/mshima/expect-node/commit/8f39f65f6b04152a79c65ce8eb28ed297cbf31bb))
* compatibility, the timeouts in the format of node:test (the default), Vitest, Jest or mocha ([#15](https://github.com/mshima/expect-node/issues/15)) ([0624c1a](https://github.com/mshima/expect-node/commit/0624c1ae64a37cea3b9e8d2ddbf6f8be426d6106))
* the reimport of a mock alone, exnode.mock(specifier, exports, { reimport: true }) ([#19](https://github.com/mshima/expect-node/issues/19)) ([a64e5f8](https://github.com/mshima/expect-node/commit/a64e5f834b31760aa4415f836b0fed05c4dc2220))


### Bug Fixes

* the timeout of the configuration of each test and hook on node 22, the timeouts of .each, done of the tests of jest and mocha ([#21](https://github.com/mshima/expect-node/issues/21)) ([b238ed9](https://github.com/mshima/expect-node/commit/b238ed9caed7a28c424c0b1f04328afed54e4850))

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
