import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const moduleUrl = new URL('../../addons/cs_prefab_configurator/static/src/preview.js', import.meta.url);
const source = readFileSync(moduleUrl, 'utf8');
const start = source.indexOf('    async loadAssets() {');
const end = source.indexOf('\n    box(', start);
assert.ok(start >= 0 && end > start, 'Locate the production Preview.loadAssets method');
const method = source.slice(start, end).replaceAll('import.meta.url', '__moduleUrl');

// Execute the actual production method, without constructing its WebGL renderer.
// Delayed network responses and disposable GPU targets make context-restore races
// deterministic in Node; the browser checks cover real context loss and recovery.
function harness({failPMREM = false} = {}) {
  const requests = [], targets = [], generators = [], updates = [];
  function resource(name) {
    return {name, disposeCalls: 0, dispose() { this.disposeCalls++; }};
  }
  function request(url, kind) {
    const entry = {url, kind, resource: resource(url)};
    entry.promise = new Promise((resolve, reject) => {
      entry.resolve = () => resolve(entry.resource);
      entry.reject = () => reject(new Error('Network unavailable'));
    });
    requests.push(entry);
    return entry.promise;
  }
  class TextureLoader { loadAsync(url) { return request(url, 'texture'); } }
  class HDRLoader { loadAsync(url) { return request(url, 'hdr'); } }
  class PMREMGenerator {
    constructor() { this.disposeCalls = 0; generators.push(this); }
    fromEquirectangular(hdr) {
      if (failPMREM) throw new Error('GPU allocation failed');
      const target = {...resource('environment'), texture: {source: hdr}};
      targets.push(target);
      return target;
    }
    dispose() { this.disposeCalls++; }
  }
  // `assetUrl` is production code that loadAssets depends on: it stamps the release version onto every asset URL so a
  // changed texture is not served from a week-old browser cache. Take it from the module rather than re-implementing it.
  const helperStart = source.indexOf('function assetUrl(');
  const helperEnd = source.indexOf('\n}', helperStart) + 2;
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Locate the production assetUrl helper');
  const assetUrlSource = source.slice(helperStart, helperEnd).replaceAll('import.meta.url', '__moduleUrl');
  const loadAssets = runInNewContext(`${assetUrlSource}\nconst ASSET_VERSION = new URL(__moduleUrl).searchParams.get('v') || '';\n({${method}}).loadAssets`, {
    THREE: {TextureLoader, PMREMGenerator, RepeatWrapping: 'repeat', SRGBColorSpace: 'srgb', EquirectangularReflectionMapping: 'equirect'},
    HDRLoader, URL, __moduleUrl: moduleUrl.href + '?v=test-release',
  });
  const previousTarget = {...resource('previous environment'), texture: {source: 'previous'}};
  const preview = {
    disposed: false, failed: false, maps: {}, textures: new Set(), materials: new Map(),
    renderer: {capabilities: {getMaxAnisotropy: () => 8}},
    scene: {environment: previousTarget.texture}, environmentTarget: previousTarget,
    config: {width: 620}, assetLoadFailures: 0,
    update(config, options) { updates.push({config, force: options.force}); },
  };
  return {
    preview, previousTarget, requests, targets, generators, updates,
    start() {
      const offset = requests.length, promise = loadAssets.call(preview);
      return {promise, requests: requests.slice(offset)};
    },
  };
}

function settle(batch, {reject = false} = {}) {
  for (const request of batch.requests) request[reject ? 'reject' : 'resolve']();
}

test('newest asset batch wins, keeps its HDR as the sky, and late superseded textures and HDR are disposed', async () => {
  const h = harness(), old = h.start(), current = h.start();
  settle(current);
  assert.equal(await current.promise, true);
  const currentTarget = h.preview.environmentTarget;
  const currentTextures = new Set(Object.values(h.preview.maps));
  assert.equal(h.previousTarget.disposeCalls, 1, 'Replacing an environment releases its GPU target');
  assert.equal(h.targets.length, 1);
  assert.equal(h.generators[0].disposeCalls, 1);

  settle(old);
  assert.equal(await old.promise, false);
  assert.equal(h.preview.environmentTarget, currentTarget);
  assert.equal(h.preview.scene.environment, currentTarget.texture);
  assert.deepEqual(new Set(Object.values(h.preview.maps)), currentTextures);
  assert.equal(h.targets.length, 1, 'Stale HDR must never allocate another environment target');
  assert.equal(h.updates.length, 1, 'A stale completion must not rebuild the current scene');
  assert.equal(h.updates[0].config, h.preview.config);
  assert.equal(h.updates[0].force, true);
  for (const request of old.requests) assert.equal(request.resource.disposeCalls, 1, request.url);
  // The current HDR stays loaded as visible sky and path-tracing light; it is released on replacement or destroy.
  for (const request of current.requests) assert.equal(request.resource.disposeCalls, 0, request.url);
  const currentHdr = current.requests.find(request => request.kind === 'hdr').resource;
  assert.equal(h.preview.skyTexture, currentHdr);
  assert.ok(h.preview.textures.has(currentHdr));
});

test('late failures from a superseded batch do not overwrite current asset status or rebuild', async () => {
  const h = harness(), old = h.start(), current = h.start();
  settle(current);
  assert.equal(await current.promise, true);
  assert.equal(h.preview.assetLoadFailures, 0);
  settle(old, {reject: true});
  assert.equal(await old.promise, false);
  assert.equal(h.preview.assetLoadFailures, 0);
  assert.equal(h.updates.length, 1);
});

test('assets arriving after renderer destruction are freed without rebuilding or allocating PMREM', async () => {
  const h = harness(), pending = h.start();
  // Preview.destroy sets this guard synchronously before releasing renderer resources.
  h.preview.disposed = true;
  settle(pending);
  assert.equal(await pending.promise, false);
  for (const request of pending.requests) assert.equal(request.resource.disposeCalls, 1, request.url);
  assert.equal(h.preview.textures.size, 0);
  assert.equal(Object.keys(h.preview.maps).length, 0);
  assert.equal(h.targets.length, 0);
  assert.equal(h.generators.length, 0);
  assert.equal(h.updates.length, 0);
});

test('failed PMREM conversion still disposes the HDR source and temporary generator', async () => {
  const h = harness({failPMREM: true}), pending = h.start();
  settle(pending);
  assert.equal(await pending.promise, true, 'A current batch can complete with a recoverable asset failure');
  assert.equal(pending.requests.find(request => request.kind === 'hdr').resource.disposeCalls, 1);
  assert.equal(h.generators[0].disposeCalls, 1);
  assert.equal(h.targets.length, 0);
  assert.equal(h.preview.environmentTarget, h.previousTarget);
  assert.equal(h.preview.assetLoadFailures, 1);
  assert.equal(h.updates.length, 1);
});

test('every asset URL carries the release version, so a changed texture is never served from a stale cache', async () => {
  // The import map versions the modules, but `new URL(relative, import.meta.url)` drops the query, so without the
  // stamp the textures sit on a stable URL behind `Cache-Control: max-age=604800` and a returning visitor keeps the
  // previous release's image for a week. That is what made a regenerated floor look different on the server.
  const h = harness(), batch = h.start();
  settle(batch);
  await batch.promise;
  assert.ok(batch.requests.length > 0, 'the batch requested assets');
  for (const request of batch.requests) {
    assert.match(request.url, /[?&]v=test-release(&|$)/, `${request.url} carries the release version`);
  }
});
