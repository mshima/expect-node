/** The configuration of a run of expect-node (see cli.ts), in an expect-node.config.ts (or .mts, .js, .mjs) of the cwd. */
export type Config = {
  /** The test files, by glob patterns from the cwd: the default patterns of node:test when none. */
  files?: string[];
  /**
   * Modules each test file imports first, and the workers it starts, by their path from the cwd: hooks of its own, an
   * alias of a package to its sources. Given to them by their absolute path, a worker starting in another folder.
   */
  import?: string[];
  /** The timeout of each test and hook, in milliseconds. */
  timeout?: number;
  /** The test files run at once: true for as many as node:test chooses. */
  concurrency?: number | boolean;
  /** Run once in the runner before the test files, which inherit its environment: a temporary folder they share. */
  setup?: () => unknown;
  /**
   * The reporters, `<name>[:<file>]`: of node:test (spec, tap, dot, junit, lcov) or the path of a module of one, to
   * the terminal or to the file; `spec` to the terminal when none. The `--reporter` of the bin replaces them.
   */
  reporters?: string[];
  /** The coverage of a run with --coverage: the files it is measured on, and its minimum in percents. */
  coverage?: { include?: string[]; exclude?: string[]; lines?: number; branches?: number; functions?: number };
};

/** The configuration of expect-node, typed. */
export const defineConfig = (config: Config): Config => config;
