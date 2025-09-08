// Firebase Auth + Firestore using REST API (CSP-friendly for Chrome Extensions)

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyA0fUKA2kpoW9hHEWKcRqxjX-m-ZBFRpVM",
    projectId: "immutable-api"
};

// Test Firebase configuration function
async function testFirebaseConfig() {
    try {
        console.log('🔍 Testing Firebase configuration...');

        // Test 1: Check if API key is valid
        const testUrl = `${IDT_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const testBody = { email: 'test@example.com', password: 'test123', returnSecureToken: true };

        console.log('Testing API key with URL:', testUrl);
        const response = await fetch(testUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testBody)
        });

        console.log('Firebase test response status:', response.status);

        if (response.status === 400) {
            const errorData = await response.json();
            console.log('Firebase test error:', errorData);

            if (errorData.error?.message === 'CONFIGURATION_NOT_FOUND') {
                console.error('❌ CONFIGURATION_NOT_FOUND - Firebase project configuration is invalid');
                console.error('Please check:');
                console.error('1. Firebase project ID:', firebaseConfig.projectId);
                console.error('2. API key:', firebaseConfig.apiKey);
                console.error('3. Make sure the project exists in Firebase console');
                console.error('4. Make sure Firebase Authentication is enabled');
                console.error('5. Make sure your domain is added to authorized domains');
                return { valid: false, error: 'CONFIGURATION_NOT_FOUND', details: errorData };
            }

            if (errorData.error?.message?.includes('INVALID_LOGIN_CREDENTIALS') ||
                errorData.error?.message?.includes('EMAIL_NOT_FOUND')) {
                console.log('✅ Firebase project configuration is valid (got expected auth error)');
                return { valid: true, message: 'Configuration is valid' };
            }
        } else if (response.status === 200) {
            console.log('✅ Firebase configuration is valid');
            return { valid: true, message: 'Configuration is valid' };
        } else {
            console.log('⚠️ Unexpected response:', response.status);
            return { valid: false, error: 'Unexpected response', status: response.status };
        }
    } catch (error) {
        console.error('❌ Firebase configuration test failed:', error);
        return { valid: false, error: error.message };
    }
}

const IDT_BASE = "https://identitytoolkit.googleapis.com/v1";
const FS_BASE = (path) => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents${path}`;

const $ = (id) => document.getElementById(id);
const msg = (text, kind) => { const el = $("msg"); if (!el) return; el.textContent = text || ""; el.className = `msg ${kind || ""}`; };

// Rate limiting to prevent Firebase quota exhaustion
const RATE_LIMIT = {
    lastCall: 0,
    minInterval: 2000, // 2 seconds between calls
    isLimited: false
};

function checkRateLimit() {
    const now = Date.now();
    const timeSinceLastCall = now - RATE_LIMIT.lastCall;

    if (timeSinceLastCall < RATE_LIMIT.minInterval) {
        const waitTime = RATE_LIMIT.minInterval - timeSinceLastCall;
        console.log(`Rate limiting: waiting ${waitTime}ms before next Firebase call`);
        return false;
    }

    RATE_LIMIT.lastCall = now;
    return true;
}

function setRateLimitStatus(limited) {
    RATE_LIMIT.isLimited = limited;
    if (limited) {
        console.warn('Firebase rate limit active - reducing API calls');
    }
}

// Detect Firebase quota errors and provide helpful information
function handleFirebaseQuotaError(error) {
    const errorMessage = error.message || error.toString();

    if (errorMessage.includes('quota') || errorMessage.includes('Quota') ||
        errorMessage.includes('exceeded') || errorMessage.includes('limit')) {

        console.error('Firebase quota exceeded!', errorMessage);

        // Show helpful message to user
        msg('Firebase quota exceeded. Please wait or upgrade your Firebase plan. Debug tools disabled to save quota.', 'error');

        // Disable all debug buttons
        const debugButtons = document.querySelectorAll('#debugSection button');
        debugButtons.forEach(btn => {
            if (btn.id !== 'btnClearStorage') { // Keep clear storage enabled
                btn.disabled = true;
                btn.title = 'Disabled due to Firebase quota limit';
                btn.style.opacity = '0.5';
            }
        });

        // Show quota warning
        const quotaWarning = document.getElementById('quotaWarning');
        if (quotaWarning) {
            quotaWarning.style.display = 'block';
            quotaWarning.innerHTML = '🚫 <strong>Firebase Quota Exceeded:</strong> You have reached your Firebase quota limit. Please wait or upgrade your plan.';
            quotaWarning.style.background = '#f8d7da';
            quotaWarning.style.borderColor = '#f5c6cb';
            quotaWarning.style.color = '#721c24';
        }

        return true;
    }
    return false;
}

async function saveChromeStorage(obj) {
    return new Promise((resolve, reject) => {
        if (!chrome?.storage?.local) {
            console.warn('Chrome storage not available, using localStorage fallback');
            try {
                localStorage.setItem('firebaseUser', JSON.stringify(obj.firebaseUser || null));
                localStorage.setItem('firebaseIdToken', obj.firebaseIdToken || '');
                localStorage.setItem('accessGranted', obj.accessGranted || false);
                resolve();
            } catch (error) {
                reject(error);
            }
            return;
        }

        chrome.storage.local.set(obj, () => {
            if (chrome.runtime.lastError) {
                console.error('Chrome storage error:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                console.log('Chrome storage saved successfully');
                resolve();
            }
        });
    });
}

async function getChromeStorage(keys) {
    return new Promise((resolve, reject) => {
        if (!chrome?.storage?.local) {
            console.warn('Chrome storage not available, using localStorage fallback');
            try {
                const result = {};
                if (keys.includes('firebaseUser')) {
                    const user = localStorage.getItem('firebaseUser');
                    result.firebaseUser = user ? JSON.parse(user) : null;
                }
                if (keys.includes('firebaseIdToken')) {
                    result.firebaseIdToken = localStorage.getItem('firebaseIdToken') || null;
                }
                if (keys.includes('accessGranted')) {
                    result.accessGranted = localStorage.getItem('accessGranted') === 'true';
                }
                resolve(result);
            } catch (error) {
                reject(error);
            }
            return;
        }

        chrome.storage.local.get(keys, (result) => {
            if (chrome.runtime.lastError) {
                console.error('Chrome storage error:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                resolve(result);
            }
        });
    });
}

function updateUi(user) {
    const userBox = $("userBox");
    const authForms = $("authForms");
    const signedIn = $("signedInActions");
    if (user) {
        if (userBox) userBox.textContent = `Signed in as ${user.email} (${user.uid})`;
        if (authForms) authForms.style.display = 'none';
        if (signedIn) signedIn.style.display = 'block';
    } else {
        if (userBox) userBox.textContent = 'Not signed in';
        if (authForms) authForms.style.display = 'block';
        if (signedIn) signedIn.style.display = 'none';
    }
}

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

async function firestoreGetDoc(path, idToken) {
    try {
        const res = await fetch(`${FS_BASE(path)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
            headers: idToken ? { 'Authorization': `Bearer ${idToken}` } : undefined
        });
        if (!res.ok) return null; return await res.json();
    } catch { return null; }
}

// Public read function for access codes (no authentication required)
async function firestoreGetDocPublic(path) {
    try {
        const res = await fetch(`${FS_BASE(path)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`);
        if (!res.ok) {
            if (res.status === 404) return null; // Document doesn't exist
            throw new Error(`Firestore GET failed: ${res.status}`);
        }
        return await res.json();
    } catch (error) {
        console.error('Error in firestoreGetDocPublic:', error);
        return null;
    }
}

async function firestoreSetUser(uid, email, idToken) {
    const url = `${FS_BASE('/Users/' + encodeURIComponent(uid))}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
    const body = { fields: { uid: fsValue(uid), email: fsValue(email), updatedAt: { timestampValue: new Date().toISOString() } } };
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
}

async function firestoreUpdateDoc(path, data, idToken) {
    try {
        const url = `${FS_BASE(path)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const body = { fields: {} };

        // Convert data to Firestore format
        Object.keys(data).forEach(key => {
            body.fields[key] = fsValue(data[key]);
        });

        const headers = { 'Content-Type': 'application/json' };
        if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

        console.log('Updating document:', url, body);
        const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
        console.log('Update response status:', res.status);

        if (!res.ok) {
            const errorText = await res.text();
            console.error('Update failed:', res.status, errorText);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error updating document:', error);
        return false;
    }
}

// Check if user already exists using Firebase Auth
async function checkUserExists(email) {
    try {
        console.log('Checking if user exists:', email);

        // Try to sign in with a dummy password to check if user exists
        try {
            const res = await fetch(`${IDT_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password: 'dummy-password-check', returnSecureToken: true })
            });

            console.log('Firebase response status:', res.status);

            if (res.ok) {
                // If this succeeds, user exists (but password is wrong)
                console.log('User exists (sign in succeeded with dummy password)');
                return true;
            }

            // Get the actual error response
            const errorData = await res.json();
            console.log('Firebase error response:', errorData);

            const errorCode = errorData.error?.message || '';
            console.log('Error code:', errorCode);

            // Check specific Firebase error codes for user existence
            if (errorCode.includes('INVALID_PASSWORD') ||
                errorCode.includes('invalid-password') ||
                errorCode.includes('wrong-password')) {
                console.log('User exists but password is wrong');
                return true;
            }

            // Check specific Firebase error codes for user NOT existing
            if (errorCode.includes('EMAIL_NOT_FOUND') ||
                errorCode.includes('user-not-found') ||
                errorCode.includes('INVALID_LOGIN_CREDENTIALS') ||
                errorCode.includes('invalid-email') ||
                errorCode.includes('INVALID_EMAIL')) {
                console.log('User does not exist');
                return false;
            }

            // For other errors, be more conservative and assume user doesn't exist
            // This prevents false positives that would block legitimate registrations
            console.log('Unknown error, assuming user does not exist to allow registration:', errorCode);
            return false;

        } catch (fetchError) {
            console.error('Fetch error during user check:', fetchError);
            // If we can't check, assume user doesn't exist to allow registration
            return false;
        }

    } catch (error) {
        console.error('Error checking user existence:', error);
        // If check fails, assume user doesn't exist to allow registration
        return false;
    }
}

async function getAccessConfig(idToken) {
    // Fallback global gate (optional)
    const doc = await firestoreGetDoc('/Config/auth', idToken);
    if (!doc) return { enabled: false };
    const data = fromFs(doc);
    return { enabled: !!data.enabled, code: data.code || '' };
}

// Validate access code BEFORE Firebase signup (no authentication required)
async function validateAccessCodeBeforeSignup(code) {
    console.log('Validating access code before signup:', code);

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
        console.log('Access code is empty or invalid');
        return false;
    }

    try {
        // Check if the access code exists and is available (no auth required for read)
        const accessDoc = await firestoreGetDocPublic(`/AccessCodes/${code.trim()}`);
        console.log('Access code document:', accessDoc);

        if (!accessDoc) {
            console.log('Access code document not found');
            return false;
        }

        const data = fromFs(accessDoc);
        console.log('Access code data:', data);

        // Check if code is disabled
        if (data.enabled === false) {
            console.log('Access code is disabled');
            return false;
        }

        // Check if code is already used
        if (data.usedByEmail && data.usedByEmail.trim() !== '') {
            console.log('Access code already used by:', data.usedByEmail);
            return false;
        }

        console.log('Access code is valid and available');
        return true;

    } catch (error) {
        console.error('Error validating access code:', error);
        return false;
    }
}

// Bind access code to user AFTER successful Firebase signup
async function bindAccessCodeToUser(code, email, idToken) {
    console.log('Binding access code to user:', code, email);

    try {
        // Bind the access code to this user
        const bindResult = await firestoreUpdateDoc(`/AccessCodes/${code}`, { usedByEmail: email }, idToken);
        console.log('Bind result:', bindResult);

        if (!bindResult) {
            console.log('Failed to bind access code');
            return false;
        }

        // Verify the binding was successful
        const verifyDoc = await firestoreGetDoc(`/AccessCodes/${code}`, idToken);
        const verifyData = fromFs(verifyDoc);
        console.log('Verification data:', verifyData);

        if (verifyData.usedByEmail !== email) {
            console.log('Access code binding verification failed');
            return false;
        }

        console.log('Access code successfully bound to user');
        return true;

    } catch (error) {
        console.error('Error binding access code:', error);
        return false;
    }
}

async function ensureAccessAllowed(email, idToken) {
    const codeEl = document.getElementById('access');
    const code = codeEl ? codeEl.value.trim() : '';
    if (!code) { msg('Access code required', 'error'); return false; }

    console.log('Checking access code:', code, 'for email:', email);

    // Try to get the access code document
    const acDoc = await firestoreGetDoc('/AccessCodes/' + encodeURIComponent(code), idToken);
    console.log('Access code document:', acDoc);

    if (acDoc) {
        const data = fromFs(acDoc) || {};
        console.log('Access code data:', data);

        // Check if code is disabled
        if (data.enabled === false) {
            msg('Access code disabled', 'error');
            return false;
        }

        // FORCE CHECK: If usedByEmail exists and is not null/empty, reject
        if (data.usedByEmail && data.usedByEmail.trim() !== '') {
            console.log('Access code already used by:', data.usedByEmail);
            msg('Access code already used by another account', 'error');
            return false;
        }

        // Try to bind the code to this email using the new SDK
        console.log('Attempting to bind access code to email:', email);

        try {
            const updateData = {
                enabled: true,
                usedByEmail: email,
                usedAt: new Date(),
                boundAt: new Date()
            };

            const updateResult = await firestoreUpdateDoc('AccessCodes/' + encodeURIComponent(code), updateData, idToken);
            console.log('Access code binding result:', updateResult);

            if (!updateResult) {
                console.error('Binding failed');
                msg('Failed to bind access code', 'error');
                return false;
            }

            // Verify the binding worked by reading the document again
            const verifyDoc = await firestoreGetDoc('/AccessCodes/' + encodeURIComponent(code), idToken);
            const verifyData = fromFs(verifyDoc) || {};
            console.log('Verification - bound to:', verifyData.usedByEmail);

            if (verifyData.usedByEmail !== email) {
                msg('Access code binding failed', 'error');
                return false;
            }

            await saveChromeStorage({ accessGranted: true, accessGrantedAt: Date.now(), accessCode: code });
            return true;
        } catch (error) {
            console.error('Error binding access code:', error);
            msg('Error binding access code', 'error');
            return false;
        }
    } else {
        // Access code document doesn't exist, create it and bind to this email
        console.log('Access code document does not exist, creating and binding to:', email);

        try {
            const newDocData = {
                code: code,
                enabled: true,
                usedByEmail: email,
                usedAt: new Date(),
                boundAt: new Date(),
                createdAt: new Date()
            };

            const createResult = await firestoreUpdateDoc('/AccessCodes/' + encodeURIComponent(code), newDocData, idToken);
            console.log('Access code creation result:', createResult);

            if (!createResult) {
                console.error('Creation failed');
                msg('Failed to create access code', 'error');
                return false;
            }

            await saveChromeStorage({ accessGranted: true, accessGrantedAt: Date.now(), accessCode: code });
            return true;
        } catch (error) {
            console.error('Error creating access code:', error);
            msg('Error creating access code', 'error');
            return false;
        }
    }

    // Fallback to global config if defined
    console.log('Checking global config fallback...');
    const cfg = await getAccessConfig(idToken);
    console.log('Global config:', cfg);

    if (cfg.enabled && cfg.code === code) {
        console.log('Using global config access code');
        await saveChromeStorage({ accessGranted: true, accessGrantedAt: Date.now(), accessCode: code });
        return true;
    }

    console.log('Access code validation failed - no valid code found');
    msg('Invalid access code', 'error');
    return false;
}

async function authSignIn(email, password) {
    console.log('=== FIREBASE SIGN IN REQUEST ===');
    console.log('Email validation:', {
        email: email,
        emailType: typeof email,
        emailLength: email?.length,
        isValidEmail: isValidEmail(email)
    });
    console.log('Password validation:', {
        passwordLength: password?.length,
        passwordType: typeof password,
        hasPassword: !!password
    });

    // Validate request data before sending
    if (!email || !password) {
        throw new Error('Email and password are required');
    }

    if (!isValidEmail(email)) {
        throw new Error('Invalid email format');
    }

    if (password.length < 6) {
        throw new Error('Password must be at least 6 characters');
    }

    // Check rate limit to prevent quota exhaustion
    if (!checkRateLimit()) {
        throw new Error('Please wait a moment before trying again (rate limited to prevent quota exhaustion)');
    }

    // Check if we're in extension context
    const isExtensionContext = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
    console.log('Making Firebase request from extension context:', isExtensionContext);

    if (isExtensionContext) {
        // Use background script to bypass CORS issues
        console.log('Using background script for Firebase authentication');
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'FIREBASE_SIGN_IN',
                email: email,
                password: password
            });

            if (response.success) {
                console.log('Background Firebase sign in successful');
                return response.data;
            } else {
                throw new Error(response.error);
            }
        } catch (error) {
            console.error('Background Firebase sign in error:', error);
            if (handleFirebaseQuotaError(error)) {
                return; // Quota error handled
            }
            throw error;
        }
    } else {
        // Direct Firebase request for non-extension context
        const url = `${IDT_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const requestBody = { email, password, returnSecureToken: true };

        console.log('Request URL:', url);
        console.log('Request body:', requestBody);
        console.log('Firebase config:', { apiKey: firebaseConfig.apiKey, projectId: firebaseConfig.projectId });
        console.log('Request headers:', { 'Content-Type': 'application/json' });
        console.log('Request URL accessible:', url);

        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
        } catch (fetchError) {
            console.error('Fetch error (likely CORS):', fetchError);
            if (handleFirebaseQuotaError(fetchError)) {
                return; // Quota error handled
            }
            if (fetchError.name === 'TypeError' && fetchError.message.includes('Failed to fetch')) {
                throw new Error('Network error: Firebase API may be blocking requests from Chrome extension. Please check Firebase console settings.');
            }
            throw fetchError;
        }

        console.log('=== FIREBASE RESPONSE ===');
        console.log('Response status:', res.status);
        console.log('Response status text:', res.statusText);
        console.log('Response headers:', Object.fromEntries(res.headers.entries()));

        if (!res.ok) {
            // Get detailed error information
            try {
                // First get the raw response text for debugging
                const responseText = await res.text();
                console.log('=== FIREBASE ERROR RESPONSE ===');
                console.log('Raw response text:', responseText);
                console.log('Request that failed:', { url, requestBody });

                // Try to parse as JSON
                let errorData;
                try {
                    errorData = JSON.parse(responseText);
                } catch (parseError) {
                    console.error('Failed to parse error response as JSON:', parseError);
                    throw new Error(`Sign in failed (${res.status}): ${responseText}`);
                }

                console.log('Full error data:', errorData);
                console.log('Error object:', errorData.error);
                console.log('Error message:', errorData.error?.message);
                console.log('Error code:', errorData.error?.code);
                console.log('Error details:', errorData.error?.details);

                const errorCode = errorData.error?.message || '';
                console.log('Extracted error code:', errorCode);

                // Check for quota errors first
                if (errorCode.includes('quota') || errorCode.includes('Quota') ||
                    errorCode.includes('exceeded') || errorCode.includes('limit')) {
                    const quotaError = new Error(`Firebase quota exceeded: ${errorCode}`);
                    handleFirebaseQuotaError(quotaError);
                    return; // Quota error handled
                }

                // Provide more specific error messages
                if (errorCode.includes('INVALID_PASSWORD') || errorCode.includes('invalid-password')) {
                    throw new Error('Invalid password. Please check your password and try again.');
                } else if (errorCode.includes('EMAIL_NOT_FOUND') || errorCode.includes('user-not-found')) {
                    throw new Error('No account found with this email. Please register first.');
                } else if (errorCode.includes('USER_DISABLED') || errorCode.includes('user-disabled')) {
                    throw new Error('This account has been disabled. Please contact support.');
                } else if (errorCode.includes('TOO_MANY_ATTEMPTS_TRY_LATER') || errorCode.includes('too-many-requests')) {
                    throw new Error('⚠️ Too many failed attempts. Firebase has temporarily blocked requests. Please wait 15-30 minutes before trying again.');
                } else if (errorCode.includes('INVALID_EMAIL') || errorCode.includes('invalid-email')) {
                    throw new Error('Invalid email format. Please check your email address.');
                } else if (errorCode.includes('OPERATION_NOT_ALLOWED') || errorCode.includes('operation-not-allowed')) {
                    throw new Error('Email/password authentication is disabled. Please contact support.');
                } else if (errorCode.includes('API_KEY_NOT_VALID') || errorCode.includes('INVALID_API_KEY')) {
                    throw new Error('Firebase API key is invalid. Please check configuration.');
                } else if (errorCode.includes('PROJECT_NOT_FOUND')) {
                    throw new Error('Firebase project not found. Please check project configuration.');
                } else if (errorCode.includes('INVALID_LOGIN_CREDENTIALS') || errorCode.includes('invalid-login-credentials')) {
                    throw new Error('Invalid login credentials. Please check your email and password.');
                } else if (errorCode.includes('MISSING_PASSWORD') || errorCode.includes('missing-password')) {
                    throw new Error('Password is required.');
                } else if (errorCode.includes('MISSING_EMAIL') || errorCode.includes('missing-email')) {
                    throw new Error('Email is required.');
                } else if (errorCode.includes('WEAK_PASSWORD') || errorCode.includes('weak-password')) {
                    throw new Error('Password is too weak. Please choose a stronger password.');
                } else if (errorCode.includes('EMAIL_EXISTS') || errorCode.includes('email-already-in-use')) {
                    throw new Error('An account with this email already exists. Please sign in instead.');
                } else {
                    // Generic error with the actual Firebase error code
                    throw new Error(`Sign in failed: ${errorCode || `HTTP ${res.status}`}`);
                }
            } catch (parseError) {
                console.error('Error parsing Firebase response:', parseError);
                throw new Error(`Sign in failed (${res.status})`);
            }
        }

        return res.json();
    }
}

async function authSignUp(email, password) {
    console.log('=== FIREBASE SIGN UP REQUEST ===');
    console.log('Email:', email);
    console.log('Password length:', password?.length);

    // Check rate limit to prevent quota exhaustion
    if (!checkRateLimit()) {
        throw new Error('Please wait a moment before trying again (rate limited to prevent quota exhaustion)');
    }

    // Check if we're in extension context
    const isExtensionContext = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
    console.log('Making Firebase signup from extension context:', isExtensionContext);

    if (isExtensionContext) {
        // Use background script to bypass CORS issues
        console.log('Using background script for Firebase signup');
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'FIREBASE_SIGN_UP',
                email: email,
                password: password
            });

            if (response.success) {
                console.log('Background Firebase signup successful');
                return response.data;
            } else {
                throw new Error(response.error);
            }
        } catch (error) {
            console.error('Background Firebase signup error:', error);
            throw error;
        }
    } else {
        // Direct Firebase request for non-extension context
        const url = `${IDT_BASE}/accounts:signUp?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const requestBody = { email, password, returnSecureToken: true };

        console.log('Firebase signup request URL:', url);
        console.log('Firebase signup request body:', requestBody);

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        console.log('Firebase signup response status:', res.status);

        if (!res.ok) {
            // Get detailed error information
            try {
                const errorData = await res.json();
                console.log('Firebase signup error response:', errorData);

                const errorCode = errorData.error?.message || '';
                console.log('Firebase signup error code:', errorCode);

                // Provide more specific error messages
                if (errorCode.includes('EMAIL_EXISTS') || errorCode.includes('email-already-in-use')) {
                    throw new Error('An account with this email already exists. Please sign in instead.');
                } else if (errorCode.includes('INVALID_EMAIL') || errorCode.includes('invalid-email')) {
                    throw new Error('Please enter a valid email address.');
                } else if (errorCode.includes('WEAK_PASSWORD') || errorCode.includes('weak-password')) {
                    throw new Error('Password is too weak. Please choose a stronger password.');
                } else if (errorCode.includes('OPERATION_NOT_ALLOWED') || errorCode.includes('operation-not-allowed')) {
                    throw new Error('Email/password accounts are not enabled. Please contact support.');
                } else {
                    // Generic error with the actual Firebase error code
                    throw new Error(`Registration failed: ${errorCode || `HTTP ${res.status}`}`);
                }
            } catch (parseError) {
                console.error('Error parsing Firebase response:', parseError);
                throw new Error(`Registration failed (${res.status})`);
            }
        }

        return res.json();
    }
}

