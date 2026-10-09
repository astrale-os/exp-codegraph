import { relative, sep } from 'node:path'
import { watch } from 'chokidar'
import { ignoredWorkspaceOutput } from './watch.ts'

/** Prune generated/dependency trees before allocating watchers; never follow foreign symlinks. */
export function createViewerWatcher(root: string) {
  return watch(root, {
    ignoreInitial: true,
    followSymlinks: false,
    ignored: (path) => ignoredWorkspaceOutput(relative(root, path).split(sep).join('/')),
  })
}
