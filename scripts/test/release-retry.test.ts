import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const releaseDir = join(import.meta.dirname, '..', 'release');
const hasPlutil = process.platform === 'darwin' && spawnSync('plutil', ['-help']).error === undefined;

const FAKE_TOOL = `#!/usr/bin/env bash
set -euo pipefail
key="$(printf '%s' "$(basename "$0") \${1:-} \${2:-}" | tr -c 'A-Za-z0-9' '-')"
count=$(( $(cat "$FAKE_RESPONSES/$key.count" 2>/dev/null || echo 0) + 1 ))
echo "$count" >"$FAKE_RESPONSES/$key.count"
echo "$key $*" >>"$FAKE_RESPONSES/calls"
response="$FAKE_RESPONSES/$key.$count"
[ -e "$response.code" ] || response="$FAKE_RESPONSES/$key.default"
[ -e "$response.code" ] || { echo "fake: no response for $key #$count" >&2; exit 99; }
cat "$response.out"
cat "$response.err" >&2
exit "$(cat "$response.code")"
`;

const STAPLER_LOST = [
  'Processing: /tmp/Codevo Whisper.app',
  'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost." UserInfo={NSErrorFailingURLStringKey=https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup}',
  "CloudKit's response is inconsistent with expections: (null)",
  'The staple and validate action failed! Error 68.',
].join('\n');
const STAPLER_NOT_FOUND = 'Processing: /tmp/Codevo Whisper.app\nCould not find base64 encoded ticket in response\nThe staple and validate action failed! Error 65.';
const NOTARY_OFFLINE =
  'Error: HTTPError(statusCode: nil, error: Error Domain=NSURLErrorDomain Code=-1009 "The Internet connection appears to be offline." UserInfo={NSLocalizedDescription=The Internet connection appears to be offline.})';
const SUBMISSION = '2b1c9e7a-1111-2222-3333-444455556666';

type Response = { code?: number; out?: string; err?: string };

let workDir = '';
let responses = '';
let bin = '';

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'cw-release-retry-'));
  responses = join(workDir, 'responses');
  bin = join(workDir, 'bin');
  mkdirSync(responses);
  mkdirSync(bin);
  for (const tool of ['xcrun', 'spctl']) {
    writeFileSync(join(bin, tool), FAKE_TOOL);
    chmodSync(join(bin, tool), 0o755);
  }
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function keyOf(command: string): string {
  return command.replace(/[^A-Za-z0-9]/g, '-');
}

function respond(command: string, attempt: number | 'default', { code = 0, out = '', err = '' }: Response): void {
  const base = join(responses, `${keyOf(command)}.${attempt}`);
  writeFileSync(`${base}.code`, `${code}\n`);
  writeFileSync(`${base}.out`, out === '' ? '' : `${out}\n`);
  writeFileSync(`${base}.err`, err === '' ? '' : `${err}\n`);
}

function calls(command: string): string[] {
  const log = (() => {
    try {
      return readFileSync(join(responses, 'calls'), 'utf8');
    } catch {
      return '';
    }
  })();
  return log.split('\n').filter((line) => line.startsWith(`${keyOf(command)} `));
}

