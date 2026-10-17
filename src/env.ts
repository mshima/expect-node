/**
 * The variables of the environment by which the bin (cli.ts) gives the test processes, which inherit them, what its
 * options and the configuration change in them.
 */
export const ENV = {
  /** `all`, `new` or `none`, the snapshots written (see snapshots.ts): `all` by `--update-snapshot`. */
  updateSnapshot: 'UPDATE_SNAPSHOT',
  /** `true`, the `this` of mocha (see mocha.ts), by `mocha`. */
  mocha: 'EXNODE_MOCHA',
  /** The setup files, as JSON (see setup.ts), by `setupFiles`. */
  setupFiles: 'EXNODE_SETUP_FILES',
  /** The socket of the queue of the test files of the workers (see pool.ts and worker.ts), by `workers`. */
  worker: 'EXNODE_WORKER',
} as const;
