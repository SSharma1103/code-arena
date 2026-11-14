import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FirebaseSessionService, SESSION_SECONDS } from '../src/lib/auth/session.ts';

function fixture(overrides = {}) {
  const calls = [];
  const claims = { uid: 'alice', name: 'Alice', email: 'alice@example.test', auth_time: Date.now() / 1000, firebase: { sign_in_provider: 'google.com' } };
  const auth = {
    async verifyIdToken(token, revoked) { calls.push(['verify', token, revoked]); return claims; },
    async createSessionCookie(token, options) { calls.push(['create', token, options]); return 'session'; },
    async verifySessionCookie(cookie, revoked) { calls.push(['read', cookie, revoked]); return claims; },
    ...overrides,
  };
  return { service: new FirebaseSessionService(auth), calls, claims };
}

test('recent Google sign-in exchanges a verified token for a bounded session', async () => {
  const { service, calls } = fixture();
  assert.equal(await service.create('id-token'), 'session');
  assert.deepEqual(calls, [['verify', 'id-token', true], ['create', 'id-token', { expiresIn: SESSION_SECONDS * 1000 }]]);
});

test('old or non-Google credentials never create sessions', async () => {
  for (const claims of [
    { auth_time: Date.now() / 1000 - 600, firebase: { sign_in_provider: 'google.com' } },
    { auth_time: Date.now() / 1000, firebase: { sign_in_provider: 'password' } },
  ]) {
    const { service, calls } = fixture({ async verifyIdToken() { return claims; } });
    await assert.rejects(service.create('token'), /recent Google sign-in/);
    assert.equal(calls.length, 0);
  }
});

test('invalid tokens do not reach session creation', async () => {
  const { service, calls } = fixture({ async verifyIdToken() { throw new Error('invalid token'); } });
  await assert.rejects(service.create('token'));
  assert.equal(calls.length, 0);
});

test('missing, expired, revoked, and forged cookies are unauthenticated', async () => {
  const { service, calls } = fixture({ async verifySessionCookie() { throw new Error('invalid session'); } });
  assert.equal(await service.read(undefined), null);
  assert.equal(await service.read('forged'), null);
  assert.equal(calls.length, 0);
});

test('verified sessions expose only public profile data and check revocation', async () => {
  const { service, calls } = fixture();
  assert.deepEqual(await service.read('session'), { uid: 'alice', name: 'Alice', email: 'alice@example.test' });
  assert.deepEqual(calls, [['read', 'session', true]]);
});

test('the same account keeps its owner while different accounts are isolated', () => {
  const { service } = fixture();
  const alice = { uid: 'alice', name: 'Alice', email: null };
  assert.match(service.owner(alice), /^[a-f0-9]{64}$/);
  assert.equal(service.owner(alice), service.owner({ ...alice, name: 'Renamed' }));
  assert.notEqual(service.owner(alice), service.owner({ ...alice, uid: 'bob' }));
});