function run(script: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(join(releaseDir, script), args, {
    cwd: workDir,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env['PATH'] ?? ''}`,
      HOME: workDir,
      FAKE_RESPONSES: responses,
      RETRY_DELAY_SECONDS: '0',
      APPLE_API_KEY: join(workDir, 'AuthKey.p8'),
      APPLE_API_KEY_ID: 'KEYID',
      APPLE_API_ISSUER: 'issuer',
      ...env,
    },
  });
}

const info = (status: string): string => JSON.stringify({ id: SUBMISSION, status, name: 'app.zip' });

describe('retry.sh', () => {
  it('retries a stapler network failure and passes on the next attempt', () => {
    respond('xcrun stapler staple', 1, { code: 68, out: STAPLER_LOST });
    respond('xcrun stapler staple', 2, { out: 'The staple and validate action worked!' });

    const result = run('retry.sh', ['stapler', 'xcrun', 'stapler', 'staple', 'App.app']);

    expect(result.status).toBe(0);
    expect(calls('xcrun stapler staple')).toHaveLength(2);
    expect(result.stdout).toBe('The staple and validate action worked!\n');
    expect(result.stderr).toContain('Error 68');
    expect(result.stderr).toContain('attempt 1/6');
  });

  it('fails a stapler error that is not a network error without retrying', () => {
    respond('xcrun stapler validate', 'default', { code: 65, out: STAPLER_NOT_FOUND });

    const result = run('retry.sh', ['stapler', 'xcrun', 'stapler', 'validate', 'App.app']);

    expect(result.status).toBe(65);
    expect(calls('xcrun stapler validate')).toHaveLength(1);
    expect(result.stdout).toContain('Error 65');
    expect(result.stderr).not.toContain('retry:');
  });

  it('gives up after the configured number of attempts', () => {
    respond('xcrun stapler validate', 'default', { code: 68, out: STAPLER_LOST });

    const result = run('retry.sh', ['stapler', 'xcrun', 'stapler', 'validate', 'App.app'], { RETRY_ATTEMPTS: '3' });

    expect(result.status).toBe(68);
    expect(calls('xcrun stapler validate')).toHaveLength(3);
    expect(result.stderr).toContain('attempt 2/3');
    expect(result.stderr).toContain('after 3 attempts, giving up');
  });

  it('does not treat a stapler Error 68 as transient for plain network commands', () => {
    respond('xcrun stapler validate', 'default', { code: 68, out: 'The validate action failed! Error 68.' });

    const result = run('retry.sh', ['network', 'xcrun', 'stapler', 'validate', 'App.app']);

    expect(result.status).toBe(68);
    expect(calls('xcrun stapler validate')).toHaveLength(1);
  });

  it('does not retry an HTTP error with a status code from notarytool', () => {
    respond('xcrun notarytool info', 'default', { code: 1, err: 'Error: HTTPError(statusCode: 401, error: Unauthenticated)' });

    const result = run('retry.sh', ['network', 'xcrun', 'notarytool', 'info', SUBMISSION]);

    expect(result.status).toBe(1);
    expect(calls('xcrun notarytool info')).toHaveLength(1);
  });

  it('never retries a submit that already printed a submission id', () => {
    respond('xcrun notarytool submit', 'default', { code: 1, out: JSON.stringify({ id: SUBMISSION, message: 'upload interrupted' }), err: NOTARY_OFFLINE });

    const result = run('retry.sh', ['submit', 'xcrun', 'notarytool', 'submit', 'app.zip']);

    expect(result.status).toBe(1);
    expect(calls('xcrun notarytool submit')).toHaveLength(1);
    expect(result.stdout).toContain(SUBMISSION);
  });

  it('rejects an unknown kind', () => {
    expect(run('retry.sh', ['other', 'xcrun', 'stapler', 'staple', 'App.app']).status).toBe(2);
    expect(calls('xcrun stapler staple')).toHaveLength(0);
  });
});

describe('verify-notarization.sh', () => {
  it('retries the online gatekeeper assessment after a network error', () => {
    respond('spctl --assess --type', 1, { code: 3, err: `App.app: ${NOTARY_OFFLINE}` });
    respond('spctl --assess --type', 2, { err: 'App.app: accepted\nsource=Notarized Developer ID' });
    respond('spctl --assess --type', 3, { err: 'app.dmg: accepted\nsource=Notarized Developer ID' });
    respond('xcrun stapler validate', 1, { code: 68, out: STAPLER_LOST });
    respond('xcrun stapler validate', 'default', { out: 'The validate action worked!' });

    const result = run('verify-notarization.sh', ['App.app', 'app.dmg']);

    expect(result.status).toBe(0);
    expect(calls('spctl --assess --type')).toHaveLength(3);
    expect(calls('xcrun stapler validate')).toHaveLength(3);
  });

  it('fails a gatekeeper rejection without retrying', () => {
    respond('spctl --assess --type', 'default', { code: 3, err: 'App.app: rejected\nsource=Unnotarized Developer ID' });

    const result = run('verify-notarization.sh', ['App.app', 'app.dmg']);

    expect(result.status).toBe(1);
    expect(calls('spctl --assess --type')).toHaveLength(1);
    expect(result.stderr).toContain('was rejected by spctl');
  });
});

describe.runIf(hasPlutil)('notary-wait.sh', () => {
  it('keeps waiting on the same submission after the network drops', () => {
    respond('xcrun notarytool wait', 1, { code: 1, err: NOTARY_OFFLINE });
    respond('xcrun notarytool wait', 2, { out: 'Processing complete\n  status: Accepted' });
    respond('xcrun notarytool info', 1, { code: 1, err: NOTARY_OFFLINE });
    respond('xcrun notarytool info', 2, { out: info('Accepted') });

    const result = run('notary-wait.sh', [SUBMISSION], { NOTARY_TIMEOUT: '10m' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`notarization ${SUBMISSION} accepted`);
    expect(result.stderr).toContain('lost the network');
    const waits = calls('xcrun notarytool wait');
    expect(waits).toHaveLength(2);
    expect(waits.every((call) => call.includes(SUBMISSION))).toBe(true);
    const timeouts = waits.map((call) => Number(/--timeout (\d+)s/.exec(call)?.[1]));
    expect(timeouts[0]).toBeLessThanOrEqual(600);
    expect(timeouts[1]).toBeLessThanOrEqual(timeouts[0] ?? 0);
    expect(calls('xcrun notarytool info')).toHaveLength(2);
  });

  it('fails an Invalid submission right away and prints the notary log', () => {
    respond('xcrun notarytool wait', 'default', { code: 1, out: 'Processing complete\n  status: Invalid' });
    respond('xcrun notarytool info', 'default', { out: info('Invalid') });
    respond('xcrun notarytool log', 'default', { out: '{"issues":[{"message":"The signature of the binary is invalid."}]}' });

    const result = run('notary-wait.sh', [SUBMISSION], { NOTARY_TIMEOUT: '10m' });

    expect(result.status).toBe(1);
    expect(calls('xcrun notarytool wait')).toHaveLength(1);
    expect(calls('xcrun notarytool log')).toHaveLength(1);
    expect(result.stderr).toContain('The signature of the binary is invalid.');
    expect(result.stderr).toContain('ended with status Invalid');
  });

  it('stops after the overall timeout when the network never comes back', () => {
    respond('xcrun notarytool wait', 'default', { code: 1, err: NOTARY_OFFLINE });
    respond('xcrun notarytool info', 'default', { out: info('In Progress') });

    const result = run('notary-wait.sh', [SUBMISSION], { NOTARY_TIMEOUT: '2s', RETRY_DELAY_SECONDS: '1' });

    expect(result.status).toBe(75);
    expect(result.stderr).toContain('still In Progress after 2s');
    expect(calls('xcrun notarytool wait').length).toBeGreaterThanOrEqual(1);
    expect(calls('xcrun notarytool wait').length).toBeLessThanOrEqual(3);
  });

  it('rejects a malformed timeout before calling notarytool', () => {
    const result = run('notary-wait.sh', [SUBMISSION], { NOTARY_TIMEOUT: '1h30m' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NOTARY_TIMEOUT must be');
    expect(calls('xcrun notarytool wait')).toHaveLength(0);
  });
});

describe.runIf(hasPlutil)('notary-submit.sh', () => {
  it('retries a submit that failed on the network before any submission id was returned', () => {
    writeFileSync(join(workDir, 'app.zip'), 'zip');
    respond('xcrun notarytool submit', 1, { code: 1, err: NOTARY_OFFLINE });
    respond('xcrun notarytool submit', 2, { out: JSON.stringify({ id: SUBMISSION, message: 'Successfully uploaded file' }) });

    const result = run('notary-submit.sh', [join(workDir, 'app.zip')]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${SUBMISSION}\n`);
    expect(calls('xcrun notarytool submit')).toHaveLength(2);
  });
});

describe.runIf(hasPlutil)('staple-app.sh', () => {
  it('waits, staples and validates through transient CloudKit failures', () => {
    const state = join(workDir, 'state');
    mkdirSync(state);
    writeFileSync(join(state, 'app.zip'), 'zip');
    execFileSync('node', [join(releaseDir, 'notary-state-cli.ts'), 'record', state, 'app', SUBMISSION, 'app.zip']);
    respond('xcrun notarytool wait', 'default', { out: 'Processing complete\n  status: Accepted' });
    respond('xcrun notarytool info', 'default', { out: info('Accepted') });
    respond('xcrun stapler staple', 1, { code: 68, out: STAPLER_LOST });
    respond('xcrun stapler staple', 2, { out: 'The staple and validate action worked!' });
    respond('xcrun stapler validate', 1, { code: 68, out: 'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."\nThe validate action failed! Error 68.' });
    respond('xcrun stapler validate', 2, { out: 'The validate action worked!' });

    const result = run('staple-app.sh', ['arm64', state], { NOTARY_TIMEOUT: '10m' });

    expect(result.status).toBe(0);
    expect(calls('xcrun stapler staple')).toHaveLength(2);
    expect(calls('xcrun stapler validate')).toHaveLength(2);
  });
});
