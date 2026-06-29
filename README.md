# TrackerBoard 📋

主色調 `#72636E` 的專案票務管理工具，支援 Epic → Story → Subtask 三層結構。

## 功能
- ✅ 主票（Epic）/ 子票（Story）/ Subtask 三層
- ✅ 每張票可自訂步驟／階段
- ✅ 每個步驟可留言（支援連結自動轉為可點擊）
- ✅ 主票設定品牌、期限
- ✅ 看板視圖（依品牌篩選）
- ✅ 時間軸甘特圖（橫向 60 天）
- ✅ Google Apps Script + Google Sheet 作為後端
- ✅ localStorage 本機備份，離線可用

---

## 部署步驟

### 1. 上傳前端到 GitHub + Netlify

```
ticketing-tool/
  index.html   ← 主頁面
  app.js       ← 前端邏輯
```

1. 建立 GitHub repo，push `index.html` & `app.js`
2. Netlify → Add new site → Import from GitHub → 選 repo
3. Build command: 留空，Publish directory: `.`
4. Deploy！

### 2. 設定 Google Apps Script

1. 開啟一個 Google Sheet（建議命名 TrackerBoard）
2. 選單：**擴充功能 → Apps Script**
3. 貼上 `gas.js` 全部內容
4. 先執行一次 `testSetup()` 確認三個工作表建立成功
5. 左側選**部署 → 新增部署**
   - 類型：**網路應用程式**
   - 執行身分：**我**
   - 誰能存取：**所有人**（或你的組織）
6. 複製 Web App URL

### 3. 連接前端與 GAS

1. 開啟你的 Netlify 網站
2. 點右上角**設定 GAS** 按鈕
3. 貼上步驟 2 的 URL → 儲存

---

## Google Sheet 結構

自動建立三個工作表：

| Epics | Stories | Subtasks |
|-------|---------|----------|
| id, title, desc, brand, deadline, assignee, status, steps, comments, createdAt | id, epicId, title, desc, assignee, status, steps, comments, createdAt | id, storyId, title, desc, assignee, status, done, comments, createdAt |

---

## 離線說明

即使沒有設定 GAS，工具仍可正常使用，資料存在瀏覽器 `localStorage`。
設定 GAS 後每次新增/修改都會同步，也可用「重新載入」從 Sheet 拉回所有資料。
