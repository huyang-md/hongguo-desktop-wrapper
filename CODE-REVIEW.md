# hongguo-desktop 代码评审与改进建议

> 评审对象：本地 `main` 分支 `00adc02`（v1.2.0），仓库 <https://github.com/huyang-md/hongguo-desktop-wrapper>
> 评审时间：2026-11-22
> 评审方式：静态通读 + Electron 33.4.11 实测探针（临时脚本，未入库）+ 真实站点 / GitHub Releases / npm registry 验证
> 说明：**本次评审未修改仓库任何源码**，只新增本报告文件；文中行号均指 `main.js` 当前版本。

---

## 0. 结论速览（TL;DR）

**没有发现 P0 级问题**：无任意代码执行、无隐藏数据上报、无非预期网络行为，安全基线（`contextIsolation` / `nodeIntegration:false` / `sandbox:true` / 无 preload / 无 IPC）是对的，README 的合规边界也守得不错。

需要动手的是四类问题：

| 类别 | 具体问题 | 建议 |
|---|---|---|
| **安全（P1）** | Electron 33 已停止安全支持；远程站点权限默认全放行；302 站外重定向可在壳内加载；更新下载链接未校验；`npm ci` 从 npmmirror 第三方镜像拉包 | 按 §2 改 5 处，约 60 行 |
| **核心功能（P1）** | 老板键靠盲发空格「暂停」，实测会把已暂停的视频**变成播放**，隐藏后继续出声；SPA 路由下 `lastUrl` 可能过期 | 改为 `executeJavaScript` 暂停真实 `<video>` + 兜底静音 |
| **可靠性（P2）** | 托盘创建失败会变隐形僵尸进程；窗口状态不校验屏幕、只在正常关闭时保存；小窗从最大化进入会丢最大化；观看历史标题清洗失效；启动即弹更新框 | 约 80 行，逐条见 §3 |
| **工程化（P2/P3）** | lockfile 锁在镜像源；无 CI 语法检查/测试；发布校验只有 body 里的 SHA；安装包 81.6MB 中 40.3MB 是无用语言包 | 见 §4、§6 |

**最小改动收益**：§2 的安全五项 + 老板键重写，全部集中在 `main.js`，不改变产品形态，半天内可完成并手测。

---

## 1. 实测记录（结论的证据）

### 1.1 环境

- Electron `33.4.11`（Chromium 130.0.6723.191 / Node 20.18.3），electron-builder `25.1.8`
- 站点：`https://hongguoduanju.com/`，详情页 `/detail?series_id=...`，播放页 `/player/<id>`；播放器为字节自家的 **xgplayer**（DOM 类名 `xgplayer-pc` 实测确认）
- 站点是 **SSR + React Router**：首屏 HTML 自带完整标题/内容（利于 SEO），但站内跳转走 `history.pushState`（`lib-router` 包内含 pushState / popstate）

### 1.2 探针实测结论

| # | 验证项 | 结果 | 对代码的含义 |
|---|---|---|---|
| 1 | SPA pushState 会触发哪个 Electron 事件 | `did-navigate-in-page` 触发，`did-navigate` **不触发**；`webContents.getURL()` 会跟随更新 | `main.js:256` 只监听 `did-navigate`；目前靠 `page-title-updated`（257-260）里的 `getURL()` 兜底，**标题不变时会过期** |
| 2 | 真实播放页上发送空格的效果 | 视频已暂停时发送 `Space` → `video.paused` 变为 `false`（**开始播放**） | 老板键「隐藏并暂停」在「已经暂停」的场景会反向恢复播放，窗口隐藏后声音继续 |
| 3 | 隐藏窗口发送空格 | 播放状态无变化（无法证明能暂停） | 不能依赖盲发空格完成暂停 |
| 4 | `executeJavaScript('video.pause()')` | 在真实 xgplayer 上返回成功，`paused === true` | 推荐方案在真实站点可用；站点 CSP 不阻塞 `executeJavaScript` |
| 5 | `sendInputEvent` 是否要求窗口聚焦 | Electron 文档写「BrowserWindow 必须聚焦」；实测 33.4.11 在**非聚焦窗口仍能投递** keydown | 文档语义不可依赖，但这不是核心问题；核心是「盲发 = 切换」而不是「暂停」 |
| 6 | 最小化窗口的 `isVisible()` | `false` | 老板键在最小化时走 `showWin()` 还原，行为正确 |
| 7 | 去掉 Electron token 后的 UA | `... HongguoDuanju/1.2.0 Chrome/130.0.6723.191 Safari/537.36` | 产品 token 仍暴露；站点目前可正常加载（实测），属低优先 |
| 8 | v1.2.0 发布资产 | `HongguoDuanju-Setup-1.2.0.exe`，81,626,121 B，API `digest=sha256:7a7715…8138` 与 release body 一致 | 校验说明属实；但资产无签名、无 `.sha256` 侧车 |
| 9 | 解压后体积 | 268.1 MB；其中 `locales/*.pak` **55 个共 40.3 MB** | 用 `electronLanguages` 可裁掉约 38 MB 解压体积 |

