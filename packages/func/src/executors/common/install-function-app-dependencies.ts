import { detectPackageManager, ExecutorContext, getPackageManagerCommand } from '@nx/devkit';
import { execSync } from 'child_process';
import { createPnpmWorkspaceScope } from './pnpm-workspace-scope';

export const installFunctionAppDependencies = (context: Pick<ExecutorContext, 'cwd' | 'isVerbose' | 'target'>, appRoot: string): void => {
  const rawInstallCommand = getPackageManagerCommand().install;
  const isPnpm = detectPackageManager() === 'pnpm';
  const pnpmWorkspaceScope = isPnpm ? createPnpmWorkspaceScope(context.cwd, appRoot) : null;

  const installCommand = pnpmWorkspaceScope
    ? `${rawInstallCommand} --node-linker=hoisted${pnpmWorkspaceScope.additionalInstallFlags}`
    : rawInstallCommand;

  if (context.isVerbose) console.log(`Running ${context.target?.executor} command: ${installCommand}.`);

  try {
    execSync(installCommand, { stdio: 'inherit', cwd: appRoot });
  } finally {
    pnpmWorkspaceScope?.dispose();
  }
};
