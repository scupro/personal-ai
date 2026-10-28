# Personal AI

私人、單使用者的 AI 對話工作區，部署在 Cloudflare Workers 免費層。前端沿用原始專案成熟的聊天介面（主題、文件、專案、Artifacts、Prompt 庫、i18n），後端改寫為單一密碼登入、OpenAI 相容供應商代理、D1 同步、Tavily 搜尋與 Pollinations 圖片生成。

## 功能

- 單一密碼登入（`APP_PASSWORD`），HMAC 簽章工作階段，不用資料庫查詢
- 自訂 OpenAI 相容供應商：Base URL、API Key、模型
- 原始 SSE 轉發，不逐 token 解析，降低 Workers CPU 使用
- 串流聊天、Markdown/程式碼區塊、Artifacts 預覽
- 文件／專案／聊天／Prompt 設定的 D1 跨裝置同步（可選）
- Tavily 低 token 網頁搜尋（`search_depth=basic`、5 筆、10 分鐘快取）
- Pollinations 免費圖片生成，經 Worker 代理以處理 429／逾時
- 工具介面預留 MCP 擴充點；v1 不啟用 MCP
- 無 Google Fonts、無追蹤腳本、`robots.txt` 全面禁止索引

## 部署方式一：Cloudflare Dashboard（Workers Builds）

需求：Cloudflare 帳號、已推送的 GitHub repo。這個專案是 **Worker + Static Assets**，不是 Pages。

### 1. 建立 Worker 並連接 GitHub

1. Cloudflare Dashboard → **Workers & Pages → Create**
2. 選 **Workers**，不要選 Pages
3. 選 **Connect to Git**
4. 選擇 `scupro/personal-ai`，Branch 選 `main`，Root directory 保持 `/`
5. Build command 填：

```bash
npm ci && npm run build:web
```

6. Deploy command 填：

```bash
npx wrangler deploy
```

這時可以直接部署。`wrangler.toml` 的 D1 區塊預設是註解狀態，所以不需要 Database ID；聊天、圖片、登入都能用，但跨裝置同步會顯示為停用。

### 2. 設定 Secrets

Worker → **Settings → Variables and Secrets**，新增：

| 名稱 | 必要性 | 說明 |
| --- | --- | --- |
| `APP_PASSWORD` | 必要 | 登入密碼 |
| `AUTH_SECRET` | 必要 | 至少 32 字元隨機字串 |
| `GROQ_API_KEY` | 選用 | 伺服器端預設 Groq |
| `TAVILY_API_KEY` | 選用 | 網頁搜尋 |

`AUTH_SECRET` 可用下列指令產生：

```bash
openssl rand -base64 32
```

### 3. 之後啟用 D1 同步

第一次部署不需要 D1。要啟用跨裝置同步時：

1. Dashboard → **Storage & Databases → D1 SQL Database → Create**，名稱 `personal-ai`
2. 進入該 D1 → **Console**，執行 `migrations/0001_init.sql` 的內容
3. 複製 D1 的 **Database ID**
4. 編輯 `wrangler.toml`，取消 `[[d1_databases]]` 區塊的註解，填入真實 ID：

```toml
[[d1_databases]]
binding = "DB"
database_name = "personal-ai"
database_id = "你的-Database-ID"
migrations_dir = "migrations"
```

5. Commit／push，Workers Builds 會重新部署

啟用後 `/api/me` 會回報 `sync:true`，設定頁的同步功能才會出現。

> 也可以完全不用 Dashboard 的 D1 綁定，改用 `wrangler d1 migrations apply personal-ai --remote`；但 Git 部署仍建議把 ID 寫進 `wrangler.toml`，避免下次部署覆蓋 Dashboard 設定。

### 4. 開啟網站

第一次開啟 `https://<worker>.workers.dev` 會導向 `/login`。輸入 `APP_PASSWORD` 即可。

## 部署方式二：Wrangler CLI

這種方式不需要 Dashboard 的 Git 整合，適合從本機直接部署。兩種方式可以並存，但都要使用同一份 `wrangler.toml`。

