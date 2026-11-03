import { reactive } from 'vue';
import { io } from 'socket.io-client';
import { session, api } from './api.js';
import { toast } from './ui.js';

// Single socket for the app: chat, presence and calls work from any section.
export const rt = reactive({
  connected: false,
  online: new Set(),
  unread: {},            // friendId -> count
  activeChatId: null,    // friend currently open in the chat page
  typing: {},            // friendId -> timestamp
  friendsVersion: 0,     // bumps when the friend list changes server-side
});

export const call = reactive({
  state: 'idle',         // idle | calling | ringing | connecting | active
  peerId: null,
  peerName: '',
  muted: false,
  startedAt: null,
  error: '',
  needsSound: false,     // browser blocked autoplay of the other person's audio
  relayed: false,        // connection goes through a TURN relay
});

let socket = null;
const listeners = new Set();

export const totalUnread = () => Object.values(rt.unread).reduce((a, b) => a + b, 0);

export function onMessage(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Seed unread badges and presence from the friends list (counts come from the server, so they survive reloads) */
export function syncFromFriends(list) {
  for (const f of list || []) {
    if (f.status !== 'accepted') continue;
    if (f.online) rt.online.add(f.id);
    if (f.id === rt.activeChatId && !document.hidden) continue;
    if (f.unread) rt.unread[f.id] = f.unread; else delete rt.unread[f.id];
  }
}

export function connectRealtime() {
  if (socket || !session.token) return;
  // a function, so reconnects use the latest (refreshed) token
  socket = io({ auth: (cb) => cb({ token: session.token }) });

  socket.on('connect', () => {
    rt.connected = true;
    api('/api/chat/friends').then(syncFromFriends).catch(() => {});
  });
  socket.on('disconnect', () => { rt.connected = false; });
  socket.on('online_list', (ids) => { rt.online = new Set(ids); });
  socket.on('message_deleted', (d) => listeners.forEach(fn => fn('deleted', d)));
  socket.on('user_online', (id) => { rt.online.add(id); });
  socket.on('user_offline', (id) => { rt.online.delete(id); });
  socket.on('friends_changed', () => { rt.friendsVersion++; });
  socket.on('typing', ({ user_id }) => { rt.typing[user_id] = Date.now(); });

  socket.on('receive_message', (msg) => {
    const fromOther = msg.sender_id !== session.id;
    if (fromOther) {
      delete rt.typing[msg.sender_id];
      if (rt.activeChatId !== msg.sender_id || document.hidden) {
        rt.unread[msg.sender_id] = (rt.unread[msg.sender_id] || 0) + 1;
      }
    }
    listeners.forEach(fn => fn('message', msg));
  });
  socket.on('file_expired', (d) => listeners.forEach(fn => fn('expired', d)));

  // ---- Calls ----
  socket.on('incoming_call', ({ caller_id, caller_name }) => {
    if (call.state !== 'idle') { socket.emit('reject_call', { target_id: caller_id }); return; }
    Object.assign(call, { state: 'ringing', peerId: caller_id, peerName: caller_name || 'Someone', error: '' });
  });
  socket.on('call_answered', async () => {
    if (call.state !== 'calling') return;
    call.state = 'connecting';
    try {
      await setupPeer(call.peerId, true);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc_offer', { target_id: call.peerId, sdp: offer });
    } catch (e) { failCall(e); }
  });
  socket.on('call_rejected', () => { if (call.state !== 'idle') { toast(`${call.peerName} declined the call`); cleanupCall(); } });
  socket.on('call_ended', () => { if (call.state !== 'idle') { toast('Call ended'); cleanupCall(); } });
  socket.on('webrtc_offer', async (d) => {
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
    await flushIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc_answer', { target_id: d.sender_id, sdp: answer });
  });
  socket.on('webrtc_answer', async (d) => {
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
    await flushIce();
  });
  socket.on('webrtc_ice_candidate', async (d) => {
    if (pc && pc.remoteDescription) { try { await pc.addIceCandidate(new RTCIceCandidate(d.candidate)); } catch (e) { /* ignore */ } }
    else iceQueue.push(d.candidate);
  });
}

export function disconnectRealtime() {
  cleanupCall(true);
  if (socket) { socket.disconnect(); socket = null; }
  rt.connected = false; rt.online = new Set(); rt.unread = {}; rt.activeChatId = null;
}

export function sendMessage(receiverId, content) {
  if (!socket || !socket.connected) return false;
  socket.timeout(8000).emit('send_message', { receiver_id: receiverId, content }, (err, res) => {
    if (err) toast.error('Message not delivered. Check your connection.');
    else if (res && !res.ok) toast.error(res.error || 'Message not delivered.');
  });
  return true;
}

let lastTyping = 0;
export function sendTyping(targetId) {
  if (!socket || Date.now() - lastTyping < 2500) return;
  lastTyping = Date.now();
  socket.emit('typing', { target_id: targetId });
}

const readTimers = {};
export function markRead(friendId) {
  delete rt.unread[friendId];
  // tell the server (debounced) so the badge stays cleared after a reload
  clearTimeout(readTimers[friendId]);
  readTimers[friendId] = setTimeout(() => api(`/api/chat/read/${friendId}`, { method: 'POST' }).catch(() => {}), 600);
}

// ---- WebRTC ----
// Hardened browsers (Brave, Helium, LibreWolf, Mullvad…) hide local addresses and
// often block direct UDP, so a TURN relay is needed. The server hands out its ICE
// servers (STUN + any TURN configured in .env) from /api/rtc/config.
let iceConfig = null, iceFetchedAt = 0;
async function getIceConfig() {
  if (iceConfig && Date.now() - iceFetchedAt < 10 * 60 * 1000) return iceConfig;
  try { iceConfig = await api('/api/rtc/config'); iceFetchedAt = Date.now(); }
  catch (e) { iceConfig = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }], hasRelay: false }; }
  return iceConfig;
}

