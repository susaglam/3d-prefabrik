import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
const target = new URL('../addons/cs_prefab_configurator/static/vendor/', import.meta.url);
await mkdir(target, { recursive: true });
for (const [from, to] of [
  ['three/build/three.module.js', 'three.module.js'],
  ['three/build/three.core.js', 'three.core.js'],
  ['three/examples/jsm/controls/OrbitControls.js', 'OrbitControls.js'],
  ['three/LICENSE', 'THREE-LICENSE.txt'],
]) await copyFile(new URL(`../node_modules/${from}`, import.meta.url), new URL(to, target));
const orbit = new URL('OrbitControls.js', target);
await writeFile(orbit, (await readFile(orbit, 'utf8')).replace("from 'three'", "from './three.module.js'"));
console.log('Local Three.js runtime and license copied. No external CDN required.');
