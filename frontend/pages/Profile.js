import { ref, reactive, computed, nextTick, onMounted } from 'vue';
import Icon from '../components/Icon.js';
import { Avatar } from '../components/Shell.js';
import { BrandMark, MadeBy } from '../components/Brand.js';
import { api, account, refreshAccount, formatBytes, parseDbDate, session, setSession, storage, app } from '../lib/api.js';
import { toast, attempt } from '../lib/ui.js';

const applyTheme = (choice) => {
  const t = choice === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : choice;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#0D1518' : '#F3F5F4');
};

export default {
  components: { Icon, Avatar, BrandMark, MadeBy },
  template: /*html*/`
    <div class="max-w-3xl mx-auto">
      <h1 class="title text-[28px] md:text-[32px] leading-tight mb-6">Profile</h1>

      <div class="space-y-5 stagger">
      <section class="panel p-5 md:p-6 flex flex-col sm:flex-row gap-6 items-start">
        <div class="relative group">
          <Avatar :name="account.username || session.username" :src="account.profile_image" :size="96" />
          <label for="avatarUpload" class="absolute inset-0 rounded-full bg-black/55 text-white text-xs font-medium grid place-items-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">Change</label>
          <input id="avatarUpload" ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onFileSelected">
        </div>
        <div class="flex-1 min-w-0 w-full">
          <p class="title text-2xl">{{ account.username || session.username }}</p>
          <p class="text-muted text-[13.5px] mb-5"><span class="capitalize">{{ account.role || session.role }}</span> account<template v-if="account.created_at"> · member since {{ since(account.created_at) }}</template></p>
          <div class="flex justify-between text-[13px] mb-2">
            <span>{{ formatBytes(account.used_bytes) }} used</span>
            <span class="text-muted">{{ formatBytes(Math.max(0, account.quota_bytes - account.used_bytes)) }} free of {{ formatBytes(account.quota_bytes) }}</span>
          </div>
          <div class="meter !h-2" :class="{ warn: pct >= 90 }"><span :style="{ width: pct + '%' }"></span></div>
          <p v-if="account.trash_bytes" class="text-xs text-muted mt-2">{{ formatBytes(account.trash_bytes) }} of that is in the <a href="#/trash" class="text-accent hover:underline">trash</a>.</p>
          <div class="flex gap-2 mt-5">
            <label for="avatarUpload" class="btn btn-sm cursor-pointer"><Icon name="image" :size="15" />Change photo</label>
            <button v-if="account.profile_image" class="btn btn-ghost btn-sm" @click="removeAvatar">Remove photo</button>
          </div>
        </div>
      </section>

      <section class="panel p-5 md:p-6" :class="session.weakPassword ? '!border-accent/60' : ''">
        <h2 class="title text-lg mb-1 flex items-center gap-2">Password<span v-if="session.weakPassword" class="chip chip-accent">Easy to guess</span></h2>
        <p class="text-muted text-[13.5px] mb-5">You stay signed in here. Every other browser and device is signed out.</p>
        <form @submit.prevent="changePassword" class="grid gap-4 max-w-sm">
          <div>
            <label class="label" for="cur">Current password</label>
            <input id="cur" v-model="pw.current" type="password" class="input" autocomplete="current-password" required>
          </div>
          <div>
            <label class="label" for="new">New password</label>
            <input id="new" v-model="pw.next" type="password" class="input" autocomplete="new-password" minlength="8" required>
            <div v-if="pw.next" class="flex items-center gap-2 mt-2">
              <div class="flex gap-1 flex-1"><span v-for="i in 4" :key="i" class="h-1 flex-1 rounded-full transition-colors" :class="i <= strength.score ? strength.color : 'bg-elevated'"></span></div>
              <span class="text-xs text-muted w-20 text-right">{{ strength.label }}</span>
            </div>
          </div>
          <div>
            <label class="label" for="rep">Repeat new password</label>
            <input id="rep" v-model="pw.repeat" type="password" class="input" autocomplete="new-password" required>
            <p v-if="pw.repeat && pw.repeat !== pw.next" class="text-danger text-xs mt-1.5">The passwords don’t match.</p>
          </div>
          <div><button type="submit" class="btn btn-primary" :disabled="pw.busy || pw.repeat !== pw.next"><Icon v-if="pw.busy" name="loader" :size="15" />Update password</button></div>
        </form>
      </section>

      <section class="panel p-5 md:p-6">
        <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div class="min-w-0">
            <h2 class="title text-lg mb-1">Sign-ins</h2>
            <p class="text-muted text-[13.5px]">Recent sign-ins to your account. If one wasn’t you, sign out the other devices and change your password.</p>
          </div>
          <button class="btn btn-sm" :disabled="signingOut" @click="signOutOthers"><Icon :name="signingOut ? 'loader' : 'logout'" :size="15" />Sign out other devices</button>
        </div>
        <p v-if="!logins.loaded" class="text-muted text-[13px]">Loading…</p>
        <p v-else-if="!logins.items.length" class="text-muted text-[13px]">No sign-ins recorded yet.</p>
        <ul v-else class="divide-y divide-line/70 -mx-1">
          <li v-for="(l, i) in shownLogins" :key="i" class="flex items-center gap-3 px-1 py-2.5 text-[13px]">
            <span class="w-8 h-8 rounded-lg grid place-items-center shrink-0" :class="l.action === 'auth.login' ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'">
              <Icon :name="l.action === 'auth.login' ? 'check' : 'alert'" :size="15" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate"><span class="font-medium">{{ l.action === 'auth.login' ? deviceOf(l.detail) : l.action === 'auth.locked' ? 'Sign-in blocked' : 'Failed sign-in' }}</span>
                <span v-if="l.action !== 'auth.login' && l.detail" class="text-muted"> · {{ l.detail }}</span></p>
              <p class="text-xs text-muted tabular-nums">{{ when(l.at) }}<template v-if="l.ip"> · {{ l.ip }}</template></p>
            </div>
          </li>
        </ul>
        <button v-if="logins.items.length > 6" class="btn btn-ghost btn-sm mt-2" @click="logins.all = !logins.all">{{ logins.all ? 'Show fewer' : 'Show all ' + logins.items.length }}</button>
      </section>

      <section id="link-downloads" class="panel p-5 md:p-6">
        <h2 class="title text-lg mb-1 flex items-center gap-2">Link downloads<span v-if="ck.saved" class="chip chip-ok">Cookies saved</span></h2>
        <p class="text-muted text-[13.5px] mb-4">Age-restricted, members-only or sign-in videos (YouTube “Sign in to confirm your age”, and sites that check your age) need your browser’s sign-in cookies.
          They’re stored encrypted, used only for your own downloads, and never shown again.</p>
        <div v-if="ck.saved" class="rounded-xl bg-elevated/60 px-4 py-3 mb-4 text-[13px]">
          <p class="font-medium mb-1">Signed in for {{ ck.sites.length }} site{{ ck.sites.length === 1 ? '' : 's' }}<span v-if="ck.updated_at" class="text-muted font-normal"> · saved {{ since(ck.updated_at) }}</span></p>
          <p class="text-muted break-words">{{ ck.sites.slice(0, 12).join(', ') }}<template v-if="ck.sites.length > 12">, +{{ ck.sites.length - 12 }} more</template></p>
        </div>
        <details class="mb-4 text-[13px]" :open="!ck.saved">
          <summary class="cursor-pointer font-medium">How to get a cookies.txt</summary>
          <ol class="list-decimal pl-5 mt-2 space-y-1 text-muted">
            <li>On your computer, sign in to the site (for YouTube, one account that has confirmed its age) in a normal browser window.</li>
            <li>Install an extension that exports cookies in “Netscape” format, such as <span class="text-fg">Get cookies.txt LOCALLY</span>.</li>
            <li>Open the site, export its cookies, then paste the text below or pick the file. Cookies expire after a while; export fresh ones if downloads start asking again.</li>
          </ol>
        </details>
        <textarea v-model="ck.text" rows="4" class="input !h-auto py-2 font-mono text-[12px]" placeholder="# Netscape HTTP Cookie File&#10;.youtube.com&#9;TRUE&#9;/&#9;TRUE&#9;…" spellcheck="false" autocomplete="off" aria-label="Cookies"></textarea>
        <input ref="cookieFile" type="file" accept=".txt,.json,text/plain,application/json" class="hidden" @change="onCookieFile">
        <div class="flex flex-wrap gap-2 mt-3">
          <button class="btn btn-primary btn-sm" :disabled="!ck.text.trim() || ck.busy" @click="saveCookies"><Icon :name="ck.busy ? 'loader' : 'check'" :size="15" />Save cookies</button>
          <button class="btn btn-sm" @click="cookieFile.click()"><Icon name="upload" :size="15" />Pick a file</button>
          <button v-if="ck.saved" class="btn btn-ghost btn-sm !text-danger" @click="removeCookies"><Icon name="trash" :size="15" />Remove</button>
        </div>
      </section>

      <section class="panel p-5 md:p-6">
        <h2 class="title text-lg mb-1">Sections</h2>
        <p class="text-muted text-[13.5px] mb-5">Saved to your account, so it applies on every device.</p>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0 max-w-md"><p class="font-medium text-[14px]">XXX</p><p class="text-xs text-muted">A separate, private section for adult videos, with its own downloads and collections. While it’s off, the section, its folder and its files stay hidden everywhere.</p></div>
          <div class="seg" role="radiogroup" aria-label="XXX section">
            <button :class="{ on: account.show_xxx }" @click="setXxx(true)" role="radio" :aria-checked="!!account.show_xxx"><Icon name="flame" :size="14" />On</button>
            <button :class="{ on: !account.show_xxx }" @click="setXxx(false)" role="radio" :aria-checked="!account.show_xxx">Off</button>
          </div>
        </div>
      </section>

      <section class="panel p-5 md:p-6">
        <h2 class="title text-lg mb-1">Appearance</h2>
        <p class="text-muted text-[13.5px] mb-5">Saved in this browser.</p>
        <div class="space-y-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div><p class="font-medium text-[14px]">Theme</p><p class="text-xs text-muted">System follows your device’s light or dark setting.</p></div>
            <div class="seg" role="radiogroup" aria-label="Theme">
              <button v-for="t in themes" :key="t.id" :class="{ on: theme === t.id }" @click="setTheme(t.id)" role="radio" :aria-checked="theme === t.id"><Icon :name="t.icon" :size="14" />{{ t.label }}</button>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div><p class="font-medium text-[14px]">Background animation</p><p class="text-xs text-muted">Slowly drifting colours behind the app. Turn it off to save battery.</p></div>
            <div class="seg" role="radiogroup" aria-label="Background animation">
              <button :class="{ on: motion === 'on' }" @click="setMotion('on')" role="radio" :aria-checked="motion === 'on'"><Icon name="sparkles" :size="14" />On</button>
              <button :class="{ on: motion === 'off' }" @click="setMotion('off')" role="radio" :aria-checked="motion === 'off'">Off</button>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div><p class="font-medium text-[14px]">Keyboard shortcuts</p><p class="text-xs text-muted">Press <span class="kbd">?</span> anywhere to see them.</p></div>
          </div>
        </div>
      </section>

      <section class="panel p-5 md:p-6 flex items-center gap-4">
        <BrandMark :size="52" :animated="true" />
        <div class="flex-1 min-w-0">
          <p class="title text-lg brand-text">AkulavBox</p>
          <p class="text-muted text-[13px]">Version {{ app.version || '…' }} · your private, encrypted personal cloud.</p>
          <MadeBy class="mt-1.5" />
        </div>
      </section>
      </div>

      <!-- Avatar cropper -->
      <Transition name="fade">
        <div v-if="cropImageSrc" class="fixed inset-0 z-[240] bg-black/60 flex items-center justify-center p-4">
          <div class="panel w-full max-w-xl p-5">
            <h3 class="title text-lg mb-3">Position your photo</h3>
            <div class="rounded-xl overflow-hidden bg-black" style="height: min(60vh, 420px)">
              <img ref="cropperImageRef" :src="cropImageSrc" class="block max-w-full" alt="">
            </div>
            <p class="text-xs text-muted mt-3">Drag to move, scroll or pinch to zoom.</p>
            <div class="flex justify-end gap-2 mt-4">
              <button class="btn" @click="cancelCrop">Cancel</button>
              <button class="btn btn-primary" @click="confirmCrop">Save photo</button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  `,
  setup() {
    const pw = reactive({ current: '', next: '', repeat: '', busy: false });
    const fileInputRef = ref(null);
    const cropImageSrc = ref(null);
    const cropperImageRef = ref(null);
    let cropper = null;

    const pct = computed(() => account.quota_bytes ? Math.min(100, (account.used_bytes / account.quota_bytes) * 100) : 0);

    const themes = [{ id: 'system', label: 'System', icon: 'settings' }, { id: 'light', label: 'Light', icon: 'sun' }, { id: 'dark', label: 'Dark', icon: 'moon' }];
    const theme = ref(storage.read('akulavTheme') || 'system');
    const setTheme = (t) => { theme.value = t; storage.write('akulavTheme', t); applyTheme(t); };
    const motion = ref(document.documentElement.dataset.motion || 'on');
    const setMotion = (m) => { motion.value = m; document.documentElement.dataset.motion = m; storage.write('akulavMotion', m === 'off' ? 'off' : null); };

    // rough strength meter: length + variety, and a few obvious ones
    const LEVELS = [null, { label: 'Weak', color: 'bg-danger' }, { label: 'Fair', color: 'bg-accent' }, { label: 'Good', color: 'bg-ok' }, { label: 'Strong', color: 'bg-ok' }];
    const strength = computed(() => {
      const p = pw.next;
      let score = 0;
      if (p.length >= 8) score++;
      if (p.length >= 12) score++;
      if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
      if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) score++;
      if (/^(password|admin|qwerty|1234)/i.test(p) || p.length < 6) score = Math.min(score, 1);
      score = Math.max(1, score);
      return { score, ...LEVELS[score] };
    });

    function onFileSelected(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (evt) => {
        cropImageSrc.value = evt.target.result;
        await nextTick();
        if (cropper) cropper.destroy();
        cropper = new window.Cropper(cropperImageRef.value, { aspectRatio: 1, viewMode: 1, dragMode: 'move', background: false, guides: false, autoCropArea: 0.85 });
      };
      reader.readAsDataURL(file);
    }
    function cancelCrop() {
      if (cropper) { cropper.destroy(); cropper = null; }
      cropImageSrc.value = null;
      if (fileInputRef.value) fileInputRef.value.value = '';
    }
    async function confirmCrop() {
      if (!cropper) return;
      const dataUrl = cropper.getCroppedCanvas({ width: 320, height: 320, imageSmoothingQuality: 'high' }).toDataURL('image/jpeg', 0.88);
      const ok = await attempt(async () => { await api('/api/user/profile', { method: 'PATCH', body: { profile_image: dataUrl } }); return true; }, 'Photo updated');
      if (ok) { account.profile_image = dataUrl; cancelCrop(); }
    }
    async function removeAvatar() {
      await attempt(async () => { await api('/api/user/profile', { method: 'PATCH', body: { profile_image: null } }); account.profile_image = null; }, 'Photo removed');
    }
    async function changePassword() {
      if (pw.next !== pw.repeat) return;
      pw.busy = true;
      const r = await attempt(() => api('/api/user/password', { method: 'PATCH', body: { currentPassword: pw.current, newPassword: pw.next } }), 'Password updated. Other devices were signed out.');
      pw.busy = false;
      if (r) {
        // the old token was revoked; keep this browser signed in with the new one
        setSession(r.token, { weak: strength.value.score <= 1 });
        Object.assign(pw, { current: '', next: '', repeat: '' });
      }
    }

    async function setXxx(on) {
      if (!!account.show_xxx === on) return;
      const r = await attempt(() => api('/api/user/settings', { method: 'PATCH', body: { show_xxx: on } }), on ? 'XXX section turned on' : 'XXX section turned off and hidden');
      if (r) account.show_xxx = r.show_xxx;
    }

    const since = (s) => { const d = parseDbDate(s); return d ? d.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) : ''; };

    // ---------- sign-in cookies for link downloads ----------
    const ck = reactive({ saved: false, sites: [], updated_at: null, text: '', busy: false });
    const cookieFile = ref(null);
    const loadCookies = async () => { try { Object.assign(ck, await api('/api/downloads/cookies')); } catch (e) { /* downloads may be off */ } };
    async function saveCookies() {
      ck.busy = true;
      const r = await attempt(() => api('/api/downloads/cookies', { method: 'PUT', body: { text: ck.text } }), 'Cookies saved. Try the download again.');
      ck.busy = false;
      if (r) Object.assign(ck, r, { text: '' });
    }
    async function onCookieFile(e) {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > 1024 * 1024) return toast.error('That file is larger than 1 MB.');
      ck.text = await f.text();
      await saveCookies();
    }
    async function removeCookies() {
      await attempt(async () => { await api('/api/downloads/cookies', { method: 'DELETE' }); Object.assign(ck, { saved: false, sites: [], updated_at: null }); }, 'Cookies removed');
    }

    // ---------- recent sign-ins ----------
    const logins = reactive({ items: [], loaded: false, all: false });
    const shownLogins = computed(() => (logins.all ? logins.items : logins.items.slice(0, 6)));
    const loadLogins = async () => { try { logins.items = await api('/api/user/activity'); } catch (e) { /* older server */ } logins.loaded = true; };
    // a readable name from the user agent: "Firefox on Windows"
    const deviceOf = (ua) => {
      const s = String(ua || '');
      if (!s) return 'Signed in';
      const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /curl|node|python/i.test(s) ? 'A script' : 'A browser';
      const os = /Android/.test(s) ? 'Android' : /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
      return os ? `${browser} on ${os}` : browser;
    };
    const when = (s) => { const d = parseDbDate(s); return d ? d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''; };
    const signingOut = ref(false);
    async function signOutOthers() {
      signingOut.value = true;
      const r = await attempt(() => api('/api/user/signout-others', { method: 'POST' }), 'Every other browser and device was signed out.');
      signingOut.value = false;
      if (r?.token) setSession(r.token);
    }

    onMounted(() => {
      refreshAccount();
      loadLogins();
      loadCookies().then(() => { if (location.hash.includes('cookies')) document.getElementById('link-downloads')?.scrollIntoView({ behavior: 'smooth' }); });
    });
    return { account, session, app, pct, pw, strength, themes, theme, setTheme, motion, setMotion, fileInputRef, cropImageSrc, cropperImageRef,
      onFileSelected, cancelCrop, confirmCrop, removeAvatar, changePassword, setXxx, formatBytes, since, ck, cookieFile, saveCookies, onCookieFile, removeCookies,
      logins, shownLogins, deviceOf, when, signingOut, signOutOthers };
  },
};
