'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const projectRoot = path.resolve(__dirname, '..');
const backendRoot = path.join(projectRoot, 'backend');
const testsRoot = path.join(projectRoot, '.tmp-tests');
const developmentArtifacts = path.join(projectRoot, '.artifacts', 'development');
const dll = path.join(developmentArtifacts, 'bin', 'Quiz_TanHoa.Api', 'debug', 'Quiz_TanHoa.Api.dll');
const frontendHtml = path.join(projectRoot, 'frontend', 'dist-web', 'index.html');
const pass = (description) => process.stdout.write(`PASS ${description}\n`);
let dataDirectory;
let server;
let serverLog = '';
let launchError;
let origin;

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
  return fetch(new URL(route, origin), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
}

async function startServer() {
  origin = `http://127.0.0.1:${await freePort()}`;
  const environment = {
    ...process.env,
    QUIZ_TANHOA_DATA_DIR: dataDirectory,
    DOTNET_NOLOGO: '1',
  };
  // The named local profile must supply demo mode, without terminal variables.
  delete environment.ASPNETCORE_ENVIRONMENT;
  delete environment.DOTNET_ENVIRONMENT;
  delete environment.QUIZ_TANHOA_SEED_DEMO;
  delete environment.QUIZ_TANHOA_JWT_KEY;
  delete environment.QUIZ_TANHOA_ADMIN_PASSWORD;
  delete environment.QUIZ_TANHOA_WEB_ROOT;
  server = spawn(process.env.DOTNET_HOST_PATH || 'dotnet', ['run', '--no-build', '--artifacts-path', developmentArtifacts, '--launch-profile', 'MinhHoa', '--', '--urls', origin], {
    cwd: backendRoot,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.once('error', (error) => { launchError = error; });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => {
    serverLog = (serverLog + chunk.toString()).slice(-10000);
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (launchError) throw new Error(`Cannot start dotnet: ${launchError.message}`);
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Development server exited before becoming ready:\n${serverLog}`);
    }
    try {
      const response = await request('/api/health');
      if (response.ok) {
        const health = await response.json();
        assert.equal(health.application, 'Quiz_TanHoa');
        assert.equal(health.status, 'ok');
        // Wait for the host log as well as HTTP readiness to verify the launch profile.
        for (let attempt = 0; attempt < 20 && !/Hosting environment:\s*Development/i.test(serverLog); attempt++) await delay(50);
        assert.match(serverLog, /Hosting environment:\s*Development/i);
        assert.doesNotMatch(serverLog, /DirectoryNotFoundException|Unhandled exception/i);
        return;
      }
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
    }
    await delay(100);
  }
  throw new Error(`Development server did not become ready within 30 seconds:\n${serverLog}`);
}

function assertPublicProfile(profile, username, role) {
  assert.equal(profile.username, username);
  assert.equal(profile.role, role);
  assert.equal(profile.isDemo, true);
  assert.equal(typeof profile.fullName, 'string');
  assert.ok(profile.fullName.length > 0);
  assert.equal(typeof profile.mustChangePassword, 'boolean');
  assert.ok(!Object.keys(profile).some((field) => /^(?:password|passwordhash|hash|secret|signingkey)$/i.test(field)), 'Profile exposes credential material');
}

async function main() {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Use Node.js 24 or newer');
  assert.ok(fs.existsSync(dll), 'Build isolated Development artifacts first: npm.cmd run test:development');
  assert.ok(fs.existsSync(frontendHtml), 'Build frontend before testing: npm.cmd --prefix frontend run build:web');
  fs.mkdirSync(testsRoot, { recursive: true });
  dataDirectory = fs.mkdtempSync(path.join(testsRoot, 'development-'));
  await startServer();
  pass('dotnet run --launch-profile MinhHoa starts in Development without demo environment variables in the terminal');

  const page = await request('/dang-nhap');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /text\/html/i);
  const html = await page.text();
  assert.match(html, /Tân Hòa/);
  const assetPaths = [...html.matchAll(/<(?:script|link)\b[^>]*>/gi)]
    .map(([tag]) => tag.match(/\b(?:src|href)=["']([^"']+)["']/i)?.[1])
    .filter((value) => value && /\.(?:js|css)(?:\?|$)/i.test(value));
  assert.ok(assetPaths.some((asset) => /\.js(?:\?|$)/i.test(asset)), 'Built page must reference a JavaScript asset');
  assert.ok(assetPaths.some((asset) => /\.css(?:\?|$)/i.test(asset)), 'Built page must reference a CSS asset');
  for (const asset of assetPaths) {
    const url = new URL(asset, origin);
    assert.equal(url.origin, origin, 'Built frontend assets must be served by the local backend');
    const response = await request(url.pathname + url.search);
    assert.equal(response.status, 200, `Frontend asset is not served: ${url.pathname}`);
    assert.match(response.headers.get('content-type') || '', /(?:javascript|text\/css)/i);
    assert.ok((await response.text()).length > 0);
  }
  pass('Development backend serves the login deep link and its built JavaScript and CSS files');

  for (const [username, role] of [['organizer.demo', 'Organizer'], ['thisinh.demo', 'Candidate']]) {
    const response = await request('/api/Auth/login', { body: { username, password: 'TanHoa@2026!' } });
    assert.equal(response.status, 200, `Development login failed for ${username}`);
    const login = await response.json();
    assertPublicProfile(login, username, role);
    assert.equal(typeof login.token, 'string');
    assert.ok(login.token.length > 0);
    const profile = await request('/api/Auth/me', { token: login.token });
    assert.equal(profile.status, 200);
    assertPublicProfile(await profile.json(), username, role);
    assert.equal((await request('/api/Auth/logout', { token: login.token, method: 'POST' })).status, 200);
    assert.equal((await request('/api/Auth/me', { token: login.token })).status, 401);
  }
  pass('MinhHoa initializes both demo roles in an empty database; login, profile and server logout succeed');
  console.log('Development startup regression checks passed.');
}

async function stopServer() {
  if (!server || !server.pid || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  if (process.platform === 'win32') {
    // dotnet run starts an apphost child; terminate only this test's process tree.
    const result = spawnSync('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    if (result.error) throw result.error;
  } else {
    server.kill('SIGTERM');
  }
  await Promise.race([exited, delay(5000)]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL');
    await Promise.race([exited, delay(2000)]);
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.stack || error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  try {
    await stopServer();
    if (dataDirectory) {
      const target = path.resolve(dataDirectory);
      assert.equal(path.dirname(target), testsRoot, 'Cleanup must stay inside the test directory');
      assert.ok(path.basename(target).startsWith('development-'), 'Cleanup must target this test run');
      await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    }
  } catch (error) {
    console.error(`FAIL Development test cleanup: ${error.message}`);
    process.exitCode = 1;
  }
});
