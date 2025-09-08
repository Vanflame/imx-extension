(function init() {
    const tokenBox = document.getElementById('tokenBox');
    const status = document.getElementById('status');
    const message = document.getElementById('message');
    const tierVal = document.getElementById('tierVal');
    const progressVal = document.getElementById('progressVal');
    const progressBar = document.getElementById('progressBar');
    const weeklyPoints = document.getElementById('weeklyPoints');
    const questsList = document.getElementById('questsList');
    const completedCount = document.getElementById('completedCount');
    const statsRaw = document.getElementById('statsRaw');
    const eligibilityRaw = document.getElementById('eligibilityRaw');

    function setStatus(msg) { status.textContent = msg || ''; }
    function setMessage(msg) { message.textContent = msg || ''; }

    function computeCompletedQuests(stats) {
        const games = Array.isArray(stats && stats.games) ? stats.games : [];
        const completed = [];
        for (const game of games) {
            const quests = Array.isArray(game && game.quests) ? game.quests : [];
            for (const q of quests) {
                if (q && (q.lastCompletedAt || (q.timesCompleted && q.timesCompleted > 0))) {
                    completed.push(q.name || '');
                }
            }
        }
        return completed;
    }

    async function sha256Hex(input) {
        const encoder = new TextEncoder();
        const data = encoder.encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function buildCombined(stats, elig) {
        const completed = computeCompletedQuests(stats);
        const progress = typeof stats.percentageToNextTier === 'number' ? stats.percentageToNextTier : 0;
        const tier = stats.predictedRarity || 'N/A';
        const points = typeof stats.weeklyPoints === 'number' ? stats.weeklyPoints : 0;
        return { progress, tier, points, completed, raw: { stats, elig } };
    }

    function renderCombined(combined) {
        tierVal.textContent = combined.tier;
        progressVal.textContent = `${combined.progress}%`;
        progressBar.style.width = `${combined.progress}%`;
        weeklyPoints.textContent = String(combined.points);
        questsList.innerHTML = combined.completed.map(name => `<li>${name}</li>`).join('');
        completedCount.textContent = String(combined.completed.length);
        statsRaw.textContent = JSON.stringify(combined.raw.stats, null, 2);
        eligibilityRaw.textContent = JSON.stringify(combined.raw.elig, null, 2);
    }

    function getToken() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['immutableAuthToken'], (res) => {
                const t = res && res.immutableAuthToken && res.immutableAuthToken.token;
                resolve(t || '');
            });
        });
    }

    async function fetchJson(url, headers) {
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function fetchAndRender() {
        try {
            setStatus('Fetching...'); setMessage('');
            const token = tokenBox.value.trim();
            if (!token) { setStatus('No token captured yet'); return; }
            const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json, text/plain, */*' };
            const [stats, elig] = await Promise.all([
                fetchJson('https://api.immutable.com/v3/rewards/sweepstakes/user-stats/predicted', headers),
                fetchJson('https://api.immutable.com/v1/rewards/redemption/eligibility', headers)
            ]);

            const combined = buildCombined(stats, elig);
            const logId = await sha256Hex(`${token}|${combined.progress}|${combined.tier}`);

            // no-change validation
            chrome.storage.local.get(['lastDashboardLogId'], (res) => {
                const lastId = res && res.lastDashboardLogId;
                if (lastId && lastId === logId) {
                    setMessage('There are no new changes');
                }
                chrome.storage.local.set({ lastDashboardLogId: logId });
            });

            renderCombined(combined);
            setStatus('Done');
        } catch (e) {
            setStatus(`Error: ${e && e.message ? e.message : e}`);
        }
    }

    async function refresh() {
        setStatus('Loading token...'); setMessage('');
        const token = await getToken();
        tokenBox.value = token || '';
        if (!token) { setStatus('No token captured yet'); return; }
        await fetchAndRender();
    }

    document.getElementById('refreshBtn').addEventListener('click', refresh);
    document.getElementById('retryBtn').addEventListener('click', fetchAndRender);
    document.getElementById('copyBtn').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(tokenBox.value || ''); setStatus('Copied'); setTimeout(() => setStatus(''), 800); } catch (_) { }
    });

    // Auto-fetch once when the token changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes && changes.immutableAuthToken) {
            getToken().then((t) => {
                tokenBox.value = t || '';
                if (t) fetchAndRender();
            });
        }
    });

    // initial load
    refresh();
})();
