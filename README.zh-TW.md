<!-- 翻譯自 README.md @ docs/readme-template-v2。只翻 "For AI agents" 以上的章節，英文版更新時一起改。 -->

<div align="center">

<h1>Tailscale</h1>

<p><strong>讓 agent 直接讀你的 tailnet：裝置、線上的 policy 檔、policy 驗證，全部是 MCP 工具。</strong></p>

[![CI](https://img.shields.io/github/actions/workflow/status/zyx1121/tailscale/check.yml?branch=main&style=flat-square&label=CI)](https://github.com/zyx1121/tailscale/actions)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-D97757?style=flat-square)](https://github.com/zyx1121/marketplace)
[![License](https://img.shields.io/github/license/zyx1121/tailscale?style=flat-square)](LICENSE)

[English](README.md) | **繁體中文** | [简体中文](README.zh-CN.md)

</div>

```console
$ tailscale_validate_policy { "path": "/repo/policy.hujson" }
{"data": {"valid": false, "message": "test(s) failed", "failures": [
  {"user": "x@example.com", "errors": ["address \"100.64.0.1:22\": want: Accept, got: Drop"]}]}}
```

Agent 想知道哪些機器在線上，或某個 policy 改動安不安全，不該去操作瀏覽器裡的管理後台。這個 plugin 給 Codex 和 Claude Code 5 個唯讀工具，直接呼叫 Tailscale API。

## 功能

- **列出裝置**：名稱、位址、擁有者、tag、線上狀態、金鑰到期日、subnet route，可篩選。
- **找一台裝置**：用 node ID、MagicDNS 名稱、hostname 或 tailnet 位址。
- **讀線上的 policy**：HuJSON 原文加 ETag，方便和 repo 裡的版本比對。
- **上線前驗證 policy**：Tailscale 解析候選檔並跑裡面的測試，不會改動任何東西。
- **說明自己的權限**：有一個工具回報 credential 來源與拿到的 OAuth scope。

## 快速開始

```sh
claude plugin marketplace add zyx1121/marketplace
claude plugin install tailscale@zyx1121
```

Codex：`codex plugin marketplace add zyx1121/marketplace`，再 `codex plugin add tailscale@zyx1121`。

需要 Bun 和一組 credential。在 Tailscale 管理後台建一個 OAuth client，scope 選 `devices:core:read` 和 `policy_file:read`，然後匯出：

```sh
export TAILSCALE_OAUTH_CLIENT_ID=...
export TAILSCALE_OAUTH_CLIENT_SECRET=...
```

開新的 session，問「我哪些裝置離線？」。

## 用法

| 工具 | 作用 |
|------|------|
| `tailscale_list_devices` | 列出裝置，可用 `query`、`tag`、`online` 篩選 |
| `tailscale_get_device` | 回傳一台裝置的全部欄位 |
| `tailscale_get_policy` | 回傳線上的 policy 檔與 ETag |
| `tailscale_validate_policy` | 檢查 policy，用 `policy` 文字或檔案 `path` 傳入 |
| `tailscale_get_capabilities` | 回報 credential 來源、scope 與工具清單 |

- 每個結果都是同一種外殼：成功有 `data`，失敗有 `error`，內含 `code` 和 `hint`。
- `permission_denied` 會列出 credential 目前有的 scope。到管理後台補上缺的 scope。
- 這個 plugin 不會改動 tailnet。Policy 由擁有它的 repo 套用。

## 設定

| 變數 | 設定 | 預設 |
|------|------|------|
| `TAILSCALE_API_KEY` | API access token，有設就優先用 | 無 |
| `TAILSCALE_OAUTH_CLIENT_ID` | OAuth client ID | 無 |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | OAuth client secret | 無 |
| `TAILSCALE_KEYCHAIN_SERVICE` | 存 OAuth client 的 macOS keychain 項目 | 無 |
| `TAILSCALE_TAILNET` | 要讀的 tailnet | `-`(credential 所屬的 tailnet) |

用 `TAILSCALE_KEYCHAIN_SERVICE` 時，項目是 generic password。帳號欄是 client ID，密碼是 client secret，secret 就不必放進環境變數：

```sh
security add-generic-password -s tailscale-mcp -a <client-id> -w
export TAILSCALE_KEYCHAIN_SERVICE=tailscale-mcp
```

## 運作方式

Bun MCP server 用 `fetch` 呼叫 `https://api.tailscale.com/api/v2`。OAuth client 會先換 access token，放在記憶體裡，到期前 1 分鐘換新，遇到 401 也會重換。Policy 驗證把候選檔送到 `acl/validate`，它只跑檔案裡的測試，不儲存。

## 限制

- 唯讀。不能核准、加 tag、改名或移除裝置，也不寫 policy 檔。
- `tailscale_get_device` 的選擇條件必須剛好對到一台裝置。兩台裝置可能同 hostname。
- Keychain 選項只支援 macOS。

## 授權

[MIT](LICENSE)
