const API_URL = "https://461a-2001-1c08-883-4400-f0c3-e205-3254-d3c3.ngrok-free.app";

document.addEventListener("DOMContentLoaded", () => {
    const showLoginBtn = document.getElementById("show-login-btn");
    const loginBar = document.getElementById("login-bar");
    const logoutBar = document.getElementById("logout-bar");
    const loginContainer = document.getElementById("login-container");
    const loginBtn = document.getElementById("login-button");
    const logoutBtn = document.getElementById("logout-btn");
    const loggedInMsg = document.getElementById("logged-in-message");

    // Helper om UI aan te passen aan loginstatus
    function updateLoginState() {
        const token = localStorage.getItem("token");
        if (token) {
            // Optioneel: decode username uit token, of onthoud hem bij login
            const username = localStorage.getItem("username") || "";
            loginBar.classList.add("hidden");
            loginContainer.classList.add("hidden");
            logoutBar.classList.remove("hidden");
            loggedInMsg.textContent = (username ? username : "");
        } else {
            loginBar.classList.remove("hidden");
            logoutBar.classList.add("hidden");
            loggedInMsg.textContent = "";
        }
    }

    updateLoginState();

    // Toon loginformulier bij klik op Login
    showLoginBtn.addEventListener("click", () => {
        loginContainer.classList.toggle("hidden");
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
            localStorage.setItem("username", username); // Save for greeting
            alert("Ingelogd als " + username);

            updateLoginState();

            document.dispatchEvent(new CustomEvent("userLoggedIn", { detail: data.access_token }));

        } catch (err) {
            alert("Fout bij inloggen");
            console.error(err);
        }
    });

    logoutBtn.addEventListener("click", () => {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        updateLoginState();
        // Eventueel: pagina reloaden of markers opnieuw laden, etc.
        document.dispatchEvent(new CustomEvent("userLoggedOut"));
    });
});
