const API_URL = "https://461a-2001-1c08-883-4400-f0c3-e205-3254-d3c3.ngrok-free.app";

document.addEventListener("DOMContentLoaded", () => {
    const loginBtn = document.getElementById("login-button");
    if (loginBtn) {
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
                alert("Ingelogd als " + username);

                // Eventueel kaart opnieuw laden of knoppen tonen
                document.dispatchEvent(new CustomEvent("userLoggedIn", { detail: data.access_token }));

            } catch (err) {
                alert("Fout bij inloggen");
                console.error(err);
            }
        });
    }
});
