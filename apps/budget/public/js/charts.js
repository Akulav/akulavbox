// Florin's charts, drawn as SVG: bars (grouped or stacked), the cumulative "pace" line and the
// category donut. They size themselves to their box and show a tooltip under the pointer.
import { money, moneyCompact } from './format.js';
import { chartTheme } from './store.js';

const PAD = { top: 8, right: 8, bottom: 26, left: 56 };

/** Round step ticks from 0 to just above `max` */
function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/** A bar with rounded top corners */
function roundTop(x, y, w, h, r) {
  if (h <= 0 || w <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Smooth line through points that never overshoots them (monotone cubic, like d3's curveMonotoneX) */
function monotonePath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  const n = pts.length;
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${pts[i][0] + h},${pts[i][1] + h * t[i]} ${pts[i + 1][0] - h},${pts[i + 1][1] - h * t[i + 1]} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

/** Size tracking and the tooltip, shared by every chart */
const chartBase = {
  props: { currency: { type: String, default: 'EUR' } },
  data: () => ({ w: 0, h: 0, tip: null }),
  computed: {
    ct: () => chartTheme.value,
    plot() {
      return { x: PAD.left, y: PAD.top, w: Math.max(0, this.w - PAD.left - PAD.right), h: Math.max(0, this.h - PAD.top - PAD.bottom) };
    },
  },
  mounted() {
    const measure = () => {
      const r = this.$el.getBoundingClientRect();
      this.w = Math.round(r.width);
      this.h = Math.round(r.height);
    };
    measure();
    this.ro = new ResizeObserver(measure);
    this.ro.observe(this.$el);
  },
  unmounted() {
    this.ro?.disconnect();
  },
  methods: {
    money(v) {
      return money(v, this.currency);
    },
    axisLabel(v) {
      return moneyCompact(v, this.currency);
    },
    /** Places the tooltip beside the pointer, flipped when it would leave the box */
    showTip(e, label, rows) {
      const box = this.$el.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      const left = x > this.w / 2 ? undefined : x + 14;
      const right = x > this.w / 2 ? this.w - x + 14 : undefined;
      this.tip = { label, rows, style: { left: left === undefined ? 'auto' : `${left}px`, right: right === undefined ? 'auto' : `${right}px`, top: `${Math.max(0, Math.min(y - 20, this.h - 90))}px` } };
    },
  },
};

const TIP = /*html*/ `
  <div v-if="tip && tip.rows.length" class="chart-tip" :style="tip.style">
    <div v-if="tip.label" class="mb-1.5 font-semibold text-ink">{{ tip.label }}</div>
    <div class="space-y-1">
      <div v-for="r in tip.rows" :key="r.name" class="flex items-center justify-between gap-4">
        <span class="flex items-center gap-1.5 text-ink-2"><span class="h-2.5 w-2.5 rounded-sm" :style="{ backgroundColor: r.color }"></span>{{ r.name }}</span>
        <span class="num font-semibold text-ink">{{ money(r.value) }}</span>
      </div>
    </div>
  </div>`;

const Y_AXIS = /*html*/ `
  <g>
    <line v-for="t in yTicks" :key="'g' + t" :x1="plot.x" :x2="plot.x + plot.w" :y1="yOf(t)" :y2="yOf(t)" :stroke="ct.grid" />
    <text v-for="t in yTicks" :key="'l' + t" :x="plot.x - 8" :y="yOf(t)" text-anchor="end" dominant-baseline="middle" :fill="ct.axis" font-size="12">{{ axisLabel(t) }}</text>
  </g>`;

/**
 * Bars per row: side by side, or stacked. `series` = [{ key, name, color }];
 * `barColor(row)` colors a single-series chart bar by bar.
 */
export const BarChart = {
  mixins: [chartBase],
  props: {
    rows: { type: Array, required: true },
    x: { type: String, required: true },
    series: { type: Array, required: true },
    stacked: Boolean,
    xLabel: { type: Function, default: (v) => v },
    tipLabel: { type: Function, default: (v) => v },
    barColor: Function,
    hideZero: Boolean,
    maxBar: { type: Number, default: 22 },
    gap: { type: Number, default: 0.22 },
  },
  data: () => ({ hover: -1 }),
  computed: {
    max() {
      let max = 0;
      for (const r of this.rows) {
        if (this.stacked) max = Math.max(max, this.series.reduce((a, s) => a + (r[s.key] || 0), 0));
        else for (const s of this.series) max = Math.max(max, r[s.key] || 0);
      }
      return max;
    },
    yTicks() {
      return niceTicks(this.max);
    },
    top() {
      return this.yTicks[this.yTicks.length - 1] || 1;
    },
    band() {
      return this.rows.length ? this.plot.w / this.rows.length : 0;
    },
    /** Every bar to draw: { d, fill } */
    bars() {
      const out = [];
      const inner = this.band * (1 - this.gap);
      this.rows.forEach((r, i) => {
        const x0 = this.plot.x + i * this.band;
        if (this.stacked) {
          const bw = Math.min(this.maxBar, inner);
          const bx = x0 + (this.band - bw) / 2;
          const segs = this.series.map((s) => ({ s, v: r[s.key] || 0 })).filter((p) => p.v > 0);
          let acc = 0;
          segs.forEach(({ s, v }, j) => {
            const y1 = this.yOf(acc + v);
            const y0 = this.yOf(acc);
            acc += v;
            const last = j === segs.length - 1;
            out.push({ d: last ? roundTop(bx, y1, bw, y0 - y1, 4) : `M${bx},${y1}h${bw}V${y0}h${-bw}Z`, fill: s.color, stroke: true });
          });
        } else {
          const k = this.series.length;
          const bw = Math.max(1, Math.min(this.maxBar, (inner - (k - 1) * 2) / k));
          const total = bw * k + (k - 1) * 2;
          this.series.forEach((s, j) => {
            const v = r[s.key] || 0;
            const bx = x0 + (this.band - total) / 2 + j * (bw + 2);
            const y = this.yOf(v);
            out.push({ d: roundTop(bx, y, bw, this.plot.y + this.plot.h - y, 4), fill: this.barColor ? this.barColor(r) : s.color });
          });
        }
      });
      return out;
    },
    /** Which x labels fit (every one, or every n-th) */
    labelEvery() {
      const longest = Math.max(1, ...this.rows.map((r) => String(this.xLabel(r[this.x])).length));
      return Math.max(1, Math.ceil((longest * 7 + 8) / Math.max(1, this.band)));
    },
  },
  methods: {
    yOf(v) {
      return this.plot.y + this.plot.h - (v / this.top) * this.plot.h;
    },
    move(e) {
      const box = this.$el.getBoundingClientRect();
      const i = Math.floor((e.clientX - box.left - this.plot.x) / this.band);
      if (i < 0 || i >= this.rows.length) return this.leave();
      this.hover = i;
      const r = this.rows[i];
      const rows = this.series
        .map((s) => ({ name: s.name, color: this.barColor ? this.barColor(r) : s.color, value: r[s.key] ?? 0 }))
        .filter((p) => !this.hideZero || p.value !== 0);
      this.showTip(e, this.tipLabel(r[this.x]), rows);
    },
    leave() {
      this.hover = -1;
      this.tip = null;
    },
  },
  template: /*html*/ `
    <div class="chart" @mouseleave="leave">
      <svg v-if="w" :width="w" :height="h" @mousemove="move" role="img">
        ${Y_AXIS}
        <rect v-if="hover >= 0" :x="plot.x + hover * band" :y="plot.y" :width="band" :height="plot.h" :fill="ct.grid" opacity="0.5" />
        <path v-for="(b, i) in bars" :key="i" :d="b.d" :fill="b.fill" :stroke="b.stroke ? ct.surface : 'none'" :stroke-width="b.stroke ? 1.5 : 0" />
        <template v-for="(r, i) in rows" :key="'x' + i">
          <text v-if="i % labelEvery === 0" :x="plot.x + (i + 0.5) * band" :y="h - 8" text-anchor="middle" :fill="ct.axis" font-size="12">{{ xLabel(r[x]) }}</text>
        </template>
      </svg>
      ${TIP}
    </div>`,
};

/** This month's running total against last month's (dashed), day by day */
export const PaceChart = {
  mixins: [chartBase],
  props: {
    rows: { type: Array, required: true }, // [{ day, cumulative, prevCumulative }]
    current: { type: String, required: true }, // series names
    previous: { type: String, required: true },
  },
  data: () => ({ hover: -1 }),
  computed: {
    yTicks() {
      return niceTicks(Math.max(0, ...this.rows.map((r) => Math.max(r.cumulative ?? 0, r.prevCumulative ?? 0))));
    },
    top() {
      return this.yTicks[this.yTicks.length - 1] || 1;
    },
    step() {
      return this.rows.length > 1 ? this.plot.w / (this.rows.length - 1) : 0;
    },
    /** Runs of consecutive points that have a value */
    runs() {
      const of = (key) => {
        const runs = [];
        let cur = [];
        this.rows.forEach((r, i) => {
          if (r[key] === null || r[key] === undefined) {
            if (cur.length) runs.push(cur);
            cur = [];
          } else cur.push([this.xOf(i), this.yOf(r[key])]);
        });
        if (cur.length) runs.push(cur);
        return runs;
      };
      return { cur: of('cumulative'), prev: of('prevCumulative') };
    },
    linePrev() {
      return this.runs.prev.map(monotonePath).join('');
    },
    lineCur() {
      return this.runs.cur.map(monotonePath).join('');
    },
    areaCur() {
      const base = this.plot.y + this.plot.h;
      return this.runs.cur.map((pts) => `${monotonePath(pts)}L${pts[pts.length - 1][0]},${base}L${pts[0][0]},${base}Z`).join('');
    },
    /** Day labels that fit, always keeping the first and last */
    ticks() {
      if (!this.rows.length) return [];
      const every = Math.max(1, Math.ceil(30 / Math.max(1, this.step)));
      const last = this.rows.length - 1;
      const out = [];
      for (let i = 0; i <= last; i += every) if (last - i >= every || i === 0) out.push(i);
      out.push(last);
      return [...new Set(out)];
    },
    gid: () => `spend-${Math.random().toString(36).slice(2, 8)}`,
  },
  methods: {
    xOf(i) {
      return this.plot.x + i * this.step;
    },
    yOf(v) {
      return this.plot.y + this.plot.h - (v / this.top) * this.plot.h;
    },
    move(e) {
      const box = this.$el.getBoundingClientRect();
      const i = Math.round((e.clientX - box.left - this.plot.x) / (this.step || 1));
      if (i < 0 || i >= this.rows.length) return this.leave();
      this.hover = i;
      const r = this.rows[i];
      const rows = [
        { name: this.previous, color: this.ct.prev, value: r.prevCumulative },
        { name: this.current, color: this.ct.spend, value: r.cumulative },
      ].filter((p) => p.value !== null && p.value !== undefined);
      this.showTip(e, `Day ${r.day}`, rows);
    },
    leave() {
      this.hover = -1;
      this.tip = null;
    },
  },
  template: /*html*/ `
    <div class="chart" @mouseleave="leave">
      <svg v-if="w" :width="w" :height="h" @mousemove="move" role="img">
        <defs>
          <linearGradient :id="gid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" :stop-color="ct.spend" stop-opacity="0.22" />
            <stop offset="100%" :stop-color="ct.spend" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${Y_AXIS}
        <line v-if="hover >= 0" :x1="xOf(hover)" :x2="xOf(hover)" :y1="plot.y" :y2="plot.y + plot.h" :stroke="ct.axis" stroke-dasharray="3 3" />
        <path :d="linePrev" fill="none" :stroke="ct.prev" stroke-width="2" stroke-dasharray="5 4" />
        <path :d="areaCur" :fill="'url(#' + gid + ')'" stroke="none" />
        <path :d="lineCur" fill="none" :stroke="ct.spend" stroke-width="2.25" />
        <template v-if="hover >= 0">
          <circle v-if="rows[hover].prevCumulative != null" :cx="xOf(hover)" :cy="yOf(rows[hover].prevCumulative)" r="4" :fill="ct.prev" :stroke="ct.surface" stroke-width="2" />
          <circle v-if="rows[hover].cumulative != null" :cx="xOf(hover)" :cy="yOf(rows[hover].cumulative)" r="5" :fill="ct.spend" :stroke="ct.surface" stroke-width="2" />
        </template>
        <text v-for="i in ticks" :key="i" :x="xOf(i)" :y="h - 8" text-anchor="middle" :fill="ct.axis" font-size="12">{{ rows[i].day }}</text>
      </svg>
      ${TIP}
    </div>`,
};

/** Share of each slice ({ name, color, spent }) as a ring, starting at the top, clockwise */
export const Donut = {
  mixins: [chartBase],
  props: { slices: { type: Array, required: true }, inner: { type: Number, default: 64 }, outer: { type: Number, default: 92 } },
  data: () => ({ hover: -1 }),
  computed: {
    arcs() {
      const total = this.slices.reduce((a, s) => a + s.spent, 0);
      if (!total) return [];
      const cx = this.w / 2, cy = this.h / 2, R = this.outer, r = this.inner;
      const pad = this.slices.length > 1 ? (1.5 * Math.PI) / 180 : 0;
      const pt = (rad, a) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
      let a = 0;
      return this.slices.map((s) => {
        const sweep = (s.spent / total) * Math.PI * 2;
        const a0 = a + pad / 2;
        const a1 = Math.max(a0 + 0.001, a + sweep - pad / 2);
        a += sweep;
        if (sweep >= Math.PI * 2 - 1e-6) {
          // one slice: a full ring (an arc can't start and end at the same point)
          return { d: `M${cx},${cy - R}A${R},${R} 0 1 1 ${cx - 0.01},${cy - R}ZM${cx},${cy - r}A${r},${r} 0 1 0 ${cx + 0.01},${cy - r}Z`, s };
        }
        const big = a1 - a0 > Math.PI ? 1 : 0;
        const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, a0);
        return { d: `M${x0},${y0}A${R},${R} 0 ${big} 1 ${x1},${y1}L${x2},${y2}A${r},${r} 0 ${big} 0 ${x3},${y3}Z`, s };
      });
    },
  },
  methods: {
    over(e, i) {
      this.hover = i;
      const s = this.slices[i];
      this.showTip(e, '', [{ name: s.name, color: s.color, value: s.spent }]);
    },
    leave() {
      this.hover = -1;
      this.tip = null;
    },
  },
  template: /*html*/ `
    <div class="chart" @mouseleave="leave">
      <svg v-if="w" :width="w" :height="h" role="img">
        <path v-for="(a, i) in arcs" :key="i" :d="a.d" :fill="a.s.color" :stroke="ct.surface" stroke-width="2" fill-rule="evenodd"
          :opacity="hover < 0 || hover === i ? 1 : 0.55" @mousemove="over($event, i)" />
      </svg>
      ${TIP}
    </div>`,
};
