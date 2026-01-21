# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Monitor Configuration (User Hardware)

-   **Monitor 2 (Primary)**
    -   Resolution: 1920 x 1080 (100% Scaling)
    -   Position: (0, 0)
-   **Monitor 1 (Secondary)**
    -   Resolution: 1920 x 1200 (125% Windows Scaling) -> Logical: 1536 x 960
    -   Position: (1920, 170)

---

## 自動化操作序列圖

### 1. Send Input 按鈕
```
Send Input 按鈕
    │
    ▼
typeText(text, x, y) ← Remote(x, y)
    │
    ├─► 點擊 (x, y)
    ├─► 剪貼簿貼上文字 (Base64 編碼)
    ├─► 按 Enter
    │
    └─► runInputLoop(x, y) [背景]
            │
            └─► 每 10 秒循環 (Stop Loop → break)：
                  點擊 → Alt+Enter → 檢測/點擊 Retry → 等待
```

### 2. 觸發按鈕 (Enable Macro Mode)
```
觸發按鈕
    │
    ▼
mouseClick(x, y) ← Remote(x, y)
    │
    └─► 點擊 (x, y)
    │
    └─► runInputLoop(x, y) [背景]
            │
            └─► 每 10 秒循環 (Stop Loop → break)：
                  點擊 → Alt+Enter → 檢測/點擊 Retry → 等待
```

### 3. Auto Accept All 按鈕
```
Auto Accept All
    │
    ▼
startAutoAccept()
    │
    └─► autoAcceptLoop() [背景]
            │
            └─► 每 3 秒循環 (Stop Auto Accept → break)：
                  擷取螢幕 → 模板匹配 accept_exact_bgr.png
                      │
                      ├─► 找到 → 點擊 Accept 按鈕 → 等待 1 秒
                      └─► 沒找到 → 繼續等待
```

### 4. Restart Terminal 按鈕
```
Restart Terminal
    │
    ▼
restartTerminal(x, y, command)
    │
    ├─► 點擊 Terminal 位置 (x, y)
    ├─► 等待 1 秒
    ├─► 按 Ctrl+C (停止當前程序)
    ├─► 等待 2 秒
    ├─► 剪貼簿貼上指令
    ├─► 等待 1 秒
    └─► 按 Enter (執行指令)
```

### 5. Mouse Click
```
Mouse Click
    │
    ▼
mouseClick(x, y)
    │
    └─► mouse.setPosition({x, y}) → mouse.leftClick()
```

### 6. Press Key
```
Press Key
    │
    ▼
pressKey(key)
    │
    ├─► ENTER      → Key.Enter
    ├─► SPACE      → Key.Space
    ├─► ESCAPE     → Key.Escape
    └─► ALT_ENTER  → Key.LeftAlt + Key.Enter
```

### 7. Capture Snapshot (Debug)
```
Capture Snapshot
    │
    ▼
CAPTURE_SNAPSHOT event
    │
    ├─► captureScreen() → 擷取螢幕 (BGR→RGB 轉換)
    └─► 儲存 server_snapshot.png
```

### 8. Screen Monitoring (背景)
```
startMonitoring() [自動啟動]
    │
    └─► 每 1 秒循環：
          擷取螢幕 → JPEG 壓縮 (60%) → Base64 編碼
              │
              └─► emit('screen_update') → 傳送至 Web UI
```

### 9. Timed Loop (倒數計時循環 - 持續性背景執行)
```
Timed Loop 按鈕 (Frontend Web)
    │
    ▼
handleStartTimedLoop()
    │
    ├─► 檢查設定 & 發送指令: TIMED_LOOP_START {x, y, text}
    │
    ↓ Railway Server (中繼站)
    │
    ├─► 啟動 Railway 計時器 (例如 30s) —— 倒數歸零時觸發
    └─► 轉發指令給 Local Agent
            │
            ▼
    Local Agent (Python 本機)
            │
            ├─► **立即執行**:
            │     1. 點擊 Remote (x, y)
            │     2. 貼上文字 + Enter (如有設定)
            │
            ├─► 檢查: 背景執行緒是否運行中?
            │     │
            │     ├─► 否: 啟動 [背景執行緒 loop_worker]
            │     │
            │     └─► 是: 僅更新參數，不重複啟動
            │
            ▼
    [背景執行緒 loop_worker] (獨立運作)
            │
            └─► 每 10 秒固定循環 (只做動作，不貼文字)：
                  1. 點擊 Remote (x, y)
                  2. 按下 Alt + Enter
                  3. 偵測並點擊 Retry 按鈕 (如有)
                  4. 偵測並點擊 Accept 按鈕 (如有)

    ↓ 前端按下停止 (Stop Button)
    │
    └─► 發送 timer_action: stop
            │
            └─► Railway 轉發 STOP_LOOP 指令
                    │
                    └─► Agent 收到後立即終止 [背景執行緒]
```