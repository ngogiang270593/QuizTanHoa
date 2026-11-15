'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const backendRoot = path.join(root, 'backend');
const dll = process.env.QUIZ_TANHOA_TEST_DLL || path.join(backendRoot, 'bin', 'Release', 'net8.0', 'Quiz_TanHoa.Api.dll');
const testsRoot = path.join(root, '.tmp-tests');
const adminPassword = 'AssignmentIntegration_Test_2026!';
const demoPassword = 'TanHoa@2026!';
const pass = message => console.log(`PASS ${message}`);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let dataDir;
let backend;
let origin;
let backendLog = '';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function request(route, { token, body, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
  return fetch(`${origin}${route}`, {
    method,
    attemptHeaders: headers,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
}

let attemptTabId = 'assignments-test-tab-0001';
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options = {}) => nativeFetch(input, {
  ...Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'attemptHeaders')),
  headers: { 'X-Quiz-Attempt-Tab': attemptTabId, ...options.attemptHeaders, ...options.headers },
});

async function api(route, token, { status = 200, ...options } = {}) {
  const response = await request(route, { token, ...options });
  const text = await response.text();
  assert.equal(response.status, status, `${options.method || (options.body ? 'POST' : 'GET')} ${route}: ${text}\n${backendLog}`);
  return text ? JSON.parse(text) : null;
}

