// Admin dashboard for Chrome Extension

// Firebase configuration for fallback
const firebaseConfig = {
    apiKey: "AIzaSyA0fUKA2kpoW9hHEWKcRqxjX-m-ZBFRpVM",
    projectId: "immutable-api"
};

const IDT_BASE = "https://identitytoolkit.googleapis.com/v1";
const FS_BASE = (path) => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents/${path}`;

// Firestore data conversion helpers
function fsValue(val) {
    if (val === null || typeof val === 'undefined') return { nullValue: null };
    if (typeof val === 'string') return { stringValue: val };
    if (typeof val === 'number') return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
    if (typeof val === 'boolean') return { booleanValue: val };
    if (Array.isArray(val)) return { arrayValue: { values: val.map(fsValue) } };
    if (val instanceof Date) return { timestampValue: val.toISOString() };
    if (typeof val === 'object') { const fields = {}; Object.keys(val).forEach(k => fields[k] = fsValue(val[k])); return { mapValue: { fields } }; }
    return { stringValue: String(val) };
}

function fromFs(doc) {
    const f = (doc && doc.fields) || {};
    const pick = (v) => {
        if (!v) return undefined;
        if (v.stringValue !== undefined) return v.stringValue;
        if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
        if (v.doubleValue !== undefined) return v.doubleValue;
        if (v.booleanValue !== undefined) return v.booleanValue;
        if (v.timestampValue !== undefined) return v.timestampValue;
        if (v.mapValue !== undefined) { const o = {}; const mf = v.mapValue.fields || {}; Object.keys(mf).forEach(k => o[k] = pick(mf[k])); return o; }
        if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(pick);
        return undefined;
    };
    const out = {}; Object.keys(f).forEach(k => out[k] = pick(f[k])); return out;
}

// Check if running in Chrome extension context
function isExtensionContext() {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
}

// Firestore operations with fallback for both extension and web contexts
async function firestoreGetDoc(path, idToken = null) {
    try {
        if (isExtensionContext()) {
            // Use Chrome extension background script
            const response = await chrome.runtime.sendMessage({
                type: 'FIRESTORE_GET_DOC',
                path: path,
                idToken: idToken
            });
            if (response.success) {
                return response.data;
            } else {
                throw new Error(response.error);
            }
        } else {
            // Fallback: Direct API call (may have CORS issues in some browsers)
            const url = `${FS_BASE(path)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
            const headers = idToken ? { 'Authorization': `Bearer ${idToken}` } : {};
            const res = await fetch(url, { headers });
            if (!res.ok) {
                if (res.status === 404) return null;
                throw new Error(`Firestore GET failed: ${res.status}`);
            }
            const doc = await res.json();
            return fromFs(doc);
        }
    } catch (error) {
        return null;
    }
}

