// Fonds d'écran animés (shaders WebGL1 « Mesh drift » et « Silk » du 21st.dev Shader Builder), sans
// bibliothèque : un triangle plein écran dans un <canvas> fixe derrière l'app. Même logique que l'app Sport.
// Choix et vitesse gardés sur cet appareil (localStorage « bg-style » / « bg-speed »), réglés dans Réglages.
// Les shaders sont ici (et non dans le HTML) : la CSP de la page interdit tout script en ligne.

// Base commune aux deux shaders (identique mot pour mot à celle du Shader Builder) ; seule shade() diffère.
const HEAD = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n\nuniform vec3 u_colors[8];\nuniform vec4 u_scene;      // resolution.xy, time, colour count\nuniform vec4 u_shape;      // scale, intensity, paramA, warp\nuniform vec4 u_surface;    // detail, contrast, brightness, saturation\nuniform vec4 u_finish;     // hue, vignette, blur, grain\nuniform vec4 u_transform;  // seed, rotation, drift, OKLab toggle\nuniform vec4 u_space;      // offset.xy, pointer.xy\nuniform vec4 u_cursor;\n\n#define u_resolution u_scene.xy\n#define u_time u_scene.z\n#define u_colorCount u_scene.w\n#define u_scale u_shape.x\n#define u_intensity u_shape.y\n#define u_paramA u_shape.z\n#define u_warp u_shape.w\n#define u_detail u_surface.x\n#define u_contrast u_surface.y\n#define u_brightness u_surface.z\n#define u_saturation u_surface.w\n#define u_hue u_finish.x\n#define u_vignette u_finish.y\n#define u_blur u_finish.z\n#define u_grain u_finish.w\n#ifdef GL_FRAGMENT_PRECISION_HIGH\n#define u_seed u_transform.x\n#else\n#define u_seed mod(u_transform.x, 31.0)\n#endif\n#define u_rotate u_transform.y\n#define u_drift u_transform.z\n#define u_oklab u_transform.w\n#define u_offset u_space.xy\n#define u_mouse u_space.zw\n#define u_cursorPresence u_cursor.x\n#define u_cursorEffect u_cursor.y\n#define u_cursorStrength u_cursor.z\n#define u_cursorRadius u_cursor.w\n\nfloat hash21(vec2 p) {\n#ifndef GL_FRAGMENT_PRECISION_HIGH\n  p = mod(p, 31.0);\n#endif\n  p = fract(p * vec2(234.34, 435.345));\n  p += dot(p, p + 34.23);\n  return fract(p.x * p.y);\n}\n\nfloat grainHash(vec2 p) {\n  vec3 p3 = fract(vec3(p.xyx) * 0.1031);\n  p3 += dot(p3, p3.yzx + 33.33);\n  return fract((p3.x + p3.y) * p3.z);\n}\n\nvec2 hash22(vec2 p) {\n#ifndef GL_FRAGMENT_PRECISION_HIGH\n  p = mod(p, 31.0);\n#endif\n  float n = sin(dot(p, vec2(41.0, 289.0)));\n  return fract(vec2(15731.743, 7892.321) * n);\n}\n\nfloat noise(vec2 p) {\n  vec2 i = floor(p);\n  vec2 f = fract(p);\n  vec2 u = f * f * (3.0 - 2.0 * f);\n  return mix(\n    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),\n    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),\n    u.y);\n}\n\nfloat fbm(vec2 p) {\n  float v = 0.0;\n  float a = 0.5;\n  for (int i = 0; i < 5; i++) {\n    v += a * noise(p);\n    p = p * 2.03 + vec2(17.0, 9.2);\n    a *= 0.5;\n  }\n  return v;\n}\n\nvec3 srgbToLinear(vec3 c) {\n  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)),\n    step(0.04045, c));\n}\nvec3 linearToSrgb(vec3 c) {\n  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,\n    step(0.0031308, c));\n}\nvec3 linToOklab(vec3 c) {\n  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;\n  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;\n  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;\n  l = pow(max(l, 0.0), 1.0 / 3.0);\n  m = pow(max(m, 0.0), 1.0 / 3.0);\n  s = pow(max(s, 0.0), 1.0 / 3.0);\n  return vec3(\n    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,\n    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,\n    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);\n}\nvec3 oklabToLin(vec3 c) {\n  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;\n  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;\n  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;\n  l = l * l * l; m = m * m * m; s = s * s * s;\n  return vec3(\n    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,\n    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,\n    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);\n}\nvec3 mixColour(vec3 a, vec3 b, float t) {\n  if (u_oklab > 0.5) {\n    vec3 la = linToOklab(srgbToLinear(a));\n    vec3 lb = linToOklab(srgbToLinear(b));\n    return clamp(linearToSrgb(oklabToLin(mix(la, lb, t))), 0.0, 1.0);\n  }\n  return mix(a, b, t);\n}\n\nvec3 palette(float x) {\n  float n = max(u_colorCount - 1.0, 1.0);\n  float f = clamp(x, 0.0, 1.0) * n;\n  vec3 col = u_colors[0];\n  for (int i = 0; i < 7; i++) {\n    if (float(i) < n)\n      col = mixColour(col, u_colors[i + 1],\n        smoothstep(0.0, 1.0, clamp(f - float(i), 0.0, 1.0)));\n  }\n  return col;\n}\n\nvec3 hueRotate(vec3 col, float a) {\n  const mat3 toYIQ = mat3(0.299, 0.596, 0.211,\n                          0.587, -0.274, -0.523,\n                          0.114, -0.322, 0.312);\n  const mat3 toRGB = mat3(1.0, 1.0, 1.0,\n                          0.956, -0.272, -1.106,\n                          0.621, -0.647, 1.703);\n  vec3 yiq = toYIQ * col;\n  float ca = cos(a), sa = sin(a);\n  yiq = vec3(yiq.x, yiq.y * ca - yiq.z * sa, yiq.y * sa + yiq.z * ca);\n  return toRGB * yiq;\n}\n\n";
const TAIL = "void main() {\n  vec2 uv = gl_FragCoord.xy / u_resolution.xy;\n  vec2 screenUv = uv;\n  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution.xy)\n    / min(u_resolution.x, u_resolution.y);\n  float cursorMask = 0.0;\n\n  if (u_cursorPresence > 0.001) {\n    vec2 cursor = (0.5 * u_mouse * u_resolution.xy)\n      / min(u_resolution.x, u_resolution.y);\n    vec2 cursorDelta = p - cursor;\n    if (u_cursorEffect < 0.5) {\n      p += cursor * u_cursorPresence * u_cursorStrength * 0.55;\n    } else {\n      float cursorDistance = length(cursorDelta);\n      vec2 cursorDirection = cursorDelta / max(cursorDistance, 0.0001);\n      cursorMask = u_cursorPresence\n        * (1.0 - smoothstep(0.0, u_cursorRadius, cursorDistance));\n      if (u_cursorEffect < 1.5) {\n        p -= cursorDirection * cursorMask * u_cursorStrength * 0.24;\n      } else if (u_cursorEffect < 2.5) {\n        float cursorAngle = cursorMask * u_cursorStrength * 2.2;\n        float cc = cos(cursorAngle), cs = sin(cursorAngle);\n        p = cursor + mat2(cc, -cs, cs, cc) * cursorDelta;\n      } else if (u_cursorEffect < 3.5) {\n        float ripple = sin(\n          cursorDistance / max(u_cursorRadius, 0.001) * 18.0 - u_time * 5.0);\n        p -= cursorDirection * ripple * cursorMask * u_cursorStrength * 0.07;\n      }\n    }\n  }\n\n  uv = p * min(u_resolution.x, u_resolution.y) / u_resolution.xy + 0.5;\n  p *= u_scale;\n  if (abs(u_rotate) > 0.0001) {\n    float cr = cos(u_rotate), sr = sin(u_rotate);\n    p = mat2(cr, -sr, sr, cr) * p;\n  }\n  p += u_offset;\n  if (u_drift > 0.0001)\n    p += u_drift * vec2(sin(u_time * 0.31), cos(u_time * 0.23));\n  if (u_warp > 0.0) {\n    p += u_warp * (vec2(\n      fbm(p * u_detail + u_seed),\n      fbm(p * u_detail + vec2(5.2, 1.3))) - 0.5);\n  }\n  vec3 col;\n  if (u_blur > 0.0) {\n    float e = u_blur;\n    float pe = e * u_scale;\n    vec2 uvE = vec2(e) * min(u_resolution.x, u_resolution.y) / u_resolution.xy;\n    col  = shade(uv, p, u_time) * 0.36;\n    col += shade(uv + vec2(uvE.x, 0.0), p + vec2(pe, 0.0), u_time) * 0.16;\n    col += shade(uv - vec2(uvE.x, 0.0), p - vec2(pe, 0.0), u_time) * 0.16;\n    col += shade(uv + vec2(0.0, uvE.y), p + vec2(0.0, pe), u_time) * 0.16;\n    col += shade(uv - vec2(0.0, uvE.y), p - vec2(0.0, pe), u_time) * 0.16;\n  } else {\n    col = shade(uv, p, u_time);\n  }\n  if (abs(u_contrast - 1.0) > 0.0001)\n    col = (col - 0.5) * u_contrast + 0.5;\n  if (abs(u_saturation - 1.0) > 0.0001) {\n    float luma = dot(col, vec3(0.299, 0.587, 0.114));\n    col = mix(vec3(luma), col, u_saturation);\n  }\n  if (abs(u_hue) > 0.0001)\n    col = hueRotate(col, u_hue);\n  if (abs(u_brightness) > 0.0001)\n    col += u_brightness;\n  if (u_vignette > 0.0001) {\n    float vd = length(screenUv - 0.5) * 1.41421356;\n    col *= 1.0 - u_vignette * smoothstep(0.35, 1.0, vd);\n  }\n  if (u_cursorPresence > 0.001 && u_cursorEffect > 3.5)\n    col += (vec3(0.18) + col * 0.12) * cursorMask * u_cursorStrength;\n  if (u_grain > 0.0001)\n    col += (grainHash(\n      gl_FragCoord.xy + vec2(u_seed * 17.0, u_seed * 31.0)) - 0.5) * u_grain;\n  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);\n}\n";
const SHADE = {
  mesh: "vec3 shade(vec2 uv, vec2 p, float t) {\n  vec3 acc = u_colors[0] * 0.15;\n  float total = 0.15;\n  for (int i = 0; i < 8; i++) {\n    if (float(i) >= u_colorCount) break;\n    float fi = float(i);\n    vec2 c = vec2(\n      sin(t * (0.21 + fi * 0.071) + fi * 2.4 + u_seed),\n      cos(t * (0.17 + fi * 0.093) + fi * 1.7)) * (0.45 + u_intensity * 0.35);\n    float w = exp(-dot(p - c, p - c) * 6.0);\n    acc += u_colors[i] * w;\n    total += w;\n  }\n  return acc / total;\n}\n\n",
  silk: "vec3 shade(vec2 uv, vec2 p, float t) {\n  vec2 q = p * 1.6;\n  float amp = 0.25 + u_intensity * 0.85;\n  for (float i = 1.0; i < 5.0; i += 1.0) {\n    q.x += amp / i * cos(i * 2.4 * q.y + t * 0.8 + u_seed);\n    q.y += amp / i * cos(i * 1.7 * q.x + t * 0.6);\n  }\n  return palette(0.5 + 0.5 * sin(q.x + q.y));\n}\n\n",
};

