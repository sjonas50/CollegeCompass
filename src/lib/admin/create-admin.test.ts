import { describe, expect, it } from "vitest";
import { CREATE_ADMIN_USAGE, CreateAdminSchema, parseCreateAdminArgs } from "./create-admin";

// Account creation itself runs against a database in test/admin.test.ts.

describe("admin:create arguments", () => {
  it("reads --email and --name as separate or joined values", () => {
    expect(parseCreateAdminArgs(["--email", "staff@example.com", "--name", "Jordan Lee"])).toEqual({
      ok: true,
      email: "staff@example.com",
      name: "Jordan Lee",
    });
    expect(parseCreateAdminArgs(["--name=Jordan", "--email=staff@example.com"])).toEqual({ ok: true, email: "staff@example.com", name: "Jordan" });
  });

  it("explains usage when something is missing or unknown, and never takes a password argument", () => {
    expect(parseCreateAdminArgs([])).toEqual({ ok: false, message: CREATE_ADMIN_USAGE });
    expect(parseCreateAdminArgs(["--help"])).toEqual({ ok: false, message: CREATE_ADMIN_USAGE });
    expect(parseCreateAdminArgs(["--email", "staff@example.com"])).toEqual({ ok: false, message: CREATE_ADMIN_USAGE });
    expect(parseCreateAdminArgs(["--email", "--name", "Jordan"])).toMatchObject({ ok: false, message: expect.stringContaining("--email needs a value") });
    expect(parseCreateAdminArgs(["--email", "a@b.co", "--name", "J", "--password", "hunter2"])).toMatchObject({
      ok: false,
      message: expect.stringContaining("Unknown argument: --password"),
    });
    expect(parseCreateAdminArgs(["--name", "  ", "--email", "a@b.co"])).toEqual({ ok: false, message: CREATE_ADMIN_USAGE });
  });
});

describe("admin account input", () => {
  it("needs a real email, a name, and a password of at least 16 characters", () => {
    expect(CreateAdminSchema.safeParse({ email: " Staff@Example.com ", displayName: "Jordan", password: "a".repeat(16) })).toMatchObject({
      success: true,
      data: { email: "staff@example.com" },
    });
    expect(CreateAdminSchema.safeParse({ email: "staff@example.com", displayName: "Jordan", password: "a".repeat(15) }).success).toBe(false);
    expect(CreateAdminSchema.safeParse({ email: "not-an-email", displayName: "Jordan", password: "a".repeat(20) }).success).toBe(false);
    expect(CreateAdminSchema.safeParse({ email: "staff@example.com", displayName: " ", password: "a".repeat(20) }).success).toBe(false);
    expect(CreateAdminSchema.safeParse({ email: "staff@example.com", displayName: "Jordan", password: "a".repeat(129) }).success).toBe(false);
  });
});
