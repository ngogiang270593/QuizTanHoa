#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const backendRoot = path.join(root, 'backend');
const dll = path.join(backendRoot, 'bin', 'Release', 'net8.0', 'Quiz_TanHoa.Api.dll');
const testsRoot = path.join(root, '.tmp-tests');
const adminPassword = 'QuizCompetition_Test_123!';
const demoPassword = 'TanHoa@2026!';
const sampleName = 'Hội thi trực tuyến tìm hiểu kiến thức, nghiệp vụ dành cho cán bộ, công chức xã Tân Hòa';
const pass = (message) => console.log(`PASS ${message}`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let dataDir;
let origin;
let backend;
let backendLog = '';

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

function request(route, { token, body, method = body === undefined ? 'GET' : 'POST' } = {}) {
  return fetch(`${origin}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
}

async function startBackend() {
  origin = `http://127.0.0.1:${await freePort()}`;
  const env = {
    ...process.env, ASPNETCORE_URLS: origin, ASPNETCORE_ENVIRONMENT: 'Production',
    QUIZ_TANHOA_DATA_DIR: dataDir, QUIZ_TANHOA_ADMIN_PASSWORD: adminPassword,
    QUIZ_TANHOA_SEED_DEMO: 'true', DOTNET_NOLOGO: '1',
  };
  delete env.QUIZ_TANHOA_JWT_KEY;
  delete env.QUIZ_TANHOA_WEB_ROOT;
  backendLog = '';
  backend = spawn(process.env.DOTNET_HOST_PATH || 'dotnet', [dll], { cwd: backendRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let spawnError;
  backend.once('error', (error) => { spawnError = error; });
  for (const stream of [backend.stdout, backend.stderr]) stream.on('data', (chunk) => { backendLog = (backendLog + chunk).slice(-6000); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (backend.exitCode !== null) throw new Error(`Backend exited: ${backendLog}`);
    try { if ((await request('/api/health')).ok) return; } catch { /* Startup is still in progress. */ }
    await delay(100);
  }
  throw new Error(`Backend did not become ready: ${backendLog}`);
}

async function stopBackend() {
  const child = backend;
  backend = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  if (!await Promise.race([stopped.then(() => true), delay(4000).then(() => false)])) throw new Error('Owned backend did not stop');
}

function inDatabase(action) {
  const db = new DatabaseSync(path.join(dataDir, 'quiz_tanhoa.db'));
  try { db.exec('PRAGMA foreign_keys = ON'); return action(db); } finally { db.close(); }
}

async function login(username, password = demoPassword) {
  const response = await request('/api/Auth/login', { body: { username, password } });
  assert.equal(response.status, 200, `Login ${username}`);
  return response.json();
}

async function json(route, token) {
  const response = await request(route, { token });
  assert.equal(response.status, 200, route);
  return response.json();
}

async function create(token, body) {
  const response = await request('/api/organizer/competitions', { token, body });
  assert.equal(response.status, 201, `Create failed: ${await response.clone().text()}`);
  return response.json();
}

async function createApprovedExam(token, competitionId) {
  const base = `/api/organizer/competitions/${competitionId}`;
  const groups = await json(`${base}/field-groups`, token);
  const response = await request(`${base}/exams`, { token, body: { name: 'Đề kiểm tra bộ lọc phân công minh họa', fieldGroupId: groups[0].id, durationMinutes: 30, targetQuestionCount: 1, commonQuestionCount: 1, specializedQuestionCount: 0 } });
  assert.equal(response.status, 201);
  const exam = await response.json();
  assert.equal((await request(`${base}/exams/${exam.id}/questions`, { token, body: { type: 'SingleChoice', group: 'Common', content: 'Câu hỏi kỹ thuật minh họa?', options: [{ key: 'A', text: 'A' }, { key: 'B', text: 'B' }], correctAnswer: 'A', points: 1, explanation: '', source: '', requiresSourceReview: false, sourceReviewed: false } })).status, 201);
  assert.equal((await request(`${base}/exams/${exam.id}/approve`, { token, method: 'POST' })).status, 200);
  return exam;
}

const storedUtc = (millis) => new Date(millis).toISOString().replace('T', ' ').replace('Z', '');

async function main() {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Use Node.js 24 or newer');
  assert.ok(fs.existsSync(dll), 'Build Release backend before testing');
  fs.mkdirSync(testsRoot, { recursive: true });
  dataDir = fs.mkdtempSync(path.join(testsRoot, 'competitions-'));
  await startBackend();
  const admin = await login('admin', adminPassword);
  const organizer = await login('organizer.demo');
  const candidate = await login('thisinh.demo');
  assert.deepEqual(await json('/api/organizer/competitions', admin.token), []);

  // Recreate the step-1 schema state without touching its users, sessions or settings.
  const beforeMigration = inDatabase((db) => ({ users: db.prepare('SELECT Id,Username,Password,Role FROM Users ORDER BY Id').all(), settings: db.prepare('SELECT * FROM AppSettings ORDER BY Key').all() }));
  const keyBeforeMigration = fs.readFileSync(path.join(dataDir, 'jwt.key'), 'utf8');
  await stopBackend();
  inDatabase((db) => db.exec('DROP TABLE CompetitionAssignments; DROP TABLE Competitions; DELETE FROM SchemaVersions WHERE Version = 2;'));
  await startBackend();
  assert.deepEqual(await json('/api/organizer/competitions', admin.token), []);
  inDatabase((db) => {
    assert.deepEqual(db.prepare('SELECT Id,Username,Password,Role FROM Users ORDER BY Id').all(), beforeMigration.users);
    assert.deepEqual(db.prepare('SELECT * FROM AppSettings ORDER BY Key').all(), beforeMigration.settings);
    assert.ok(db.prepare('SELECT Version FROM SchemaVersions WHERE Version = 2').get());
  });
  assert.equal(fs.readFileSync(path.join(dataDir, 'jwt.key'), 'utf8'), keyBeforeMigration);
  pass('additive migration preserves step-1 users, sessions, settings and signing key; no competition records are seeded');

  for (const [route, options] of [
    ['/api/organizer/competitions', {}],
    ['/api/organizer/competitions/1', {}],
    ['/api/organizer/competitions', { body: { name: sampleName } }],
    ['/api/organizer/competitions/1', { method: 'PUT', body: { name: sampleName } }],
  ]) {
    assert.equal((await request(route, options)).status, 401, 'Anonymous competition access');
    assert.equal((await request(route, { ...options, token: candidate.token })).status, 403, 'Candidate cannot administer competitions');
  }
  assert.equal((await request('/api/candidate/competitions')).status, 401);
  assert.equal((await request('/api/candidate/competitions', { token: organizer.token })).status, 403);
  assert.equal((await request('/api/organizer/competitions/999999', { token: admin.token })).status, 404);
  pass('competition administration requires the organizer role for list, read, create and edit; nonexistent records return 404');

  for (const body of [{}, { name: '' }, { name: ' \t\r\n ' }, { name: 'x'.repeat(301) }, { name: sampleName, description: 'x'.repeat(5001) }, { name: sampleName, rules: 'x'.repeat(20001) }]) {
    assert.equal((await request('/api/organizer/competitions', { token: admin.token, body })).status, 400);
  }
  assert.deepEqual(await json('/api/organizer/competitions', admin.token), []);
  const initial = { name: `  ${sampleName}  `, description: 'Mô tả nghiệp vụ tiếng Việt.\nDòng thứ hai.', rules: 'Thể lệ: công bằng, minh bạch.\n<script>window.competitionXss=true</script>' };
  const competition = await create(admin.token, { ...initial, status: 'Published', isDemo: true, opensAtUtc: new Date().toISOString(), closesAtUtc: new Date(Date.now() + 60000).toISOString() });
  assert.equal((await request(`/api/organizer/competitions/${competition.id}`, { token: candidate.token, method: 'DELETE' })).status, 403);
  assert.equal(competition.name, sampleName);
  assert.equal(competition.description, initial.description);
  assert.equal(competition.rules, initial.rules);
  assert.equal(competition.status, 'Draft');
  assert.equal(competition.isDemo, false);
  assert.equal(competition.opensAtUtc, null);
  assert.equal(competition.closesAtUtc, null);
  assert.ok(competition.createdAtUtc.endsWith('Z'));
  assert.ok(competition.updatedAtUtc.endsWith('Z'));
  pass('required and length validation rejects invalid data; creating the supplied Vietnamese sample always persists a draft with UTC timestamps');

  const savedProfile = await json(`/api/organizer/competitions/${competition.id}`, admin.token);
  assert.equal(savedProfile.name, sampleName);
  const changedName = `${sampleName} — đã chỉnh sửa`;
  const edit = { name: changedName, description: 'Mô tả đã cập nhật', rules: initial.rules, status: 'Ended', isDemo: true };
  assert.equal((await request(`/api/organizer/competitions/${competition.id}`, { method: 'PUT', token: admin.token, body: edit })).status, 200);
  for (const body of [{ name: '' }, { name: ' \n ' }, {}]) {
    assert.equal((await request(`/api/organizer/competitions/${competition.id}`, { method: 'PUT', token: admin.token, body })).status, 400);
  }
  await stopBackend();
  await startBackend();
  const afterRestart = await json(`/api/organizer/competitions/${competition.id}`, admin.token);
  assert.equal(afterRestart.name, changedName);
  assert.equal(afterRestart.description, edit.description);
  assert.equal(afterRestart.rules, edit.rules);
  assert.equal(afterRestart.status, 'Draft');
  assert.equal(afterRestart.isDemo, false);
  assert.equal(afterRestart.createdAtUtc, competition.createdAtUtc);
  assert.ok(Date.parse(afterRestart.updatedAtUtc) >= Date.parse(competition.updatedAtUtc));
  assert.equal((await json('/api/organizer/competitions', admin.token))[0].name, changedName);
  pass('read, edit and backend restart preserve stored changes; blank edits and status/demo overposting cannot alter protected data');

  const demoCompetition = await create(organizer.token, { name: 'Cuộc thi minh họa kiểm tra', description: 'Dữ liệu kiểm tra', rules: '', isDemo: false });
  assert.equal(demoCompetition.isDemo, true);
  assert.equal((await json(`/api/organizer/competitions/${demoCompetition.id}`, admin.token)).isDemo, true);
  inDatabase((db) => {
    assert.throws(() => db.prepare('UPDATE Competitions SET Status = ? WHERE Id = ?').run('UnknownStatus', demoCompetition.id), /constraint/i);
    db.prepare('INSERT INTO CompetitionAssignments (CompetitionId, UserId) VALUES (?, ?)').run(competition.id, candidate.id);
    assert.throws(() => db.prepare('INSERT INTO CompetitionAssignments (CompetitionId, UserId) VALUES (?, ?)').run(competition.id, candidate.id), /constraint/i);
  });
  pass('demo-created competitions stay marked; database enforces the three statuses and unique candidate assignments');

  const unassigned = await create(admin.token, { name: 'Đã công bố nhưng chưa phân thí sinh' });
  const ended = await create(admin.token, { name: 'Cuộc thi đã kết thúc' });
  const visibleExam = await createApprovedExam(admin.token, demoCompetition.id);
  const endedExam = await createApprovedExam(admin.token, ended.id);
  assert.equal((await request(`/api/organizer/competitions/${demoCompetition.id}/assignments`, { token: admin.token, body: { userIds: [candidate.id], examId: visibleExam.id } })).status, 201);
  assert.equal((await request(`/api/organizer/competitions/${ended.id}/assignments`, { token: admin.token, body: { userIds: [candidate.id], examId: endedExam.id } })).status, 201);
  inDatabase((db) => {
    db.prepare('UPDATE Competitions SET Status = ? WHERE Id IN (?, ?)').run('Published', demoCompetition.id, unassigned.id);
    db.prepare('UPDATE Competitions SET Status = ? WHERE Id = ?').run('Ended', ended.id);
  });
  const visible = await json('/api/candidate/competitions', candidate.token);
  assert.deepEqual(visible.map((item) => item.id), [demoCompetition.id]);
  assert.equal(visible[0].status, 'Published');
  assert.equal(visible[0].isDemo, true);
  for (const id of [competition.id, unassigned.id, ended.id]) assert.equal((await request(`/api/candidate/competitions/${id}`, { token: candidate.token })).status, 404);
  const otherCandidate = inDatabase((db) => {
    const hash = db.prepare('SELECT Password FROM Users WHERE Username = ?').get('admin').Password;
    db.prepare('INSERT INTO Users (Username,Password,FullName,Role,IsActive,IsDemo) VALUES (?,?,?,?,1,1)').run('other.fixture', hash, 'Thí sinh kiểm tra khác', 'Candidate');
    return 'other.fixture';
  });
  const other = await login(otherCandidate, adminPassword);
  assert.deepEqual(await json('/api/candidate/competitions', other.token), []);
  assert.equal((await request(`/api/candidate/competitions/${demoCompetition.id}`, { token: other.token })).status, 404);
  pass('candidates only see published competitions assigned to themselves; draft, ended and unassigned records remain inaccessible');

  assert.equal((await request(`/api/organizer/competitions/${demoCompetition.id}`, { token: admin.token, method: 'DELETE' })).status, 409);
  const deletable = await create(admin.token, { name: 'Bản nháp đủ điều kiện xóa' });
  const deletableExam = await createApprovedExam(admin.token, deletable.id);
  assert.equal((await request(`/api/organizer/competitions/${deletable.id}/assignments`, { token: admin.token, body: { userIds: [candidate.id], examId: deletableExam.id } })).status, 201);
  const deletion = await request(`/api/organizer/competitions/${deletable.id}`, { token: admin.token, method: 'DELETE' });
  assert.equal(deletion.status, 204, `${await deletion.text()}\n${backendLog}`);
  assert.equal((await request(`/api/organizer/competitions/${deletable.id}`, { token: admin.token })).status, 404);
  const removedData = inDatabase(db => ({
    competitions: db.prepare('SELECT COUNT(*) AS count FROM Competitions WHERE Id = ?').get(deletable.id).count,
    exams: db.prepare('SELECT COUNT(*) AS count FROM Exams WHERE CompetitionId = ?').get(deletable.id).count,
    versions: db.prepare('SELECT COUNT(*) AS count FROM ApprovedExamVersions WHERE ExamId = ?').get(deletableExam.id).count,
    assignments: db.prepare('SELECT COUNT(*) AS count FROM CompetitionAssignments WHERE CompetitionId = ?').get(deletable.id).count,
  }));
  assert.deepEqual(removedData, { competitions: 0, exams: 0, versions: 0, assignments: 0 });
  pass('draft competitions can be deleted with their approved draft content and assignments, while published competitions remain protected');

  const now = Date.now();
  for (const [description, opens, closes, expected] of [
    ['no schedule', null, null, false],
    ['future window', now + 300000, now + 600000, false],
    ['open window', now - 300000, now + 300000, true],
    ['closed window', now - 600000, now - 300000, false],
    ['missing closing time', now - 300000, null, false],
  ]) {
    inDatabase((db) => db.prepare('UPDATE Competitions SET OpensAtUtc = ?, StartDeadlineUtc = ?, ClosesAtUtc = ? WHERE Id = ?').run(opens === null ? null : storedUtc(opens), closes === null ? null : storedUtc(closes), closes === null ? null : storedUtc(closes), demoCompetition.id));
    const profile = await json(`/api/candidate/competitions/${demoCompetition.id}`, candidate.token);
    assert.equal(profile.canStart, expected, description);
    if (expected) assert.equal(profile.startBlockedReason, null);
    else assert.equal(typeof profile.startBlockedReason, 'string');
    if (opens !== null) assert.ok(Math.abs(Date.parse(profile.opensAtUtc) - opens) < 2, 'Opening time round-trips as UTC');
    assert.equal((await json('/api/candidate/competitions', candidate.token))[0].canStart, expected, `List ${description}`);
  }
  inDatabase((db) => db.prepare('UPDATE Competitions SET Status = ? WHERE Id = ?').run('Published', competition.id));
  assert.equal((await request(`/api/organizer/competitions/${competition.id}`, { method: 'PUT', token: admin.token, body: { name: 'Tên sửa khi đã công bố', description: '', rules: '' } })).status, 200);
  assert.equal((await json(`/api/organizer/competitions/${competition.id}`, admin.token)).status, 'Published');
  pass('server schedule checks allow starting only during a complete open UTC window; editing content preserves existing publication state');
  console.log('Competition integration checks passed.');
}

main().catch((error) => { console.error(`FAIL ${error.stack || error.message}`); process.exitCode = 1; }).finally(async () => {
  try {
    await stopBackend();
    if (dataDir) {
      const target = path.resolve(dataDir);
      assert.equal(path.dirname(target), testsRoot, 'Cleanup must stay inside the test directory');
      assert.ok(path.basename(target).startsWith('competitions-'), 'Cleanup must target only this test run');
      await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  } catch (error) { console.error(`FAIL competition test cleanup: ${error.message}`); process.exitCode = 1; }
});
