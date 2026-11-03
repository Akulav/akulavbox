import { ref, reactive, computed, nextTick, onMounted } from 'vue';
import Icon from '../components/Icon.js';
import { Avatar } from '../components/Shell.js';
import { api, account, refreshAccount, formatBytes, session } from '../lib/api.js';
import { toast, attempt } from '../lib/ui.js';

export default {
  components: { Icon, Avatar },
  template: /*html*/`
    <div class="max-w-3xl">
      <h1 class="title text-[28px] md:text-[32px] leading-tight mb-6">Profile</h1>

      <section class="panel p-5 md:p-6 flex flex-col sm:flex-row gap-6 items-start">
        <div class="relative group">
          <Avatar :name="account.username || session.username" :src="account.profile_image" :size="96" />
          <label for="avatarUpload" class="absolute inset-0 rounded-full bg-black/55 text-white text-xs font-medium grid place-items-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">Change</label>
          <input id="avatarUpload" ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onFileSelected">
        </div>
        <div class="flex-1 min-w-0 w-full">
          <p class="title text-2xl">{{ account.username || session.username }}</p>
          <p class="text-muted text-[13.5px] capitalize mb-5">{{ account.role || session.role }} account</p>
          <div class="flex justify-between text-[13px] mb-2">
            <span>{{ formatBytes(account.used_bytes) }} used</span>
            <span class="text-muted">{{ formatBytes(Math.max(0, account.quota_bytes - account.used_bytes)) }} free of {{ formatBytes(account.quota_bytes) }}</span>
          </div>
          <div class="meter !h-2" :class="{ warn: pct >= 90 }"><span :style="{ width: pct + '%' }"></span></div>
          <div class="flex gap-2 mt-5">
            <label for="avatarUpload" class="btn btn-sm cursor-pointer"><Icon name="image" :size="15" />Change photo</label>
            <button v-if="account.profile_image" class="btn btn-ghost btn-sm" @click="removeAvatar">Remove photo</button>
          </div>
        </div>
      </section>

      <section class="panel p-5 md:p-6 mt-5">
        <h2 class="title text-lg mb-1">Password</h2>
        <p class="text-muted text-[13.5px] mb-5">You’ll stay signed in on this device after changing it.</p>
        <form @submit.prevent="changePassword" class="grid gap-4 max-w-sm">
          <div>
            <label class="label" for="cur">Current password</label>
            <input id="cur" v-model="pw.current" type="password" class="input" autocomplete="current-password" required>
          </div>
          <div>
            <label class="label" for="new">New password</label>
            <input id="new" v-model="pw.next" type="password" class="input" autocomplete="new-password" minlength="4" required>
          </div>
          <div>
            <label class="label" for="rep">Repeat new password</label>
            <input id="rep" v-model="pw.repeat" type="password" class="input" autocomplete="new-password" required>
            <p v-if="pw.repeat && pw.repeat !== pw.next" class="text-danger text-xs mt-1.5">The passwords don’t match.</p>
          </div>
          <div><button type="submit" class="btn btn-primary" :disabled="pw.busy || pw.repeat !== pw.next">Update password</button></div>
        </form>
      </section>

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
      const ok = await attempt(async () => { await api('/api/user/password', { method: 'PATCH', body: { currentPassword: pw.current, newPassword: pw.next } }); return true; }, 'Password updated');
      pw.busy = false;
      if (ok) Object.assign(pw, { current: '', next: '', repeat: '' });
    }

    onMounted(refreshAccount);
    return { account, session, pct, pw, fileInputRef, cropImageSrc, cropperImageRef, onFileSelected, cancelCrop, confirmCrop, removeAvatar, changePassword, formatBytes };
  },
};