### 1.3 已核实的外部事实

| 事实 | 来源 |
|---|---|
| Electron 最新 stable = **45.4.1**；官方只支持最新 3 个 stable（43/44/45）；33 已不在支持窗口 | <https://www.electronjs.org/docs/latest/tutorial/electron-timelines>、<https://registry.npmjs.org/electron/latest> |
| electron-builder 最新 = **26.18.0**（项目为 25.1.8） | <https://registry.npmjs.org/electron-builder/latest> |
| Electron 未配置权限 handler 时**默认批准所有权限请求** | v33.4.11 `docs/tutorial/security.md`、`docs/api/session.md` |
| `will-redirect` 在服务端重定向时触发且可 `preventDefault()` 阻止整次导航 | v33.4.11 `docs/api/web-contents.md` |
| Electron 45 的 npm 包已**没有** `postinstall` 安装脚本（`scripts` 为空） | npm tarball `package.json` 实测 |
| `package-lock.json` 417 条 `resolved` 全部指向 `registry.npmmirror.com` | 本地锁定文件实测 |
| 本地 lock 根版本仍是 `1.1.3`（与 package.json `1.2.0` 不一致），但 `npm ci` 仍能通过 | 实测 `npm ci --dry-run` 退出码 0 |

---

## 2. P1 高风险（安全 / 核心功能，建议尽快）

### P1-1 Electron 33.4.11 已停止安全更新

**证据**：`package.json:18` 固定 `"electron": "^33.0.0"`；实测 UA 为 Chrome/130。当前稳定版 45.4.1，官方支持 43/44/45，33 已 EOL。这个壳加载的是**第三方远程站点**，渲染进程暴露在互联网内容里，未打补丁的 Chromium 是最直接攻击面（历史上大量 V8/Blink 漏洞都是「打开一个网页即可触发」）。

**影响**：安全补丁缺失；未来站点若用新 Web API 也可能不兼容。不是「马上会出事」，但对一个公开分发的联网客户端属于必须排期的事项。

**建议**：
1. 升级到 Electron **43**（保守，仍受支持）或 **45**（最新），同时 `electron-builder` 升到 **26.x**、CI Node 升到 **22**（Electron 45 的 npm 包要求 Node ≥ 22.12）。
2. 快速对照 `/docs/latest/breaking-changes` 的 34→45 条目，本项目用到的 API（`app/BrowserWindow/Tray/Menu/shell/nativeImage/globalShortcut/dialog/nativeTheme/session/webContents`）**未见移除或改签名**（仍以升级后实测为准）；主要风险在打包链路（实测 Electron 45.4.1 的 npm 包已不再 postinstall 下载二进制）与菜单/全屏的默认行为变化。
3. 必须实测一遍：`npm ci && npm run dist` + 安装/覆盖安装/卸载 + §8 回归清单。
4. 若暂时不升级，至少在 README 「为什么可信」里如实标注「基于 Electron 33，Chromium 130」并给出升级计划，不要让人误以为是安全维护中的版本。

> 另一条路：若只想要「最小体积 + 跟随系统 WebView2」，可用 Tauri/WPF 重写壳层（<5MB），但这是重写不是优化，现阶段不建议。

### P1-2 远程站点权限请求默认全放行（摄像头/麦克风/通知/剪贴板读）

**证据**：`main.js` 全文没有 `session.setPermissionRequestHandler` / `setPermissionCheckHandler` / `setDevicePermissionHandler`（grep 零命中）。Electron 文档明确：**未配置 handler 时自动批准所有权限请求**。

**影响**：红果页面（或其加载的任何第三方脚本、XSS、广告）无需用户同意即可申请 `media`（摄像头/麦克风）、`notifications`、`clipboard-read`、`geolocation`、`display-capture` 等权限。虽然站点现在没有滥用，但这属于「把信任无条件交给远程页面」的默认配置，桌面客户端不应如此。

**修复**（放在 `app.whenReady()` 里、`createWindow()` 之前）：

```js
const { session } = require('electron');

// 只放行全屏（站内播放器的全屏按钮需要），其余一律拒绝
const ALLOWED_PERMISSIONS = new Set(['fullscreen']);

session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
  callback(ALLOWED_PERMISSIONS.has(permission));
});
session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
  return ALLOWED_PERMISSIONS.has(permission);
});
```

如需站内「复制链接」可用，可把 `clipboard-sanitized-write` 加入白名单；**不要**放行 `media`、`notifications`、`clipboard-read`。改完手动验证播放器的全屏按钮仍可用。

### P1-3 只拦了 `will-navigate`，302 到站外域名会在壳内加载

