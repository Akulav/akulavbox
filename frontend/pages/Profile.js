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
    <div class="max-w-3xl">
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
            <input id="new" v-model="pw.next" type="password" class="input" autocomplete="new-password" minlength="4" required>
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

    const since = (s) => { const d = parseDbDate(s); return d ? d.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) : ''; };

    onMounted(refreshAccount);
    return { account, session, app, pct, pw, strength, themes, theme, setTheme, motion, setMotion, fileInputRef, cropImageSrc, cropperImageRef,
      onFileSelected, cancelCrop, confirmCrop, removeAvatar, changePassword, formatBytes, since };
  },
};
