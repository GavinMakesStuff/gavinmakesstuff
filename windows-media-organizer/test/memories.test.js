'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseMemoriesLocation, checkYearMatchesCaptureDate, classifyMemoryName } = require('../src/core/naming/memories');

test('parseMemoriesLocation extracts year/group from a well-filed path', () => {
  const root = path.join('C:', 'Memories');
  const file = path.join(root, '2021', 'Smith Family Reunion', 'Everyone at the lake.jpg');
  const result = parseMemoriesLocation(file, root);
  assert.equal(result.year, '2021');
  assert.equal(result.group, 'Smith Family Reunion');
  assert.deepEqual(result.issues, []);
});

test('parseMemoriesLocation flags files not filed two levels deep', () => {
  const root = path.join('C:', 'Memories');
  const file = path.join(root, 'loose.jpg');
  const result = parseMemoriesLocation(file, root);
  assert.equal(result.year, null);
  assert.ok(result.issues.length > 0);
});

test('parseMemoriesLocation flags a non-year top-level folder', () => {
  const root = path.join('C:', 'Memories');
  const file = path.join(root, 'Vacations', 'Beach Trip', 'photo.jpg');
  const result = parseMemoriesLocation(file, root);
  assert.equal(result.year, null);
  assert.match(result.issues[0], /doesn't look like a year/);
});

test('checkYearMatchesCaptureDate flags mismatched year folders', () => {
  const mismatch = checkYearMatchesCaptureDate('2021', new Date('2019-06-01'));
  assert.match(mismatch, /2019/);

  const ok = checkYearMatchesCaptureDate('2021', new Date('2021-06-01'));
  assert.equal(ok, null);
});

test('classifyMemoryName distinguishes named vs generated vs blank', () => {
  assert.equal(classifyMemoryName('Grandpa telling a story'), 'named');
  assert.equal(classifyMemoryName('IMG_4821'), 'generated');
  assert.equal(classifyMemoryName('   '), 'blank');
});
