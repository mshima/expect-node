import { dep } from './dep.ts';

export const one = (): number => dep();
export const two = (): number => dep() + 1;
