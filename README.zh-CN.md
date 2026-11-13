<!-- 翻译自 README.md @ docs/readme-template-v2。只翻 "For AI agents" 以上的章节，英文版更新时一起改。 -->

<div align="center">

<h1>Tailscale</h1>

<p><strong>让 agent 直接读你的 tailnet：设备、线上的 policy 文件、policy 验证，全部是 MCP 工具。</strong></p>

[![CI](https://img.shields.io/github/actions/workflow/status/zyx1121/tailscale/check.yml?branch=main&style=flat-square&label=CI)](https://github.com/zyx1121/tailscale/actions)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-D97757?style=flat-square)](https://github.com/zyx1121/marketplace)
[![License](https://img.shields.io/github/license/zyx1121/tailscale?style=flat-square)](LICENSE)

[English](README.md) | [繁體中文](README.zh-TW.md) | **简体中文**

</div>

```console
$ tailscale_validate_policy { "path": "/repo/policy.hujson" }
{"data": {"valid": false, "message": "test(s) failed", "failures": [
  {"user": "x@example.com", "errors": ["address \"100.64.0.1:22\": want: Accept, got: Drop"]}]}}
```

Agent 想知道哪些机器在线，或某个 policy 改动安不安全，不该去操作浏览器里的管理后台。这个 plugin 给 Codex 和 Claude Code 5 个只读工具，直接调用 Tailscale API。

## 功能

- **列出设备**：名称、地址、所有者、tag、在线状态、密钥到期日、subnet route，可筛选。
- **找一台设备**：用 node ID、MagicDNS 名称、hostname 或 tailnet 地址。
- **读线上的 policy**：HuJSON 原文加 ETag，方便和 repo 里的版本比对。
- **上线前验证 policy**：Tailscale 解析候选文件并跑里面的测试，不会改动任何东西。
- **说明自己的权限**：有一个工具报告 credential 来源与拿到的 OAuth scope。

## 快速开始

```sh
claude plugin marketplace add zyx1121/marketplace
claude plugin install tailscale@zyx1121
```

Codex：`codex plugin marketplace add zyx1121/marketplace`，再 `codex plugin add tailscale@zyx1121`。

需要 Bun 和一组 credential。在 Tailscale 管理后台建一个 OAuth client，scope 选 `devices:core:read` 和 `policy_file:read`，然后导出：

```sh
export TAILSCALE_OAUTH_CLIENT_ID=...
export TAILSCALE_OAUTH_CLIENT_SECRET=...
```

开新的 session，问“我哪些设备离线？”。

## 用法

| 工具 | 作用 |
|------|------|
| `tailscale_list_devices` | 列出设备，可用 `query`、`tag`、`online` 筛选 |
| `tailscale_get_device` | 返回一台设备的全部字段 |
| `tailscale_get_policy` | 返回线上的 policy 文件与 ETag |
| `tailscale_validate_policy` | 检查 policy，用 `policy` 文本或文件 `path` 传入 |
| `tailscale_get_capabilities` | 报告 credential 来源、scope 与工具列表 |

- 每个结果都是同一种外壳：成功有 `data`，失败有 `error`，内含 `code` 和 `hint`。
- `permission_denied` 会列出 credential 目前有的 scope。到管理后台补上缺的 scope。
- 这个 plugin 不会改动 tailnet。Policy 由拥有它的 repo 应用。

## 配置

| 变量 | 设置 | 默认 |
|------|------|------|
| `TAILSCALE_API_KEY` | API access token，设了就优先用 | 无 |
| `TAILSCALE_OAUTH_CLIENT_ID` | OAuth client ID | 无 |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | OAuth client secret | 无 |
| `TAILSCALE_KEYCHAIN_SERVICE` | 存 OAuth client 的 macOS keychain 条目 | 无 |
| `TAILSCALE_TAILNET` | 要读的 tailnet | `-`(credential 所属的 tailnet) |

用 `TAILSCALE_KEYCHAIN_SERVICE` 时，条目是 generic password。账号栏是 client ID，密码是 client secret，secret 就不必放进环境变量：

```sh
security add-generic-password -s tailscale-mcp -a <client-id> -w
export TAILSCALE_KEYCHAIN_SERVICE=tailscale-mcp
```

## 工作原理

Bun MCP server 用 `fetch` 调用 `https://api.tailscale.com/api/v2`。OAuth client 会先换 access token，放在内存里，到期前 1 分钟换新，遇到 401 也会重换。Policy 验证把候选文件送到 `acl/validate`，它只跑文件里的测试，不保存。

## 限制

- 只读。不能批准、加 tag、改名或移除设备，也不写 policy 文件。
- `tailscale_get_device` 的选择条件必须刚好对到一台设备。两台设备可能同 hostname。
- Keychain 选项只支持 macOS。

## 许可

[MIT](LICENSE)
