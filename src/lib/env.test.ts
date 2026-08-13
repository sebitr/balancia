import { describe, expect, it } from "vitest";
import { EnvironmentError, parseEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://balancia:secret@localhost:5432/balancia",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef0123456789",
};

describe("environment validation", () => {
  it("accepts a minimal localhost development configuration", () => {
    const env = parseEnv({ ...base } as unknown as NodeJS.ProcessEnv);
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.webAuthnRpId).toBe("localhost");
    expect(env.trustedOrigins).toEqual(["http://localhost:3000"]);
    expect(env.smtpEnabled).toBe(false);
    expect(env.STORAGE_DRIVER).toBe("local");
  });

  it("requires a database URL", () => {
    expect(() =>
      parseEnv({
        AUTH_SECRET: base.AUTH_SECRET,
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(EnvironmentError);
  });

  it("rejects a short auth secret", () => {
    expect(() =>
      parseEnv({
        ...base,
        AUTH_SECRET: "too-short",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/AUTH_SECRET/);
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      parseEnv({
        ...base,
        DATABASE_URL: "mysql://localhost/balancia",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/PostgreSQL/);
  });

  describe("WebAuthn consistency", () => {
    it("defaults the relying-party ID to the APP_URL host", () => {
      const env = parseEnv({
        ...base,
        APP_URL: "https://balancia.example.com",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.webAuthnRpId).toBe("balancia.example.com");
    });

    it("allows a registrable parent domain as relying-party ID", () => {
      const env = parseEnv({
        ...base,
        APP_URL: "https://balancia.example.com",
        WEBAUTHN_RP_ID: "example.com",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.webAuthnRpId).toBe("example.com");
    });

    it("fails startup when the relying-party ID does not match the host", () => {
      expect(() =>
        parseEnv({
          ...base,
          APP_URL: "https://balancia.example.com",
          WEBAUTHN_RP_ID: "other.org",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/relying-party ID/);
    });

    it("fails startup for plain HTTP on a non-localhost host", () => {
      expect(() =>
        parseEnv({
          ...base,
          APP_URL: "http://balancia.example.com",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/HTTPS/);
    });

    it("permits plain HTTP on localhost for development", () => {
      for (const url of [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://app.localhost:3000",
      ]) {
        expect(() =>
          parseEnv({ ...base, APP_URL: url } as unknown as NodeJS.ProcessEnv),
        ).not.toThrow();
      }
    });
  });

  describe("storage", () => {
    it("requires bucket and region for the S3 driver", () => {
      expect(() =>
        parseEnv({
          ...base,
          STORAGE_DRIVER: "s3",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/S3_BUCKET/);
    });

    it("accepts a complete S3 configuration", () => {
      const env = parseEnv({
        ...base,
        STORAGE_DRIVER: "s3",
        S3_BUCKET: "receipts",
        S3_REGION: "eu-west-1",
        S3_FORCE_PATH_STYLE: "true",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.S3_BUCKET).toBe("receipts");
      expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    });
  });

  describe("SMTP", () => {
    it("stays disabled when unconfigured", () => {
      expect(
        parseEnv({ ...base } as unknown as NodeJS.ProcessEnv).smtpEnabled,
      ).toBe(false);
    });

    it("treats an empty port as unset rather than zero", () => {
      // compose.yaml passes optional settings as `${SMTP_PORT:-}`, so an
      // instance with no mail configured supplies "" rather than omitting it.
      // Coercing that to 0 failed the range check and stopped the app booting.
      const env = parseEnv({
        ...base,
        SMTP_HOST: "",
        SMTP_PORT: "",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.SMTP_PORT).toBeUndefined();
      expect(env.smtpEnabled).toBe(false);
    });

    it("requires a From address when a host is set", () => {
      expect(() =>
        parseEnv({
          ...base,
          SMTP_HOST: "smtp.example.com",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/SMTP_FROM/);
    });

    it("enables mail when host and From are present", () => {
      const env = parseEnv({
        ...base,
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_FROM: "balancia@example.com",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.smtpEnabled).toBe(true);
      expect(env.SMTP_PORT).toBe(587);
    });
  });

  it("collects extra trusted origins", () => {
    const env = parseEnv({
      ...base,
      APP_URL: "https://balancia.example.com",
      TRUSTED_ORIGINS: "https://alt.example.com, https://other.example.com",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.trustedOrigins).toEqual([
      "https://balancia.example.com",
      "https://alt.example.com",
      "https://other.example.com",
    ]);
  });

  it("rejects placeholder secrets in production", () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: "production",
        APP_URL: "https://balancia.example.com",
        AUTH_SECRET: "change-me-change-me-change-me-change-me",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/placeholder/);
  });
});