export const BG_STYLES = {
  none: { label: "Uni" }, // le fond d'origine de l'app
  // « Mesh drift » : #10002B → #7F00FF → #33AEB9 → #0920F4 ; vitesse 33, zoom 30, intensité 34, warp 0,
  // contraste 40, luminosité 40, saturation 48, teinte 0°, vignette 36, grain 19 ; curseur désactivé.
  mesh: { label: "Mesh drift", shade: "mesh", timeScale: 0.73, colorCount: 4,
    colors: [0.063, 0.000, 0.169, 0.498, 0.000, 1.000, 0.200, 0.682, 0.725, 0.035, 0.125, 0.957],
    shape: [1.10, 0.34, 0.50, 0.00], surface: [2.40, 0.96, -0.10, 0.96], finish: [0.00, 0.36, 0.026, 0.07],
    transform: [1453.0, 0.00, 0.00, 0.0], space: [0, 0, 0, 0], cursor: [0.0, 2.0, 0.65, 0.46] },
  // « Silk » : #02010A → #04052E → #3D2C8D → #916BBF ; vitesse 35, zoom 38, intensité 28, warp 0,
  // contraste 57, luminosité 50, saturation 50, teinte 0°, vignette 0, grain 14 ; curseur désactivé.
  silk: { label: "Silk", shade: "silk", timeScale: 0.76, colorCount: 4,
    colors: [0.008, 0.004, 0.039, 0.016, 0.020, 0.180, 0.239, 0.173, 0.553, 0.569, 0.420, 0.749],
    shape: [1.26, 0.28, 0.50, 0.00], surface: [2.40, 1.11, 0.00, 1.00], finish: [0.00, 0.00, 0.000, 0.05],
    transform: [1581.0, 0.00, 0.00, 0.0], space: [0, 0, 0, 0], cursor: [0.0, 2.0, 0.65, 0.46] },
};
export const DEFAULT_STYLE = "none";
export const DEFAULT_SPEED = 50; // curseur 0–100 : 50 = vitesse d'origine, 0 = figé, 100 = deux fois plus vite

