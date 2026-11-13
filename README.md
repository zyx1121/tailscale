<div align="center">

<h1>Tailscale</h1>

<p><strong>Read your tailnet from your agent: devices, the live policy file and policy validation as MCP tools.</strong></p>

[![CI](https://img.shields.io/github/actions/workflow/status/zyx1121/tailscale/check.yml?branch=main&style=flat-square&label=CI)](https://github.com/zyx1121/tailscale/actions)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-D97757?style=flat-square)](https://github.com/zyx1121/marketplace)
[![License](https://img.shields.io/github/license/zyx1121/tailscale?style=flat-square)](LICENSE)

**English** | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

</div>

```console
$ tailscale_validate_policy { "path": "/repo/policy.hujson" }
{"data": {"valid": false, "message": "test(s) failed", "failures": [
  {"user": "x@example.com", "errors": ["address \"100.64.0.1:22\": want: Accept, got: Drop"]}]}}
```

An agent that needs to know which machines are online, or whether a policy change is safe, should not drive the admin console in a browser. This plugin gives Codex and Claude Code 5 read-only tools that call the Tailscale API directly.

## Features

- **Lists devices**: names, addresses, owners, tags, online state, key expiry and subnet routes, with filters.
- **Finds one device**: by node ID, MagicDNS name, hostname or tailnet address.
- **Reads the live policy**: the policy file as HuJSON with its ETag, to compare with the copy in your repository.
- **Validates a policy before it ships**: Tailscale parses a candidate file and runs its tests, and nothing changes.
- **Explains its own access**: one tool reports the credential source and the OAuth scopes it was granted.

## Quick start

```sh
claude plugin marketplace add zyx1121/marketplace
claude plugin install tailscale@zyx1121
```

Codex: `codex plugin marketplace add zyx1121/marketplace`, then `codex plugin add tailscale@zyx1121`.

The plugin needs Bun and one credential. Create an OAuth client in the Tailscale admin console with the scopes `devices:core:read` and `policy_file:read`, then export it:

```sh
export TAILSCALE_OAUTH_CLIENT_ID=...
export TAILSCALE_OAUTH_CLIENT_SECRET=...
```

Open a new session and ask "Which of my devices are offline?".

## Usage

| Tool | Does |
|------|------|
| `tailscale_list_devices` | lists devices, filtered by `query`, `tag` or `online` |
| `tailscale_get_device` | returns every field of one device |
| `tailscale_get_policy` | returns the live policy file and its ETag |
| `tailscale_validate_policy` | checks a policy given as `policy` text or as a file `path` |
| `tailscale_get_capabilities` | reports the credential source, granted scopes and tools |

- Every result is an envelope: `data` on success, or `error` with a `code` and a `hint`.
- A `permission_denied` error names the scopes that the credential has. Add the missing scope in the admin console.
- The plugin never changes the tailnet. Apply a policy from the repository that owns it.

## Configuration

| Variable | Sets | Default |
|----------|------|---------|
| `TAILSCALE_API_KEY` | an API access token, used first when set | none |
| `TAILSCALE_OAUTH_CLIENT_ID` | the OAuth client ID | none |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | the OAuth client secret | none |
| `TAILSCALE_KEYCHAIN_SERVICE` | macOS keychain item that holds the OAuth client | none |
| `TAILSCALE_TAILNET` | the tailnet to read | `-` (the credential's own tailnet) |

With `TAILSCALE_KEYCHAIN_SERVICE`, the item is a generic password. Its account is the client ID and its password is the client secret, so the secret stays out of the environment:

```sh
security add-generic-password -s tailscale-mcp -a <client-id> -w
export TAILSCALE_KEYCHAIN_SERVICE=tailscale-mcp
```

## How it works

The Bun MCP server calls `https://api.tailscale.com/api/v2` with `fetch`. For an OAuth client it requests an access token, keeps it in memory until one minute before it expires, and requests a new one after a 401. Policy validation posts the candidate file to the `acl/validate` endpoint, which runs the tests inside the file and stores nothing.

## Limits

- Read-only. It does not authorize, tag, rename or remove devices, and it does not write the policy file.
- `tailscale_get_device` needs a selector that matches exactly one device. Two devices can share a hostname.
- The keychain option works on macOS only.

## For AI agents

Facts for coding agents and LLM tools. The rules for changing the code are in [AGENTS.md](AGENTS.md).

- **Summary**: Claude Code and Codex plugin with 5 read-only MCP tools for Tailscale devices and the tailnet policy file.
- **Type**: plugin
- **Interfaces**: MCP `tailscale` (stdio, `dist/server.js`)
- **Install**: `claude plugin install tailscale@zyx1121`, after `claude plugin marketplace add zyx1121/marketplace`
- **Run**: the host starts the MCP server
- **Verify**: call `tailscale_get_capabilities` and read `configured` and `scopes`
- **Config**: `TAILSCALE_API_KEY`, `TAILSCALE_OAUTH_CLIENT_ID`, `TAILSCALE_OAUTH_CLIENT_SECRET`, `TAILSCALE_KEYCHAIN_SERVICE`, `TAILSCALE_TAILNET`
- **Secrets**: one Tailscale credential, from the environment or the macOS keychain. It never appears in a result.
- **Limits**: read-only. No device or policy writes.

## Development

```sh
bun install --frozen-lockfile
bun run check
```

The tests mock `fetch` and never call Tailscale. The marketplace pins each release commit.

## License

[MIT](LICENSE)
