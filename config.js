// Central configuration file
// Extend or override in environment-specific deployments as needed
window.CONFIG = {
  // Ngrok tunnel to the FastAPI backend on the Raspberry Pi (localhost:8000).
  API_URL: "https://honourless-unfumbling-ward.ngrok-free.dev",
  NGROK_SKIP_HEADER: { "ngrok-skip-browser-warning": "skip-browser-warning" }
};

// Optional debug flag (gate verbose logging)
window.DEBUG = false;