const pref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } };
const savePref = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (_) { /* rien */ } };

export function setupBackground(canvas) {
  let styleKey = BG_STYLES[pref("bg-style", DEFAULT_STYLE)] ? pref("bg-style", DEFAULT_STYLE) : DEFAULT_STYLE;
  let speed = Math.max(0, Math.min(100, Number(pref("bg-speed", DEFAULT_SPEED))));
  if (Number.isNaN(speed)) speed = DEFAULT_SPEED;
  const gl = canvas.getContext("webgl", { antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "low-power" });
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const api = { available: Boolean(gl), get style() { return styleKey; }, get speed() { return speed; }, setStyle() {}, setSpeed() {} };
  const show = (on) => { canvas.classList.toggle("on", on); document.body.classList.toggle("has-bg", on); };
  if (!gl) return api;

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // triangle plein écran
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.warn("Fond animé :", gl.getShaderInfoLog(sh)); return null; }
    return sh;
  };
  const programs = {};
  const programFor = (name) => {
    if (name in programs) return programs[name];
    const vs = compile(gl.VERTEX_SHADER, "attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }");
    const fs = compile(gl.FRAGMENT_SHADER, HEAD + SHADE[name] + TAIL);
    let prog = null;
    if (vs && fs) {
      prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn("Fond animé :", gl.getProgramInfoLog(prog)); prog = null; }
    }
    return (programs[name] = prog);
  };

  let cur = null, uScene = null, simT = 0, last = 0, raf = 0;
  const rate = () => (cur && cur.shade ? cur.timeScale * (speed / DEFAULT_SPEED) : 0);
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2); // plafonné à 2
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  };
  const draw = () => {
    if (!cur || !cur.shade || !uScene) return;
    resize();
    gl.uniform4f(uScene, canvas.width, canvas.height, simT, cur.colorCount);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    show(true);
  };
  const frame = (now) => {
    simT += Math.min((now - last) / 1000, 0.1) * rate(); // temps accumulé : changer la vitesse ne fait pas sauter l'image
    last = now;
    draw();
    raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!raf && !still && rate() > 0 && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  const apply = () => {
    stop();
    cur = BG_STYLES[styleKey];
    if (!cur.shade) { show(false); return; }
    const prog = programFor(cur.shade);
    if (!prog) { show(false); return; }
    gl.useProgram(prog);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const U = (n) => gl.getUniformLocation(prog, n);
    const colors = new Float32Array(24);
    colors.set(cur.colors);
    gl.uniform3fv(U("u_colors[0]") || U("u_colors"), colors);
    gl.uniform4fv(U("u_shape"), cur.shape); gl.uniform4fv(U("u_surface"), cur.surface);
    gl.uniform4fv(U("u_finish"), cur.finish); gl.uniform4fv(U("u_transform"), cur.transform);
    gl.uniform4fv(U("u_space"), cur.space); gl.uniform4fv(U("u_cursor"), cur.cursor);
    uScene = U("u_scene");
    draw();
    start();
  };
  api.setStyle = (k) => { if (!BG_STYLES[k]) return; styleKey = k; savePref("bg-style", k); apply(); };
  api.setSpeed = (v) => { speed = Math.max(0, Math.min(100, Number(v) || 0)); savePref("bg-speed", speed); if (rate() > 0) start(); else stop(); };
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start())); // pause en arrière-plan
  addEventListener("resize", () => { if (!raf) draw(); });
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); stop(); show(false); });
  apply();
  return api;
}
