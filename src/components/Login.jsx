// src/components/Login.jsx
import React, { useState } from 'react';

export default function Login({ API_BASE, onAuthSuccess, setStatus }) {
  const [username, setUsername] = useState(localStorage.getItem('lc_username') || '');
  const [userPassword, setUserPassword] = useState('');
  const [authError, setAuthError] = useState('');

  async function handleAuth(e) {
    e && e.preventDefault();
    setAuthError('');
    const name = username && username.trim();
    const pass = userPassword && userPassword.trim();
    if (!name || !pass) {
      setAuthError('Both username and password are required.');
      return;
    }
    try {
      setStatus && setStatus('authenticating…');
      const res = await fetch(`${API_BASE}/api/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, password: pass })
      });

      const bodyText = await res.text().catch(() => '');
      if (!res.ok) {
        if (res.status === 404) {
          // signup fallback
          const s = await fetch(`${API_BASE}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: name, password: pass })
          });
          const sText = await s.text().catch(() => '');
          if (!s.ok) {
            setAuthError(sText || `signup failed (${s.status})`);
            setStatus && setStatus('signup failed');
            return;
          }
          let created;
          try { created = JSON.parse(sText); } catch (e) { created = null; }
          if (created && created.ok) {
            const user = { id: created.id, username: created.username, token: created.token };
            localStorage.setItem('lc_username', created.username);
            localStorage.setItem('lc_current_user', JSON.stringify(user));
            onAuthSuccess && onAuthSuccess(user);
            setStatus && setStatus('signed-up & signed-in');
            return;
          } else {
            setAuthError(created?.error || 'signup failed');
            setStatus && setStatus('signup failed');
            return;
          }
        }
        setAuthError(bodyText || `signin failed (${res.status})`);
        setStatus && setStatus('signin failed');
        return;
      }

      let json;
      try { json = JSON.parse(bodyText); } catch (e) { json = null; }
      if (json && json.ok) {
        const user = { id: json.id, username: json.username, token: json.token };
        localStorage.setItem('lc_username', json.username);
        localStorage.setItem('lc_current_user', JSON.stringify(user));
        onAuthSuccess && onAuthSuccess(user);
        setStatus && setStatus('signed-in');
        return;
      } else {
        setAuthError(json?.error || 'signin failed (invalid json)');
        setStatus && setStatus('signin failed');
      }
    } catch (err) {
      console.error(err);
      setAuthError('server error');
      setStatus && setStatus('auth error');
    }
  }

  return (
    <div className="auth-panel">
      <div className="auth-card">
        <h2>LiveCode</h2>
        <p className="muted">Sign in to create or join code rooms. (Server-backed)</p>

        <label className="label">Username</label>
        <input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. Nikhil" />

        <label className="label">Password</label>
        <input className="input" type="password" value={userPassword} onChange={e => setUserPassword(e.target.value)} placeholder="your password" />

        {authError && <div className="error">{authError}</div>}

        <div className="actions">
          <button className="btn primary" onClick={handleAuth}>Sign in / Sign up</button>
          <button className="btn ghost" onClick={() => { setUsername(''); setUserPassword(''); localStorage.removeItem('lc_username'); }}>Clear</button>
        </div>

        <div className="muted small">This demo auto-creates account if username not found. Use secure auth in production.</div>
      </div>
    </div>
  );
}
