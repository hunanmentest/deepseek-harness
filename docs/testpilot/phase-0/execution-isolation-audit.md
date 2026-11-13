# TestPilot Phase 0 — execution isolation audit

English | [中文](execution-isolation-audit.zh.md)

This audit records what the harness confines when TestPilot runs a browser, and where the confinement stops. The plan requires a test worker to reach an arbitrary application under test. Every isolation boundary below was read from the source in this tree; the decisive findings are about what is absent rather than what is present.

## Process containment

The local subprocess provider selects one of three containment tiers per launch (`packages/subprocess/subprocess-local/src/index.ts:250`).

| Tier | Platform | Mechanism | Evidence |
|---|---|---|---|
| `linux-scope` | Linux | a user-systemd scope; termination uses `systemctl --user kill --kill-who=all` | `packages/subprocess/subprocess-local/src/index.ts:255`, `packages/subprocess/subprocess-local/src/linux-scope.ts:321` |
| `windows-job` | Windows | a Job Object, only when the runner is probeable | `packages/subprocess/subprocess-local/src/index.ts:265` |
| `fallback` | any | weaker containment, announced by an explicit warning | `packages/subprocess/subprocess-local/src/index.ts:269` |

The systemd tier's kill is a member-wide kill, not a leader kill. `packages/subprocess/subprocess-local/src/linux-scope.ts:62` defines the argument as `--kill-who=all`, and `packages/subprocess/subprocess-local/src/linux-scope.ts:313` runs `systemctl --user kill --kill-who=all --signal=<sig> <unit>`.

The fallback tier states its own limit in plain words. `packages/subprocess/subprocess-local/src/index.ts:288` warns that the provider "is using weaker process-tree containment" and that "descendants that escape the process group or direct-parent tree are not guaranteed to terminate or delay waitForExit()". On macOS the stated reason is that the platform has no supported persistent process-range owner (`packages/subprocess/subprocess-local/src/index.ts:280`); on Windows the reason depends on whether the process is a terminal (`packages/subprocess/subprocess-local/src/index.ts:283`).

The warning is emitted once per provider instance (`packages/subprocess/subprocess-local/src/index.ts:278`), so a TestPilot run that logs only the first warning will not repeat the caveat per spawn.

## Subprocess tree management

`signalTree` at `packages/subprocess/subprocess-local/src/spawn.ts:132` delivers a signal with platform-correct semantics. On Windows it terminates the tree through `taskkill` (`packages/subprocess/subprocess-local/src/spawn.ts:141`); on POSIX it signals the negative process-group id and falls back to the direct child when the group is gone (`packages/subprocess/subprocess-local/src/spawn.ts:146`).

The Windows implementation is `taskkill /PID <pid> /T /F` at `packages/subprocess/subprocess-local/src/spawn.ts:120`. The `/T` flag is the tree part and `/F` is the force part.

POSIX children are started in their own process group. `packages/subprocess/subprocess-local/src/spawn.ts:479` passes `detached: platform !== 'win32'` to the spawn options, which is what makes the negative-pid group signal at `packages/subprocess/subprocess-local/src/spawn.ts:146` meaningful.

Ownership is released only when the whole managed range is gone, not when the direct child settles. `packages/subprocess/subprocess-local/src/index.ts:233` states the reason: a TERM-trapping helper that outlives the leader must stay owned so teardown can still escalate it.

## File read and write limits

The sandbox policy in this repository is a file-effect policy. `packages/sandbox/sandbox/src/index.ts:38` declares its three modes, and the same declaration says network and process visibility are outside this vocabulary.

| Mode | Permitted file effects | Evidence |
|---|---|---|
| `read-only` | only required sinks such as `/dev/null` | `packages/sandbox/sandbox/src/index.ts:33` |
| `workspace-write` | the workspace, explicit extra roots where supported, and backend-defined temp areas | `packages/sandbox/sandbox/src/index.ts:35` |
| `danger-full-access` | confinement is bypassed | `packages/sandbox/sandbox/src/index.ts:35` |

The workspace boundary is the session's immutable cwd, carried as `workspaceRoot` (`packages/sandbox/sandbox-policy/src/index.ts:150`). Extra roots are validated rather than trusted: `resolveAdditionalWritableRoots` at `packages/sandbox/sandbox-policy/src/index.ts:50` requires every entry to be absolute and free of NUL bytes, and throws otherwise (`packages/sandbox/sandbox-policy/src/index.ts:53`). The list is deduplicated and frozen (`packages/sandbox/sandbox-policy/src/index.ts:57`).

What this policy does not do is govern the browser's own file access. It governs the file effects of harness-executed operations. A page loaded in Chromium reads files by the browser's own rules, not by the sandbox policy.

## The browser's own file boundary

That boundary is upstream, in `@playwright/mcp@0.0.80`. The relevant code lives in the upstream `playwright-core` bundle, in the `outputDir` and `checkFile` functions.

