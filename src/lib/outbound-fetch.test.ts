import { Agent } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import { outboundFetch } from "./outbound-fetch";

const nodeMajor = Number(process.versions.node.split(".")[0]);

afterEach(() => vi.unstubAllGlobals());

describe("outboundFetch", () => {
  it("goes through the global fetch, so stubs apply", async () => {
    const stub = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", stub);
    const res = await outboundFetch()("https://api.example.test/x", { method: "POST", body: "{}" });
    expect(await res.text()).toBe("ok");
    expect(stub).toHaveBeenCalledOnce();
    expect(stub.mock.calls[0]).toEqual(["https://api.example.test/x", expect.objectContaining({ method: "POST", body: "{}" })]);
  });

  it.runIf(nodeMajor >= 25)("uses an HTTP/1.1-only pool on Node 25+, where fetch would otherwise speak HTTP/2", async () => {
    const stub = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", stub);
    await outboundFetch()("https://api.example.test/x");
    const init = (stub.mock.calls[0] as unknown[])[1] as { dispatcher?: unknown };
    expect(init.dispatcher).toBeInstanceOf(Agent);
  });

  it.runIf(nodeMajor < 25)("is the built-in fetch on Node 24, which already uses HTTP/1.1", () => {
    expect(outboundFetch()).toBe(fetch);
  });
});
