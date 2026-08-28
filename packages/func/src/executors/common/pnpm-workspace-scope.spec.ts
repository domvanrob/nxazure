import fs from 'fs';
import os from 'os';
import path from 'path';
import { createPnpmWorkspaceScope, toAppWorkspaceSettings } from './pnpm-workspace-scope';

const PNPM_WORKSPACE_FILE_NAME = 'pnpm-workspace.yaml';
const rootWorkspaceFileContents = [
  'packages:',
  '  - apps/*',
  '- libs/*',
  'pnpmfile: .pnpmfile.cjs',
  'overrides:',
  '  ms: 2.1.3',
  'onlyBuiltDependencies:',
  '  - esbuild',
  'patchedDependencies:',
  "  'left-pad@1.3.0': patches/left-pad@1.3.0.patch",
  '',
].join('\n');

describe('pnpm workspace scope', () => {
  const tempDirs: string[] = [];

  const createWorkspace = () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nxazure-func-pnpm-workspace-'));
    tempDirs.push(workspaceRoot);

    const appRoot = path.join(workspaceRoot, 'apps', 'demo-app');
    fs.mkdirSync(appRoot, { recursive: true });

    return { appRoot, appWorkspaceFilePath: path.join(appRoot, PNPM_WORKSPACE_FILE_NAME), workspaceRoot };
  };

  afterEach(() => {
    tempDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
    tempDirs.length = 0;
  });

  describe('toAppWorkspaceSettings', () => {
    it('drops workspace root relative settings and keeps the rest untouched', () => {
      const appWorkspaceSettings = toAppWorkspaceSettings(rootWorkspaceFileContents, path.join('/', 'workspace'));

      expect(appWorkspaceSettings).toBe(
        [
          'overrides:',
          '  ms: 2.1.3',
          'onlyBuiltDependencies:',
          '  - esbuild',
          'patchedDependencies:',
          `  'left-pad@1.3.0': ${path.join('/', 'workspace', 'patches', 'left-pad@1.3.0.patch')}`,
          'allowUnusedPatches: true',
          '',
        ].join('\n'),
      );
    });

    it('keeps comments and unknown settings so future pnpm options keep working', () => {
      const rootWorkspaceSettings = ['# keep me', 'catalog:', '  react: ^19.0.0', 'someFutureSetting: true', ''].join('\n');

      const appWorkspaceSettings = toAppWorkspaceSettings(rootWorkspaceSettings, path.join('/', 'workspace'));

      expect(appWorkspaceSettings).toBe(rootWorkspaceSettings);
    });

    it('leaves absolute patch paths as they are', () => {
      const absolutePatchPath = path.join('/', 'elsewhere', 'left-pad@1.3.0.patch');
      const rootWorkspaceSettings = [
        'patchedDependencies:',
        `  'left-pad@1.3.0': ${absolutePatchPath}`,
        'allowUnusedPatches: false',
        '',
      ].join('\n');

      const appWorkspaceSettings = toAppWorkspaceSettings(rootWorkspaceSettings, path.join('/', 'workspace'));

      expect(appWorkspaceSettings).toBe(rootWorkspaceSettings);
    });
  });

  describe('createPnpmWorkspaceScope', () => {
    it('writes the derived settings next to the app package.json and removes them on dispose', () => {
      const { appRoot, appWorkspaceFilePath, workspaceRoot } = createWorkspace();
      fs.writeFileSync(path.join(workspaceRoot, PNPM_WORKSPACE_FILE_NAME), rootWorkspaceFileContents);

      const workspaceScope = createPnpmWorkspaceScope(workspaceRoot, appRoot);

      expect(workspaceScope.additionalInstallFlags).toBe('');
      expect(fs.readFileSync(appWorkspaceFilePath, 'utf-8')).toBe(toAppWorkspaceSettings(rootWorkspaceFileContents, workspaceRoot));

      workspaceScope.dispose();

      expect(fs.existsSync(appWorkspaceFilePath)).toBe(false);
    });

    it('falls back to ignoring the workspace when the repository has no pnpm workspace file', () => {
      const { appRoot, appWorkspaceFilePath, workspaceRoot } = createWorkspace();

      const workspaceScope = createPnpmWorkspaceScope(workspaceRoot, appRoot);

      expect(workspaceScope.additionalInstallFlags).toBe(' --ignore-workspace');
      expect(fs.existsSync(appWorkspaceFilePath)).toBe(false);
    });

    it('keeps an existing app level workspace file untouched', () => {
      const { appRoot, appWorkspaceFilePath, workspaceRoot } = createWorkspace();
      fs.writeFileSync(path.join(workspaceRoot, PNPM_WORKSPACE_FILE_NAME), rootWorkspaceFileContents);
      fs.writeFileSync(appWorkspaceFilePath, 'onlyBuiltDependencies:\n  - sharp\n');

      const workspaceScope = createPnpmWorkspaceScope(workspaceRoot, appRoot);
      workspaceScope.dispose();

      expect(workspaceScope.additionalInstallFlags).toBe('');
      expect(fs.readFileSync(appWorkspaceFilePath, 'utf-8')).toBe('onlyBuiltDependencies:\n  - sharp\n');
    });
  });
});
