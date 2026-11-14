"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Launcher } from "./arena";
import { FirebaseError } from "firebase/app";
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { browserAuth } from "@/lib/auth/client";
import type { ArenaUser } from "@/lib/auth/session";

const AuthContext = createContext<{
  user: ArenaUser | null; loading: boolean; open: () => void; logout: () => Promise<void>;
}>({ user: null, loading: true, open: () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ArenaUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const open = () => dialog.current?.showModal();

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error);
        if (active) setUser(value.user);
      })
      .catch(() => { if (active) setError("Could not check your sign-in. Please try again."); })
      .finally(() => { if (active) setLoading(false); });
    const required = () => { setUser(null); open(); };
    window.addEventListener("arena-sign-in-required", required);
    return () => { active = false; window.removeEventListener("arena-sign-in-required", required); };
  }, []);

  useEffect(() => {
    if (!user) dialog.current?.showModal();
    else dialog.current?.close();
  }, [user]);

  async function login() {
    setBusy(true);
    setError("");
    try {
      const auth = await browserAuth();
      try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        const credential = await signInWithPopup(auth, provider);
        const response = await fetch("/api/auth/session", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: await credential.user.getIdToken() }),
        });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error);
        setUser(value.user);
        dialog.current?.close();
        // Reset any workspace belonging to the previous browser identity.
        const destination = new URL(window.location.href);
        destination.searchParams.delete("session");
        destination.searchParams.delete("sessionB");
        window.location.assign(destination.href);
      } finally {
        await signOut(auth);
      }
    } catch (cause) {
      if (cause instanceof FirebaseError) {
        const messages: Record<string, string> = {
          "auth/popup-blocked": "Allow pop-ups for this site, then try again.",
          "auth/popup-closed-by-user": "Sign-in was closed. Try again when you're ready.",
          "auth/cancelled-popup-request": "A sign-in window is already open.",
          "auth/unauthorized-domain": "Add this site's domain to Firebase Authentication's authorized domains.",
          "auth/network-request-failed": "Could not reach Google. Check your connection and try again.",
        };
        setError(messages[cause.code] ?? "Google sign-in failed. Check your Firebase configuration and try again.");
      } else setError(cause instanceof Error ? cause.message : "Google sign-in failed. Please try again.");
    } finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not sign out. Please try again.");
      setUser(null);
      window.location.assign(new URL("/", window.location.origin).href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out.");
      open();
    } finally { setBusy(false); }
  }

  return (
    <AuthContext.Provider value={{ user, loading: loading || busy, open, logout }}>
      {user ? children : <div inert><Launcher /></div>}
      <dialog onCancel={(event) => event.preventDefault()} ref={dialog} className="auth-dialog" aria-labelledby="auth-title" aria-describedby="auth-description">
        <span className="eyebrow">YOUR NEXT IDEA STARTS HERE</span>
        <div className="auth-symbol" aria-hidden="true">&#10035;</div>
        <h2 id="auth-title">Step into the arena.</h2>
        <p id="auth-description">One account. Four playgrounds. Sign in to bring your ideas to life and compare what models can create.</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-google" disabled={busy || loading} onClick={() => void login()}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21.8 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.6ZM12 22c2.7 0 5-.9 6.8-2.2l-3.3-2.6c-.9.6-2.1.9-3.5.9-2.7 0-5-1.8-5.9-4.2H2.7v2.7A10 10 0 0 0 12 22ZM6.1 13.9a6 6 0 0 1 0-3.8V7.4H2.7a10 10 0 0 0 0 9.2l3.4-2.7ZM12 5.9c1.5 0 2.8.5 3.9 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9.3 5.4l3.4 2.7C7 7.7 9.3 5.9 12 5.9Z"/></svg>
          {busy ? "Connecting..." : "Continue with Google"}<span aria-hidden="true">&#8599;</span>
        </button>
        <p className="auth-footnote">LESS SETUP. MORE POSSIBILITY.</p>
      </dialog>
    </AuthContext.Provider>
  );
}

export function AuthControl() {
  const { user, loading, open, logout } = useContext(AuthContext);
  return <div className="auth-control">
    {user && <span className="auth-name" title={user.email ?? user.name}>{user.name}</span>}
    <button className="auth-header-button" disabled={loading} onClick={() => user ? void logout() : open()}>
      {loading ? "Connecting..." : user ? "Sign out \u2197" : "Sign in \u2197"}
    </button>
  </div>;
}
