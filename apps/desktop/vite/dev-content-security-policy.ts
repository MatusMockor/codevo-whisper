import type { Plugin } from 'vite';

const META_CSP = /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/;

const DEV_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export function devContentSecurityPolicy(): Plugin {
  return {
    name: 'codevo-dev-content-security-policy',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(META_CSP, `$1${DEV_POLICY}$2`);
    },
  };
}
