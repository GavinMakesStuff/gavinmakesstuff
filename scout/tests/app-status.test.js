const test = require('node:test');
const assert = require('node:assert/strict');

global.escHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const A = require('../js/app-status.js');

const TODAY = '2026-10-21';

test('defaults: no fields means pending, no tier 2, no decision', () => {
  const job = {};
  assert.equal(A.tier1Value(job), 'pending');
  assert.equal(A.isInterviewTierVisible(job, TODAY), false);
  assert.deepEqual(A.statusBadge(job, TODAY), { label: 'Pending', tone: 'amber' });
});

test('tier 2 visibility: past/today date, completed, or manually opened', () => {
  assert.equal(A.isInterviewTierVisible({ interviews: [{ date: '2026-10-20', completed: false }] }, TODAY), true);
  assert.equal(A.isInterviewTierVisible({ interviews: [{ date: TODAY, completed: false }] }, TODAY), true);
  assert.equal(A.isInterviewTierVisible({ interviews: [{ date: '2026-10-22', completed: false }] }, TODAY), false);
  assert.equal(A.isInterviewTierVisible({ interviews: [{ date: '', completed: true }] }, TODAY), true);
  assert.equal(A.isInterviewTierVisible({ interviews: [{ date: '', completed: false }] }, TODAY), false);
  assert.equal(A.isInterviewTierVisible({ interviewsOpen: true }, TODAY), true);
});

test('tier 2 hides again when the revealing value is corrected, data stays', () => {
  const job = { interviews: [{ date: '', completed: true }] };
  assert.equal(A.isInterviewTierVisible(job, TODAY), true);
  A.setInterviewCompleted(job, 0, false);
  assert.equal(A.isInterviewTierVisible(job, TODAY), false);
  assert.equal(job.interviews.length, 1);
});

test('rejected is one shared value across tier 1 and tier 3', () => {
  const job = { appStatus: 'interview_scheduled', interviews: [{ date: '2026-10-30', completed: false }] };
  A.setTier1(job, 'rejected');
  assert.equal(job.finalDecision, 'rejected');
  assert.equal(A.tier1Value(job), 'rejected');
  A.setTier1(job, 'pending');
  assert.equal(job.finalDecision, '');
  assert.equal(A.tier1Value(job), 'pending');

  const job2 = { appStatus: 'pending' };
  A.setFinalDecision(job2, 'rejected');
  assert.equal(A.tier1Value(job2), 'rejected');
  A.setFinalDecision(job2, '');
  assert.equal(A.tier1Value(job2), 'pending');
});

test('changing a tier never deletes another tier data', () => {
  const job = { appStatus: 'interview_scheduled', interviews: [{ date: '2026-10-30', completed: false }], finalDecision: 'offer_received' };
  A.setTier1(job, 'pending');
  assert.equal(job.interviews.length, 1);
  assert.equal(job.finalDecision, 'offer_received');
  A.setFinalDecision(job, '');
  assert.equal(job.interviews.length, 1);
  assert.equal(job.appStatus, 'pending');
});

test('unknown final decision value clears to none', () => {
  const job = { finalDecision: 'offer_accepted' };
  A.setFinalDecision(job, 'bogus');
  assert.equal(job.finalDecision, '');
});

test('interview cap is 10 and addInterview opens tier 2', () => {
  const job = {};
  for (let i = 0; i < 10; i++) assert.equal(A.addInterview(job), true);
  assert.equal(A.addInterview(job), false);
  assert.equal(job.interviews.length, 10);
  assert.equal(job.interviewsOpen, true);
});

test('setInterviewDate/Completed create interview 1 on first use, not arbitrary indexes', () => {
  const job = {};
  assert.equal(A.setInterviewDate(job, 3, '2026-11-01'), false);
  assert.equal(job.interviews === undefined || job.interviews.length === 0, true);
  assert.equal(A.setInterviewDate(job, 0, '2026-11-01'), true);
  assert.deepEqual(job.interviews, [{ date: '2026-11-01', completed: false }]);
  assert.equal(job.interviewsOpen, undefined);
  const job2 = {};
  assert.equal(A.setInterviewCompleted(job2, 0, true), true);
  assert.deepEqual(job2.interviews, [{ date: '', completed: true }]);
});

test('setInterviewDate can clear a date', () => {
  const job = { interviews: [{ date: '2026-11-01', completed: false }] };
  A.setInterviewDate(job, 0, '');
  assert.equal(job.interviews[0].date, '');
});

test('removeInterview removes one and reports missing index', () => {
  const job = { interviews: [{ date: 'a', completed: false }, { date: 'b', completed: false }] };
  assert.equal(A.removeInterview(job, 0), true);
  assert.deepEqual(job.interviews, [{ date: 'b', completed: false }]);
  assert.equal(A.removeInterview(job, 5), false);
});