The output directory defaults to a `.playwright-mcp` subdirectory of the server's working directory (`node_modules/.pnpm/playwright-core@1.63.0-alpha-2026-08-31/node_modules/playwright-core/lib/coreBundle.js:65039`), unless the working directory is not writable, in which case it falls back to a temporary directory with the same base name (`node_modules/.pnpm/playwright-core@1.63.0-alpha-2026-08-31/node_modules/playwright-core/lib/coreBundle.js:65043`).

`checkFile` at `node_modules/.pnpm/playwright-core@1.63.0-alpha-2026-08-31/node_modules/playwright-core/lib/coreBundle.js:65054` rejects a path that is inside neither the output directory nor the workspace:

```text
if (flags.origin === "code" || options.config.allowUnrestrictedFileAccess || options.config.skillMode)
  return;
const output = outputDir(options);
const workspace = options.cwd;
if (!isPathInside(output, resolvedFilename) && !isPathInside(workspace, resolvedFilename))
  throw new Error(`File access denied: ${resolvedFilename} is outside allowed roots. Allowed roots: ${output}, ${workspace}`);
```

Three exemptions make the check narrower than it looks. The `code` origin skips the check entirely (`node_modules/.pnpm/playwright-core@1.63.0-alpha-2026-08-31/node_modules/playwright-core/lib/coreBundle.js:65055`), and it is the origin the upstream uses for its own generated artifacts — session folders, traces, downloads, and logs all pass `{ origin: "code" }`. The `allowUnrestrictedFileAccess` flag skips it, and the `skillMode` flag skips it.

The `code` origin is exactly what `browser_run_code_unsafe` uses, because that tool executes arbitrary code in the page and therefore writes files by arbitrary paths.

## Network egress

The upstream server has the origin controls. They are not enabled here.

`@playwright/mcp@0.0.80` accepts `--allowed-origins` and `--blocked-origins`. The implementation is `_setupRequestInterception` in the upstream `playwright-core` bundle (`node_modules/.pnpm/playwright-core@1.63.0-alpha-2026-08-31/node_modules/playwright-core/lib/coreBundle.js:65292`): an allowlist installs a catch-all abort route and then a continuing route per allowed origin, and a blocklist installs an aborting route per blocked origin.

```text
async _setupRequestInterception(context) {
  if (this.config.network?.allowedOrigins?.length) {
    this._disposables.push(await context.route("**", (route2) => route2.abort("blockedbyclient")));
    for (const origin of this.config.network.allowedOrigins) {
      const glob = originOrHostGlob(origin);
      this._disposables.push(await context.route(glob, (route2) => route2.continue()));
    }
  }
  if (this.config.network?.blockedOrigins?.length) {
    for (const origin of this.config.network.blockedOrigins)
      this._disposables.push(await context.route(originOrHostGlob(origin), (route2) => route2.abort("blockedbyclient")));
  }
}
```

The same upstream's command-line help states the limit of that mechanism in the option's own description (`node_modules/.pnpm/playwright-core@1.63.0-alpha-2026-08-31/node_modules/playwright-core/lib/coreBundle.js:73489`):

```text
--allowed-origins <origins>   semicolon-separated list of TRUSTED origins to allow the browser to request.
                              Default is to allow all.
                              Important: does not serve as a security boundary and does not affect redirects.
```

The harness provider does not pass either option. `packages/experimental/browser-use-playwright-mcp/src/index.ts:35` builds the argument list, and the only arguments it can add are the browser selection, the attach endpoint, and the headless and executable-path flags (`packages/experimental/browser-use-playwright-mcp/src/index.ts:36`, `packages/experimental/browser-use-playwright-mcp/src/index.ts:39`). No origin argument is passed.

No private-address or cloud-metadata-address blocking exists anywhere in this repository. A search of `packages/` for the link-local metadata address and for the cloud metadata host returns no implementation. There is also no address-range filter of any kind in the harness's own network layer, because the harness has no layer between the browser and the network.

The consequence is a single decisive fact: **the browser can reach any host the machine can reach.** The origin allowlist exists upstream, is well implemented, and is switched off here — and even when switched on, upstream itself declines to call it a security boundary.

## DNS rebinding, redirects, and WebSocket

None of the three is implemented in this repository.

| Vector | Status in this repository | Note |
|---|---|---|
| DNS rebinding | no implementation | the harness's Host fence covers its own local HTTP API (`packages/client/connection/src/api-request-trust.ts:3`), not the browser's outbound resolution |
| cross-origin redirect | no implementation | the upstream route interception does not affect redirects, by upstream's own statement |
| WebSocket egress | no implementation | no WebSocket interception exists in the browser path |

The upstream route interception applies to requests. A redirect produces a new request, which the interception does not re-evaluate against the allowlist, because upstream states that the option does not affect redirects. A WebSocket handshake is not an HTTP request that `context.route` intercepts.

