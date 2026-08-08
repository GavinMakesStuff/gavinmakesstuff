'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildDuplicatePlan, buildRenamePlan } = require('../src/core/planner');

test('buildDuplicatePlan quarantines discards, never touches the keeper, and explains why', () => {
  const groups = [
    {
      type: 'exact',
      keep: { path: 'C:\\Photos\\keep.jpg', size: 900, quality: { pixels: 900, width: 30, height: 30 } },
      discard: [{ path: 'C:\\Photos\\dup.jpg', size: 100, quality: { pixels: 100, width: 10, height: 10 } }],
    },
  ];

  const plan = buildDuplicatePlan(groups, { quarantineRoot: 'C:\\Quarantine' });
  assert.equal(plan.actions.length, 1);
  const [action] = plan.actions;
  assert.equal(action.action, 'quarantine');
  assert.equal(action.from, 'C:\\Photos\\dup.jpg');
  assert.equal(action.keptInstead, 'C:\\Photos\\keep.jpg');
  assert.match(action.reason, /exact duplicate/);
  assert.match(action.reason, /lower resolution/);
  assert.ok(action.to.startsWith('C:\\Quarantine'));
});

test('buildRenamePlan turns naming suggestions into from/to actions preserving extension', () => {
  const suggestions = [
    { path: path.join('C:', 'Photos', 'IMG_1.jpg'), newBaseName: 'Chicago - Skyline - 001', reason: 'Apply naming convention' },
  ];
  const plan = buildRenamePlan(suggestions);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].to, path.join('C:', 'Photos', 'Chicago - Skyline - 001.jpg'));
});
