import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {MODELS} from '../../addons/cs_prefab_configurator/static/src/interior_scenes.js';

// Second control on the material scans, with a different failure pattern than the browser checks: the browser
// proves a URL resolves, this proves the bytes shipped are the bytes the provenance manifest (licence record)
// describes, and that the compact-tier ladder and AO maps are complete without reading any scene code.
const materialsDir = fileURLToPath(new URL('../../addons/cs_prefab_configurator/static/src/assets/materials/', import.meta.url));
const provenance = JSON.parse(readFileSync(new URL('provenance.json', `file://${materialsDir.replaceAll('\\', '/')}`), 'utf8'));
const rows = provenance.assets;
const onDisk = readdirSync(materialsDir).filter(name => /\.(jpg|hdr)$/.test(name));
const recorded = new Map(rows.map(row => [row.file, row]));

function sha256(name) {
  return createHash('sha256').update(readFileSync(materialsDir + name)).digest('hex');
}

test('every provenance row names a file that exists with the recorded sha256 and byte size', () => {
  assert.ok(rows.length > 0, 'provenance.json lists assets');
  const files = rows.map(row => row.file);
  assert.equal(new Set(files).size, files.length, 'no file is recorded twice');
  for (const row of rows) {
    for (const key of ['file', 'origin', 'assetPage', 'license', 'licenseUrl', 'sha256', 'bytes', 'role', 'resolution', 'downloaded']) {
      assert.ok(row[key] !== undefined && row[key] !== '', `${row.file}: provenance row carries ${key}`);
    }
    assert.match(row.license, /^CC0-1\.0$/, `${row.file}: only CC0 scans ship`);
    assert.equal(statSync(materialsDir + row.file).size, row.bytes, `${row.file}: byte size matches the manifest`);
    assert.equal(sha256(row.file), row.sha256, `${row.file}: sha256 matches the manifest`);
  }
});

test('every shipped material file has a provenance row (no unlicensed asset on disk)', () => {
  for (const name of onDisk) assert.ok(recorded.has(name), `${name} is shipped without a provenance row`);
});

test('every *_512.jpg compact variant has its canonical sibling and records the derivation', () => {
  const ladder = onDisk.filter(name => name.endsWith('_512.jpg'));
  assert.ok(ladder.length >= 30, `compact ladder present (${ladder.length} files)`);
  for (const name of ladder) {
    const parent = name.replace(/_512\.jpg$/, '.jpg');
    assert.ok(recorded.has(parent) && onDisk.includes(parent), `${name}: canonical ${parent} is on disk and recorded`);
    const row = recorded.get(name);
    assert.match(row.derived || '', new RegExp(`\\b${parent.replace('.', '\\.')}\\b`), `${name}: derived note points at ${parent}`);
    assert.equal(row.origin, recorded.get(parent).origin, `${name}: inherits the origin URL of ${parent}`);
    assert.ok(!/_ao_512\.jpg$/.test(name), `${name}: AO maps have no compact variant`);
  }
  // Every canonical colour / normal / roughness map has a compact sibling, so the loader can apply one rule.
  for (const name of onDisk) {
    if (name.endsWith('_512.jpg') || !/_(diffuse|nor_gl|rough)\.jpg$/.test(name)) continue;
    assert.ok(onDisk.includes(name.replace(/\.jpg$/, '_512.jpg')), `${name}: has a _512 sibling`);
  }
});

test('every *_ao.jpg belongs to a set that ships a diffuse or normal map', () => {
  const ao = onDisk.filter(name => name.endsWith('_ao.jpg'));
  assert.ok(ao.length >= 4, `AO maps present (${ao.length} files)`);
  for (const name of ao) {
    const prefix = name.replace(/_ao\.jpg$/, '');
    const siblings = [`${prefix}_diffuse.jpg`, `${prefix}_nor_gl.jpg`].filter(sibling => onDisk.includes(sibling));
    assert.ok(siblings.length > 0, `${name}: has a matching diffuse or normal sibling`);
  }
});

