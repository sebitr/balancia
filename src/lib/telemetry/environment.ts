import { existsSync } from "node:fs";
import packageJson from "../../../package.json";
import { getEnv } from "@/lib/env";
import type {
  Architecture,
  DatabaseKind,
  DeploymentKind,
  ReportFeatures,
} from "./schema";

/**
 * What this installation *is*, as far as a report is concerned.
 *
 * Four facts about the software and a list of switches. Nothing here describes
 * a person, a group or a piece of money, and nothing here is unique: every
 * value is one of a handful shared by every installation that made the same
 * deployment choices.
 *
 * Note what is deliberately absent — the hostname, the public URL, the
 * database name, the operating system's identity, the CPU model, the locale
 * and the timezone. Each of those is either directly identifying or narrow
 * enough to become so in combination. See docs/telemetry.md.
 */

/** The running version, from `package.json` — the same string the image is built from. */
export function appVersion(): string {
  return packageJson.version;
}

/**
 * How Balancia is being run.
 *
 * `TELEMETRY_DEPLOYMENT` wins when set, because only the operator knows they
 * are running under Kubernetes or behind a platform. Compose sets it for its
 * own containers. The fallback distinguishes "in a container" from "a bare
 * node process" and gives up honestly rather than guessing further.
 */
export function deploymentKind(): DeploymentKind {
  try {
    const configured = getEnv().TELEMETRY_DEPLOYMENT;
    if (configured) return configured;
    if (getEnv().NODE_ENV === "development") return "development";
  } catch {
    // An unparseable environment is not a reason to fail a report; the report
    // simply says less.
    return "unknown";
  }

  try {
    if (existsSync("/.dockerenv")) return "docker";
  } catch {
    return "unknown";
  }
  return "standalone";
}

/** CPU architecture, in the two values that matter plus a catch-all. */
export function architecture(): Architecture {
  switch (process.arch) {
    case "x64":
      return "amd64";
    case "arm64":
      return "arm64";
    default:
      return "other";
  }
}

/** Balancia runs on PostgreSQL and only PostgreSQL. */
export function databaseKind(): DatabaseKind {
  return "postgresql";
}

/**
 * Which optional features this instance has switched on.
 *
 * Read from configuration, never from usage: "SMTP is configured" is a fact
 * about the deployment, and says nothing about who has been emailed.
 */
export function features(): ReportFeatures {
  const env = getEnv();
  return {
    registrationOpen: env.ALLOW_REGISTRATION,
    email: env.smtpEnabled,
    push: env.pushEnabled,
    appleSignIn: env.appleSignInEnabled,
    exchangeRates: env.EXCHANGE_RATE_PROVIDER !== "none",
    receiptScanning: env.RECEIPT_SCANNING,
    semanticCategorization: env.SEMANTIC_CATEGORIZATION,
    storage: env.STORAGE_DRIVER,
    worker: env.RUN_WORKER_IN_WEB ? "in-web" : "separate",
  };
}
