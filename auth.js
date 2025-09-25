// Firebase Auth + Firestore using REST API (CSP-friendly for Chrome Extensions)

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyA0fUKA2kpoW9hHEWKcRqxjX-m-ZBFRpVM",
    projectId: "immutable-api"
};


const IDT_BASE = "https://identitytoolkit.googleapis.com/v1";
const FS_BASE = (path) => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents/${path}`;

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
        return false;
    }

    RATE_LIMIT.lastCall = now;
    return true;
}

function setRateLimitStatus(limited) {
    RATE_LIMIT.isLimited = limited;
}

// Detect Firebase quota errors and provide helpful information
function handleFirebaseQuotaError(error) {
    const errorMessage = error.message || error.toString();

    if (errorMessage.includes('quota') || errorMessage.includes('Quota') ||
        errorMessage.includes('exceeded') || errorMessage.includes('limit')) {

        // Show helpful message to user
        msg('Firebase quota exceeded. Please wait or upgrade your Firebase plan.', 'error');

        return true;
    }
    return false;
}

async function saveChromeStorage(obj) {
    return new Promise((resolve, reject) => {
        if (!chrome?.storage?.local) {
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
                reject(chrome.runtime.lastError);
            } else {
                resolve();
            }
        });
    });
}

async function getChromeStorage(keys) {
    return new Promise((resolve, reject) => {
        if (!chrome?.storage?.local) {
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


async function firestoreSetUser(uid, email, idToken) {
    const url = `${FS_BASE('Users/' + encodeURIComponent(uid))}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
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
        // Try to sign in with a dummy password to check if user exists
        try {
            const res = await fetch(`${IDT_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password: 'dummy-password-check', returnSecureToken: true })
            });

            if (res.ok) {
                // If this succeeds, user exists (but password is wrong)
                return true;
            }

            // Get the actual error response
            const errorData = await res.json();
            const errorCode = errorData.error?.message || '';

            // Check specific Firebase error codes for user existence
            if (errorCode.includes('INVALID_PASSWORD') ||
                errorCode.includes('invalid-password') ||
                errorCode.includes('wrong-password')) {
                return true;
            }

            // Check specific Firebase error codes for user NOT existing
            if (errorCode.includes('EMAIL_NOT_FOUND') ||
                errorCode.includes('user-not-found') ||
                errorCode.includes('INVALID_LOGIN_CREDENTIALS') ||
                errorCode.includes('invalid-email') ||
                errorCode.includes('INVALID_EMAIL')) {
                return false;
            }

            // For other errors, be more conservative and assume user doesn't exist
            // This prevents false positives that would block legitimate registrations
            return false;

        } catch (fetchError) {
            // If we can't check, assume user doesn't exist to allow registration
            return false;
        }

    } catch (error) {
        // If check fails, assume user doesn't exist to allow registration
        return false;
    }
}

async function getAccessConfig(idToken) {
    // Fallback global gate (optional)
    const doc = await firestoreGetDoc('Config/auth', idToken);
    if (!doc) return { enabled: false };
    const data = fromFs(doc);
    return { enabled: !!data.enabled, code: data.code || '' };
}

// Validate access code BEFORE Firebase signup (requires authentication)
async function validateAccessCodeBeforeSignup(code) {
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
        return false;
    }

    try {
        // For now, we'll skip the pre-validation and do it after signup
        // This prevents the 400 error while maintaining security
        // The access code will be validated and bound during the signup process
        return true;

    } catch (error) {
        return false;
    }
}

// Bind access code to user AFTER successful Firebase signup
async function bindAccessCodeToUser(code, email, idToken) {
    try {
        // First, check if the access code exists and is available
        const accessDoc = await firestoreGetDoc(`AccessCodes/${code}`, idToken);

        if (!accessDoc) {
            // Access code doesn't exist, create it
            const newDocData = {
                code: code,
                enabled: true,
                usedByEmail: email,
                usedAt: new Date(),
                boundAt: new Date(),
                createdAt: new Date()
            };

            const createResult = await firestoreUpdateDoc(`AccessCodes/${code}`, newDocData, idToken);
            return createResult;
        }

        const data = fromFs(accessDoc);

        // Check if code is disabled
        if (data.enabled === false) {
            return false;
        }

        // Check if code is already used by someone else
        if (data.usedByEmail && data.usedByEmail.trim() !== '' && data.usedByEmail !== email) {
            return false;
        }

        // Bind the access code to this user
        const bindResult = await firestoreUpdateDoc(`AccessCodes/${code}`, {
            usedByEmail: email,
            usedAt: new Date(),
            boundAt: new Date()
        }, idToken);

        if (!bindResult) {
            return false;
        }

        // Verify the binding was successful
        const verifyDoc = await firestoreGetDoc(`AccessCodes/${code}`, idToken);
        const verifyData = fromFs(verifyDoc);

        if (verifyData.usedByEmail !== email) {
            return false;
        }

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

    // Try to get the access code document
    const acDoc = await firestoreGetDoc('AccessCodes/' + encodeURIComponent(code), idToken);

    if (acDoc) {
        const data = fromFs(acDoc) || {};

        // Check if code is disabled
        if (data.enabled === false) {
            msg('Access code disabled', 'error');
            return false;
        }

        // FORCE CHECK: If usedByEmail exists and is not null/empty, reject
        if (data.usedByEmail && data.usedByEmail.trim() !== '') {
            msg('Access code already used by another account', 'error');
            return false;
        }

        // Try to bind the code to this email using the new SDK
        try {
            const updateData = {
                enabled: true,
                usedByEmail: email,
                usedAt: new Date(),
                boundAt: new Date()
            };

            const updateResult = await firestoreUpdateDoc('AccessCodes/' + encodeURIComponent(code), updateData, idToken);

            if (!updateResult) {
                msg('Failed to bind access code', 'error');
                return false;
            }

            // Verify the binding worked by reading the document again
            const verifyDoc = await firestoreGetDoc('AccessCodes/' + encodeURIComponent(code), idToken);
            const verifyData = fromFs(verifyDoc) || {};

            if (verifyData.usedByEmail !== email) {
                msg('Access code binding failed', 'error');
                return false;
            }

            await saveChromeStorage({ accessGranted: true, accessGrantedAt: Date.now(), accessCode: code });
            return true;
        } catch (error) {
            msg('Error binding access code', 'error');
            return false;
        }
    } else {
        // Access code document doesn't exist, create it and bind to this email
        try {
            const newDocData = {
                code: code,
                enabled: true,
                usedByEmail: email,
                usedAt: new Date(),
                boundAt: new Date(),
                createdAt: new Date()
            };

            const createResult = await firestoreUpdateDoc('AccessCodes/' + encodeURIComponent(code), newDocData, idToken);

            if (!createResult) {
                msg('Failed to create access code', 'error');
                return false;
            }

            await saveChromeStorage({ accessGranted: true, accessGrantedAt: Date.now(), accessCode: code });
            return true;
        } catch (error) {
            msg('Error creating access code', 'error');
            return false;
        }
    }

    // Fallback to global config if defined
    const cfg = await getAccessConfig(idToken);

    if (cfg.enabled && cfg.code === code) {
        await saveChromeStorage({ accessGranted: true, accessGrantedAt: Date.now(), accessCode: code });
        return true;
    }

    msg('Invalid access code', 'error');
    return false;
}

async function authSignIn(email, password) {
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

    if (isExtensionContext) {
        // Use background script to bypass CORS issues
        try {
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
        } catch (error) {
            if (handleFirebaseQuotaError(error)) {
                return; // Quota error handled
            }
            throw error;
        }
    } else {
        // Direct Firebase request for non-extension context
        const url = `${IDT_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const requestBody = { email, password, returnSecureToken: true };

        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
        } catch (fetchError) {
            if (handleFirebaseQuotaError(fetchError)) {
                return; // Quota error handled
            }
            if (fetchError.name === 'TypeError' && fetchError.message.includes('Failed to fetch')) {
                throw new Error('Network error: Firebase API may be blocking requests from Chrome extension. Please check Firebase console settings.');
            }
            throw fetchError;
        }

        if (!res.ok) {
            // Get detailed error information
            try {
                // First get the raw response text for debugging
                const responseText = await res.text();

                // Try to parse as JSON
                let errorData;
                try {
                    errorData = JSON.parse(responseText);
                } catch (parseError) {
                    throw new Error(`Sign in failed (${res.status}): ${responseText}`);
                }

                const errorCode = errorData.error?.message || '';

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
                throw new Error(`Sign in failed (${res.status})`);
            }
        }

        return res.json();
    }
}

