/*
Popup script for displaying and managing the Immutable bearer token.
- Loads token from storage and displays it
- Copies token to clipboard
- Shows compact stats, eligibility, and quests
- Auto-fetches once on token change; Retry is manual
*/

const STORAGE_KEYS = {
    token: "immutableAuthToken",
    autoRefresh: "autoRefresh",
    darkMode: "darkMode",
    firebaseUser: "firebaseUser"
};

function getFromStorage(keys) {
    return new Promise((resolve) => { chrome.storage.local.get(keys, resolve); });
}
function setInStorage(obj) { return new Promise((resolve) => { chrome.storage.local.set(obj, resolve); }); }

function timeAgo(ts) {
    if (!ts) return "";
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}
function formatExpiration(data) {
    if (!data || !data.expiresAtMs) return "";
    const ms = data.expiresAtMs - Date.now();
    const expired = ms <= 0;
    const minutes = Math.floor(Math.abs(ms) / 60000);
    if (expired) return `Expired ${minutes}m ago`;
    return `Expires in ${minutes}m`;
}

function updateUserAuthDisplay(userData) {
    const signInContainer = document.querySelector('.card .row:first-child');
    if (!signInContainer) return;

    if (userData && userData.email) {
        // User is logged in - show email and sign out button
        signInContainer.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div style="display: flex; flex-direction: column; flex: 1;">
                    <div style="font-size: 12px; color: var(--muted);">Logged in as:</div>
                    <div style="font-size: 13px; font-weight: 600; color: var(--fg);">${userData.email}</div>
                </div>
                <button id="signOutBtn" class="secondary" style="flex: 0 0 auto;">
                    <span class="btn-label">Sign Out</span>
                </button>
            </div>
        `;

        // Add sign out event listener
        document.getElementById('signOutBtn')?.addEventListener('click', async () => {
            try {
                // Clear Firebase user from storage
                await setInStorage({ [STORAGE_KEYS.firebaseUser]: null });

                // Reload the popup to show sign in button
                location.reload();
            } catch (error) {
                console.error('Error signing out:', error);
            }
        });
    } else {
        // User is not logged in - show sign in button
        signInContainer.innerHTML = `
            <a href="auth.html" style="text-decoration:none; width: 100%;">
                <button class="secondary" style="width: 100%;">
                    <span class="btn-label">Sign In</span>
                    <span class="btn-spinner"></span>
                </button>
            </a>
        `;
    }
}

function render({ tokenData, userData }) {
    const tokenText = document.getElementById("tokenText");
    const status = document.getElementById("status");
    const expInfo = document.getElementById("expInfo");

    if (tokenData && tokenData.token) {
        tokenText.value = tokenData.token;
        const updated = tokenData.updatedAt ? `Updated ${timeAgo(tokenData.updatedAt)}` : "";
        const exp = formatExpiration(tokenData);
        status.textContent = updated || "";
        expInfo.textContent = exp || "";
        status.className = "label";
    } else {
        tokenText.value = "";
        status.textContent = "No token captured yet.";
        status.className = "warn";
        expInfo.textContent = "";
    }

    // Update user authentication display
    updateUserAuthDisplay(userData);
}

function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1200);
}

async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text || ""); showToast('Copied!'); } catch (_) { showToast('Copy failed'); }
}
/* update loader handling */
function showLoader(activeMsg) {
    const el = document.getElementById('statsLoader');
    if (!el) return;
    if (activeMsg) { el.classList.add('active'); } else { el.classList.remove('active'); }
}

function showError(message) {
    const box = document.getElementById('errorBox');
    if (!box) return;
    box.textContent = message || '';
    box.style.display = message ? 'block' : 'none';
}

/* extend combined, add available quests */
function buildCombined(stats, elig) {
    const games = Array.isArray(stats && stats.games) ? stats.games : [];
    const completed = [];
    const available = [];
    const now = new Date();
    for (const g of games) {
        const qs = Array.isArray(g && g.quests) ? g.quests : [];
        for (const q of qs) {
            if (q && (q.lastCompletedAt || (q.timesCompleted && q.timesCompleted > 0))) completed.push(q.name || '');
            // consider quests without ended endDate as available
            const end = q && q.endDate ? new Date(q.endDate) : null;
            const isActive = !end || end > now;
            if (q && isActive) {
                available.push({ name: q.name || '', endDate: q.endDate || null, weeklyPoints: q.weeklyPoints || q.points || 0 });
            }
        }
    }
    const progress = typeof stats?.percentageToNextTier === 'number' ? stats.percentageToNextTier : 0;
    const tier = stats?.predictedRarity || 'N/A';
    const points = typeof stats?.weeklyPoints === 'number' ? stats.weeklyPoints : 0;
    return { progress, tier, points, completed, available, raw: { stats, elig } };
}

function tierToClass(tier) {
    const t = (tier || '').toLowerCase();
    if (t === 'uncommon') return 'tier-uncommon';
    if (t === 'rare') return 'tier-rare';
    if (t === 'epic') return 'tier-epic';
    if (t === 'legendary') return 'tier-legendary';
    return 'tier-common';
}
function tierToTextClass(tier) {
    const t = (tier || '').toLowerCase();
    if (t === 'uncommon') return 'clr-uncommon';
    if (t === 'rare') return 'clr-rare';
    if (t === 'epic') return 'clr-epic';
    if (t === 'legendary') return 'clr-legendary';
    return 'clr-common';
}

function renderAvailable(list) {
    const el = document.getElementById('availableList');
    const sorted = [...list].sort((a, b) => {
        const at = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const bt = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        return at - bt;
    });
    el.innerHTML = sorted.map(it => {
        const endTxt = it.endDate ? new Date(it.endDate).toLocaleString() : '—';
        return `<li>${it.name} <span class="muted">(Ends: ${endTxt})</span> <span class="ok">+${it.weeklyPoints}</span></li>`;
    }).join('');
}

function renderEnvInfo(ip) {
    const ua = navigator.userAgent;
    const device = /Mobi|Android/i.test(ua) ? 'Mobile' : (/iPad|Tablet/i.test(ua) ? 'Tablet' : 'Desktop');
    document.getElementById('envInfo').textContent = `IP: ${ip || 'Unknown'} • Device: ${device} • Browser: ${ua.split(') ').pop().split(' ').slice(0, 2).join(' ')}`;
    const badge = document.getElementById('ipBadge');
    if (badge) badge.textContent = ip || 'Unknown';
}

function renderEligibilityList(elig) {
    const list = document.getElementById('eligibilityList');
    list.innerHTML = '';
    const fields = (elig && (elig.rules || elig)) || {};
    const items = [
        { key: 'is_kyc_exempt', label: 'KYC Exempt' },
        { key: 'is_not_sybil', label: 'Not Sybil' },
        { key: 'is_not_sanctioned', label: 'Not Sanctioned' },
        { key: 'have_played_any_in_game_quest', label: 'Played Any In-Game Quest' },
        { key: 'have_linked_any_social_media', label: 'Linked Any Social' },
        { key: 'have_verified_phone', label: 'Verified Phone' }
    ];
    items.forEach(({ key, label }) => {
        if (Object.prototype.hasOwnProperty.call(fields, key)) {
            const ok = !!fields[key];
            const li = document.createElement('li');
            li.textContent = `${label}: ${ok ? '✅' : '❌'}`;
            li.className = ok ? 'ok' : 'error';
            list.appendChild(li);
        }
    });
}

/* group available by game and render dropdowns */
function groupAvailableByGame(stats) {
    const grouped = {};
    const games = Array.isArray(stats && stats.games) ? stats.games : [];
    for (const g of games) {
        const name = g && g.name ? g.name : 'Unknown Game';
        const icon = g && g.icon ? g.icon : '';
        const quests = Array.isArray(g && g.quests) ? g.quests : [];
        const items = [];
        for (const q of quests) {
            const end = q && q.endDate ? new Date(q.endDate) : null;
            const isEnded = end && end < new Date();
            items.push({
                name: q.name || '',
                endDate: q.endDate || null,
                points: q.weeklyPoints || q.points || 0,
                ended: !!isEnded,
                icon: (q && q.icon) ? q.icon : icon
            });
        }
        grouped[name] = { icon, items };
    }
    return grouped;
}

function renderAvailableGroups(stats) {
    const container = document.getElementById('availableGroups');
    const groups = groupAvailableByGame(stats);
    container.innerHTML = '';

    Object.keys(groups).forEach(gameName => {
        const { icon, items } = groups[gameName];
        const active = items.filter(i => !i.ended);
        const ended = items.filter(i => i.ended);

        const header = document.createElement('div');
        header.className = 'game-header';
        const iconHtml = icon ? `<img src="${icon}" alt="" style="width:18px;height:18px;border-radius:4px;vertical-align:middle;margin-right:6px;">` : '';
        header.innerHTML = `<span>${iconHtml}${gameName} <span class="muted">(${active.length} active / ${ended.length} ended)</span></span><span>▼</span>`;

        const list = document.createElement('div');
        list.className = 'game-list';
        const li = [...active, ...ended].map(it => {
            const endTxt = it.endDate ? new Date(it.endDate).toLocaleString() : '—';
            const status = it.ended ? `<span class="error">(Ended)</span>` : `<span class="ok">(Active)</span>`;
            const qIcon = it.icon ? `<img class="quest-icon" src="${it.icon}" alt="">` : '';
            return `<li class="quest-row">` +
                `<span class="quest-points">` +
                `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7v4H3v3c0 3.07 1.63 5.64 4 7v3H8v3h8v-3h1v-3c2.37-1.36 4-3.93 4-7V7h-4V3zm-1 9H8V7h8v5z"/></svg>` +
                `&nbsp;${it.points}` +
                `</span>` +
                `<span class="quest-name">${qIcon}${it.name} ${status} <span class="muted">— Ends: ${endTxt}</span></span>` +
                `</li>`;
        }).join('');
        list.innerHTML = `<ul>${li}</ul>`;

        header.addEventListener('click', () => {
            list.style.display = list.style.display === 'block' ? 'none' : 'block';
        });

        container.appendChild(header);
        container.appendChild(list);
    });

    const expand = document.getElementById('expandAllBtn');
    const collapse = document.getElementById('collapseAllBtn');
    if (expand) expand.onclick = () => { container.querySelectorAll('.game-list').forEach(el => el.style.display = 'block'); };
    if (collapse) collapse.onclick = () => { container.querySelectorAll('.game-list').forEach(el => el.style.display = 'none'); };
}

