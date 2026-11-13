'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');

const root = path.resolve(__dirname, '..');
const demo = process.argv.includes('--demo');
const vite = path.join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js');
const backendDll = path.join(root, 'backend', 'bin', 'Debug', 'net8.0', 'Quiz_TanHoa.Api.dll');
const children = new Set();
let stopping = false;

if (!fs.existsSync(vite)) {
  console.error('Chưa cài thư viện. Chạy npm.cmd run setup trước.');
  process.exit(1);
}

const backendEnv = {
  ...process.env,
  QUIZ_TANHOA_DATA_DIR: process.env.QUIZ_TANHOA_DATA_DIR || path.join(root, '.data', demo ? 'demo' : 'web'),
  QUIZ_TANHOA_SEED_DEMO: demo ? 'true' : 'false',
};

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  children.add(child);
  child.on('error', (error) => {
    console.error(`Không thể khởi chạy: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) stop(code || (signal ? 1 : 0));
  });
  return child;
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
process.on('exit', () => stop());

async function checkBackend() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && !stopping) {
    const ready = await new Promise((resolve) => {
      const request = http.get('http://127.0.0.1:5030/api/health', (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.setTimeout(1000, () => request.destroy());
      request.on('error', () => resolve(false));
    });
    if (ready) {
      start(process.execPath, [vite, '--mode', 'web', '--host', '127.0.0.1'], { cwd: path.join(root, 'frontend') });
      console.log('\nWebsite: http://127.0.0.1:5175/dang-nhap');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!stopping) {
    console.error('Máy chủ chưa sẵn sàng sau 60 giây. Xem thông báo .NET phía trên.');
    stop(1);
  }
}

async function requireFreePort(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', () => reject(new Error(`Cổng ${port} đang được sử dụng. Dừng phiên chạy cũ trước.`)));
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
}

async function main() {
  await requireFreePort(5030);
  await requireFreePort(5175);
  console.log(demo
    ? 'Đang chạy bản MINH HỌA. Dữ liệu tại .data/demo (trừ khi đặt QUIZ_TANHOA_DATA_DIR).'
    : 'Đang chạy website Tân Hòa. Cơ sở dữ liệu mới cần QUIZ_TANHOA_ADMIN_PASSWORD (tối thiểu 12 ký tự).');
  await new Promise((resolve, reject) => {
    const build = spawn('dotnet', ['build', 'backend/Quiz_TanHoa.Api.csproj', '--nologo'], {
      cwd: root, stdio: 'inherit', windowsHide: true,
    });
    children.add(build);
    build.once('error', reject);
    build.once('exit', (code) => {
      children.delete(build);
      if (code === 0) resolve();
      else reject(new Error('Build máy chủ thất bại. Xem thông báo phía trên.'));
    });
  });
  if (stopping) return;
  start('dotnet', [backendDll, '--urls', 'http://127.0.0.1:5030'], {
    cwd: path.join(root, 'backend'),
    env: { ...backendEnv, ASPNETCORE_ENVIRONMENT: 'Development' },
  });
  await checkBackend();
}

main().catch((error) => { console.error(error.message); stop(1); });
