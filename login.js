// Gebruik global window.CONFIG voor API base URL
function base64UrlDecode(s){ return atob(s.replace(/-/g,'+').replace(/_/g,'/')); }
function isTokenValid() {
    const t = localStorage.getItem("token");
    if(!t) return false;
    try {
        const payload = JSON.parse(base64UrlDecode(t.split('.')[1]));
        // exp in seconden -> ms
        return payload.exp * 1000 > Date.now();
    } catch { return false; }
}
window.isTokenValid = isTokenValid;

// Pre-expiry logout warning (1 minute before)
let tokenExpiryTimer = null;
function scheduleTokenExpiryCheck(){
    if(tokenExpiryTimer) clearTimeout(tokenExpiryTimer);
    const t = localStorage.getItem('token');
    if(!t) return;
    try {
        const payload = JSON.parse(base64UrlDecode(t.split('.')[1]));
        const expMs = payload.exp * 1000;
        const warnAt = expMs - 60*1000;
        const now = Date.now();
        if(warnAt <= now){ doAutoLogout(); return; }
        tokenExpiryTimer = setTimeout(()=>{
            alert('Je sessie verloopt bijna en je wordt uitgelogd. Log opnieuw in om verder te gaan.');
            doAutoLogout();
        }, warnAt - now);
    } catch {}
}
function doAutoLogout(){
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    document.dispatchEvent(new CustomEvent('userLoggedOut'));
}

// Event listener for DOM content loaded
document.addEventListener("DOMContentLoaded", () => {
    // Keyboard detection for mobile UI adjustments
    document.addEventListener('focusin', (e) => {
        if (e.target.matches('input, select, textarea')) {
            document.body.classList.add('kb-open');
        }
    });
    document.addEventListener('focusout', (e) => {
        if (e.target.matches('input, select, textarea')) {
            document.body.classList.remove('kb-open');
        }
    });

    // Get references to UI elements
    const showLoginBtn = document.getElementById("show-login-btn");
    const loginBar = document.getElementById("login-bar");
    const logoutBar = document.getElementById("logout-bar");
    const loginContainer = document.getElementById("login-container");
    const loginBtn = document.getElementById("login-button");
    const logoutBtn = document.getElementById("logout-btn");
    const loggedInMsg = document.getElementById("logged-in-message");

    const registerBtn = document.getElementById("register-button");
    const toRegister = document.getElementById("to-register");
    const toLogin = document.getElementById("to-login");

    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");

    // Function to update the login/logout state based on token validity
    function updateLoginState() {
        const token = localStorage.getItem("token");
        if (isTokenValid()) {
            // Show logout bar and hide login UI
            const username = localStorage.getItem("username") || "";
            loginBar.classList.add("hidden");
            loginContainer.classList.add("hidden");
            logoutBar.classList.remove("hidden");
            loggedInMsg.textContent = username ? username : "";
        } else {
            // Show login bar and hide logout UI
            loginBar.classList.remove("hidden");
            logoutBar.classList.add("hidden");
            loginContainer.classList.add("hidden");
            loggedInMsg.textContent = "";
        }
    }

    // Initialize login state on page load
    updateLoginState();

    // Toggle visibility of the login container
    showLoginBtn.addEventListener("click", () => {
        loginContainer.classList.toggle("hidden");
    });

    // Switch to registration form
    toRegister.addEventListener("click", (e) => {
        e.preventDefault();
        loginForm.classList.add("hidden");
        registerForm.classList.remove("hidden");
    });

    // Switch back to login form
    toLogin.addEventListener("click", (e) => {
        e.preventDefault();
        registerForm.classList.add("hidden");
        loginForm.classList.remove("hidden");
    });

    // Handle login button click
    loginBtn.addEventListener("click", async () => {
        const username = document.getElementById("username").value;
        const password = document.getElementById("password").value;

        try {
            // Send login request to the server
        const response = await fetch(`${window.CONFIG.API_URL}/login`, {
                method: "POST",
                headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            ...(window.CONFIG.NGROK_SKIP_HEADER || {})
                },
                body: new URLSearchParams({
                    username,
                    password
                })
            });

            if (!response.ok) {
                alert("Login mislukt");
                return;
            }

            // Store token and username in localStorage
            const data = await response.json();
            localStorage.setItem("token", data.access_token);
            localStorage.setItem("username", username);
            alert("Ingelogd als " + username);

            // Update UI state and dispatch login event
            updateLoginState();
            document.dispatchEvent(new CustomEvent("userLoggedIn", { detail: data.access_token }));
            scheduleTokenExpiryCheck();

        } catch (err) {
            alert("Fout bij inloggen");
            console.error(err);
        }
    });

    // Handle registration button click
    registerBtn.addEventListener("click", async () => {
        const username = document.getElementById("reg-username").value;
        const password = document.getElementById("reg-password").value;
        const code = document.getElementById("reg-code").value;

        try {
            // Send registration request to the server
        const response = await fetch(`${window.CONFIG.API_URL}/register`, {
                method: "POST",
                headers: {
            "Content-Type": "application/json",
            ...(window.CONFIG.NGROK_SKIP_HEADER || {})
                },
                body: JSON.stringify({
                    username,
                    password,
                    code
                })
            });

            if (!response.ok) {
                const err = await response.json();
                alert("Registratie mislukt: " + (err.detail || response.statusText));
                return;
            }

            // Store token and username in localStorage
            const data = await response.json();
            localStorage.setItem("token", data.access_token);
            localStorage.setItem("username", username);
            alert("Geregistreerd en ingelogd als " + username);

            // Update UI state and dispatch login event
            updateLoginState();
            document.dispatchEvent(new CustomEvent("userLoggedIn", { detail: data.access_token }));
            scheduleTokenExpiryCheck();

        } catch (err) {
            alert("Fout bij registratie");
            console.error(err);
        }
    });

    // Handle logout button click
    logoutBtn.addEventListener("click", () => {
        // Clear token and username from localStorage
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        // Update UI state and dispatch logout event
        updateLoginState();
        document.dispatchEvent(new CustomEvent("userLoggedOut"));
        if(tokenExpiryTimer) clearTimeout(tokenExpiryTimer);
    });

    // Schedule on load if already logged in
    if(isTokenValid()) scheduleTokenExpiryCheck();
});