**证据**：`main.js:248-253` 只注册了 `will-navigate`。Electron 文档：服务端重定向会触发 `will-redirect`（可 `preventDefault()` 阻止整次导航），普通 `will-navigate` 覆盖不到重定向后的目标。当前若站点把某个 URL 302 到第三方域（登录 SSO、统计、广告落地页），第三方页面会在应用窗口内加载，绕过 `HOST_RE` 白名单。

**修复**（Electron 33 的事件签名是 `(event, url, isInPlace, isMainFrame, ...)`）：

```js
// 统一导航守卫：主框架 + 非站内 → 拦截，http(s) 交给系统浏览器
function guardNavigation(e, url, _isInPlace, isMainFrame = true) {
  if (!isMainFrame || isInternal(url)) return;
  e.preventDefault();
  if (isWebUrl(url)) shell.openExternal(url);
}

win.webContents.on('will-navigate', guardNavigation);
win.webContents.on('will-redirect', guardNavigation);
```

说明：暂不建议注册 `will-frame-navigate` 去拦子框架，站内可能合法嵌入第三方登录/支付 iframe，一刀切会误伤；主框架守住即可。

### P1-4 老板键「暂停」不可靠，且可能反向恢复播放（实测确认）

**证据**：`main.js:77-87`

```js
// 模拟一次空格键按下/抬起,相当于用户亲手按了暂停
win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
```

实测（真实 `/player` 页，xgplayer）：

- 视频**已暂停**时发 `Space` → `video.paused` 从 `true` 变 `false`，即**开始播放**；随后 `win.hide()`，声音在后台继续放。
- 隐藏窗口下发 `Space` → 播放状态无变化（不能保证暂停成功）。
- `executeJavaScript('video.pause()')` → 在真实站点**有效**，`paused` 变 `true`。

另外 `main.js:79` 用 `lastUrl` 判断是否播放页，而 `lastUrl` 只在 `did-navigate`（256）与 `page-title-updated`（257-260）里更新；站点是 React Router，详情页/切集走 `pushState`（不触发 `did-navigate`），目前靠标题变化兜底，属于「偶然正确」。

**修复**（推荐，完全符合「只做壳、不碰站点数据」边界——只是操作页面里的播放器元素）：

```js
async function pausePlayback() {
  if (!win || win.isDestroyed()) return;
  try {
    const paused = await win.webContents.executeJavaScript(`(() => {
      const media = [...document.querySelectorAll('video,audio')]
        .filter((v) => !v.paused && !v.ended);
      media.forEach((v) => v.pause());
      return media.length;
    })()`, true);
    // 兜底：万一站点播放器在 iframe/自定义内核里，至少别让声音继续
    if (paused === 0) win.webContents.setAudioMuted(true);
  } catch {
    win.webContents.setAudioMuted(true);
  }
}

// 唤回时恢复声音
function showWin() {
  if (!win) { createWindow(); return; }
  if (win.isDestroyed()) return;
  win.webContents.setAudioMuted(false);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// 并补上 SPA 兜底（放在 did-navigate 旁边）
win.webContents.on('did-navigate-in-page', (_e, url) => { lastUrl = url; });
```

同时把 README 的「老板键一键隐藏窗口并自动暂停播放」保留——改完之后这句才真正成立。

> 如果不接受页面注入：可以退一步「先用 `executeJavaScript` 探测是否有正在播放的 video，只有在确认播放时才发 Space」，避免「暂停 → 播放」的反向副作用；但隐藏窗口下仍可能无效，不如直接 pause。

### P1-5 `package-lock.json` 全部锁在第三方镜像（npmmirror）

**证据**：`package-lock.json` 里 417 条 `resolved` 全部是 `https://registry.npmmirror.com/...`；仓库没有 `.npmrc`。`build.yml:38` 的 `npm ci` 会按 lock 里的 URL 下载 tarball，即 **GitHub Actions 构建实际从社区镜像取包**。

**影响**：供应链信任根从 npm 官方移到第三方镜像（镜像自述是「尽量实时同步」的只读镜像，非官方源）；镜像滞后/故障会导致 CI 失败；也影响「源码可复现构建」的说服力。lock 里有 `sha512` integrity，内容被换会校验失败，所以**被投毒风险低**，主要是信任与可用性问题。

**修复**：

```powershell
# 在项目根目录
npm config set registry https://registry.npmjs.org/
Remove-Item package-lock.json
npm install --package-lock-only
# 建议同时提交 .npmrc：
# registry=https://registry.npmjs.org/
```

重新生成后检查 `package-lock.json` 的 `resolved` 是否都是 `registry.npmjs.org`。国内开发者可本地用 `--registry=https://registry.npmmirror.com` 安装，但**不要**把镜像 URL 写进提交的 lock。

### P1-6 检查更新把 API 返回的 `html_url` 直接交给系统打开

**证据**：`main.js:142-155` / `main.js:162-174`：