async function firestoreGetCollection(path, idToken = null) {
    try {
        console.log(`Attempting to load collection: ${path}`, idToken ? 'with auth' : 'without auth');

        if (isExtensionContext()) {
            // Use Chrome extension background script
            const response = await chrome.runtime.sendMessage({
                type: 'FIRESTORE_GET_COLLECTION',
                path: path,
                idToken: idToken
            });
            console.log('Extension response:', response);
            if (response.success) {
                return response.data;
            } else {
                throw new Error(response.error);
            }
        } else {
            // Fallback: Direct API call (may have CORS issues in some browsers)
            const url = `${FS_BASE(path)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
            const headers = idToken ? { 'Authorization': `Bearer ${idToken}` } : {};
            console.log('Direct API call to:', url);
            const res = await fetch(url, { headers });
            console.log('Response status:', res.status);
            if (!res.ok) {
                const errorText = await res.text();
                console.error('Firestore error response:', errorText);
                throw new Error(`Firestore collection GET failed: ${res.status} - ${errorText}`);
            }
            const data = await res.json();
            console.log('Firestore response data:', data);
            const docs = [];
            if (data.documents) {
                data.documents.forEach(doc => {
                    const pathParts = doc.name.split('/');
                    const docId = pathParts[pathParts.length - 1];
                    docs.push({
                        id: docId,
                        data: fromFs(doc)
                    });
                });
            }
            return docs;
        }
    } catch (error) {
        console.error(`Error loading collection ${path}:`, error);
        return [];
    }
}

async function firestoreCreateDoc(path, data, idToken = null) {
    try {
        if (isExtensionContext()) {
            // Use Chrome extension background script
            const response = await chrome.runtime.sendMessage({
                type: 'FIRESTORE_CREATE_DOC',
                path: path,
                data: data,
                idToken: idToken
            });
            if (response.success) {
                return response.data;
            } else {
                throw new Error(response.error);
            }
        } else {
            // Fallback: Direct API call (may have CORS issues in some browsers)
            const url = `${FS_BASE(path)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
            const body = { fields: {} };
            Object.keys(data).forEach(key => {
                body.fields[key] = fsValue(data[key]);
            });
            const headers = { 'Content-Type': 'application/json' };
            if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

            const res = await fetch(url, {
                method: 'PATCH',
                headers,
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                throw new Error(`Firestore CREATE failed: ${res.status}`);
            }
            return true;
        }
    } catch (error) {
        return false;
    }
}

const $ = (id) => document.getElementById(id);
const adminInfo = $("adminInfo");
const usersTable = $("usersTable");
// Modal elements will be accessed by ID when needed

// Admin authentication state
let adminAuth = {
    isAuthenticated: false,
    idToken: null,
    user: null
};

// Local cache for admin session
const ADMIN_SESSION_KEY = 'admin_session_cache';
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Load admin auth from cache on page load
async function loadAdminAuth() {
    try {
        // Try to get from localStorage first (faster)
        const cachedSession = localStorage.getItem(ADMIN_SESSION_KEY);
        if (cachedSession) {
            const sessionData = JSON.parse(cachedSession);
            const sessionAge = Date.now() - sessionData.timestamp;

            if (sessionAge < SESSION_DURATION) {
                adminAuth = {
                    isAuthenticated: true,
                    idToken: sessionData.idToken,
                    user: sessionData.user
                };
                showAdminContent(true);
                setAdminLoginMsg('Welcome back!', 'ok');
                loadUsers('');
                return true;
            } else {
                localStorage.removeItem(ADMIN_SESSION_KEY);
            }
        }

        // Fallback to chrome storage if available
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                const stored = await chrome.storage.local.get(['adminAuth']);

                if (stored.adminAuth && stored.adminAuth.idToken) {
                    adminAuth = stored.adminAuth;
                    showAdminContent(true);
                    setAdminLoginMsg('Welcome back!', 'ok');
                    loadUsers('');

                    // Update cache
                    updateAdminCache();
                    return true;
                }
            } catch (error) {
                // Silent error handling
            }
        }

        return false;
    } catch (error) {
        return false;
    }
}

// Update admin cache in localStorage
function updateAdminCache() {
    try {
        const cacheData = {
            idToken: adminAuth.idToken,
            user: adminAuth.user,
            timestamp: Date.now()
        };
        localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(cacheData));
    } catch (error) {
        // Silent error handling
    }
}

// Save admin auth to storage and cache
async function saveAdminAuth() {
    try {
        // Try Chrome storage first, fallback to localStorage
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ adminAuth });
        }

        updateAdminCache();
    } catch (error) {
        // Fallback to localStorage only
        updateAdminCache();
    }
}

function setStatus(text) { if (adminInfo) adminInfo.textContent = text; }

// Helper functions for tier styling
function getTierClass(tier) {
    if (!tier) return 'tier-common';
    const tierLower = tier.toLowerCase();
    if (tierLower.includes('uncommon')) return 'tier-uncommon';
    if (tierLower.includes('rare')) return 'tier-rare';
    if (tierLower.includes('epic')) return 'tier-epic';
    if (tierLower.includes('legendary')) return 'tier-legendary';
    return 'tier-common';
}

function getTierTextClass(tier) {
    if (!tier) return 'tier-text-common';
    const tierLower = tier.toLowerCase();
    if (tierLower.includes('uncommon')) return 'tier-text-uncommon';
    if (tierLower.includes('rare')) return 'tier-text-rare';
    if (tierLower.includes('epic')) return 'tier-text-epic';
    if (tierLower.includes('legendary')) return 'tier-text-legendary';
    return 'tier-text-common';
}

