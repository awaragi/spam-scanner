/** Whether a failed response should force the user back to `/login` - every
 * 401 does (expired, malformed, wrong-scope, or missing token all surface
 * as a plain 401 from the server - see `token.util.ts`'s `verifyBearerToken`
 * on the server), except a login attempt's own 401 (wrong password), which
 * is an ordinary form error the login page already handles inline. */
export function isSessionExpiredResponse(url: string, status: number): boolean {
  return status === 401 && !url.endsWith('/auth/login');
}
