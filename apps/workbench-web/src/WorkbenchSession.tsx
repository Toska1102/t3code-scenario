import { getPairingTokenFromUrl, stripPairingTokenFromUrl } from "@t3tools/shared/remote";
import { createContext, useContext, useState, type FormEvent, type ReactNode } from "react";

import type { ProductIdentity } from "./projects/productMounts";

const IdentityContext = createContext<ProductIdentity>({ authenticated: false });
export function useWorkbenchIdentity() {
  return useContext(IdentityContext);
}

async function pair(credential: string) {
  const response = await fetch("/api/auth/browser-session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  if (!response.ok) throw new Error("连接失败，请检查配对凭据后重试。");
}

export async function getInitialSession(): Promise<ProductIdentity & { message?: string }> {
  const url = new URL(window.location.href);
  const credential = getPairingTokenFromUrl(url);
  try {
    if (credential) {
      const clean = stripPairingTokenFromUrl(url);
      if (clean.pathname === "/pair") clean.pathname = "/";
      window.history.replaceState(window.history.state, "", clean);
      await pair(credential);
    }
    const response = await fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("无法读取登录状态，请重新连接。");
    const session = await response.json();
    return {
      authenticated: session.authenticated === true,
      sessionId: session.sessionId,
      scopes: session.scopes,
    };
  } catch (error) {
    return {
      authenticated: false,
      message: error instanceof Error ? error.message : "无法连接工作台。",
    };
  }
}

export function WorkbenchSession({
  initial,
  children,
}: {
  initial: Awaited<ReturnType<typeof getInitialSession>>;
  children: ReactNode;
}) {
  const [identity, setIdentity] = useState(initial);
  const [message, setMessage] = useState(initial.message);
  const [busy, setBusy] = useState(false);
  if (identity.authenticated) return <IdentityContext value={identity}>{children}</IdentityContext>;
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const credential = String(new FormData(event.currentTarget).get("credential") ?? "").trim();
    if (!credential || busy) return;
    setBusy(true);
    try {
      await pair(credential);
      const session = await getInitialSession();
      if (!session.authenticated) throw new Error("登录会话未建立。");
      setIdentity(session);
    } catch {
      setMessage("连接失败，请检查配对凭据后重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="workbench-session">
      <form onSubmit={connect}>
        <h1>连接工作台</h1>
        <label>
          配对凭据
          <input name="credential" type="password" autoComplete="off" required />
        </label>
        {message && <p role="alert">{message}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "连接中…" : "连接"}
        </button>
      </form>
    </main>
  );
}
