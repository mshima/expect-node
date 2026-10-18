import { beforeEach, it } from '../../../src/index.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The timeout of the configuration, of each test and hook: three tests within it, longer together.
beforeEach(() => sleep(5));
it('runs within the timeout of the configuration', () => sleep(60));
it('runs within it too', () => sleep(60));
it('runs within it again', () => sleep(60));
it('ends after it', () => sleep(150));