async function startBackend() {
  origin = `http://127.0.0.1:${await freePort()}`;
  const env = { ...process.env, ASPNETCORE_URLS: origin, ASPNETCORE_ENVIRONMENT: 'Production', QUIZ_TANHOA_DATA_DIR: dataDir, QUIZ_TANHOA_ADMIN_PASSWORD: adminPassword, QUIZ_TANHOA_SEED_DEMO: 'true' };
  delete env.QUIZ_TANHOA_JWT_KEY;
  delete env.QUIZ_TANHOA_WEB_ROOT;
  backendLog = '';
  backend = spawn(process.env.DOTNET_HOST_PATH || 'dotnet', [dll], { cwd: backendRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let launchError;
  backend.once('error', error => { launchError = error; });
  for (const stream of [backend.stdout, backend.stderr]) stream.on('data', chunk => { backendLog = (backendLog + chunk).slice(-10000); });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (backend.exitCode !== null) throw new Error(`Backend exited: ${backendLog}`);
    try { if ((await request('/api/health')).ok) return; } catch { /* Waiting for the listener. */ }
    await delay(100);
  }
  throw new Error(`Backend startup timeout: ${backendLog}`);
}

async function stopBackend() {
  const child = backend;
  backend = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  if (!await Promise.race([exit.then(() => true), delay(5000).then(() => false)])) throw new Error('Owned assignment test backend did not stop');
}

function inDatabase(action) {
  const db = new DatabaseSync(path.join(dataDir, 'quiz_tanhoa.db'));
  try { db.exec('PRAGMA foreign_keys = ON'); return action(db); } finally { db.close(); }
}

async function login(username, password = demoPassword) {
  return api('/api/Auth/login', null, { body: { username, password } });
}

async function competition(token, name) {
  return api('/api/organizer/competitions', token, { status: 201, body: { name } });
}

async function approvedExam(token, competitionId, name, questionCount = 1) {
  const base = `/api/organizer/competitions/${competitionId}`;
  const groups = await api(`${base}/field-groups`, token);
  const config = { name, fieldGroupId: groups[0].id, durationMinutes: 30, targetQuestionCount: questionCount, commonQuestionCount: questionCount, specializedQuestionCount: 0 };
  const exam = await api(`${base}/exams`, token, { status: 201, body: config });
  const questions = [];
  for (let index = 0; index < questionCount; index++) questions.push(await api(`${base}/exams/${exam.id}/questions`, token, { status: 201, body: {
    type: 'SingleChoice', content: `Câu hỏi kiểm tra kỹ thuật số ${index + 1}, dữ liệu minh họa?`,
    options: [{ key: 'A', text: 'Phương án A' }, { key: 'B', text: 'Phương án B' }], correctAnswer: 'A', points: 1,
    explanation: 'Giải thích minh họa không dành cho thí sinh trước khi làm bài.', source: 'Nguồn minh họa nội bộ', group: 'Common', requiresSourceReview: false, sourceReviewed: false,
  } }));
  await api(`${base}/exams/${exam.id}/submit-review`, token, { method: 'POST', body:{} });

  const version = await api(`${base}/exams/${exam.id}/approve`, token, { method: 'POST', body:{note:'Duyệt đề sau khi kiểm tra'} });
  return { ...exam, config, version, questions, question: questions[0] };
}

async function assign(token, competitionId, examId, userIds) {
  const response = await request(`/api/organizer/competitions/${competitionId}/assignments`, { token, body: { examId, userIds } });
  const text = await response.text();
  assert.ok([200, 201].includes(response.status), `Assignment failed ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function assertNoAnswers(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!/^(questions|correctAnswer|answer|answers|explanation|source|snapshot|snapshotJson|password|hash)$/i.test(key), `Candidate response exposes ${key}`);
    assertNoAnswers(child);
  }
}

async function main() {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Use Node.js 24 or newer');
  assert.ok(fs.existsSync(dll), 'Build Release backend before assignment tests');
  fs.mkdirSync(testsRoot, { recursive: true });
  dataDir = fs.mkdtempSync(path.join(testsRoot, 'assignments-'));
  await startBackend();
  const admin = await login('admin', adminPassword);
  const organizer = await login('organizer.demo');
  const candidate = await login('thisinh.demo');
  const fixtures = inDatabase(db => {
    const hash = db.prepare('SELECT Password FROM Users WHERE Username = ?').get('admin').Password;
    const insert = db.prepare('INSERT INTO Users (Username,Password,FullName,Role,IsActive,IsDemo,Department) VALUES (?,?,?,?,?,1,?)');
    const other = Number(insert.run('other.fixture', hash, 'Thí sinh khác minh họa', 'Candidate', 1, 'Bộ phận khác minh họa').lastInsertRowid);
    const extra = Number(insert.run('extra.fixture', hash, 'Thí sinh bổ sung minh họa', 'Candidate', 1, 'Bộ phận bổ sung minh họa').lastInsertRowid);
    const inactive = Number(insert.run('inactive.fixture', hash, 'Thí sinh đã khóa minh họa', 'Candidate', 0, '').lastInsertRowid);
    db.prepare('UPDATE Users SET Department = ? WHERE Id = ?').run('Bộ phận chuyên môn minh họa', candidate.id);
    return { other, extra, inactive };
  });
  const other = await login('other.fixture', adminPassword);
  const first = await competition(organizer.token, 'Cuộc thi phân công thứ nhất minh họa');
  const second = await competition(organizer.token, 'Cuộc thi phân công thứ hai minh họa');
  const base = `/api/organizer/competitions/${first.id}`;
  const secondBase = `/api/organizer/competitions/${second.id}`;
  const sessionTransferRoute = `${base}/assignments/${candidate.id}/attempt-session`;

  for (const [route, options] of [
    [`${base}/assignment-options`, {}], [`${base}/assignments`, {}], [`${base}/publication`, {}],
    [`${base}/assignments`, { body: { userIds: [candidate.id], examId: 1 } }],
    [`${base}/assignments/${candidate.id}`, { method: 'PUT', body: { examId: 1 } }],
    [`${base}/assignments/${candidate.id}`, { method: 'DELETE' }], [`${base}/publish`, { method: 'POST' }],
    [sessionTransferRoute, { body: { reason: 'Kiểm tra quyền', allowRetake: false } }],
  ]) {
    assert.equal((await request(route, options)).status, 401, `${route} anonymous`);
    assert.equal((await request(route, { ...options, token: candidate.token })).status, 403, `${route} candidate role`);
  }
  const optionsBefore = await api(`${base}/assignment-options`, admin.token);
  assert.ok(optionsBefore.accounts.some(account => account.id === candidate.id && account.department === 'Bộ phận chuyên môn minh họa'));
  assert.ok(!optionsBefore.accounts.some(account => [admin.id, organizer.id, fixtures.inactive].includes(account.id)));
  assert.deepEqual(optionsBefore.approvedExams, []);
  pass('assignment and publication APIs require organizer permissions and offer only active candidate accounts with department information');

  const noSchedule = await api(`${base}/publication`, admin.token);
  assert.equal(noSchedule.canPublish, false);
  const firstPublishFailure = await api(`${base}/publish`, admin.token, { method: 'POST', status: 400 });
  assert.match(JSON.stringify(firstPublishFailure), /lịch|schedule|đề|phân/i);
  const schedule = { opensAtLocal: '2030-02-01T08:00', startDeadlineLocal: '2030-02-01T08:30', closesAtLocal: '2030-02-01T09:00' };
  await api(`${base}/schedule`, admin.token, { method: 'PUT', body: schedule });
  assert.equal((await request(`${base}/publish`, { token: admin.token, method: 'POST' })).status, 400);
  const firstExam = await approvedExam(admin.token, first.id, 'Đề thứ nhất được giao minh họa');
  const replacement = await approvedExam(admin.token, first.id, 'Đề thay thế được duyệt minh họa');
  const secondExam = await approvedExam(admin.token, second.id, 'Đề thứ hai được giao minh họa', 2);
  assert.equal((await request(`${base}/publish`, { token: admin.token, method: 'POST' })).status, 400, 'Publishing still requires an assignment');
  const drafts = await api(`${base}/exams`, admin.token, { status: 201, body: { ...firstExam.config, name: 'Đề chưa duyệt minh họa' } });
  const optionsReady = await api(`${base}/assignment-options`, admin.token);
  assert.deepEqual(optionsReady.approvedExams.map(exam => exam.id).sort((a,b) => a-b), [firstExam.id, replacement.id].sort((a,b) => a-b));
  pass('publication is blocked until schedule, approved exams and valid assignments exist; draft exams are excluded from selection');

  for (const body of [
    { userIds: [candidate.id], examId: secondExam.id },
    { userIds: [candidate.id], examId: drafts.id },
    { userIds: [fixtures.inactive], examId: firstExam.id },
    { userIds: [organizer.id], examId: firstExam.id },
    { userIds: [candidate.id, fixtures.inactive], examId: firstExam.id },
    { userIds: [], examId: firstExam.id },
  ]) assert.equal((await request(`${base}/assignments`, { token: admin.token, body })).status, 400);
  assert.deepEqual(await api(`${base}/assignments`, admin.token), [], 'Invalid batches must not partly assign valid users');
  await assign(admin.token, first.id, firstExam.id, [candidate.id, fixtures.extra]);
  assert.equal((await request(`${base}/assignments`, { token: admin.token, body: { examId: firstExam.id, userIds: [candidate.id, fixtures.other] } })).status, 409);
  assert.equal((await api(`${base}/assignments`, admin.token)).length, 2, 'Duplicate batch cannot add the remaining account');
  await api(`${base}/assignments/${candidate.id}`, admin.token, { method: 'PUT', body: { examId: replacement.id } });
  assert.equal((await api(`${base}/assignments`, admin.token)).find(item => item.userId === candidate.id).examId, replacement.id);
  await api(`${base}/assignments/${candidate.id}`, admin.token, { method: 'PUT', body: { examId: firstExam.id } });
  const revoke = await request(`${base}/assignments/${fixtures.extra}`, { token: admin.token, method: 'DELETE' });
  assert.ok([200, 204].includes(revoke.status));
  assert.equal((await api(`${base}/assignments`, admin.token)).length, 1);
  pass('assignment batches are atomic, scoped to approved exams in the same competition and unique per user; changing and revoking before start works');

  await api(`${secondBase}/schedule`, admin.token, { method: 'PUT', body: schedule });
  await assign(admin.token, second.id, secondExam.id, [candidate.id]);
  assert.deepEqual(await api('/api/candidate/competitions', candidate.token), [], 'Draft competitions remain hidden even after assignment');
  for (const competitionId of [first.id, second.id]) {
    await api(`/api/organizer/competitions/${competitionId}/publish`, admin.token, { method: 'POST' });
    await api(`/api/organizer/competitions/${competitionId}/publish`, admin.token, { method: 'POST' });
  }
  const visible = await api('/api/candidate/competitions', candidate.token);
  assert.equal(visible.length, 2);
  for (const [competitionId, exam] of [[first.id, firstExam], [second.id, secondExam]]) {
    const value = visible.find(item => item.id === competitionId);
    assert.ok(value); assert.equal(value.status, 'Published');
    assert.equal(value.assignedExam.id, exam.id);
    assert.equal(value.assignedExam.name, exam.name);
    assert.equal(value.assignedExam.versionId, exam.version.id);
    assert.equal(value.attemptStatus, 'NotStarted');
    const direct = await api(`/api/candidate/competitions/${competitionId}`, candidate.token);
    assert.equal(direct.assignedExam.id, exam.id);
    const directExam = await api(`/api/candidate/competitions/${competitionId}/exam`, candidate.token);
    assert.equal(directExam.assignedExam.id, exam.id);
    assertNoAnswers(value); assertNoAnswers(direct); assertNoAnswers(directExam);
    for (const endpoint of [`/api/candidate/competitions/${competitionId}`, `/api/candidate/competitions/${competitionId}/exam`]) {
      assert.equal((await request(endpoint, { token: other.token })).status, 404);
      assert.equal((await request(endpoint)).status, 401);
    }
  }
  assert.deepEqual(await api('/api/candidate/competitions', other.token), []);
  pass('one candidate sees exactly two published competitions and the correct assigned exam in each; another account cannot open direct competition or exam URLs');

  const localNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const localMinute = value => value.toISOString().slice(0, 16);
  await api(`${secondBase}/schedule`, admin.token, { method: 'PUT', body: {
    opensAtLocal: localMinute(new Date(localNow.getTime() - 60000)),
    startDeadlineLocal: localMinute(new Date(localNow.getTime() + 30 * 60000)),
    closesAtLocal: localMinute(new Date(localNow.getTime() + 60 * 60000)),
  } });
  const firstAttemptUrl = `/api/candidate/competitions/${first.id}/attempt`;
  const secondAttemptUrl = `/api/candidate/competitions/${second.id}/attempt`;
  assert.equal((await api(`${firstAttemptUrl}/start`, candidate.token, { method: 'POST', status: 409 })).message.includes('thời gian'), true, 'An assigned candidate cannot start outside the schedule');
  for (const [route, options] of [
    [secondAttemptUrl, {}],
    [`${secondAttemptUrl}/start`, { method: 'POST' }],
    [`${secondAttemptUrl}/questions/${secondExam.question.id}`, { method: 'PUT', body: { answer: 'A' } }],
    [`${secondAttemptUrl}/submit`, { method: 'POST' }],
  ]) {
    assert.equal((await request(route, options)).status, 401, `${route} requires an authenticated session`);
    assert.equal((await request(route, { ...options, token: admin.token })).status, 403, `${route} requires the candidate role`);
  }
  assert.equal((await request(secondAttemptUrl, { token: other.token })).status, 404, 'Unassigned candidates cannot read attempt state');
  assert.equal((await request(`${secondAttemptUrl}/start`, { token: other.token, method: 'POST' })).status, 404, 'Unassigned candidates cannot start an attempt');
  const notStarted = await api(secondAttemptUrl, candidate.token);
  assert.equal(notStarted.attemptStatus, 'NotStarted');
  const candidateNewSession = await login('thisinh.demo');
  const firstTabId = 'assignments-test-machine-one';
  const secondTabId = 'assignments-test-machine-two';
  const [startA, startB] = await Promise.all([
    request(`${secondAttemptUrl}/start`, { token: candidate.token, method: 'POST', headers: { 'X-Quiz-Attempt-Tab': firstTabId } }),
    request(`${secondAttemptUrl}/start`, { token: candidateNewSession.token, method: 'POST', headers: { 'X-Quiz-Attempt-Tab': secondTabId } }),
  ]);
  assert.deepEqual([startA.status, startB.status].sort(), [200, 409], 'Concurrent starts from two login sessions create one attempt and block the other session');
  const winningResponse = startA.status === 200 ? startA : startB;
  const blockedResponse = startA.status === 409 ? startA : startB;
  const issued = await winningResponse.json();
  assert.equal((await blockedResponse.json()).message, 'Tài khoản đang có phiên làm bài');
  const attemptOwnerToken = startA.status === 200 ? candidate.token : candidateNewSession.token;
  const attemptOwnerTab = startA.status === 200 ? firstTabId : secondTabId;
  const transferTargetToken = startA.status === 200 ? candidateNewSession.token : candidate.token;
  attemptTabId = attemptOwnerTab;
  assert.equal(issued.attemptStatus, 'InProgress');
  const secondTab = await request(secondAttemptUrl, { token: attemptOwnerToken, headers: { 'X-Quiz-Attempt-Tab': 'assignments-test-tab-0002' } });
  assert.equal(secondTab.status, 409, 'A second tab cannot acquire the live attempt lease');
  const blockedSecondSession = await request(secondAttemptUrl, { token: transferTargetToken });
  assert.equal(blockedSecondSession.status, 409);
  assert.equal((await blockedSecondSession.json()).message, 'Tài khoản đang có phiên làm bài');
  const moved = await api(`/api/organizer/competitions/${second.id}/assignments/${candidate.id}/attempt-session`, admin.token, {
    body: { reason: 'Đã xác minh thí sinh trực tiếp tại Ban Tổ chức', allowRetake: false },
  });
  assert.equal(moved.attemptId, issued.attemptId);
  assert.equal((await request(secondAttemptUrl, { token: attemptOwnerToken })).status, 409, 'The old session loses access immediately');
  let attemptToken = transferTargetToken;
  const afterStartDeadline = new Date(Date.now() + 7 * 60 * 60 * 1000);
  await api(`${secondBase}/schedule`, admin.token, { method: 'PUT', body: {
    opensAtLocal: localMinute(new Date(afterStartDeadline.getTime() - 3 * 60000)),
    startDeadlineLocal: localMinute(new Date(afterStartDeadline.getTime() - 60000)),
    closesAtLocal: localMinute(new Date(afterStartDeadline.getTime() + 60 * 60000)),
  } });
  const reopenedAfterStartDeadline = await api(secondAttemptUrl, attemptToken);
  assert.equal(reopenedAfterStartDeadline.attemptId, issued.attemptId);
  assert.equal(reopenedAfterStartDeadline.attemptStatus, 'InProgress', 'An existing attempt remains reopenable after the start deadline');
  assert.equal((await api(`${secondAttemptUrl}/start`, attemptToken, { method: 'POST' })).attemptId, issued.attemptId, 'Start reopens the existing attempt after the ordinary start cutoff');
  assert.equal(issued.questions.length, 2);
  assert.deepEqual(issued.questions.map(question => question.position), [1, 2]);
  assert.deepEqual(issued.questions.map(question => question.id).sort(), secondExam.questions.map(question => question.id).sort());
  for (const question of issued.questions) {
    assert.equal(question.content, secondExam.questions.find(item => item.id === question.id).content);
    assert.deepEqual(question.options.map(option => option.key).sort(), ['A', 'B']);
  }
  assert.ok(issued.startedAtUtc && issued.deadlineAtUtc);
  for (const key of ['correctAnswer', 'explanation', 'source', 'points', 'snapshot', 'snapshotJson']) assert.equal(Object.hasOwn(issued.questions[0], key), false, `Attempt question must not expose ${key}`);
  const savedAnswer = issued.questions[0].options[0].key;
  const secondAnswer = issued.questions[1].options[1].key;
  await api(`${secondAttemptUrl}/questions/${issued.questions[0].id}`, attemptToken, { method: 'PUT', body: { answer: savedAnswer, isMarked: true } });
  await api(`${secondAttemptUrl}/questions/${issued.questions[1].id}`, attemptToken, { method: 'PUT', body: { answer: secondAnswer, isMarked: false } });
  const restored = await api(secondAttemptUrl, attemptToken);
  assert.equal(restored.attemptStatus, 'InProgress');
  assert.deepEqual(restored.questions.map(question => question.id), issued.questions.map(question => question.id), 'Reload must preserve randomized question order');
  assert.deepEqual(restored.questions.map(question => question.options), issued.questions.map(question => question.options), 'Reload must preserve randomized option order');
  assert.equal(restored.questions[0].answer, savedAnswer);
  assert.equal(restored.questions[0].isMarked, true);
  assert.equal(restored.questions[1].answer, secondAnswer);
  assert.equal(restored.answeredCount, 2);
  assert.equal((await request(`${secondAttemptUrl}/questions/${issued.questions[0].id}`, { token: attemptToken, method: 'PUT', body: { answer: 'NOT_AN_OPTION', isMarked: false } })).status, 400);
  const submitted = await api(`${secondAttemptUrl}/submit`, attemptToken, { method: 'POST' });
  assert.equal(submitted.attemptStatus, 'Submitted');
  assert.ok(submitted.submittedAtUtc);
  assert.equal(submitted.questions.length, 0, 'Submitted response must not reveal questions or answers');
  const repeatedSubmit = await api(`${secondAttemptUrl}/submit`, attemptToken, { method: 'POST' });
  assert.equal(repeatedSubmit.submittedAtUtc, submitted.submittedAtUtc, 'Repeated submit returns the same committed result');
  assert.equal((await api(`${secondAttemptUrl}/start`, attemptToken, { method: 'POST' })).attemptStatus, 'Submitted', 'A submitted attempt cannot be restarted');
  assert.equal((await request(`${secondAttemptUrl}/questions/${issued.questions[0].id}`, { token: attemptToken, method: 'PUT', body: { answer: 'B', isMarked: false } })).status, 409);
  const retakeSession = await login('thisinh.demo');
  const replacementAttempt = await api(`/api/organizer/competitions/${second.id}/assignments/${candidate.id}/attempt-session`, admin.token, {
    body: { reason: 'Thể lệ cho phép thi lại; đã xác minh danh tính', allowRetake: true },
  });
  assert.equal(replacementAttempt.attemptId, null, 'The replacement timer must not start before the candidate starts it');
  assert.equal((await request(secondAttemptUrl, { token: attemptToken })).status, 409, 'Previous session loses access to the replacement attempt');
  const replacementReady = await api(secondAttemptUrl, retakeSession.token);
  assert.equal(replacementReady.attemptStatus, 'NotStarted');
  assert.equal(replacementReady.canStart, true, 'An authorized retake can start after the ordinary start deadline while the competition remains open');
  const replacementPacket = await api(`${secondAttemptUrl}/start`, retakeSession.token, { method: 'POST' });
  assert.notEqual(replacementPacket.attemptId, issued.attemptId);
  assert.equal(replacementPacket.attemptStatus, 'InProgress');
  assert.equal(replacementPacket.answeredCount, 0, 'Replacement attempts start without carrying old answers');
  attemptToken = retakeSession.token;
  assert.equal(inDatabase(db => db.prepare('SELECT IsInvalidated FROM ExamAttempts WHERE Id = ?').get(issued.attemptId).IsInvalidated), 1);
  assert.equal(inDatabase(db => db.prepare('SELECT COUNT(*) AS Count FROM ExamAttemptAdminEvents WHERE AttemptId = ?').get(issued.attemptId).Count), 2);
  pass('simultaneous starts from two login sessions create one attempt; tab/session conflicts, transfer audit, retake authorization and delayed replacement start are enforced');
  pass('starting checks the live schedule and assignment, persists shuffled question/option order and answers, restores them after reload, and locks a submitted attempt');

  const examBase = `${base}/exams/${firstExam.id}`;
  await api(examBase, admin.token, { method: 'PUT', body: { ...firstExam.config, name: 'Tên bản nháp đã sửa sau phân công' } });
  await api(`${examBase}/submit-review`, admin.token, { method: 'POST', body:{} });

  const laterVersion = await api(`${examBase}/approve`, admin.token, { method: 'POST', body:{note:'Duyệt đề sau khi kiểm tra'} });
  assert.notEqual(laterVersion.id, firstExam.version.id);
  const pinned = await api(`/api/candidate/competitions/${first.id}/exam`, candidate.token);
  assert.equal(pinned.assignedExam.versionId, firstExam.version.id);
  assert.equal(pinned.assignedExam.name, firstExam.name);
  assert.equal((await api(`${base}/assignments`, admin.token)).find(item => item.userId === candidate.id).examVersionId, firstExam.version.id);
  pass('assignments pin the approved snapshot; later draft edits and approvals cannot silently change the assigned exam content or metadata');

  inDatabase(db => {
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 30 * 60000).toISOString();
    db.prepare('INSERT INTO ExamAttempts (CompetitionId,ExamId,UserId,ExamVersionId,StartedAtUtc,DeadlineAtUtc,SubmittedAtUtc) VALUES (?,?,?,?,?,?,NULL)').run(first.id, firstExam.id, candidate.id, firstExam.version.id, now, future);
  });
  let row = (await api(`${base}/assignments`, admin.token)).find(item => item.userId === candidate.id);
  assert.equal(row.canChange, false); assert.equal(row.attemptStatus, 'InProgress');
  assert.equal((await request(`${base}/assignments/${candidate.id}`, { token: admin.token, method: 'PUT', body: { examId: replacement.id } })).status, 409);
  assert.equal((await request(`${base}/assignments/${candidate.id}`, { token: admin.token, method: 'DELETE' })).status, 409);
  inDatabase(db => {
    assert.throws(() => db.prepare('UPDATE CompetitionAssignments SET ExamId = ?, ExamVersionId = ? WHERE CompetitionId = ? AND UserId = ?').run(replacement.id, replacement.version.id, first.id, candidate.id), /start|attempt|bắt đầu|constraint|assign/i);
    assert.throws(() => db.prepare('DELETE FROM CompetitionAssignments WHERE CompetitionId = ? AND UserId = ?').run(first.id, candidate.id), /start|attempt|bắt đầu|constraint|assign/i);
    db.prepare('UPDATE ExamAttempts SET DeadlineAtUtc = ? WHERE CompetitionId = ? AND UserId = ?').run('2000-01-01 00:00:00', first.id, candidate.id);
  });
  await delay(1500);
  assert.equal(inDatabase(db => db.prepare('SELECT SubmittedAtUtc FROM ExamAttempts WHERE CompetitionId = ? AND UserId = ?').get(first.id, candidate.id).SubmittedAtUtc),
    '2000-01-01 00:00:00', 'Background service must finalize a due attempt without a candidate request');
  const autoFinalized = await api(`/api/candidate/competitions/${first.id}/attempt`, candidate.token);
  assert.equal(autoFinalized.attemptStatus, 'Submitted');
  assert.equal(autoFinalized.submittedAtUtc, autoFinalized.deadlineAtUtc, 'Server finalizes at the persisted deadline without a browser submit');
  assert.equal((await api(`/api/candidate/competitions/${first.id}/attempt/submit`, candidate.token, { method: 'POST' })).submittedAtUtc,
    autoFinalized.submittedAtUtc, 'Repeated submit after server-side timeout returns the same committed result');
  assert.equal((await request(`/api/candidate/competitions/${first.id}/attempt/questions/${firstExam.question.id}`, {
    token: candidate.token, method: 'PUT', body: { answer: 'A', isMarked: false },
  })).status, 409, 'Answers received after the persisted deadline are rejected');
  row = (await api(`${base}/assignments`, admin.token)).find(item => item.userId === candidate.id);
  assert.equal(row.attemptStatus, 'Submitted'); assert.equal(row.canChange, false);
  assert.equal((await request(`${base}/assignments/${candidate.id}`, { token: admin.token, method: 'DELETE' })).status, 409);
  assert.equal((await api(`/api/candidate/competitions/${first.id}`, candidate.token)).canStart, false);
  pass('API and database prevent changing or revoking any started or submitted assignment and report the actual attempt state');

  const legacy = await competition(admin.token, 'Cuộc thi phân công cũ cần hoàn thiện');
  inDatabase(db => db.prepare('INSERT INTO CompetitionAssignments (CompetitionId,UserId) VALUES (?,?)').run(legacy.id, fixtures.other));
  const beforeRestart = inDatabase(db => ({ users: db.prepare('SELECT Id,Username,Password,Role,Department FROM Users ORDER BY Id').all(), versions: db.prepare('SELECT Id,SnapshotJson,HashSha256 FROM ApprovedExamVersions ORDER BY Id').all() }));
  await stopBackend(); await startBackend();
  inDatabase(db => {
    assert.deepEqual(db.prepare('SELECT Id,Username,Password,Role,Department FROM Users ORDER BY Id').all(), beforeRestart.users);
    assert.deepEqual(db.prepare('SELECT Id,SnapshotJson,HashSha256 FROM ApprovedExamVersions ORDER BY Id').all(), beforeRestart.versions);
    assert.ok(db.prepare('SELECT Version FROM SchemaVersions WHERE Version = 6').get());
    assert.ok(db.prepare('SELECT Version FROM SchemaVersions WHERE Version = 8').get());
  });
  assert.equal((await api(`/api/organizer/competitions/${legacy.id}/assignments`, admin.token)).length, 1);
  assert.equal((await request(`/api/organizer/competitions/${legacy.id}/publish`, { token: admin.token, method: 'POST' })).status, 400);
  assert.equal((await api('/api/candidate/competitions', candidate.token)).length, 2, 'Restart preserves session and assignments');
  const restoredAfterRestart = await api(`/api/candidate/competitions/${second.id}/attempt`, attemptToken);
  assert.equal(restoredAfterRestart.attemptStatus, 'InProgress');
  assert.ok(restoredAfterRestart.deadlineAtUtc);
  inDatabase(db => db.prepare('UPDATE Competitions SET Status = ? WHERE Id = ?').run('Ended', second.id));
  assert.equal((await request(`${secondBase}/publish`, { token: admin.token, method: 'POST' })).status, 409);
  assert.equal((await request(`${secondBase}/assignments/${candidate.id}`, { token: admin.token, method: 'DELETE' })).status, 409);
  assert.equal((await request(`/api/candidate/competitions/${second.id}`, { token: candidate.token })).status, 404);
  pass('restart preserves users, credentials, pinned versions and sessions; legacy unassigned rows are retained but cannot publish, and ended competitions cannot reopen');
  console.log('Assignment, publication and candidate access integration checks passed.');
}

main().catch(error => { console.error(`FAIL ${error.stack || error.message}`); process.exitCode = 1; }).finally(async () => {
  try {
    await stopBackend();
    if (dataDir) {
      const target = path.resolve(dataDir);
      assert.equal(path.dirname(target), testsRoot, 'Cleanup must remain in the workspace test directory');
      assert.ok(path.basename(target).startsWith('assignments-'), 'Cleanup must target only this test run');
      await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  } catch(error) { console.error(`FAIL assignment test cleanup: ${error.message}`); process.exitCode = 1; }
});
