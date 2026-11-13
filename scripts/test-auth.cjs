#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const sourceDir = path.resolve(__dirname, '..');
const backendDir = path.join(sourceDir, 'backend');
const dllPath = path.join(backendDir, 'bin', 'Release', 'net8.0', 'Quiz_TanHoa.Api.dll');
const testRoot = path.resolve(sourceDir, '.tmp-tests');
const initialPassword = 'QuizTanHoa_Test_123!';
const demoPassword = 'TanHoa@2026!';
const ownedDataDirectories = [];
const pass = (message) => console.log(`PASS ${message}`);
let dataDir;
let server;
let origin;
let serverLog = '';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(route, { token, body, method = body === undefined ? 'GET' : 'POST' } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${origin}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
}

async function startServer({ password = initialPassword, demo = false, seedInitialOrganization = false, temporaryPassword } = {}) {
  origin = `http://127.0.0.1:${await freePort()}`;
  const env = {
    ...process.env,
    ASPNETCORE_URLS: origin,
    ASPNETCORE_ENVIRONMENT: 'Production',
    QUIZ_TANHOA_DATA_DIR: dataDir,
    QUIZ_TANHOA_SEED_DEMO: String(demo),
    QUIZ_TANHOA_SEED_INITIAL_ORGANIZATION: String(seedInitialOrganization),
    DOTNET_NOLOGO: '1',
  };
  if (password === null) delete env.QUIZ_TANHOA_ADMIN_PASSWORD;
  else env.QUIZ_TANHOA_ADMIN_PASSWORD = password;
  if (temporaryPassword === undefined) delete env.QUIZ_TANHOA_INITIAL_PASSWORD;
  else env.QUIZ_TANHOA_INITIAL_PASSWORD = temporaryPassword;
  delete env.QUIZ_TANHOA_JWT_KEY;
  delete env.QUIZ_TANHOA_WEB_ROOT;
  serverLog = '';
  const child = spawn(process.env.DOTNET_HOST_PATH || 'dotnet', [dllPath], {
    cwd: backendDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  server = child;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    serverLog = (serverLog + chunk.toString()).slice(-6000);
  });
  let launchError;
  child.once('error', (error) => { launchError = error; });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (launchError) throw new Error(`Cannot start dotnet: ${launchError.code || 'process launch failed'}`);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Backend exited before ready: ${serverLog}`);
    try {
      if ((await request('/api/health')).ok) return;
    } catch { /* The process may still be binding its HTTP listener. */ }
    await delay(100);
  }
  throw new Error(`Backend did not become ready within 20 seconds: ${serverLog}`);
}

async function stopServer() {
  const child = server;
  server = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  let stopped = await Promise.race([exited.then(() => true), delay(3000).then(() => false)]);
  if (!stopped) {
    child.kill('SIGKILL');
    stopped = await Promise.race([exited.then(() => true), delay(3000).then(() => false)]);
  }
  if (!stopped) throw new Error('Could not stop the owned backend process.');
}

function signToken(key, payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const unsigned = `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${unsigned}.${crypto.createHmac('sha256', key).update(unsigned).digest('base64url')}`;
}

function assertSanitized(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    assert.ok(key === 'mustChangePassword' || !/password|hash|secret|signingkey|revokedat/i.test(key), `Response exposes credential/session field ${key}`);
    assertSanitized(item);
  }
}

function assertProfile(profile, username, role, isDemo) {
  assert.equal(profile.username, username);
  assert.equal(profile.role, role);
  assert.equal(profile.isDemo, isDemo);
  assert.equal(profile.mustChangePassword, false);
  assert.equal(typeof profile.fullName, 'string');
  assert.ok(profile.fullName.length > 0);
  assert.ok(Number.isFinite(Date.parse(profile.expiresAt)), 'Profile has a valid session expiry');
  assertSanitized(profile);
}

async function login(username, password = demoPassword, extra = {}) {
  const response = await request('/api/Auth/login', { body: { username, password, ...extra } });
  assert.equal(response.status, 200, `Login ${username}: ${response.status}`);
  return response.json();
}

function inDatabase(action) {
  const database = new DatabaseSync(path.join(dataDir, 'quiz_tanhoa.db'));
  try { return action(database); } finally { database.close(); }
}

function newDataDirectory() {
  const directory = fs.mkdtempSync(path.join(testRoot, 'auth-'));
  ownedDataDirectories.push(directory);
  return directory;
}

async function run() {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Use Node.js 24 or newer (node:sqlite integration checks).');
  assert.ok(fs.existsSync(dllPath), 'Build backend first: dotnet build backend/Quiz_TanHoa.Api.csproj -c Release');
  fs.mkdirSync(testRoot, { recursive: true });
  dataDir = newDataDirectory();
  await startServer();

  const health = await (await request('/api/health')).json();
  assert.equal(health.application, 'Quiz_TanHoa');
  assert.equal(health.status, 'ok');
  const publicConfig = await (await request('/api/system/public')).json();
  assert.equal(publicConfig.timeZone, 'Asia/Ho_Chi_Minh');
  assert.equal(publicConfig.demoEnabled, false);
  assert.ok(!publicConfig.demoAccounts?.length);
  assert.ok(Number.isFinite(Date.parse(publicConfig.serverTimeUtc)));
  assertSanitized(publicConfig);
  assert.equal((await request('/api/Auth/login', { body: { username: 'organizer.demo', password: demoPassword } })).status, 401);
  pass('normal initialization has Vietnam timezone and does not seed demo credentials');

  for (const route of ['/api/Auth/me', '/api/organizer/overview', '/api/organizer/users', '/api/candidate/overview']) {
    assert.equal((await request(route)).status, 401, `${route} must require authentication`);
  }
  assert.equal((await request('/api/Auth/logout', { method: 'POST' })).status, 401);
  assert.equal((await request('/api/Auth/login', { body: {} })).status, 400);
  assert.equal((await request('/api/Auth/login', { body: { username: 'admin', password: 'incorrect-fixture' } })).status, 401);
  assert.equal((await request('/api/Auth/login', { body: { username: 'admin', password: 'á'.repeat(37) } })).status, 400);
  assert.equal((await request('/api/Auth/register', { body: { username: 'self', password: initialPassword, role: 'Organizer' } })).status, 404);
  assert.equal((await request('/api/does-not-exist')).status, 404);
  pass('anonymous access, invalid credentials, UTF-8 password limits and absent self-registration are enforced');

  const admin = await login(' ADMIN ', initialPassword);
  assertProfile(admin, 'admin', 'Organizer', false);
  assert.equal(admin.token.split('.').length, 3);
  const me = await request('/api/Auth/me', { token: admin.token });
  assert.equal(me.status, 200);
  assertProfile(await me.json(), 'admin', 'Organizer', false);
  const keyFile = path.join(dataDir, 'jwt.key');
  const persistedKey = fs.readFileSync(keyFile, 'utf8').trim();
  assert.equal(Buffer.from(persistedKey, 'base64').length, 64);
  const originalClaims = JSON.parse(Buffer.from(admin.token.split('.')[1], 'base64url'));
  const now = Math.floor(Date.now() / 1000);
  for (const [description, token] of [
    ['wrong signature', signToken(crypto.randomBytes(64).toString('base64'), originalClaims)],
    ['expired token', signToken(persistedKey, { ...originalClaims, nbf: now - 600, exp: now - 120 })],
    ['wrong issuer', signToken(persistedKey, { ...originalClaims, iss: 'Another_Application' })],
    ['wrong audience', signToken(persistedKey, { ...originalClaims, aud: 'Another_Application' })],
    ['missing server session', signToken(persistedKey, { ...originalClaims, jti: crypto.randomUUID() })],
  ]) assert.equal((await request('/api/Auth/me', { token })).status, 401, description);
  pass('JWT signature, expiry, issuer, audience and persisted server session are checked');

  await stopServer();
  await startServer({ password: 'DifferentSeedPassword_456!', demo: true });
  assert.equal(fs.readFileSync(keyFile, 'utf8').trim(), persistedKey);
  assert.equal((await request('/api/Auth/me', { token: admin.token })).status, 200);
  await login('admin', initialPassword);
  assert.equal((await request('/api/Auth/login', { body: { username: 'admin', password: 'DifferentSeedPassword_456!' } })).status, 401);
  const demos = await (await request('/api/system/public')).json();
  assert.equal(demos.demoEnabled, true);
  assert.deepEqual(demos.demoAccounts.map((item) => item.username).sort(), ['organizer.demo', 'thisinh.demo']);
  assertSanitized(demos);
  const organizer = await login('organizer.demo');
  const candidate = await login('thisinh.demo', demoPassword, { role: 'Organizer', isAdmin: true });
  assertProfile(organizer, 'organizer.demo', 'Organizer', true);
  assertProfile(candidate, 'thisinh.demo', 'Candidate', true);
  pass('restart preserves passwords, signing key and live sessions; demo accounts are explicitly enabled and marked');

  const overview = await request('/api/organizer/overview', { token: organizer.token });
  assert.equal(overview.status, 200);
  const overviewBody = await overview.json();
  assert.equal(overviewBody.timeZone, 'Asia/Ho_Chi_Minh');
  assert.equal(overviewBody.userCount, 3);
  assert.equal(overviewBody.candidateCount, 1);
  assert.equal(overviewBody.organizerCount, 2);
  assert.equal(overviewBody.demoUserCount, 2);
  const usersResponse = await request('/api/organizer/users', { token: organizer.token });
  assert.equal(usersResponse.status, 200);
  const users = await usersResponse.json();
  assert.ok(Array.isArray(users));
  assert.equal(users.length, 3);
  assert.equal(users.filter((user) => user.isDemo).length, 2);
  assertSanitized(users);
  const candidateAccount = users.find((user) => user.username === 'thisinh.demo');
  const accountUpdate = await request(`/api/organizer/users/${candidateAccount.id}`, {
    token: organizer.token,
    method: 'PUT',
    body: { fullName: 'Thí sinh đã cập nhật', department: 'Phòng Kinh tế', isActive: true, role: 'Organizer', username: 'admin' },
  });
  assert.equal(accountUpdate.status, 200);
  assert.deepEqual(
    (({ id, username, fullName, department, role, isActive }) => ({ id, username, fullName, department, role, isActive }))(await accountUpdate.json()),
    { id: candidateAccount.id, username: 'thisinh.demo', fullName: 'Thí sinh đã cập nhật', department: 'Phòng Kinh tế', role: 'Candidate', isActive: true },
  );
  assert.equal((await request(`/api/organizer/users/${candidateAccount.id}`, { token: candidate.token, method: 'PUT', body: { fullName: 'Không có quyền', department: '', isActive: true } })).status, 403);
  assert.equal((await request(`/api/organizer/users/${candidateAccount.id}`, { token: organizer.token, method: 'PUT', body: { fullName: ' ', department: '', isActive: true } })).status, 400);
  const organizerAccount = users.find((user) => user.username === 'organizer.demo');
  assert.equal((await request(`/api/organizer/users/${organizerAccount.id}`, { token: organizer.token, method: 'PUT', body: { fullName: 'Ban Tổ chức', department: '', isActive: false } })).status, 400);
  assert.equal((await request('/api/organizer/users', { token: organizer.token }).then(response => response.json())).find(user => user.username === 'admin').role, 'Organizer');
  const createdAccountResponse = await request('/api/organizer/users', {
    token: organizer.token,
    body: { username: 'created.candidate', fullName: 'Thí sinh mới', department: 'Phòng Kinh tế' },
  });
  assert.equal(createdAccountResponse.status, 201);
  assert.match(createdAccountResponse.headers.get('location'), /\/api\/organizer\/users\/\d+$/);
  const createdAccount = await createdAccountResponse.json();
  assert.equal(createdAccount.role, 'Candidate');
  assert.equal(createdAccount.isActive, true);
  assert.equal(createdAccount.isDemo, false);
  assertSanitized(createdAccount);
  assert.equal((await request('/api/organizer/users', { token: organizer.token, body: {
    username: 'created.candidate', fullName: 'Trùng tên đăng nhập', department: '',
  } })).status, 409);
  const newCandidate = await login('created.candidate', '123456');
  assert.equal(newCandidate.mustChangePassword, true);
  assert.equal((await request(`/api/organizer/users/${createdAccount.id}`, { token: organizer.token, method: 'DELETE' })).status, 204);
  assert.equal((await request('/api/candidate/overview', { token: newCandidate.token })).status, 401);
  assert.equal((await request(`/api/organizer/users/${organizerAccount.id}`, { token: organizer.token, method: 'DELETE' })).status, 409);
  pass('organizers can create, update and delete candidate accounts; new accounts use a forced-change temporary password and deletion preserves protected roles');
  assert.equal((await request('/api/candidate/overview', { token: candidate.token })).status, 200);
  assert.equal((await request('/api/organizer/overview', { token: candidate.token })).status, 403);
  assert.equal((await request('/api/organizer/users', { token: candidate.token })).status, 403);
  assert.equal((await request('/api/candidate/overview', { token: organizer.token })).status, 403);
  assert.equal((await request('/api/Auth/me', { token: candidate.token })).status, 200);
  const candidateClaims = JSON.parse(Buffer.from(candidate.token.split('.')[1], 'base64url'));
  for (const claimName of Object.keys(candidateClaims).filter((name) => /role$/i.test(name))) candidateClaims[claimName] = 'Organizer';
  assert.equal((await request('/api/organizer/overview', { token: signToken(persistedKey, candidateClaims) })).status, 403);
  pass('both roles have exclusive server permissions; login-body and JWT role spoofing cannot elevate access');

  inDatabase((db) => db.prepare('UPDATE Users SET Role = ? WHERE Username = ?').run('Candidate', 'organizer.demo'));
  assert.equal((await request('/api/organizer/overview', { token: organizer.token })).status, 403);
  assert.equal((await request('/api/candidate/overview', { token: organizer.token })).status, 200);
  assert.equal((await (await request('/api/Auth/me', { token: organizer.token })).json()).role, 'Candidate');
  inDatabase((db) => db.prepare('UPDATE Users SET Role = ? WHERE Username = ?').run('Organizer', 'organizer.demo'));
  inDatabase((db) => db.prepare('UPDATE Users SET IsActive = 0 WHERE Username = ?').run('thisinh.demo'));
  assert.equal((await request('/api/candidate/overview', { token: candidate.token })).status, 401);
  inDatabase((db) => db.prepare('UPDATE Users SET IsActive = 1, Role = ? WHERE Username = ?').run('UnknownRole', 'thisinh.demo'));
  assert.equal((await request('/api/Auth/me', { token: candidate.token })).status, 401);
  inDatabase((db) => db.prepare('UPDATE Users SET Role = ? WHERE Username = ?').run('Candidate', 'thisinh.demo'));
  const deletionFixture = inDatabase((db) => {
    const passwordHash = db.prepare('SELECT Password FROM Users WHERE Username = ?').get('admin').Password;
    db.prepare('INSERT INTO Users (Username,Password,FullName,Role,IsActive,IsDemo) VALUES (?,?,?,?,1,0)').run('deleted.fixture', passwordHash, 'Tài khoản kiểm tra xóa', 'Candidate');
    return 'deleted.fixture';
  });
  const deletedLogin = await login(deletionFixture, initialPassword);
  inDatabase((db) => db.prepare('DELETE FROM Users WHERE Username = ?').run(deletionFixture));
  assert.equal((await request('/api/candidate/overview', { token: deletedLogin.token })).status, 401);
  pass('database role changes take effect immediately; locked, deleted and unknown-role accounts fail closed');

  assert.equal((await request('/api/Auth/logout', { token: candidate.token, method: 'POST' })).status, 200);
  assert.equal((await request('/api/Auth/me', { token: candidate.token })).status, 401);
  assert.equal((await request('/api/candidate/overview', { token: candidate.token })).status, 401);
  assert.equal((await request('/api/Auth/me', { token: organizer.token })).status, 200);
  pass('logout revokes the exact server session without affecting another user');

  const legacyPasswordHash = inDatabase((db) => db.prepare('SELECT Password FROM Users WHERE Username = ?').get('admin').Password);
  await stopServer();
  dataDir = newDataDirectory();
  inDatabase((db) => {
    db.exec('CREATE TABLE Users (Id INTEGER NOT NULL CONSTRAINT PK_Users PRIMARY KEY AUTOINCREMENT, Username TEXT COLLATE NOCASE NOT NULL, Password TEXT NOT NULL, FullName TEXT NOT NULL, Role TEXT NOT NULL, IsActive INTEGER NOT NULL); CREATE UNIQUE INDEX IX_Users_Username ON Users (Username);');
    db.prepare('INSERT INTO Users (Username,Password,FullName,Role,IsActive) VALUES (?,?,?,?,1)').run('admin', legacyPasswordHash, 'Cán bộ hiện có', 'Admin');
  });
  await startServer({ password: 'DifferentLegacyPassword_456!' });
  const migrated = await login('admin', initialPassword);
  assertProfile(migrated, 'admin', 'Organizer', false);
  assert.equal(migrated.fullName, 'Cán bộ hiện có');
  assert.equal((await request('/api/organizer/overview', { token: migrated.token })).status, 200);
  const migratedColumns = inDatabase((db) => db.prepare('PRAGMA table_info(Users)').all().map((column) => column.name));
  assert.ok(migratedColumns.includes('IsDemo'));
  await stopServer();
  await startServer();
  await login('admin', initialPassword);
  pass('legacy database upgrades preserve existing users/passwords and are safe to repeat');

  await stopServer();
  dataDir = newDataDirectory();
  await startServer({ password: null, seedInitialOrganization: true, temporaryPassword: '123456' });
  const initialData = inDatabase((db) => ({
    users: db.prepare('SELECT COUNT(*) AS count FROM Users').get().count,
    candidates: db.prepare("SELECT COUNT(*) AS count FROM Users WHERE Role = 'Candidate'").get().count,
    organizers: db.prepare("SELECT COUNT(*) AS count FROM Users WHERE Role = 'Organizer'").get().count,
    forcedChange: db.prepare('SELECT COUNT(*) AS count FROM Users WHERE MustChangePassword = 1').get().count,
    units: db.prepare('SELECT COUNT(*) AS count FROM OrganizationUnits').get().count,
    questions: db.prepare('SELECT COUNT(*) AS count FROM ExamQuestions').get().count,
    bankQuestions: db.prepare('SELECT COUNT(*) AS count FROM QuestionBankQuestions WHERE IsActive = 1').get().count,
    linkedQuestions: db.prepare('SELECT COUNT(*) AS count FROM ExamQuestions WHERE BankQuestionId IS NOT NULL').get().count,
    schemaVersion: { ...db.prepare('SELECT Version FROM SchemaVersions WHERE Version = 9').get() },
    questionBankSchemaVersion: { ...db.prepare('SELECT Version FROM SchemaVersions WHERE Version = 10').get() },
    exam: { ...db.prepare('SELECT IsDemo,TargetQuestionCount,CommonQuestionCount,SpecializedQuestionCount,CurrentApprovedVersionId FROM Exams').get() },
  }));
  assert.deepEqual(initialData, {
    users: 46, candidates: 45, organizers: 1, forcedChange: 46, units: 9, questions: 50, bankQuestions: 50, linkedQuestions: 50,
    schemaVersion: { Version: 9 },
    questionBankSchemaVersion: { Version: 10 },
    exam: { IsDemo: 1, TargetQuestionCount: 50, CommonQuestionCount: 50, SpecializedQuestionCount: 0, CurrentApprovedVersionId: null },
  });
  await stopServer();
  inDatabase((db) => {
    db.prepare('UPDATE ExamQuestions SET BankQuestionId = NULL').run();
    db.prepare('DELETE FROM QuestionBankQuestions').run();
    db.prepare('DELETE FROM SchemaVersions WHERE Version = 10').run();
  });
  await startServer({ password: null, seedInitialOrganization: true, temporaryPassword: '123456' });
  const migratedQuestionCount = inDatabase((db) => ({
    bank: db.prepare('SELECT COUNT(*) AS count FROM QuestionBankQuestions WHERE IsActive = 1').get().count,
    linked: db.prepare('SELECT COUNT(*) AS count FROM ExamQuestions WHERE BankQuestionId IS NOT NULL').get().count,
  }));
  assert.deepEqual(migratedQuestionCount, { bank: 50, linked: 50 });
  await stopServer();
  await startServer({ password: null, seedInitialOrganization: true, temporaryPassword: '123456' });
  assert.equal(inDatabase((db) => db.prepare('SELECT COUNT(*) AS count FROM QuestionBankQuestions WHERE IsActive = 1').get().count), 50);
  pass('legacy demo questions migrate into the bank once and retain links across restarts without duplicating');
  const initialOrganizer = await login('ngochung.pvhxh', '123456');
  assert.equal(initialOrganizer.mustChangePassword, true);
  assert.equal((await request('/api/Auth/me', { token: initialOrganizer.token }).then(response => response.json())).mustChangePassword, true);
  assert.equal((await request('/api/organizer/organization-units', { token: initialOrganizer.token })).status, 403);
  const rejectedPassword = await request('/api/Auth/change-password', {
    token: initialOrganizer.token,
    body: { currentPassword: '123456', newPassword: 'weakpass', confirmPassword: 'weakpass' },
  });
  assert.equal(rejectedPassword.status, 400);
  assert.match((await rejectedPassword.json()).message, /12 ký tự.*chữ thường.*chữ hoa.*chữ số.*ký tự đặc biệt/);
  const strongPassword = 'StrongOrg@2026';
  const changed = await request('/api/Auth/change-password', {
    token: initialOrganizer.token,
    body: { currentPassword: '123456', newPassword: strongPassword, confirmPassword: strongPassword },
  });
  assert.equal(changed.status, 200);
  assert.equal((await request('/api/Auth/me', { token: initialOrganizer.token })).status, 401);
  const updatedOrganizer = await login('ngochung.pvhxh', strongPassword);
  assert.equal(updatedOrganizer.mustChangePassword, false);
  const unitResponse = await request('/api/organizer/organization-units', { token: updatedOrganizer.token });
  assert.equal(unitResponse.status, 200);
  const organizationUnits = await unitResponse.json();
  assert.equal(organizationUnits.length, 9);
  assert.equal(organizationUnits[1].name, 'Phòng Văn hóa-Xã hội');
  assert.equal((await request('/api/organizer/users', { token: updatedOrganizer.token }).then(response => response.json())).length, 46);
  pass('one-time initial organization seed creates 9 units, 46 forced-change accounts and a 50-question draft; strong password change unlocks access and revokes temporary sessions');
  console.log('Authentication and role integration checks passed.');
}

run().catch((error) => {
  console.error(`FAIL ${error.stack || error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  try {
    await stopServer();
    for (const directory of ownedDataDirectories) {
      const target = path.resolve(directory);
      assert.equal(path.dirname(target), testRoot, 'Refusing cleanup outside test directory.');
      assert.ok(path.basename(target).startsWith('auth-'), 'Refusing cleanup of unexpected directory.');
      await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  } catch (error) {
    console.error(`FAIL integration cleanup: ${error.message}`);
    process.exitCode = 1;
  }
});