test('the new 2.9 surface sets are complete and carry physical tile sizes', () => {
  const expected = {
    interior_plaster: {maps: ['nor_gl', 'rough', 'ao'], physicalSizeM: 2.0},
    concrete_screed: {maps: ['diffuse', 'nor_gl', 'rough', 'ao'], physicalSizeM: 3.0},
    garden_fence: {maps: ['diffuse', 'nor_gl', 'rough', 'ao'], physicalSizeM: 1.5},
  };
  for (const [prefix, {maps, physicalSizeM}] of Object.entries(expected)) {
    for (const kind of maps) {
      const row = recorded.get(`${prefix}_${kind}.jpg`);
      assert.ok(row, `${prefix}_${kind}.jpg is recorded`);
      assert.equal(row.physicalSizeM, physicalSizeM, `${prefix}_${kind}.jpg: physical tile size`);
      assert.match(row.origin, /^https:\/\/dl\.polyhaven\.org\//, `${prefix}_${kind}.jpg: Poly Haven origin`);
    }
    assert.ok(!recorded.has(`${prefix}_ao_512.jpg`), `${prefix}: no compact AO variant`);
  }
  assert.ok(!recorded.has('interior_plaster_diffuse.jpg'), 'interior plaster colour comes from the paint tint, not a scan');
});

test('the green roof sets are complete, CC0 from ambientCG, and record the period they are mapped at', () => {
  // The sedum mat and the ballast are the only ambientCG assets in the bundle; everything else is Poly Haven. They
  // are also the only sets mapped at a period that is NOT the scan's published tile, so the pair
  // physicalSizeM / publishedSizeM has to survive: physicalSizeM is what preview.js passes to metricUVs, and a silent
  // drift back to the published tile would put the sedum rosettes at moss scale again.
  const expected = {
    sedum_mat: {maps: ['diffuse', 'nor_gl', 'rough', 'ao'], physicalSizeM: 0.9, publishedSizeM: 0.45},
    roof_ballast: {maps: ['diffuse', 'nor_gl'], physicalSizeM: 0.55, publishedSizeM: 1.5},
  };
  for (const [prefix, {maps, physicalSizeM, publishedSizeM}] of Object.entries(expected)) {
    for (const kind of maps) {
      const row = recorded.get(`${prefix}_${kind}.jpg`);
      assert.ok(row, `${prefix}_${kind}.jpg is recorded`);
      assert.equal(row.physicalSizeM, physicalSizeM, `${prefix}_${kind}.jpg: the period it is mapped at`);
      assert.equal(row.publishedSizeM, publishedSizeM, `${prefix}_${kind}.jpg: the tile the scan was published at`);
      assert.match(row.origin, /^https:\/\/ambientcg\.com\/get\?file=/, `${prefix}_${kind}.jpg: ambientCG origin`);
    }
    assert.ok(!recorded.has(`${prefix}_ao_512.jpg`), `${prefix}: no compact AO variant`);
  }
  // Loose gravel is uniformly matte: shipping a roughness or AO map for it would be page weight nobody sees.
  for (const kind of ['rough', 'ao']) assert.ok(!recorded.has(`roof_ballast_${kind}.jpg`), `roof ballast ships no ${kind} map`);
  // The sedum colour map is the one map a user can zoom into, so it alone is written at the full 1024 px.
  assert.match(recorded.get('sedum_mat_diffuse.jpg').resolution, /1024px$/);
  for (const name of ['sedum_mat_nor_gl.jpg', 'sedum_mat_rough.jpg', 'sedum_mat_ao.jpg', 'roof_ballast_diffuse.jpg', 'roof_ballast_nor_gl.jpg'])
    assert.match(recorded.get(name).resolution, /512px$/, `${name}: written at the compact size`);
  assert.match(recorded.get('sedum_mat_diffuse.jpg').derived || '', /colour graded/, 'the sedum grade is recorded');
});

// The models folder is the other half of the licensed bundle, and until 2.9.2 nothing checked it at all: a glTF
// could be added, replaced or re-encoded and the only trace would be a line in THIRD_PARTY.md that nobody diffs.
// Same three questions as the scans above — do the bytes on disk match the manifest, is everything on disk
// licensed, and is every model the scene asks for actually there.
const modelsDir = fileURLToPath(new URL('../../addons/cs_prefab_configurator/static/src/assets/models/', import.meta.url));
const modelProvenance = JSON.parse(readFileSync(modelsDir + 'provenance.json', 'utf8'));
const modelRows = new Map(modelProvenance.assets.map(row => [row.file, row]));

function modelFiles(folder = '') {
  const out = [];
  for (const entry of readdirSync(modelsDir + folder, {withFileTypes: true})) {
    if (entry.isDirectory()) out.push(...modelFiles(`${folder}${entry.name}/`));
    else if (entry.name !== 'provenance.json') out.push(folder + entry.name);
  }
  return out;
}

test('every CC0 furniture model on disk is recorded, byte for byte, and every recorded model is on disk', () => {
  const onDiskModels = modelFiles();
  assert.ok(onDiskModels.length >= 30, `models are shipped (${onDiskModels.length} files)`);
  for (const name of onDiskModels) assert.ok(modelRows.has(name), `${name} ships without a provenance row`);
  for (const row of modelProvenance.assets) {
    for (const key of ['file', 'origin', 'assetPage', 'license', 'licenseUrl', 'sha256', 'bytes', 'role', 'resolution', 'downloaded']) {
      assert.ok(row[key] !== undefined && row[key] !== '', `${row.file}: provenance row carries ${key}`);
    }
    assert.match(row.license, /^CC0-1\.0$/, `${row.file}: only CC0 models ship`);
    assert.match(row.origin, /^https:\/\/dl\.polyhaven\.org\//, `${row.file}: Poly Haven origin`);
    assert.ok(['gltf', 'bin', 'texture'].includes(row.role), `${row.file}: role is gltf/bin/texture, got ${row.role}`);
    assert.equal(statSync(modelsDir + row.file).size, row.bytes, `${row.file}: byte size matches the manifest`);
    assert.equal(createHash('sha256').update(readFileSync(modelsDir + row.file)).digest('hex'), row.sha256,
      `${row.file}: sha256 matches the manifest — re-run scripts/prepare_furniture_models.py rather than editing by hand`);
    // A file that is NOT the upstream bytes has to say so and say what the upstream was.
    if (row.originalSha256) assert.match(row.originalSha256, /^[0-9a-f]{64}$/, `${row.file}: upstream sha256 recorded`);
    if (row.role !== 'texture' && row.sha256 !== row.originalSha256 && row.originalSha256)
      assert.ok(row.derived, `${row.file}: differs from upstream, so the provenance row must record what was done`);
  }
  // Every model the scene can ask for resolves to a file that exists and is licensed.
  for (const [name, spec] of Object.entries(MODELS)) {
    assert.ok(modelRows.has(spec.file), `${name}: ${spec.file} has a provenance row`);
    assert.ok(onDiskModels.includes(spec.file), `${name}: ${spec.file} is on disk`);
  }
});

test('the trimmed garden set records the trim, and its buffer really is smaller than the one Poly Haven published', () => {
  // The one asset in the bundle whose glTF is not upstream's bytes. If a later re-download quietly drops the trim,
  // the page gains back 166 kB of a chair mesh nothing renders, and only this row would have shown it.
  for (const file of ['outdoor_table_chair_set_01/outdoor_table_chair_set_01_1k.gltf', 'outdoor_table_chair_set_01/outdoor_table_chair_set_01.bin']) {
    const row = modelRows.get(file);
    assert.ok(row, `${file} is recorded`);
    assert.match(row.derived || '', /trimmed: node\(s\) .*removed/, `${file}: the trim is recorded`);
    assert.ok(row.originalSha256 && row.originalSha256 !== row.sha256, `${file}: the upstream sha256 is kept and differs`);
  }
  const bin = modelRows.get('outdoor_table_chair_set_01/outdoor_table_chair_set_01.bin');
  assert.ok(bin.bytes < 300_000, `the trimmed buffer stays under 300 kB (${bin.bytes})`);
  // The surviving glTF must still name both parts preview.js lays out, or the terrace falls back to the stand-in.
  const gltf = JSON.parse(readFileSync(modelsDir + 'outdoor_table_chair_set_01/outdoor_table_chair_set_01_1k.gltf', 'utf8'));
  const nodes = gltf.nodes.map(node => node.name);
  assert.deepEqual(nodes.sort(), ['outdoor_table_chair_set_01_chair_02', 'outdoor_table_chair_set_01_table']);
});

test('the sky HDR is recorded and unchanged', () => {
  const hdr = rows.find(row => row.role === 'hdri');
  assert.ok(hdr, 'HDR provenance row present');
  assert.ok(onDisk.includes(hdr.file));
});

// The floor tile is the one number that lives in two places: the generator bakes it into the pixels and preview.js
// maps the mesh at it. If they drift apart the boards come out the wrong size AND the tile stops meeting itself, and
// nothing in the scene complains - so the scene's own constant is read back out of the source and compared here.
test('the floor finishes wrap at the tile size preview.js maps them at', () => {
  const preview = readFileSync(new URL('../../addons/cs_prefab_configurator/static/src/preview.js', import.meta.url), 'utf8');
  const period = preview.match(/floorPeriod\(\)\{return this\.floorFinish==='herringbone'\?([\d.]+):([\d.]+);\}/);
  assert.ok(period, 'preview.js still declares floorPeriod() as a herringbone/laminate pair');
  const mapped = {parquet_herringbone: Number(period[1]), laminate_floor: Number(period[2])};
  for (const [prefix, metres] of Object.entries(mapped)) {
    const set = rows.filter(row => row.file.startsWith(`${prefix}_`));
    assert.ok(set.length >= 7, `${prefix}: the whole set is recorded (${set.length} files)`);
    for (const row of set) {
      assert.equal(row.physicalSizeM, metres,
        `${row.file}: the tile the generator wrote must equal the period preview.js maps it at`);
      assert.match(row.derived || '', /laminate_floor_02|compact-tier variant/, `${row.file}: derivation recorded`);
    }
  }
  // Both finishes are laid from one grain at one working resolution, so each tile is a whole number of its own board
  // module: 2.40 m = 2 x 120 cm boards, 3.3941 m = 2 x 2 herringbone lattice periods of 60 cm boards at 45 degrees.
  assert.equal(mapped.laminate_floor, 2.4, 'laminate: 2 x 12 boards of 120 x 20 cm');
  assert.ok(Math.abs(mapped.parquet_herringbone - 2 * 2 * 0.6 * Math.SQRT2) < 0.002,
    'herringbone: 2 x 2 lattice periods of 60 x 15 cm boards, rotated 45 degrees');
});

// The colour map carries the tone, so a regression to the washed-out 2.9.1 grade (mean rgb(198,186,167), 16 %
// saturated, which rendered as grey-beige) would be invisible to every other check here. The mean the generator
// measured travels in the manifest; `python scripts/check_floor_tiling.py` re-measures the shipped pixels against
// it, so this test guards the tone and that control guards the manifest.
test('both floor colour maps ship the same warm light oak tone', () => {
  const means = {};
  for (const prefix of ['laminate_floor', 'parquet_herringbone']) {
    const row = recorded.get(`${prefix}_diffuse.jpg`);
    assert.ok(Array.isArray(row.meanSRGB) && row.meanSRGB.length === 3, `${prefix}: mean sRGB recorded`);
    const [r, g, b] = row.meanSRGB;
    means[prefix] = row.meanSRGB;
    assert.ok(r > g && g > b, `${prefix}: warm (R > G > B), got ${row.meanSRGB}`);
    assert.ok(r - b >= 40 && r - b <= 90, `${prefix}: warm cast R-B between 40 and 90, got ${(r - b).toFixed(1)}`);
    assert.ok(r >= 160 && r <= 225, `${prefix}: still a LIGHT oak, red mean ${r.toFixed(1)} in 160..225`);
  }
  for (let channel = 0; channel < 3; channel++) {
    assert.ok(Math.abs(means.laminate_floor[channel] - means.parquet_herringbone[channel]) <= 8,
      `channel ${channel}: the two finishes stay one product family (${means.laminate_floor} vs ${means.parquet_herringbone})`);
  }
});

// ---- 2.9.4: every brick and wood facade is a scan ---------------------------------------------------------------
// The customer question this answers is "why does Baksteen rood look real and the others do not": until 2.9.4 only
// brick-red had a colour scan and the rest fell back to a canvas pattern. These controls fail from a different
// direction than the browser gates: they read the CATALOGUE and preview.js's own tables and ask whether every
// finish a customer can pick still resolves to a file on disk, at the period the scene maps it at.
const previewSource = readFileSync(new URL('../../addons/cs_prefab_configurator/static/src/preview.js', import.meta.url), 'utf8');
const catalogue = JSON.parse(readFileSync(new URL('../../addons/cs_prefab_configurator/data/catalog.json', import.meta.url), 'utf8'));
const facadeOptions = catalogue.groups.flatMap(group => group.fields).find(field => field.key === 'facade').options.map(option => option.id);
const scanTable = Object.fromEntries([...previewSource.matchAll(/'([a-z-]+)':'(brick[A-Za-z]*Color|woodColor)'/g)].map(m => [m[1], m[2]]));
const loaderFiles = Object.fromEntries([...previewSource.matchAll(/\['(brick[A-Za-z]*Color|woodColor)','([a-z_0-9]+\.jpg)',true\]/g)].map(m => [m[1], m[2]]));

test('every brick and wood facade in the catalogue resolves to a colour scan the loader really ships', () => {
  const textured = facadeOptions.filter(id => /^(brick|wood|open)/.test(id));
  assert.equal(textured.length, 8, `the catalogue still offers 8 brick/wood finishes, got ${textured}`);
  for (const id of textured) {
    const key = scanTable[id];
    assert.ok(key, `${id}: preview.js FACADE_SCANS names a scan for it (otherwise it falls back to the drawn pattern)`);
    const file = loaderFiles[key];
    assert.ok(file, `${id}: loadAssets() loads ${key} as an sRGB colour map`);
    assert.ok(recorded.has(file) && onDisk.includes(file), `${id}: ${file} is on disk and licensed`);
  }
  // The flat coated finishes are the ONLY ones left on the canvas pattern, and that is deliberate.
  for (const id of facadeOptions.filter(id => /^(pvc|render)/.test(id))) assert.ok(!scanTable[id], `${id}: stays a flat colour`);
});

test('the four bricks are one wall in four clay colours, mapped at the period preview.js uses', () => {
  const period = previewSource.match(/if\(code\.startsWith\('brick'\)\)return\{periodX:([\d.]+),periodY:([\d.]+),turn:false\};/);
  assert.ok(period, 'preview.js facadePeriods() still declares a single brick period');
  assert.equal(Number(period[1]), Number(period[2]), 'the brick scan is mapped square');
  const red = recorded.get('red_brick_03_diffuse.jpg');
  for (const prefix of ['red_brick_03', 'brick_red', 'brick_black', 'brick_white', 'brick_yellow']) {
    for (const row of rows.filter(row => row.file.startsWith(`${prefix}_`))) {
      assert.equal(row.physicalSizeM, Number(period[1]),
        `${row.file}: mapped at the period preview.js uses (0,88 m puts the scan's 14 courses at Dutch waalformaat)`);
      assert.equal(row.publishedSizeM, 1.0, `${row.file}: records the tile Poly Haven published`);
      // The recoloured albedos carry the red DIFFUSE url; the red set's own normal and roughness rows keep theirs.
      if (prefix !== 'red_brick_03') assert.equal(row.origin, red.origin, `${row.file}: traceable to the red scan`);
    }
  }
  // The recolour is derived from the shipped bytes: if the red scan is ever re-downloaded or re-graded without
  // re-running scripts/prepare_facade_textures.py, the others would silently stop being the same wall. Since 2.17.0
  // "Baksteen rood" is one of them too: the scan stays on disk as the SOURCE, untouched.
  for (const prefix of ['brick_red', 'brick_black', 'brick_white', 'brick_yellow']) {
    const row = recorded.get(`${prefix}_diffuse.jpg`);
    assert.match(row.derived, /recoloured from red_brick_03_diffuse\.jpg/, `${prefix}: records what was done`);
    assert.match(row.derived, /mask = saturation x height-from-normal/, `${prefix}: records how clay and mortar were split`);
    assert.ok(row.derived.includes(red.sha256), `${prefix}: was derived from the red scan that ships (re-run the generator)`);
  }
});

test('"Baksteen rood" is the lighter salmon-red brick of the owner\'s reference, loaded instead of the dark scan', () => {
  // 2.17.0, the owner: "bizdeki tuğla rengini biraz da açık renkli tuğla rengi yapabilir miyiz", pointing at a
  // reference render whose brick measures #c79b8e on the sunlit face with thin DARK joints (#564843). The scan's own
  // clay averages rgb(106,84,75); the lighter wall is recoloured from it like the other three, and the loader asks for
  // the recolour — the scan stays on disk only as the derivation source.
  const [r, g, b] = recorded.get('brick_red_diffuse.jpg').meanSRGB;
  assert.ok(r > g && g > b, `still a red clay, warm: ${[r, g, b]}`);
  assert.ok(0.2126 * r + 0.7152 * g + 0.0722 * b >= 120, `clearly lighter than the scan (luma 88): ${[r, g, b]}`);
  assert.ok(r - b >= 30 && r - b <= 70, `salmon, not orange and not pink: ${[r, g, b]}`);
  assert.match(previewSource, /\['brickColor','brick_red_diffuse\.jpg',true\]/, 'the loader fetches the lighter recolour');
  assert.doesNotMatch(previewSource, /\['brickColor','red_brick_03_diffuse\.jpg'/, 'and no longer the dark scan');
});

test('the three recoloured bricks hit real Dutch facade colours and none of them is still red', () => {
  const tone = prefix => recorded.get(`${prefix}_diffuse.jpg`).meanSRGB;
  const [br, bg, bb] = tone('brick_black');
  assert.ok(br < 110 && Math.abs(br - bb) < 18, `black: dark anthracite, not flat black and not warm, got ${tone('brick_black')}`);
  assert.ok(br > 45, `black: never crushed to black, got ${br}`);
  const [wr, wg, wb] = tone('brick_white');
  assert.ok(wr > 185 && wr - wb < 22 && wg > wb, `white: chalky warm white, got ${tone('brick_white')}`);
  const [yr, yg, yb] = tone('brick_yellow');
  assert.ok(yr > yg && yg > yb && yr - yb >= 40 && yr > 140, `yellow: warm sand, got ${tone('brick_yellow')}`);
  // Each has to be a measurably different wall from the red it came from (mean rgb(106,84,75)); as shipped the
  // three sit 32 (black), 190 (white) and 103 (yellow) sRGB units away from it.
  for (const prefix of ['brick_black', 'brick_white', 'brick_yellow']) {
    const [r, g, b] = tone(prefix);
    assert.ok(Math.hypot(r - 106, g - 84, b - 75) > 25, `${prefix}: measurably not the red scan, got ${tone(prefix)}`);
  }
});

test('the wood facade albedo is the deck scan retoned, at the board pitch the cladding is drawn at', () => {
  const across = previewSource.match(/across=open\?\.60:([\d.]+),along=open\?([\d.]+):[\d.]+;/);
  assert.ok(across, 'preview.js facadePeriods() still declares the wood periods');
  const closed = Number(across[1]);
  for (const row of rows.filter(row => /^(wood_facade|wood_floor_deck)_/.test(row.file))) {
    assert.equal(row.physicalSizeM, closed, `${row.file}: 1,44 m = 12 scanned boards of 12 cm, the cladding groove pitch`);
    assert.equal(row.publishedSizeM, 1.8, `${row.file}: records the tile Poly Haven published`);
  }
  const deck = recorded.get('wood_floor_deck_diffuse.jpg'), facade = recorded.get('wood_facade_diffuse.jpg');
  assert.equal(facade.origin, deck.origin, 'the retoned albedo stays traceable to the deck scan');
  assert.ok(facade.derived.includes(deck.sha256), 'wood_facade: was retoned from the deck scan that ships');
  const [r, g, b] = facade.meanSRGB;
  assert.ok(r > g && g > b && r - b >= 55 && r > 140 && r < 200, `wood: warm timber, not the dark varnish it came from, got ${facade.meanSRGB}`);
  // The point of retoning rather than downloading: the relief and roughness are the SAME scan, so they register.
  for (const kind of ['nor_gl', 'rough']) assert.ok(recorded.has(`wood_floor_deck_${kind}.jpg`), `wood_floor_deck_${kind}.jpg still ships`);
});