async function authSignUp(email, password) {
    // Check rate limit to prevent quota exhaustion
    if (!checkRateLimit()) {
        throw new Error('Please wait a moment before trying again (rate limited to prevent quota exhaustion)');
    }

    // Check if we're in extension context
    const isExtensionContext = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;

    if (isExtensionContext) {
        // Use background script to bypass CORS issues
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'FIREBASE_SIGN_UP',
                email: email,
                password: password
            });

            if (response.success) {
                return response.data;
            } else {
                throw new Error(response.error);
            }
        } catch (error) {
            throw error;
        }
    } else {
        // Direct Firebase request for non-extension context
        const url = `${IDT_BASE}/accounts:signUp?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const requestBody = { email, password, returnSecureToken: true };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!res.ok) {
            // Get detailed error information
            try {
                const errorData = await res.json();
                const errorCode = errorData.error?.message || '';

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
        // Fallback to localStorage if Chrome storage fails
        try {
            const userStr = localStorage.getItem('firebaseUser');
            const user = userStr ? JSON.parse(userStr) : null;
            updateUi(user);
        } catch (localError) {
            updateUi(null);
        }
    }
}

async function handleLogin() {
    try {
        msg('Signing in...', '');

        const emailEl = $("email");
        const passwordEl = $("password");

        if (!emailEl || !passwordEl) {
            msg('Login form error. Please refresh the page.', 'error');
            return;
        }

        const email = emailEl.value.trim();
        const password = passwordEl.value;

        // Validate input
        if (!email || !password) {
            msg('Please enter both email and password', 'error');
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

        const resp = await authSignIn(email, password);
        const user = { uid: resp.localId, email: resp.email };

        // No access-code required on login; user must have registered previously
        const storageData = { firebaseUser: user, firebaseIdToken: resp.idToken, accessGranted: true };

        try {
            // Add timeout to prevent hanging
            const storagePromise = saveChromeStorage(storageData);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Storage timeout')), 5000)
            );

            await Promise.race([storagePromise, timeoutPromise]);
        } catch (storageError) {
            msg('Warning: Could not save login state. You may need to sign in again.', 'warn');
            // Continue with login even if storage fails
        }

        try {
            await firestoreSetUser(user.uid, user.email, resp.idToken);
        } catch (firestoreError) {
            // Continue anyway, this is not critical for login
        }

        updateUi(user);
        msg('Signed in successfully', 'ok');
        showModal('Signed in successfully. You can now use the extension popup.');

    } catch (e) {
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

        // FIRST: Validate access code BEFORE any Firebase operations
        const accessCodeValid = await validateAccessCodeBeforeSignup(code);

        if (!accessCodeValid) {
            msg('Access denied: invalid or already used access code', 'error');
            codeEl.focus();
            return;
        }

        let resp, user;
        try {
            resp = await authSignUp(email, password);
            user = { uid: resp.localId, email: resp.email };

            // Bind the access code to this user
            const accessBound = await bindAccessCodeToUser(code, email, resp.idToken);

            if (!accessBound) {
                // If binding fails, we should clean up the Firebase user
                msg('Registration failed: access code is invalid or already used', 'error');
                return;
            }
        } catch (signupError) {
            // Try to get more detailed error information
            let errorMessage = signupError.message || '';
            let isDuplicateUser = false;

            // Check if it's a duplicate user error
            if (errorMessage.includes('EMAIL_EXISTS') ||
                errorMessage.includes('email-already-in-use') ||
                errorMessage.includes('already-in-use')) {

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
        } catch (storageError) {
            msg('Warning: Could not save registration state. You may need to sign in again.', 'warn');
            // Continue with registration even if storage fails
        }

        try {
            await firestoreSetUser(user.uid, user.email, resp.idToken);
        } catch (firestoreError) {
            // Continue anyway, this is not critical for registration
        }

        updateUi(user);
        msg('Account created successfully', 'ok');
        showModal('Account created successfully. You can now use the extension popup.');
    } catch (e) {
        msg(e?.message || 'Registration failed', 'error');
    }
}

async function handleSignOut() {
    try {
        // Add timeout to prevent hanging
        const storagePromise = saveChromeStorage({ firebaseUser: null, firebaseIdToken: null, accessGranted: false });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Storage timeout')), 5000)
        );

        await Promise.race([storagePromise, timeoutPromise]);
        updateUi(null);
        msg('Signed out', 'ok');
    } catch (e) {
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




// Clear error states when user starts typing
function clearErrorStates() {
    document.querySelectorAll('input').forEach(input => {
        input.classList.remove('error');
    });
    msg('');
}

// Add event listeners for tab switching and authentication
document.addEventListener('DOMContentLoaded', async () => {
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

    // Initialize UI from storage
    bootstrapUiFromStorage();
});


