// Raised when an owner-only API answers 401, so the access gate can re-verify and show sign-in.
export const APP_ACCESS_EXPIRED_EVENT = 'app-access-expired';

export function notifyAppAccessExpired(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(APP_ACCESS_EXPIRED_EVENT));
}