```js
url: j.html_url || 'https://github.com/huyang-md/hongguo-desktop-wrapper/releases/latest'
...
if (response === 0) shell.openExternal(url);
```

没有校验协议和主机。GitHub API 走 HTTPS，现实中劫持成本高；但「仓库被改名/转移、API 响应异常、账号被盗后改 release 元数据」等情况下，`shell.openExternal` 会拉起任意 `file:` / 自定义协议 URL，交给系统处理器执行。

**修复**：

```js
const RELEASES_PAGE = 'https://github.com/huyang-md/hongguo-desktop-wrapper/releases/latest';
const SAFE_RELEASE_URL = /^https:\/\/github\.com\/huyang-md\/hongguo-desktop-wrapper\/releases\/[^\\s]+$/;

function safeReleaseUrl(u) {
  return SAFE_RELEASE_URL.test(String(u || '')) ? u : RELEASES_PAGE;
}
// fetchLatestRelease 返回：
url: safeReleaseUrl(j.html_url)
```

### P1-7 渲染进程崩溃/无响应没有恢复路径

**证据**：`main.js:237-239` 只有 `did-fail-load`。加载远程站点时，渲染进程崩溃（OOM、GPU 驱动、站点脚本）后会留下白屏窗口，老板键唤回还是白屏，只能任务管理器强杀。

**修复**：

```js
win.webContents.on('render-process-gone', (_e, details) => {
  if (details.reason === 'clean-exit' || !win || win.isDestroyed()) return;
  msgBox({
    type: 'warning',
    title: '页面异常退出',
    message: '播放页面崩溃了，是否重新加载？',
    buttons: ['重新加载', '退出'],
    defaultId: 0,
    cancelId: 1
  }).then(({ response }) => {
    if (response === 0 && win && !win.isDestroyed()) win.reload();
    else { quitting = true; app.quit(); }
  });
});

win.webContents.on('unresponsive', () => {
  if (win && !win.isDestroyed()) win.webContents.forcefullyCrashRenderer();
});
```

---

## 3. P2 中优先级（可靠性 / 体验）

### P2-1 托盘创建失败会变成「隐形僵尸进程」

**证据**：`main.js:227-234` 的 `close` 无条件 `preventDefault()` 隐藏；`main.js:288-295` 的 `createTray()` 失败被 `catch { return; }` 吞掉（`tray` 保持 `null`）；`main.js:357-358` `window-all-closed` 空实现。

**影响**：图标文件丢失、托盘被系统禁用、`new Tray()` 抛错时，用户点关闭 → 窗口消失但进程还在；既没有托盘入口，也没有窗口，只能任务管理器结束。这是「关不掉的应用」级别的问题。

**修复**：

```js
function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')));
  } catch { tray = null; return false; }
  tray.setToolTip('红果短剧');
  setTrayMenu();
  tray.on('click', showWin);
  return true;
}

// close 事件里：
if (quitting) return;
if (!tray) { quitting = true; return; } // 无托盘入口时必须真退出
e.preventDefault();
win.hide();

// 底部：
app.on('window-all-closed', () => {
  if (!tray) app.quit();
});
```

### P2-2 窗口状态只在正常关闭时保存，恢复时不校验屏幕范围

**证据**：`main.js:48-58` 只在 `close` 时 `saveState()`；`main.js:198-206` 恢复时仅 `Number.isFinite(st.x)` 校验。

**影响**：
- 崩溃/断电/任务管理器强杀 → 丢失窗口状态；
- 多显示器：在副屏最大化后退出，拔掉副屏再启动 → 窗口恢复到屏幕外，表现为「启动后看不到窗口」；
- 小窗模式下退出本来就不保存（有注释，这是对的），但崩溃时同样丢状态。

**修复**：

```js
const { screen } = require('electron');

function isBoundsVisible(b) {
  return screen.getAllDisplays().some(({ workArea: a }) => (
    b.x < a.x + a.width - 80 &&
    b.x + b.width > a.x + 80 &&
    b.y < a.y + a.height - 80 &&
    b.y + b.height > a.y + 40
  ));
}

// createWindow 里构造窗口前：
const bounds = { x: st.x, y: st.y, width: st.width || 1200, height: st.height || 800 };
const useSavedPos = Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
  && isBoundsVisible({ ...bounds, width: Math.max(bounds.width, 400), height: Math.max(bounds.height, 640) });
// new BrowserWindow({ ...(useSavedPos ? { x: bounds.x, y: bounds.y } : {}), width: ..., height: ... })

// 另加防抖保存：ready-to-show 后
let saveTimer = null;
const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 500);
};
win.on('resize', scheduleSave);
win.on('move', scheduleSave);
```

### P2-3 小窗置顶的状态边界

**证据**：`main.js:100-117`、`main.js:277`、`main.js:310`。

