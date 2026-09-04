/* Meta Pixel for Investment Reclaim UK, gated on the cookie banner's consent.
 *
 * The banner in Footer.dc.html writes 'accepted' or 'rejected' to localStorage
 * under 'arp-cookie-consent'. Nothing loads until that value is 'accepted', so
 * a visitor who rejects, or has not chosen yet, is never tracked.
 *
 * Uses the shared "Coresight Web" dataset (the same pixel as the housing
 * disrepair site) — one dataset, segmented in Ads Manager by URL.
 */
(function () {
  var PIXEL_ID = '1954143901967507';
  var CONSENT_KEY = 'arp-cookie-consent';
  var loaded = false;

  function consented() {
    try { return localStorage.getItem(CONSENT_KEY) === 'accepted'; }
    catch (e) { return false; }
  }

  function load() {
    if (loaded || !consented()) return;
    loaded = true;
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  window.irTrack = {
    // Called by the cookie banner the moment a choice is made, so accepting
    // starts tracking without needing a page reload.
    consentUpdated: function (value) { if (value === 'accepted') load(); },
    // Called only on a confirmed enquiry send, never on the mailto fallback.
    lead: function () { if (consented() && window.fbq) window.fbq('track', 'Lead'); }
  };

  load();
})();
