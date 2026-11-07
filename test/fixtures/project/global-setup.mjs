// The global setup of node:test, run once by the runner.
export const globalSetup = () => {
  process.stdout.write('the global setup ran\n');
};
