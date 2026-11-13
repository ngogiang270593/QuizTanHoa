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
const adminPassword = 'ExamIntegration_Test_2026!';
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

function request(route, { token, body, file, method = body === undefined && !file ? 'GET' : 'POST' } = {}) {
  let payload;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (file) {
    payload = new FormData();
    payload.append('file', new Blob([file.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), file.name || 'cau-hoi.xlsx');
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(`${origin}${route}`, { method, headers, body: payload, signal: AbortSignal.timeout(10000) });
}

async function api(route, token, { status = 200, ...options } = {}) {
  const response = await request(route, { token, ...options });
  const text = await response.text();
  assert.equal(response.status, status, `${options.method || (options.body ? 'POST' : 'GET')} ${route}: ${text}`);
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
  if (!await Promise.race([exit.then(() => true), delay(5000).then(() => false)])) throw new Error('Owned exam test backend did not stop');
}

function inDatabase(action) {
  const db = new DatabaseSync(path.join(dataDir, 'quiz_tanhoa.db'));
  try { db.exec('PRAGMA foreign_keys = ON'); return action(db); } finally { db.close(); }
}

async function login(username, password = demoPassword) {
  return api('/api/Auth/login', null, { body: { username, password } });
}

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const headers = ['Loại câu', 'Nhóm câu', 'Nội dung', 'Phương án A', 'Phương án B', 'Phương án C', 'Phương án D', 'Đáp án đúng', 'Điểm', 'Giải thích', 'Nguồn đối chiếu', 'Cần đối chiếu nguồn', 'Câu tình huống'];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Small standards-compliant stored ZIP fixtures: the production parser is not used to produce its own test input.
function zip(entries) {
  const files = [];
  const central = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const filename = Buffer.from(name);
    const bytes = Buffer.from(value);
    const crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    files.push(local, filename, bytes);
    const index = Buffer.alloc(46);
    index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(0x800, 8);
    index.writeUInt32LE(crc, 16); index.writeUInt32LE(bytes.length, 20); index.writeUInt32LE(bytes.length, 24); index.writeUInt16LE(filename.length, 28); index.writeUInt32LE(offset, 42);
    central.push(index, filename);
    offset += local.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, directory, end]);
}

function workbook(rows) {
  const sheet = [headers, ...rows].map((row, index) => `<row r="${index + 1}">${row.map((value, column) => `<c r="${String.fromCharCode(65 + column)}${index + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value ?? '')}</t></is></c>`).join('')}</row>`).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="CauHoi" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="utf-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
  });
}

const options = [{ key: 'A', text: 'Phương án minh họa A' }, { key: 'B', text: 'Phương án minh họa B' }];
const makeQuestion = (overrides = {}) => ({ type: 'SingleChoice', content: 'Câu hỏi minh họa dùng để kiểm tra hệ thống?', options, correctAnswer: 'A', points: 1, explanation: 'Giải thích minh họa.', source: '', group: 'Common', requiresSourceReview: false, sourceReviewed: false, ...overrides });

