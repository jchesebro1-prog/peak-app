import packageJson from "../../package.json";

/** Deployment identity shown in Settings so support and beta testing can
 * quickly distinguish a stale browser/deployment from the current build. */
export const buildInfo = {
  version: packageJson.version,
  commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
  environment: process.env.VERCEL_ENV || "development",
};
