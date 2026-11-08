import { ref, computed, watch, nextTick, onUnmounted } from 'vue';

// ---------------------------------------------------------------------------
// Helpers for long lists (thousands of videos, songs, photos or files).
// ---------------------------------------------------------------------------

/**
 * Render a long list a chunk at a time. Only the first `step` items are built,
 * and the next chunk is added when an invisible marker after the list comes
 * within a screen or so of the viewport. The shown list is always a prefix of the
 * full one, so indexes (viewer start, drag and drop, shift-click) stay the same.
 *
 *   const { shown, more, end } = useRenderLimit(list, { step: 120, resetOn: () => [search.value, sort.value] });
 *   <Card v-for="it in shown" …/> <div v-if="more" ref="end"></div>   (return `end` from setup under the ref's name)
 *
 * `resetOn` goes back to the first chunk when the filters change, so typing a
 * search only builds what can be seen. `reveal(y)` adds chunks until the page is
 * tall enough to scroll to y (scroll restoration).
 */
export function useRenderLimit(source, { step = 120, resetOn = null, margin = '1600px' } = {}) {
  const limit = ref(step);
  const total = () => (source.value || []).length;
  const shown = computed(() => { const l = source.value || []; return l.length > limit.value ? l.slice(0, limit.value) : l; });
  const more = computed(() => total() > limit.value);
  const end = ref(null);

  let io = null;
  // An observer only reports changes: when the marker is still in view after a chunk
  // was added (a tall screen, a short chunk), observing it again reports it once more.
  const recheck = () => nextTick(() => { if (io && end.value) { io.unobserve(end.value); io.observe(end.value); } });
  function observe(el) {
    if (io) { io.disconnect(); io = null; }
    if (!el) return;
    io = new IntersectionObserver((entries) => {
      if (!entries.some(e => e.isIntersecting) || !more.value) return;
      limit.value += step;
      recheck();
    }, { rootMargin: `${margin} 0px` });
    io.observe(el);
  }
  watch(end, observe, { flush: 'post' });
  if (resetOn) watch(resetOn, () => { limit.value = step; recheck(); });
  onUnmounted(() => { if (io) io.disconnect(); });

  async function reveal(y) {
    while (more.value && document.documentElement.scrollHeight < y + window.innerHeight) {
      limit.value += step;
      await nextTick();
    }
  }
  return { shown, more, end, reveal };
}

/**
 * Selected ids as an array (for the API and counts) with a Set for lookups, so a
 * grid of thousands asking "is this one selected?" stays fast after "Select all".
 */
export function useSelection() {
  const selected = ref([]);
  const set = computed(() => new Set(selected.value));
  const isSel = (id) => set.value.has(id);
  const toggle = (id) => { if (set.value.has(id)) selected.value = selected.value.filter(x => x !== id); else selected.value = [...selected.value, id]; };
  /** add every id in `ids` that isn't selected yet (shift-click ranges) */
  const add = (ids) => { const s = set.value; const fresh = ids.filter(id => !s.has(id)); if (fresh.length) selected.value = [...selected.value, ...fresh]; };
  const clear = () => { selected.value = []; };
  return { selected, isSel, toggle, add, clear };
}
