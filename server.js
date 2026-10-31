'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');

function loadEnvironmentFile() {
  const envFile = path.join(__dirname, '.env');
  if (!fs.existsSync(envFile)) return;
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) return;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    process.env[match[1]] = value;
  });
}

loadEnvironmentFile();

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_COOKIE = 'campusflow_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 8192;
const MAX_STATE_BODY_BYTES = 2 * 1024 * 1024;
const DEMO_PASSWORD = process.env.CAMPUSFLOW_DEMO_PASSWORD || 'password123';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (process.env.NODE_ENV === 'production' && !process.env.CAMPUSFLOW_DEMO_PASSWORD) {
  throw new Error('Set CAMPUSFLOW_DEMO_PASSWORD before starting in production.');
}
if (process.env.NODE_ENV === 'production' && DEMO_PASSWORD.length < 12) {
  throw new Error('CAMPUSFLOW_DEMO_PASSWORD must contain at least 12 characters in production.');
}

const profiles = [
  { id: 'U-ADMIN', email: 'admin@cit.edu.in', name: 'Prof. Shreya Kapoor', initials: 'SK', title: 'Dean of Academics (Admin)', role: 'admin', roleLabel: 'Admin', department: 'ADMIN', faculty_id: 'F37', requester_name: 'Spectra Core Team' },
  { id: 'U-COORD-CSE', email: 'coord.cse@cit.edu.in', name: 'Dr. Ananya Mishra', initials: 'AM', title: 'CSE Department Coordinator', role: 'department_coordinator', roleLabel: 'Dept. Coordinator', department: 'CSE', faculty_id: 'F01', requester_name: 'Training and Placement Cell' },
  { id: 'U-FAC-F07', email: 'f07@cit.edu.in', name: 'Dr. Pooja Das', initials: 'PD', title: 'Associate Professor, CSE (F07)', role: 'faculty', roleLabel: 'Faculty', department: 'CSE', faculty_id: 'F07', requester_name: 'Dr. Pooja Das (F07)' },
  { id: 'U-CLUB-DRAM', email: 'club@cit.edu.in', name: 'Aarav Mohanty', initials: 'DR', title: 'Secretary, Dramatics Society', role: 'club', roleLabel: 'Club Representative', department: 'CLUB', faculty_id: null, requester_name: 'Dramatics Society' }
];

const sessions = new Map();
const loginAttempts = new Map();
const demoSalt = crypto.randomBytes(16);
const demoPasswordHash = crypto.scryptSync(DEMO_PASSWORD, demoSalt, 64);
const dummySalt = crypto.randomBytes(16);
const dummyPasswordHash = crypto.scryptSync(crypto.randomBytes(32), dummySalt, 64);
const accounts = profiles.map(profile => ({
  ...profile,
  salt: demoSalt,
  passwordHash: demoPasswordHash
}));

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(JSON.stringify(body));
}

function parseCookies(header = '') {
  const cookies = {};
  header.split(';').forEach(part => {
    const separator = part.indexOf('=');
    if (separator < 0) return;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = value;
  });
  return cookies;
}

function publicProfile(profile) {
  const { salt, passwordHash, ...safeProfile } = profile;
  return safeProfile;
}