function getProgressBarClass(tier) {
    if (!tier) return 'tier-common';
    const tierLower = tier.toLowerCase();
    if (tierLower.includes('uncommon')) return 'tier-uncommon';
    if (tierLower.includes('rare')) return 'tier-rare';
    if (tierLower.includes('epic')) return 'tier-epic';
    if (tierLower.includes('legendary')) return 'tier-legendary';
    return 'tier-common';
}

function setAdminLoginMsg(text, type = '') {
    const msgEl = $("adminLoginMsg");
    if (msgEl) {
        msgEl.textContent = text;
        msgEl.className = `muted ${type}`;
    }
}

function showAdminContent(show) {
    const generateBtn = $("generateCodeBtn");
    const viewCodesBtn = $("viewCodesBtn");
    const logoutBtn = $("adminLogoutBtn");
    const loginBtn = $("adminLoginBtn");

    if (show) {
        // Show admin features
        if (generateBtn) generateBtn.style.display = 'inline-block';
        if (viewCodesBtn) viewCodesBtn.style.display = 'inline-block';
        if (logoutBtn) logoutBtn.style.display = 'inline-block';
        if (loginBtn) loginBtn.style.display = 'none';
    } else {
        // Hide admin features
        if (generateBtn) generateBtn.style.display = 'none';
        if (viewCodesBtn) viewCodesBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (loginBtn) loginBtn.style.display = 'inline-block';
    }
}

function formatTs(ts) {
    try {
        if (!ts) return '—';

        // Handle Firestore timestamp format
        if (ts?.toDate) return ts.toDate().toLocaleString();

        // Handle ISO string format
        if (typeof ts === 'string' && ts.includes('T')) {
            return new Date(ts).toLocaleString();
        }

        // Handle timestamp object with seconds
        if (ts?.seconds) return new Date(ts.seconds * 1000).toLocaleString();

        // Handle timestamp object with timestampValue
        if (ts?.timestampValue) return new Date(ts.timestampValue).toLocaleString();

        // Handle number timestamp
        if (typeof ts === 'number') return new Date(ts).toLocaleString();

        // Handle Date object
        if (ts instanceof Date) return ts.toLocaleString();

        console.log('Unknown timestamp format:', ts, typeof ts);
        return '—';
    } catch (error) {
        console.error('Error formatting timestamp:', ts, error);
        return '—';
    }
}

