import type { Session } from 'electron';

export const CONTENT_SECURITY_POLICY = "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

export function installContentSecurityPolicy(session: Session): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CONTENT_SECURITY_POLICY] },
    });
  });
}
