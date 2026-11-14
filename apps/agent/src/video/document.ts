import type { ExportSource } from "./store.js";

export const exportInstructions = `
Video export: design a responsive portrait-friendly composition, readable at 1080x1920, with generous top/bottom and right safe margins for reels controls. Keep the focal subject large and centered. Inline all assets; only bundled /runtime/three.module.js is available.
HTML/Three.js MUST expose window.videoExport = { ready: Promise<void> (resolves after fonts/assets/scene load), async renderAt(timeSeconds) {} }. renderAt must reconstruct the exact scene at an absolute time in seconds, await the draw, and work in any call order. Use analytic time-based motion or fixed-step simulation from the initial state; never wall-clock deltas. Use a fixed seeded PRNG (seed 42) for all randomness. During export window.__VIDEO_EXPORT__ is true: do not start requestAnimationFrame loops, timers, audio, or automatic physics. For interactive preview only, drive the SAME renderAt function with requestAnimationFrame. Static pages still expose an async no-op renderAt. Use responsive canvas sizing, antialias:true and preserveDrawingBuffer:true on WebGLRenderer, and renderer.render(scene,camera) inside renderAt. SVG should be self-contained declarative markup with viewBox; animate with SVG SMIL or CSS, without scripts or external assets. SVG animation is seeked by the exporter.`;

/** SVG gets a reliable declarative adapter. Scripted legacy pages must regenerate. */
export function exportDocument(source: ExportSource) {
  if (source.format !== "svg") {
    const content = source.content.replaceAll("/api/arena/runtime/", "/runtime/");
    // Script-free HTML and CSS animation have an exact browser timeline adapter.
    if (!/<script\b|\bon\w+\s*=|<(?:canvas|video|audio|iframe|object|embed)\b/i.test(content))
      return content + `<script>window.videoExport={ready:document.fonts.ready.then(()=>{}),async renderAt(t){for(const a of document.getAnimations()){a.pause();a.currentTime=t*1000}}}</script>`;
    return content;
  }
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(source.content) || /<script\b|\bon\w+\s*=|<foreignObject\b/i.test(source.content))
    throw new Error("UNSUPPORTED: Scripted or embedded-document SVG must be regenerated as declarative SVG.");
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#161c1e}body{display:grid;place-items:center}svg{width:88%;height:78%;object-fit:contain}</style>${source.content.replace(/<\?xml[^>]*>/i, "")}<script>
  const svg=document.querySelector('svg');svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  window.videoExport={ready:document.fonts.ready.then(()=>{svg.pauseAnimations?.()}),async renderAt(t){svg.setCurrentTime?.(t);for(const a of document.getAnimations()){a.pause();a.currentTime=t*1000}}};
  </script>`;
}
