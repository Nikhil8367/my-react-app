// Login.jsx — visible inputs (single-file, CSS inside JSX)
import React, { useState } from 'react';

export default function Login({ API_BASE, onAuthSuccess, setStatus }) {
  const [username, setUsername] = useState(localStorage.getItem('lc_username') || '');
  const [userPassword, setUserPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(Boolean(localStorage.getItem('lc_username')));
  const [signedInPulse, setSignedInPulse] = useState(false);

  function passwordStrength(pw) {
    if (!pw) return { score: 0, label: 'Empty', pct: 0 };
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    const labels = ['Weak', 'Fair', 'Good', 'Strong'];
    return { score, label: labels[Math.min(Math.max(score - 1, 0), 3)], pct: (score / 4) * 100 };
  }
  const strength = passwordStrength(userPassword);

  async function handleAuth(e) {
    e && e.preventDefault();
    setAuthError('');
    const name = username && username.trim();
    const pass = userPassword && userPassword.trim();
    if (!name || !pass) {
      setAuthError('Both username and password are required.');
      return;
    }

    setLoading(true);
    setStatus && setStatus('authenticating…');

    try {
      const res = await fetch(`${API_BASE}/api/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, password: pass })
      });

      const bodyText = await res.text().catch(() => '');
      if (!res.ok) {
        if (res.status === 404) {
          const s = await fetch(`${API_BASE}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: name, password: pass })
          });
          const sText = await s.text().catch(() => '');
          if (!s.ok) {
            setAuthError(sText || `signup failed (${s.status})`);
            setStatus && setStatus('signup failed');
            setLoading(false);
            return;
          }
          let created;
          try { created = JSON.parse(sText); } catch { created = null; }
          if (created && created.ok) {
            const user = { id: created.id, username: created.username, token: created.token };
            remember && localStorage.setItem('lc_username', created.username);
            localStorage.setItem('lc_current_user', JSON.stringify(user));
            onAuthSuccess && onAuthSuccess(user);
            setStatus && setStatus('signed-up & signed-in');
            setLoading(false);
            setSignedInPulse(true);
            setTimeout(() => setSignedInPulse(false), 1000);
            return;
          } else {
            setAuthError(created?.error || 'signup failed');
            setStatus && setStatus('signup failed');
            setLoading(false);
            return;
          }
        }
        setAuthError(bodyText || `signin failed (${res.status})`);
        setStatus && setStatus('signin failed');
        setLoading(false);
        return;
      }

      let json;
      try { json = JSON.parse(bodyText); } catch { json = null; }
      if (json && json.ok) {
        const user = { id: json.id, username: json.username, token: json.token };
        remember && localStorage.setItem('lc_username', json.username);
        localStorage.setItem('lc_current_user', JSON.stringify(user));
        onAuthSuccess && onAuthSuccess(user);
        setStatus && setStatus('signed-in');
        setSignedInPulse(true);
        setTimeout(() => setSignedInPulse(false), 1000);
      } else {
        setAuthError(json?.error || 'signin failed (invalid json)');
        setStatus && setStatus('signin failed');
      }
    } catch (err) {
      console.error(err);
      setAuthError('server error');
      setStatus && setStatus('auth error');
    } finally {
      setLoading(false);
    }
  }

  function clearAll() {
    setUsername('');
    setUserPassword('');
    setAuthError('');
    localStorage.removeItem('lc_username');
    setRemember(false);
  }

  return (
    <div className="lc-wrap">
      <div className={`lc-card ${authError ? 'err' : ''} ${signedInPulse ? 'pulse' : ''}`}>
        <form className="lc-form" onSubmit={handleAuth} autoComplete="on">
          <header className="lc-head">
            <div>
              <h1 className="lc-logo">LiveCode</h1>
              <div className="lc-sub">Create or join code rooms — collaborate in realtime</div>
            </div>
            <div className="lc-star" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8L12 2Z" fill="currentColor" />
              </svg>
            </div>
          </header>

          <div className={`lc-field ${username ? 'filled' : ''}`}>
            <div className="lc-icon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 12a5 5 0 100-10 5 5 0 000 10zM3 21c0-3 4-5 9-5s9 2 9 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>

            {/* Visible input box styling ensured by CSS below */}
            <input
              className="lc-input"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder=" "
              autoComplete="username"
            />
            <label className="lc-float">Username</label>
          </div>

          <div className={`lc-field ${userPassword ? 'filled' : ''}`}>
            <div className="lc-icon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17 11V8a5 5 0 10-10 0v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><rect x="3" y="11" width="18" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.2"/></svg>
            </div>

            <input
              className="lc-input"
              type={showPassword ? 'text' : 'password'}
              value={userPassword}
              onChange={e => setUserPassword(e.target.value)}
              placeholder=" "
              autoComplete="current-password"
            />
            <label className="lc-float">Password</label>

            <button type="button" className="lc-eye" onClick={() => setShowPassword(s => !s)}>{showPassword ? 'Hide' : 'Show'}</button>
          </div>

          <div className="lc-strength">
            <div className="lc-strength-bar" style={{ '--pct': `${strength.pct}%` }} />
            <div className={`lc-strength-label ${strength.score >= 3 ? 'good' : strength.score === 2 ? 'fair' : 'weak'}`}>
              {userPassword ? strength.label : 'Enter a password'}
            </div>
          </div>

          {authError && <div className="lc-error">{authError}</div>}

          <div className="lc-row">
            <label className="lc-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => {
                  setRemember(e.target.checked);
                  if (!e.target.checked) localStorage.removeItem('lc_username');
                }}
              />
              Remember username
            </label>

            <button type="button" className="lc-forgot" onClick={() => setUserPassword('')}>Forgot?</button>
          </div>

          <div className="lc-actions">
            <button type="submit" className="lc-submit" disabled={loading}>
              {loading ? <span className="lc-spinner" aria-hidden /> : null}
              <span>{loading ? 'Working…' : 'Sign in / Sign up'}</span>
            </button>

            <button type="button" className="lc-clear" onClick={clearAll}>Clear</button>
          </div>

          <div className="lc-or">Or continue with</div>
          <div className="lc-socials">
            <button type="button" className="soc">GitHub</button>
            <button type="button" className="soc">Google</button>
            <button type="button" className="soc">Twitter</button>
          </div>

          <div className="lc-note">This demo auto-creates accounts when username not found. Use secure auth in production.</div>
        </form>
      </div>

      {/* Embedded CSS */}
      <style>{`
        :root {
          --card-w: 420px;
          --muted: #bfc7d6;
          --accent1: #6a5acd;
          --accent2: #8a2be2;
        }

        .lc-wrap {
          min-height:100vh;
          display:flex;
          align-items:center;
          justify-content:center;
          padding:28px;
          background: radial-gradient(1200px 400px at 10% 10%, rgba(106,90,205,0.05), transparent),
                      radial-gradient(1000px 400px at 90% 90%, rgba(138,43,226,0.05), transparent),
                      linear-gradient(135deg,#071126 0%, #0f1724 100%);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial;
        }

        /* card */
        .lc-card {
          width: var(--card-w);
          max-width: calc(100% - 48px);
          border-radius:16px;
          padding:20px;
          background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
          border: 1px solid rgba(255,255,255,0.06);
          box-shadow: 0 18px 50px rgba(2,6,23,0.6), inset 0 1px 0 rgba(255,255,255,0.02);
          transition: transform .25s ease, box-shadow .25s ease;
        }
        .lc-card.pulse { box-shadow: 0 18px 50px rgba(106,90,205,0.24), inset 0 1px 0 rgba(255,255,255,0.02); transform: translateY(-6px) scale(1.01); }

        /* form layout */
        .lc-form{ display:flex; flex-direction:column; gap:8px; }
        .lc-head{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; }
        .lc-logo{ color:#fff; margin:0; font-size:20px; letter-spacing:0.2px; }
        .lc-sub{ color: var(--muted); font-size:13px; margin-top:4px; }
        .lc-star{ width:44px; height:44px; border-radius:10px; display:flex; align-items:center; justify-content:center; color:#fff; background: rgba(255,255,255,0.03); }

        /* field — MADE MORE VISIBLE */
        .lc-field{
          position:relative;
          display:flex;
          align-items:center;
          gap:10px;
          padding:8px 10px;
          border-radius:10px;
          transition: background .12s ease, border-color .12s ease, box-shadow .12s ease;
          border: 1px solid rgba(255,255,255,0.06);        /* explicit border */
          background: rgba(10,14,24,0.55);                 /* stronger contrast */
          z-index:1;
        }
        .lc-field:hover{ background: rgba(255,255,255,0.02); box-shadow: 0 6px 18px rgba(2,6,23,0.4); }
        .lc-field.filled{ background: rgba(255,255,255,0.03); }

        .lc-icon{ color: var(--muted); width:34px; height:34px; display:flex; align-items:center; justify-content:center; z-index:2; }
        .lc-input{
          flex:1;
          background: transparent;  /* field itself has the visible background */
          border:none;
          color:#fff;
          font-size:15px;
          padding:10px 8px;
          outline:none;
          z-index:3;                 /* ensures input sits above label for clicks */
          position:relative;
        }
        .lc-input::placeholder{ color:transparent; }

        /* floating label — sits above input visually but not blocking clicks */
        .lc-float{
          position:absolute;
          left:52px;
          top:12px;
          font-size:13px;
          color:var(--muted);
          pointer-events:none;      /* never blocks clicks */
          transition: transform .14s ease, font-size .14s ease, top .14s ease, color .14s ease;
          z-index:1;
        }
        .lc-field.filled .lc-float,
        .lc-field:focus-within .lc-float{
          transform: translateY(-12px);
          font-size:12px;
          color:#dbe7ff;
        }

        /* focus ring for accessibility */
        .lc-field:focus-within{
          border-color: rgba(106,90,205,0.8);
          box-shadow: 0 8px 28px rgba(106,90,205,0.12);
        }

        .lc-eye{ position:absolute; right:8px; top:50%; transform:translateY(-50%); background:transparent; border:none; color:var(--muted); padding:6px 8px; cursor:pointer; font-size:13px; z-index:4; }

        /* strength meter */
        .lc-strength{ display:flex; align-items:center; gap:10px; margin-top:2px; margin-bottom:2px; }
        .lc-strength-bar{ flex:1; height:8px; border-radius:999px; background: rgba(255,255,255,0.06); overflow:hidden; position:relative; }
        .lc-strength-bar::after{ content:''; position:absolute; left:0; top:0; bottom:0; width: var(--pct, 0%); background: linear-gradient(90deg,#ff6b6b,#f6c85f,#6ee7b7); transition: width 240ms ease; }
        .lc-strength-label{ width:110px; text-align:right; color:var(--muted); font-size:12px; }
        .lc-strength-label.good{ color:#6ee7b7; } .lc-strength-label.fair{ color:#f6c85f; } .lc-strength-label.weak{ color:#ff6b6b; }

        .lc-error{ margin-top:6px; background: rgba(255, 59, 59, 0.06); border-left:3px solid rgba(255,59,59,0.95); padding:8px 10px; color:#ffb6b6; border-radius:6px; font-size:13px; }

        .lc-row{ display:flex; align-items:center; justify-content:space-between; margin-top:4px; }
        .lc-remember{ font-size:13px; color:var(--muted); display:flex; align-items:center; gap:8px; }
        .lc-remember input{ width:14px; height:14px; }
        .lc-forgot{ background:transparent; border:none; color:var(--muted); cursor:pointer; font-size:13px; }

        .lc-actions{ display:flex; gap:10px; margin-top:8px; align-items:center; }
        .lc-submit{ flex:1; display:inline-flex; align-items:center; gap:10px; justify-content:center; padding:10px 12px; border-radius:10px; border:none; cursor:pointer; color:white; font-weight:600; background: linear-gradient(90deg,var(--accent1), var(--accent2)); box-shadow: 0 8px 24px rgba(106,90,205,0.14); transform: translateZ(0); transition: transform .12s ease, box-shadow .12s ease; }
        .lc-submit:hover{ transform: translateY(-3px); box-shadow: 0 18px 36px rgba(106,90,205,0.18); }
        .lc-submit:disabled{ opacity:0.6; cursor:not-allowed; transform:none; box-shadow:none; }

        .lc-spinner{ width:16px; height:16px; border-radius:50%; border:2px solid rgba(255,255,255,0.22); border-top-color:#fff; animation: spin 0.9s linear infinite; display:inline-block; }
        @keyframes spin{ to{ transform: rotate(360deg); } }

        .lc-clear{ padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.06); background:transparent; color:var(--muted); cursor:pointer; min-width:96px; }

        .lc-or{ text-align:center; color:var(--muted); margin-top:12px; font-size:13px; }
        .lc-socials{ display:flex; gap:8px; margin-top:8px; }
        .soc{ flex:1; padding:8px 6px; border-radius:8px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.03); color:var(--muted); cursor:pointer; font-size:13px; }
        .soc:hover{ transform: translateY(-3px); }

        .lc-note{ margin-top:12px; color:#9aa6bd; font-size:12px; text-align:center; }

        /* responsive */
        @media (max-width:460px){
          :root{ --card-w: 92vw; }
          .lc-strength-label{ display:none; }
        }
      `}</style>
    </div>
  );
}