```bash
npm install
npx wrangler login

# 1. 選用：建立 D1 並啟用同步
npx wrangler d1 create personal-ai
# 將輸出的 database_id 填入 wrangler.toml，
# 並取消 [[d1_databases]] 區塊的註解
npx wrangler d1 migrations apply personal-ai --remote

# 2. 設定 Secrets
npx wrangler secret put APP_PASSWORD
npx wrangler secret put AUTH_SECRET
# 選用：伺服器端預設 Groq
npx wrangler secret put GROQ_API_KEY
# 選用：Tavily 網頁搜尋
npx wrangler secret put TAVILY_API_KEY

# 3. 建置前端並部署
npm run deploy
```

如果暫時不啟用 D1，跳過第 1 步即可；`wrangler.toml` 的 D1 區塊保持註解，聊天與圖片功能仍會部署。

`AUTH_SECRET` 請使用至少 32 字元的隨機字串：

```bash
openssl rand -base64 32
```

部署後開啟 `https://<worker>.workers.dev`，會導向 `/login`。

### 自訂網域

先在 Cloudflare 綁定網域，再到 Worker 設定 `APP_ORIGIN=https://你的網域`。Cookie 使用 `__Host-session`，沒有 `Domain` 屬性，換網域不需要改程式。

### 本機開發

```bash
cp .dev.vars.example .dev.vars
# 填入 APP_PASSWORD、AUTH_SECRET；可選 TAVILY_API_KEY
npm run dev
```

若要在本機測試 D1 同步，先取消 `wrangler.toml` 的 `[[d1_databases]]` 註解、填入一個本機用的 Database ID，再執行 `npm run db:migrate:local`。不啟用 D1 時，其他功能仍可正常測試。

`.dev.vars` 已被 `.gitignore` 排除，請勿提交。

## 設定供應商

登入後到「設定 → 供應商」：

| 欄位 | 範例 |
| --- | --- |
| 名稱 | Groq |
| Base URL | `https://api.groq.com/openai/v1` |
| API Key | 你的供應商金鑰 |
| 模型 | `openai/gpt-oss-120b` |

也支援 OpenAI、OpenRouter、DeepSeek、Mistral 等 OpenAI 相容 `/chat/completions`。只允許公開 HTTPS 位址；localhost、私有 IP、`.local`、`.internal` 會被拒絕。

API Key 只存在瀏覽器 `localStorage`，不會寫入 D1，也不會出現在伺服器日誌。

若設定 `GROQ_API_KEY`，沒有建立瀏覽器供應商時會自動使用伺服器端 Groq；模型預設為 `openai/gpt-oss-120b`，可用 `GROQ_MODEL` 或請求中的模型覆寫。只要瀏覽器有設定供應商，該供應商就優先，伺服器預設不會被使用。

## 同步

同步採「每個項目一列」的 last-write-wins：

- `chat:<id>`、`doc:<id>`、`project:<id>`、`prompt:<name>`、`setting:<name>`
- 刪除以 tombstone 傳播
- 每次同步最多 200 項，單項 900 KB
- 前端會在聊天／文件／專案儲存後 debounce 推送，啟動時 pull

D1 免費層額度（2026-10）：每日 500 萬次讀取、10 萬次寫入、500 MB。個人使用足夠。

## 安全邊界

- 所有 `/api/*`（除 health/config/login）都需要工作階段
- POST 檢查同源 `Origin`
- 登入失敗 5 次鎖定 5 分鐘（單一 isolate 記憶體）
- 上游 URL 只允許 HTTPS，封鎖私有網段與本地位址
- 讀取網頁工具最多 4 次重新導向、220 KB、20 秒
- CSP 限制 script/connect/frame；圖片只允許自身與 Pollinations
- 不提供註冊、Email、OAuth、公開分享、Messaging/Slack、市場報價、Connectors、MCP

## 測試

```bash
npm test
npm run check
```

`npm run check` 會執行 `wrangler deploy --dry-run`，不會真的部署。

## 授權

MIT。原始專案 attribution 見 `LICENSE` 與 `NOTICE`。