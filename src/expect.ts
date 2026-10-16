import { expect as jestExpect } from 'expect';

import './snapshots.ts';

/** The matchers of an assertion, each failure told after the message given (`expect(value, message)` of Vitest). */
const withMessage = <T extends object>(matchers: T, message: string): T =>
  new Proxy(matchers, {
    get: (target, property, receiver) => {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value === 'object' && value !== null) return withMessage(value, message);
      // A property of the matchers that is not a matcher, like a number: as it is.
      /* node:coverage ignore next */
      if (typeof value !== 'function') return value;
      const fail = (error: unknown) => {
        if (error instanceof Error) error.message = `${message}\n\n${error.message}`;
        throw error;
      };
      return (...args: unknown[]) => {
        try {
          const result: unknown = value.apply(target, args);
          return result instanceof Promise ? result.catch(fail) : result;
        } catch (error) {
          return fail(error);
        }
      };
    },
  });

/** The expect of Jest, with the message of Vitest after the value. */
export const expect = Object.assign(
  ((actual: unknown, message?: string) =>
    message === undefined ? jestExpect(actual) : withMessage(jestExpect(actual), message)) as typeof jestExpect &
    (<T>(actual: T, message?: string) => ReturnType<typeof jestExpect<T>>),
  jestExpect,
);

declare module 'expect' {
  interface Matchers<R extends void | Promise<void>> {
    /** The value against its snapshot, in `__snapshots__/<test file>.snap` (jest-snapshot, an optional peer dependency). */
    toMatchSnapshot(propertiesOrHint?: object | string, hint?: string): R;
    /** The value against its snapshot written in the test (jest-snapshot, an optional peer dependency). */
    toMatchInlineSnapshot(propertiesOrSnapshot?: object | string, inlineSnapshot?: string): R;
    toThrowErrorMatchingSnapshot(hint?: string): R;
    toThrowErrorMatchingInlineSnapshot(inlineSnapshot?: string): R;
  }
}
