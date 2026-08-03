/* ═══════════════════════════════════════
   scout/js/analytics.js
   GA4 injection for Scout — mirrors js/shared.js's injectAnalytics()
   on the main site, but reads the Measurement ID from the multi-site
   registry (data/sites.json, site id "scout") instead of
   site-settings.json, since Scout doesn't load shared.js. Silently
   does nothing until a Measurement ID is set via Admin → Blog → the
   GA4 field next to the site selector.
   ═══════════════════════════════════════ */
(function () {
  fetch('/data/sites.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var site = (data.sites || []).find(function (s) { return s.id === 'scout'; });
      var id = site && site.ga4MeasurementId;
      if (!id) return;
      if (document.getElementById('scout-ga4-script')) return; // already injected this page load

      var s1 = document.createElement('script');
      s1.async = true;
      s1.id = 'scout-ga4-script';
      s1.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
      document.head.appendChild(s1);

      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      gtag('js', new Date());
      if (!localStorage.getItem('gms-self-exclude')) {
        gtag('config', id);
      }
    })
    .catch(function () {});
})();
