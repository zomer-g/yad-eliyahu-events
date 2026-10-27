'use strict';

(function () {
  const traffic = document.getElementById('withTraffic');
  const category = document.getElementById('calCategory');

  function update() {
    const q = new URLSearchParams();
    if (traffic.checked) q.set('traffic', '1');
    if (category.value) q.set('category', category.value);
    const qs = q.toString();
    const https = `${location.origin}/calendar.ics${qs ? `?${qs}` : ''}`;
    const webcal = https.replace(/^https?:/, 'webcal:');
    document.getElementById('icsUrl').textContent = https;
    document.getElementById('gcal').href = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;
    document.getElementById('webcal').href = webcal;
  }

  function track(name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
  }

  for (const [id, method] of [['gcal', 'google'], ['webcal', 'webcal'], ['copyIcs', 'copy']]) {
    document.getElementById(id).addEventListener('click', () => track('calendar_subscribe', {
      method, traffic_blocks: traffic.checked, category: category.value || 'all',
    }));
  }

  traffic.addEventListener('change', update);
  category.addEventListener('change', update);
  update();

  document.getElementById('copyIcs').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(document.getElementById('icsUrl').textContent);
      e.target.textContent = 'הועתק ✓';
      document.getElementById('copyStatus').textContent = 'כתובת היומן הועתקה';
    } catch (err) {
      e.target.textContent = 'העתיקו ידנית מהשורה למטה';
      document.getElementById('copyStatus').textContent = 'ההעתקה נכשלה. העתיקו ידנית את הכתובת שמתחת לכפתורים';
    }
  });
})();
