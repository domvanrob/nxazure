import fs from 'fs';
import path from 'path';

const PNPM_WORKSPACE_FILE_NAME = 'pnpm-workspace.yaml';
const PNPM_PATCHED_DEPENDENCIES_KEY = 'patchedDependencies';
const PNPM_ALLOW_UNUSED_PATCHES_KEY = 'allowUnusedPatches';

// Settings that point at workspace relative locations and therefore cannot be reused from the function app folder.
const PNPM_WORKSPACE_RELATIVE_KEYS = ['packages', 'pnpmfile', 'globalPnpmfile', 'modulesDir', 'storeDir', 'virtualStoreDir'];

export type PnpmWorkspaceScope = { additionalInstallFlags: string; dispose: () => void };

const isBlockContinuationLine = (line: string) => line.trim() === '' || /^[\s-]/.test(line);

const toAbsolutePatchPath = (line: string, workspaceRoot: string) => {
  const patchEntry = /^(\s+[^:]+:\s*)(['"]?)([^'"\s].*?)\2\s*$/.exec(line);
  if (!patchEntry) return line;

  const [, entryPrefix, quote, patchPath] = patchEntry;
  return path.isAbsolute(patchPath) ? line : `${entryPrefix}${quote}${path.join(workspaceRoot, patchPath)}${quote}`;
};

/**
 * Copies the root pnpm workspace settings without the entries that only make sense from the workspace root, so the
 * settings can be applied from inside the function app folder. Done line by line to avoid adding a YAML parser
 * dependency and to keep the original file formatting.
 */
export const toAppWorkspaceSettings = (rootWorkspaceSettings: string, workspaceRoot: string) => {
  let currentTopLevelKey = '';
  const topLevelKeys = new Set<string>();

  const appWorkspaceLines = rootWorkspaceSettings.split('\n').reduce<string[]>((lines, line) => {
    const topLevelKey = /^([A-Za-z][\w-]*)\s*:/.exec(line)?.[1];
    if (topLevelKey) currentTopLevelKey = topLevelKey;
    else if (!isBlockContinuationLine(line)) currentTopLevelKey = '';

    if (PNPM_WORKSPACE_RELATIVE_KEYS.includes(currentTopLevelKey)) return lines;

    topLevelKeys.add(currentTopLevelKey);
    lines.push(currentTopLevelKey === PNPM_PATCHED_DEPENDENCIES_KEY ? toAbsolutePatchPath(line, workspaceRoot) : line);
    return lines;
  }, []);

  // Patches for packages the function app does not depend on would fail the isolated install.
  const needsUnusedPatchesAllowance = topLevelKeys.has(PNPM_PATCHED_DEPENDENCIES_KEY) && !topLevelKeys.has(PNPM_ALLOW_UNUSED_PATCHES_KEY);
  const settings = appWorkspaceLines.join('\n');

  return needsUnusedPatchesAllowance ? `${settings.trimEnd()}\n${PNPM_ALLOW_UNUSED_PATCHES_KEY}: true\n` : settings;
};

/**
 * pnpm only reads settings such as `onlyBuiltDependencies` / `allowBuilds`, `overrides` and catalogs from
 * `pnpm-workspace.yaml`. Installing with `--ignore-workspace` (previously used to keep `node_modules` inside the
 * function app folder) drops all of those settings, which makes pnpm 10+ fail with `ERR_PNPM_IGNORED_BUILDS`.
 *
 * Writing the workspace settings next to the function app `package.json` turns the app into its own pnpm workspace
 * root, so the install stays local to the app while the workspace settings keep being applied.
 */
export const createPnpmWorkspaceScope = (workspaceRoot: string, appRoot: string): PnpmWorkspaceScope => {
  const appWorkspaceFilePath = path.join(appRoot, PNPM_WORKSPACE_FILE_NAME);
  if (fs.existsSync(appWorkspaceFilePath)) return { additionalInstallFlags: '', dispose: () => undefined };

  const rootWorkspaceFilePath = path.join(workspaceRoot, PNPM_WORKSPACE_FILE_NAME);
  if (!fs.existsSync(rootWorkspaceFilePath)) return { additionalInstallFlags: ' --ignore-workspace', dispose: () => undefined };

  const rootWorkspaceSettings = fs.readFileSync(rootWorkspaceFilePath, 'utf-8');
  fs.writeFileSync(appWorkspaceFilePath, toAppWorkspaceSettings(rootWorkspaceSettings, workspaceRoot));

  return { additionalInstallFlags: '', dispose: () => fs.rmSync(appWorkspaceFilePath, { force: true }) };
};