async function bootstrapUiFromStorage() {
    try {
        // Add timeout to prevent hanging
        const storagePromise = getChromeStorage(['firebaseUser']);
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Storage timeout')), 3000)
        );

        const data = await Promise.race([storagePromise, timeoutPromise]);
        const user = data && data.firebaseUser ? data.firebaseUser : null;
        updateUi(user);
    } catch (error) {
        console.error('Error loading user from storage:', error);
        // Fallback to localStorage if Chrome storage fails
        try {
            const userStr = localStorage.getItem('firebaseUser');
            const user = userStr ? JSON.parse(userStr) : null;
            updateUi(user);
        } catch (localError) {
            console.error('Error loading from localStorage:', localError);
            updateUi(null);
        }
    }
}

async function handleLogin() {
    try {
        console.log('=== LOGIN ATTEMPT STARTED ===');
        msg('Signing in...', '');

        const emailEl = $("email");
        const passwordEl = $("password");

        if (!emailEl || !passwordEl) {
            console.error('Login form elements not found');
            msg('Login form error. Please refresh the page.', 'error');
            return;
        }

        const email = emailEl.value.trim();
        const password = passwordEl.value;

        console.log('Login form data:', {
            email: email,
            passwordLength: password ? password.length : 0,
            emailElement: emailEl ? 'found' : 'missing',
            passwordElement: passwordEl ? 'found' : 'missing'
        });

        // Validate input
        if (!email || !password) {
            console.log('Missing email or password');
            msg('Please enter both email and password', 'error');
            return;
        }

        // Validate email format
        if (!isValidEmail(email)) {
            console.log('Invalid email format:', email);
            emailEl.classList.add('error');
            msg('Please enter a valid email address', 'error');
            emailEl.focus();
            return;
        } else {
            emailEl.classList.remove('error');
        }

        // Validate password
        if (!isValidPassword(password)) {
            console.log('Invalid password length:', password.length);
            passwordEl.classList.add('error');
            msg('Password must be at least 6 characters long', 'error');
            passwordEl.focus();
            return;
        } else {
            passwordEl.classList.remove('error');
        }

        console.log('Validation passed, attempting sign in...');
        const resp = await authSignIn(email, password);
        console.log('authSignIn response received:', resp);
        console.log('Firebase sign in successful, proceeding to save user data...');

        const user = { uid: resp.localId, email: resp.email };

        // No access-code required on login; user must have registered previously
        const storageData = { firebaseUser: user, firebaseIdToken: resp.idToken, accessGranted: true };
        console.log('Saving to Chrome storage:', storageData);

        try {
            // Add timeout to prevent hanging
            const storagePromise = saveChromeStorage(storageData);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Storage timeout')), 5000)
            );

            await Promise.race([storagePromise, timeoutPromise]);
            console.log('Chrome storage save successful');

            // Verify the data was saved
            const savedData = await getChromeStorage(['firebaseUser', 'accessGranted']);
            console.log('Verified saved data:', savedData);
        } catch (storageError) {
            console.error('Chrome storage error:', storageError);
            msg('Warning: Could not save login state. You may need to sign in again.', 'warn');
            // Continue with login even if storage fails
        }

        try {
            await firestoreSetUser(user.uid, user.email, resp.idToken);
        } catch (firestoreError) {
            console.error('Firestore update error:', firestoreError);
            // Continue anyway, this is not critical for login
        }

        updateUi(user);
        msg('Signed in successfully', 'ok');
        showModal('Signed in successfully. You can now use the extension popup.');

    } catch (e) {
        console.error('Login error:', e);
        msg(e?.message || 'Sign in failed', 'error');
    }
}

