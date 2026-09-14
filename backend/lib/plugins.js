'use strict';

// ============================================================================
// plugins.js — Simple plugin system for knk-suite
// ============================================================================
// PluginManager loads, enables, disables, and executes hooks for plugins
// Plugins stored in ~/.knk-suite/plugins/
// ============================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PLUGINS_DIR = path.join(os.homedir(), '.knk-suite', 'plugins');

const BUILTIN_HOOKS = [
  'onScanComplete',
  'onFinding',
  'onReport',
  'onStart',
  'onStop'
];

class PluginManager {
  constructor() {
    this.plugins = new Map();
    this._ensurePluginsDir();
    this._loadAll();
  }

  list() {
    const plugins = [];
    for (const [name, plugin] of this.plugins) {
      plugins.push({
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        enabled: plugin.enabled,
        hooks: plugin.hooks || []
      });
    }
    return plugins;
  }

  async install(source) {
    try {
      const src = String(source || '').trim();
      // FIX seguridad: antes bastaba que el texto contuviera «github.com»
      // (inyección shell vía ; $() ``). Ahora solo URLs https válidas.
      const { execFileSync } = require('child_process');
      const isGitUrl = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?(\.git)?\/?$/.test(src);
      const isNpmName = /^[a-z0-9][a-z0-9._~-]*(\/[a-z0-9][a-z0-9._~-]*)*(@[a-z0-9._~-]+)?$/i.test(src) && src.length <= 214;
      if (!isGitUrl && !isNpmName) {
        return { ok: false, error: 'Fuente inválida: usa URL https de GitHub o nombre de paquete npm' };
      }
      const pluginName = this._extractPluginName(src);
      if (!/^[a-z0-9][a-z0-9._~-]*$/i.test(pluginName)) {
        return { ok: false, error: 'Nombre de plugin inválido' };
      }
      const pluginDir = path.join(PLUGINS_DIR, pluginName);

      if (this.plugins.has(pluginName)) {
        return { ok: false, error: `Plugin ${pluginName} already installed` };
      }

      fs.mkdirSync(pluginDir, { recursive: true });

      if (isGitUrl) {
        execFileSync('git', ['clone', '--depth', '1', src, pluginDir], { timeout: 30000 });
      } else {
        execFileSync('npm', ['pack', src, '--pack-destination', pluginDir], { timeout: 30000 });
        const tarball = fs.readdirSync(pluginDir).find(f => f.endsWith('.tgz'));
        if (tarball) {
          execFileSync('tar', ['-xzf', path.join(pluginDir, tarball), '-C', pluginDir, '--strip-components=1'], { timeout: 10000 });
          fs.unlinkSync(path.join(pluginDir, tarball));
        }
      }

      const manifest = this._readManifest(pluginDir);
      if (!manifest) {
        return { ok: false, error: 'Invalid plugin: missing plugin.json' };
      }

      const plugin = {
        name: manifest.name,
        version: manifest.version || '1.0.0',
        description: manifest.description || '',
        main: manifest.main || 'index.js',
        hooks: manifest.hooks || [],
        enabled: true,
        dir: pluginDir
      };

      this.plugins.set(plugin.name, plugin);
      return { ok: true, plugin: { name: plugin.name, version: plugin.version } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async uninstall(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return { ok: false, error: `Plugin ${name} not found` };
    }

    try {
      if (fs.existsSync(plugin.dir)) {
        fs.rmSync(plugin.dir, { recursive: true, force: true });
      }
      this.plugins.delete(name);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  enable(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return { ok: false, error: `Plugin ${name} not found` };
    }
    plugin.enabled = true;
    return { ok: true };
  }

  disable(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return { ok: false, error: `Plugin ${name} not found` };
    }
    plugin.enabled = false;
    return { ok: true };
  }

  getHooks(hookName) {
    const hooks = [];
    for (const [name, plugin] of this.plugins) {
      if (plugin.enabled && plugin.hooks.includes(hookName)) {
        hooks.push({ plugin: name, hook: hookName, main: plugin.main });
      }
    }
    return hooks;
  }

  async executeHook(hookName, context) {
    const results = [];
    const hooks = this.getHooks(hookName);

    for (const hook of hooks) {
      try {
        const pluginPath = path.join(hook.main.startsWith('/') ? hook.main : path.join(PLUGINS_DIR, hook.plugin, hook.main));
        if (fs.existsSync(pluginPath)) {
          delete require.cache[pluginPath];
          const pluginModule = require(pluginPath);
          const handler = pluginModule[hookName] || pluginModule.default;
          if (typeof handler === 'function') {
            const result = await handler(context);
            results.push({ plugin: hook.plugin, ok: true, result });
          } else {
            results.push({ plugin: hook.plugin, ok: false, error: 'No handler found' });
          }
        } else {
          results.push({ plugin: hook.plugin, ok: false, error: 'Main file not found' });
        }
      } catch (e) {
        results.push({ plugin: hook.plugin, ok: false, error: e.message });
      }
    }

    return results;
  }

  _ensurePluginsDir() {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }

  _loadAll() {
    try {
      const entries = fs.readdirSync(PLUGINS_DIR);
      for (const entry of entries) {
        const pluginDir = path.join(PLUGINS_DIR, entry);
        if (fs.statSync(pluginDir).isDirectory()) {
          const manifest = this._readManifest(pluginDir);
          if (manifest) {
            this.plugins.set(manifest.name, {
              name: manifest.name,
              version: manifest.version || '1.0.0',
              description: manifest.description || '',
              main: manifest.main || 'index.js',
              hooks: manifest.hooks || [],
              enabled: true,
              dir: pluginDir
            });
          }
        }
      }
    } catch (e) {
      // Ignore load errors
    }
  }

  _readManifest(dir) {
    const manifestPath = path.join(dir, 'plugin.json');
    try {
      if (fs.existsSync(manifestPath)) {
        const data = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(data);
        if (manifest && manifest.name) {
          return manifest;
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
    return null;
  }

  _extractPluginName(source) {
    if (source.includes('github.com')) {
      const match = source.match(/github\.com\/[^/]+\/([^/.]+)/);
      return match ? match[1] : 'github-plugin';
    }
    if (source.includes('npmjs.com') || source.includes('npm:')) {
      const name = source.replace('npm:', '').split('@')[0];
      return name.split('/').pop() || 'npm-plugin';
    }
    return source.split('/').pop().replace(/\.git$/, '') || 'plugin';
  }
}

module.exports = { PluginManager };
