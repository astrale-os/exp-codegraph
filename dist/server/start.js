import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, } from 'vite';
import { createLiveSpecsPlugin } from './live-plugin.js';
import { DEV_SERVER_WATCH_IGNORES } from './watch.js';
export function createDevelopmentServer(dependencies) {
    return async (options) => {
        const root = await realpath(resolve(options.root));
        if (!(await stat(root)).isDirectory())
            throw new Error('Root must be a directory.');
        const packageRoot = await resolvePackageRoot();
        const viewer = resolve(packageRoot, 'viewer');
        const preact = fileURLToPath(import.meta.resolve('preact'));
        const hooks = fileURLToPath(import.meta.resolve('preact/hooks'));
        const jsxRuntime = fileURLToPath(import.meta.resolve('preact/jsx-runtime'));
        const jsxDevRuntime = fileURLToPath(import.meta.resolve('preact/jsx-dev-runtime'));
        const katex = fileURLToPath(import.meta.resolve('katex'));
        const dependencyRoot = await realpath(dependencyInstallRoot(fileURLToPath(import.meta.resolve('vite/package.json'))));
        const port = options.port === 0 ? await dependencies.allocatePort() : (options.port ?? 4173);
        const cacheDir = await realpath(await mkdtemp(join(tmpdir(), 'astrale-spec-vite-')));
        const allowedRoots = [root, packageRoot, dependencyRoot, cacheDir];
        const plugin = dependencies.createPlugin({
            root,
            allowedRoots,
            verify: options.verify ?? false,
            cache: options.cache ?? true,
            ...(options.native ? { native: options.native } : {}),
        });
        let server;
        try {
            server = await dependencies.createServer(viteConfiguration({
                viewer,
                cacheDir,
                plugin,
                port,
                open: options.open ?? false,
                strictPort: options.port !== undefined && options.port !== 0,
                allowedRoots,
                aliases: { preact, hooks, jsxRuntime, jsxDevRuntime, katex },
            }));
            await server.listen();
            const address = server.httpServer?.address();
            if (!address || typeof address === 'string')
                throw new Error('Vite did not expose a TCP address.');
            let closing;
            const close = () => (closing ??= (async () => {
                try {
                    await server.close();
                }
                finally {
                    await rm(cacheDir, { recursive: true, force: true });
                }
            })());
            return { server, url: `http://127.0.0.1:${address.port}`, close };
        }
        catch (error) {
            await server?.close();
            await rm(cacheDir, { recursive: true, force: true });
            throw error;
        }
    };
}
function viteConfiguration(settings) {
    const { aliases } = settings;
    return {
        root: settings.viewer,
        cacheDir: settings.cacheDir,
        appType: 'spa',
        clearScreen: false,
        logLevel: 'error',
        plugins: [settings.plugin],
        optimizeDeps: {
            noDiscovery: true,
            include: [
                'preact',
                'preact/hooks',
                'preact/jsx-runtime',
                'preact/jsx-dev-runtime',
                '@codemirror/commands',
                '@codemirror/lang-javascript',
                '@codemirror/lang-yaml',
                '@codemirror/language',
                '@codemirror/state',
                '@codemirror/view',
                '@lezer/highlight',
                'katex',
                'yaml',
                'micromark',
                'micromark-extension-gfm',
            ],
        },
        resolve: {
            alias: [
                { find: /^katex$/, replacement: aliases.katex },
                { find: /^preact$/, replacement: aliases.preact },
                { find: /^preact\/hooks$/, replacement: aliases.hooks },
                { find: /^preact\/jsx-runtime$/, replacement: aliases.jsxRuntime },
                { find: /^preact\/jsx-dev-runtime$/, replacement: aliases.jsxDevRuntime },
                { find: /^react\/jsx-runtime$/, replacement: aliases.jsxRuntime },
                { find: /^react\/jsx-dev-runtime$/, replacement: aliases.jsxDevRuntime },
            ],
            dedupe: ['preact'],
        },
        server: {
            host: '127.0.0.1',
            port: settings.port,
            strictPort: settings.strictPort,
            open: settings.open,
            cors: false,
            allowedHosts: ['127.0.0.1', 'localhost'],
            watch: { ignored: [...DEV_SERVER_WATCH_IGNORES] },
            fs: { strict: true, allow: settings.allowedRoots },
            hmr: { host: '127.0.0.1', overlay: false },
        },
    };
}
async function resolvePackageRoot() {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    const parent = dirname(moduleDirectory);
    return realpath(basename(parent) === 'dist' ? dirname(parent) : parent);
}
/** Find the physical installation tree containing direct and transitive browser dependencies. */
function dependencyInstallRoot(file) {
    let directory = dirname(file);
    let installRoot;
    while (true) {
        if (basename(directory) === 'node_modules')
            installRoot = directory;
        const parent = dirname(directory);
        if (parent === directory)
            break;
        directory = parent;
    }
    if (!installRoot)
        throw new Error('Could not locate the dependency installation root.');
    return installRoot;
}
async function availablePort() {
    return new Promise((resolvePort, reject) => {
        const socket = createTcpServer();
        socket.once('error', reject);
        socket.listen(0, '127.0.0.1', () => {
            const address = socket.address();
            if (!address || typeof address === 'string') {
                socket.close();
                reject(new Error('Could not allocate a loopback port.'));
                return;
            }
            socket.close((error) => (error ? reject(error) : resolvePort(address.port)));
        });
    });
}
export const startDev = createDevelopmentServer({
    createServer: createViteServer,
    createPlugin: createLiveSpecsPlugin,
    allocatePort: availablePort,
});
//# sourceMappingURL=start.js.map