async function handleRegister() {
    try {
        msg('Creating account...', '');

        const emailEl = $("regEmail");
        const passwordEl = $("regPassword");
        const codeEl = $("accessCode");

        if (!emailEl || !passwordEl || !codeEl) {
            console.error('Registration form elements not found');
            msg('Registration form error. Please refresh the page.', 'error');
            return;
        }

        const email = emailEl.value.trim();
        const password = passwordEl.value;
        const code = codeEl.value.trim();

        // Validate input
        if (!email || !password) {
            msg('Please enter both email and password', 'error');
            return;
        }
        if (!code) {
            msg('Access code is required for registration', 'error');
            codeEl.focus();
            return;
        }

        // Validate email format
        if (!isValidEmail(email)) {
            emailEl.classList.add('error');
            msg('Please enter a valid email address', 'error');
            emailEl.focus();
            return;
        } else {
            emailEl.classList.remove('error');
        }

        // Validate password
        if (!isValidPassword(password)) {
            passwordEl.classList.add('error');
            msg('Password must be at least 6 characters long', 'error');
            passwordEl.focus();
            return;
        } else {
            passwordEl.classList.remove('error');
        }

        console.log('Starting registration for:', email);

        // FIRST: Validate access code BEFORE any Firebase operations
        console.log('Validating access code before Firebase signup...');
        const accessCodeValid = await validateAccessCodeBeforeSignup(code);
        console.log('Access code validation result:', accessCodeValid);

        if (!accessCodeValid) {
            msg('Access denied: invalid or already used access code', 'error');
            codeEl.focus();
            return;
        }

        console.log('Access code valid, proceeding with Firebase signup...');

        let resp, user;
        try {
            resp = await authSignUp(email, password);
            user = { uid: resp.localId, email: resp.email };
            console.log('Firebase signup successful, binding access code...');

            // Bind the access code to this user
            const accessBound = await bindAccessCodeToUser(code, email, resp.idToken);
            console.log('Access code binding result:', accessBound);

            if (!accessBound) {
                // If binding fails, we should clean up the Firebase user
                console.error('Access code binding failed, user account created but not properly authorized');
                msg('Registration failed: could not bind access code', 'error');
                return;
            }
        } catch (signupError) {
            console.error('Firebase signup error:', signupError);

            // Try to get more detailed error information
            let errorMessage = signupError.message || '';
            let isDuplicateUser = false;

            // Check if it's a duplicate user error
            if (errorMessage.includes('EMAIL_EXISTS') ||
                errorMessage.includes('email-already-in-use') ||
                errorMessage.includes('already-in-use')) {

                console.log('Detected duplicate user error:', errorMessage);
                isDuplicateUser = true;
            }

            if (isDuplicateUser) {
                // Show warning message
                msg('⚠️ Account already exists! Redirecting to sign in...', 'warn');

                // Show a more prominent warning
                showUserExistsWarning(email);
                return;
            }

            // Re-throw other errors
            throw signupError;
        }

        try {
            // Add timeout to prevent hanging
            const storagePromise = saveChromeStorage({ firebaseUser: user, firebaseIdToken: resp.idToken, accessGranted: true });
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Storage timeout')), 5000)
            );

            await Promise.race([storagePromise, timeoutPromise]);
            console.log('Registration: Chrome storage save successful');
        } catch (storageError) {
            console.error('Registration: Chrome storage error:', storageError);
            msg('Warning: Could not save registration state. You may need to sign in again.', 'warn');
            // Continue with registration even if storage fails
        }

        try {
            await firestoreSetUser(user.uid, user.email, resp.idToken);
            console.log('Registration: Firestore user document updated');
        } catch (firestoreError) {
            console.error('Registration: Firestore update error:', firestoreError);
            // Continue anyway, this is not critical for registration
        }

        updateUi(user);
        msg('Account created successfully', 'ok');
        showModal('Account created successfully. You can now use the extension popup.');
    } catch (e) {
        console.error('Registration error:', e);
        msg(e?.message || 'Registration failed', 'error');
    }
}