async function main() {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Use Node.js 24 or newer');
  assert.ok(fs.existsSync(dll), 'Build Release backend before exam tests');
  fs.mkdirSync(testsRoot, { recursive: true });
  dataDir = fs.mkdtempSync(path.join(testsRoot, 'exams-'));
  await startBackend();
  const admin = await login('admin', adminPassword);
  const organizer = await login('organizer.demo');
  const candidate = await login('thisinh.demo');
  const competition = await api('/api/organizer/competitions', organizer.token, { status: 201, body: { name: 'Cuộc thi minh họa kiểm tra Đề thi và Lịch thi' } });
  const base = `/api/organizer/competitions/${competition.id}`;
  const groups = await api(`${base}/field-groups`, admin.token);
  assert.equal(groups.length, 6);
  assert.deepEqual(groups.map(group => group.name.toLocaleLowerCase('vi-VN')).sort(), ['kiến thức chung', 'kinh tế và hạ tầng', 'đất đai và môi trường', 'tài chính', 'hành chính và tư pháp', 'văn hóa và xã hội'].sort());
  await api(`${base}/field-groups/${groups[1].id}`, admin.token, { method: 'PUT', body: { name: 'Kinh tế và hạ tầng theo phân công' } });
  assert.ok((await api(`${base}/field-groups`, admin.token)).some(group => group.name.endsWith('theo phân công')));
  const config = { name: 'Đề kiến thức chung minh họa', fieldGroupId: groups[0].id, durationMinutes: 30, targetQuestionCount: 30, commonQuestionCount: 10, specializedQuestionCount: 20 };
  const exam = await api(`${base}/exams`, admin.token, { status: 201, body: config });
  const second = await api(`${base}/exams`, admin.token, { status: 201, body: { ...config, name: 'Đề kinh tế và hạ tầng minh họa', fieldGroupId: groups[1].id } });
  assert.equal((await api(`${base}/exams`, admin.token)).length, 2);
  assert.equal(exam.durationMinutes, 30); assert.equal(exam.targetQuestionCount, 30); assert.equal(exam.commonQuestionCount, 10); assert.equal(exam.specializedQuestionCount, 20);
  assert.equal(exam.isDemo, true);
  pass('a competition has six editable field groups and supports two independent exams with the 30-question/30-minute suggested configuration');

  const examBase = `${base}/exams/${exam.id}`;
  for (const route of [`${base}/exams`, examBase, `${examBase}/questions`, `${examBase}/preview`, `${examBase}/versions`, `${base}/schedule`]) {
    assert.equal((await request(route)).status, 401);
    assert.equal((await request(route, { token: candidate.token })).status, 403);
  }
  assert.equal((await request(`${examBase}/approve`, { token: candidate.token, method: 'POST' })).status, 403);
  const otherCompetition = await api('/api/organizer/competitions', admin.token, { status: 201, body: { name: 'Cuộc thi khác kiểm tra phạm vi' } });
  assert.equal((await request(`/api/organizer/competitions/${otherCompetition.id}/exams/${exam.id}`, { token: admin.token })).status, 404);
  pass('exam, preview, approval, question and schedule APIs enforce server roles and competition ownership boundaries');

  const bankRoute = '/api/organizer/question-bank';
  assert.deepEqual(await api(bankRoute, admin.token), []);
  assert.equal((await request(bankRoute, { token: candidate.token })).status, 403);
  const bankQuestion = await api(bankRoute, admin.token, { status: 201, body: makeQuestion() });
  const bankCompetition = await api('/api/organizer/competitions', admin.token, { status: 201, body: { name: 'Kiểm tra liên kết ngân hàng câu hỏi' } });
  const bankCompetitionBase = `/api/organizer/competitions/${bankCompetition.id}`;
  const bankGroups = await api(`${bankCompetitionBase}/field-groups`, admin.token);
  const bankExam = await api(`${bankCompetitionBase}/exams`, admin.token, { status: 201, body: { name: 'Đề dùng câu hỏi liên kết', fieldGroupId: bankGroups[0].id, durationMinutes: 30, targetQuestionCount: 1, commonQuestionCount: 1, specializedQuestionCount: 0 } });
  const bankExamBase = `${bankCompetitionBase}/exams/${bankExam.id}`;
  assert.equal((await api(`${bankExamBase}/questions/from-bank`, admin.token, { body: { questionIds: [bankQuestion.id] } })).length, 1);
  assert.equal((await api(`${bankExamBase}/questions`, admin.token))[0].bankQuestionId, bankQuestion.id);
  const changedBankQuestion = { ...bankQuestion, content: 'Nội dung đã đồng bộ từ ngân hàng?' };
  await api(`${bankRoute}/${bankQuestion.id}`, admin.token, { method: 'PUT', body: changedBankQuestion });
  assert.equal((await api(`${bankExamBase}/questions`, admin.token))[0].content, changedBankQuestion.content);
  const bankApproval = await api(`${bankExamBase}/approve`, admin.token, { method: 'POST' });
  const bankSnapshot = await api(`${bankExamBase}/versions/${bankApproval.id}`, admin.token);
  const secondBankEdit = { ...changedBankQuestion, content: 'Nội dung mới chỉ vào bản nháp?' };
  await api(`${bankRoute}/${bankQuestion.id}`, admin.token, { method: 'PUT', body: secondBankEdit });
  assert.equal((await api(`${bankExamBase}/questions`, admin.token))[0].content, secondBankEdit.content);
  assert.equal((await api(bankExamBase, admin.token)).isApproved, false);
  assert.deepEqual((await api(`${bankExamBase}/versions/${bankApproval.id}`, admin.token)).snapshot, bankSnapshot.snapshot);
  assert.equal((await request(`${bankExamBase}/questions/from-bank`, { token: admin.token, body: { questionIds: [bankQuestion.id, bankQuestion.id] } })).status, 400);
  await api(`${bankRoute}/${bankQuestion.id}`, admin.token, { method: 'DELETE', status: 204 });
  assert.deepEqual(await api(bankRoute, admin.token), []);
  const retainedQuestion = (await api(`${bankExamBase}/questions`, admin.token))[0];
  assert.equal(retainedQuestion.bankQuestionId, null);
  assert.equal(retainedQuestion.content, secondBankEdit.content);
  pass('the question bank supports protected create/edit/delete, links questions into draft exams, syncs updates, and leaves approved snapshots and copied questions intact');

  await api(examBase, admin.token, { method: 'PUT', body: { ...config, targetQuestionCount: 2, commonQuestionCount: 1, specializedQuestionCount: 1 } });
  const missing = await api(`${examBase}/questions`, admin.token, { status: 201, body: makeQuestion({ correctAnswer: null }) });
  const tf = makeQuestion({ type: 'TrueFalse', content: 'Đây là một phát biểu minh họa?', options: [{ key: 'True', text: 'Đúng' }, { key: 'False', text: 'Sai' }], correctAnswer: 'True', group: 'Specialized', points: 2 });
  const trueFalse = await api(`${examBase}/questions`, admin.token, { status: 201, body: tf });
  let preview = await api(`${examBase}/preview`, admin.token);
  assert.equal(preview.questions.length, 2);
  assert.equal(preview.validation.canApprove, false);
  assert.match(JSON.stringify(preview.validation.errors), /đáp án|correctAnswer/i);
  assert.equal((await request(`${examBase}/approve`, { token: admin.token, method: 'POST' })).status, 400);
  await api(`${examBase}/questions/${missing.id}`, admin.token, { method: 'PUT', body: makeQuestion({ points: 0 }) });
  preview = await api(`${examBase}/preview`, admin.token);
  assert.equal(preview.validation.canApprove, false); assert.match(JSON.stringify(preview.validation.errors), /điểm|points/i);
  await api(`${examBase}/questions/${missing.id}`, admin.token, { method: 'PUT', body: makeQuestion() });
  preview = await api(`${examBase}/preview`, admin.token);
  assert.equal(preview.validation.canApprove, true);
  pass('incomplete drafts can be saved but preview and approval reject missing answers and invalid points; both question types validate');

  const legal = makeQuestion({ content: 'Câu hỏi minh họa về thời hạn xử lý được ghi trong tài liệu nào?', source: 'Tài liệu minh họa nội bộ; không phải nguồn pháp lý', requiresSourceReview: false, sourceReviewed: false });
  await api(`${examBase}/questions/${missing.id}`, admin.token, { method: 'PUT', body: legal });
  preview = await api(`${examBase}/preview`, admin.token);
  assert.equal(preview.validation.canApprove, true);
  assert.deepEqual(preview.validation.warnings, []);
  const approved = await api(`${examBase}/approve`, admin.token, { method: 'POST' });
  const oldVersion = await api(`${examBase}/versions/${approved.id}`, admin.token);
  assert.ok(oldVersion.snapshot); assert.match(oldVersion.hashSha256, /^[a-f0-9]{64}$/i);
  inDatabase(db => {
    const insert = db.prepare('INSERT INTO ExamAttempts (CompetitionId,ExamId,UserId,ExamVersionId,StartedAtUtc,DeadlineAtUtc,SubmittedAtUtc) VALUES (?,?,?,?,?,?,?)');
    const started = new Date().toISOString();
    const deadline = new Date(Date.now() + 1800000).toISOString();
    const legacyAttempt = insert.run(competition.id, exam.id, candidate.id, approved.id, started, deadline, null);
    db.prepare('UPDATE ExamAttempts SET IsInvalidated = 1 WHERE Id = ?').run(Number(legacyAttempt.lastInsertRowid));
    insert.run(competition.id, exam.id, candidate.id, approved.id, started, deadline, started);
    assert.throws(() => insert.run(competition.id, exam.id, candidate.id, 999999, started, deadline, null), /foreign key|constraint/i);
  });
  assert.equal((await request(`/api/organizer/competitions/${competition.id}`, { token: admin.token, method: 'DELETE' })).status, 409);
  const sameApproval = await api(`${examBase}/approve`, admin.token, { method: 'POST' });
  assert.equal(sameApproval.id, approved.id);
  await api(`${examBase}/questions/${missing.id}`, admin.token, { method: 'PUT', body: { ...legal, source: 'Nguồn minh họa đã thay đổi', sourceReviewed: false } });
  assert.equal((await api(`${examBase}/preview`, admin.token)).validation.canApprove, true);
  assert.equal((await api(examBase, admin.token)).isApproved, false);
  assert.deepEqual((await api(`${examBase}/versions/${approved.id}`, admin.token)).snapshot, oldVersion.snapshot);
  pass('source-review metadata no longer blocks approval; editing the draft still preserves the previous approved snapshot');

  await api(`${examBase}/questions/${missing.id}`, admin.token, { method: 'PUT', body: { ...legal, source: 'Nguồn minh họa đã thay đổi', sourceReviewed: true } });
  const nextApproval = await api(`${examBase}/approve`, admin.token, { method: 'POST' });
  assert.notEqual(nextApproval.id, approved.id); assert.equal(nextApproval.versionNumber, oldVersion.versionNumber + 1);
  assert.equal((await api(`${examBase}/versions`, admin.token)).length, 2);
  inDatabase(db => {
    assert.throws(() => db.prepare('UPDATE ApprovedExamVersions SET SnapshotJson = ? WHERE Id = ?').run('{}', approved.id), /immutable|bất biến|constraint|approved/i);
    assert.throws(() => db.prepare('DELETE FROM ApprovedExamVersions WHERE Id = ?').run(approved.id), /immutable|bất biến|constraint|approved/i);
    assert.throws(() => db.prepare('UPDATE ExamAttempts SET ExamVersionId = ? WHERE ExamId = ?').run(nextApproval.id, exam.id), /version|change|constraint/i);
  });
  await stopBackend(); await startBackend();
  assert.deepEqual((await api(`${examBase}/versions/${approved.id}`, admin.token)).snapshot, oldVersion.snapshot);
  assert.equal((await api(examBase, admin.token)).currentApprovedVersionId, nextApproval.id);
  inDatabase(db => {
    const attempts = db.prepare('SELECT ExamVersionId,SubmittedAtUtc FROM ExamAttempts WHERE ExamId = ? ORDER BY Id').all(exam.id);
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every(attempt => attempt.ExamVersionId === approved.id), 'Existing ongoing and submitted attempt references must keep the original version');
    assert.equal(attempts[0].SubmittedAtUtc, null);
    assert.equal(typeof attempts[1].SubmittedAtUtc, 'string');
  });
  pass('approved exam versions are immutable, independently numbered and durable across restart; subsequent approvals retain the original issued content');

  const invalidSchedule = { opensAtLocal: '10/01/2030 08:00', startDeadlineLocal: '10/01/2030 08:30', closesAtLocal: '10/01/2030 07:00' };
  const scheduleError = await api(`${base}/schedule`, admin.token, { status: 400, method: 'PUT', body: invalidSchedule });
  assert.match(JSON.stringify(scheduleError), /đóng|closes|thứ tự|sau/i);
  const schedule = await api(`${base}/schedule`, admin.token, { method: 'PUT', body: { ...invalidSchedule, closesAtLocal: '10/01/2030 08:40' } });
  assert.equal(schedule.opensAtUtc, '2030-01-10T01:00:00Z');
  assert.equal(schedule.startDeadlineUtc, '2030-01-10T01:30:00Z');
  assert.equal(schedule.closesAtUtc, '2030-01-10T01:40:00Z');
  assert.equal(schedule.opensAtLocal, '10/01/2030 08:00');
  assert.ok(schedule.warnings.length > 0, 'The final starter has only ten minutes for a thirty-minute exam');
  const savedSchedule = await api(`${base}/schedule`, admin.token);
  assert.equal(savedSchedule.opensAtLocal, '10/01/2030 08:00');
  assert.equal((await request(`${base}/schedule`, { token: admin.token, method: 'PUT', body: {
    opensAtLocal: '31/02/2030 08:00', startDeadlineLocal: '01/03/2030 08:30', closesAtLocal: '01/03/2030 08:40',
  } })).status, 400, 'Invalid calendar dates are rejected');
  const legacySchedule = await api(`${base}/schedule`, admin.token, { method: 'PUT', body: {
    opensAtLocal: '2030-01-10T08:00', startDeadlineLocal: '2030-01-10T08:30', closesAtLocal: '2030-01-10T08:40',
  } });
  assert.equal(legacySchedule.opensAtUtc, '2030-01-10T01:00:00Z', 'Legacy ISO local input remains accepted');
  assert.equal((await request(`${base}/schedule`, { token: admin.token, method: 'PUT', body: { ...invalidSchedule, opensAtLocal: '2030-01-10T08:00Z' } })).status, 400);
  pass('competition schedules use Vietnam local input and UTC storage, reject reversed or zoned input and warn about reduced time for late starters');

  const importBase = `${base}/exams/${second.id}`;
  const template = await request(`${importBase}/import-template`, { token: admin.token });
  assert.equal(template.status, 200); assert.match(template.headers.get('content-type') || '', /spreadsheetml/);
  const templateBytes = Buffer.from(await template.arrayBuffer()); assert.equal(templateBytes.subarray(0, 2).toString(), 'PK');
  const emptyTemplate = await api(`${importBase}/import-preview`, admin.token, { file: { bytes: templateBytes } });
  assert.equal(emptyTemplate.canImport, false, 'The instructions/sample sheets are not implicitly imported');
  const validRows = [
    ['Một đáp án đúng', 'Kiến thức chung', 'Câu hỏi minh họa nhập Excel?', 'Đáp án A minh họa', 'Đáp án B minh họa', '', '', 'A', '1', 'Giải thích minh họa', '', 'Không', 'Không'],
    ['Đúng/Sai', 'Chuyên môn', 'Thời hạn trong nội dung minh họa cần được kiểm tra nguồn?', '', '', '', '', 'Đúng', '2', 'Chỉ là dữ liệu kiểm tra', 'Tài liệu minh họa nội bộ', 'Có', 'Có'],
  ];
  const invalidRows = validRows.map(row => [...row]); invalidRows[0][7] = '';
  const beforeImport = (await api(`${importBase}/questions`, admin.token)).length;
  const invalidPreview = await api(`${importBase}/import-preview`, admin.token, { file: { bytes: workbook(invalidRows) } });
  assert.equal(invalidPreview.canImport, false);
  assert.ok(invalidPreview.rows.some(row => row.rowNumber === 2 && row.errors.length > 0), 'The missing answer must identify Excel row2');
  assert.equal((await request(`${importBase}/import`, { token: admin.token, file: { bytes: workbook(invalidRows) } })).status, 400);
  assert.equal((await api(`${importBase}/questions`, admin.token)).length, beforeImport);
  const importPreview = await api(`${importBase}/import-preview`, admin.token, { file: { bytes: workbook(validRows) } });
  assert.equal(importPreview.canImport, true); assert.equal(importPreview.totalRows, 2); assert.equal(importPreview.validRows, 2);
  assert.deepEqual(importPreview.rows.find(row => row.rowNumber === 3)?.warnings, [], 'Legacy source-review metadata no longer blocks or warns during import');
  assert.equal((await api(`${importBase}/questions`, admin.token)).length, beforeImport, 'Preview must never save questions');
  await api(`${importBase}/import`, admin.token, { file: { bytes: workbook(validRows) } });
  const importedQuestions = await api(`${importBase}/questions`, admin.token);
  assert.equal(importedQuestions.length, beforeImport + 2);
  assert.ok(importedQuestions.some(question => question.requiresSourceReview && !question.sourceReviewed));
  assert.ok(importedQuestions.some(question => question.isScenario), 'Excel can mark scenario questions');
  const invalidFile = await request(`${importBase}/import-preview`, { token: admin.token, file: { name: 'invalid.xlsx', bytes: Buffer.from('not an Excel file') } });
  assert.equal(invalidFile.status, 400);
  assert.equal((await request(`${importBase}/import-template`, { token: candidate.token })).status, 403);
  assert.equal((await request(`${importBase}/import-preview`, { token: candidate.token, file: { bytes: workbook(validRows) } })).status, 403);
  pass('Excel template, dry-run row diagnostics and atomic revalidated import preserve valid questions, block invalid row2 and keep source-review metadata optional');
  console.log('Exam, approval, schedule and Excel integration checks passed.');
}

module.exports = { workbook };

if (require.main === module) main().catch(error => { console.error(`FAIL ${error.stack || error.message}`); process.exitCode = 1; }).finally(async () => {
  try {
    await stopBackend();
    if (dataDir) {
      const target = path.resolve(dataDir);
      assert.equal(path.dirname(target), testsRoot, 'Cleanup must stay inside the test directory');
      assert.ok(path.basename(target).startsWith('exams-'), 'Cleanup must target this test run');
      await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  } catch (error) { console.error(`FAIL exam test cleanup: ${error.message}`); process.exitCode = 1; }
});
