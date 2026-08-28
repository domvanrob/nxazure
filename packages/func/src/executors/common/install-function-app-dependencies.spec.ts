jest.mock('@nx/devkit', () => ({
  detectPackageManager: jest.fn(),
  getPackageManagerCommand: jest.fn(),
}));

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

import { detectPackageManager, ExecutorContext, getPackageManagerCommand } from '@nx/devkit';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { installFunctionAppDependencies } from './install-function-app-dependencies';

const mockedDetectPackageManager = detectPackageManager as jest.MockedFunction<typeof detectPackageManager>;
const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockedGetPackageManagerCommand = getPackageManagerCommand as jest.MockedFunction<typeof getPackageManagerCommand>;

const PNPM_WORKSPACE_FILE_NAME = 'pnpm-workspace.yaml';
const rootWorkspaceFileContents = ['packages:', '  - apps/*', 'onlyBuiltDependencies:', '  - esbuild', ''].join('\n');

describe('installFunctionAppDependencies', () => {
  const tempDirs: string[] = [];

  const createWorkspace = ({ withRootWorkspaceFile }: { withRootWorkspaceFile: boolean }) => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nxazure-func-install-'));
    tempDirs.push(workspaceRoot);

    const appRoot = path.join(workspaceRoot, 'apps', 'demo-app');
    fs.mkdirSync(appRoot, { recursive: true });
    if (withRootWorkspaceFile) fs.writeFileSync(path.join(workspaceRoot, PNPM_WORKSPACE_FILE_NAME), rootWorkspaceFileContents);

    return { appRoot, appWorkspaceFilePath: path.join(appRoot, PNPM_WORKSPACE_FILE_NAME), workspaceRoot };
  };

  const createContext = (workspaceRoot: string) =>
    ({ cwd: workspaceRoot, isVerbose: false, target: { executor: '@nxazure/func:build' } }) as unknown as ExecutorContext;

  beforeEach(() => {
    mockedExecSync.mockReset();
    mockedDetectPackageManager.mockReturnValue('pnpm');
    mockedGetPackageManagerCommand.mockReturnValue({ install: 'pnpm install' } as ReturnType<typeof getPackageManagerCommand>);
  });

  afterEach(() => {
    jest.clearAllMocks();
    tempDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
    tempDirs.length = 0;
  });

  it('runs the plain install command for non pnpm package managers', () => {
    const { appRoot, appWorkspaceFilePath, workspaceRoot } = createWorkspace({ withRootWorkspaceFile: true });
    mockedDetectPackageManager.mockReturnValue('npm');
    mockedGetPackageManagerCommand.mockReturnValue({ install: 'npm install' } as ReturnType<typeof getPackageManagerCommand>);

    installFunctionAppDependencies(createContext(workspaceRoot), appRoot);

    expect(mockedExecSync).toHaveBeenCalledWith('npm install', { stdio: 'inherit', cwd: appRoot });
    expect(fs.existsSync(appWorkspaceFilePath)).toBe(false);
  });

  it('installs against a temporary app level workspace file instead of ignoring the workspace', () => {
    const { appRoot, appWorkspaceFilePath, workspaceRoot } = createWorkspace({ withRootWorkspaceFile: true });
    let hasAppWorkspaceFileDuringInstall = false;
    mockedExecSync.mockImplementation(() => {
      hasAppWorkspaceFileDuringInstall = fs.existsSync(appWorkspaceFilePath);
      return Buffer.from('');
    });

    installFunctionAppDependencies(createContext(workspaceRoot), appRoot);

    expect(mockedExecSync).toHaveBeenCalledWith('pnpm install --node-linker=hoisted', { stdio: 'inherit', cwd: appRoot });
    expect(hasAppWorkspaceFileDuringInstall).toBe(true);
    expect(fs.existsSync(appWorkspaceFilePath)).toBe(false);
  });

  it('removes the temporary app level workspace file when the install fails', () => {
    const { appRoot, appWorkspaceFilePath, workspaceRoot } = createWorkspace({ withRootWorkspaceFile: true });
    mockedExecSync.mockImplementation(() => {
      throw new Error('install failed');
    });

    expect(() => installFunctionAppDependencies(createContext(workspaceRoot), appRoot)).toThrow('install failed');
    expect(fs.existsSync(appWorkspaceFilePath)).toBe(false);
  });

  it('ignores the workspace when the repository has no pnpm workspace file', () => {
    const { appRoot, workspaceRoot } = createWorkspace({ withRootWorkspaceFile: false });

    installFunctionAppDependencies(createContext(workspaceRoot), appRoot);

    expect(mockedExecSync).toHaveBeenCalledWith('pnpm install --node-linker=hoisted --ignore-workspace', {
      stdio: 'inherit',
      cwd: appRoot,
    });
  });
});
