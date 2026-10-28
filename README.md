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

## 部署

需求：Node.js 22+、Cloudflare 帳號、Wrangler。

```bash
npm install
npx wrangler login

# 1. 建立 D1（若不需要跨裝置同步可略過，但 wrangler.toml 需移除 DB 綁定）
npx wrangler d1 create personal-ai
# 將輸出的 database_id 填入 wrangler.toml

# 2. 套用 migration
npx wrangler d1 migrations apply personal-ai --remote

# 3. 設定密碼與簽章密鑰
npx wrangler secret put APP_PASSWORD
npx wrangler secret put AUTH_SECRET
# 選用：伺服器端預設 Groq（未建立瀏覽器供應商時使用）
npx wrangler secret put GROQ_API_KEY
# 選用：
npx wrangler secret put TAVILY_API_KEY

# 4. 建置前端並部署
npm run deploy
```

`AUTH_SECRET` 請使用至少 32 字元的隨機字串，例如：

```bash
openssl rand -base64 32
```

第一次開啟 `https://<worker>.workers.dev` 會導向 `/login`。輸入 `APP_PASSWORD` 即可。

### 自訂網域

先在 Cloudflare 綁定網域，再到 Worker 設定 `APP_ORIGIN=https://你的網域`。Cookie 使用 `__Host-session`，沒有 `Domain` 屬性，換網域不需要改程式。

### 本機開發

```bash
cp .dev.vars.example .dev.vars
# 填入 APP_PASSWORD、AUTH_SECRET；可選 TAVILY_API_KEY
npm run db:migrate:local
npm run dev
```

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