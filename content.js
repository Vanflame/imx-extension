/*
Bridge page -> extension: listen for window.postMessage and forward to background via chrome.runtime.sendMessage
*/
window.addEventListener('message', (event) => {
  try {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__immutableExt !== true || data.type !== 'TOKEN_CAPTURED') return;
    chrome.runtime.sendMessage({ type: 'TOKEN_CAPTURED', token: data.token });
  } catch (_) { }
});

// Handle requests from extension (popup/background) to fetch stats via page origin
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || msg.type !== 'FETCH_STATS' || !msg.token) return;
      const headers = { 'Authorization': `Bearer ${msg.token}`, 'Accept': 'application/json, text/plain, */*' };
      const [statsRes, eligRes] = await Promise.all([
        fetch('https://api.immutable.com/v3/rewards/sweepstakes/user-stats/predicted', { headers }),
        fetch('https://api.immutable.com/v1/rewards/redemption/eligibility', { headers })
      ]);
      if (!statsRes.ok || !eligRes.ok) {
        sendResponse({ ok: false, error: `HTTP stats:${statsRes.status} elig:${eligRes.status}` });
        return;
      }
      const [stats, elig] = await Promise.all([statsRes.json(), eligRes.json()]);
      sendResponse({ ok: true, stats, elig });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
  return true; // async
});