function getSession(request) {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function setSessionCookie(response, token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const maxAge = maxAgeSeconds === null ? '' : `; Max-Age=${maxAgeSeconds}`;
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/${maxAge}${secure}`);
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function hasSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    const expectedProtocol = process.env.NODE_ENV === 'production' ? 'https:' : 'http:';
    return parsedOrigin.host === request.headers.host && parsedOrigin.protocol === expectedProtocol;
  } catch {
    return false;
  }
}

async function readJson(request) {
  return readJsonWithLimit(request, MAX_BODY_BYTES);
}

async function readJsonWithLimit(request, maxBytes) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('Request body must be a JSON object.');
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function isSupabaseConfigured(url = SUPABASE_URL, key = SUPABASE_SERVICE_ROLE_KEY) {
  if (!url || !key) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

async function supabaseRequest(pathname, options = {}, config) {
  if (!isSupabaseConfigured(config.url, config.serviceRoleKey)) {
    const error = new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.');
    error.statusCode = 503;
    throw error;
  }

  const fetchRequest = config.fetch || fetch;
  const response = await fetchRequest(`${config.url}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const detail = await response.text();
    let supabaseError;
    try {
      supabaseError = JSON.parse(detail);
    } catch {
      supabaseError = null;
    }
    const error = new Error(`Supabase request failed (${response.status}).`);
    error.statusCode = 502;
    error.supabaseCode = supabaseError && supabaseError.code;
    error.supabaseMessage = supabaseError && supabaseError.message;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

function isValidAppState(state) {
  return Boolean(
    state &&
    typeof state === 'object' &&
    !Array.isArray(state) &&
    state.data &&
    Array.isArray(state.data.sessions) &&
    Array.isArray(state.data.rooms) &&
    state.schedule &&
    Array.isArray(state.schedule.sessions) &&
    state.proposedSchedule &&
    Array.isArray(state.proposedSchedule.sessions) &&
    (state.activeDisruption === null || typeof state.activeDisruption === 'object') &&
    typeof state.proposalStatus === 'string' &&
    Array.isArray(state.simulatedConflicts)
  );
}

function isRateLimited(ip) {
  const attempt = loginAttempts.get(ip);
  if (!attempt) return false;
  if (attempt.blockedUntil && attempt.blockedUntil > Date.now()) return true;
  if (attempt.blockedUntil && attempt.blockedUntil <= Date.now()) loginAttempts.delete(ip);
  return false;
}

function recordFailedLogin(ip) {
  const attempt = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  attempt.count += 1;
  if (attempt.count >= 5) {
    attempt.count = 0;
    attempt.blockedUntil = Date.now() + 15 * 60 * 1000;
  }
  loginAttempts.set(ip, attempt);
}

function resetLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

function verifyPassword(password, account) {
  const salt = account ? account.salt : dummySalt;
  const expectedHash = account ? account.passwordHash : dummyPasswordHash;
  return scrypt(password, salt, expectedHash.length).then(actualHash =>
    crypto.timingSafeEqual(actualHash, expectedHash)
  );
}

async function handleApi(request, response, pathname, supabaseConfig) {
  if (pathname === '/api/health' && request.method === 'GET') {
    sendJson(response, 200, {
      status: 'ok',
      supabaseConfigured: isSupabaseConfigured(supabaseConfig.url, supabaseConfig.serviceRoleKey)
    });
    return;
  }

  if (pathname === '/api/session' && request.method === 'GET') {
    const session = getSession(request);
    if (!session) {
      sendJson(response, 401, { error: 'Authentication required.' });
      return;
    }
    sendJson(response, 200, { user: publicProfile(session.user) });
    return;
  }

  if (pathname === '/api/state' && request.method === 'GET') {
    const session = getSession(request);
    if (!session) {
      sendJson(response, 401, { error: 'Authentication required.' });
      return;
    }
    const records = await supabaseRequest(
      'campusflow_app_state?id=eq.main&select=state',
      {},
      supabaseConfig
    );
    sendJson(response, 200, { state: records.length ? records[0].state : null });
    return;
  }

  if (pathname === '/api/state' && request.method === 'PUT') {
    if (!hasSameOrigin(request)) {
      sendJson(response, 403, { error: 'Cross-origin requests are not allowed.' });
      return;
    }
    const session = getSession(request);
    if (!session) {
      sendJson(response, 401, { error: 'Authentication required.' });
      return;
    }
    const body = await readJsonWithLimit(request, MAX_STATE_BODY_BYTES);
    if (!isValidAppState(body.state)) {
      sendJson(response, 400, { error: 'Invalid application state payload.' });
      return;
    }
    await supabaseRequest('campusflow_app_state?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: 'main',
        state: body.state,
        updated_by: session.user.id,
        updated_at: new Date().toISOString()
      })
    }, supabaseConfig);
    sendJson(response, 200, { status: 'saved' });
    return;
  }

  if (pathname === '/api/login' && request.method === 'POST') {
    if (!hasSameOrigin(request)) {
      sendJson(response, 403, { error: 'Cross-origin requests are not allowed.' });
      return;
    }
    const ip = request.socket.remoteAddress || 'unknown';
    if (isRateLimited(ip)) {
      sendJson(response, 429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' });
      return;
    }
    const body = await readJson(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password || email.length > 254 || password.length > 1024) {
      sendJson(response, 400, { error: 'Enter a valid email address and password.' });
      return;
    }
    const account = accounts.find(candidate => candidate.email.toLowerCase() === email);
    const passwordMatches = await verifyPassword(password, account);
    if (!account || !passwordMatches) {
      recordFailedLogin(ip);
      sendJson(response, 401, { error: 'Invalid email or password.' });
      return;
    }

    resetLoginAttempts(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    const remember = body.remember === true;
    const ttl = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
    sessions.set(token, { user: account, expiresAt: Date.now() + ttl });
    setSessionCookie(response, token, remember ? Math.floor(ttl / 1000) : null);
    sendJson(response, 200, { user: publicProfile(account) });
    return;
  }

  if (pathname === '/api/logout' && request.method === 'POST') {
    if (!hasSameOrigin(request)) {
      sendJson(response, 403, { error: 'Cross-origin requests are not allowed.' });
      return;
    }
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (token) sessions.delete(token);
    clearSessionCookie(response);
    sendJson(response, 200, { status: 'signed_out' });
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'API route not found.' });
    return;
  }
  sendJson(response, 405, { error: 'Method not allowed.' }, { Allow: 'GET' });
}

