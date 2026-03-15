import { mock } from 'node:test';

export class ExitSignal extends Error {
  constructor(public readonly code?: number) {
    super(`process.exit(${code})`);
  }
}

export function mockProcessExit() {
  return mock.method(process, 'exit', ((code?: number) => {
    throw new ExitSignal(code);
  }) as typeof process.exit);
}
