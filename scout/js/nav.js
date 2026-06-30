/* ═══════════════════════════════════════
   js/nav.js — Tab and sub-tab switching
   ═══════════════════════════════════════ */

function switchTab(name, el) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.topbar .tab').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById('tab-' + name);
  if (panel) panel.classList.add('active');
  if (el)    el.classList.add('active');
}

function switchSubtab(name) {
  document.querySelectorAll('.subtab-panel').forEach(p => {
    p.style.display = 'none';
    p.classList.remove('active');
  });
  ['results', 'saved', 'applied'].forEach(n => {
    const btn = document.getElementById('subtab-' + n + '-btn');
    if (btn) btn.classList.remove('active');
  });
  const panel = document.getElementById('subtab-' + name);
  if (panel) { panel.style.display = 'block'; panel.classList.add('active'); }
  const btn = document.getElementById('subtab-' + name + '-btn');
  if (btn) btn.classList.add('active');
  if (name === 'saved')   renderSaved();
  if (name === 'applied') renderApplied();
}


// ── Guide Panel ───────────────────────────
// Closed by default on first ever visit. Only reopens automatically
// if the user had it open the last time they were on the site.
function toggleGuide() {
  const panel   = document.getElementById('guide-panel');
  const chevron = document.getElementById('guide-chevron');
  const isOpen  = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  chevron.classList.toggle('open', !isOpen);
  localStorage.setItem('scout-guide-open', !isOpen);
}

(function () {
  const saved = localStorage.getItem('scout-guide-open');
  if (saved === 'true') {
    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('guide-panel')?.classList.add('open');
      document.getElementById('guide-chevron')?.classList.add('open');
    });
  }
})();


// ── First Visit Welcome Modal ─────────────
// Shown once, ever, prompting profile setup and resume upload before
// the user runs their first analysis. Skippable, never forced.
function shouldShowWelcome() {
  return localStorage.getItem('scout-welcome-seen') !== 'true';
}

function openWelcomeModal() {
  document.getElementById('welcome-modal')?.classList.add('open');
}

function dismissWelcome(markSeen) {
  if (markSeen) localStorage.setItem('scout-welcome-seen', 'true');
  document.getElementById('welcome-modal')?.classList.remove('open');
}

function welcomeSetUpProfile() {
  dismissWelcome(true);
  openProfileEditor();
}

document.addEventListener('DOMContentLoaded', () => {
  if (shouldShowWelcome()) {
    openWelcomeModal();
  }
});
