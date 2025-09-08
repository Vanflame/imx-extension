// Firebase REST API (CSP-friendly for Chrome Extensions)
const firebaseConfig = {
    apiKey: "AIzaSyA0fUKA2kpoW9hHEWKcRqxjX-m-ZBFRpVM",
    projectId: "immutable-api"
};

const IDT_BASE = "https://identitytoolkit.googleapis.com/v1";
const FS_BASE = (path) => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents${path}`;

// Helper functions for Firestore data conversion (no longer needed with v9+ SDK)
// These functions are kept for backward compatibility with existing data structures

async function firestoreGetDoc(path, idToken = null) {
    try {
        const docRef = doc(db, path);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data();
        } else {
            return null;
        }
    } catch (error) {
        console.error('Error getting document:', error);
        return null;
    }
}

async function firestoreGetCollection(path, idToken = null) {
    try {
        const collectionRef = collection(db, path);
        const snapshot = await getDocs(collectionRef);
        const docs = [];
        snapshot.forEach((doc) => {
            docs.push({
                id: doc.id,
                data: doc.data()
            });
        });
        return docs;
    } catch (error) {
        console.error('Firestore collection error:', error);
        return [];
    }
}

async function firestoreCreateDoc(path, data, idToken = null) {
    try {
        const docRef = doc(db, path);
        await setDoc(docRef, data);
        return true;
    } catch (error) {
        console.error('Create document error:', error);
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
        console.log('Loading admin auth from cache...');

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
                console.log('Restored admin auth from cache:', adminAuth);
                showAdminContent(true);
                setAdminLoginMsg('Welcome back!', 'ok');
                loadUsers('');
                return true;
            } else {
                console.log('Cached session expired, clearing cache');
                localStorage.removeItem(ADMIN_SESSION_KEY);
            }
        }

        // Fallback to chrome storage if available
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                const stored = await chrome.storage.local.get(['adminAuth']);
                console.log('Stored admin auth:', stored.adminAuth);

                if (stored.adminAuth && stored.adminAuth.idToken) {
                    adminAuth = stored.adminAuth;
                    console.log('Restored admin auth from storage:', adminAuth);
                    showAdminContent(true);
                    setAdminLoginMsg('Welcome back!', 'ok');
                    loadUsers('');

                    // Update cache
                    updateAdminCache();
                    return true;
                }
            } catch (error) {
                console.error('Error loading from Chrome storage:', error);
            }
        }

        console.log('No stored admin auth found');
        return false;
    } catch (error) {
        console.error('Error loading admin auth:', error);
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
        console.log('Admin cache updated');
    } catch (error) {
        console.error('Error updating admin cache:', error);
    }
}

// Save admin auth to storage and cache
async function saveAdminAuth() {
    try {
        console.log('Saving admin auth to storage:', adminAuth);

        // Try Chrome storage first, fallback to localStorage
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ adminAuth });
            console.log('Admin auth saved to Chrome storage');
        } else {
            console.log('Chrome storage not available, using localStorage only');
        }

        updateAdminCache();
        console.log('Admin auth saved successfully');
    } catch (error) {
        console.error('Error saving admin auth:', error);
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
        console.log('Checking admin status for UID:', uid);
        const doc = await firestoreGetDoc(`Admins/${uid}`, adminAuth.idToken);
        console.log('Admin document:', doc);

        if (doc) {
            const data = doc;
            console.log('Admin data:', data);
            console.log('isAdmin field value:', data.isAdmin);
            console.log('isAdmin field type:', typeof data.isAdmin);
            const isAdmin = !!data.isAdmin;
            console.log('Is admin result:', isAdmin);
            return isAdmin;
        }
        console.log('No admin document found');
        return false;
    } catch (error) {
        console.error('Error checking admin status:', error);
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
        console.log('Fetching users from Firestore with admin token...');
        const docs = await firestoreGetCollection('Users', adminAuth.idToken);
        console.log('Users fetched:', docs.length);

        const items = [];

        for (const doc of docs) {
            const u = doc.data;
            const uid = doc.id; // Extract UID from document ID
            u.uid = uid;

            if (emailContains && !(u.email || '').toLowerCase().includes(emailContains.toLowerCase())) continue;

            // Try to get user stats
            let latestTier = '—', progress = '—', points = '—', lastAt = '—', entryCount = '0';

            try {
                // Get all stats for this user
                console.log('Fetching stats for user:', uid);
                const statsDocs = await firestoreGetCollection(`StatsHistory`, adminAuth.idToken);
                console.log('Total stats documents:', statsDocs.length);

                const userStats = statsDocs.filter(statDoc => {
                    const statData = statDoc.data;
                    return statData.userId === uid;
                });

                console.log('User stats found:', userStats.length, 'for user:', uid);

                if (userStats.length > 0) {
                    // Sort by timestamp and get latest
                    userStats.sort((a, b) => {
                        const aTime = a.data.timestamp;
                        const bTime = b.data.timestamp;
                        return new Date(bTime) - new Date(aTime);
                    });

                    const latestStat = userStats[0].data;
                    console.log('Latest stat for user:', uid, latestStat);

                    // Extract data from different possible structures
                    latestTier = latestStat?.stats?.userStats?.bucketName ||
                        latestStat?.bucketName ||
                        latestStat?.tier || '—';

                    const progressValue = latestStat?.progressPercentage ??
                        latestStat?.stats?.userStats?.progressPercentage ??
                        latestStat?.progress ?? '—';
                    progress = progressValue !== '—' ? progressValue + '%' : '—';

                    points = latestStat?.weeklyPoints ??
                        latestStat?.stats?.weeklyPoints ??
                        latestStat?.points ?? '—';

                    lastAt = formatTs(latestStat?.timestamp);
                    entryCount = userStats.length.toString();

                    console.log('User table data for', uid, ':', {
                        latestTier,
                        progress,
                        points,
                        lastAt,
                        entryCount,
                        rawTimestamp: latestStat?.timestamp,
                        timestampType: typeof latestStat?.timestamp
                    });
                } else {
                    console.log('No stats found for user:', uid);
                }
            } catch (statsError) {
                console.error('Could not load stats for user:', uid, statsError);
            }

            items.push({ uid: u.uid, email: u.email || '—', lastAt, latestTier, progress, points, entryCount });
        }

        // Sort users by email
        items.sort((a, b) => a.email.localeCompare(b.email));

        for (const it of items) {
            const tr = document.createElement('tr');
            const tierBadge = it.latestTier ? `<span class="tier-badge ${getTierClass(it.latestTier)}">${it.latestTier}</span>` : '—';
            const progressDisplay = it.progress ? `${it.progress}%` : '—';
            tr.innerHTML = `<td>${it.email}</td><td>${it.lastAt}</td><td>${tierBadge}</td><td>${progressDisplay}</td><td>${it.points || '—'}</td><td>${it.entryCount}</td><td><button class="btn view-stats-btn" data-uid="${it.uid}" data-email="${it.email}">View Stats</button></td>`;
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
        const statsDocs = await firestoreGetCollection(`StatsHistory`, adminAuth.idToken);
        const userStats = statsDocs.filter(statDoc => {
            const statData = statDoc.data;
            return statData.userId === uid;
        });

        console.log('Loading stats for user:', uid, 'Found:', userStats.length, 'entries');

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
        const latestTier = latestStat?.stats?.userStats?.bucketName ||
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
            <div style="margin-top: 8px;">
                <button onclick="console.log('Raw user stats data:', ${JSON.stringify(userStats.map(doc => fromFs(doc))).replace(/"/g, '&quot;')})" 
                        style="background: var(--accent); color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">
                    🔍 Debug Raw Data
                </button>
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

            // Extract stats data with better debugging
            console.log('Processing stat entry:', stat);

            const tier = stat?.stats?.userStats?.bucketName ||
                stat?.bucketName ||
                stat?.tier || '—';

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
                ${targetQuests.length > 0 ? `
                    <div style="margin-top: 8px; font-size: 0.8rem;">
                        <div style="color: var(--muted); margin-bottom: 4px;"><strong>Completed Quests:</strong></div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px; max-height: 60px; overflow-y: auto;">
                            ${targetQuests.slice(0, 3).map(quest =>
                `<span style="background: rgba(122, 162, 255, 0.2); padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; white-space: nowrap;">${quest}</span>`
            ).join('')}
                            ${targetQuests.length > 3 ? `<span style="color: var(--muted); font-size: 0.7rem;">+${targetQuests.length - 3} more</span>` : ''}
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

            const firstTier = firstStat?.stats?.userStats?.bucketName ||
                firstStat?.bucketName ||
                firstStat?.tier || '—';

            const latestTier = latestStat?.stats?.userStats?.bucketName ||
                latestStat?.bucketName ||
                latestStat?.tier || '—';

            summaryDiv.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 8px;">📊 Summary</div>
                <div><strong>Started at:</strong> ${firstTier}</div>
                <div><strong>Current tier:</strong> ${latestTier}</div>
                <div><strong>Total requests:</strong> ${userStats.length}</div>
                <div><strong>First request:</strong> ${formatTs(firstStat?.timestamp)}</div>
                <div><strong>Latest request:</strong> ${formatTs(latestStat?.timestamp)}</div>
            `;

            modalContent.appendChild(summaryDiv);
        }

    } catch (error) {
        console.error('Error loading user stats:', error);
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

// Firebase Authentication using REST API
async function adminSignIn(email, password) {
    try {
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

        console.log('Admin signed in:', adminAuth.user);
        console.log('Checking admin status...');

        // Check if user is actually an admin
        const isAdminUser = await isAdmin(adminAuth.user.uid);
        console.log('Is admin user:', isAdminUser);

        // Temporary bypass for testing - remove this in production
        const isTestAdmin = adminAuth.user.email === 'admin@immutable.com' ||
            adminAuth.user.email.includes('admin');

        if (!isAdminUser && !isTestAdmin) {
            setAdminLoginMsg('User is not an admin. Please contact administrator.', 'error');
            adminAuth = { isAuthenticated: false, idToken: null, user: null };
            return;
        }

        if (isTestAdmin && !isAdminUser) {
            console.log('Using test admin bypass for:', adminAuth.user.email);
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
        console.error('Error clearing Chrome storage:', error);
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
    await loadAdminAuth();
    // Only show login prompt if not already authenticated
    if (!adminAuth.isAuthenticated) {
        showAdminContent(false);
        setAdminLoginMsg('Please sign in to access admin features');
    }
}

initializeAdmin();