问题：
1. **从最大化进入小窗会丢最大化**：`miniSavedBounds` 只在 `!win.isMaximized()` 时保存，退出小窗时没有 `miniSavedBounds` 就 `setSize(1200, 800)`，不恢复最大化。
2. **从全屏进入小窗**：`setFullScreen(false)` 后立刻读取 `getBounds()`，可能读到全屏尺寸（时序）。
3. **位置越界**：`setSize(430, 760)` 保持左上角，如果窗口原来靠右/靠下，小窗会超出屏幕。
4. **托盘/菜单文案不更新**：`setTrayMenu()` 不在 `toggleMini()` 里调用，进入小窗后托盘仍显示「小窗置顶 (430×760)」而非「退出小窗」。
5. 退出小窗不恢复焦点，窗口可能被其他窗口盖住。

**修复**：

```js
let miniState = null; // { bounds, maximized, fullscreen }

function toggleMini() {
  if (!win || win.isDestroyed()) return;
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  if (!miniMode) {
    miniState = {
      bounds: win.getBounds(),
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen()
    };
    if (win.isFullScreen()) win.setFullScreen(false);
    win.unmaximize();
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setMinimumSize(280, 420);
    win.setBounds({
      x: Math.round(wa.x + (wa.width - 430) / 2),
      y: Math.round(wa.y + (wa.height - 760) / 2),
      width: 430,
      height: 760
    });
    miniMode = true;
  } else {
    win.setAlwaysOnTop(false);
    win.setMinimumSize(400, 640);
    if (miniState) {
      win.setBounds(miniState.bounds);
      if (miniState.maximized) win.maximize();
      if (miniState.fullscreen) win.setFullScreen(true);
    } else {
      win.setSize(1200, 800);
    }
    miniMode = false;
    miniState = null;
  }
  setTrayMenu(); // 让「小窗置顶 / 退出小窗」文案和勾选状态同步
}
```

菜单/托盘文案也改成动态：`miniMode ? '退出小窗置顶' : '小窗置顶 (430×760)'`。

### P2-4 观看历史标题清洗失效（实测）

**证据**：`main.js:33-35`：

```js
return String(t || '').replace(/[_\-|]\s*红果短剧.*$/, '').trim() || '红果短剧';
```

真实详情页标题是 `少夫人来自东北3_高清完整版全集免费观看_红果短剧`，实测清洗结果为 `少夫人来自东北3_高清完整版全集免费观看`，托盘里会显示这串 SEO 关键词，而不是剧名。

**修复**：

```js
function cleanTitle(t) {
  const parts = String(t || '').split(/[|｜]/)[0]
    .split('_')
    .map((s) => s.trim())
    .filter(Boolean);
  const seo = /(红果短剧|免费|全集|高清完整版|在线观看|短剧官网)/;
  while (parts.length > 1 && seo.test(parts[parts.length - 1])) parts.pop();
  return (parts.join(' ') || '红果短剧').slice(0, 40);
}
```

> 附带说明：目前只记录 `/detail` 页，`/player` 剧集不进历史，「最近看过」跳回详情页符合现状；若想记录「上次看到第几集」，需要额外存 player URL（可以直接用 `recordVisit` 的 `DETAIL_RE` 旁边再加一条 `PLAYER_RE` 逻辑，但托盘菜单项会变多）。

### P2-5 启动时可能弹模态更新框，抢焦点

**证据**：`main.js:192-196` 启动即 `maybeAutoCheckUpdate()`，发现新版走 `showUpdateDialog()`（163-174 弹模态框）。开机自启场景下，用户刚登录桌面就被弹窗打断。

**建议**：启动检查保持静默——发现新版只更新托盘菜单项（例如「发现新版本 v1.3.0」+ tooltip），用户点击后再弹对话框；或改用系统通知（配合 §P2-8 的 AUMID）。手动「检查更新」仍然弹框。

### P2-6 开机自启在开发模式会把 electron.exe 写进启动项

**证据**：`main.js:120-126` 没有 `app.isPackaged` 判断；`npm start` 时勾选「开机自启」，`setLoginItemSettings({ openAtLogin, path: process.execPath })` 会写 `...\node_modules\electron\dist\electron.exe`，开机后启动的是空 Electron。

**修复**：

```js
function isAutoLaunch() {
  return app.isPackaged && app.getLoginItemSettings().openAtLogin;
}

function toggleAutoLaunch(item) {
  if (!app.isPackaged) return; // 开发模式无意义，直接忽略
  app.setLoginItemSettings({ openAtLogin: item.checked }); // 默认即 process.execPath
}
```

### P2-7 未处理下载事件

**证据**：`main.js` 没有 `will-download`。站点/广告触发 `<a download>` 时，Electron 默认会按自己的策略落盘（没有「确认保存」的壳层提示），用户可能莫名多出文件。

**修复**（二选一）：