async function handleSignOut() {
    try {
        console.log('Signing out user...');

        // Add timeout to prevent hanging
        const storagePromise = saveChromeStorage({ firebaseUser: null, firebaseIdToken: null, accessGranted: false });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Storage timeout')), 5000)
        );

        await Promise.race([storagePromise, timeoutPromise]);
        console.log('Sign out: Chrome storage cleared');
        updateUi(null);
        msg('Signed out', 'ok');
    } catch (e) {
        console.error('Sign out error:', e);
        // Even if storage fails, update UI and show success
        updateUi(null);
        msg('Signed out (storage warning)', 'warn');
    }
}

// Validate email format
function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
}

// Validate password strength
function isValidPassword(password) {
    if (!password || typeof password !== 'string') return false;
    return password.length >= 6;
}

// Hide access code field for login, show for registration
function toggleAccessCodeVisibility(isLogin) {
    const accessGroup = document.getElementById('accessCodeGroup');
    if (accessGroup) {
        accessGroup.style.display = isLogin ? 'none' : 'block';
    }
}

// Modal helpers
function showModal(text) {
    const m = document.getElementById('modal');
    const t = document.getElementById('modalText');
    if (!m || !t) return;
    t.textContent = text || '';
    m.style.display = 'flex';
}
document.getElementById('modalOk')?.addEventListener('click', () => {
    const m = document.getElementById('modal');
    if (m) m.style.display = 'none';
});

