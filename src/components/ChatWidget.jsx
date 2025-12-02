// src/components/ChatWidget.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';

/**
 * ChatWidget
 * Props:
 * - currentUser { id, username }
 * - members []
 * - messages []  (array of { id, senderId, senderName, text, ts })
 * - unreadCount number
 * - showPanel boolean
 * - onToggle(fn)
 * - onSend(text)
 */
export default function ChatWidget({
  currentUser,
  members = [],
  messages = [],
  unreadCount = 0,
  showPanel = false,
  onToggle = () => {},
  onSend = () => {}
}) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // 1) De-duplicate incoming messages by id and keep the LAST occurrence (so if same id appears twice, last one wins)
  const uniqueMessages = useMemo(() => {
    const map = new Map();
    // iterate and overwrite to ensure last occurrence wins
    (messages || []).forEach(m => {
      if (!m || !m.id) return;
      map.set(m.id, m);
    });
    // maintain original chronological order by sorting by timestamp if present,
    // fallback to insertion order from map.values()
    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      const ta = a.ts ? new Date(a.ts).getTime() : 0;
      const tb = b.ts ? new Date(b.ts).getTime() : 0;
      return ta - tb;
    });
    return arr;
  }, [messages]);

  // helper to detect whether user is near bottom (within 120px)
  function isNearBottom() {
    const el = scrollRef.current;
    if (!el) return true;
    const threshold = 120;
    return (el.scrollHeight - (el.scrollTop + el.clientHeight)) < threshold;
  }

  // auto-scroll only when panel opens OR when user was already near bottom
  useEffect(() => {
    if (!showPanel) return;
    const el = scrollRef.current;
    if (!el) return;
    // If user was near bottom, scroll to bottom when messages change
    if (isNearBottom()) {
      setTimeout(() => bottomRef.current && bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' }), 40);
    }
  }, [uniqueMessages, showPanel]);

  // focus input when opening
  useEffect(() => {
    if (showPanel && inputRef.current) {
      setTimeout(() => inputRef.current.focus(), 80);
    }
  }, [showPanel]);

  function handleSend(e) {
    if (e) e.preventDefault();
    const txt = input && input.trim();
    if (!txt) return;
    onSend(txt);
    setInput('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {/* Floating icon */}
      <div className="chat-float" aria-hidden={showPanel}>
        <button
          aria-label={showPanel ? 'Close chat' : 'Open chat'}
          className="chat-icon"
          onClick={() => onToggle(!showPanel)}
          title="Room chat"
        >
          <div className="chat-bubble-ico" aria-hidden>💬</div>
          {unreadCount > 0 && <div className="chat-unread" aria-live="polite">{unreadCount}</div>}
        </button>
      </div>

      {/* Chat panel */}
      <div className={`chat-panel ${showPanel ? 'open' : ''}`} role="dialog" aria-hidden={!showPanel}>
        <div className="chat-header">
          <div style={{ fontWeight: 700 }}>Room Chat</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="muted small">{members.length} members</div>
            <button className="btn ghost" onClick={() => onToggle(false)}>Close</button>
          </div>
        </div>

        <div
          className="chat-body"
          role="log"
          aria-live="polite"
          ref={scrollRef}
          style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, overflow: 'auto' }}
        >
          {uniqueMessages.length === 0 ? (
            <div className="muted small" style={{ padding: 12 }}>No messages yet — say hi 👋</div>
          ) : (
            uniqueMessages.map((m) => {
              const mine = currentUser && (m.senderId === currentUser.id);
              return (
                <div
                  key={m.id}
                  className={`chat-msg ${mine ? 'mine' : ''}`}
                  style={{
                    alignSelf: mine ? 'flex-end' : 'flex-start',
                    maxWidth: '78%',
                    background: mine ? 'rgba(100,130,255,0.12)' : 'rgba(255,255,255,0.03)',
                    padding: '8px 10px',
                    borderRadius: 8,
                    marginBottom: 4
                  }}
                  title={m.senderName}
                  aria-label={`${m.senderName}: ${m.text}`}
                >
                  <div className="chat-meta" style={{ fontSize: 12, color: '#bcd', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong style={{ color: '#cfe' }}>{m.senderName || 'Unknown'}</strong>
                    <span className="muted small" style={{ marginLeft: 8, color: '#9fb' }}>{m.ts ? new Date(m.ts).toLocaleTimeString() : ''}</span>
                  </div>
                  <div className="chat-text" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{m.text}</div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <form className="chat-footer" onSubmit={handleSend} style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid rgba(255,255,255,0.03)' }}>
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder="Type a message… (Enter to send, Shift+Enter newline)"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            style={{ flex: 1, resize: 'none', padding: '8px 10px', borderRadius: 6, background: '#071022', color: '#e6eef8', border: '1px solid #123' }}
          />
          <button className="btn primary" type="submit" disabled={!input.trim()}>Send</button>
        </form>
      </div>
    </>
  );
}
