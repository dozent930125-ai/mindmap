"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) window.location.href = "/";
    else setError((await res.json()).error ?? "로그인 실패");
  }

  return (
    <main style={{ maxWidth: 360 }}>
      <h1>로그인</h1>
      <form onSubmit={submit} className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호" autoFocus aria-label="비밀번호" />
        <button className="primary" type="submit">들어가기</button>
        {error && <span className="small" style={{ color: "var(--danger)" }}>{error}</span>}
      </form>
    </main>
  );
}
