import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
const target = new URL('../addons/cs_prefab_configurator/static/vendor/', import.meta.url);
await mkdir(target, { recursive: true });
for (const [from, to] of [
  ['three/build/three.module.js', 'three.module.js'],
  ['three/build/three.core.js', 'three.core.js'],
  ['three/examples/jsm/controls/OrbitControls.js', 'OrbitControls.js'],
  ['three/examples/jsm/loaders/HDRLoader.js', 'HDRLoader.js'],
  ['three/LICENSE', 'THREE-LICENSE.txt'],
]) await copyFile(new URL(`../node_modules/${from}`, import.meta.url), new URL(to, target));
for (const name of ['OrbitControls.js', 'HDRLoader.js']) {
  const file = new URL(name, target);
  await writeFile(file, (await readFile(file, 'utf8')).replace("from 'three'", "from './three.module.js'"));
}

// Local ES module bundles; Three.js itself stays the single shared vendor copy (no duplicate classes).
const bundles = [
  ['render-addons.module.js', [
    "export { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';",
    "export { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';",
    "export { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';",
    "export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';",
  ].join('\n')],
  // Loaded lazily by interior_scenes.js the first time a room scenario needs CC0 glTF furniture.
  ['gltf-loader.module.js', "export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';"],
];
for (const [file, contents] of bundles) {
  const result = await build({
    stdin: { contents, resolveDir: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), loader: 'js' },
    bundle: true, format: 'esm', minify: true, legalComments: 'eof', write: false, target: 'es2020',
    // Only the exact `three` specifier is shared; `three/examples/...` add-ons are bundled.
    plugins: [{ name: 'shared-three', setup(b) { b.onResolve({ filter: /^three$/ }, () => ({ path: './three.module.js', external: true })); } }],
  });
  const code = result.outputFiles[0].text;
  if (/from\s*["']three[/"']/.test(code)) throw new Error(`${file}: unresolved bare three import`);
  await writeFile(new URL(file, target), code);
  console.log(`${file}: ${code.length} bytes`);
}
console.log('Local Three.js runtime, render add-ons, glTF loader and licenses copied. No external CDN required.');