test('badge priority: final decision, then latest interview, then tier 1', () => {
  assert.deepEqual(A.statusBadge({ finalDecision: 'offer_accepted', interviews: [{ date: '', completed: true }] }, TODAY), { label: 'Offer Accepted', tone: 'good' });
  assert.deepEqual(A.statusBadge({ finalDecision: 'rejected' }, TODAY), { label: 'Application Rejected', tone: 'bad' });
  assert.deepEqual(A.statusBadge({ finalDecision: 'offer_rejected' }, TODAY), { label: 'Offer Rejected', tone: 'muted' });
  assert.deepEqual(
    A.statusBadge({ appStatus: 'interview_scheduled', interviews: [{ date: '2026-10-01', completed: true }, { date: '2026-12-01', completed: false }] }, TODAY),
    { label: 'Interview 2 scheduled', tone: 'teal' });
  assert.deepEqual(
    A.statusBadge({ appStatus: 'interview_scheduled', interviews: [{ date: '2026-10-01', completed: true }] }, TODAY),
    { label: 'Interview 1 completed', tone: 'teal' });
  assert.deepEqual(A.statusBadge({ appStatus: 'interview_scheduled' }, TODAY), { label: 'Interview scheduled', tone: 'teal' });
});

test('badge reflects tier 1 pending when interviews exist but are not due', () => {
  const job = { appStatus: 'pending', interviews: [{ date: '2026-12-01', completed: false }] };
  assert.deepEqual(A.statusBadge(job, TODAY), { label: 'Pending', tone: 'amber' });
});

test('copyLines lists status and each interview', () => {
  const lines = A.copyLines({ appStatus: 'interview_scheduled', interviews: [{ date: '2026-10-30', completed: false }, { date: '', completed: true }] });
  assert.equal(lines[0], 'APPLICATION STATUS:');
  assert.match(lines[1], /Status:\s+Interview 2 completed/);
  assert.match(lines[2], /Interview 1:\s+2026-10-30 \(scheduled\)/);
  assert.match(lines[3], /Interview 2:\s+no date \(completed\)/);
});

test('render: pending job shows tier 1, add-interview link, final decision; no tier 2 rows', () => {
  const html = A.renderStatusBlock({}, 4, TODAY);
  assert.match(html, /onTier1Change\(4,this\.value\)/);
  assert.match(html, /onFinalDecision\(4,this\.value\)/);
  assert.match(html, /onAddInterview\(4\)/);
  assert.doesNotMatch(html, /Interview 1</);
  assert.match(html, /<option value="pending" selected>Pending<\/option>/);
  assert.match(html, /Application Cancelled/);
});

test('render: interview_scheduled shows date + completed controls bound to interview 0', () => {
  const html = A.renderStatusBlock({ appStatus: 'interview_scheduled', interviews: [{ date: '2026-10-30', completed: false }] }, 0, TODAY);
  assert.match(html, /onInterviewDate\(0,0,this\.value\)/);
  assert.match(html, /onInterviewCompleted\(0,0,this\.checked\)/);
  assert.match(html, /value="2026-10-30"/);
});

test('render: due interviews show tier 2 rows with remove buttons and escaped dates', () => {
  const job = { interviews: [{ date: '2026-10-01', completed: true }, { date: '"><b>x', completed: false }] };
  const html = A.renderStatusBlock(job, 2, TODAY);
  assert.match(html, /Interview 1/);
  assert.match(html, /Interview 2/);
  assert.match(html, /onRemoveInterview\(2,1\)/);
  assert.doesNotMatch(html, /"><b>x/);
});

test('render: at cap shows the maximum note instead of the add button', () => {
  const job = { interviews: Array.from({ length: 10 }, () => ({ date: '2026-10-01', completed: true })) };
  const html = A.renderStatusBlock(job, 0, TODAY);
  assert.match(html, /Maximum of 10 interviews/);
  assert.doesNotMatch(html, /onAddInterview/);
});

test('setTier1 rejected preserves appStatus and interviews', () => {
  const job = { appStatus: 'interview_scheduled', interviews: [{ date: '2026-10-01', completed: true }] };
  A.setTier1(job, 'rejected');
  assert.equal(job.finalDecision, 'rejected');
  assert.equal(job.appStatus, 'interview_scheduled');
  assert.equal(job.interviews.length, 1);
});

test('badge tones for final decisions', () => {
  assert.equal(A.statusBadge({ finalDecision: 'offer_received' }, TODAY).tone, 'good');
  assert.equal(A.statusBadge({ finalDecision: 'cancelled' }, TODAY).tone, 'muted');
  assert.equal(A.statusBadge({ finalDecision: 'offer_accepted' }, TODAY).tone, 'good');
});

test('localISO uses local date parts', () => {
  assert.equal(A.localISO(new Date(2026, 9, 21, 23, 59)), '2026-10-21');
});

test('corrupt interview entries are filtered without throwing', () => {
  const job = { interviews: [null, { date: '2026-10-01', completed: true }] };
  assert.doesNotThrow(() => A.isInterviewTierVisible(job, TODAY));
  assert.doesNotThrow(() => A.statusBadge(job, TODAY));
  assert.doesNotThrow(() => A.renderStatusBlock(job, 0, TODAY));
  assert.equal(job.interviews.length, 1);
});
