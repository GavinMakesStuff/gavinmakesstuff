'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isCameraGeneratedName, sanitizeForFilename, preferHumanName } = require('../src/core/naming/namingEngine');

test('isCameraGeneratedName recognizes common camera/app patterns', () => {
  const generated = ['IMG_1234', 'DSC_0001', 'DSCN0042', 'VID_20230101_120000', 'PXL_20230101_120000000', '20230101_120000', 'Screenshot_20230101', 'WhatsApp Image 2023-01-01 at 12.00.00', '4821'];
  for (const name of generated) {
    assert.ok(isCameraGeneratedName(name), `expected "${name}" to be recognized as camera-generated`);
  }
});

test('isCameraGeneratedName leaves human-typed names alone', () => {
  const human = ['Grandma birthday party', 'Half Dome sunset', 'Sarah and Mike wedding'];
  for (const name of human) {
    assert.ok(!isCameraGeneratedName(name), `expected "${name}" to NOT be flagged as camera-generated`);
  }
});

test('sanitizeForFilename strips Windows-illegal characters and trailing dots', () => {
  assert.equal(sanitizeForFilename('Trip: Day 1/2 * Fun?'), 'Trip Day 12 Fun');
  assert.equal(sanitizeForFilename('  spaced out  '), 'spaced out');
  assert.equal(sanitizeForFilename('trailing...'), 'trailing');
});

test('preferHumanName borrows a real name from the group when the keeper is camera-generated', () => {
  const group = [
    { path: 'a/IMG_1234.jpg', name: 'IMG_1234.jpg', ext: '.jpg' },
    { path: 'b/Grandmas 80th birthday.jpg', name: 'Grandmas 80th birthday.jpg', ext: '.jpg' },
  ];
  const keep = group[0];
  assert.equal(preferHumanName(group, keep), 'Grandmas 80th birthday');
});

test('preferHumanName returns null when the keeper already has a real name', () => {
  const group = [
    { path: 'a/Family reunion.jpg', name: 'Family reunion.jpg', ext: '.jpg' },
    { path: 'b/IMG_9999.jpg', name: 'IMG_9999.jpg', ext: '.jpg' },
  ];
  assert.equal(preferHumanName(group, group[0]), null);
});
