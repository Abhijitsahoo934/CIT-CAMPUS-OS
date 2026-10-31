'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createAppServer } = require('../server');

let server;
let baseUrl;

before(async () => {
  server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

test('serves the application and reports auth service health', async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);

  for (const asset of ['/styles.css', '/tailwind-config.js', '/data.js', '/auth.js', '/app.js']) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 200, `${asset} should be available`);
    assert.ok((await response.text()).length > 0, `${asset} should not be empty`);
  }

  const health = await fetch(`${baseUrl}/api/health`);
  const healthBody = await health.json();
  assert.equal(healthBody.status, 'ok');
  assert.equal(typeof healthBody.supabaseConfigured, 'boolean');
});

test('rejects invalid credentials and unknown accounts', async () => {
  for (const credentials of [
    { email: 'admin@cit.edu.in', password: 'wrong-password' },
    { email: 'unknown@cit.edu.in', password: 'password123' }
  ]) {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'Invalid email or password.');
  }
});

test('rejects JSON request bodies that are not objects', async () => {
  const login = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'null'
  });
  assert.equal(login.status, 400);
  assert.equal((await login.json()).error, 'Request body must be a JSON object.');

  const authenticated = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@cit.edu.in', password: 'password123' })
  });
  const cookie = authenticated.headers.get('set-cookie').split(';', 1)[0];
  const save = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: 'null'
  });
  assert.equal(save.status, 400);
  assert.equal((await save.json()).error, 'Request body must be a JSON object.');
});

test('authenticates on the server, ignores submitted roles, and clears sessions on logout', async () => {
  const login = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@cit.edu.in',
      password: 'password123',
      role: 'club',
      remember: true
    })
  });
  assert.equal(login.status, 200);
  const { user } = await login.json();
  assert.equal(user.role, 'admin');
  assert.equal(user.email, 'admin@cit.edu.in');

  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=2592000/);
  const cookiePair = cookie.split(';', 1)[0];

  const session = await fetch(`${baseUrl}/api/session`, {
    headers: { Cookie: cookiePair }
  });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.role, 'admin');

  const logout = await fetch(`${baseUrl}/api/logout`, {
    method: 'POST',
    headers: { Cookie: cookiePair }
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);

  const expiredSession = await fetch(`${baseUrl}/api/session`, {
    headers: { Cookie: cookiePair }
  });
  assert.equal(expiredSession.status, 401);
});

test('rejects cross-origin login attempts', async () => {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://attacker.example'
    },
    body: JSON.stringify({ email: 'admin@cit.edu.in', password: 'password123' })
  });
  assert.equal(response.status, 403);
});

test('requires a valid signed-in session before allowing database state access', async () => {
  const read = await fetch(`${baseUrl}/api/state`);
  assert.equal(read.status, 401);

  const write = await fetch(`${baseUrl}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: {} })
  });
  assert.equal(write.status, 401);
});

test('loads and upserts shared application state through the private Supabase server key', async () => {
  let storedRecord = null;
  const upstreamRequests = [];
  const databaseServer = createAppServer({
    supabaseUrl: 'https://campusflow-test.supabase.co',
    supabaseServiceRoleKey: 'server-only-test-key',
    fetch: async (url, options) => {
      upstreamRequests.push({ url, options });
      assert.equal(options.headers.apikey, 'server-only-test-key');
      assert.equal(options.headers.Authorization, 'Bearer server-only-test-key');
      if (options.method === 'POST') {
        storedRecord = JSON.parse(options.body);
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify(storedRecord ? [{ state: storedRecord.state }] : []), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  await new Promise(resolve => databaseServer.listen(0, '127.0.0.1', resolve));
  const databaseUrl = `http://127.0.0.1:${databaseServer.address().port}`;

  try {
    const login = await fetch(`${databaseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@cit.edu.in', password: 'password123' })
    });
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const initial = await fetch(`${databaseUrl}/api/state`, { headers: { Cookie: cookie } });
    assert.deepEqual(await initial.json(), { state: null });

    const state = {
      data: { sessions: [], rooms: [] },
      schedule: { sessions: [] },
      proposedSchedule: { sessions: [] },
      activeDisruption: null,
      proposalStatus: 'pending_approval',
      simulatedConflicts: []
    };
    const save = await fetch(`${databaseUrl}/api/state`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state })
    });
    assert.equal(save.status, 200);
    assert.deepEqual(await save.json(), { status: 'saved' });
    assert.equal(storedRecord.id, 'main');
    assert.equal(storedRecord.updated_by, 'U-ADMIN');

    const loaded = await fetch(`${databaseUrl}/api/state`, { headers: { Cookie: cookie } });
    assert.deepEqual(await loaded.json(), { state });
    assert.equal(upstreamRequests.length, 3);
    assert.equal(new URL(upstreamRequests[1].url).searchParams.get('on_conflict'), 'id');
  } finally {
    await new Promise((resolve, reject) => {
      databaseServer.close(error => error ? reject(error) : resolve());
    });
  }
});
