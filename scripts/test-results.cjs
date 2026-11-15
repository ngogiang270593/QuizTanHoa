'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { inflateRawSync } = require('node:zlib');

const root = path.resolve(__dirname, '..');
const backendRoot = path.join(root, 'backend');
const dll = process.env.QUIZ_TANHOA_TEST_DLL || path.join(backendRoot, 'bin', 'Release', 'net8.0', 'Quiz_TanHoa.Api.dll');
const testsRoot = path.join(root, '.tmp-tests');
const password = 'ResultsIntegration_Test_2026!';
const demoPassword = 'TanHoa@2026!';
const pass = message => console.log(`PASS ${message}`);
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

async function request(route, token, { body, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
  const response = await fetch(`${origin}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return response;
}

async function api(route, token, { status = 200, ...options } = {}) {
  const response = await request(route, token, options);
  const text = await response.text();
  assert.equal(response.status, status, `${options.method || 'GET'} ${route}: ${text}\n${backendLog}`);
  return text ? JSON.parse(text) : null;
}

async function startBackend() {
  origin = `http://127.0.0.1:${await freePort()}`;
  const env = { ...process.env, ASPNETCORE_URLS: origin, ASPNETCORE_ENVIRONMENT: 'Production', QUIZ_TANHOA_DATA_DIR: dataDir, QUIZ_TANHOA_ADMIN_PASSWORD: password, QUIZ_TANHOA_SEED_DEMO: 'true' };
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
    try { if ((await request('/api/health')).ok) return; } catch { }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Backend startup timeout: ${backendLog}`);
}

async function stopBackend() {
  const child = backend;
  backend = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  if (!await Promise.race([exit.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 5000))]))
    throw new Error('Owned results test backend did not stop');
}

function inDatabase(action) {
  const db = new DatabaseSync(path.join(dataDir, 'quiz_tanhoa.db'));
  try { db.exec('PRAGMA foreign_keys = ON'); return action(db); } finally { db.close(); }
}

async function login(username, userPassword = demoPassword) {
  return api('/api/Auth/login', null, { body: { username, password: userPassword } });
}

async function approvedExam(token, competitionId, fieldGroupId, name) {
  const base = `/api/organizer/competitions/${competitionId}`;
  const exam = await api(`${base}/exams`, token, { status: 201, body: {
    name, fieldGroupId, durationMinutes: 30, targetQuestionCount: 3, commonQuestionCount: 1, specializedQuestionCount: 2,
  } });
  const questions = [];
  for (const item of [
    { group: 'Common', points: 1, isScenario: false, content: 'Câu kiến thức chung minh họa' },
    { group: 'Specialized', points: 2, isScenario: true, content: 'Câu tình huống minh họa' },
    { group: 'Specialized', points: 2, isScenario: false, content: 'Câu chuyên môn minh họa' },
  ]) {
    questions.push(await api(`${base}/exams/${exam.id}/questions`, token, { status: 201, body: {
      ...item, type: 'SingleChoice', options: [{ key: 'A', text: 'Đúng' }, { key: 'B', text: 'Sai' }],
      correctAnswer: 'A', explanation: '', source: '', requiresSourceReview: false, sourceReviewed: false,
    } }));
  }
  await api(`${base}/exams/${exam.id}/submit-review`, token, { method: 'POST', body:{} });

  const version = await api(`${base}/exams/${exam.id}/approve`, token, { method: 'POST', body:{note:'Duyệt đề sau khi kiểm tra'} });
  return { exam, version, questions };
}

function addAttempts(competitionId, examId, versionId, userId, versions, answers, isInvalidated = false, elapsedMinutes = 10) {
  return inDatabase(db => {
    const submittedAtDate = new Date(Math.floor(Date.now() / 60000) * 60000);
    const submittedAt = submittedAtDate.toISOString();
    const start = new Date(submittedAtDate.getTime() - elapsedMinutes * 60000).toISOString();
    const deadline = new Date(submittedAtDate.getTime() + 20 * 60000).toISOString();
    const result = db.prepare(`INSERT INTO ExamAttempts
      (CompetitionId,ExamId,UserId,ExamVersionId,StartedAtUtc,DeadlineAtUtc,SubmittedAtUtc,IsInvalidated,InvalidatedAtUtc,InvalidatedByUserId,InvalidationReason)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      competitionId, examId, userId, versionId, start, deadline, submittedAt,
      isInvalidated ? 1 : 0, isInvalidated ? submittedAt : null, isInvalidated ? 1 : null, isInvalidated ? 'Lượt cũ minh họa bị loại' : null,
    );
    const attemptId = Number(result.lastInsertRowid);
    for (let index = 0; index < versions.length; index++) {
      db.prepare(`INSERT INTO ExamAttemptQuestions (AttemptId,QuestionId,Position,OptionsOrderJson,Answer,IsMarked,UpdatedAtUtc)
        VALUES (?,?,?,?,?,?,?)`).run(attemptId, versions[index].id, index + 1, '["A","B"]', answers[index], 0, submittedAt);
    }
    return attemptId;
  });
}

