const API_URL = "https://461a-2001-1c08-883-4400-f0c3-e205-3254-d3c3.ngrok-free.app";

function isTokenValid() {
    const token = localStorage.getItem("token");
    if (!token) return false;

    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp * 1000 > Date.now();   // exp is in ms
    } catch {
        return false;
    }
}

document.addEventListener("DOMContentLoaded", () => {
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

    function updateLoginState() {
        const token = localStorage.getItem("token");
        if (isTokenValid()) {
            const username = localStorage.getItem("username") || "";
            loginBar.classList.add("hidden");
            loginContainer.classList.add("hidden");
            logoutBar.classList.remove("hidden");
            loggedInMsg.textContent = (username ? username : "");
        } else {
            loginBar.classList.remove("hidden");
            logoutBar.classList.add("hidden");
            loginContainer.classList.add("hidden");
            loggedInMsg.textContent = "";
        }
    }

    updateLoginState();

    showLoginBtn.addEventListener("click", () => {
        loginContainer.classList.toggle("hidden");
    });

    toRegister.addEventListener("click", (e) => {
        e.preventDefault();
        loginForm.classList.add("hidden");
        registerForm.classList.remove("hidden");
    });

    toLogin.addEventListener("click", (e) => {
        e.preventDefault();
        registerForm.classList.add("hidden");
        loginForm.classList.remove("hidden");
    });

    loginBtn.addEventListener("click", async () => {
        const username = document.getElementById("username").value;
        const password = document.getElementById("password").value;

        try {
            const response = await fetch(`${API_URL}/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
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

            const data = await response.json();
            localStorage.setItem("token", data.access_token);
            localStorage.setItem("username", username);
            alert("Ingelogd als " + username);

            updateLoginState();
            document.dispatchEvent(new CustomEvent("userLoggedIn", { detail: data.access_token }));

        } catch (err) {
            alert("Fout bij inloggen");
            console.error(err);
        }
    });

    registerBtn.addEventListener("click", async () => {
        const username = document.getElementById("reg-username").value;
        const password = document.getElementById("reg-password").value;
        const code = document.getElementById("reg-code").value;

        try {
            const response = await fetch(`${API_URL}/register`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
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

            const data = await response.json();
            localStorage.setItem("token", data.access_token);
            localStorage.setItem("username", username);
            alert("Geregistreerd en ingelogd als " + username);

            updateLoginState();
            document.dispatchEvent(new CustomEvent("userLoggedIn", { detail: data.access_token }));

        } catch (err) {
            alert("Fout bij registratie");
            console.error(err);
        }
    });

    logoutBtn.addEventListener("click", () => {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        updateLoginState();
        document.dispatchEvent(new CustomEvent("userLoggedOut"));
    });
});
