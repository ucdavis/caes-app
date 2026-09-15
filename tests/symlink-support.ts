import { symlink } from 'node:fs/promises';

// Attempt a real file symlink. Only Windows privilege failures permit local skips.
export async function createTestSymlink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path, 'file');
    return true;
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    if (process.env.CI) throw new Error('CI must support file symlinks. Enable Windows Developer Mode or grant symbolic-link privileges.', { cause: error });
    return false;
  }
}
