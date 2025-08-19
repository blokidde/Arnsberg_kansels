// API base URL for authentication endpoints
const API_URL = "https://ec9e59218665.ngrok-free.app/";

// Function to check if the stored token is valid
function isTokenValid() {
    const token = localStorage.getItem("token");
    if (!token) return false;

    try {
        // Decode token payload and check expiration time
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp * 1000 > Date.now(); // `exp` is in milliseconds
    } catch {
        return false;
    }
}

// Event listener for DOM content loaded
document.addEventListener("DOMContentLoaded", () => {
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

            // Store token and username in localStorage
            const data = await response.json();
            localStorage.setItem("token", data.access_token);
            localStorage.setItem("username", username);
            alert("Ingelogd als " + username);

            // Update UI state and dispatch login event
            updateLoginState();
            document.dispatchEvent(new CustomEvent("userLoggedIn", { detail: data.access_token }));

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

            // Store token and username in localStorage
            const data = await response.json();
            localStorage.setItem("token", data.access_token);
            localStorage.setItem("username", username);
            alert("Geregistreerd en ingelogd als " + username);

            // Update UI state and dispatch login event
            updateLoginState();
            document.dispatchEvent(new CustomEvent("userLoggedIn", { detail: data.access_token }));

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
    });
});
