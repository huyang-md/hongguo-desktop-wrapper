const { app, BrowserWindow, Tray, Menu, shell, nativeImage, globalShortcut, dialog, nativeTheme } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

// 内容全部来自红果官方网页版,本程序只做桌面壳,不抓取、不修改任何数据
const HOME_URL = 'https://hongguoduanju.com/';
const HOST_RE = /(^|\.)hongguoduanju\.com$/i;
const DETAIL_RE = /hongguoduanju\.com\/detail/i;
// 播放器页面:老板键暂停判断用(真实播放页是 /player/<id>,不是 /detail)
const PLAYER_RE = /hongguoduanju\.com\/(detail|player)/i;

let win = null;
let tray = null;
let quitting = false;
let miniMode = false;
let miniSavedBounds = null;
let lastUrl = HOME_URL;

const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
const historyPath = () => path.join(app.getPath('userData'), 'watch-history.json');

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function saveJSON(p, data) {
  try { fs.writeFileSync(p, JSON.stringify(data)); } catch {}
}

// ---------- 本地观看历史(只记你在官网看过哪些详情页,存本地 JSON) ----------
function loadHistory() { return loadJSON(historyPath(), []); }
function saveHistory(list) { saveJSON(historyPath(), list.slice(0, 50)); }

function cleanTitle(t) {
  return String(t || '').replace(/[_\-|]\s*红果短剧.*$/, '').trim() || '红果短剧';
}

function recordVisit(url, title) {
  if (!DETAIL_RE.test(url)) return;
  const list = loadHistory().filter((it) => it.url !== url);
  list.unshift({ url, title: cleanTitle(title), time: Date.now() });
  saveHistory(list);
  if (tray) setTrayMenu();
}

// ---------- 窗口状态记忆 ----------
function loadState() { return loadJSON(statePath(), null); }

function saveState() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getBounds();
    saveJSON(statePath(), {
      x: b.x, y: b.y, width: b.width, height: b.height,
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen()
    });
  } catch {}
}

function isInternal(url) {
  try { return HOST_RE.test(new URL(url).hostname); } catch { return false; }
}

// 只把 http/https 交给系统浏览器,拦截 file:/javascript: 等危险协议
function isWebUrl(url) {
  try { return /^https?:$/.test(new URL(url).protocol); } catch { return false; }
}

function showWin() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- 老板键:先尽力暂停播放,再隐藏窗口;再按一次唤回 ----------
function pausePlayback() {
  if (!win || win.isDestroyed()) return;
  if (!PLAYER_RE.test(lastUrl)) return;
  // 模拟一次空格键按下/抬起,相当于用户亲手按了暂停,不涉及任何接口调用
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  setTimeout(() => {
    if (win && !win.isDestroyed()) {
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    }
  }, 80);
}

function bossKey() {
  if (!win) { showWin(); return; }
  if (win.isVisible()) {
    pausePlayback();
    win.hide();
  } else {
    showWin();
  }
}

// ---------- 小窗置顶:竖屏比例置顶小窗,适合边干活边刷剧 ----------
function toggleMini() {
  if (!win || win.isDestroyed()) return;
  if (!miniMode) {
    if (win.isFullScreen()) win.setFullScreen(false);
    if (!win.isMaximized()) miniSavedBounds = win.getBounds();
    win.unmaximize();
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setMinimumSize(280, 420);
    win.setSize(430, 760);
    miniMode = true;
  } else {
    win.setAlwaysOnTop(false);
    win.setMinimumSize(400, 640);
    if (miniSavedBounds) win.setBounds(miniSavedBounds);
    else win.setSize(1200, 800);
    miniMode = false;
  }
}

// ---------- 开机自启 ----------
function isAutoLaunch() {
  return app.getLoginItemSettings().openAtLogin;
}

function toggleAutoLaunch(item) {
  app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath });
}