async function isAdmin(uid) {
    try {
        const doc = await firestoreGetDoc(`Admins/${uid}`, adminAuth.idToken);

        if (doc) {
            // Check for isAdmin field in various possible locations
            const isAdminValue = doc.isAdmin || doc.isadmin || doc.IsAdmin;

            // If the document exists, consider it an admin (even if isAdmin field is missing)
            if (isAdminValue === true || isAdminValue === 'true' || isAdminValue === 1) {
                return true;
            }

            // If document exists but isAdmin is explicitly false, return false
            if (isAdminValue === false || isAdminValue === 'false' || isAdminValue === 0) {
                return false;
            }

            // If document exists but isAdmin field is missing or undefined, 
            // assume it's an admin (document existence = admin status)
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

async function loadUsers(emailContains) {
    if (usersTable) usersTable.innerHTML = '';
    setStatus('Loading users...');

    if (!adminAuth.isAuthenticated) {
        setStatus('Please sign in to view users');
        return;
    }

    try {
        console.log('Loading users with admin token:', adminAuth.idToken ? 'Present' : 'Missing');

        const docs = await firestoreGetCollection('Users', adminAuth.idToken);
        console.log('Users collection response:', docs);

        const items = [];

        for (const doc of docs) {
            const u = doc.data;
            const uid = doc.id; // Extract UID from document ID
            u.uid = uid;

            if (emailContains && !(u.email || '').toLowerCase().includes(emailContains.toLowerCase())) continue;

            // Try to get user stats
            let latestTier = '—', progress = '—', points = '—', lastAt = '—', entryCount = '0', isEligible = false;

            try {
                // Get all stats for this user
                console.log('Loading stats for user:', uid);
                const statsDocs = await firestoreGetCollection(`StatsHistoryPrivate`, adminAuth.idToken);
                console.log('Stats collection response:', statsDocs);

                const userStats = statsDocs.filter(statDoc => {
                    const statData = statDoc.data;
                    return statData.userId === uid;
                });

                if (userStats.length > 0) {
                    // Sort by timestamp and get latest
                    userStats.sort((a, b) => {
                        const aTime = a.data.timestamp;
                        const bTime = b.data.timestamp;
                        return new Date(bTime) - new Date(aTime);
                    });

                    const latestStat = userStats[0].data;
                    console.log('Latest stat data structure:', latestStat);

                    // Extract data from different possible structures
                    latestTier = latestStat?.tier ||
                        latestStat?.stats?.userStats?.bucketName ||
                        latestStat?.bucketName || '—';

                    console.log('Extracted tier:', latestTier, 'from paths:', {
                        'stats.userStats.bucketName': latestStat?.stats?.userStats?.bucketName,
                        'bucketName': latestStat?.bucketName,
                        'tier': latestStat?.tier
                    });

                    const progressValue = latestStat?.progressPercentage ??
                        latestStat?.stats?.userStats?.progressPercentage ??
                        latestStat?.progress ?? '—';
                    progress = progressValue !== '—' ? progressValue + '%' : '—';

                    points = latestStat?.weeklyPoints ??
                        latestStat?.stats?.weeklyPoints ??
                        latestStat?.points ?? '—';

                    lastAt = formatTs(latestStat?.timestamp);
                    entryCount = userStats.length.toString();

                    // Extract eligibility status for main view
                    const eligibility = latestStat?.stats?.eligibility || {};
                    const isEligible = eligibility?.eligible || false;
                }
            } catch (statsError) {
                console.error('Error loading stats for user:', uid, statsError);
            }

            items.push({ uid: u.uid, email: u.email || '—', lastAt, latestTier, progress, points, entryCount, isEligible });
        }

        // Sort users by email
        items.sort((a, b) => a.email.localeCompare(b.email));

        for (const it of items) {
            const tr = document.createElement('tr');
            const tierBadge = it.latestTier ? `<span class="tier-badge ${getTierClass(it.latestTier)}">${it.latestTier}</span>` : '—';
            const progressDisplay = it.progress ? `${it.progress}%` : '—';
            const eligibilityDisplay = it.isEligible ?
                '<span style="color: #10b981;">✅ Eligible</span>' :
                '<span style="color: #ef4444;">❌ Not Eligible</span>';
            tr.innerHTML = `<td>${it.email}</td><td>${it.lastAt}</td><td>${tierBadge}</td><td>${progressDisplay}</td><td>${it.points || '—'}</td><td>${eligibilityDisplay}</td><td>${it.entryCount}</td><td><button class="btn view-stats-btn" data-uid="${it.uid}" data-email="${it.email}">View Stats</button></td>`;
            usersTable.appendChild(tr);
        }

        setStatus(`Loaded ${items.length} users`);
    } catch (error) {
        console.error('Error loading users:', error);
        setStatus('Error loading users: ' + error.message);
    }
}

async function loadUserStats(uid, email) {
    // Show modal and set title
    const modal = document.getElementById('userStatsModal');
    const modalTitle = document.getElementById('userStatsModalTitle');
    const modalContent = document.getElementById('userStatsContent');

    modalTitle.textContent = `User Statistics - ${email}`;
    modalContent.innerHTML = '<div class="muted">Loading stats...</div>';
    modal.style.display = 'flex';

    try {
        // Get user info
        const userDoc = await firestoreGetDoc(`Users/${uid}`, adminAuth.idToken);
        const userData = userDoc || {};

        // Get all stats for this user
        const statsDocs = await firestoreGetCollection(`StatsHistoryPrivate`, adminAuth.idToken);
        const userStats = statsDocs.filter(statDoc => {
            const statData = statDoc.data;
            return statData.userId === uid;
        });

        if (userStats.length === 0) {
            modalContent.innerHTML = `
                <div class="card">
                    <div><strong>User ID:</strong> ${uid}</div>
                    <div><strong>Email:</strong> ${userData.email || '—'}</div>
                    <div><strong>Created:</strong> ${formatTs(userData.createdAt)}</div>
                    <div><strong>Updated:</strong> ${formatTs(userData.updatedAt)}</div>
                    <div class="muted" style="margin-top: 12px;">No stats history found</div>
                </div>
            `;
            return;
        }

        // Sort stats by timestamp (newest first)
        userStats.sort((a, b) => {
            const aTime = a.data.timestamp;
            const bTime = b.data.timestamp;
            return new Date(bTime) - new Date(aTime);
        });

        // Create user info header
        const headerDiv = document.createElement('div');
        headerDiv.className = 'card';
        headerDiv.style.marginBottom = '12px';

        // Get latest tier and progress for display from the first (newest) stat
        const latestStat = userStats.length > 0 ? userStats[0].data : null;
        const latestTier = latestStat?.tier ||
            latestStat?.stats?.userStats?.bucketName ||
            latestStat?.userStats?.bucketName ||
            latestStat?.bucketName ||
            '—';
        const latestProgress = latestStat?.stats?.userStats?.progress ||
            latestStat?.userStats?.progress ||
            latestStat?.progress ||
            '—';

        headerDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                <div>
                    <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 4px;">${email}</div>
                    <div style="font-size: 0.9rem; color: var(--muted);">User ID: ${uid}</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 0.9rem; color: var(--muted);">Created: ${formatTs(userData.createdAt)}</div>
                    <div style="font-size: 0.9rem; color: var(--muted);">Updated: ${formatTs(userData.updatedAt)}</div>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; font-size: 0.9rem;">
                <div><strong>Total Entries:</strong> ${userStats.length}</div>
                <div><strong>Latest Tier:</strong> ${latestTier !== '—' ? `<span class="tier-badge ${getTierClass(latestTier)}">${latestTier}</span>` : '—'}</div>
                <div><strong>Latest Progress:</strong> ${latestProgress || '—'}%</div>
            </div>
        `;

        modalContent.innerHTML = '';
        modalContent.appendChild(headerDiv);

        // Create stats history
        userStats.forEach((statDoc, index) => {
            const stat = statDoc.data;
            const div = document.createElement('div');
            div.className = 'card';
            div.style.marginBottom = '8px';
            div.style.padding = '12px';

            // Extract stats data

            const tier = stat?.tier ||
                stat?.stats?.userStats?.bucketName ||
                stat?.bucketName || '—';

            console.log('Individual stat tier extraction:', {
                'stat.stats.userStats.bucketName': stat?.stats?.userStats?.bucketName,
                'stat.bucketName': stat?.bucketName,
                'stat.tier': stat?.tier,
                'finalTier': tier
            });

            const progress = stat?.progressPercentage ??
                stat?.stats?.userStats?.progressPercentage ??
                stat?.progress ?? '—';

            const points = stat?.weeklyPoints ??
                stat?.stats?.weeklyPoints ??
                stat?.points ?? '—';

            const timestamp = formatTs(stat?.timestamp);

            // Extract additional data
            const ip = stat?.ip || '—';
            const userAgent = stat?.userAgent || '—';
            const deviceType = stat?.deviceType || '—';
            const logId = stat?.logId || '—';

            // Extract quest completion data
            const questData = stat?.stats?.userStats || {};
            const totalQuests = questData?.totalInGameQuestsCompleted || 0;
            const targetQuests = questData?.targetQuestsCompleted || [];

            // Extract eligibility data
            const eligibility = stat?.stats?.eligibility || {};
            const isEligible = eligibility?.eligible || false;

            // Extract detailed eligibility criteria
            const eligibilityFields = (eligibility && (eligibility.rules || eligibility)) || {};
            const eligibilityItems = [
                { key: 'is_kyc_exempt', label: 'KYC Exempt' },
                { key: 'is_not_sybil', label: 'Not Sybil' },
                { key: 'is_not_sanctioned', label: 'Not Sanctioned' },
                { key: 'have_played_any_in_game_quest', label: 'Played Any In-Game Quest' },
                { key: 'have_linked_any_social_media', label: 'Linked Any Social' },
                { key: 'have_verified_phone', label: 'Verified Phone' }
            ];

            // Build eligibility criteria HTML
            const eligibilityCriteria = eligibilityItems
                .filter(({ key }) => Object.prototype.hasOwnProperty.call(eligibilityFields, key))
                .map(({ key, label }) => {
                    const isOk = !!eligibilityFields[key];
                    return `<div style="font-size: 0.7rem; margin: 2px 0; color: ${isOk ? '#10b981' : '#ef4444'};">
                        ${isOk ? '✅' : '❌'} ${label}
                    </div>`;
                })
                .join('');

            // Create progress bar with tier-based styling
            const progressBar = progress !== '—' ? `
                <div class="progress-bar">
                    <div class="progress-fill ${getProgressBarClass(tier)}" style="width: ${progress}%;"></div>
                </div>
            ` : '';

            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                    <div style="flex: 1;">
                        <div style="font-size: 0.9rem; color: var(--muted);">Entry #${userStats.length - index}</div>
                        <div style="font-size: 0.8rem; color: var(--muted);">${timestamp}</div>
                        <div style="font-size: 0.7rem; color: var(--muted);">IP: ${ip}</div>
                    </div>
                    <div style="text-align: right; flex-shrink: 0; margin-left: 12px;">
                        <div style="font-size: 0.9rem;" class="${getTierTextClass(tier)}">${tier}</div>
                        <div style="font-size: 0.8rem;">⭐ ${points} pts</div>
                        <div style="font-size: 0.7rem;" class="${isEligible ? 'eligibility-eligible' : 'eligibility-not-eligible'}">
                            ${isEligible ? '✅ Eligible' : '❌ Not Eligible'}
                        </div>
                    </div>
                </div>
                <div style="margin-bottom: 8px;">
                    <div style="font-size: 0.9rem; margin-bottom: 4px;">Progress: ${progress}%</div>
                    ${progressBar}
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 0.8rem; color: var(--muted);">
                    <div>
                        <div><strong>Quests:</strong> ${totalQuests}</div>
                        <div><strong>Device:</strong> ${deviceType}</div>
                    </div>
                    <div>
                        <div><strong>Log ID:</strong> ${logId.substring(0, 8)}...</div>
                        <div><strong>Browser:</strong> ${userAgent.split(' ')[0] || 'Unknown'}</div>
                    </div>
                </div>
                ${eligibilityCriteria ? `
                    <div style="margin-top: 8px; font-size: 0.8rem;">
                        <div style="color: var(--muted); margin-bottom: 4px;"><strong>Eligibility Criteria:</strong></div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                            ${eligibilityCriteria}
                        </div>
                    </div>
                ` : ''}
                ${targetQuests.length > 0 ? `
                    <div style="margin-top: 8px; font-size: 0.8rem;">
                        <div style="color: var(--muted); margin-bottom: 4px;"><strong>Completed Quests (${totalQuests}):</strong></div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px; max-height: 120px; overflow-y: auto;">
                            ${targetQuests.map(quest =>
                `<span style="background: rgba(122, 162, 255, 0.2); padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; white-space: nowrap;">${quest}</span>`
            ).join('')}
                        </div>
                    </div>
                ` : ''}
            `;

            modalContent.appendChild(div);
        });

        // Add summary stats
        if (userStats.length > 1) {
            const summaryDiv = document.createElement('div');
            summaryDiv.className = 'card';
            summaryDiv.style.marginTop = '12px';
            summaryDiv.style.background = 'rgba(122, 162, 255, 0.1)';

            const firstStat = userStats[userStats.length - 1].data;
            const latestStat = userStats[0].data;

            const firstTier = firstStat?.tier ||
                firstStat?.stats?.userStats?.bucketName ||
                firstStat?.bucketName || '—';

            const latestTier = latestStat?.tier ||
                latestStat?.stats?.userStats?.bucketName ||
                latestStat?.bucketName || '—';

            // Get all unique quests across all entries
            const allQuests = new Set();
            userStats.forEach(statDoc => {
                const quests = statDoc.data?.stats?.userStats?.targetQuestsCompleted || [];
                quests.forEach(quest => allQuests.add(quest));
            });

            summaryDiv.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 8px;">📊 Summary</div>
                <div><strong>Started at:</strong> ${firstTier}</div>
                <div><strong>Current tier:</strong> ${latestTier}</div>
                <div><strong>Total requests:</strong> ${userStats.length}</div>
                <div><strong>First request:</strong> ${formatTs(firstStat?.timestamp)}</div>
                <div><strong>Latest request:</strong> ${formatTs(latestStat?.timestamp)}</div>
                <div style="margin-top: 8px;">
                    <div style="font-weight: bold; margin-bottom: 4px;">📋 Quest Summary</div>
                    <div><strong>Total unique quests completed:</strong> ${allQuests.size}</div>
                    <div style="margin-top: 8px;">
                        <div style="font-size: 0.9rem; margin-bottom: 4px;"><strong>All Unique Quests:</strong></div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px; max-height: 150px; overflow-y: auto;">
                            ${Array.from(allQuests).map(quest =>
                `<span style="background: rgba(122, 162, 255, 0.3); padding: 2px 6px; border-radius: 4px; font-size: 0.7rem;">${quest}</span>`
            ).join('')}
                        </div>
                    </div>
                </div>
            `;

            modalContent.appendChild(summaryDiv);
        }

    } catch (error) {
        modalContent.innerHTML = '<div class="muted">Error loading stats: ' + error.message + '</div>';
    }
}


// Access Code Generation Functions
function generateAccessCode(length = 8, prefix = '') {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = prefix;
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Firebase Authentication with fallback for both extension and web contexts
async function adminSignIn(email, password) {
    try {
        if (isExtensionContext()) {
            // Use Chrome extension background script
            const response = await chrome.runtime.sendMessage({
                type: 'FIREBASE_SIGN_IN',
                email: email,
                password: password
            });
            if (response.success) {
                return response.data;
            } else {
                throw new Error(response.error);
            }
        } else {
            // Fallback: Direct API call (may have CORS issues in some browsers)
            const res = await fetch(`${IDT_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, returnSecureToken: true })
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error?.message || 'Sign in failed');
            }

            return await res.json();
        }
    } catch (error) {
        throw error;
    }
}

