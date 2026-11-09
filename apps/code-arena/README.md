# Code Arena frontend

Next.js owns the four-quadrant launcher, model/prompt settings, live agent activity,
artifact/source/review views and embedded cube. It calls the agent service through
server-side /api/arena routes. The default OpenRouter key stays server-side;
users can optionally submit their own key for a single session. The form clears
it after session creation and never stores it in browser storage.

Run npm run dev from the repository root to start both services. See the root
README for configuration, local session lifecycle, and browser verification.