All three are TestPilot design items, not configuration items.

## The browser attach endpoint

`validateBrowserMcpConfig` at `packages/experimental/browser-use-runtime/src/mcp.ts:60` checks the attach endpoint's protocol and whitespace, and nothing else.

| Property | Checked | Evidence |
|---|---|---|
| the endpoint parses as a URL | yes | `packages/experimental/browser-use-runtime/src/mcp.ts:64` |
| the protocol is `http`, `https`, `ws`, or `wss` | yes | `packages/experimental/browser-use-runtime/src/mcp.ts:68` |
| the endpoint contains whitespace | yes | `packages/experimental/browser-use-runtime/src/mcp.ts:68` |
| the host is a loopback or an expected address | **no** | `packages/experimental/browser-use-runtime/src/mcp.ts:60` |

An attach endpoint may therefore name any host the process can reach. The provider passes it through unchanged as `--cdp-endpoint` (`packages/experimental/browser-use-playwright-mcp/src/index.ts:37`).

Attach exclusivity is narrower than it looks. `packages/experimental/browser-use-runtime/README.md:83` states that exclusive ownership applies to one resource manager, "not separate providers, processes, or external browser clients". A second TestPilot worker, or any other client attached to the same browser, is outside the exclusion.

## Worker timeout, termination, and quiescence

The grace period has two jobs, and the contract says so. `packages/subprocess/subprocess/src/types.ts:86` describes `graceMs` as available to the provider's termination procedure and "used for draining still-open collected pipes after the process exits", because an inherited descriptor held by a survivor cannot hold the outcome open indefinitely.

The termination job is the staged TERM-then-KILL ladder in the local provider (`packages/subprocess/subprocess-local/src/spawn.ts:365`). The drain job is `packages/subprocess/subprocess-local/src/spawn.ts:417`: after the direct child settles, the outcome settles either when the output streams close or after `spec.graceMs`, whichever comes first (`packages/subprocess/subprocess-local/src/spawn.ts:422`).

Quiescence is a range property, not a command property. `packages/subprocess/subprocess/src/types.ts:195` declares `waitForExit(signal?)` as waiting "until the same managed range is empty — not just until the spawned command reports its outcome, so surviving work remains observable".

## Threat model

| Asset | Attack surface | Existing control | Gap | TestPilot obligation |
|---|---|---|---|---|
| the application under test | navigation to any URL the machine can reach | none in the harness; the upstream allowlist is available but unused | no origin restriction on browser requests | TestPilot must enforce its own navigation policy, and treat the upstream allowlist as a convenience rather than the control |
| session integrity | a cross-origin redirect out of an allowed origin | none | upstream route interception explicitly does not cover redirects | TestPilot must decide whether a redirect out of policy aborts the step, and detect it itself |
| the machine's network position | a WebSocket connection opened by page script | none | `context.route` does not intercept WebSocket handshakes | TestPilot must either block WebSocket at a layer it owns, or accept and record the exposure |
| name resolution | DNS rebinding of an allowed host to a private address | none | no address-range or resolution-time check exists | TestPilot must resolve and check the address itself if a host allowlist is to mean anything |
| cloud metadata and private services | a request to `169.254.169.254` or a private-range address | none | no metadata-address or private-range block exists in the repository | TestPilot must block link-local and private ranges itself |
| the host filesystem | `browser_run_code_unsafe` writing or reading by arbitrary path | the upstream `checkFile` root check, with a `code`-origin exemption | the exemption covers the arbitrary-code path | TestPilot must not treat the upstream file boundary as a control against `browser_run_code_unsafe` |
| the workspace filesystem | a browser page reading or writing workspace files | the sandbox policy governs harness-executed file effects only | the browser's own file access is outside that policy | TestPilot must scope the browser's working directory and account for `outputDir` separately |
| the session log and other sessions | a tool call made on behalf of another session | scope-filtered dispatch by scope key | scope tags are enforced by the dispatch filter, not by a per-session capability | TestPilot must not rely on scope alone to prevent one run from touching another run's session |
| the browser under test | an attach endpoint naming an unexpected host | protocol and whitespace validation only | the host is not checked | TestPilot must validate the attach host itself before acquiring the browser |
| secrets | a credential reaching a log or the model context | masked display in the client; redaction on MCP error diagnostics | masking is display-only and redaction does not cover successful results | TestPilot must keep secrets out of the model transcript by construction, not by masking |

## Further Exploration

- [Approval and security audit](approval-security-audit.md) — the credential boundary and the approval seam.
- [Agent, session, and tool lifecycle audit](session-tool-lifecycle-audit.md) — the worker lifecycle and its ownership.
- [Browser provider audit](browser-provider-audit.md) — how the browser is acquired and released.
- [MCP contract audit](mcp-contract-audit.md) — the measured tool list the browser exposes.
