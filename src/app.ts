/**
 * Application-level error class with a numeric error code.
 */
export class AppError extends Error {
  code: number;

  constructor(message: string, code: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    // Restore prototype chain (required when extending built-ins in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Initializes the application. Any unhandled errors are caught and
 * wrapped in an AppError before being logged.
 */
export function init(): void {
  try {
    // Application initialization logic goes here
  } catch (err) {
    const appError = new AppError(
      err instanceof Error ? err.message : String(err),
      1
    );
    console.error(appError);
  }
}
