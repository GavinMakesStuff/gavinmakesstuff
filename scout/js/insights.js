/* ═══════════════════════════════════════
   scout/js/insights.js
   Opt-in insights program, browser side. WRITE-ONLY: it can send events and
   change the user's own consent, and it can never read analytics data back.
   Nothing is sent unless scoutUser.analyticsConsent is true.
   Server rules: api/_lib/scout-analytics.js. Wording must match
   scout/legal/privacy.html section 11.
   ═══════════════════════════════════════ */
const Insights = (() => {
  const FLUSH_MS = 10000;
  const MAX_BATCH = 50;
  const PROMPT_KEY = 'scout-insights-prompt-dismissed';
  let queue = [];
  let timer = null;
  let openSent = false;

  const consented = () => !!(typeof scoutUser !== 'undefined' && scoutUser && scoutUser.analyticsConsent);
  const signedIn  = () => !!(typeof scoutUser !== 'undefined' && scoutUser && scoutUser.id);

  function track(type, props) {
    if (!consented()) return;
    queue.push({ type, props: props || {} });
    if (queue.length >= MAX_BATCH) flush();
    else if (!timer) timer = setTimeout(flush, FLUSH_MS);
  }

  async function flush() {
    clearTimeout(timer); timer = null;
    if (!queue.length) return;
    if (!consented()) { queue = []; return; }
    const batch = queue.splice(0, MAX_BATCH);
    try {
      const jwt = await getAuthToken();
      if (!jwt) return;
      await fetch('/api/scout-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
        body: JSON.stringify({ action: 'analytics-track', events: batch }),
        keepalive: true,
      });
    } catch (e) { /* analytics must never affect the app */ }
  }

  async function setConsent(enabled) {
    try {
      const jwt = await getAuthToken();
      if (!jwt) { showToast('Please sign in first.'); return null; }
      const res = await fetch('/api/scout-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
        body: JSON.stringify({ action: 'analytics-consent', enabled: !!enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.error || 'Could not update your setting. Please try again.'); refreshUI(); return null; }

      if (!scoutUser) { refreshUI(); return data; }
      scoutUser.analyticsConsent = !!data.consent;
      if (!data.consent) queue = [];
      if (data.bonusGranted) {
        scoutUser.analyticsBonusGranted = true;
        scoutUser.balance = (scoutUser.balance || 0) + 3;
        if (typeof updateUserUI === 'function') updateUserUI();
        showToast('Thank you! 3 tokens were added to your account.');
      } else {
        showToast(data.consent ? 'Insights turned on. Thank you!' : 'Insights turned off. The link between your account and your earlier information was removed.');
      }
      refreshUI();
      return data;
    } catch (e) {
      showToast('Could not update your setting. Please try again.');
      refreshUI();
      return null;
    }
  }

  function dismissPrompt() {
    try { localStorage.setItem(PROMPT_KEY, '1'); } catch (e) {}
    refreshUI();
  }

  function promptWanted() {
    if (!signedIn() || !scoutUser.analyticsAvailable || consented() || scoutUser.analyticsBonusGranted) return false;
    try { if (localStorage.getItem(PROMPT_KEY)) return false; } catch (e) {}
    return true;
  }

  // Sync every consent control on the page with the current state.
  function refreshUI() {
    const on = consented();
    const card = document.getElementById('insights-card');
    if (card) card.hidden = !(signedIn() && !!scoutUser.analyticsAvailable);
    document.querySelectorAll('.insights-toggle').forEach(el => { el.checked = on; el.disabled = !signedIn(); });
    document.querySelectorAll('.insights-status').forEach(el => {
      el.textContent = !signedIn() ? 'Sign in to choose.' : on ? 'On. Thank you for helping.' : 'Off';
    });
    document.querySelectorAll('.insights-reward').forEach(el => {
      el.hidden = !signedIn() || !!scoutUser.analyticsBonusGranted;
    });
    document.querySelectorAll('.insights-reward-done').forEach(el => {
      el.hidden = !(signedIn() && scoutUser.analyticsBonusGranted);
    });
    const p = document.getElementById('insights-prompt');
    if (p) p.hidden = !promptWanted();
  }

  // Page lifecycle
  document.addEventListener('scout:auth-ready', () => { refreshUI(); if (!openSent) { openSent = true; track('app_open', { view: 'results' }); } });
  document.addEventListener('scout:signed-in',  () => { queue = []; refreshUI(); });
  document.addEventListener('scout:signed-out', () => { queue = []; refreshUI(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  document.addEventListener('DOMContentLoaded', refreshUI);

  // This script loads late (after jobs.js), so auth-ready may already have fired.
  refreshUI();
  if (typeof scoutReady !== 'undefined' && scoutReady && !openSent) { openSent = true; track('app_open', { view: 'results' }); }

  return { track, flush, setConsent, refreshUI, dismissPrompt };
})();