```js
session.defaultSession.on('will-download', (e, item) => {
  e.preventDefault(); // 壳层不提供下载功能，直接拒绝
  msgBox({ type: 'info', message: `已阻止下载：${item.getFilename()}` });
});
```

（若想允许下载，改为 `item.setSaveDialogOptions(...)` 或交给系统下载目录。）

### P2-8 缺 `app.setAppUserModelId`

Windows 的通知、任务栏归组、快捷方式身份都依赖 AUMID。当前没有设置（electron-builder 的 NSIS 会在快捷方式上写 `appId`，但运行时进程身份没对齐），站点通知（若授权）可能显示为「Electron」或无法显示。加一行（与 `build.appId` 保持一致）：

```js
app.setAppUserModelId('com.local.hongguoduanju');
```

### P2-9 全局快捷键注册失败只在 console 提示

**证据**：`main.js:349-350` 失败时 `console.warn`。用户看不到，托盘/菜单仍标「老板键 Ctrl+Shift+B」，实际按了没反应。

**建议**：注册失败时把托盘菜单项改成「老板键（可能被其他程序占用，点此重试）」并在 `tooltip` 里提示；或用 `dialog.showMessageBox` 一次性提示（仅当窗口可见时）。

### P2-10 托盘图标用 256px PNG，Windows 缩放会糊

**证据**：`main.js:290` 直接 `nativeImage.createFromPath(assets/icon.png)`（256×256 PNG）。Windows 托盘按 16/20/24/32px 显示，大图缩放后边缘发虚。

**建议**：生成多尺寸 `.ico`（16/24/32/48/256）作为托盘图标，`assets/icon.png` 继续用于窗口/安装包。

### P2-11 外链 `shell.openExternal` 可被页面批量拉起

**证据**：`main.js:242-253`：任何 http(s) 外链直接开系统浏览器。若站点广告脚本/跳转链滥用，会连续弹浏览器标签（不影响安全，但很烦）。

**建议**（低优先）：对 `setWindowOpenHandler` 的打开行为加节流（例如 3 秒内最多 1 个外链），或非用户点击触发时改为在壳内确认。Electron 33 拿不到可靠的「是否用户手势」标志，节流是最简单方案。

### P2-12 本地 JSON 非原子写、无结构校验

**证据**：`main.js:22-27` 同步 `writeFileSync`；`main.js:52-57` 状态写入；`main.js:266-271` 托盘读取历史；`main.js:199-206` 恢复状态。

**影响**：
- 断电/崩溃留下半截 JSON → `loadJSON` 静默回退，丢历史/窗口状态；
- 文件被手工改坏：`loadHistory()` 返回值不是数组会在 `filter` 处抛错；`width/height` 非法可能让 `BrowserWindow` 构造抛错；
- `history` 里的 `url` 未校验 `isInternal` 就 `win.loadURL`（本地文件被篡改时可加载 `file:`）。

**修复**：

```js
function saveJSON(p, data) {
  try {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, p);
  } catch {}
}

// loadState 后校验：
const width = Number.isFinite(st.width) && st.width >= 400 ? st.width : 1200;
const height = Number.isFinite(st.height) && st.height >= 640 ? st.height : 800;

// loadHistory 后校验：
const list = Array.isArray(loadHistory())
  ? loadHistory().filter((it) => it && isInternal(it.url))
  : [];
```

---

## 4. P3 低优先级 / 可选

