'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { workbook } = require('./test-exams.cjs');

const projectRoot = path.resolve(__dirname, '..');
const testsRoot = path.join(projectRoot, '.tmp-tests');
const tokenKey = 'quiz_tanhoa.token';
const adminPassword = 'QuizBrowser_Test_123!';
const demoPassword = 'TanHoa@2026!';
const competitionSampleName = 'Hội thi trực tuyến tìm hiểu kiến thức, nghiệp vụ dành cho cán bộ, công chức xã Tân Hòa';
const artifactsRoot = path.join(projectRoot, '.artifacts');
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const pass = (message) => process.stdout.write(`PASS ${message}\n`);

let temporaryRoot;
let backend;
let browser;
let cdp;
let backendLog = '';
let browserLog = '';
let browserStage = 'not started';

function collectBackendLog(chunk) {
  backendLog = (backendLog + chunk.toString()).slice(-8000);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(check, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const exceptions = [];
  let sequence = 0;

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      exceptions.push(details.exception?.description || details.text || 'Unknown browser exception');
    }
    if (!message.id) return;
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    clearTimeout(operation.timer);
    if (message.error) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const operation of pending.values()) {
      clearTimeout(operation.timer);
      operation.reject(new Error('Chrome DevTools connection closed'));
    }
    pending.clear();
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome DevTools connection timed out')), 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Chrome DevTools connection failed')); }, { once: true });
  });

  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chrome DevTools command timed out: ${method}`));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  return { command, evaluate, exceptions, close: () => socket.close() };
}

async function pageWait(expression, description) {
  return waitFor(() => cdp.evaluate(expression), description);
}

async function reloadPage() {
  const marker = `reload-${Date.now()}-${Math.random()}`;
  await cdp.evaluate(`window.__quizBrowserReloadMarker = ${JSON.stringify(marker)}`);
  await cdp.command('Page.reload');
  await pageWait(`window.__quizBrowserReloadMarker !== ${JSON.stringify(marker)} && document.readyState === 'complete'`, 'page reload');
}

async function enterCredentials(username, password) {
  await cdp.evaluate(`(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [selector, value] of ${JSON.stringify([['#username', username], ['#password', password]])}) {
      const input = document.querySelector(selector);
      if (!input) throw new Error('Missing login input: ' + selector);
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);
  await cdp.evaluate(`document.querySelector('#password').closest('form').requestSubmit()`);
}

async function setFields(fields) {
  await cdp.evaluate(`(() => {
    for (const [selector, value] of ${JSON.stringify(fields)}) {
      const input = document.querySelector(selector);
      if (!input) throw new Error('Missing field: ' + selector);
      const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);
}

async function clickText(text) {
  await cdp.evaluate(`(() => {
    const item = [...document.querySelectorAll('a,button')].find(element => element.textContent.trim().replace('＋', '').trim() === ${JSON.stringify(text)});
    if (!item) throw new Error('Missing action: ' + ${JSON.stringify(text)});
    item.click();
  })()`);
}

async function waitForWelcome(username, roleLabel) {
  await pageWait(`!document.querySelector('#username') && /chào mừng/i.test(document.body.innerText) && document.body.innerText.includes(${JSON.stringify(username)}) && document.body.innerText.includes(${JSON.stringify(roleLabel)}) && !!localStorage.getItem(${JSON.stringify(tokenKey)})`, 'authenticated welcome screen');
  const body = await cdp.evaluate('document.body.innerText');
  assert.ok(body.includes(username), 'The welcome screen should identify the signed-in account');
  assert.ok(body.includes(roleLabel), 'The welcome screen should identify the account role');
}

async function navigatePage(baseUrl, route) {
  const marker = `navigate-${Date.now()}-${Math.random()}`;
  await cdp.evaluate(`window.__quizBrowserNavigateMarker = ${JSON.stringify(marker)}`);
  await cdp.command('Page.navigate', { url: `${baseUrl}${route}` });
  await pageWait(`window.__quizBrowserNavigateMarker !== ${JSON.stringify(marker)} && document.readyState === 'complete'`, `navigate ${route}`);
}

async function screenshot(filename) {
  fs.mkdirSync(artifactsRoot, { recursive: true });
  const result = await cdp.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(artifactsRoot, filename), Buffer.from(result.data, 'base64'));
}

async function assertNoOverflow(description) {
  const dimensions = await cdp.evaluate(`({ viewport: window.innerWidth, page: document.documentElement.scrollWidth, body: document.body.scrollWidth })`);
  assert.ok(dimensions.page <= dimensions.viewport && dimensions.body <= dimensions.viewport, `${description} overflows horizontally: ${JSON.stringify(dimensions)}`);
  pass(`${description} has no horizontal overflow`);
}

async function clickLogout() {
  await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => /đăng xuất/i.test(item.textContent));
    if (!button) throw new Error('Logout button was not found');
    button.click();
  })()`);
  await pageWait(`!!document.querySelector('#username') && localStorage.getItem(${JSON.stringify(tokenKey)}) === null`, 'logout');
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(4000),
  ]);
}

