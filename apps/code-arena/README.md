# Code Arena frontend

Next.js owns the four-quadrant launcher, model/prompt settings, live agent activity,
artifact/source/review views and embedded cube. It calls the agent service through
server-side /api/arena routes. Users must submit their own OpenRouter key for model checks and a single session. The form clears
it after session creation and never stores it in browser storage.

Run npm run dev from the repository root to start both services. See the root
README for configuration, local session lifecycle, and browser verification.

## Google sign-in with Firebase

1. Copy `.env.example` to `.env.local` in this directory. Fill the four
   `NEXT_PUBLIC_FIREBASE_*` values from Firebase Console > Project settings ?
   Your apps > Web app configuration. These are public app identifiers.
2. For local server verification, create a Firebase Admin service account from
   Project settings > Service accounts. Put its `project_id`, `client_email`,
   and `private_key` into `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
   `FIREBASE_PRIVATE_KEY`. Quote the private key and preserve its `\n` escapes.
   Keep these credentials in `.env.local`, never in source control or browser
   environment variables. On Google infrastructure, Application Default
   Credentials can be used instead of the email/key environment variables.
3. In Authentication > Sign-in method, enable Google. In Authentication ?
   Settings > Authorized domains, add `localhost` and your deployed domain.
4. Restart `npm run dev` after changing configuration. Public environment values
   must also be present when building for deployment.

The launcher stays public. Sign in from any header, or submit a run to open the
sign-in dialog. After signing in, submit the prompt again. Google credentials
exist only in browser memory during sign-in; Next.js exchanges the ID token for
an HttpOnly, SameSite session cookie lasting five days. Session APIs, SSE, and
artifact previews verify the cookie server-side, including revocation. Owners
are derived from the verified Firebase UID, so different accounts cannot access
each other's sessions. Existing anonymous sessions are not migrated. Runs remain
in the agent's existing temporary storage; authentication does not add a database.
Signing out clears this browser's session and workspace; it does not cancel a
running agent task. Use End session first when cleanup is needed.

Checks: `npm run test:auth --workspace=code-arena`, `npm run typecheck`,
`npm run lint`, and `npm run build`. An end-to-end Google login requires valid
Firebase configuration and an interactive Google account.

Google sign-in is required before using the launcher or workspace. The login dialog cannot be dismissed while signed out. Model selection performs a live, bounded OpenRouter check using the required user key. Checks may consume credits; successful checks are reused for 60 seconds. Initial runs require a successful check, including both lanes of a comparison. User keys are forwarded only through the Next.js server for checks and session creation and are never persisted by the check service.