const staticFiles = new Map([
  ['/', ['cit_campusflow_one_campus_one_schedule_zero_conflicts.html', 'text/html; charset=utf-8']],
  ['/index.html', ['cit_campusflow_one_campus_one_schedule_zero_conflicts.html', 'text/html; charset=utf-8']],
  ['/cit_campusflow_one_campus_one_schedule_zero_conflicts.html', ['cit_campusflow_one_campus_one_schedule_zero_conflicts.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/tailwind-config.js', ['tailwind-config.js', 'text/javascript; charset=utf-8']],
  ['/data.js', ['data.js', 'text/javascript; charset=utf-8']],
  ['/auth.js', ['auth.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
]);

function serveStatic(response, pathname) {
  const file = staticFiles.get(pathname);
  if (!file) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  const [filename, contentType] = file;
  const absolutePath = path.join(ROOT, filename);
  fs.readFile(absolutePath, (error, content) => {
    if (error) {
      console.error(`Unable to serve ${filename}:`, error);
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Unable to load application file.');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    response.end(content);
  });
}

function createRequestHandler(options = {}) {
  const supabaseConfig = {
    url: options.supabaseUrl || SUPABASE_URL,
    serviceRoleKey: options.supabaseServiceRoleKey || SUPABASE_SERVICE_ROLE_KEY,
    fetch: options.fetch
  };
  return (request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
    } catch {
      sendJson(response, 400, { error: 'Invalid request URL.' });
      return;
    }

    if (pathname.startsWith('/api/')) {
      handleApi(request, response, pathname, supabaseConfig).catch(error => {
        if (response.headersSent) {
          response.destroy(error);
          return;
        }
        sendJson(response, error.statusCode || 500, {
          error: error.statusCode === 400 || error.statusCode === 413 || error.statusCode === 503
            ? error.message
            : error.supabaseMessage
              ? `Supabase database error${error.supabaseCode ? ` (${error.supabaseCode})` : ''}: ${error.supabaseMessage}`
              : 'The server could not complete the request.'
        });
        if (!error.statusCode || error.statusCode === 502) console.error('API request failed:', error);
      });
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }
    serveStatic(response, pathname);
  };
}

function createAppServer(options = {}) {
  const handler = createRequestHandler(options);
  return http.createServer(handler);
}

if (require.main === module) {
  const server = createAppServer();
  server.listen(PORT, HOST, () => {
    console.log(`CIT CampusFlow is running at http://${HOST}:${PORT}`);
    console.log('Demo accounts: admin@cit.edu.in, coord.cse@cit.edu.in, f07@cit.edu.in, club@cit.edu.in');
    if (process.env.NODE_ENV !== 'production') {
      console.log('Demo-only shared password: configure CAMPUSFLOW_DEMO_PASSWORD to change it.');
    }
    console.log(`Supabase persistence: ${isSupabaseConfigured() ? 'configured' : 'not configured (using browser-only demo state)'}`);
  });
}

module.exports = { createAppServer, createRequestHandler, handleApi };