async function cleanup() {
  if (cdp) {
    try { await cdp.command('Browser.close'); } catch { /* Chrome may close before replying. */ }
    cdp.close();
  }
  await stopChild(browser);
  await stopChild(backend);
  if (temporaryRoot) {
    const target = path.resolve(temporaryRoot);
    const parent = path.resolve(testsRoot);
    assert.equal(path.dirname(target), parent, 'Cleanup must stay inside the test directory');
    assert.ok(path.basename(target).startsWith('browser-'), 'Cleanup must target this test run');
    await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

async function main() {
  assert.equal(typeof WebSocket, 'function', 'Run this script with Node.js 24 or newer');
  assert.ok(fs.existsSync(chromePath), `Chrome was not found at ${chromePath}. Set CHROME_PATH to its executable.`);
  const backendRoot = path.join(projectRoot, 'backend');
  const testPublished = process.env.QUIZ_TANHOA_TEST_PUBLISHED === '1';
  const backendDll = testPublished
    ? path.join(projectRoot, 'publish', 'web', 'Quiz_TanHoa.Api.dll')
    : path.join(backendRoot, 'bin', 'Release', 'net8.0', 'Quiz_TanHoa.Api.dll');
  assert.ok(fs.existsSync(backendDll), 'Build the backend in Release configuration before running browser tests');
  assert.ok(fs.existsSync(path.join(projectRoot, 'frontend', 'dist-web', 'index.html')), 'Build the frontend before running browser tests');
  fs.mkdirSync(testsRoot, { recursive: true });
  temporaryRoot = fs.mkdtempSync(path.join(testsRoot, 'browser-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const backendEnv = { ...process.env };
  delete backendEnv.QUIZ_TANHOA_JWT_KEY;
  delete backendEnv.QUIZ_TANHOA_WEB_ROOT;
  Object.assign(backendEnv, {
    ASPNETCORE_ENVIRONMENT: 'Production',
    ASPNETCORE_URLS: baseUrl,
    QUIZ_TANHOA_DATA_DIR: path.join(temporaryRoot, 'data'),
    QUIZ_TANHOA_ADMIN_PASSWORD: adminPassword,
    QUIZ_TANHOA_SEED_DEMO: 'true',
  });
  if (!testPublished) backendEnv.QUIZ_TANHOA_WEB_ROOT = path.join(projectRoot, 'frontend', 'dist-web');
  backend = spawn(process.env.DOTNET_HOST_PATH || 'dotnet', [backendDll], {
    cwd: testPublished ? projectRoot : backendRoot,
    env: backendEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let backendStartError;
  backend.once('error', (error) => { backendStartError = error; });
  backend.stdout.on('data', collectBackendLog);
  backend.stderr.on('data', collectBackendLog);
  await waitFor(async () => {
    if (backendStartError) throw backendStartError;
    if (backend.exitCode !== null) throw new Error(`Backend exited with code ${backend.exitCode}: ${backendLog}`);
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  }, 'backend health');
  const html = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type') || '', /text\/html/i);
  pass('backend health and built frontend are served');

  const profileDir = path.join(temporaryRoot, 'chrome-profile');
  browser = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--in-process-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--enable-logging=stderr',
    '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.on('data', chunk => { browserLog = (browserLog + chunk.toString()).slice(-6000); });
  let browserStartError;
  browser.once('error', (error) => { browserStartError = error; });
  const debuggingPort = await waitFor(() => {
    if (browserStartError) throw browserStartError;
    if (browser.exitCode !== null) throw new Error(`Chrome exited with code ${browser.exitCode}`);
    const activePortFile = path.join(profileDir, 'DevToolsActivePort');
    if (!fs.existsSync(activePortFile)) return false;
    const candidate = Number(fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/)[0]);
    return Number.isInteger(candidate) && candidate > 0 ? candidate : false;
  }, 'Chrome debugging port');
  const pageTarget = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`, { signal: AbortSignal.timeout(1500) });
    const targets = await response.json();
    return targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  }, 'Chrome page target');
  cdp = await connectCdp(pageTarget.webSocketDebuggerUrl);
  browserStage = 'Page.enable';
  await cdp.command('Page.enable');
  browserStage = 'Runtime.enable';
  await cdp.command('Runtime.enable');
  browserStage = 'timezone override';
  await cdp.command('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
  browserStage = 'device metrics';
  await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  browserStage = 'navigate login';
  await cdp.command('Page.navigate', { url: baseUrl });
  await pageWait(`document.readyState === 'complete' && !!document.querySelector('#username') && !!document.querySelector('#password')`, 'login form');
  assert.match(await cdp.evaluate('document.body.innerText'), /Tân Hòa/i);
  await cdp.evaluate(`localStorage.setItem('quiz_browser_sentinel', 'preserve-me')`);
  pass('desktop login screen loads with its JavaScript assets');
  await screenshot('login-desktop.png');
  await assertNoOverflow('1280 x 900 desktop login');

  await enterCredentials('admin', 'wrong-password-for-browser-test');
  await pageWait(`!!document.querySelector('#username') && /không đúng|không chính xác|sai|thất bại/i.test(document.body.innerText)`, 'wrong-password error');
  assert.equal(await cdp.evaluate(`localStorage.getItem(${JSON.stringify(tokenKey)})`), null);
  pass('wrong password displays an error and keeps the login form');

  await enterCredentials('admin', adminPassword);
  await waitForWelcome('admin', 'Ban Tổ chức');
  await pageWait(`location.pathname === '/ban-to-chuc'`, 'organizer route');
  pass('correct credentials display the signed-in admin account');
  await reloadPage();
  await waitForWelcome('admin', 'Ban Tổ chức');
  pass('reload restores the authenticated session');
  await pageWait(`!!document.querySelector('.demo-count-note') && document.querySelector('.demo-count-note').textContent.includes('Các số liệu tài khoản ở trên bao gồm 2 tài khoản minh họa.')`, 'Vietnamese demo-count label');
  await screenshot('dashboard-desktop.png');
  await assertNoOverflow('1280 x 900 organizer dashboard');

  await pageWait(`!!document.querySelector('[data-testid="vn-clock"]')`, 'Vietnam clock');
  const clock = await cdp.evaluate(`(() => {
    const element = document.querySelector('[data-testid="vn-clock"]');
    const format = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false });
    return { deviceZone: Intl.DateTimeFormat().resolvedOptions().timeZone, text: element.innerText, times: [-60000, 0, 60000].map(offset => format.format(new Date(Date.now() + offset))) };
  })()`);
  assert.equal(clock.deviceZone, 'America/New_York');
  assert.ok(clock.times.some(time => clock.text.includes(time)), `Clock should show Vietnam time: ${JSON.stringify(clock)}`);
  pass('Vietnam clock remains correct when the device uses America/New_York');

  await navigatePage(baseUrl, '/ban-to-chuc/cuoc-thi');
  await pageWait(`/Chưa có cuộc thi/i.test(document.body.innerText)`, 'empty competition list');
  assert.ok(await cdp.evaluate(`!!document.querySelector('a[href="/ban-to-chuc/cuoc-thi"]')`), 'Organizer navigation exposes competitions');
  await clickText('Tạo cuộc thi');
  await pageWait(`location.pathname === '/ban-to-chuc/cuoc-thi/tao' && !!document.querySelector('#competition-name')`, 'create competition form');
  await clickText('Dùng tên mẫu');
  assert.equal(await cdp.evaluate(`document.querySelector('#competition-name').value`), competitionSampleName);
  const competitionDescription = 'Mô tả cuộc thi được lưu bằng tiếng Việt.';
  const competitionRules = 'Thể lệ minh bạch.\n<script>window.competitionXss = true</script>';
  await setFields([['#competition-description', competitionDescription], ['#competition-rules', competitionRules]]);
  await cdp.evaluate(`document.querySelector('#competition-name').closest('form').requestSubmit()`);
  await pageWait(`location.pathname.startsWith('/ban-to-chuc/cuoc-thi/') && location.pathname.endsWith('/chinh-sua') && !!document.querySelector('#competition-name')`, 'created competition edit route');
  await pageWait(`/Đã tạo cuộc thi/i.test(document.body.innerText)`, 'competition creation confirmation');
  const competitionEditPath = await cdp.evaluate('location.pathname');
  await reloadPage();
  await pageWait(`!!document.querySelector('#competition-name') && document.querySelector('#competition-name').value === ${JSON.stringify(competitionSampleName)}`, 'stored competition after reload');
  assert.equal(await cdp.evaluate(`document.querySelector('#competition-description').value`), competitionDescription);
  assert.equal(await cdp.evaluate(`document.querySelector('#competition-rules').value`), competitionRules);
  assert.match(await cdp.evaluate('document.body.innerText'), /Nháp/);
  assert.equal(await cdp.evaluate('window.competitionXss'), undefined);
  pass('organizer creates the supplied Vietnamese sample as a draft; name, description and rules survive reload safely');

  const changedCompetitionName = `${competitionSampleName} — đã chỉnh sửa`;
  await setFields([['#competition-name', changedCompetitionName]]);
  await cdp.evaluate(`document.querySelector('#competition-name').closest('form').requestSubmit()`);
  await pageWait(`/Đã lưu thay đổi/i.test(document.body.innerText)`, 'edited competition saved');
  await reloadPage();
  await pageWait(`!!document.querySelector('#competition-name') && document.querySelector('#competition-name').value === ${JSON.stringify(changedCompetitionName)}`, 'stored edited competition');
  pass('opening and editing an existing competition persists its new name after reload');

  await setFields([['#competition-name', '']]);
  await cdp.evaluate(`document.querySelector('#competition-name').closest('form').requestSubmit()`);
  assert.ok(await cdp.evaluate(`document.querySelector('#competition-name').validity.valueMissing || /Vui lòng nhập tên cuộc thi|Tên cuộc thi.*bắt buộc/i.test(document.body.innerText)`), 'An empty competition name must be rejected');
  assert.equal(await cdp.evaluate('location.pathname'), competitionEditPath);
  await reloadPage();
  await pageWait(`!!document.querySelector('#competition-name') && document.querySelector('#competition-name').value === ${JSON.stringify(changedCompetitionName)}`, 'blank edit cannot replace stored name');
  pass('saving a blank name is blocked and preserves the previously stored competition');

  await cdp.command('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  await assertNoOverflow('320 x 740 competition editing form');
  await screenshot('competition-edit-mobile.png');
  await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigatePage(baseUrl, '/ban-to-chuc/cuoc-thi');
  await pageWait(`document.body.innerText.includes(${JSON.stringify(changedCompetitionName)})`, 'edited competition in list');
  await assertNoOverflow('1280 x 900 competition list');
  await screenshot('competitions-desktop.png');

  const competitionId = competitionEditPath.split('/')[3];
  const examsPath = `/ban-to-chuc/cuoc-thi/${competitionId}/de-thi`;
  const schedulePath = `/ban-to-chuc/cuoc-thi/${competitionId}/lich-thi`;
  await navigatePage(baseUrl, examsPath);
  await pageWait(`/Chưa có đề thi/.test(document.body.innerText)`, 'exam list in competition');
  assert.ok(await cdp.evaluate(`!![...document.querySelectorAll('a')].find(item => item.textContent.trim() === 'Lịch thi')`));
  await clickText('Tạo đề thi');
  await pageWait(`!!document.querySelector('#exam-name') && document.querySelector('#exam-field-group').options.length >= 7`, 'exam configuration form with sample groups');
  assert.equal(await cdp.evaluate(`document.querySelector('#exam-duration').value`), '30');
  assert.equal(await cdp.evaluate(`document.querySelector('#exam-target-count').value`), '30');
  await setFields([['#exam-name', 'Đề kiến thức chung minh họa'], ['#exam-target-count', '1']]);
  await clickText('Lưu đề thi');
  await pageWait(`location.pathname.startsWith(${JSON.stringify(examsPath + '/')}) && !!document.querySelector('#exam-name') && /Thêm câu hỏi/.test(document.body.innerText)`, 'first exam editor');
  const firstExamPath = await cdp.evaluate('location.pathname');
  await navigatePage(baseUrl, examsPath);
  await pageWait(`/Đề kiến thức chung minh họa/.test(document.body.innerText)`, 'first exam in list');
  await clickText('Tạo đề thi');
  await pageWait(`!!document.querySelector('#exam-name') && document.querySelector('#exam-field-group').options.length >= 7`, 'second exam form');
  const secondFieldGroup = await cdp.evaluate(`document.querySelector('#exam-field-group').options[2].value`);
  await setFields([['#exam-name', 'Đề kinh tế và hạ tầng minh họa'], ['#exam-field-group', secondFieldGroup]]);
  await clickText('Lưu đề thi');
  await pageWait(`location.pathname.startsWith(${JSON.stringify(examsPath + '/')}) && /Thêm câu hỏi/.test(document.body.innerText)`, 'second exam editor');
  const secondExamPath = await cdp.evaluate('location.pathname');
  await navigatePage(baseUrl, examsPath);
  await pageWait(`/Đề kiến thức chung minh họa/.test(document.body.innerText) && /Đề kinh tế và hạ tầng minh họa/.test(document.body.innerText)`, 'two exams in the same competition');
  await screenshot('exams-desktop.png');
  pass('a competition exposes Exam and Schedule tabs, creates two field-specific exams and shows the editable 30-question/30-minute suggested configuration');

  await navigatePage(baseUrl, firstExamPath);
  await pageWait(`!!document.querySelector('#exam-name') && /Thêm câu hỏi/.test(document.body.innerText)`, 'exam question editor');
  await clickText('Thêm câu hỏi');
  await pageWait(`!!document.querySelector('#question-content')`, 'draft question form');
  await setFields([['#question-content', 'Câu hỏi minh họa kiểm tra bản xem trước?'], ['#question-option-A', 'Phương án A minh họa'], ['#question-option-B', 'Phương án B minh họa'], ['#question-option-C', 'Phương án C minh họa'], ['#question-option-D', 'Phương án D minh họa']]);
  await clickText('Lưu nháp');
  await pageWait(`!document.querySelector('#question-content') && /Đã lưu câu hỏi/.test(document.body.innerText)`, 'incomplete question stored as draft');
  await clickText('Duyệt đề');
  await pageWait(`!!document.querySelector('#exam-preview') && /Chưa chọn một đáp án đúng hợp lệ|Thiếu đáp án|Chưa chọn đáp án/.test(document.querySelector('#exam-preview').innerText)`, 'approval rejects missing answer with preview diagnostics');
  assert.ok(!(await cdp.evaluate(`document.querySelector('.exam-status')?.textContent || ''`)).includes('Đã duyệt'));
  await clickText('Xem trước đề');
  await pageWait(`!!document.querySelector('#exam-preview') && /Câu hỏi minh họa kiểm tra bản xem trước/.test(document.querySelector('#exam-preview').innerText)`, 'exam preview content');
  assert.match(await cdp.evaluate(`document.querySelector('#exam-preview').innerText`), /Phương án A minh họa/);
  await cdp.evaluate(`document.querySelector('#exam-preview').scrollIntoView({block:'start'})`);
  await screenshot('exam-preview-desktop.png');
  pass('an incomplete question saves as a draft; approval is blocked with a clear missing-answer error and the preview renders its options');

  await clickText('Sửa câu hỏi');
  await pageWait(`!!document.querySelector('#question-answer')`, 'edit question answer');
  await cdp.evaluate(`document.querySelector('#question-answer-A').click()`);
  await clickText('Lưu câu hỏi');
  await pageWait(`!document.querySelector('#question-content') && /Đã lưu câu hỏi/.test(document.body.innerText)`, 'valid question saved');
  await clickText('Duyệt đề');
  await pageWait(`/Đã duyệt đề thi/.test(document.body.innerText) && !!document.querySelector('#exam-preview') && /Phiên bản đã duyệt 1/.test(document.querySelector('#exam-preview').innerText)`, 'approved immutable version preview');
  assert.match(await cdp.evaluate(`document.querySelector('#exam-preview').innerText`), /SHA-256/);
  pass('a valid exam can be approved and its fixed version is visible with a SHA-256 verification code');

  await navigatePage(baseUrl, secondExamPath);
  await pageWait(`/Nhập từ Excel/.test(document.body.innerText)`, 'Excel question import action');
  await clickText('Nhập từ Excel');
  await pageWait(`!!document.querySelector('#exam-import-file')`, 'Excel workbook chooser');
  const importRows = [['Một đáp án đúng', 'Kiến thức chung', 'MINH HỌA nhập câu hỏi từ tệp Excel?', 'Phương án A', 'Phương án B', '', '', '', '1', 'Dữ liệu kiểm tra minh họa', '', 'Không']];
  const invalidWorkbook = path.join(temporaryRoot, 'question-missing-answer.xlsx');
  const validWorkbook = path.join(temporaryRoot, 'question-valid.xlsx');
  fs.writeFileSync(invalidWorkbook, workbook(importRows));
  importRows[0][7] = 'A';
  fs.writeFileSync(validWorkbook, workbook(importRows));
  async function chooseWorkbook(file) {
    const { root } = await cdp.command('DOM.getDocument');
    const { nodeId } = await cdp.command('DOM.querySelector', { nodeId: root.nodeId, selector: '#exam-import-file' });
    await cdp.command('DOM.setFileInputFiles', { nodeId, files: [file] });
  }
  await chooseWorkbook(invalidWorkbook);
  await clickText('Xem trước dữ liệu Excel');
  await pageWait(`!!document.querySelector('.exam-import-preview') && /Dòng 2/.test(document.querySelector('.exam-import-preview').innerText) && /Cần sửa/.test(document.querySelector('.exam-import-preview').innerText)`, 'Excel preview identifies missing answer at row2');
  assert.ok(await cdp.evaluate(`Array.from(document.querySelectorAll('.exam-import button')).some(button => button.textContent.trim().startsWith('Nhập ') && button.textContent.trim().endsWith(' câu hỏi') && button.disabled)`));
  await cdp.evaluate(`document.querySelector('.exam-import-preview').scrollIntoView({block:'start'})`);
  await screenshot('excel-preview-errors.png');
  await chooseWorkbook(validWorkbook);
  await clickText('Xem trước dữ liệu Excel');
  await pageWait(`!!document.querySelector('.exam-import-preview') && /Có thể nhập toàn bộ dữ liệu/.test(document.querySelector('.exam-import-preview').innerText)`, 'corrected Excel workbook preview');
  await clickText('Nhập 1 câu hỏi');
  await pageWait(`!document.querySelector('#exam-import-file') && /Đã nhập các câu hỏi hợp lệ/.test(document.body.innerText) && /MINH HỌA nhập câu hỏi từ tệp Excel/.test(document.body.innerText)`, 'corrected Excel question imported into draft');
  pass('Excel preview reports row2 with a missing answer, blocks import and then imports the corrected workbook');

  await navigatePage(baseUrl, schedulePath);
  await pageWait(`!!document.querySelector('#schedule-opens')`, 'competition schedule form');
  await setFields([['#schedule-opens', '10/01/2030 08:00:01'], ['#schedule-start-deadline', '10/01/2030 08:30:02'], ['#schedule-closes', '10/01/2030 07:00:00']]);
  await clickText('Lưu lịch thi');
  await pageWait(`/đóng thi.*sau|đóng thi.*sớm|giờ đóng.*sau|giờ đóng.*sớm/i.test(document.body.innerText)`, 'invalid closing time message');
  await setFields([['#schedule-closes', '10/01/2030 08:40:03']]);
  await clickText('Lưu lịch thi');
  await pageWait(`/Đã lưu lịch thi/.test(document.body.innerText) && /sát hạn|ít thời gian|chỉ còn/i.test(document.body.innerText)`, 'saved schedule and late-starter warning');
  await reloadPage();
  await pageWait(`!!document.querySelector('#schedule-opens') && document.querySelector('#schedule-opens').value === '10/01/2030 08:00:01'`, 'Vietnam schedule survives reload on a New York device');
  await screenshot('schedule-desktop.png');
  pass('schedule form rejects closing before opening, saves Vietnam local time and warns when a late starter receives fewer than thirty minutes');

  await navigatePage(baseUrl, firstExamPath);
  await pageWait(`!!document.querySelector('#exam-name') && /Thêm câu hỏi/.test(document.body.innerText)`, 'exam editor for mobile layout');
  await cdp.command('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  await assertNoOverflow('320 x 740 exam editor');
  await screenshot('exam-editor-mobile.png');
  await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  await navigatePage(baseUrl, '/ban-to-chuc/tai-khoan');
  await pageWait(`/organizer\\.demo/.test(document.body.innerText) && /thisinh\\.demo/.test(document.body.innerText)`, 'organizer account list');
  assert.match(await cdp.evaluate('document.body.innerText'), /minh họa/i);
  await cdp.command('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  await assertNoOverflow('320 x 740 mobile organizer account list');
  await screenshot('accounts-mobile.png');
  await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await pageWait(`/Thông tin tài khoản/.test(document.body.innerText) && /Chức năng/.test(document.body.innerText) && !!document.querySelector('.account-row [aria-label="Sửa thisinh.demo"]')`, 'two-column account list and edit action');
  const candidateAccountRow = await cdp.evaluate(`(() => document.querySelector('.account-row [aria-label="Sửa thisinh.demo"]')?.click())()`);
  assert.equal(candidateAccountRow, undefined);
  await pageWait(`!!document.querySelector('.account-row #account-full-name')`, 'inline account information editor');
  await setFields([['#account-full-name', 'Thí sinh đã cập nhật'], ['#account-department', 'Phòng Kinh tế']]);
  await cdp.evaluate(`document.querySelector('.account-row [aria-label="Lưu thay đổi"]')?.click()`);
  await pageWait(`/Đã cập nhật thông tin tài khoản/.test(document.body.innerText) && /Thí sinh đã cập nhật/.test(document.body.innerText) && /Phòng Kinh tế/.test(document.body.innerText)`, 'account information update');
  await clickText('Thêm tài khoản thí sinh');
  await pageWait(`!!document.querySelector('#account-new-username')`, 'new candidate account form');
  await setFields([['#account-new-username', 'browser.new.candidate'], ['#account-new-full-name', 'Thí sinh giao diện mới'], ['#account-new-department', 'Phòng Kinh tế']]);
  await clickText('Tạo tài khoản');
  await pageWait(`/Đã tạo tài khoản/.test(document.body.innerText) && /browser\\.new\\.candidate/.test(document.body.innerText)`, 'new candidate account creation');
  await cdp.evaluate(`document.querySelector('.account-row [aria-label="Xóa browser.new.candidate"]')?.click()`);
  await pageWait(`!!document.querySelector('.account-row [aria-label="Xác nhận xóa browser.new.candidate"]')`, 'candidate account deletion confirmation');
  await cdp.evaluate(`document.querySelector('.account-row [aria-label="Xác nhận xóa browser.new.candidate"]')?.click()`);
  await pageWait(`/Đã xóa tài khoản @browser\\.new\\.candidate/.test(document.body.innerText)`, 'candidate account deletion');
  pass('organizer can create, update and delete candidate accounts from the account list');

  await navigatePage(baseUrl, '/ban-to-chuc/ngan-hang-cau-hoi');
  await pageWait(`/Ngân hàng câu hỏi/.test(document.body.innerText) && !![...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Thêm câu hỏi')`, 'question bank workspace');
  await clickText('Thêm câu hỏi');
  await pageWait(`!!document.querySelector('#question-content')`, 'new bank question form');
  await pageWait(`['A', 'B', 'C', 'D'].every(key => !!document.querySelector('#question-option-' + key)) && !!document.querySelector('#question-points') && !!document.querySelector('dialog[open]')`, 'question modal with point configuration');
  await setFields([['#question-content', 'Câu hỏi ngân hàng cho kiểm tra giao diện?'], ['#question-option-A', 'Phương án A'], ['#question-option-B', 'Phương án B'], ['#question-option-C', 'Phương án C'], ['#question-option-D', 'Phương án D']]);
  await cdp.evaluate(`document.querySelector('#question-answer-A').click()`);
  await clickText('Lưu câu hỏi');
  await pageWait(`/Câu hỏi ngân hàng cho kiểm tra giao diện/.test(document.body.innerText) && /Đã lưu câu hỏi/.test(document.body.innerText)`, 'bank question creation');
  await clickText('Sửa câu hỏi');
  await setFields([['#question-content', 'Câu hỏi ngân hàng đã được cập nhật?']]);
  await clickText('Lưu câu hỏi');
  await pageWait(`/Câu hỏi ngân hàng đã được cập nhật/.test(document.body.innerText) && /Các đề nháp liên kết đã được đồng bộ/.test(document.body.innerText)`, 'bank question edit');
  await clickText('Xóa');
  await clickText('Xác nhận xóa');
  await pageWait(`/Chưa có câu hỏi phù hợp/.test(document.body.innerText) && /Đã xóa câu hỏi khỏi ngân hàng/.test(document.body.innerText)`, 'bank question deletion');
  pass('organizer can create, edit and delete question-bank entries from the dedicated workspace');

  await navigatePage(baseUrl, '/tai-khoan');
  await pageWait(`!document.querySelector('#username') && /admin/.test(document.body.innerText)`, 'account profile');
  await navigatePage(baseUrl, '/thi-sinh');
  await pageWait(`/403|không có quyền|không được phép/i.test(document.body.innerText)`, 'organizer forbidden candidate route');
  assert.ok(await cdp.evaluate(`!!localStorage.getItem(${JSON.stringify(tokenKey)})`));
  pass('organizer accounts/profile deep links work; cross-role route is forbidden without ending the session');

  const examId = firstExamPath.split('/')[5];
  const publishedAttemptFixture = await cdp.evaluate(`(async () => {
    const token = localStorage.getItem(${JSON.stringify(tokenKey)});
    const headers = { Authorization: String.fromCharCode(66, 101, 97, 114, 101, 114, 32) + token, 'Content-Type': 'application/json' };
    const localNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const localMinute = value => value.toISOString().slice(0, 16);
    const schedule = await fetch('/api/organizer/competitions/${competitionId}/schedule', { method: 'PUT', headers, body: JSON.stringify({
      opensAtLocal: localMinute(new Date(localNow.getTime() - 60000)),
      startDeadlineLocal: localMinute(new Date(localNow.getTime() + 30 * 60000)),
      closesAtLocal: localMinute(new Date(localNow.getTime() + 60 * 60000))
    }) });
    if (!schedule.ok) throw new Error('Could not set open test schedule: ' + await schedule.text());
    const optionsResponse = await fetch('/api/organizer/competitions/${competitionId}/assignment-options', { headers });
    const options = await optionsResponse.json();
    const candidate = options.accounts.find(account => account.username === 'thisinh.demo');
    if (!candidate) throw new Error('Demo candidate is missing');
    const assigned = await fetch('/api/organizer/competitions/${competitionId}/assignments', { method: 'POST', headers, body: JSON.stringify({ examId: ${examId}, userIds: [candidate.id] }) });
    if (!assigned.ok) throw new Error('Could not assign the browser candidate: ' + await assigned.text());
    const published = await fetch('/api/organizer/competitions/${competitionId}/publish', { method: 'POST', headers });
    if (!published.ok) throw new Error('Could not publish browser test competition: ' + await published.text());
    return { schedule: schedule.status, assigned: assigned.status, published: published.status };
  })()`);
  assert.equal(publishedAttemptFixture.published, 200);
  pass('browser fixture publishes the approved exam and assigns it to the demo candidate');

  await navigatePage(baseUrl, `/ban-to-chuc/cuoc-thi/${competitionId}/phan-cong`);
  await pageWait(`document.body.innerText.includes('Kết quả và xếp hạng') && document.querySelector('[data-testid="competition-results"]')?.innerText.includes('thisinh.demo') && document.querySelector('[data-testid="competition-results"]')?.innerText.includes('Số câu đúng') && document.querySelector('[data-testid="competition-results"]')?.innerText.includes('Thời gian làm bài')`, 'organizer competition results with ranking criteria');
  await assertNoOverflow('organizer competition results');
  pass('organizer sees the results table, assigned candidate and Excel export controls');
  await navigatePage(baseUrl, `/ban-to-chuc/cuoc-thi/${competitionId}/xet-giai`);
  await pageWait(`document.querySelector('[data-testid="award-review-results"]') && /Cấu hình giải và lập danh sách dự kiến/.test(document.body.innerText)`, 'organizer award review');
  await assertNoOverflow('organizer award review');
  pass('organizer can open the award review tab and view configuration, ranking, and publication controls');

  const revokedToken = await cdp.evaluate(`localStorage.getItem(${JSON.stringify(tokenKey)})`);
  await clickLogout();
  const revokedResponse = await fetch(`${baseUrl}/api/Auth/me`, { headers: { Authorization: `Bearer ${revokedToken}` } });
  assert.equal(revokedResponse.status, 401, 'Browser logout must revoke its token on the server');
  assert.equal(await cdp.evaluate(`localStorage.getItem('quiz_browser_sentinel')`), 'preserve-me');
  pass('logout clears the session and preserves unrelated local storage');

  await enterCredentials('thisinh.demo', demoPassword);
  await waitForWelcome('thisinh.demo', 'Thí sinh');
  await pageWait(`location.pathname === '/thi-sinh'`, 'candidate route');
  assert.match(await cdp.evaluate('document.body.innerText'), /minh họa/i);
  await navigatePage(baseUrl, '/thi-sinh/cuoc-thi');
  await pageWait(`document.body.innerText.includes(${JSON.stringify(changedCompetitionName)}) && !![...document.querySelectorAll('a,button')].find(item => item.textContent.trim() === 'Vào thi')`, 'candidate published competition list');
  await assertNoOverflow('candidate competition list');
  await clickText('Vào thi');
  await pageWait(`location.pathname === '/thi-sinh/cuoc-thi/${competitionId}/huong-dan' && /Hướng dẫn dự thi/.test(document.body.innerText) && document.body.innerText.includes('Bắt đầu')`, 'candidate exam instructions');
  await pageWait(`document.querySelector('[data-testid="candidate-awards"]') && /Điểm cá nhân chưa được Ban Tổ chức công bố/.test(document.body.innerText) && /Danh sách đạt giải chưa được Ban Tổ chức công bố/.test(document.body.innerText)`, 'candidate unpublished results state');
  assert.match(await cdp.evaluate('document.body.innerText'), /Bắt đầu/);
  assert.match(await cdp.evaluate('document.body.innerText'), /Thể lệ cuộc thi/);
  await clickText('Bắt đầu');
  await pageWait(`location.pathname === '/thi-sinh/cuoc-thi/${competitionId}/lam-bai' && !!document.querySelector('.attempt-question')`, 'attempt begins after server confirmation');
  const selectedQuestion = await cdp.evaluate(`(() => {
    const radio = document.querySelector('.attempt-option input[type="radio"]');
    if (!radio) throw new Error('No answer option is rendered');
    radio.click();
    return { content: document.querySelector('.attempt-question h3')?.textContent, radioName: radio.name, value: radio.value };
  })()`);
  await pageWait(`document.querySelector('.attempt-sync-saved')?.textContent === 'Đã lưu'`, 'answer confirmed saved');
  await reloadPage();
  await pageWait(`!!document.querySelector('.attempt-question') && document.querySelector('.attempt-sync-saved')?.textContent === 'Đã lưu'`, 'attempt restored after reload');
  assert.deepEqual(await cdp.evaluate(`(() => {
    const checked = document.querySelector('.attempt-option input[type="radio"]:checked');
    return { content: document.querySelector('.attempt-question h3')?.textContent, radioName: checked?.name, value: checked?.value };
  })()`), selectedQuestion, 'Saved answer and question must survive browser reload');
  await cdp.evaluate(`window.confirm = () => true`);
  await clickText('Nộp bài');
  await pageWait(`/Đã nộp bài thành công/.test(document.body.innerText) && /Thời điểm nộp/.test(document.body.innerText)`, 'submission confirmation and timestamp');
  await reloadPage();
  await pageWait(`/Đã nộp bài thành công/.test(document.body.innerText) && !document.querySelector('.attempt-question')`, 'submitted attempt status after reload');
  await assertNoOverflow('candidate active attempt and submitted status');
  pass('candidate reads instructions, starts, saves and restores an answer after reload, submits, and cannot reopen the submitted questions');
  for (const route of ['/ban-to-chuc/cuoc-thi', competitionEditPath, examsPath, firstExamPath, schedulePath]) {
    await navigatePage(baseUrl, route);
    await pageWait(`/403|không có quyền|không được phép/i.test(document.body.innerText)`, 'candidate cannot administer competitions');
    assert.ok(await cdp.evaluate(`!!localStorage.getItem(${JSON.stringify(tokenKey)})`));
    assert.equal(await cdp.evaluate(`!!document.querySelector('#competition-name')`), false);
  }
  pass('candidate cannot access the competition list or edit route and cannot see draft competitions');
  await navigatePage(baseUrl, '/ban-to-chuc');
  await pageWait(`/403|không có quyền|không được phép/i.test(document.body.innerText)`, 'candidate forbidden organizer route');
  assert.ok(await cdp.evaluate(`!!localStorage.getItem(${JSON.stringify(tokenKey)})`));
  await navigatePage(baseUrl, '/thi-sinh');
  await waitForWelcome('thisinh.demo', 'Thí sinh');
  await reloadPage();
  await waitForWelcome('thisinh.demo', 'Thí sinh');
  pass('candidate role has its own dashboard, explicit demo mark and persistent session; organizer route is forbidden');

  await cdp.command('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  await reloadPage();
  await waitForWelcome('thisinh.demo', 'Thí sinh');
  await assertNoOverflow('320 x 740 mobile candidate dashboard');
  await screenshot('dashboard-mobile.png');
  await clickLogout();
  await assertNoOverflow('320 x 740 mobile login');
  await screenshot('login-mobile.png');

  await cdp.evaluate(`localStorage.setItem(${JSON.stringify(tokenKey)}, 'invalid.browser.test.token')`);
  await reloadPage();
  await pageWait(`!!document.querySelector('#username') && localStorage.getItem(${JSON.stringify(tokenKey)}) === null`, 'invalid-token recovery');
  pass('an invalid saved token returns to login and is cleared');

  await navigatePage(baseUrl, '/ban-to-chuc/tai-khoan');
  await pageWait(`!!document.querySelector('#username')`, 'anonymous protected deep link redirects to login');
  pass('anonymous protected deep link returns to login');
  assert.deepEqual(cdp.exceptions, [], 'The browser must not report unhandled JavaScript exceptions');
  pass('no unhandled browser JavaScript exceptions');
}

main().catch((error) => {
  process.stderr.write(`FAIL ${error.stack || error.message}\n`);
  if (/Chrome|DevTools/i.test(error.message)) process.stderr.write(`Browser stage: ${browserStage}\n${browserLog}\n`);
  process.exitCode = 1;
}).finally(async () => {
  try {
    await cleanup();
  } catch (error) {
    process.stderr.write(`FAIL test cleanup: ${error.message}\n`);
    process.exitCode = 1;
  }
});