/* integrate new renderer */
function renderPopupCombined(combined) {
    const tierBadge = document.getElementById('tierVal');
    tierBadge.textContent = combined.tier;
    tierBadge.className = `tier-badge ${tierToClass(combined.tier)}`;

    const progressEl = document.getElementById('progressVal');
    progressEl.textContent = `${combined.progress}%`;
    progressEl.className = `progress-val ${tierToTextClass(combined.tier)}`;

    const bar = document.getElementById('progressBar');
    bar.className = tierToClass(combined.tier);
    bar.style.width = `${combined.progress}%`;

    const weeklyEl = document.getElementById('weeklyPoints');
    weeklyEl.textContent = String(combined.points);
    weeklyEl.className = tierToTextClass(combined.tier);

    const sorted = [...combined.completed].filter(Boolean).sort((a, b) => a.localeCompare(b));
    document.getElementById('questsList').innerHTML = sorted.map(n => `<li>${n}</li>`).join('');
    renderEligibilityList(combined.raw.elig);
    renderAvailableGroups(combined.raw.stats);
}

async function sha256Hex(input) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function sendMessageToPlay(tabId, message) {
    return new Promise((resolve) => {
        try {
            chrome.tabs.sendMessage(tabId, message, (resp) => {
                const err = chrome.runtime.lastError;
                if (err) return resolve({ ok: false, error: err.message });
                resolve(resp || { ok: false, error: 'No response' });
            });
        } catch (e) { resolve({ ok: false, error: String(e && e.message ? e.message : e) }); }
    });
}
async function tryFetchViaPlayTab(token) {
    return new Promise((resolve) => {
        chrome.tabs.query({ url: ['https://play.immutable.com/*'] }, async (tabs) => {
            if (!tabs || !tabs.length) return resolve({ ok: false, error: 'No play.immutable.com tab' });
            const tab = tabs.find(t => t.active) || tabs[0];
            const resp = await sendMessageToPlay(tab.id, { type: 'FETCH_STATS', token });
            resolve(resp);
        });
    });
}
async function fetchImmutableStats(token) {
    showLoader('Loading...');
    const viaTab = await tryFetchViaPlayTab(token);
    if (viaTab && viaTab.ok) return { stats: viaTab.stats, elig: viaTab.elig };
    // fallback
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json, text/plain, */*' };
    const [statsRes, eligRes] = await Promise.all([
        fetch('https://api.immutable.com/v3/rewards/sweepstakes/user-stats/predicted', { headers }),
        fetch('https://api.immutable.com/v1/rewards/redemption/eligibility', { headers })
    ]);
    if (!statsRes.ok || !eligRes.ok) throw new Error(`HTTP stats:${statsRes.status} elig:${eligRes.status}`);
    const [stats, elig] = await Promise.all([statsRes.json(), eligRes.json()]);
    return { stats, elig };
}

async function getPublicIP() {
    try { const r = await fetch('https://api.ipify.org?format=json'); if (!r.ok) return 'Unknown IP'; const j = await r.json(); return j && j.ip ? j.ip : 'Unknown IP'; } catch { return 'Unknown IP'; }
}

async function notifyBackgroundFirebase(token, combined, logId) {
    try {
        const user = await getFromStorage(['firebaseUser']);
        await setInStorage({ lastPopupLogId: logId, lastCombinedSnapshot: combined, lastUserContext: user && user.firebaseUser ? user.firebaseUser : null });
        return await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'DASHBOARD_LOG', token, combined, logId }, (resp) => {
                const err = chrome.runtime.lastError;
                if (err) return resolve({ ok: false, message: err.message });
                resolve(resp || { ok: false, message: 'no response' });
            });
        });
    } catch (_) { return { ok: false, message: 'send failed' }; }
}

let autoFetchInFlight = false;
async function autoFetchOnceIfTokenChanged() {
    if (autoFetchInFlight) return; autoFetchInFlight = true;
    try {
        showError('');
        document.getElementById('retryStatsBtn')?.setAttribute('disabled', 'true');
        const data = await getFromStorage(['immutableAuthToken', 'lastPopupLogId']);
        const tokenData = data['immutableAuthToken'];
        const token = tokenData && tokenData.token;
        if (!token) return;
        renderEnvInfo(await getPublicIP());
        const { stats, elig } = await fetchImmutableStats(token);
        const combined = buildCombined(stats, elig);
        const logId = await sha256Hex(`${token}|${combined.progress}|${combined.tier}`);
        const last = data['lastPopupLogId'];
        document.getElementById('noChangeMsg').textContent = (last && last === logId) ? 'There are no new changes' : '';
        const save = await notifyBackgroundFirebase(token, combined, logId);
        if (save && save.ok) {
            showError('');
            renderPopupCombined(combined);
        } else {
            showError(`Failed to save: ${save && save.message ? save.message : 'unknown error'}`);
        }
    } catch (e) {
        showError(`Fetch failed: ${e && e.message ? e.message : e}`);
    } finally { showLoader(''); autoFetchInFlight = false; document.getElementById('retryStatsBtn')?.removeAttribute('disabled'); }
}

async function retryFetch() {
    try {
        showError('');
        document.getElementById('retryStatsBtn')?.setAttribute('disabled', 'true');
        const data = await getFromStorage(['immutableAuthToken']);
        const token = data['immutableAuthToken'] && data['immutableAuthToken'].token;
        if (!token) return;
        renderEnvInfo(await getPublicIP());
        const { stats, elig } = await fetchImmutableStats(token);
        const combined = buildCombined(stats, elig);
        const logId = await sha256Hex(`${token}|${combined.progress}|${combined.tier}`);
        const save = await notifyBackgroundFirebase(token, combined, logId);
        if (save && save.ok) {
            showError('');
            renderPopupCombined(combined); showToast('Saved');
        } else {
            showError(`Failed to save: ${save && save.message ? save.message : 'unknown error'}`);
        }
    } catch (e) { showError(`Fetch failed: ${e && e.message ? e.message : e}`); }
    finally { showLoader(''); document.getElementById('retryStatsBtn')?.removeAttribute('disabled'); }
}

/* ensure dark mode toggles the root element */
async function refresh() {
    const data = await getFromStorage(['immutableAuthToken', 'autoRefresh', 'darkMode', 'firebaseUser']);
    const tokenData = data['immutableAuthToken'];
    const userData = data['firebaseUser'];
    render({ tokenData, userData });
    document.getElementById("autoRefreshToggle").checked = !!data['autoRefresh'];
    const dark = !!data['darkMode'];
    document.getElementById("darkModeToggle").checked = dark;
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
}

function setButtonLoading(btnEl, isLoading) {
    if (!btnEl) return;
    if (isLoading) {
        btnEl.classList.add('loading');
        btnEl.setAttribute('disabled', 'true');
    } else {
        btnEl.classList.remove('loading');
        btnEl.removeAttribute('disabled');
    }
}


function init() {
    const root = document.getElementById("root");
    const renderLocked = () => {
        if (!root) return false;
        root.innerHTML = `
        <div class="card">
            <div class="label"><strong>Extension Locked</strong></div>
            <div class="small" style="margin-top:6px;">Sign in is required to use this extension.</div>
            <div class="row" style="margin-top:8px; gap: 8px;">
                <a href="auth.html" id="goSignIn" style="text-decoration:none; flex: 1;"><button class="secondary"><span class="btn-label">Go to Sign In</span><span class="btn-spinner"></span></button></a>
                <button id="refreshAuthBtn" class="secondary" style="flex: 0 0 auto;"><span class="btn-label">Refresh</span></button>
            </div>
            <div class="row" style="margin-top:8px;">
                <button id="debugStorageBtn" class="secondary" style="width: 100%;"><span class="btn-label">Debug Storage (Check Console)</span></button>
            </div>
        </div>`;
        return true;
    };

    function openAuthTab(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        try { chrome.tabs.create({ url: chrome.runtime.getURL('auth.html') }); }
        catch (_) { window.open('auth.html', '_blank'); }
    }

    // Gate: require Firebase user present in storage
    getFromStorage(['firebaseUser', 'accessGranted']).then((data) => {
        console.log('Popup auth check - storage data:', data);
        const user = data && data['firebaseUser'];
        const accessGranted = !!(data && data['accessGranted']);
        console.log('Popup auth check - user:', user);
        console.log('Popup auth check - accessGranted:', accessGranted);

        if (!user || !accessGranted) {
            console.log('Popup auth check - NOT AUTHENTICATED, showing locked screen');
            renderLocked();
            const link = document.getElementById('goSignIn') || document.querySelector('a[href="auth.html"]');
            if (link) link.addEventListener('click', openAuthTab);

            // Add refresh button event listener
            const refreshBtn = document.getElementById('refreshAuthBtn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => {
                    location.reload();
                });
            }

            // Add debug storage button event listener
            const debugBtn = document.getElementById('debugStorageBtn');
            if (debugBtn) {
                debugBtn.addEventListener('click', async () => {
                    try {
                        const allData = await getFromStorage(null);
                        console.log('=== DEBUG: All Chrome Storage ===');
                        console.log('All storage data:', allData);
                        console.log('Storage keys:', Object.keys(allData));

                        const authKeys = ['firebaseUser', 'accessGranted', 'firebaseIdToken'];
                        authKeys.forEach(key => {
                            console.log(`${key}:`, allData[key]);
                        });
                        console.log('=== END DEBUG ===');
                    } catch (error) {
                        console.error('Debug storage error:', error);
                    }
                });
            }
            return;
        }
        // proceed to wire events only when authenticated
        wireEvents();
    });

    function wireEvents() {
        const authLink = document.querySelector('a[href="auth.html"]');
        if (authLink) authLink.addEventListener('click', openAuthTab);
        const copyBtn = document.getElementById("copyBtn");
        const copyIpBtn = document.getElementById("copyIpBtn");
        const refreshBtn = document.getElementById("refreshBtn");
        const retryBtn = document.getElementById('retryStatsBtn');

        copyBtn.addEventListener("click", async (e) => {
            e.preventDefault(); e.stopPropagation();
            setButtonLoading(copyBtn, true);
            try {
                const val = document.getElementById("tokenText").value || "";
                await copyToClipboard(val);
            } finally {
                setButtonLoading(copyBtn, false);
            }
        });

        copyIpBtn.addEventListener("click", async (e) => {
            e.preventDefault(); e.stopPropagation();
            setButtonLoading(copyIpBtn, true);
            try {
                const ip = (document.getElementById('ipBadge')?.textContent || '').trim();
                if (ip && ip !== '—') await copyToClipboard(ip);
            } finally {
                setButtonLoading(copyIpBtn, false);
            }
        });

        refreshBtn.addEventListener("click", async (e) => {
            e.preventDefault(); e.stopPropagation();
            setButtonLoading(refreshBtn, true);
            try { await refresh(); } finally { setButtonLoading(refreshBtn, false); }
        });

        if (retryBtn) retryBtn.addEventListener('click', async (e) => {
            e.preventDefault(); e.stopPropagation();
            setButtonLoading(retryBtn, true);
            try { await retryFetch(); } finally { setButtonLoading(retryBtn, false); }
        });

        document.getElementById('darkModeToggle').addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            document.documentElement.classList.toggle('dark', enabled);
            await setInStorage({ darkMode: enabled });
        });

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            if (changes && changes['immutableAuthToken']) autoFetchOnceIfTokenChanged();

            // Check if user authentication status changed
            if (changes && (changes['firebaseUser'] || changes['accessGranted'])) {
                console.log('Authentication status changed, refreshing popup...');
                setTimeout(() => {
                    location.reload();
                }, 500);
            }
        });

        refresh();
        autoFetchOnceIfTokenChanged().catch(() => { });
    }
}

document.addEventListener("DOMContentLoaded", init);


