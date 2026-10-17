// A root hook plugin of mocha, by a path: a function giving its hooks.
const scope = globalThis;
export const mochaHooks = async () => ({
  beforeAll() {
    scope.setups = (scope.setups ?? 0) + 1;
  },
});
