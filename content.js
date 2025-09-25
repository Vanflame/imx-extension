/*
Content script for Immutable Play: bridge page -> extension communication
*/
(function () {
  'use strict';

  // Listen for postMessage from page scripts (pageHook.js)
  window.addEventListener('message', (event) => {
    try {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__immutableExt !== true || data.type !== 'TOKEN_CAPTURED') return;

      // Safely send to background script
      if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'TOKEN_CAPTURED', token: data.token });
      }
    } catch (error) {
      // Silent error handling
    }
  });

  // Handle requests from extension (popup/background) to fetch stats via page origin
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      (async () => {
        try {
          if (!msg || msg.type !== 'FETCH_STATS' || !msg.token) {
            sendResponse({ ok: false, error: 'Invalid request' });
            return;
          }

          const headers = {
            'Authorization': `Bearer ${msg.token}`,
            'Accept': 'application/json, text/plain, */*'
          };

          const [statsRes, eligRes] = await Promise.all([
            fetch('https://api.immutable.com/v3/rewards/sweepstakes/user-stats/predicted', {
              method: 'GET',
              headers
            }),
            fetch('https://api.immutable.com/v1/rewards/redemption/eligibility', {
              method: 'GET',
              headers
            })
          ]);

          if (!statsRes.ok || !eligRes.ok) {
            sendResponse({
              ok: false,
              error: `HTTP error - stats: ${statsRes.status}, eligibility: ${eligRes.status}`
            });
            return;
          }

          const [stats, elig] = await Promise.all([
            statsRes.json(),
            eligRes.json()
          ]);

          sendResponse({ ok: true, stats, elig });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error.message || 'Unknown error occurred'
          });
        }
      })();
      return true; // Keep message channel open for async response
    });
  }
})();