let pc = null, localStream = null, iceQueue = [], isCaller = false, restarted = false, connectTimer = null;

// An <audio> element in the page (not a detached one) plays more reliably under strict autoplay rules
export const remoteAudio = document.createElement('audio');
remoteAudio.autoplay = true;
remoteAudio.setAttribute('playsinline', '');
remoteAudio.style.display = 'none';
document.body.appendChild(remoteAudio);

function checkSupport() {
  if (!window.RTCPeerConnection) return 'Calls are turned off in this browser (WebRTC is disabled). In Brave, check Settings → Privacy → WebRTC IP handling policy.';
  if (!window.isSecureContext) return 'Calls need a secure connection. Open AkulavBox over https:// (or http://localhost on the server itself).';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'This browser doesn’t allow microphone access here.';
  return null;
}

async function getMic() {
  if (localStream && localStream.getTracks().some(t => t.readyState === 'live')) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  return localStream;
}

function relayHint() {
  return iceConfig && iceConfig.hasRelay
    ? 'Couldn’t connect, even through the relay server. Check that the TURN server is reachable.'
    : 'Couldn’t connect. Privacy-focused browsers like Brave and Helium block direct connections, so the server needs a TURN relay (set TURN_URLS in .env).';
}

async function setupPeer(targetId, caller = false) {
  if (pc) { pc.close(); pc = null; }
  isCaller = caller; restarted = false;
  const cfg = await getIceConfig();
  await getMic();
  pc = new RTCPeerConnection({ iceServers: cfg.iceServers, iceCandidatePoolSize: 2 });
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.ontrack = (e) => {
    remoteAudio.srcObject = e.streams[0] || new MediaStream([e.track]);
    remoteAudio.play().then(() => { call.needsSound = false; }).catch(() => { call.needsSound = true; });
  };
  pc.onicecandidate = (e) => { if (e.candidate && socket) socket.emit('webrtc_ice_candidate', { target_id: targetId, candidate: e.candidate }); };
  pc.onconnectionstatechange = async () => {
    if (!pc) return;
    const st = pc.connectionState;
    if (st === 'connected') {
      clearTimeout(connectTimer);
      call.state = 'active'; call.startedAt = call.startedAt || Date.now();
      try {
        const stats = await pc.getStats();
        stats.forEach(r => { if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) {
          const local = stats.get(r.localCandidateId);
          call.relayed = !!local && local.candidateType === 'relay';
        } });
      } catch (e) { /* ignore */ }
    }
    if (st === 'failed') {
      // One ICE restart (caller side) before giving up
      if (isCaller && !restarted && socket) {
        restarted = true;
        try {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          socket.emit('webrtc_offer', { target_id: targetId, sdp: offer });
          return;
        } catch (e) { /* fall through */ }
      }
      failCall(new Error(relayHint()));
    }
  };
  clearTimeout(connectTimer);
  connectTimer = setTimeout(() => { if (call.state === 'connecting') failCall(new Error(relayHint())); }, 30000);
}

async function flushIce() {
  while (iceQueue.length) {
    const c = iceQueue.shift();
    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { /* ignore */ }
  }
}

function failCall(e) {
  const msg = e?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser’s site settings and try again.'
    : e?.name === 'NotFoundError' ? 'No microphone was found.'
    : (e?.message || 'Call failed');
  toast.error(msg);
  endCall();
}

function cleanupCall() {
  clearTimeout(connectTimer);
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (pc) pc.close();
  pc = null; localStream = null; iceQueue = [];
  remoteAudio.srcObject = null;
  Object.assign(call, { state: 'idle', peerId: null, peerName: '', muted: false, startedAt: null, needsSound: false, relayed: false });
}

export async function startCall(friend) {
  if (!socket || call.state !== 'idle') return;
  const problem = checkSupport();
  if (problem) { toast.error(problem); return; }
  Object.assign(call, { state: 'calling', peerId: friend.id, peerName: friend.username, error: '' });
  try {
    // Ask for the microphone now, while we still have the click (strict browsers require it)
    await Promise.all([getMic(), getIceConfig()]);
  } catch (e) { failCall(e); return; }
  if (call.state === 'calling') socket.emit('call_user', { target_id: friend.id });
}

export async function acceptCall() {
  if (call.state !== 'ringing') return;
  const problem = checkSupport();
  if (problem) { toast.error(problem); declineCall(); return; }
  call.state = 'connecting';
  try {
    await setupPeer(call.peerId, false);
    socket.emit('answer_call', { target_id: call.peerId });
  } catch (e) { failCall(e); }
}

export function enableSound() {
  remoteAudio.play().then(() => { call.needsSound = false; }).catch(() => {});
}

export function declineCall() {
  if (socket && call.peerId) socket.emit('reject_call', { target_id: call.peerId });
  cleanupCall();
}

export function endCall() {
  if (socket && call.peerId) socket.emit('end_call', { target_id: call.peerId });
  cleanupCall();
}

export function toggleMuteCall() {
  call.muted = !call.muted;
  if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = !call.muted; });
}
