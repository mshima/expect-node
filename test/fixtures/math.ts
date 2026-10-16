import { double } from './double.ts';

export const quadruple = (value: number): number => double(double(value));
