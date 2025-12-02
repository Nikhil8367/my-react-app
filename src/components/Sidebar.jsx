// src/components/Sidebar.jsx
// Sidebar with pending-approval flow, kick handling, socket event listeners and debug hints.
// Keeps original styles / class names.

import React, { useCallback, useEffect, useMemo, useState } from 'react';

export default function Sidebar(props) {
  const {
    currentUser,
    isOwner,
    roomIdInput,
    setRoomIdInput,
    roomPassInput,
    setRoomPassInput,
    currentRoom,
    createRoom,
    joinRoom,          // should call server join endpoint (parent)
    leaveRoom,         // client local leave logic
    showPass,
    setShowPass,
    files = [],
    createFile,
    openFile,
    deleteFile,        // NEW: delete handler from parent
    users = [],
    members = [],
    changeMemberRole,
    connected,
    isConnecting,
    mergeServerMembersIntoY,
    mergeServerFilesIntoY,
    approveMemberRequest, // (memberId) => Promise
    rejectMemberRequest,  // (memberId) => Promise
    kickMember,           // (memberId) => Promise
    forceDeleteRoom,      // (roomId) => Promise
    pendingMembers = null,
    socket = null        // optional: Socket.IO client instance
  } = props;

  // --- local state + debugging ---
  const [newFileName, setNewFileName] = useState('');
  const [localPending, setLocalPending] = useState(false); // whether current user is pending
  const [lastSocketMsg, setLastSocketMsg] = useState(null);

  // Log initial props for debugging when mounted/updated
  useEffect(() => {
    console.debug('[Sidebar] mounted/props update', {
      currentUser,
      isOwner,
      currentRoomId: currentRoom && currentRoom.id,
      funcs: {
        approveMemberRequest: typeof approveMemberRequest,
        rejectMemberRequest: typeof rejectMemberRequest,
        kickMember: typeof kickMember,
        forceDeleteRoom: typeof forceDeleteRoom,
      }
    });
  }, [currentUser, isOwner, currentRoom, approveMemberRequest, rejectMemberRequest, kickMember, forceDeleteRoom]);

  // Memoized arrays
  const filesMemo = useMemo(() => Array.isArray(files) ? files : [], [files]);
  const usersMemo = useMemo(() => Array.isArray(users) ? users : [], [users]);
  const membersMemo = useMemo(() => Array.isArray(members) ? members : [], [members]);

  // derive pending list
  const pendingList = useMemo(() => {
    if (Array.isArray(pendingMembers)) return pendingMembers;
    return membersMemo.filter(m => m.role === 'pending');
  }, [pendingMembers, membersMemo]);

  // compute current user's role (used to gate delete/edit UI)
  const currentUserRole = useMemo(() => {
    if (!currentUser) return 'none';
    const m = membersMemo.find(mm => mm.id === (currentUser.id || currentUser._id));
    return m ? m.role : 'none';
  }, [membersMemo, currentUser]);

  // Set localPending whenever members or currentUser change
  useEffect(() => {
    if (!currentUser) {
      setLocalPending(false);
      return;
    }
    // defensively support different id fields
    const uid = currentUser.id || currentUser._id || currentUser.userId;
    const m = membersMemo.find(mm => mm.id === uid || mm.user === uid || (mm.user && (mm.user._id ? mm.user._id.toString() === uid : false)));
    const isPending = !!(m && m.role === 'pending');
    console.debug('[Sidebar] localPending check', { uid, foundMember: m, isPending });
    setLocalPending(isPending);
  }, [membersMemo, currentUser]);

  // ---- Socket event handling (if socket provided) ----
  useEffect(() => {
    if (!socket) {
      console.debug('[Sidebar] no socket provided, skipping socket listeners');
      return undefined;
    }

    console.debug('[Sidebar] attaching socket listeners');

    function handleApproved(payload) {
      console.debug('[Sidebar][socket] approved', payload);
      if (!payload) return;
      setLastSocketMsg({ type: 'approved', payload, ts: Date.now() });
      if (payload.roomId && currentRoom && payload.roomId === currentRoom.id) {
        setLocalPending(false);
        if (typeof mergeServerMembersIntoY === 'function') mergeServerMembersIntoY(currentRoom.id);
        // eslint-disable-next-line no-alert
        alert(payload.message || 'You have been approved to join the room.');
      }
    }

    function handleRejected(payload) {
      console.debug('[Sidebar][socket] rejected', payload);
      setLastSocketMsg({ type: 'rejected', payload, ts: Date.now() });
      if (payload && payload.roomId && currentRoom && payload.roomId === currentRoom.id) {
        setLocalPending(false);
        // eslint-disable-next-line no-alert
        alert(payload.message || 'Your request was rejected by the owner.');
        if (typeof leaveRoom === 'function') leaveRoom(true);
      }
    }

    function handleKicked(payload) {
      console.debug('[Sidebar][socket] kicked', payload);
      setLastSocketMsg({ type: 'kicked', payload, ts: Date.now() });
      if (payload && payload.roomId && currentRoom && payload.roomId === currentRoom.id) {
        // eslint-disable-next-line no-alert
        alert(payload.message || 'You have been kicked from the room.');
        if (typeof leaveRoom === 'function') leaveRoom(true);
      }
    }

    function handleRoomDeleted(payload) {
      console.debug('[Sidebar][socket] room_deleted', payload);
      setLastSocketMsg({ type: 'room_deleted', payload, ts: Date.now() });
      if (payload && payload.roomId && currentRoom && payload.roomId === currentRoom.id) {
        // eslint-disable-next-line no-alert
        alert(payload.message || 'Room has been deleted by the owner.');
        if (typeof leaveRoom === 'function') leaveRoom(true);
      }
    }

    function handleMembersUpdated(payload) {
      console.debug('[Sidebar][socket] members_updated', payload);
      setLastSocketMsg({ type: 'members_updated', payload, ts: Date.now() });
      if (payload && payload.roomId && currentRoom && payload.roomId === currentRoom.id) {
        if (typeof mergeServerMembersIntoY === 'function') mergeServerMembersIntoY(currentRoom.id);
      }
    }

    socket.on('approved', handleApproved);
    socket.on('rejected', handleRejected);
    socket.on('kicked', handleKicked);
    socket.on('room_deleted', handleRoomDeleted);
    socket.on('members_updated', handleMembersUpdated);

    return () => {
      console.debug('[Sidebar] removing socket listeners');
      socket.off('approved', handleApproved);
      socket.off('rejected', handleRejected);
      socket.off('kicked', handleKicked);
      socket.off('room_deleted', handleRoomDeleted);
      socket.off('members_updated', handleMembersUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, currentRoom, mergeServerMembersIntoY, leaveRoom]);

  // ---- actions ----
  const onCreateClick = useCallback(() => {
    if (localPending) {
      // eslint-disable-next-line no-alert
      return alert('Waiting for owner approval — cannot create files yet.');
    }
    const name = (newFileName && newFileName.trim()) || `untitled-${Date.now()}`;
    if (typeof createFile === 'function') {
      console.debug('[Sidebar] createFile invoked', name);
      createFile(name);
    } else {
      console.warn('[Sidebar] createFile not provided by parent');
      // eslint-disable-next-line no-alert
      alert('createFile not implemented by parent');
    }
    setNewFileName('');
  }, [newFileName, createFile, localPending]);

  const onJoinClick = useCallback(() => {
    if (typeof joinRoom === 'function') {
      console.debug('[Sidebar] joinRoom invoked', { roomIdInput, roomPassInput });
      joinRoom();
    } else {
      console.warn('[Sidebar] joinRoom not provided by parent');
      // eslint-disable-next-line no-alert
      alert('joinRoom not implemented by parent');
    }
  }, [joinRoom, roomIdInput, roomPassInput]);

  const onCopyCreds = useCallback(async () => {
    if (!roomIdInput || !roomPassInput) return;
    const text = `Room ID: ${roomIdInput}\nRoom Pass: ${roomPassInput}`;
    try {
      await navigator.clipboard.writeText(text);
      // eslint-disable-next-line no-alert
      alert('Room credentials copied to clipboard');
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert('Could not copy to clipboard. Please copy manually.');
    }
  }, [roomIdInput, roomPassInput]);

  const onCopyPass = useCallback(async () => {
    const passToCopy = (currentRoom && currentRoom.pass) || roomPassInput || '';
    if (!passToCopy) return;
    try {
      await navigator.clipboard.writeText(passToCopy);
      // eslint-disable-next-line no-alert
      alert('Password copied to clipboard');
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert('Could not copy password to clipboard.');
    }
  }, [currentRoom, roomPassInput]);

  const onToggleShow = useCallback(() => setShowPass(prev => !prev), [setShowPass]);

  const onExitForget = useCallback(async () => {
    // owner: force-delete; non-owner: leave & forget
    // eslint-disable-next-line no-alert
    if (!window.confirm('Are you sure? This will FORCE disconnect every member and DELETE the room and its data from the server.')) {
      return;
    }

    if (!currentRoom || !currentRoom.id) {
      console.debug('[Sidebar] onExitForget: no currentRoom => local leave');
      leaveRoom(true);
      return;
    }

    if (isOwner && typeof forceDeleteRoom === 'function') {
      try {
        console.debug('[Sidebar] onExitForget: invoking forceDeleteRoom', currentRoom.id);
        await forceDeleteRoom(currentRoom.id);
        // eslint-disable-next-line no-alert
        alert('Room deleted and members force-quit.');
        leaveRoom(true);
      } catch (err) {
        console.error('[Sidebar] forceDeleteRoom failed', err);
        // eslint-disable-next-line no-alert
        alert('Failed to delete room on server.');
      }
      return;
    }

    console.debug('[Sidebar] onExitForget: fallback local leave');
    leaveRoom(true);
  }, [currentRoom, leaveRoom, forceDeleteRoom, isOwner]);

  const onSoftExit = useCallback(() => {
    console.debug('[Sidebar] onSoftExit');
    leaveRoom(false);
  }, [leaveRoom]);

  const onMergeRefresh = useCallback(() => {
    if (!currentRoom) return;
    if (typeof mergeServerMembersIntoY === 'function') mergeServerMembersIntoY(currentRoom.id);
    if (typeof mergeServerFilesIntoY === 'function') mergeServerFilesIntoY(currentRoom.id);
    // eslint-disable-next-line no-alert
    alert('Refreshed members & files');
  }, [currentRoom, mergeServerMembersIntoY, mergeServerFilesIntoY]);

  const onApprove = useCallback(async (memberId) => {
    if (typeof approveMemberRequest !== 'function') {
      console.warn('[Sidebar] approveMemberRequest not implemented on parent');
      // eslint-disable-next-line no-alert
      return alert('approveMemberRequest not implemented on parent.');
    }
    try {
      console.debug('[Sidebar] approving member', memberId);
      await approveMemberRequest(memberId);
      if (typeof mergeServerMembersIntoY === 'function' && currentRoom) mergeServerMembersIntoY(currentRoom.id);
    } catch (err) {
      console.error('[Sidebar] approveMemberRequest error', err);
      // eslint-disable-next-line no-alert
      alert('Failed to approve member.');
    }
  }, [approveMemberRequest, mergeServerMembersIntoY, currentRoom]);

  const onReject = useCallback(async (memberId) => {
    if (typeof rejectMemberRequest !== 'function') {
      console.warn('[Sidebar] rejectMemberRequest not implemented on parent');
      // eslint-disable-next-line no-alert
      return alert('rejectMemberRequest not implemented on parent.');
    }
    try {
      console.debug('[Sidebar] rejecting member', memberId);
      await rejectMemberRequest(memberId);
      if (typeof mergeServerMembersIntoY === 'function' && currentRoom) mergeServerMembersIntoY(currentRoom.id);
    } catch (err) {
      console.error('[Sidebar] rejectMemberRequest error', err);
      // eslint-disable-next-line no-alert
      alert('Failed to reject member.');
    }
  }, [rejectMemberRequest, mergeServerMembersIntoY, currentRoom]);

  const onKick = useCallback(async (memberId) => {
    if (!window.confirm('Kick this member? They will be disconnected immediately.')) return;
    if (typeof kickMember !== 'function') {
      console.warn('[Sidebar] kickMember not implemented on parent');
      // eslint-disable-next-line no-alert
      return alert('kickMember not implemented on parent.');
    }
    try {
      console.debug('[Sidebar] kicking member', memberId);
      await kickMember(memberId);
      if (typeof mergeServerMembersIntoY === 'function' && currentRoom) mergeServerMembersIntoY(currentRoom.id);
    } catch (err) {
      console.error('[Sidebar] kickMember error', err);
      // eslint-disable-next-line no-alert
      alert('Failed to kick member.');
    }
  }, [kickMember, mergeServerMembersIntoY, currentRoom]);

  // Helper small components
  function Avatar({ name }) {
    return (
      <div className="avatar small" style={{ background: colorForName(name) }}>
        {(name || '?')[0].toUpperCase()}
      </div>
    );
  }

  function FileRow({ f }) {
    // allow delete for owners and editors
    const canDelete = isOwner || currentUserRole === 'editor';
    return (
      <div
        className="file-row"
        style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', alignItems: 'center' }}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => openFile && openFile(f)}
          onKeyDown={(e) => { if (e.key === 'Enter') openFile && openFile(f); }}
          style={{ cursor: 'pointer', flex: 1 }}
          title={f.name}
        >
          {f.name}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="muted small">{f.createdAt ? new Date(f.createdAt).toLocaleTimeString() : ''}</div>
          <button
            className="btn ghost"
            onClick={() => {
              if (!canDelete) {
                // eslint-disable-next-line no-alert
                return alert('Only owners or editors can delete files.');
              }
              // eslint-disable-next-line no-alert
              if (!window.confirm(`Delete file "${f.name}"? This action cannot be undone.`)) return;
              if (typeof deleteFile === 'function') {
                deleteFile(f.fileId);
              } else {
                // eslint-disable-next-line no-alert
                alert('deleteFile not implemented by parent.');
              }
            }}
            title={canDelete ? 'Delete file' : 'Cannot delete'}
            aria-disabled={!canDelete}
            disabled={!canDelete}
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  function UserRow({ u }) {
    const keyFor = (u && (u.id || u.short)) || Math.random();
    return (
      <div key={keyFor} className="user-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatar name={u.name} />
        <div style={{ marginLeft: 8, flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="muted small">{u.short ? `id: ${u.short}` : ''}</div>
        </div>
        {currentRoom && currentRoom.ownerId === u.id ? <div className="badge">owner</div> : null}
      </div>
    );
  }

  function MemberRow({ m }) {
    const canManage = isOwner && currentUser && m.id !== currentUser.id;
    const isPending = m.role === 'pending';
    return (
      <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="avatar small" style={{ background: colorForName(m.username) }}>{(m.username || '?')[0].toUpperCase()}</div>
          <div>
            <div style={{ fontWeight: 600 }}>{m.username}</div>
            <div className="muted small">{isPending ? 'pending' : m.role}</div>
          </div>
        </div>

        {isOwner ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {isPending ? (
              <>
                <button className="btn" onClick={() => onApprove(m.id)}>Accept</button>
                <button className="btn ghost" onClick={() => onReject(m.id)}>Reject</button>
              </>
            ) : (m.id !== currentUser?.id ? (
              <>
                <select
                  value={m.role}
                  onChange={(e) => changeMemberRole && changeMemberRole(m.id, e.target.value)}
                >
                  <option value="member">member</option>
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                  <option value="owner">owner</option>
                </select>
                <button className="btn ghost" onClick={() => onKick(m.id)}>Kick</button>
              </>
            ) : null)}
          </div>
        ) : null}
      </div>
    );
  }

  // Render
  return (
    <aside className="sidebar">
      <div className="card-title">Room Controls</div>

      <button
        className="btn primary full"
        onClick={() => { if (typeof createRoom === 'function') createRoom(); else { console.warn('[Sidebar] createRoom not implemented on parent'); alert('createRoom not implemented'); } }}
        aria-label="Create room"
        disabled={isConnecting}
      >
        Create room (auto id & pass)
      </button>

      {!currentRoom ? (
        <>
          <div style={{ marginTop: 12 }}>
            <label className="label">Room ID</label>
            <input
              className="input"
              value={roomIdInput || ''}
              onChange={e => setRoomIdInput && setRoomIdInput(e.target.value)}
              placeholder="Room id"
              aria-label="Room ID"
            />
          </div>

          <div style={{ marginTop: 8 }}>
            <label className="label">Room password</label>
            <input
              className="input"
              value={roomPassInput || ''}
              onChange={e => setRoomPassInput && setRoomPassInput(e.target.value)}
              placeholder="Room password"
              aria-label="Room password"
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" disabled={isConnecting} onClick={onJoinClick}>
              {isConnecting ? 'Connecting…' : 'Join room'}
            </button>
            <button className="btn ghost" onClick={onCopyCreds} aria-label="Copy credentials">
              Copy creds
            </button>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 6 }}>
            <div className="muted small">Connected to</div>
            <div style={{ fontWeight: 700 }}>{currentRoom.id}</div>
          </div>

          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="muted small">Room password</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ fontFamily: 'monospace', padding: '6px 8px', background: '#071022', borderRadius: 6 }}>
                  {showPass && currentRoom.pass ? currentRoom.pass : (showPass ? '—' : '••••••••')}
                </div>
                <button className="btn" onClick={onCopyPass}>Copy</button>
                <button className="btn ghost" onClick={onToggleShow}>{showPass ? 'Hide' : 'Show'}</button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            {/* Owner's Exit & Delete: force deletes room on server and kicks members */}
            {isOwner ? (
              <button className="btn ghost" onClick={onExitForget}>Exit & Forget creds (force delete)</button>
            ) : (
              <button className="btn ghost" onClick={() => leaveRoom(true)}>Exit & Forget creds</button>
            )}
            <button className="btn" onClick={onSoftExit} style={{ marginLeft: 8 }}>Soft Exit (rejoin on refresh)</button>
          </div>
        </div>
      )}

      {/* If current user is pending, show prominent waiting box */}
      {localPending && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: '#0b1a2b', border: '1px solid rgba(159,176,214,0.08)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Waiting for owner approval</div>
          <div className="muted small">Your request to join this room is pending. The owner will accept or reject shortly.</div>
        </div>
      )}

      {/* Pending requests (owner only) */}
      {isOwner && (pendingList && pendingList.length > 0) ? (
        <div style={{ marginTop: 18 }}>
          <div className="card-title">Pending requests</div>
          <div style={{ marginTop: 8 }}>
            {pendingList.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div className="avatar small" style={{ background: colorForName(p.username || p.name) }}>{((p.username || p.name) || '?')[0].toUpperCase()}</div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.username || p.name}</div>
                    <div className="muted small">{p.email || p.id}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn" onClick={() => onApprove(p.id)}>Accept</button>
                  <button className="btn ghost" onClick={() => onReject(p.id)}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <div className="card-title">Files</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            className="input"
            placeholder={localPending ? "Waiting for approval..." : "New file name"}
            style={{ flex: 1 }}
            value={newFileName}
            onChange={e => setNewFileName(e.target.value)}
            aria-label="New file name"
            disabled={localPending}
          />
          <button className="btn" onClick={onCreateClick} disabled={localPending}>Create</button>
        </div>
        <div style={{ marginTop: 10 }}>
          {filesMemo.length === 0 ? <div className="muted small">No files</div> : filesMemo.map((f) => (
            <FileRow key={f.fileId} f={f} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="card-title">Connected users</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {usersMemo.length === 0
            ? <div className="muted small">No users</div>
            : usersMemo.map((u) => <UserRow key={u.id || u.short || u.name} u={u} />)}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="card-title">Members</div>
        <div style={{ marginTop: 8 }}>
          {membersMemo.length === 0
            ? <div className="muted small">No members</div>
            : membersMemo.map((m) => <MemberRow key={m.id} m={m} />)}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="card-title">Session</div>
        <div className="muted small" style={{ marginTop: 8 }}>
          Realtime: {connected ? <span style={{ color: '#7ee787' }}>connected</span> : <span style={{ color: '#ffb4b4' }}>disconnected</span>}
        </div>
      </div>
    </aside>
  );
}

// helper locally scoped to Sidebar for color generation
function colorForName(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h << 5) - h + name.charCodeAt(i);
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 70% 60%)`;
}
