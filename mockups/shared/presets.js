/*
 * Presets — the eight built-ins from the Python app, as data, plus helpers for user presets.
 *
 * A preset is a *spec*, not a snapshot. Each field is one of:
 *   5            a fixed value
 *   [lo, hi]     an integer in lo..hi inclusive           (or [lo, hi, step] to land on lo + n*step)
 *   {pick:[...]} one of these
 *   {around:[v, spread]}  an angle within +-spread degrees of v (wraps at 360)
 * Applying a preset *rolls* every range, so "Main" is different each time you pick it. (The Python app
 * rolled once at import, so a preset was identical until restart — Appendix A of PLAN.md.)
 *
 * Field names are the stand-in engine's: length (Python clength), lo/hi (bottom/upper_threshold).
 * Presets hold the recipe only — never shapes, masks or the animation algorithm.
 * The stand-in is throwaway; the Go engine reads the same JSON shape.
 */
(function (root) {
  "use strict";

  // Python's five sort keys, in the stand-in's names (lightness -> luma, minimum -> value)
  const KEYS5 = ["luma", "hue", "intensity", "value", "saturation"];
  const MODES5 = ["random", "threshold", "edges", "wave", "none"];

  // Fields a preset owns. Applying one resets all of these, so a preset always recalls the same recipe.
  const OWNED = ["mode", "length", "randomness", "lo", "hi", "edge", "angle", "key", "reverse"];

  const BUILTIN = [
    { id: "main", name: "Main", desc: "Long runs, a lot left alone, any direction.",
      spec: { mode: "random", key: "intensity", randomness: [35, 64], length: [150, 325, 25], angle: [0, 359] } },
    { id: "file", name: "File", desc: "Sorts only along edges. Gritty, structural.",
      spec: { mode: "edges", key: "value", randomness: [15, 64], angle: 0 } },
    { id: "random", name: "Random", desc: "Dice on every knob. Anything can happen.",
      spec: { mode: { pick: MODES5 }, key: { pick: KEYS5 }, randomness: [5, 74], length: [50, 475, 25], angle: [0, 359],
              lo: [.1, .45, .05], hi: [.5, .95, .05] } },
    { id: "kims", name: "Kims", desc: "Kim Asendorf’s original: threshold, straight up.",
      spec: { mode: "threshold", key: { pick: KEYS5 }, angle: 90, hi: [.15, .84, .01] } },
    { id: "gentle", name: "Gentle", desc: "Subtle. Short runs, little unsorted.",
      spec: { mode: "threshold", key: "luma", randomness: 5, length: 25, angle: 0, lo: .3, hi: .7 } },
    { id: "intense", name: "Intense", desc: "Aggressive. Big runs, diagonal, hue-sorted.",
      spec: { mode: "random", key: "hue", randomness: 50, length: 200, angle: 45, lo: .1, hi: .9 } },
    { id: "waves", name: "Waves", desc: "Rolling intervals for an organic flow.",
      spec: { mode: "wave", key: "saturation", randomness: 20, length: 75, angle: 15 } },
    { id: "edges", name: "Edges", desc: "Follows the picture’s own outlines.",
      spec: { mode: "edges", key: "intensity", randomness: 15, angle: 0 } },
  ];

  /** Small deterministic generator, so tests (and "same seed, same roll") are reproducible. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const round2 = (v) => Math.round(v * 100) / 100;

  function rollField(v, rnd) {
    if (Array.isArray(v)) {
      const lo = v[0], hi = v[1], step = v[2] || 1, n = Math.floor((hi - lo) / step + 1e-9);
      return round2(lo + Math.floor(rnd() * (n + 1)) * step);
    }
    if (v && v.pick) return v.pick[Math.floor(rnd() * v.pick.length)];
    if (v && v.around) return (((Math.round(v.around[0] + (rnd() * 2 - 1) * v.around[1])) % 360) + 360) % 360;
    return v;
  }

  /** Resolve a spec to concrete params. `base` (defaults) fills every owned field the preset leaves out. */
  function roll(preset, rnd, base) {
    const out = {};
    OWNED.forEach((k) => { if (base && base[k] !== undefined) out[k] = base[k]; });
    out.reverse = false;
    Object.keys(preset.spec).forEach((k) => { out[k] = rollField(preset.spec[k], rnd || Math.random); });
    // A rolled upper threshold can land under the inherited lower one (Kims did, in Python too: an empty band
    // sorts nothing). Pull the lower one down so the band is never empty.
    if (out.lo > out.hi - 0.05) out.lo = round2(Math.max(0, out.hi - 0.15));
    return out;
  }

  /** Does this preset roll anything? (decides whether "roll again" is offered) */
  function rolls(preset) {
    return Object.keys(preset.spec).some((k) => { const v = preset.spec[k]; return Array.isArray(v) || (v && (v.pick || v.around)); });
  }

  /** Short human summary of one field, e.g. "35–64" or "any" — for the picker. */
  function describeField(k, v) {
    if (Array.isArray(v)) return v[0] + "–" + v[1] + (k === "angle" ? "°" : "");
    if (v && v.pick) return "any";
    if (v && v.around) return "±" + v.around[1] + "°";
    return String(v);
  }
  function chips(preset) {
    const s = preset.spec, c = [];
    if (s.mode) c.push(describeField("mode", s.mode));
    if (s.angle !== undefined) c.push(describeField("angle", s.angle) + (typeof s.angle === "number" ? "°" : ""));
    return c;
  }

  /** Turn the current params into a user preset spec. `spread` makes it roll a little around those values. */
  function fromParams(p, spread) {
    const spec = {};
    OWNED.forEach((k) => { spec[k] = p[k]; });
    if (spread) {
      spec.randomness = [Math.max(0, p.randomness - 10), Math.min(100, p.randomness + 10)];
      spec.length = [Math.max(6, Math.round(p.length * 0.7)), Math.round(p.length * 1.3)];
      spec.angle = { around: [p.angle, 20] };
    }
    return spec;
  }

  /** Which owned fields of `now` differ from the `applied` snapshot — drives the "edited" tag. */
  function diff(applied, now) {
    return OWNED.filter((k) => applied && applied[k] !== now[k]);
  }

  const api = { BUILTIN, OWNED, KEYS5, MODES5, roll, rolls, chips, fromParams, diff, mulberry32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Presets = api;
})(typeof self !== "undefined" ? self : this);