| # | 事项 | 说明 |
|---|---|---|
| P3-1 | `package.json` 缺 `"license": "MIT"`、`engines` | 仓库有 LICENSE，但 npm 元数据没有；建议补 `"license": "MIT"` 和 `"engines": { "node": ">=20" }` |
| P3-2 | 安装包未包含 LICENSE | `build.files` 只列了 `main.js/error.html/assets/**`；MIT 分发建议把 `LICENSE` 一起打进 `resources` 或 `extraResources` |
| P3-3 | 无 ESLint / Prettier / EditorConfig | 至少加一个 `node --check main.js` 的 `npm run check`，CI 跑一下 |
| P3-4 | 无单元测试 | `compareVersions` / `cleanTitle` / `isInternal` / `isWebUrl` 是纯函数，可抽到 `lib/util.js` 用 `node:test` 覆盖（`compareVersions('1.2.0-beta','1.2.0')` 当前返回 0，是已知边界） |
| P3-5 | CI 加固 | actions 未 pin SHA；`permissions: contents: write` 放在顶层；无 `concurrency`；PR 不构建。见 §6 示例 |
| P3-6 | 发布校验 | SHA-256 只在可编辑的 release body；建议上传 `*.exe.sha256` 侧车文件，并启用 GitHub Artifact Attestations（`actions/attest-build-provenance`），README 给出 `Get-FileHash` / `gh attestation verify` 命令 |
| P3-7 | 代码签名 | 无证书 → SmartScreen 警告。现实路线：SignPath Foundation 对 OSS 免费但需人工审批/有声誉门槛；Azure Artifact Signing 的个人 Public Trust 仅限 US/CA，中国大陆个人不可行（Private Trust 对 SmartScreen 无效）。短期维持 README 说明 + SHA 校验即可 |
| P3-8 | 安装包体积 | `electronLanguages: ["zh-CN", "en-US"]` + `compression: "maximum"`，预计解压 -38MB、安装包 -10~15MB（需实测）；x64-only 可接受（ARM 走模拟） |
| P3-9 | electron-builder 25.1.8 偏旧 | 最新 26.18.0，建议与 Electron 升级一起做 |
| P3-10 | 无自动更新 | 无签名条件下不建议上 `electron-updater`（NSIS 静默更新的信任问题）；保持「检查更新 → 跳 Releases」更稳 |
| P3-11 | 深色主题强制 | `nativeTheme.themeSource = 'dark'`，系统浅色时标题栏也是暗的；可加「跟随系统」选项 |
| P3-12 | 缩放不记忆 | 每次启动重置缩放；可用 `webFrame.setZoomLevel` 持久化到 userData |
| P3-13 | 无右键菜单 / 编辑菜单 | 页面里右键没有任何菜单（复制/粘贴只能靠快捷键）；可加一个基础 `context-menu` 菜单（复制、粘贴、全选、检查元素） |
| P3-14 | `error.html` 体验 | 10 秒无限重试（离线时永远循环）；建议用 `navigator.onLine` + 退避重试 + 「打开官网」按钮 + 基础 CSP meta |
| P3-15 | UA 仍暴露产品 token | 去掉 `Electron/x` 后仍是 `HongguoDuanju/1.2.0 Chrome/130...`；如担心风控，可完整替换为 Chrome UA（实测站点加载不受影响） |
| P3-16 | 媒体键 | 可注册 `MediaPlayPause` 等全局快捷键（桌面刷剧体验加分） |
| P3-17 | `appId` 用 `com.local.*` | 公开分发建议改成稳定的反向域名（如 `com.github.huyang-md.hongguoduanju`），越早改越省事（影响 NSIS 身份/以后自动更新） |
| P3-18 | README 行数 | 「main.js 只有 200 来行」实际 358 行（仍可读，但数字要改） |
| P3-19 | 本地 `dist/` 残留 | 本地有 1.1.0 旧安装包（已 gitignore，只是占空间） |

---

## 5. README 宣称 vs 实际行为

| README 宣称 | 实际 | 结论 |
|---|---|---|
| 主进程 `main.js` 只有 200 来行 | 358 行 | 数字要改 |
| 老板键「一键隐藏窗口并自动暂停播放」 | 盲发空格；实测暂停态会变播放、隐藏窗口下可能无效 | **修复 P1-4 后才成立** |
| 关闭即缩到托盘 | 是；但托盘创建失败 时无入口 | 需 P2-1 兜底 |
| 小窗置顶 430×760 | 是；最大化/全屏进出有状态缺陷 | 需 P2-3 |
| 观看历史仅存本地、可清空 | 是；标题清洗有 bug（显示 SEO 关键词） | 需 P2-4 |
| 检查更新直达下载页 | 是；启动弹框体验待优化、链接未校验 | 需 P1-6 / P2-5 |
| 开机自启托盘勾选即可 | 是；开发模式会把 electron.exe 写进启动项 | 需 P2-6 |
| F11 / Ctrl+R / 缩放 | 是 | 一致 |
| 记住窗口位置、大小、最大化/全屏 | 是；只在正常关闭保存、不校验屏幕 | 需 P2-2 |
| 单实例防重复启动 | 是 | 一致 |
| 站内窗口内打开、站外走系统浏览器 | 是；302 重定向有缺口 | 需 P1-3 |
| 断网有重试页 | 是；10 秒无限重试 | 需 P3-14 |
| 「源码 100% 开源、包由 CI 云端构建、发布页附 SHA-256」 | 属实；v1.2.0 资产 digest 与 body 一致；但脚本未签名 | 建议补侧车 SHA / attestation |

---

## 6. 建议改造路线图

### 6.1 今天（约半天）

1. **P1-2 / P1-3 / P1-4 / P1-6**：`main.js` 内约 60 行改动（权限 deny、`will-redirect`、老板键改 `executeJavaScript`、更新 URL 白名单）。
2. **P2-4 cleanTitle**、**P2-6 自启守卫**（各 5 行）。
3. 本地 `npm start` 手测：播放 → 老板键隐藏是否静音/暂停 → 唤回是否恢复声音 → 小窗 → 托盘 → 断网错误页。
4. 把 README 的「200 来行」和老板键描述按实际修正。

### 6.2 本周

