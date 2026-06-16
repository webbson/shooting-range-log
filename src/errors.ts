import type { TFunction } from 'i18next';

// Rust commands reject with { code, message, params }. Translate the code
// (with params) into the operator's language; fall back to the English message.
interface AppErrorShape {
  code?: string;
  message?: string;
  params?: Record<string, unknown>;
}

export function errorMessage(e: unknown, t: TFunction): string {
  if (e && typeof e === 'object' && 'code' in e) {
    const err = e as AppErrorShape;
    return t(err.code as string, {
      ...(err.params ?? {}),
      defaultValue: err.message ?? (err.code as string),
    });
  }
  return String(e);
}
