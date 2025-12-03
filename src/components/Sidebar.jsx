// src/components/Sidebar.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Sidebar — combined version:
 * - Centered modal system (used ONLY for: accept, reject, kick, room delete)
 * - Restored Join UI
 * - Socket listeners (approved/rejected/kicked/room_deleted/members_updated)
 * - Owner cannot manage themselves; role-select uses black background
 * - Enhanced styles and UI
 * - MAIN CONTENT is scrollable; FOOTER is fixed (not part of scroll)
 */

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
    joinRoom,
    leaveRoom,
    showPass,
    setShowPass,
    files = [],
    createFile,
    openFile,
    deleteFile,
    users = [],
    members = [],
    changeMemberRole,
    connected,
    isConnecting,
    mergeServerMembersIntoY,
    mergeServerFilesIntoY,
    approveMemberRequest,
    rejectMemberRequest,
    kickMember,
    forceDeleteRoom,
    pendingMembers = null,
    socket = null
  } = props;

  // ----- Modal system (local) -----
  const [modal, setModal] = useState({ open: false, type: null, title: '', body: null, resolve: null });
  const showAlert = useCallback((title, body) => {
    return new Promise((res) => {
      setModal({ open: true, type: 'alert', title: title || 'Notice', body: body || '', resolve: res });
    });
  }, []);
  const showConfirm = useCallback((title, body) => {
    return new Promise((res) => {
      setModal({ open: true, type: 'confirm', title: title || 'Confirm', body: body || '', resolve: res });
    });
  }, []);
  const closeModal = useCallback((result) => {
    if (modal.resolve) modal.resolve(result);
    setModal({ open: false, type: null, title: '', body: null, resolve: null });
  }, [modal]);

  // ----- debug and local states -----
  const [newFileName, setNewFileName] = useState('');
  const [localPending, setLocalPending] = useState(false);
  const [lastClicked, setLastClicked] = useState(null);
  const [joining, setJoining] = useState(false);
  const [lastSocketMsg, setLastSocketMsg] = useState(null);

  // transient click visual indicator id
  const transientClick = (id, ms = 320) => {
    setLastClicked(id);
    window.setTimeout(
      () => setLastClicked(prev => (prev === id ? null : prev)),
      ms
    );
  };

  // friendly display name / initials
  const displayName = useMemo(() => {
    if (!currentUser) return 'Guest';
    return currentUser.name || currentUser.username || currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : 'Guest');
  }, [currentUser]);
  const initials = useMemo(() => {
    if (!displayName) return 'G';
    return displayName.split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase();
  }, [displayName]);

  // memoized arrays
  const filesMemo = useMemo(() => (Array.isArray(files) ? files : []), [files]);
  const usersMemo = useMemo(() => (Array.isArray(users) ? users : []), [users]);
  const membersMemo = useMemo(() => (Array.isArray(members) ? members : []), [members]);
  const pendingList = useMemo(() => Array.isArray(pendingMembers) ? pendingMembers : membersMemo.filter(m => m.role === 'pending'), [pendingMembers, membersMemo]);

  // compute current user's role
  const currentUserRole = useMemo(() => {
    if (!currentUser) return 'none';
    const m = membersMemo.find(mm => mm.id === (currentUser.id || currentUser._id || currentUser.userId));
    return m ? m.role : 'none';
  }, [membersMemo, currentUser]);

  // --- initial debug log when props update (from original code) ---
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

  // set localPending whenever members or currentUser change (defensive)
  useEffect(() => {
    const uid = currentUser?.id || currentUser?._id || currentUser?.userId;
    const found = (Array.isArray(members) ? members : []).find(m => (m.id === uid) || (m.user === uid) || (m._id === uid));
    setLocalPending(!!(found && found.role === 'pending'));
  }, [members, currentUser]);

  // ---- Socket event handling (if socket provided) ----
  useEffect(() => {
    if (!socket) {
      console.debug('[Sidebar] no socket provided, skipping socket listeners');
      return undefined;
    }

    console.debug('[Sidebar] attaching socket listeners');

    async function handleApproved(payload) {
      console.debug('[Sidebar][socket] approved', payload);
      if (!payload) return;
      setLastSocketMsg({ type: 'approved', payload, ts: Date.now() });
      if (payload.roomId && currentRoom && payload.roomId === currentRoom.id) {
        setLocalPending(false);
        if (typeof mergeServerMembersIntoY === 'function') mergeServerMembersIntoY(currentRoom.id);
        // no popup per request
      }
    }

    async function handleRejected(payload) {
      console.debug('[Sidebar][socket] rejected', payload);
      setLastSocketMsg({ type: 'rejected', payload, ts: Date.now() });
      if (payload && payload.roomId && currentRoom && payload.roomId === currentRoom.id) {
        setLocalPending(false);
        if (typeof leaveRoom === 'function') leaveRoom(true);
      }
    }

    async function handleKicked(payload) {
      console.debug('[Sidebar][socket] kicked', payload);
      setLastSocketMsg({ type: 'kicked', payload, ts: Date.now() });
      if (payload && payload.roomId && currentRoom && payload.roomId === currentRoom.id) {
        await showAlert('Kicked', payload.message || 'You have been kicked from the room.');
        if (typeof leaveRoom === 'function') leaveRoom(true);
      }
    }

    async function handleRoomDeleted(payload) {
      console.debug('[Sidebar][socket] room_deleted', payload);
      setLastSocketMsg({ type: 'room_deleted', payload, ts: Date.now() });
      if (payload && payload.roomId && currentRoom && payload.roomId === currentRoom.id) {
        await showAlert('Room deleted', payload.message || 'Room has been deleted by the owner.');
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
  }, [socket, currentRoom, mergeServerMembersIntoY, leaveRoom, showAlert]);

  // ---- actions ----

  const onCreateClick = useCallback(async () => {
    if (localPending) {
      transientClick('create');
      return;
    }
    const name = (newFileName && newFileName.trim()) || `untitled-${Date.now()}`;
    transientClick('create');
    if (typeof createFile === 'function') {
      createFile(name);
    } else {
      console.warn('[Sidebar] createFile not implemented by parent');
    }
    setNewFileName('');
  }, [newFileName, createFile, localPending]);

  const onJoinClick = useCallback(async () => {
    transientClick('join');
    setJoining(true);
    try {
      if (typeof joinRoom === 'function') await joinRoom();
      else console.warn('[Sidebar] joinRoom not implemented by parent');
    } catch (err) {
      console.error('[Sidebar] join failed', err);
    }
    setJoining(false);
  }, [joinRoom]);

  const onCopyCreds = useCallback(async () => {
    if (!roomIdInput && !roomPassInput) return;
    try {
      await navigator.clipboard.writeText(`Room ID: ${roomIdInput}\nRoom Pass: ${roomPassInput}`);
      transientClick('copyCreds');
    } catch (e) {
      console.error('[Sidebar] copy creds failed', e);
      transientClick('copyCreds');
    }
  }, [roomIdInput, roomPassInput]);

  const onCopyPass = useCallback(async () => {
    const passToCopy = (currentRoom && currentRoom.pass) || roomPassInput || '';
    if (!passToCopy) return;
    try {
      await navigator.clipboard.writeText(passToCopy);
      transientClick('copyPass');
    } catch (e) {
      console.error('[Sidebar] copy pass failed', e);
      transientClick('copyPass');
    }
  }, [currentRoom, roomPassInput]);

  const onToggleShow = useCallback(() => {
    transientClick('toggleShow');
    setShowPass && setShowPass(p => !p);
  }, [setShowPass]);

  const onExitForget = useCallback(async () => {
    transientClick('exitForget');

    if (isOwner) {
      const ok = await showConfirm('Confirm delete room', 'DELETE room for everyone and disconnect members? This is irreversible.');
      if (!ok) return;

      if (!currentRoom || !currentRoom.id) {
        leaveRoom(true);
        return;
      }

      if (typeof forceDeleteRoom === 'function') {
        try {
          await forceDeleteRoom(currentRoom.id);
          await showAlert('Deleted', 'Room deleted');
          leaveRoom(true);
        } catch (err) {
          console.error('[Sidebar] forceDeleteRoom failed', err);
        }
      }
      return;
    }

    leaveRoom(true);
  }, [currentRoom, leaveRoom, forceDeleteRoom, isOwner, showConfirm, showAlert]);

  const onSoftExit = useCallback(() => {
    transientClick('softExit');
    leaveRoom(false);
  }, [leaveRoom]);

  const onMergeRefresh = useCallback(async () => {
    transientClick('refresh');
    if (currentRoom) {
      if (typeof mergeServerMembersIntoY === 'function') mergeServerMembersIntoY(currentRoom.id);
      if (typeof mergeServerFilesIntoY === 'function') mergeServerFilesIntoY(currentRoom.id);
    }
  }, [currentRoom, mergeServerMembersIntoY, mergeServerFilesIntoY]);

  // ---- actions that SHOULD have popups ----

  const onApprove = useCallback(async (memberId) => {
    transientClick(`approve-${memberId}`);
    if (typeof approveMemberRequest !== 'function') { console.warn('[Sidebar] approveMemberRequest not provided'); return; }
    try {
      await approveMemberRequest(memberId);
      if (typeof mergeServerMembersIntoY === 'function' && currentRoom) mergeServerMembersIntoY(currentRoom.id);
      await showAlert('Approved', 'Member approved');
    } catch (err) {
      console.error(err);
      await showAlert('Error', 'Failed to approve member');
    }
  }, [approveMemberRequest, mergeServerMembersIntoY, currentRoom, showAlert]);

  const onReject = useCallback(async (memberId) => {
    transientClick(`reject-${memberId}`);
    if (typeof rejectMemberRequest !== 'function') { console.warn('[Sidebar] rejectMemberRequest not provided'); return; }
    try {
      await rejectMemberRequest(memberId);
      if (typeof mergeServerMembersIntoY === 'function' && currentRoom) mergeServerMembersIntoY(currentRoom.id);
      await showAlert('Rejected', 'Member rejected');
    } catch (err) {
      console.error(err);
      await showAlert('Error', 'Failed to reject member');
    }
  }, [rejectMemberRequest, mergeServerMembersIntoY, currentRoom, showAlert]);

  const onKick = useCallback(async (memberId) => {
    const ok = await showConfirm('Kick member', 'Kick this member? They will be disconnected immediately.');
    transientClick(`kick-${memberId}`);
    if (!ok) return;
    if (typeof kickMember !== 'function') { console.warn('[Sidebar] kickMember not implemented'); return; }
    try {
      await kickMember(memberId);
      if (typeof mergeServerMembersIntoY === 'function' && currentRoom) mergeServerMembersIntoY(currentRoom.id);
      await showAlert('Kicked', 'Member kicked');
    } catch (err) {
      console.error(err);
      await showAlert('Error', 'Failed to kick member');
    }
  }, [kickMember, mergeServerMembersIntoY, currentRoom, showConfirm, showAlert]);

  const onChangeRole = useCallback(async (memberId, newRole) => {
    if (newRole === 'owner') {
      const ok = await showConfirm('Assign owner', 'Are you sure you want to make this user an owner?');
      if (!ok) return;
    }
    if (typeof changeMemberRole === 'function') {
      try {
        await changeMemberRole(memberId, newRole);
        if (typeof mergeServerMembersIntoY === 'function' && currentRoom) mergeServerMembersIntoY(currentRoom.id);
      } catch (err) {
        console.error(err);
      }
    } else {
      console.warn('[Sidebar] changeMemberRole not implemented by parent');
    }
  }, [changeMemberRole, mergeServerMembersIntoY, currentRoom, showConfirm]);

  // small components
  function Avatar({ name, size = 48, status = null }) {
    return (
      <div className="sc-avatar" style={{ width: size, height: size, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: size > 40 ? 18 : 14 }}>
        <span>{initials}</span>
        {status !== null && <span className={`status-dot ${status ? 'online' : 'offline'}`} aria-hidden="true" />}
      </div>
    );
  }

  function FileRow({ f }) {
    const canDelete = isOwner || currentUserRole === 'editor';
    return (
      <div className="sc-row file" role="listitem">
        <div className="sc-file-main" onClick={() => openFile && openFile(f)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openFile && openFile(f); }}>
          <div className="sc-file-thumb">{f.name ? f.name[0]?.toUpperCase() : 'F'}</div>
          <div className="sc-file-meta">
            <div className="sc-file-name">{f.name}</div>
            <div className="sc-file-sub muted">{f.createdAt ? new Date(f.createdAt).toLocaleString() : ''}</div>
          </div>
        </div>
        <div className="sc-file-actions">
          <button className="btn ghost small" disabled={!canDelete} onClick={async (e) => {
            e.stopPropagation();
            if (!canDelete) { return; }
            const ok = await showConfirm('Delete file', `Delete ${f.name}? This action cannot be undone.`);
            if (!ok) return;
            if (typeof deleteFile === 'function') deleteFile(f.fileId);
          }}>{'Delete'}</button>
        </div>
      </div>
    );
  }

  function MemberRow({ m }) {
    const isPending = m.role === 'pending';
    const isSelf = currentUser && (m.id === (currentUser.id || currentUser._id || currentUser.userId));

    return (
      <div className="sc-row member">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 44 }}><Avatar name={m.username || m.name} size={44} status={m.online} /></div>
          <div>
            <div style={{ fontWeight: 800 }}>{m.username || m.name}</div>
            <div className="muted small">{isPending ? 'pending approval' : `role: ${m.role}`}</div>
          </div>
        </div>

        {isOwner && !isSelf ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isPending ? (
              <>
                <button className="btn primary small" onClick={() => onApprove(m.id)}>Accept</button>
                <button className="btn ghost small" onClick={() => onReject(m.id)}>Reject</button>
              </>
            ) : (
              <>
                <select className="role-select" defaultValue={m.role} onChange={(e) => onChangeRole(m.id, e.target.value)} aria-label={`Change role for ${m.username || m.name}`}>
                  <option value="member">member</option>
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                  <option value="owner">owner</option>
                </select>
                <button className="btn ghost small" onClick={() => onKick(m.id)}>Kick</button>
              </>
            )}
          </div>
        ) : (
          <div className="badge small">{currentRoom && currentRoom.ownerId === m.id ? 'owner' : ''}</div>
        )}
      </div>
    );
  }

  const handleRoomInputKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); onJoinClick(); } };
  const handleNewFileKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); onCreateClick(); } };

  // Render
  return (
    <aside className="sc-side" aria-label="Room sidebar">
      <style>{`
        /* Upgraded design: neon accents, smooth shadows */
        .sc-side { width: 360px; height: 100%; display: flex; flex-direction: column; border-radius: 14px; background: linear-gradient(180deg, rgba(6,14,24,0.96), rgba(4,9,16,0.98)); border: 1px solid rgba(255,255,255,0.03); box-shadow: 0 12px 40px rgba(3,9,20,0.75); overflow: hidden; }
        .sc-main { padding: 20px; box-sizing: border-box; display: flex; flex-direction: column; gap: 18px; flex: 1 1 auto; overflow: auto; }
        .sc-header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .sc-title { font-size:20px; font-weight:900; color: #e6f8ff; letter-spacing: -0.3px; }
        .sc-sub { font-size:12px; color:#9fb0c7; }

        .sc-avatar { position: relative; background: linear-gradient(135deg,#3aa3ff,#7ce6b2); color:#02121a; display:flex; align-items:center; justify-content:center; font-weight:900; width:48px; height:48px; border-radius:12px; }
        .status-dot { position:absolute; right:-4px; bottom:-4px; width:12px; height:12px; border-radius:50%; border: 2px solid rgba(2,8,16,0.9); }
        .status-dot.online { background: #7ee787; }
        .status-dot.offline { background: #ff7b7b; }

        .sc-newroom { display:flex; justify-content:flex-end; }
        .sc-newroom .btn { padding:8px 12px; }

        .sc-join { padding: 10px; border-radius: 10px; background: rgba(255,255,255,0.02); display:flex; gap:8px; align-items:center; }
        .sc-join .input { padding:8px 10px; border-radius:8px; background: rgba(0,0,0,0.45); color:#fff; border: 1px solid rgba(255,255,255,0.04); }

        .sc-cred { padding:12px; border-radius:12px; background: linear-gradient(180deg, rgba(11,22,36,0.6), rgba(6,12,20,0.35)); border: 1px solid rgba(255,255,255,0.03); display:flex; flex-direction:column; gap:10px; }
        .sc-cred-pass { font-family: 'Roboto Mono', monospace; font-size:13px; background: rgba(255,255,255,0.02); padding:10px 12px; border-radius:10px; color:#dff1ff; flex:1; }
        .sc-actions { display:flex; gap:8px; flex-wrap:wrap; }
        .btn { padding:8px 12px; border-radius:10px; background: linear-gradient(180deg,#1f6f6f 0%, #1b8ea3 100%); color:#fff; border:none; cursor:pointer; font-weight:700; transition: transform .08s ease, box-shadow .12s ease; }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(32,140,200,0.12); }
        .btn.ghost { background:transparent; border:1px solid rgba(255,255,255,0.04); color:#cfe8ff; }
        .btn.small { padding:6px 10px; font-size:13px; }
        .btn.primary { background:linear-gradient(90deg,#6fc8ff 0%,#6aa4ff 100%); }

        .sc-files { display:flex; flex-direction:column; gap:12px; padding-right:6px; }
        .section-head { display:flex; justify-content:space-between; align-items:center; }
        .sc-add { display:flex; gap:8px; }
        .sc-input { padding:10px 12px; border-radius:10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.03); color:#dff3ff; flex:1; }

        .sc-row { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px; border-radius:12px; transition: background .12s ease, transform .08s ease; }
        .sc-row:hover { background: linear-gradient(180deg, rgba(255,255,255,0.012), rgba(255,255,255,0.008)); transform: translateY(-4px); }

        .sc-file-main { display:flex; gap:12px; align-items:center; cursor:pointer; flex:1; }
        .sc-file-thumb { width:48px; height:48px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-weight:900; background: linear-gradient(135deg,#20304a,#12212b); color:#bfe8ff; }
        .sc-file-name { font-weight:800; color:#e9faff; }
        .sc-file-sub { font-size:12px; color:#9fb0c7; }

        .muted { color:#9fb0c7; }
        .badge { padding:6px 10px; border-radius:8px; background: rgba(126,231,135,0.10); color:#7ee787; font-weight:700; font-size:12px; }

        .role-select { padding:8px 10px; border-radius:8px; background: #000; color:#eaf6ff; border:1px solid rgba(255,255,255,0.04); }
        select { padding:8px 10px; border-radius:8px; background: rgba(255,255,255,0.02); color:#eaf6ff; border:1px solid rgba(255,255,255,0.03); }

        .sc-files::-webkit-scrollbar, .sc-main::-webkit-scrollbar { width: 10px; }
        .sc-files::-webkit-scrollbar-thumb, .sc-main::-webkit-scrollbar-thumb { background: linear-gradient(180deg,#0f2a36,#06121a); border-radius: 10px; }

        /* modal styles */
        .sc-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; z-index: 9999; }
        .sc-modal { width: 480px; max-width: 92%; background: linear-gradient(180deg,#071428,#091a2a); border-radius:12px; padding:18px; box-shadow: 0 12px 40px rgba(2,8,23,0.8); border:1px solid rgba(255,255,255,0.03); }
        .sc-modal h3 { margin:0 0 8px 0; color:#eaf6ff; }
        .sc-modal p { color:#cfe8ff; margin:8px 0 14px 0; }
        .sc-modal .actions { display:flex; justify-content:flex-end; gap:8px; }

        /* Footer area: keep visible and not scrollable */
        .sc-footer { padding: 12px 20px; border-top: 1px dashed rgba(255,255,255,0.02); display:flex; justify-content:space-between; align-items:center; gap:12px; background: linear-gradient(180deg, rgba(6,14,24,0.96), rgba(4,9,16,0.98)); }

        @media (max-width: 900px) { .sc-side { width: 84px; } .sc-title { display:none; } .sc-main { padding: 12px; } .sc-footer { padding: 10px 12px; } }
      `}</style>

      {/* MAIN scrollable area */}
      <div className="sc-main">
        {/* header */}
        <div className="sc-header">
          <div>
            <div className="sc-title">LiveCode</div>
            <div className="sc-sub">realtime · connected</div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 900 }}>{displayName}</div>
              <div className="muted small">{currentUser ? `signed-in · role: ${currentUserRole}` : 'not signed'}</div>
            </div>
            <Avatar name={displayName} status={connected} />
          </div>
        </div>

        {/* New room above cred */}
        <div className="sc-newroom">
          <button className="btn small" onClick={() => { transientClick('createRoom'); if (typeof createRoom === 'function') createRoom(); else console.warn('[Sidebar] createRoom not provided'); }}>{isConnecting ? 'Creating…' : 'New room'}</button>
        </div>

        {/* Join UI: shown when not in a currentRoom */}
        {!currentRoom && (
          <div className="sc-join">
            <input className="input" placeholder="Room ID" value={roomIdInput || ''} onChange={e => setRoomIdInput && setRoomIdInput(e.target.value)} onKeyDown={handleRoomInputKey} aria-label="Room ID" />
            <input className="input" placeholder="Room password" value={roomPassInput || ''} onChange={e => setRoomPassInput && setRoomPassInput(e.target.value)} onKeyDown={handleRoomInputKey} aria-label="Room password" />
            <button className="btn primary small" onClick={onJoinClick} disabled={joining}>{joining ? 'Joining…' : 'Join'}</button>
            <button className="btn ghost small" onClick={onCopyCreds}>Copy creds</button>
          </div>
        )}

        {/* credentials card */}
        <div className="sc-cred">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="muted small">Room password</div>
            <div className="muted small">{currentRoom ? 'Connected' : 'Not connected'}</div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="sc-cred-pass">{showPass && currentRoom?.pass ? currentRoom.pass : (currentRoom?.pass ? '••••••••' : (roomPassInput || '—'))}</div>
            <button className="btn small" onClick={onCopyPass}>{lastClicked === 'copyPass' ? 'Copied' : 'Copy'}</button>
            <button className="btn ghost small" onClick={onToggleShow}>{showPass ? 'Hide' : 'Show'}</button>
          </div>

          <div className="sc-actions">
            <button className="btn ghost small" onClick={onExitForget}>{isOwner ? 'Exit & Delete' : 'Exit & Forget'}</button>
            <button className="btn small" onClick={onSoftExit}>Soft Exit</button>
            <button className="btn ghost small" onClick={onMergeRefresh}>Refresh</button>
          </div>
        </div>

        {/* files & members */}
        <div className="sc-files" aria-live="polite">
          <div className="section-head">
            <div style={{ fontWeight: 900 }}>Files <span className="muted small">{filesMemo.length} total</span></div>
            <div />
          </div>

          <div className="sc-add">
            <input className="sc-input" placeholder={localPending ? 'Waiting for approval...' : 'New file name'} value={newFileName} onChange={e => setNewFileName(e.target.value)} disabled={localPending} onKeyDown={handleNewFileKey} />
            <button className="btn primary small" onClick={onCreateClick} disabled={localPending}>{lastClicked === 'create' ? 'Creating…' : 'Create'}</button>
          </div>

          <div role="list">
            {filesMemo.length === 0 ? <div className="muted small">No files yet</div> : filesMemo.map(f => <FileRow key={f.fileId} f={f} />)}
          </div>

          <div style={{ marginTop: 6, borderTop: '1px dashed rgba(255,255,255,0.02)', paddingTop: 10 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Members <span className="muted small">{membersMemo.length}</span></div>

            <div>
              {membersMemo.length === 0 ? <div className="muted small">No members</div> : membersMemo.map(m => <MemberRow key={m.id} m={m} />)}
            </div>
          </div>
        </div>
      </div>

      {/* Footer (not scrollable) */}
      <div className="sc-footer" aria-hidden={false}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 48 }}><Avatar name={displayName} size={48} status={connected} /></div>
          <div>
            <div style={{ fontWeight: 900 }}>{displayName}</div>
            <div className="muted small">Realtime: <strong style={{ color: connected ? '#7ee787' : '#ffb4b4' }}>{connected ? 'Connected' : 'Disconnected'}</strong></div>
          </div>
        </div>

        <div>
          <button className="btn ghost small" onClick={onCopyCreds}>Copy creds</button>
        </div>
      </div>

      {/* Modal (centered) */}
      {modal.open && (
        <div className="sc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="sc-modal">
            <h3>{modal.title}</h3>
            <div>{typeof modal.body === 'string' ? <p>{modal.body}</p> : modal.body}</div>
            <div className="actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              {modal.type === 'confirm' ? (
                <>
                  <button className="btn ghost small" onClick={() => closeModal(false)}>Cancel</button>
                  <button className="btn primary small" onClick={() => closeModal(true)}>OK</button>
                </>
              ) : (
                <button className="btn primary small" onClick={() => closeModal(true)}>OK</button>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

// helper color generator (returns gradient string) — currently unused but kept
function colorForName(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h << 5) - h + name.charCodeAt(i);
  const hue = Math.abs(h) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 40) % 360} 70% 60%))`;
}
