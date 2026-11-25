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
  /**
   * What a staff account works on; null for a client. The server decides
   * what each role may reach -- this only saves showing links that would
   * answer 403.
   */
  teamRole: TeamRole | null;
}

export type TeamRole = 'admin' | 'billing' | 'relations' | 'engineer';

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  admin: 'Administrator',
  billing: 'Billing',
  relations: 'Client relations',
  engineer: 'Engineer',
};

/** Invoices, payments and the financial reports. */
export function seesMoney(user: User | null | undefined): boolean {
  return user?.teamRole === 'admin' || user?.teamRole === 'billing';
}

export function isTeamAdmin(user: User | null | undefined): boolean {
  return user?.teamRole === 'admin';
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
