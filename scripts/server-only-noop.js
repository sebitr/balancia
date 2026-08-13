/*
 * No-op stand-in for the `server-only` marker package.
 *
 * `server-only` is a build-time guard: importing it from a Client Component
 * makes the Next.js bundler fail. Outside that bundler it resolves to a module
 * that throws unless the `react-server` export condition is set — which would
 * make the worker and migrator bundles crash on start.
 *
 * The guard has already done its job by the time these bundles are built, so
 * esbuild aliases the package to this file (see the Dockerfile) and the output
 * runs under plain `node` with no extra flags.
 */
export {};