async function createAccessCode(code) {
    if (!adminAuth.isAuthenticated) {
        throw new Error('Admin not authenticated');
    }

    const data = {
        code: code,
        enabled: true,
        usedByEmail: null,
        createdAt: new Date().toISOString(),
        createdBy: adminAuth.user.email
    };

    const success = await firestoreCreateDoc(`AccessCodes/${encodeURIComponent(code)}`, data, adminAuth.idToken);
    return success;
}

async function loadAccessCodes() {
    const docs = await firestoreGetCollection('AccessCodes', adminAuth.idToken);
    const codesList = document.getElementById('codesList');

    if (!codesList) return;

    if (docs.length === 0) {
        codesList.innerHTML = '<div class="muted">No access codes found</div>';
        return;
    }

    codesList.innerHTML = '';
    docs.forEach(doc => {
        const data = doc.data;
        const codeId = doc.id;
        const div = document.createElement('div');
        div.className = 'card';
        div.style.marginBottom = '8px';

        const status = data.usedByEmail ?
            `<span style="color: #ff5c5c;">Used by: ${data.usedByEmail}</span>` :
            `<span style="color: #2fbf71;">Available</span>`;

        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>${codeId}</strong><br>
                    <span class="muted">Created: ${formatTs(data.createdAt)}</span><br>
                    ${status}
                </div>
                <button onclick="copyToClipboard('${codeId}')" class="pill">Copy</button>
            </div>
        `;
        codesList.appendChild(div);
    });
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('Copied to clipboard!');
    }).catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('Copied to clipboard!');
    });
}

// Event Listeners
// View stats button clicks
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('view-stats-btn')) {
        const uid = e.target.dataset.uid;
        const email = e.target.dataset.email;
        loadUserStats(uid, email);
    }
});

// Close user stats modal
document.getElementById('closeUserStatsModal')?.addEventListener('click', () => {
    document.getElementById('userStatsModal').style.display = 'none';
});

// Close modal when clicking backdrop
document.getElementById('userStatsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'userStatsModal') {
        document.getElementById('userStatsModal').style.display = 'none';
    }
});

// Access Code Generation
document.getElementById('generateCodeBtn')?.addEventListener('click', () => {
    document.getElementById('codeModal').style.display = 'flex';
    document.getElementById('generateForm').style.display = 'block';
    document.getElementById('generatedCode').style.display = 'none';
});

document.getElementById('viewCodesBtn')?.addEventListener('click', () => {
    document.getElementById('viewCodesModal').style.display = 'flex';
    loadAccessCodes();
});

// Admin Authentication Event Listeners
document.getElementById('adminLoginBtn')?.addEventListener('click', () => {
    document.getElementById('adminLoginModal').style.display = 'flex';
    setAdminLoginMsg('');
});


document.getElementById('adminLoginSubmitBtn')?.addEventListener('click', async () => {
    const email = document.getElementById('adminEmail').value.trim();
    const password = document.getElementById('adminPassword').value;

    if (!email || !password) {
        setAdminLoginMsg('Please enter email and password', 'error');
        return;
    }

    try {
        setAdminLoginMsg('Signing in...', '');
        const resp = await adminSignIn(email, password);

        adminAuth = {
            isAuthenticated: true,
            idToken: resp.idToken,
            user: { uid: resp.localId, email: resp.email },
            tokenTimestamp: Date.now()
        };

        // Check if user is actually an admin
        const isAdminUser = await isAdmin(adminAuth.user.uid);

        if (!isAdminUser) {
            setAdminLoginMsg('User is not an admin. Please contact administrator.', 'error');
            adminAuth = { isAuthenticated: false, idToken: null, user: null };
            return;
        }

        // Save to storage for persistence
        await saveAdminAuth();

        setAdminLoginMsg('Signed in successfully', 'ok');
        document.getElementById('adminLoginModal').style.display = 'none';
        showAdminContent(true);
        loadUsers('');

    } catch (error) {
        setAdminLoginMsg(error.message || 'Sign in failed', 'error');
    }
});

document.getElementById('closeAdminLoginBtn')?.addEventListener('click', () => {
    document.getElementById('adminLoginModal').style.display = 'none';
    setAdminLoginMsg('');
});

document.getElementById('adminLogoutBtn')?.addEventListener('click', async () => {
    adminAuth = {
        isAuthenticated: false,
        idToken: null,
        user: null
    };

    // Clear from storage and cache
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove(['adminAuth']);
        }
    } catch (error) {
        // Silent error handling
    }

    localStorage.removeItem(ADMIN_SESSION_KEY);

    showAdminContent(false);
    setStatus('Please sign in to access admin features');
});

document.getElementById('generateBtn')?.addEventListener('click', async () => {
    const length = parseInt(document.getElementById('codeLength').value);
    const prefix = document.getElementById('codePrefix').value.trim();
    const code = generateAccessCode(length, prefix);

    try {
        const success = await createAccessCode(code);
        if (success) {
            document.getElementById('generateForm').style.display = 'none';
            document.getElementById('generatedCode').style.display = 'block';
            document.getElementById('newCode').textContent = code;
        } else {
            alert('Failed to create access code');
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
});

document.getElementById('copyCodeBtn')?.addEventListener('click', () => {
    const code = document.getElementById('newCode').textContent;
    copyToClipboard(code);
});

document.getElementById('cancelBtn')?.addEventListener('click', () => {
    document.getElementById('codeModal').style.display = 'none';
});

document.getElementById('closeModalBtn')?.addEventListener('click', () => {
    document.getElementById('codeModal').style.display = 'none';
});

document.getElementById('closeViewModalBtn')?.addEventListener('click', () => {
    document.getElementById('viewCodesModal').style.display = 'none';
});

// Close modals when clicking outside
document.getElementById('codeModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'codeModal') {
        document.getElementById('codeModal').style.display = 'none';
    }
});

document.getElementById('viewCodesModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'viewCodesModal') {
        document.getElementById('viewCodesModal').style.display = 'none';
    }
});

document.getElementById('adminLoginModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'adminLoginModal') {
        document.getElementById('adminLoginModal').style.display = 'none';
        setAdminLoginMsg('');
    }
});

// Initialize admin dashboard
async function initializeAdmin() {
    // Show context information
    const contextInfo = isExtensionContext() ?
        'Running in Chrome Extension context' :
        'Running in Web Browser context (may have CORS limitations)';

    if (adminInfo) {
        adminInfo.textContent = contextInfo;
    }

    await loadAdminAuth();
    // Only show login prompt if not already authenticated
    if (!adminAuth.isAuthenticated) {
        showAdminContent(false);
        setAdminLoginMsg('Please sign in to access admin features');
    }
}

initializeAdmin();


