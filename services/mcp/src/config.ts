/** Default public Sourcify server (v2 API base). */
export const DEFAULT_SERVER_URL = "https://sourcify.dev/server";

/**
 * Resolves the Sourcify server base URL the MCP tools should target.
 * Honors `SOURCIFY_SERVER_URL`, falling back to the public server.
 */
export function resolveServerUrl(env: NodeJS.ProcessEnv): string {
  const fromEnv = env.SOURCIFY_SERVER_URL?.trim();
  return fromEnv ? fromEnv : DEFAULT_SERVER_URL;
}
