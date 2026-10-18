/**
 * The variables of the environment by which the bin (cli.ts) gives the test processes, which inherit them, what its
 * options and the configuration change in them.
 */
export const ENV = {
  /** `all`, `new` or `none`, the snapshots written (see snapshots.ts): `all` by `--update-snapshot`. */
  updateSnapshot: 'UPDATE_SNAPSHOT',
  /** The compatibility of the tests (see compatibility.ts), by `compatibility`. */
  compatibility: 'EXNODE_COMPATIBILITY',
  /** The timeout of the configuration, which the timeouts of mocha start from (see mocha.ts), by `timeout`. */
  timeout: 'EXNODE_TIMEOUT',
  /** `true`, the modules imported again after a mock (see mocks.ts), by `reimport`. */
  reimport: 'EXNODE_REIMPORT',
  /** The setup files and the modules of mocha hooks, as JSON (see setup.ts), by `setupFiles` and `mochaHooks`. */
  setup: 'EXNODE_SETUP',
  /** The socket of the queue of the test files of the workers (see pool.ts and worker.ts), by `workers`. */
  worker: 'EXNODE_WORKER',
} as const;
