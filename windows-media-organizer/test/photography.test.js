'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parsePhotographyName,
  buildPhotographyName,
  indexUsedNumbers,
  nextFreeNumber,
  nextFreeLetter,
  assignEditionLetters,
} = require('../src/core/naming/photography');

test('parsePhotographyName parses location, description, number, and optional edit letter', () => {
  assert.deepEqual(parsePhotographyName('Yosemite - Half Dome at sunset - 014'), {
    location: 'Yosemite',
    description: 'Half Dome at sunset',
    number: 14,
    numberStr: '014',
    letter: null,
  });

  const withLetter = parsePhotographyName('Rome Trip - Colosseum - 001b');
  assert.equal(withLetter.letter, 'b');
  assert.equal(withLetter.number, 1);
});

test('parsePhotographyName returns null for names that do not match the convention', () => {
  assert.equal(parsePhotographyName('IMG_1234'), null);
  assert.equal(parsePhotographyName('Just one segment'), null);
});

test('buildPhotographyName round-trips with parsePhotographyName', () => {
  const name = buildPhotographyName({ location: 'Chicago', description: 'Skyline at dusk', number: 7, letter: null });
  assert.equal(name, 'Chicago - Skyline at dusk - 007');
  assert.deepEqual(parsePhotographyName(name), {
    location: 'Chicago',
    description: 'Skyline at dusk',
    number: 7,
    numberStr: '007',
    letter: null,
  });
});

test('indexUsedNumbers + nextFreeNumber find the next available sequence number', () => {
  const existing = ['Chicago - Skyline - 001', 'Chicago - Bean - 002', 'Chicago - Bean edit - 002a'];
  const used = indexUsedNumbers(existing);
  assert.equal(nextFreeNumber(used), 3);
  assert.deepEqual([...used.get(2)].sort(), ['', 'a']);
});

test('nextFreeLetter and assignEditionLetters hand out a/b/c in order, skipping used letters', () => {
  const used = new Set(['a']);
  assert.equal(nextFreeLetter(used), 'b');

  const assigned = assignEditionLetters([{ id: 'x' }, { id: 'y' }], 5, new Set(['a']));
  assert.deepEqual(assigned.map((a) => a.letter), ['b', 'c']);
  assert.ok(assigned.every((a) => a.number === 5));
});
