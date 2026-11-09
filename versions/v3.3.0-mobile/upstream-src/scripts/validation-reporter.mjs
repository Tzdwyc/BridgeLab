import { writeFileSync } from 'node:fs';
export default class ValidationReporter {
  onInit(ctx) { this.ctx = ctx; }
  onFinished(files, errors = []) {
    const serialize = error => ({ message: error.message ?? String(error), stack: error.stack ?? null });
    const stateErrors = this.ctx?.state?.getUnhandledErrors?.() ?? [];
    writeFileSync('artifacts/v036-unit-unhandled.json', JSON.stringify({
      finishedAt: new Date().toISOString(), files: files.length,
      errors: errors.map(serialize), stateErrors: stateErrors.map(serialize)
    }, null, 2));
  }
}