// ---------- 应用内检查更新 ----------
const RELEASES_API = 'https://api.github.com/repos/huyang-md/hongguo-desktop-wrapper/releases/latest';
const updateCheckPath = () => path.join(app.getPath('userData'), 'update-check.json');

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function fetchLatestRelease() {
  const res = await fetch(RELEASES_API, {
    headers: { 'User-Agent': 'hongguo-desktop-wrapper' },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const tag = String(j.tag_name || '').replace(/^v/, '');
  if (!tag) throw new Error('no tag_name');
  return {
    tag,
    url: j.html_url || 'https://github.com/huyang-md/hongguo-desktop-wrapper/releases/latest'
  };
}

function msgBox(opts) {
  const parent = win && !win.isDestroyed() ? win : undefined;
  return parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts);
}

function showUpdateDialog(tag, url) {
  msgBox({
    type: 'info',
    title: '发现新版本',
    message: `红果短剧桌面客户端 ${tag} 已发布`,
    detail: '前往 Releases 页下载新安装包,覆盖安装即可,观看记录不受影响。',
    buttons: ['前往下载', '以后再说'],
    defaultId: 0,
    cancelId: 1
  }).then(({ response }) => {
    if (response === 0) shell.openExternal(url);
  });
}

async function checkUpdate(interactive) {
  try {
    const { tag, url } = await fetchLatestRelease();
    saveJSON(updateCheckPath(), { lastCheck: Date.now() });
    if (compareVersions(tag, app.getVersion()) > 0) {
      showUpdateDialog(tag, url);
    } else if (interactive) {
      msgBox({ type: 'info', title: '检查更新', message: `已是最新版本(v${app.getVersion()})` });
    }
  } catch {
    if (interactive) {
      msgBox({ type: 'warning', title: '检查更新', message: '检查更新失败,请检查网络后重试' });
    }
  }
}

function maybeAutoCheckUpdate() {
  const st = loadJSON(updateCheckPath(), {});
  if (st.lastCheck && Date.now() - st.lastCheck < 24 * 3600 * 1000) return;
  checkUpdate(false);
}

// ---------- 用户反馈入口:预填版本信息,直达 GitHub 新建 Issue ----------
function feedbackUrl() {
  const body = [
    `应用版本: v${app.getVersion()}`,
    `系统: Windows ${os.release()}`,
    `Electron: ${process.versions.electron}`,
    '',
    '问题描述:'
  ].join('\n');
  return `https://github.com/huyang-md/hongguo-desktop-wrapper/issues/new?title=${encodeURIComponent('【反馈】')}&body=${encodeURIComponent(body)}`;
}

function createWindow() {
  const st = loadState() || {};
  win = new BrowserWindow({
    width: st.width || 1200,
    height: st.height || 800,
    x: Number.isFinite(st.x) ? st.x : undefined,
    y: Number.isFinite(st.y) ? st.y : undefined,
    minWidth: 400,
    minHeight: 640,
    title: '红果短剧',
    backgroundColor: '#101014',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  if (st.maximized) win.maximize();
  if (st.fullscreen) win.setFullScreen(true);

  win.once('ready-to-show', () => win.show());
  win.loadURL(HOME_URL);

  // 点关闭 = 缩到托盘,真正退出走托盘菜单
  win.on('close', (e) => {
    // 小窗模式下退出时不覆盖记忆的常规窗口尺寸
    if (!miniMode) saveState();
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });

  win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) win.loadFile('error.html');
  });

  // 站内新窗口在主窗口打开,站外链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) win.loadURL(url);
    else if (isWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url)) {
      e.preventDefault();
      if (isWebUrl(url)) shell.openExternal(url);
    }
  });

  // 记录当前页面 URL 与标题,供观看历史使用
  win.webContents.on('did-navigate', (_e, url) => { lastUrl = url; });
  win.webContents.on('page-title-updated', (_e, title) => {
    lastUrl = win.webContents.getURL() || lastUrl;
    recordVisit(lastUrl, title);
  });
}

// ---------- 托盘 ----------
function setTrayMenu() {
  if (!tray) return;
  const hist = loadHistory().slice(0, 8);
  const histItems = hist.length
    ? hist.map((it) => ({
        label: it.title.slice(0, 26),
        click: () => { showWin(); if (win) win.loadURL(it.url); }
      }))
    : [{ label: '暂无观看记录', enabled: false }];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示红果短剧', click: showWin },
    { label: '最近看过', submenu: histItems },
    { type: 'separator' },
    { label: '小窗置顶 (430×760)', click: () => { showWin(); toggleMini(); } },
    { label: '老板键 Ctrl+Shift+B', click: bossKey },
    { label: '检查更新', click: () => { showWin(); checkUpdate(true); } },
    { label: '反馈问题', click: () => shell.openExternal(feedbackUrl()) },
    { type: 'separator' },
    { label: '开机自启', type: 'checkbox', checked: isAutoLaunch(), click: toggleAutoLaunch },
    { label: '清空观看记录', click: () => { saveHistory([]); setTrayMenu(); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')));
  } catch { return; }
  tray.setToolTip('红果短剧');
  setTrayMenu();
  tray.on('click', showWin);
}

// ---------- 应用菜单(按 Alt 显示) ----------
function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { type: 'separator' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '实际大小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '沉浸全屏 (F11)' },
        { role: 'toggleDevTools', label: '开发者工具' }
      ]
    },
    {
      label: '功能',
      submenu: [
        { label: '小窗置顶', click: toggleMini },
        { label: '老板键(隐藏/唤出,全局生效)', click: bossKey },
        { label: '检查更新', click: () => checkUpdate(true) },
        { label: '反馈问题', click: () => shell.openExternal(feedbackUrl()) },
        { type: 'separator' },
        { label: '开机自启', type: 'checkbox', checked: isAutoLaunch(), click: toggleAutoLaunch },
        { label: '清空观看记录', click: () => { saveHistory([]); setTrayMenu(); } }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭窗口' }
      ]
    }
  ]);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWin);
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());

  app.whenReady().then(() => {
    // 去掉 UA 里的 Electron 标识,避免站点按爬虫/特殊客户端处理
    app.userAgentFallback = app.userAgentFallback.replace(/\s*Electron\/[\d.]+/, '');
    // 深色原生标题栏,与站点暗色主题一致
    nativeTheme.themeSource = 'dark';
    Menu.setApplicationMenu(buildMenu());
    globalShortcut.register('Control+Shift+B', bossKey) ||
      console.warn('[hongguo] Ctrl+Shift+B 快捷键注册失败,可能被其他程序占用');
    createWindow();
    createTray();
    maybeAutoCheckUpdate();
  });
}

// 窗口只是被隐藏到托盘,不退出应用
app.on('window-all-closed', () => {});
