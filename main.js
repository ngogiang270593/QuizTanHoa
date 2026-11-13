const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

let backendProcess;
let quitting = false;
const backendUrl = "http://127.0.0.1:5031";
app.setPath("userData", path.join(app.getPath("appData"), "Quiz_TanHoa"));

function waitForBackend(timeoutMs = 60000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!backendProcess || backendProcess.exitCode !== null) {
        reject(new Error("Backend đã dừng trước khi sẵn sàng."));
        return;
      }
      const request = http.get(`${backendUrl}/api/health`, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          try {
            if (response.statusCode === 200 && JSON.parse(body).application === "Quiz_TanHoa") resolve();
            else reject(new Error("Cổng 5031 đang được ứng dụng khác sử dụng."));
          } catch { reject(new Error("Phản hồi backend không hợp lệ.")); }
        });
      });
      request.setTimeout(2000, () => request.destroy());
      request.on("error", () => {
        if (Date.now() - startedAt >= timeoutMs) reject(new Error("Backend chưa sẵn sàng sau 60 giây."));
        else setTimeout(check, 500);
      });
    };
    check();
  });
}

function stopBackend() {
  if (backendProcess && backendProcess.exitCode === null) backendProcess.kill();
  backendProcess = null;
}

async function start() {
  const backendPath = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, "publish"), "backend", "Quiz_TanHoa.Api.exe");
  if (!fs.existsSync(backendPath)) throw new Error("Chưa build backend. Hãy chạy npm run build:desktop trước.");
  backendProcess = spawn(backendPath, [], {
    cwd: path.dirname(backendPath),
    windowsHide: true,
    env: {
      ...process.env,
      ASPNETCORE_URLS: backendUrl,
      ASPNETCORE_ENVIRONMENT: "Production",
      QUIZ_TANHOA_DATA_DIR: path.join(app.getPath("userData"), "data"),
      QUIZ_TANHOA_WEB_ROOT: app.isPackaged
        ? path.join(process.resourcesPath, "web")
        : path.join(__dirname, "frontend", "dist")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  backendProcess.stdout.on("data", (data) => process.stdout.write(data));
  backendProcess.stderr.on("data", (data) => process.stderr.write(data));
  backendProcess.on("error", (error) => {
    if (!quitting) { dialog.showErrorBox("Quiz_TanHoa", error.message); app.quit(); }
  });
  await waitForBackend();
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 360,
    minHeight: 560,
    title: "Quiz_TanHoa",
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== backendUrl) event.preventDefault();
  });
  await win.loadURL(backendUrl);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(start).catch((error) => {
    if (!quitting) dialog.showErrorBox("Không thể mở Quiz_TanHoa", error.message);
    app.quit();
  });
}
app.on("before-quit", () => { quitting = true; stopBackend(); });
app.on("window-all-closed", () => app.quit());
