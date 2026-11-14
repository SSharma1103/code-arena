import { getApps, initializeApp } from "firebase/app";
import { getAuth, inMemoryPersistence, setPersistence } from "firebase/auth";

export async function browserAuth() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  if (Object.values(config).some((value) => !value)) {
    throw new Error("Google sign-in is not configured yet. Add the Firebase settings in apps/code-arena/.env.local.");
  }
  const app = getApps().find((app) => app.name === "arena-browser") ?? initializeApp(config, "arena-browser");
  const auth = getAuth(app);
  await setPersistence(auth, inMemoryPersistence);
  return auth;
}