1. **P1-1 依赖升级**（Electron 43/45 + electron-builder 26 + CI Node 22），预留半天回归（§8）。
2. **P1-5** 重新生成 lock（官方源）+ 提交 `.npmrc`。
3. **P1-7** 崩溃恢复、**P2-1** 托盘兜底、**P2-2** 窗口状态、**P2-3** 小窗状态。
4. CI 最小加固（下面示例）+ 加 `npm run check`（`node --check main.js`）。

```yaml
# .github/workflows/build.yml 关键改动示意
on:
  push:
    tags: ['v*']
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read            # 顶层只读
concurrency:
  group: build-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: windows-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@<v4 的完整 SHA>
      - uses: actions/setup-node@<v4 的完整 SHA>
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: node --check main.js

  release:
    if: startsWith(github.ref, 'refs/tags/')
    needs: check
    runs-on: windows-latest
    permissions:
      contents: write
    steps:
      # checkout / setup-node / npm ci / npm run dist -- --publish never
      - name: Compute SHA-256
        shell: bash
        run: sha256sum dist/*.exe | tee dist/checksums.sha256
      - uses: softprops/action-gh-release@<v2 的完整 SHA>
        with:
          files: |
            dist/*.exe
            dist/checksums.sha256
          body_path: release-notes.md
```

### 6.3 有余力时

- P2-5 静默更新检查、P2-7 下载拦截、P2-8 AUMID、P2-9 快捷键提示、P2-10 托盘 ICO。
- P3 里挑：license/engines、LICENSE 打包、右键菜单、error.html 退避、electronLanguages 瘦身、attestation、SignPath 申请。

---

## 7. 值得保留的优点

- **安全基线正确**：`contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`、无 preload、无 IPC 桥，页面被 XSS 也拿不到 Node 能力。
- **信任边界克制**：只加载官方站点，外链走系统浏览器、`http/https` 协议白名单、单实例、无自动更新、无遥测，README 的合规声明完整。
- **发布链路完整**：tag 触发 CI、版本号取自 tag、artifactName 统一、release 附 SHA-256（实测与 GitHub API digest 一致），对一个个人项目来说已经超出平均水准。
- **代码可读性好**：注释解释「为什么」而不只是「做什么」，每个功能块清晰，没有过度抽象。
- **功能取舍合理**：没有为了「像 App」而逆向私有接口，设计边界写进 README，这是长期可维护的关键。

---

## 8. 升级/修复后的回归清单

1. `npm ci && npm start` 冷启动，首页正常、无白屏。
2. 详情页 → 播放页；**老板键隐藏**：声音停止（或静音），再按唤回声音恢复。
3. 播放中按老板键 → 页面暂停；暂停中按老板键 → 不会开始播放。
4. 站内详情页/切集（SPA 跳转）后，老板键仍生效（`did-navigate-in-page`）。
5. 托盘：显示、最近看过、小窗置顶、检查更新、开机自启、清空记录、退出各点一遍。
6. 小窗：从普通/最大化/全屏进入，退出后状态恢复正确；托盘文案随状态变化。
7. 关闭窗口 → 托盘存在；重启后窗口位置/大小/最大化恢复；拔掉副屏后启动窗口仍在可见区域。
8. 断网启动 → 错误页；恢复网络 → 10 秒内自动回到首页。
9. 多显示器拖拽、缩放（Ctrl+=/-/0）、F11、Alt 菜单。
10. 安装/覆盖安装/卸载（NSIS oneClick，每用户），检查桌面/开始菜单快捷方式名「红果短剧」。
11. 开机自启：勾选后重启系统确认能启动；取消后确认启动项移除。
12. 检查更新：无网 → 提示失败；有新版 → 弹框；「前往下载」打开的是 github.com Releases 页。

---

## 9. 参考链接

- Electron 发布与支持策略：<https://www.electronjs.org/docs/latest/tutorial/electron-timelines>
- Electron 33 安全清单（权限默认放行）：<https://github.com/electron/electron/blob/v33.4.11/docs/tutorial/security.md>
- Electron 33 `webContents` 文档（`will-redirect`、`did-navigate-in-page`、`sendInputEvent`）：<https://github.com/electron/electron/blob/v33.4.11/docs/api/web-contents.md>
- Electron 33 `session` 文档（权限类型）：<https://github.com/electron/electron/blob/v33.4.11/docs/api/session.md>
- Electron breaking changes：<https://www.electronjs.org/docs/latest/breaking-changes>
- GitHub Actions 安全使用（pin SHA）：<https://docs.github.com/en/actions/reference/security/secure-use>
- GitHub Artifact Attestations：<https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations>
- SignPath Foundation（OSS 免费签名）：<https://signpath.org/>
- Azure Artifact Signing：<https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart>
- npmmirror 说明：<https://npmmirror.com/>

---

*本报告由代码评审生成，所有「实测」结论来自 Electron 33.4.11 临时探针（`%TEMP%` 下独立脚本，未修改仓库文件）；外部事实均标注来源。*
