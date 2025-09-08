(function initSiteBridge() {
    const TOKEN_KEY = 'immutableAuthTokenValue';

    function setAuthField(token) {
        try {
            const el = document.getElementById('auth');
            if (!el) return false;
            el.value = token;
            return true;
        } catch (_) { return false; }
    }

    function clickCheck() {
        try {
            const btn = document.getElementById('sendBtn');
            if (btn) btn.click();
        } catch (_) { }
    }

    function handleToken(token) {
        if (!token) return;
        localStorage.setItem(TOKEN_KEY, token);
        const setOk = setAuthField(token);
        if (setOk) {
            console.info('[ImmutableExt] token applied to #auth');
        }
    }

    // On load, apply any saved token
    try {
        const saved = localStorage.getItem(TOKEN_KEY);
        if (saved) setAuthField(saved);
    } catch (_) { }

    // Listen for token push from background
    chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || msg.type !== 'PUSH_TOKEN' || !msg.token) return;
        handleToken(msg.token);
    });
})();

