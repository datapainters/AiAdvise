/**
 * Token handling for the portal.
 *
 * The token lives in sessionStorage rather than localStorage: it is cleared
 * when the tab closes, which is the right default for a portal someone may
 * open on a shared machine. It is still readable by script on this origin, so
 * the real mitigation is the 12-hour expiry plus not having XSS.
 */
const TOKEN_KEY = 'dp.token';

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'CLIENT' | 'ADMIN';
  clientId: number | null;
  /**
   * True until a user issued a one-time password has chosen their own. The
   * server backs this up: such a token carries no CLIENT or ADMIN authority,
   * so skipping the prompt gets 403 on everything but the change itself.
   */
  mustChangePassword: boolean;
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    // Storage can throw in private modes; treat it as signed out.
    return null;
  }
}

export function setToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Non-fatal: the session simply will not survive a reload.
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing useful to do.
  }
}
