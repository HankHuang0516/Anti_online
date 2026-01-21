---
description: Pre-work checklist before starting any task in this project
---

# Anti Online Pre-Work Checklist

Before starting ANY task in this project, you MUST:

// turbo-all

Important: 全程用繁體中文溝通

## 1. 🟢 系統狀態檢查
**首先**，檢查 Production 後台狀態：
```
read_url_content https://antionline-production.up.railway.app/
```
- 如果回傳不是 "Anti Online Relay Server Running"：**停止！** 先排查 Railway 部署問題。

---

## 2. 📖 讀取專案規則
```
view_file .cursorrules
```

## 3. 📦 部署前置檢查
- 進入 `web` 目錄執行 `npm run build` 確保編譯成功。
- 更新 `web/package.json` 中的版本：使用 `git rev-list --count HEAD` + 1。
- 確保 `railway/index.js` 與 `server/index.js` 的連線邏輯一致。

## 4. 🔴 嚴格部署規範
- **Push 代碼前：**
    - 確保本地 `npm run build` 通過。
    - **如果編譯失敗，絕對不要部署。**
- **Push 代碼後：**
    - 監控 Railway Build Logs。如果失敗，**立刻修復或 Rollback**。

## 5. 🟡 部署後驗證
部署完成後，驗證以下關鍵點：

### 連線功能驗證
- 打開 Web 頂部的 **"Enable Host"**。
- 啟動本地 `server/index.js`，確認 Web 顯示 **"Host Online"**。

### 本地計時器驗證
- 在 `http://localhost:7000` 或是部署後的網址設定 **Timed Loop**。
- 驗證倒數計時是否跨裝置同步。
- 驗證本地 Agent 是否準確執行動作。

### 常用指令備忘錄
| 目標 | 命令 (在各自目錄下) |
|---------|-------|
| 啟動 Web 開發環境 | `npm run dev` |
| 啟動本地 Server | `node index.js` |
| 部署到 Railway | `railway up` |
