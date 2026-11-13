# tailscale

Claude Code and Codex plugin: a Bun MCP server (`src/`, bundled to `dist/server.js`) that calls the Tailscale API with `fetch`. Read [README.md](README.md) first.

## Rules

- Every tool is read-only today. A tool that changes the tailnet needs a `confirm` field, an entry in the README and a review before it merges.
- Never add a tool that writes the policy file. The policy belongs to the repository that owns it, and that repository applies it.
- Never put a credential in a result, an error or a log line.
- No tailnet names, addresses or keychain item names in code. Every site value comes from the environment.
- A failure returns the error envelope with a `code` and a `hint`. A tool never throws to the MCP client.
- `plugin.json` and `mcp.json` are the manifest sources. Do not hand-edit the generated `.claude-plugin/plugin.json`, `.mcp.json` or `dist/server.js`.
- Repository documents and code comments are English.

## Where to run things

In Loki's environment, the MacBook is for editing and git only. Run `bun install`, the build and the tests on `ssh sandbox` in a login shell (`bash -lc`). The tests mock `fetch` and never call Tailscale.

## Verify

```sh
bun install --frozen-lockfile
bun run check
```

Build with the Bun version that CI uses (`bun-version` in `.github/workflows/check.yml`). Another version produces a different `dist/server.js`, and the CI diff step fails.

For a live check, call `tailscale_get_capabilities`, then `tailscale_list_devices`.

## Release

1. Bump `version` in `package.json` and `plugin.json`, run `bun run check`, and commit the regenerated files.
2. Merge the PR. Then pin the new commit in [zyx1121/marketplace](https://github.com/zyx1121/marketplace) (see its AGENTS.md).
