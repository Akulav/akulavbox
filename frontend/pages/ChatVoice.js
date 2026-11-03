import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import Icon from '../components/Icon.js';
import { Avatar } from '../components/Shell.js';
import { api, session, formatBytes, parseDbDate, refreshAccount, downloadUrl } from '../lib/api.js';
import { toast, confirmDialog, attempt } from '../lib/ui.js';
import { player } from '../lib/player.js';
import { rt, onMessage, sendMessage, sendTyping, markRead, startCall, call, syncFromFriends } from '../lib/realtime.js';
import { kindOf, iconFor, tintFor } from '../lib/filetypes.js';

const MAX_LEN = 2000;

export default {
  components: { Icon, Avatar },
  template: /*html*/`
    <div class="panel overflow-hidden flex h-[calc(100dvh-60px-56px-2.5rem)] md:h-[calc(100dvh-4rem)] min-h-[420px]" :class="{ '!h-[calc(100dvh-60px-56px-2.5rem-64px)] md:!h-[calc(100dvh-4rem-80px)]': hasPlayer }">

      <!-- Friends column -->
      <aside class="w-full md:w-[300px] lg:w-[320px] shrink-0 border-r border-line flex flex-col" :class="active ? 'hidden md:flex' : 'flex'">
        <div class="h-16 shrink-0 flex items-center justify-between px-4 border-b border-line">
          <h1 class="title text-[22px]">Chat</h1>
          <button class="btn btn-sm" @click="openAdd"><Icon name="user-plus" :size="15" />Add friend</button>
        </div>
        <div class="flex-1 overflow-y-auto">
          <template v-if="incoming.length">
            <p class="px-4 pt-4 pb-2 text-xs font-medium text-muted">Friend requests</p>
            <div v-for="f in incoming" :key="f.id" class="flex items-center gap-3 px-4 py-2.5">
              <Avatar :name="f.username" :src="f.profile_image" :size="38" />
              <span class="flex-1 truncate font-medium text-[13.5px]">{{ f.username }}</span>
              <button class="icon-btn icon-btn-sm" @click="removeFriend(f, true)" title="Decline"><Icon name="x" :size="15" /></button>
              <button class="btn btn-primary btn-sm" @click="accept(f)">Accept</button>
            </div>
          </template>

          <p v-if="friends.length" class="px-4 pt-4 pb-2 text-xs font-medium text-muted">Conversations</p>
          <button v-for="f in friends" :key="f.id" @click="select(f)"
                  class="w-full flex items-center gap-3 px-4 py-3 text-left relative"
                  :class="active && active.id === f.id ? 'bg-elevated' : 'hover:bg-elevated/50'">
            <Avatar :name="f.username" :src="f.profile_image" :size="42" :online="rt.online.has(f.id)" />
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2">
                <span class="font-medium truncate text-[14px] flex-1">{{ f.username }}</span>
                <span v-if="f.last_message" class="text-[11px] text-faint shrink-0">{{ shortTime(f.last_message.created_at) }}</span>
              </div>
              <p class="text-[13px] truncate" :class="rt.unread[f.id] ? 'text-fg font-medium' : 'text-muted'">
                <template v-if="isTyping(f.id)"><span class="text-accent">typing…</span></template>
                <template v-else-if="f.last_message">{{ f.last_message.sender_id === me ? 'You: ' : '' }}{{ f.last_message.type === 'text' ? f.last_message.content : (f.last_message.type === 'file' ? 'Sent a file' : 'File expired') }}</template>
                <template v-else>{{ rt.online.has(f.id) ? 'Online' : 'Say hello' }}</template>
              </p>
            </div>
            <span v-if="rt.unread[f.id]" class="min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-accent-fg text-[11px] font-semibold grid place-items-center">{{ rt.unread[f.id] }}</span>
          </button>

          <template v-if="outgoing.length">
            <p class="px-4 pt-4 pb-2 text-xs font-medium text-muted">Waiting for reply</p>
            <div v-for="f in outgoing" :key="f.id" class="flex items-center gap-3 px-4 py-2.5 text-muted">
              <Avatar :name="f.username" :src="f.profile_image" :size="34" />
              <span class="flex-1 truncate text-[13.5px]">{{ f.username }}</span>
              <button class="btn btn-ghost btn-sm" @click="removeFriend(f)">Cancel</button>
            </div>
          </template>

          <div v-if="!loadingFriends && !friends.length && !incoming.length && !outgoing.length" class="p-8 text-center">
            <span class="w-12 h-12 rounded-2xl bg-elevated grid place-items-center mx-auto mb-3 text-muted"><Icon name="users" :size="22" /></span>
            <p class="font-medium mb-1">No friends yet</p>
            <p class="text-muted text-[13px] mb-4">Add someone on this server to message and call them.</p>
            <button class="btn btn-primary btn-sm" @click="openAdd"><Icon name="user-plus" :size="15" />Add friend</button>
          </div>
        </div>
      </aside>

      <!-- Conversation -->
      <section class="relative flex-1 min-w-0 flex flex-col" :class="active ? 'flex' : 'hidden md:flex'">
        <template v-if="active">
          <header class="h-16 shrink-0 flex items-center gap-3 px-3 md:px-5 border-b border-line">
            <button class="icon-btn md:hidden" @click="active = null; rt.activeChatId = null" aria-label="Back to conversations"><Icon name="arrow-left" :size="19" /></button>
            <Avatar :name="active.username" :src="active.profile_image" :size="38" :online="rt.online.has(active.id)" />
            <div class="flex-1 min-w-0">
              <p class="font-semibold truncate">{{ active.username }}</p>
              <p class="text-xs" :class="isTyping(active.id) ? 'text-accent' : 'text-muted'">{{ isTyping(active.id) ? 'typing…' : (rt.online.has(active.id) ? 'Online' : 'Offline') }}</p>
            </div>
            <button v-if="showSearch" class="icon-btn" @click="showSearch = false; msgSearch = ''" title="Close search"><Icon name="x" :size="18" /></button>
            <button v-else class="icon-btn" @click="showSearch = true" title="Search messages"><Icon name="search" :size="18" /></button>
            <button class="icon-btn" :disabled="call.state !== 'idle'" @click="startCall(active)" :title="rt.online.has(active.id) ? 'Voice call' : 'Voice call (they appear offline)'"><Icon name="phone" :size="18" /></button>
            <div class="relative">
              <button class="icon-btn" @click="headerMenu = !headerMenu" title="More"><Icon name="more" :size="18" /></button>
              <div v-if="headerMenu" class="fixed inset-0 z-[230]" @click="headerMenu = false"></div>
              <div v-if="headerMenu" class="menu absolute right-0 top-10 z-[231]">
                <button class="menu-item danger" @click="headerMenu = false; removeFriend(active)"><Icon name="trash" :size="16" />Remove friend</button>
              </div>
            </div>
          </header>
          <div v-if="showSearch" class="px-4 py-2 border-b border-line">
            <input v-model="msgSearch" class="input h-9" placeholder="Search the last 1,000 messages" autofocus>
          </div>

          <div ref="scroller" class="flex-1 overflow-y-auto px-3 md:px-6 py-4" @scroll="onScroll">
            <div v-if="loadingMessages" class="h-full grid place-items-center text-muted"><Icon name="loader" :size="22" /></div>
            <div v-else-if="!grouped.length" class="h-full grid place-items-center text-center text-muted text-[13.5px] px-6">
              <div>
                <p v-if="msgSearch">No messages match “{{ msgSearch }}”.</p>
                <template v-else>
                  <Avatar :name="active.username" :src="active.profile_image" :size="64" class="mb-3" />
                  <p class="text-fg font-medium">This is the start of your chat with {{ active.username }}</p>
                  <p class="mt-1">Files you send here disappear after 10 minutes. The last 1,000 messages are kept.</p>
                </template>
              </div>
            </div>
            <template v-for="day in grouped" :key="day.key">
              <div class="flex justify-center my-4"><span class="chip">{{ day.label }}</span></div>
              <div v-for="(m, i) in day.items" :key="m.id" class="group/msg flex items-center gap-1" :class="[m.sender_id === me ? 'justify-end' : 'justify-start', sameSender(day.items, i) ? 'mt-0.5' : 'mt-3']">
                <button v-if="m.sender_id === me" class="icon-btn icon-btn-sm opacity-0 group-hover/msg:opacity-100 focus:opacity-100 hover:!text-danger shrink-0" @click="deleteMessage(m)" title="Delete for both of you" aria-label="Delete message"><Icon name="trash" :size="14" /></button>
                <div class="max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2 text-[14px] leading-snug"
                     :class="m.sender_id === me ? 'bg-accent/[0.16] rounded-br-md' : 'bg-elevated rounded-bl-md'">
                  <p v-if="m.type === 'text'" class="whitespace-pre-wrap break-words">{{ m.content }}</p>

                  <div v-else-if="m.type === 'file'" class="py-1">
                    <a v-if="kindOf({ filename: m.content }) === 'image'" :href="chatUrl(m)" target="_blank" rel="noopener" class="block">
                      <img :src="chatUrl(m)" alt="" class="rounded-lg max-h-64 max-w-full object-cover">
                    </a>
                    <video v-else-if="kindOf({ filename: m.content }) === 'video'" :src="chatUrl(m)" controls playsinline class="rounded-lg max-h-64 max-w-full bg-black"></video>
                    <audio v-else-if="kindOf({ filename: m.content }) === 'audio'" :src="chatUrl(m)" controls class="max-w-full"></audio>
                    <div class="flex items-center gap-3" :class="['image', 'video', 'audio'].includes(kindOf({ filename: m.content })) ? 'mt-2' : ''">
                      <span class="w-9 h-9 rounded-lg grid place-items-center shrink-0" :style="tile(m.content)"><Icon :name="iconFor(kindOf({ filename: m.content }))" :size="17" /></span>
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-[13.5px] font-medium">{{ m.content }}</p>
                        <p class="text-xs text-muted">{{ formatBytes(m.file_size) }}, {{ expiresIn(m) }}</p>
                      </div>
                      <a :href="chatUrl(m)" target="_blank" rel="noopener" class="icon-btn icon-btn-sm" title="Open"><Icon name="external" :size="15" /></a>
                      <button class="icon-btn icon-btn-sm" @click="downloadUrl(chatUrl(m, true))" title="Download"><Icon name="download" :size="15" /></button>
                    </div>
                  </div>

                  <p v-else class="italic text-muted text-[13px] flex items-center gap-1.5"><Icon name="file" :size="14" />{{ m.content }}</p>
                  <p class="text-[10.5px] mt-1 text-right" :class="m.sender_id === me ? 'text-muted' : 'text-faint'">{{ clock(m.created_at) }}</p>
                </div>
              </div>
            </template>
          </div>

          <button v-if="showJump" class="absolute bottom-[76px] left-1/2 -translate-x-1/2 btn btn-sm shadow-lg z-10" @click="scrollToBottom(true)"><Icon name="chevron-down" :size="15" />Latest</button>

          <form class="shrink-0 border-t border-line p-3 flex items-end gap-2" @submit.prevent="send">
            <input ref="fileInput" type="file" class="hidden" @change="sendFile">
            <button type="button" class="icon-btn shrink-0 mb-[3px]" @click="fileInput.click()" :disabled="sendingFile" title="Send a file (deleted after 10 minutes, max 50 MB)">
              <Icon :name="sendingFile ? 'loader' : 'paperclip'" :size="19" />
            </button>
            <div class="flex-1 relative">
              <textarea ref="inputEl" v-model="draft" rows="1" :maxlength="MAX_LEN" placeholder="Write a message" class="input !h-auto py-2.5 resize-none max-h-40 block leading-snug"
                        @keydown.enter.exact.prevent="send" @input="onInput"></textarea>
              <span v-if="draft.length > MAX_LEN - 200" class="absolute right-3 bottom-2 text-[11px]" :class="draft.length >= MAX_LEN ? 'text-danger' : 'text-faint'">{{ MAX_LEN - draft.length }}</span>
            </div>
            <button type="submit" class="btn btn-primary !h-[42px] !w-[42px] !p-0 shrink-0" :disabled="!draft.trim()" aria-label="Send"><Icon name="send" :size="17" /></button>
          </form>
        </template>

        <div v-else class="flex-1 grid place-items-center text-center p-8">
          <div>
            <span class="w-14 h-14 rounded-2xl bg-elevated grid place-items-center mx-auto mb-4 text-muted"><Icon name="message" :size="24" /></span>
            <p class="title text-lg mb-1">Pick a conversation</p>
            <p class="text-muted text-[13.5px]">Messages are delivered instantly to friends on this server.</p>
          </div>
        </div>
      </section>

      <!-- Add friend dialog -->
      <Transition name="fade">
        <div v-if="adding" class="fixed inset-0 z-[240] bg-black/50 flex items-end sm:items-center justify-center p-4" @mousedown.self="adding = false">
          <div class="panel w-full max-w-md flex flex-col max-h-[80vh]">
            <div class="p-5 pb-3">
              <h3 class="title text-lg">Add a friend</h3>
              <input v-model="userSearch" class="input mt-3" placeholder="Search people on this server" autofocus>
            </div>
            <ul class="flex-1 overflow-y-auto px-2 pb-2 min-h-[140px]">
              <li v-for="u in filteredUsers" :key="u.id" class="flex items-center gap-3 px-3 py-2 rounded-lg">
                <Avatar :name="u.username" :src="u.profile_image" :size="34" />
                <span class="flex-1 truncate text-[13.5px] font-medium">{{ u.username }}</span>
                <span v-if="u.relation === 'accepted'" class="chip chip-ok">Friends</span>
                <span v-else-if="u.relation === 'pending'" class="chip">Pending</span>
                <button v-else class="btn btn-sm" @click="addFriend(u)"><Icon name="user-plus" :size="14" />Add</button>
              </li>
              <li v-if="!filteredUsers.length" class="text-center text-muted text-[13px] py-8">No one matches that name.</li>
            </ul>
            <div class="flex justify-end p-4 border-t border-line"><button class="btn" @click="adding = false">Done</button></div>
          </div>
        </div>
      </Transition>
    </div>
  `,
  setup() {
    const me = session.id;
    const all = ref([]);
    const loadingFriends = ref(true);
    const active = ref(null);
    const messages = ref([]);
    const loadingMessages = ref(false);
    const draft = ref('');
    const msgSearch = ref('');
    const showSearch = ref(false);
    const scroller = ref(null);
    const inputEl = ref(null);
    const fileInput = ref(null);
    const sendingFile = ref(false);
    const showJump = ref(false);
    const adding = ref(false);
    const users = ref([]);
    const userSearch = ref('');
    const now = ref(Date.now());
    const hasPlayer = computed(() => !!player.current);
    const headerMenu = ref(false);

    const friends = computed(() => all.value.filter(f => f.status === 'accepted').sort((a, b) =>
      String(b.last_message?.created_at || '').localeCompare(String(a.last_message?.created_at || '')) || a.username.localeCompare(b.username)));
    const incoming = computed(() => all.value.filter(f => f.status !== 'accepted' && f.direction === 'incoming'));
    const outgoing = computed(() => all.value.filter(f => f.status !== 'accepted' && f.direction === 'outgoing'));
    const filteredUsers = computed(() => users.value.filter(u => u.username.toLowerCase().includes(userSearch.value.trim().toLowerCase())));

    const isTyping = (id) => rt.typing[id] && now.value - rt.typing[id] < 4000;

    async function fetchFriends() {
      try { all.value = await api('/api/chat/friends'); syncFromFriends(all.value); }
      catch (e) { toast.error(e.message); }
      finally { loadingFriends.value = false; }
    }

    async function deleteMessage(m) {
      if (!await confirmDialog({ title: 'Delete this message?', message: 'It disappears for both of you.', confirmText: 'Delete', danger: true })) return;
      await attempt(async () => { await api(`/api/chat/messages/${m.id}`, { method: 'DELETE' }); messages.value = messages.value.filter(x => x.id !== m.id); });
    }

    async function select(f) {
      active.value = f;
      rt.activeChatId = f.id;
      markRead(f.id);
      msgSearch.value = ''; showSearch.value = false;
      loadingMessages.value = true;
      try { messages.value = await api(`/api/chat/messages/${f.id}`); }
      catch (e) { toast.error(e.message); }
      finally { loadingMessages.value = false; }
      scrollToBottom(true);
      nextTick(() => inputEl.value && window.matchMedia('(hover: hover)').matches && inputEl.value.focus());
    }

    // ---------- message list ----------
    const filtered = computed(() => {
      const q = msgSearch.value.trim().toLowerCase();
      return q ? messages.value.filter(m => (m.content || '').toLowerCase().includes(q)) : messages.value;
    });
    const grouped = computed(() => {
      const days = [];
      for (const m of filtered.value) {
        const d = parseDbDate(m.created_at) || new Date();
        const key = d.toDateString();
        let g = days[days.length - 1];
        if (!g || g.key !== key) { g = { key, label: dayLabel(d), items: [] }; days.push(g); }
        g.items.push(m);
      }
      return days;
    });
    const sameSender = (items, i) => i > 0 && items[i - 1].sender_id === items[i].sender_id;

    function dayLabel(d) {
      const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
      if (d.toDateString() === today.toDateString()) return 'Today';
      if (d.toDateString() === y.toDateString()) return 'Yesterday';
      return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
    }
    const clock = (s) => (parseDbDate(s) || new Date()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const shortTime = (s) => {
      const d = parseDbDate(s); if (!d) return '';
      return d.toDateString() === new Date().toDateString() ? clock(s) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };
    const expiresIn = (m) => {
      const t = parseDbDate(m.created_at); if (!t) return 'expires soon';
      const left = Math.ceil((t.getTime() + 10 * 60 * 1000 - now.value) / 60000);
      return left > 0 ? `expires in ${left} min` : 'expiring';
    };
    const chatUrl = (m, download) => `/api/chat/download/${m.id}?token=${encodeURIComponent(session.token)}${download ? '&download=1' : ''}`;
    const tile = (name) => { const t = tintFor(kindOf({ filename: name })); return { background: t + '22', color: t }; };

    function nearBottom() { const el = scroller.value; return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120; }
    function scrollToBottom(force) {
      const stick = force || nearBottom();
      nextTick(() => { const el = scroller.value; if (el && stick) { el.scrollTop = el.scrollHeight; showJump.value = false; } });
    }
    const onScroll = () => { showJump.value = !nearBottom(); };

    // ---------- sending ----------
    function send() {
      const text = draft.value.trim();
      if (!text || !active.value) return;
      if (!sendMessage(active.value.id, text)) { toast.error('Not connected. Trying to reconnect…'); return; }
      draft.value = '';
      nextTick(autosize);
    }
    function autosize() { const el = inputEl.value; if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'; } }
    function onInput() { autosize(); if (active.value) sendTyping(active.value.id); }

    async function sendFile(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file || !active.value) return;
      if (file.size > 50 * 1024 * 1024) { toast.error('Files sent in chat can be at most 50 MB. Share a link from Files instead.'); return; }
      sendingFile.value = true;
      const form = new FormData();
      form.append('receiver_id', active.value.id);
      form.append('file', file);
      await attempt(async () => { await api('/api/chat/upload', { method: 'POST', body: form }); refreshAccount(); });
      sendingFile.value = false;
    }

    // ---------- realtime ----------
    const off = onMessage((type, payload) => {
      if (type === 'message') {
        const m = payload;
        const other = m.sender_id === me ? m.receiver_id : m.sender_id;
        const f = all.value.find(x => x.id === other);
        if (f) f.last_message = { content: m.content, type: m.type, sender_id: m.sender_id, created_at: m.created_at };
        if (active.value && other === active.value.id && !messages.value.some(x => x.id === m.id)) {
          messages.value.push(m);
          if (m.sender_id !== me && !document.hidden) markRead(other);
          scrollToBottom(m.sender_id === me);
        }
      } else if (type === 'expired') {
        const m = messages.value.find(x => x.id === payload.message_id);
        if (m) { m.type = 'deleted_file'; m.content = 'File expired (10 min limit)'; }
      } else if (type === 'deleted') {
        messages.value = messages.value.filter(x => x.id !== payload.message_id);
        fetchFriends();
      }
    });
    watch(() => rt.friendsVersion, fetchFriends);
    const onVisible = () => { if (!document.hidden && active.value) markRead(active.value.id); };

    // ---------- friends ----------
    async function openAdd() {
      adding.value = true; userSearch.value = '';
      try { users.value = await api('/api/chat/users'); } catch (e) { toast.error(e.message); }
    }
    async function addFriend(u) {
      const r = await attempt(() => api('/api/chat/friends/add', { method: 'POST', body: { friend_id: u.id } }));
      if (r) { u.relation = r.accepted ? 'accepted' : 'pending'; toast.success(r.accepted ? `You and ${u.username} are now friends` : `Request sent to ${u.username}`); fetchFriends(); }
    }
    async function accept(f) {
      await attempt(async () => { await api('/api/chat/friends/accept', { method: 'POST', body: { friend_id: f.id } }); await fetchFriends(); }, `You and ${f.username} are now friends`);
    }
    async function removeFriend(f, declining) {
      const isFriend = f.status === 'accepted';
      if (isFriend && !await confirmDialog({ title: `Remove ${f.username} from your friends?`, message: 'Your message history stays, but you won’t be able to message or call each other until you add them again.', confirmText: 'Remove', danger: true })) return;
      await attempt(async () => {
        await api('/api/chat/friends/remove', { method: 'POST', body: { friend_id: f.id } });
        if (active.value && active.value.id === f.id) { active.value = null; rt.activeChatId = null; }
        await fetchFriends();
      }, declining ? 'Request declined' : isFriend ? 'Friend removed' : 'Request cancelled');
    }

    let tick;
    onMounted(async () => {
      tick = setInterval(() => { now.value = Date.now(); }, 1000);
      document.addEventListener('visibilitychange', onVisible);
      await fetchFriends();
    });
    onUnmounted(() => { off(); clearInterval(tick); rt.activeChatId = null; document.removeEventListener('visibilitychange', onVisible); });

    return {
      me, rt, call, headerMenu, friends, incoming, outgoing, loadingFriends, active, messages, loadingMessages, draft, msgSearch, showSearch, scroller, inputEl, fileInput,
      sendingFile, showJump, adding, userSearch, filteredUsers, grouped, hasPlayer, MAX_LEN,
      select, send, onInput, sendFile, onScroll, scrollToBottom, sameSender, clock, shortTime, expiresIn, chatUrl, tile, isTyping,
      openAdd, addFriend, accept, removeFriend, startCall, kindOf, iconFor, formatBytes, downloadUrl, deleteMessage,
    };
  },
};
