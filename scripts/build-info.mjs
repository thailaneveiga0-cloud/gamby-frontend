import { execSync } from 'child_process';

const SHA = /^[0-9a-f]{7,40}$/i;

function defaultGit() {
  return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

// Commit implantado: CF_PAGES_COMMIT_SHA no Cloudflare Pages; localmente, o
// HEAD do git. Nunca derruba o build e nunca deixa um valor não-hexadecimal
// chegar ao config.js.
export function resolveBuildCommit(env = process.env, git = defaultGit) {
  const fromCi = String(env.CF_PAGES_COMMIT_SHA || '').trim();
  if (SHA.test(fromCi)) return fromCi.slice(0, 7).toLowerCase();

  try {
    const fromGit = String(git() || '').trim();
    if (SHA.test(fromGit)) return fromGit.slice(0, 7).toLowerCase();
  } catch { /* sem git */ }

  return 'unknown';
}

export function buildConfigJs(apiUrl, commit) {
  return `window.GAMBY_CONFIG = { apiUrl: '${apiUrl}' };\nwindow.__GAMBY_BUILD_COMMIT__ = '${commit}';\n`;
}