function zipEntry(buffer, target) {
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.toString('utf8', nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (name === target) return (method === 8 ? inflateRawSync(compressed) : compressed).toString('utf8');
    offset = dataStart + compressedSize;
  }
  throw new Error(`Excel workbook is missing ${target}`);
}

async function main() {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Use Node.js 24 or newer');
  assert.ok(fs.existsSync(dll), 'Build Release backend before results tests');
  fs.mkdirSync(testsRoot, { recursive: true });
  dataDir = fs.mkdtempSync(path.join(testsRoot, 'results-'));
  await startBackend();

  const organizer = await login('organizer.demo');
  const competition = await api('/api/organizer/competitions', organizer.token, { status: 201, body: {
    name: 'Kiểm tra kết quả và xếp hạng',
    rules: 'Xếp hạng theo tổng điểm; khi hòa, dùng điểm phần tình huống để phá hòa.',
  } });
  const base = `/api/organizer/competitions/${competition.id}`;
  const fieldGroups = await api(`${base}/field-groups`, organizer.token);
  const firstGroup = fieldGroups[0];
  const secondGroup = fieldGroups[1];
  await api(`${base}/field-groups/${firstGroup.id}`, organizer.token, { method: 'PUT', body: { name: firstGroup.name, rankingGroupName: 'Nhóm tương đương' } });
  await api(`${base}/field-groups/${secondGroup.id}`, organizer.token, { method: 'PUT', body: { name: secondGroup.name, rankingGroupName: 'Nhóm riêng' } });
  const firstExam = await approvedExam(organizer.token, competition.id, firstGroup.id, 'Đề nhóm một');
  const secondExam = await approvedExam(organizer.token, competition.id, secondGroup.id, 'Đề nhóm hai');

  const candidateA = inDatabase(db => db.prepare('SELECT Id FROM Users WHERE Username = ?').get('thisinh.demo').Id);
  const createdUsers = inDatabase(db => {
    const passwordHash = db.prepare('SELECT Password FROM Users WHERE Id = ?').get(candidateA).Password;
    const insert = db.prepare('INSERT INTO Users (Username,Password,FullName,Department,Role,IsActive,IsDemo) VALUES (?,?,?,?,?,?,?)');
    return [
      Number(insert.run('results.candidate.b', passwordHash, 'Thí sinh B', 'Bộ phận Một', 'Candidate', 1, 0).lastInsertRowid),
      Number(insert.run('results.candidate.c', passwordHash, 'Thí sinh C', 'Bộ phận Hai', 'Candidate', 1, 0).lastInsertRowid),
    ];
  });
  const [candidateB, candidateC] = createdUsers;
  await api(`${base}/assignments`, organizer.token, { status: 201, body: { examId: firstExam.exam.id, userIds: [candidateA, candidateB] } });
  await api(`${base}/assignments`, organizer.token, { status: 201, body: { examId: secondExam.exam.id, userIds: [candidateC] } });
  assert.equal((await request('/api/organizer/users/' + candidateA, organizer.token, { method: 'DELETE' })).status, 409,
    'Accounts with assignments cannot be deleted');

  const draftQuestion = firstExam.questions[1];
  await api(`${base}/exams/${firstExam.exam.id}/questions/${draftQuestion.id}`, organizer.token, { method: 'PUT', body: {
    ...draftQuestion, isScenario: false,
  } });
  await api(`${base}/exams/${firstExam.exam.id}/submit-review`, organizer.token, { method: 'POST', body:{} });

  const changedVersion = await api(`${base}/exams/${firstExam.exam.id}/approve`, organizer.token, { method: 'POST', body:{note:'Duyệt đề sau khi kiểm tra'} });
  assert.notEqual(changedVersion.id, firstExam.version.id);

  addAttempts(competition.id, firstExam.exam.id, firstExam.version.id, candidateA, firstExam.questions, ['A', 'A', 'B'], true);
  const validAttemptA = addAttempts(competition.id, firstExam.exam.id, firstExam.version.id, candidateA, firstExam.questions, ['A', 'A', 'B']);
  const validAttemptB = addAttempts(competition.id, firstExam.exam.id, firstExam.version.id, candidateB, firstExam.questions, ['A', 'B', 'A']);
  const validAttemptC = addAttempts(competition.id, secondExam.exam.id, secondExam.version.id, candidateC, secondExam.questions, ['A', 'A', 'A']);
  inDatabase(db => {
    const actorId = db.prepare('SELECT Id FROM Users WHERE Username = ?').get('organizer.demo').Id;
    db.prepare(`INSERT INTO ExamAttemptAdminEvents
      (AttemptId,ActorUserId,OccurredAtUtc,Action,Reason,PreviousSessionId,NewSessionId,ReplacementAttemptId)
      VALUES (?,?,?,?,?,?,?,NULL)`).run(validAttemptA, actorId, new Date().toISOString(), 'SessionTransferred',
      'Sự cố minh họa khi làm bài', null, 'replacement-session');
  });

  let results = await api(`${base}/results`, organizer.token);
  const candidateRows = results.rows.filter(row => row.isValid);
  assert.equal(candidateRows.find(row => row.attemptId === validAttemptA).totalScore, 3);
  assert.equal(candidateRows.find(row => row.attemptId === validAttemptA).scenarioScore, 2, 'Scoring honors the assigned approved snapshot after the draft changes');
  assert.equal(candidateRows.find(row => row.attemptId === validAttemptA).correctAnswersCount, 2);
  assert.equal(candidateRows.find(row => row.attemptId === validAttemptA).durationMilliseconds, 600000);
  assert.equal(candidateRows.find(row => row.attemptId === validAttemptC).correctAnswersCount, 3);
  assert.equal(candidateRows.find(row => row.attemptId === validAttemptA).rank, 1);
  assert.equal(candidateRows.find(row => row.attemptId === validAttemptB).rank, 1, 'Equal correct-count and duration results are tied');
  assert.equal(candidateRows.find(row => row.attemptId === validAttemptA).hadIncident, true, 'Attempt admin events are flagged for award review');
  assert.equal(candidateRows.find(row => row.attemptId === validAttemptC).rank, 1, 'Different ranking groups have independent ranks');
  const oldAttempt = results.rows.find(row => row.candidateCode === 'thisinh.demo' && row.attemptStatus === 'Invalidated');
  assert.ok(oldAttempt);
  assert.equal(oldAttempt.rank, null, 'Invalidated attempts are excluded from rankings');
  assert.equal(oldAttempt.isValid, false);
  pass('scores and correct-answer counts come from the assigned snapshot; groups rank independently, equal correct-count/duration results tie, and invalidated attempts are excluded');

  const noRuleCompetition = await api('/api/organizer/competitions', organizer.token, { status: 201, body: { name: 'Kiểm tra API tiêu chí xếp hạng cũ' } });
  assert.equal((await request(`/api/organizer/competitions/${noRuleCompetition.id}/results/scenario-tie-break`, organizer.token, {
    method: 'PUT', body: { enabled: true },
  })).status, 404, 'Legacy point-based ranking configuration is removed');
  inDatabase(db => {
    const submittedAt = db.prepare('SELECT SubmittedAtUtc FROM ExamAttempts WHERE Id = ?').get(validAttemptB).SubmittedAtUtc;
    db.prepare('UPDATE ExamAttempts SET StartedAtUtc = ? WHERE Id = ?')
      .run(new Date(Date.parse(submittedAt) - 5 * 60000).toISOString(), validAttemptB);
  });
  results = await api(`${base}/results`, organizer.token);
  assert.equal(results.rows.find(row => row.attemptId === validAttemptB).durationMilliseconds, 300000);
  assert.equal(results.rows.find(row => row.attemptId === validAttemptB).rank, 1, 'With equal correct counts, faster duration ranks first');
  assert.equal(results.rows.find(row => row.attemptId === validAttemptA).rank, 2);
  inDatabase(db => {
    const submittedAt = db.prepare('SELECT SubmittedAtUtc FROM ExamAttempts WHERE Id = ?').get(validAttemptB).SubmittedAtUtc;
    db.prepare('UPDATE ExamAttempts SET StartedAtUtc = ? WHERE Id = ?')
      .run(new Date(Date.parse(submittedAt) - 10 * 60000).toISOString(), validAttemptB);
  });
  results = await api(`${base}/results`, organizer.token);
  assert.equal(results.rows.find(row => row.attemptId === validAttemptC).rank, 1);

  const exportResponse = await request(`${base}/results/excel`, organizer.token);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type'), /spreadsheetml\.sheet/);
  const workbook = zipEntry(Buffer.from(await exportResponse.arrayBuffer()), 'xl/worksheets/sheet1.xml');
  assert.match(workbook, /Thí sinh B/);
  assert.match(workbook, /Điểm chuyên môn/);
  assert.match(workbook, /Số câu đúng/);
  assert.match(workbook, /Thời gian làm bài/);
  assert.match(workbook, /Đã loại/);
  assert.equal(workbook.includes('Không đưa vào bảng xếp hạng'), false);
  const workbookRows = workbook.match(/<row r="\d+">.*?<\/row>/g) || [];
  const rowFor = name => workbookRows.find(row => row.includes(name));
  const rankFor = name => Number(rowFor(name).match(/<c r="A\d+"><v>(.*?)<\/v><\/c>/)?.[1]);
  assert.equal(rankFor('Thí sinh B'), 1);
  assert.equal(rankFor('Thí sinh C'), 1);
  assert.equal(Number(rowFor('Thí sinh B').match(/<c r="G\d+"><v>(.*?)<\/v><\/c>/)?.[1]), 2);
  assert.equal(Number(rowFor('Thí sinh B').match(/<c r="H\d+"><v>(.*?)<\/v><\/c>/)?.[1]), 600);
  const invalidatedWorkbookRow = workbookRows.find(row => row.includes('thisinh.demo') && row.includes('Đã loại'));
  assert.ok(invalidatedWorkbookRow);
  assert.doesNotMatch(invalidatedWorkbookRow, /<c r="A\d+"><v>/, 'Invalidated attempt has no rank in Excel');

  const filteredResponse = await request(`${base}/results/excel?rankingGroupName=${encodeURIComponent('Nhóm riêng')}`, organizer.token);
  assert.equal(filteredResponse.status, 200);
  const filteredWorkbook = zipEntry(Buffer.from(await filteredResponse.arrayBuffer()), 'xl/worksheets/sheet1.xml');
  assert.match(filteredWorkbook, /Thí sinh C/);
  assert.doesNotMatch(filteredWorkbook, /Thí sinh B/);
  assert.equal((await request(`${base}/results?rankingGroupName=KhôngTồnTại`, organizer.token)).status, 400);
  pass('Excel exports match result scores/ranks and can be filtered to one ranking group');

  await api(`${base}/field-groups/${secondGroup.id}`, organizer.token, { method: 'PUT', body: { name: secondGroup.name, rankingGroupName: 'Nhóm tương đương' } });
  results = await api(`${base}/results`, organizer.token);
  assert.ok(results.rows.every(row => row.rankingGroupName === 'Nhóm tương đương'));
  assert.equal(results.rows.find(row => row.attemptId === validAttemptA).rank, 2);
  assert.equal(results.rows.find(row => row.attemptId === validAttemptC).rank, 1, 'Equivalent groups share one ranking with tied candidates');
  assert.equal(results.rows.find(row => row.attemptId === validAttemptB).rank, 2);
  pass('equivalent field groups share a ranking while preserving shared-place ranks under correct-answer/time ordering');

  inDatabase(db => db.prepare('UPDATE Competitions SET Status = ? WHERE Id = ?').run('Published', competition.id));
  const rankingGroup = results.rankingGroups[0];
  const eligible = results.rows.filter(row => row.isValid && row.rankingGroupName === rankingGroup && row.rank !== null)
    .sort((left, right) => left.rank - right.rank || left.candidateCode.localeCompare(right.candidateCode));
  const tiedRank = eligible.find(row => eligible.filter(candidate => candidate.rank === row.rank).length > 1)?.rank;
  assert.notEqual(tiedRank, undefined, 'Fixture includes a tie at the award boundary');
  const quantity = eligible.filter(row => row.rank < tiedRank).length + 1;
  const categories = [{ rankingGroupName: rankingGroup, awardName: 'Giải Nhất', quantity }];
  const proposal = await api(`${base}/awards/proposal`, organizer.token, { method: 'POST', body: { categories } });
  assert.ok(proposal.nominees.some(row => row.boundaryTie), 'Proposal marks ties at the award boundary');
  assert.ok(proposal.nominees.some(row => row.hadIncident), 'Proposal carries incident flags into award review');
  const nominees = proposal.nominees.map(row => ({ attemptId: row.attemptId, awardName: row.awardName, rankingGroupName: row.rankingGroupName }));
  assert.equal((await request(`${base}/awards/draft`, organizer.token, { method: 'PUT', body: {
    revision: 0, individualScoresPublished: true, tieReviewConfirmed: false, categories, nominees: nominees.slice(1), adjustmentReason: null,
  } })).status, 400, 'An adjusted list requires a reason');
  const initialDraft = await api(`${base}/awards/draft`, organizer.token, { method: 'PUT', body: {
    revision: 0, individualScoresPublished: true, tieReviewConfirmed: false, categories, nominees, adjustmentReason: null,
  } });
  assert.equal(initialDraft.awards.status, 'Draft');
  const candidateToken = (await login('thisinh.demo')).token;
  const candidateAwardsRoute = `/api/candidate/competitions/${competition.id}/awards`;
  let publicAwards = await api(candidateAwardsRoute, candidateToken);
  assert.equal(publicAwards.awardsPublished, false, 'Draft award list is not visible to candidates');
  assert.equal(publicAwards.individualScorePublished, true);
  assert.ok(publicAwards.individualScore?.totalScore != null, 'Configured individual score is visible before award publication');
  assert.equal(Object.hasOwn(publicAwards.individualScore, 'attemptId'), false, 'Candidate score responses contain no internal attempt identifier');
  assert.equal((await request(`${base}/awards/approve`, organizer.token, {
    method: 'POST', body: { revision: initialDraft.awards.revision, reason: 'Rà soát danh sách' },
  })).status, 400, 'Boundary ties must be reviewed before approval');

  const confirmedDraft = await api(`${base}/awards/draft`, organizer.token, { method: 'PUT', body: {
    revision: initialDraft.awards.revision, individualScoresPublished: true, tieReviewConfirmed: true, categories, nominees, adjustmentReason: null,
  } });
  await api(`${base}/awards/approve`, organizer.token, { method: 'POST', body: {
    revision: confirmedDraft.awards.revision, reason: 'Đã rà soát đồng hạng theo thể lệ',
  } });
  await api(`${base}/awards/publish`, organizer.token, { method: 'POST' });
  publicAwards = await api(candidateAwardsRoute, candidateToken);
  assert.equal(publicAwards.awardsPublished, true);
  assert.deepEqual(publicAwards.awards.map(row => row.candidateCode), proposal.nominees.map(row => row.candidateCode));
  assert.equal(Object.hasOwn(publicAwards.awards[0], 'totalScore'), false, 'Published awards do not bypass the individual-score publication setting');
  inDatabase(db => {
    const hash = db.prepare('SELECT Password FROM Users WHERE Id = ?').get(candidateA).Password;
    return Number(db.prepare('INSERT INTO Users (Username,Password,FullName,Department,Role,IsActive,IsDemo) VALUES (?,?,?,?,?,?,?)')
      .run('results.unassigned', hash, 'Chưa phân công', '', 'Candidate', 1, 0).lastInsertRowid);
  });
  const unassignedToken = (await login('results.unassigned')).token;
  assert.equal((await request(candidateAwardsRoute, unassignedToken)).status, 404, 'Unassigned candidates cannot read the award list directly');
  const awardExport = await request(`${base}/awards/excel`, organizer.token);
  assert.equal(awardExport.status, 200);
  const awardWorkbook = zipEntry(Buffer.from(await awardExport.arrayBuffer()), 'xl/worksheets/sheet1.xml');
  assert.match(awardWorkbook, /Giải Nhất/);
  assert.match(awardWorkbook, /Đồng hạng tại vị trí xét giải/);
  assert.ok(awardWorkbook.includes(publicAwards.awards[0].candidateCode));
  await api(`/api/organizer/competitions/${competition.id}/end`, organizer.token, { method: 'POST' });
  assert.equal((await api('/api/candidate/competitions', candidateToken)).some(item => item.id === competition.id && item.status === 'Ended'), true,
    'Candidates retain published results after the competition ends');
  pass('award boundary ties require review; draft visibility, approval, publication, candidate access, Excel, and competition ending work');

  const unauthorized = await request(`${base}/results`, (await login('thisinh.demo')).token);
  assert.equal(unauthorized.status, 403);
  console.log('Competition result integration checks passed.');
}

main().catch(error => { console.error(`FAIL ${error.stack || error.message}`); process.exitCode = 1; }).finally(async () => {
  try {
    await stopBackend();
    if (dataDir) {
      const target = path.resolve(dataDir);
      assert.equal(path.dirname(target), testsRoot, 'Cleanup must remain in the workspace test directory');
      assert.ok(path.basename(target).startsWith('results-'), 'Cleanup must target only this test run');
      await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  } catch (error) { console.error(`FAIL results test cleanup: ${error.message}`); process.exitCode = 1; }
});
