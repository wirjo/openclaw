import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAcpxPluginConfig, resolveAcpxPluginRoot } from "./config.js";

describe("embedded acpx plugin config", () => {
  it("resolves workspace stateDir and cwd by default", () => {
    const workspaceDir = "/tmp/openclaw-acpx";
    const resolved = resolveAcpxPluginConfig({
      rawConfig: undefined,
      workspaceDir,
    });

    expect(resolved.cwd).toBe(workspaceDir);
    expect(resolved.stateDir).toBe(path.join(workspaceDir, "state"));
    expect(resolved.permissionMode).toBe("approve-reads");
    expect(resolved.nonInteractivePermissions).toBe("deny");
    expect(resolved.timeoutSeconds).toBe(120);
    expect(resolved.agents).toEqual({});
  });

  it("defaults nonInteractivePermissions to deny (not fail) for the embedded runtime", () => {
    // Regression test: the embedded acpx runtime always runs inside the
    // headless gateway process, so process.stdin/stderr are never a TTY --
    // for every ACP session, including ones bound to an interactive channel
    // thread. With the old default ("fail"), any non-auto-approved write or
    // exec permission request threw PermissionPromptUnavailableError deep
    // inside the Claude Agent SDK's own tool-retry loop, causing background
    // sessions_spawn(runtime="acp") turns to hang for the remainder of the
    // turn before finally surfacing as AcpRuntimeError[ACP_TURN_FAILED].
    // "deny" keeps the same operations blocked but returns a normal in-band
    // denial immediately instead of throwing, so turns finish fast instead of
    // deadlocking. See docs/tools/acp-agents.md#permission-configuration.
    const resolved = resolveAcpxPluginConfig({
      rawConfig: undefined,
      workspaceDir: "/tmp/openclaw-acpx",
    });

    expect(resolved.nonInteractivePermissions).toBe("deny");
    expect(resolved.nonInteractivePermissions).not.toBe("fail");
  });

  it("still allows callers to opt back into fail-fast nonInteractivePermissions", () => {
    const resolved = resolveAcpxPluginConfig({
      rawConfig: { nonInteractivePermissions: "fail" },
      workspaceDir: "/tmp/openclaw-acpx",
    });

    expect(resolved.nonInteractivePermissions).toBe("fail");
  });

  it("keeps explicit timeoutSeconds config", () => {
    const resolved = resolveAcpxPluginConfig({
      rawConfig: {
        timeoutSeconds: 300,
      },
      workspaceDir: "/tmp/openclaw-acpx",
    });

    expect(resolved.timeoutSeconds).toBe(300);
  });

  it("accepts agent command overrides", () => {
    const resolved = resolveAcpxPluginConfig({
      rawConfig: {
        agents: {
          claude: { command: "claude --acp" },
          codex: { command: "codex custom-acp" },
        },
      },
      workspaceDir: "/tmp/openclaw-acpx",
    });

    expect(resolved.agents).toEqual({
      claude: "claude --acp",
      codex: "codex custom-acp",
    });
  });

  it("injects the built-in plugin-tools MCP server only when explicitly enabled", () => {
    const resolved = resolveAcpxPluginConfig({
      rawConfig: {
        pluginToolsMcpBridge: true,
      },
      workspaceDir: "/tmp/openclaw-acpx",
    });

    const server = resolved.mcpServers["openclaw-plugin-tools"];
    expect(server).toBeDefined();
    expect(server.command).toBe(process.execPath);
    expect(Array.isArray(server.args)).toBe(true);
    expect(server.args?.length).toBeGreaterThan(0);
  });

  it("keeps the runtime json schema in sync with the manifest config schema", () => {
    const pluginRoot = resolveAcpxPluginRoot();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, "openclaw.plugin.json"), "utf8"),
    ) as { configSchema?: unknown };

    expect(manifest.configSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: expect.objectContaining({
        cwd: expect.any(Object),
        stateDir: expect.any(Object),
        timeoutSeconds: expect.objectContaining({
          default: 120,
        }),
        agents: expect.any(Object),
        mcpServers: expect.any(Object),
      }),
    });
  });
});
