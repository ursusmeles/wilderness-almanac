import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

const eslint = new ESLint();
const coreFiles = ['src/generation/world.js', 'src/application/campaign-session.js'];

test('core modules reject UI, renderer, Three.js and persistence imports, including re-exports and lazy loads', async () => {
  for (const filePath of coreFiles) {
    for (const source of [
      "import 'three';",
      "import 'three/addons/controls/OrbitControls.js';",
      "import '../ui/map-view.js';",
      "export * from '../rendering/map-renderer.js';",
      "import '../persistence/browser-store.js';",
      "await import('three');",
      "await import('../ui/map-view.js');",
      "await import('../rendering/map-renderer.js');",
      "await import('../persistence/browser-store.js');",
    ]) {
      const [result] = await eslint.lintText(source, { filePath });
      assert.ok(
        result.messages.some(({ ruleId }) =>
          ['no-restricted-imports', 'no-restricted-syntax'].includes(ruleId),
        ),
        `${filePath} must reject ${source}`,
      );
    }
  }
});

test('core modules reject direct browser globals while allowing numeric and session helpers', async () => {
  for (const filePath of coreFiles) {
    for (const source of [
      "document.createElement('div');",
      'window.localStorage.clear();',
      'navigator.storage.persist();',
    ]) {
      const [result] = await eslint.lintText(source, { filePath });
      assert.ok(result.messages.some(({ ruleId }) => ruleId === 'no-restricted-globals'));
    }
    const [result] = await eslint.lintText("export { distance } from '../generation/hex.js';", {
      filePath,
    });
    assert.equal(result.errorCount, 0);
  }
});

test('the lazy map boundary and renderer can still load Three.js and access the DOM', async () => {
  for (const filePath of ['src/ui/map-view.js', 'src/rendering/map-renderer.js']) {
    const [result] = await eslint.lintText(
      "import 'three'; await import('three'); document.createElement('canvas');",
      { filePath },
    );
    assert.equal(result.errorCount, 0);
  }
});