// Show prominent warning when user already exists
function showUserExistsWarning(email) {
    // Create a more prominent warning overlay
    const warningOverlay = document.createElement('div');
    warningOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        animation: fadeIn 0.3s ease;
    `;

    const warningBox = document.createElement('div');
    warningBox.style.cssText = `
        background: var(--card);
        border: 2px solid #f59e0b;
        border-radius: 12px;
        padding: 24px;
        max-width: 400px;
        text-align: center;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        animation: slideIn 0.3s ease;
    `;

    warningBox.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
        <h3 style="margin: 0 0 12px; color: #f59e0b;">Account Already Exists</h3>
        <p style="margin: 0 0 20px; color: var(--text);">
            An account with <strong>${email}</strong> already exists.<br>
            Redirecting you to the sign-in page...
        </p>
        <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="switchToLoginBtn" style="
                background: var(--accent);
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 500;
            ">Go to Sign In</button>
            <button id="closeWarningBtn" style="
                background: transparent;
                color: var(--muted);
                border: 1px solid var(--border);
                padding: 10px 20px;
                border-radius: 6px;
                cursor: pointer;
            ">Close</button>
        </div>
    `;

    warningOverlay.appendChild(warningBox);
    document.body.appendChild(warningOverlay);

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes slideIn {
            from { transform: translateY(-20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    // Handle button clicks
    document.getElementById('switchToLoginBtn').addEventListener('click', () => {
        switchToLoginTab(email);
        document.body.removeChild(warningOverlay);
        document.head.removeChild(style);
    });

    document.getElementById('closeWarningBtn').addEventListener('click', () => {
        document.body.removeChild(warningOverlay);
        document.head.removeChild(style);
    });

    // Auto-redirect after 3 seconds
    setTimeout(() => {
        if (document.body.contains(warningOverlay)) {
            switchToLoginTab(email);
            document.body.removeChild(warningOverlay);
            document.head.removeChild(style);
        }
    }, 3000);
}

// Switch to login tab with email pre-filled
function switchToLoginTab(email) {
    switchTab('login');
    $("email").value = email;
    msg('Please sign in with your existing account', 'ok');

    // Focus on password field
    setTimeout(() => {
        $("password").focus();
    }, 100);
}

// Tab switching functionality
function switchTab(tabName) {
    // Remove active class from all tabs and content
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    // Add active class to selected tab and content
    const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
    const activeContent = document.getElementById(`${tabName}Tab`);

    if (activeTab) activeTab.classList.add('active');
    if (activeContent) activeContent.classList.add('active');

    // Clear any existing messages
    msg('');

    // Clear form fields when switching tabs
    if (tabName === 'login') {
        // Clear registration fields
        const regEmail = $("regEmail");
        const regPassword = $("regPassword");
        const accessCode = $("accessCode");
        if (regEmail) regEmail.value = '';
        if (regPassword) regPassword.value = '';
        if (accessCode) accessCode.value = '';
    } else if (tabName === 'register') {
        // Clear login fields
        const email = $("email");
        const password = $("password");
        if (email) email.value = '';
        if (password) password.value = '';
    }
}



// Test if a user account exists
async function testUserExists(email) {
    try {
        console.log('=== TESTING USER EXISTENCE ===');
        console.log('Testing email:', email);

        const testUrl = `${IDT_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const testBody = { email: email, password: 'dummy_password', returnSecureToken: true };

        const res = await fetch(testUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testBody)
        });

        const responseData = await res.json();
        console.log('User existence test response:', responseData);

        if (responseData.error?.message?.includes('EMAIL_NOT_FOUND')) {
            console.log('❌ User does not exist');
            return false;
        } else if (responseData.error?.message?.includes('INVALID_PASSWORD')) {
            console.log('✅ User exists (got password error)');
            return true;
        } else {
            console.log('❓ Unknown response:', responseData);
            return null;
        }
    } catch (error) {
        console.error('❌ User existence test failed:', error);
        return null;
    }
}

// Test Firebase project configuration
async function testFirebaseProjectConfig() {
    try {
        console.log('=== TESTING FIREBASE PROJECT CONFIG ===');

        // Test 1: Check if API key is valid by making a simple request
        const testUrl = `${IDT_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const testBody = { email: 'test@test.com', password: 'test123', returnSecureToken: true };

        console.log('Testing with URL:', testUrl);
        console.log('Testing with body:', testBody);

        const res = await fetch(testUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testBody)
        });

        console.log('Response status:', res.status);
        const responseData = await res.json();
        console.log('Response data:', responseData);

        if (res.status === 400) {
            const errorMessage = responseData.error?.message || '';
            console.log('Error message:', errorMessage);

            if (errorMessage.includes('INVALID_PASSWORD') || errorMessage.includes('EMAIL_NOT_FOUND')) {
                console.log('✅ Firebase API key is valid - got expected authentication error');
                return { valid: true, message: 'API key is valid' };
            } else if (errorMessage.includes('TOO_MANY_ATTEMPTS_TRY_LATER') || errorMessage.includes('too-many-requests')) {
                console.log('⚠️ Firebase rate limiting active - too many attempts');
                return { valid: true, message: 'API key is valid but rate limited. Wait 15-30 minutes.' };
            } else if (errorMessage.includes('API_KEY_NOT_VALID') || errorMessage.includes('INVALID_API_KEY')) {
                console.log('❌ Firebase API key is invalid');
                return { valid: false, message: 'API key is invalid' };
            } else if (errorMessage.includes('PROJECT_NOT_FOUND')) {
                console.log('❌ Firebase project not found');
                return { valid: false, message: 'Project not found' };
            } else if (errorMessage.includes('OPERATION_NOT_ALLOWED')) {
                console.log('❌ Email/password authentication is disabled');
                return { valid: false, message: 'Email/password auth is disabled in Firebase console' };
            } else {
                console.log('❓ Unknown error:', errorMessage);
                return { valid: false, message: `Unknown error: ${errorMessage}` };
            }
        } else if (res.status === 403) {
            console.log('❌ Access forbidden - API key or project issue');
            return { valid: false, message: 'Access forbidden - check API key and project settings' };
        } else {
            console.log('❌ Unexpected response status:', res.status);
            return { valid: false, message: `Unexpected response: ${res.status}` };
        }
    } catch (error) {
        console.error('❌ Firebase project config test failed:', error);
        return { valid: false, message: `Network error: ${error.message}` };
    }
}

// Test if email/password authentication is enabled
async function testEmailPasswordAuth() {
    try {
        console.log('=== TESTING EMAIL/PASSWORD AUTH ENABLED ===');

        // Try to create a test account to see if email/password auth is enabled
        const testUrl = `${IDT_BASE}/accounts:signUp?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const testBody = {
            email: 'test-' + Date.now() + '@example.com',
            password: 'test123456',
            returnSecureToken: true
        };

        console.log('Testing email/password auth with URL:', testUrl);
        console.log('Test body:', testBody);

        const res = await fetch(testUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testBody)
        });

        console.log('Response status:', res.status);
        const responseData = await res.json();
        console.log('Response data:', responseData);

        if (res.status === 200) {
            console.log('✅ Email/password authentication is enabled');
            return { enabled: true, message: 'Email/password auth is enabled' };
        } else if (res.status === 400) {
            const errorMessage = responseData.error?.message || '';
            if (errorMessage.includes('OPERATION_NOT_ALLOWED')) {
                console.log('❌ Email/password authentication is disabled');
                return { enabled: false, message: 'Email/password auth is disabled in Firebase console' };
            } else if (errorMessage.includes('TOO_MANY_ATTEMPTS_TRY_LATER') || errorMessage.includes('too-many-requests')) {
                console.log('⚠️ Firebase rate limiting active - too many attempts');
                return { enabled: true, message: 'Auth is enabled but rate limited. Wait 15-30 minutes.' };
            } else {
                console.log('❓ Other error:', errorMessage);
                return { enabled: false, message: `Auth error: ${errorMessage}` };
            }
        } else {
            console.log('❌ Unexpected response:', res.status);
            return { enabled: false, message: `Unexpected response: ${res.status}` };
        }
    } catch (error) {
        console.error('❌ Email/password auth test failed:', error);
        return { enabled: false, message: `Network error: ${error.message}` };
    }
}

// Check if Firebase is currently rate limited
async function checkRateLimitStatus() {
    try {
        console.log('=== CHECKING RATE LIMIT STATUS ===');

        const testUrl = `${IDT_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const testBody = { email: 'rate-limit-test@example.com', password: 'test123', returnSecureToken: true };

        const res = await fetch(testUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testBody)
        });

        const responseData = await res.json();
        const errorMessage = responseData.error?.message || '';

        if (errorMessage.includes('TOO_MANY_ATTEMPTS_TRY_LATER') || errorMessage.includes('too-many-requests')) {
            console.log('⚠️ Firebase is currently rate limited');
            return { rateLimited: true, message: 'Firebase is rate limited. Please wait 15-30 minutes.' };
        } else {
            console.log('✅ Firebase is not rate limited');
            return { rateLimited: false, message: 'Firebase is not rate limited.' };
        }
    } catch (error) {
        console.error('❌ Rate limit check failed:', error);
        return { rateLimited: false, message: `Rate limit check failed: ${error.message}` };
    }
}

// Test Firebase connection
async function testFirebaseConnection() {
    const result = await testFirebaseProjectConfig();
    return result.valid;
}

// Test if Firebase API is accessible from extension context
async function testFirebaseAccessibility() {
    try {
        console.log('=== TESTING FIREBASE API ACCESSIBILITY ===');
        const isExtensionContext = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
        console.log('Extension context:', isExtensionContext);

        const testUrl = `${IDT_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        console.log('Testing URL accessibility:', testUrl);

        // Try a simple HEAD request first
        const headResponse = await fetch(testUrl, { method: 'HEAD' });
        console.log('HEAD request status:', headResponse.status);

        // Try a simple POST request
        const postResponse = await fetch(testUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test@test.com', password: 'test123', returnSecureToken: true })
        });

        console.log('POST request status:', postResponse.status);
        const responseText = await postResponse.text();
        console.log('POST response text:', responseText);

        return { accessible: true, headStatus: headResponse.status, postStatus: postResponse.status };
    } catch (error) {
        console.error('Firebase accessibility test failed:', error);
        return { accessible: false, error: error.message };
    }
}

// Test specific user credentials
async function testUserCredentials(email, password) {
    try {
        console.log('=== TESTING USER CREDENTIALS ===');
        console.log('Testing with email:', email);

        const url = `${IDT_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const requestBody = { email, password, returnSecureToken: true };

        console.log('Test request URL:', url);
        console.log('Test request body:', requestBody);

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        console.log('Test response status:', res.status);
        const responseText = await res.text();
        console.log('Test response text:', responseText);

        if (res.ok) {
            const data = JSON.parse(responseText);
            console.log('✅ Credentials are valid');
            return { valid: true, data };
        } else {
            const errorData = JSON.parse(responseText);
            console.log('❌ Credentials failed:', errorData);
            return { valid: false, error: errorData };
        }
    } catch (error) {
        console.error('❌ Test failed:', error);
        return { valid: false, error: error.message };
    }
}

// Clear error states when user starts typing
function clearErrorStates() {
    document.querySelectorAll('input').forEach(input => {
        input.classList.remove('error');
    });
    msg('');
}

// Add event listeners for tab switching and authentication
document.addEventListener('DOMContentLoaded', async () => {
    // Detect if running in Chrome extension context
    const isExtensionContext = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
    console.log('Running in extension context:', isExtensionContext);
    console.log('Chrome runtime ID:', chrome?.runtime?.id);
    console.log('Window location:', window.location.href);

    // Only run tests if not in extension context to save quota
    if (!isExtensionContext) {
        console.log('Running in manual context - performing Firebase tests');
        // Test Firebase connection first
        await testFirebaseConnection();

        // Test Firebase accessibility in extension context
        await testFirebaseAccessibility();
    } else {
        console.log('Running in extension context - skipping automatic tests to save Firebase quota');

        // Show quota warning in extension context
        const quotaWarning = document.getElementById('quotaWarning');
        if (quotaWarning) {
            quotaWarning.style.display = 'block';
        }

        // Disable some debug buttons that make expensive API calls
        const expensiveButtons = ['btnTestConfig', 'btnTestConnection', 'btnTestAuth', 'btnTestAccessibility'];
        expensiveButtons.forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.disabled = true;
                btn.title = 'Disabled in extension context to save Firebase quota';
                btn.style.opacity = '0.5';
            }
        });
    }

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            switchTab(tabName);
        });
    });

    // Clear error states when user types
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', clearErrorStates);

        // Add Enter key support for form submission
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const activeTab = document.querySelector('.tab.active');
                if (activeTab) {
                    const tabName = activeTab.getAttribute('data-tab');
                    if (tabName === 'login') {
                        handleLogin();
                    } else if (tabName === 'register') {
                        handleRegister();
                    }
                }
            }
        });
    });

    // Authentication button event listeners
    document.getElementById('btnLogin')?.addEventListener('click', handleLogin);
    document.getElementById('btnRegister')?.addEventListener('click', handleRegister);
    document.getElementById('btnSignOut')?.addEventListener('click', handleSignOut);

    // Debug button event listeners
    document.getElementById('btnTestConfig')?.addEventListener('click', async () => {
        const debugOutput = document.getElementById('debugOutput');
        if (debugOutput) {
            debugOutput.innerHTML = '🔍 Testing Firebase Configuration...<br>Checking if project exists and is properly configured...';
            const result = await testFirebaseConfig();
            if (result.valid) {
                debugOutput.innerHTML = `✅ Firebase Configuration: VALID<br>${result.message}`;
            } else {
                debugOutput.innerHTML = `❌ Firebase Configuration: INVALID<br>Error: ${result.error}<br><br>🔧 Troubleshooting Steps:<br>1. Check Firebase Console: https://console.firebase.google.com<br>2. Verify project ID: "${firebaseConfig.projectId}"<br>3. Verify API key: "${firebaseConfig.apiKey}"<br>4. Enable Authentication in Firebase Console<br>5. Add your domain to authorized domains<br><br>ℹ️ Using original working configuration`;
                if (result.details) {
                    debugOutput.innerHTML += `<br><br>📋 Error Details: ${JSON.stringify(result.details, null, 2)}`;
                }
            }
        }
    });

    document.getElementById('btnTestConnection')?.addEventListener('click', async () => {
        const debugOutput = document.getElementById('debugOutput');
        if (debugOutput) {
            debugOutput.innerHTML = 'Testing Firebase connection...';
            const result = await testFirebaseProjectConfig();
            debugOutput.innerHTML = `Firebase connection test: ${result.valid ? 'PASSED' : 'FAILED'}<br>Message: ${result.message}`;
        }
    });

    document.getElementById('btnTestAuth')?.addEventListener('click', async () => {
        const debugOutput = document.getElementById('debugOutput');
        if (debugOutput) {
            debugOutput.innerHTML = 'Testing email/password authentication...';
            const result = await testEmailPasswordAuth();
            debugOutput.innerHTML = `Email/Password auth test: ${result.enabled ? 'ENABLED' : 'DISABLED'}<br>Message: ${result.message}`;
        }
    });

    document.getElementById('btnCheckRateLimit')?.addEventListener('click', async () => {
        const debugOutput = document.getElementById('debugOutput');
        if (debugOutput) {
            debugOutput.innerHTML = 'Checking rate limit status...';
            const result = await checkRateLimitStatus();
            debugOutput.innerHTML = `Rate limit status: ${result.rateLimited ? 'RATE LIMITED' : 'NOT RATE LIMITED'}<br>Message: ${result.message}`;
        }
    });

    document.getElementById('btnTestUser')?.addEventListener('click', async () => {
        const email = document.getElementById('email')?.value || document.getElementById('regEmail')?.value;
        const debugOutput = document.getElementById('debugOutput');
        if (debugOutput) {
            if (!email) {
                debugOutput.innerHTML = 'Please enter an email address first';
                return;
            }
            debugOutput.innerHTML = `Testing user existence for: ${email}...`;
            const result = await testUserExists(email);
            debugOutput.innerHTML = `User exists test for ${email}: ${result === true ? 'EXISTS' : result === false ? 'NOT FOUND' : 'UNKNOWN'}`;
        }
    });

    document.getElementById('btnTestCredentials')?.addEventListener('click', async () => {
        const email = document.getElementById('email')?.value || document.getElementById('regEmail')?.value;
        const password = document.getElementById('password')?.value || document.getElementById('regPassword')?.value;
        const debugOutput = document.getElementById('debugOutput');
        if (debugOutput) {
            if (!email || !password) {
                debugOutput.innerHTML = 'Please enter both email and password first';
                return;
            }
            debugOutput.innerHTML = `Testing credentials for: ${email}...`;
            const result = await testUserCredentials(email, password);
            if (result.valid) {
                debugOutput.innerHTML = `✅ Credentials are VALID for ${email}`;
            } else {
                debugOutput.innerHTML = `❌ Credentials FAILED for ${email}<br>Error: ${JSON.stringify(result.error)}`;
            }
        }
    });

    document.getElementById('btnTestAccessibility')?.addEventListener('click', async () => {
        const debugOutput = document.getElementById('debugOutput');
        if (debugOutput) {
            debugOutput.innerHTML = 'Testing Firebase API accessibility...';
            const result = await testFirebaseAccessibility();
            if (result.accessible) {
                debugOutput.innerHTML = `✅ Firebase API is ACCESSIBLE<br>HEAD: ${result.headStatus}, POST: ${result.postStatus}`;
            } else {
                debugOutput.innerHTML = `❌ Firebase API is NOT ACCESSIBLE<br>Error: ${result.error}`;
            }
        }
    });

    document.getElementById('btnClearStorage')?.addEventListener('click', async () => {
        try {
            await saveChromeStorage({ firebaseUser: null, firebaseIdToken: null, accessGranted: false });
            const debugOutput = document.getElementById('debugOutput');
            if (debugOutput) {
                debugOutput.innerHTML = 'Storage cleared successfully';
            }
            updateUi(null);
        } catch (error) {
            const debugOutput = document.getElementById('debugOutput');
            if (debugOutput) {
                debugOutput.innerHTML = `Error clearing storage: ${error.message}`;
            }
        }
    });

    // Initialize UI from storage
    bootstrapUiFromStorage();
});


