'use strict';

const $ = id => document.getElementById(id);
const palette = {
  primary: '#78c9ff', secondary: '#df9aff', fill: '#83d8ae', robot: '#c4cfdb',
};
const roleLabels = {primary: 'Primary fixture', secondary: 'Secondary fixture',
  fill: 'Bounce fill · varied strength'};
const canvas = $('scene');
const ctx = canvas.getContext('2d');
let data, selected, yaw = -.8, elevation = .58, drag, hits = [];
let playing = true, time = 0, last = 0, returnTo, resumeGrid;
const tiles = new Map();

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function timeToShow() {
  return Math.min(time, data.duration - 1 / 16);
}

function syncTile(tile) {
  if (!tile.visible) {
    tile.video.pause();
    return;
  }
  if (!tile.video.getAttribute('src')) {
    tile.video.preload = 'auto';
    tile.video.src = tile.clip.video;
  }
  if (tile.video.readyState < 2) return;
  const target = timeToShow();
  if (!tile.video.seeking && Math.abs(tile.video.currentTime - target) > (playing ? .24 : .04)) {
    tile.video.currentTime = target;
  }
  if (!playing) tile.video.pause();
  else if (tile.video.paused && !tile.starting) {
    tile.starting = true;
    tile.video.play().catch(error => {
      if (error.name !== 'NotAllowedError') return;
      playing = false;
      $('play').textContent = 'Play grid';
      $('status').textContent = 'Select Play grid to start the muted previews.';
    }).finally(() => { tile.starting = false; });
  }
}

function updateTime() {
  $('time').value = timeToShow();
  $('timeLabel').value = timeToShow().toFixed(2) + ' s';
  tiles.forEach(syncTile);
}

function tick(now) {
  if (playing && last && [...tiles.values()].some(tile => tile.visible)) {
    time = (time + Math.min(.2, (now - last) / 1000)) % data.duration;
    updateTime();
  }
  last = now;
  requestAnimationFrame(tick);
}

function setPlaying(value) {
  playing = value;
  $('play').textContent = value ? 'Pause grid' : 'Play grid';
  if (value) $('status').textContent = '';
  updateTime();
}

function settingsText(clip) {
  const s = clip.settings;
  const white = s.warmth > .2 ? 'warm white' : s.warmth < -.2 ? 'cool white' : 'neutral white';
  return [
    'Intensity ' + s.intensity.toFixed(2),
    'ambient ' + s.ambient.toFixed(2),
    'bounce fill ' + s.fill.toFixed(2),
    white,
    'secondary ' + Math.round(100 * s.secondary_share) + '%',
    'fixture height ' + clip.lights[0].position[2].toFixed(2) + ' m',
  ].join(' · ');
}

function showClip(clip, button) {
  returnTo = button;
  resumeGrid = playing;
  setPlaying(false);
  $('clipTitle').textContent = clip.label;
  $('clipSettings').textContent = settingsText(clip) + ' · Readability passed on all ' +
    clip.readability.frames + ' frames · seed ' + clip.seed;
  const video = $('clipVideo');
  video.poster = clip.poster;
  video.src = clip.video;
  video.onloadedmetadata = () => { video.currentTime = timeToShow(); };
  $('player').showModal();
  video.play().catch(() => {});
}

function selectClip(clip, goToViewer = false) {
  selected = clip;
  for (const tile of tiles.values()) {
    tile.node.classList.toggle('selected', clip.id === tile.clip.id);
    tile.rig.setAttribute('aria-pressed', clip.id === tile.clip.id);
  }
  $('selected').textContent = clip.label + ' · ' + settingsText(clip);
  $('openSelected').disabled = false;
  draw();
  if (goToViewer) $('distribution').scrollIntoView({block: 'start'});
}

function makeGrid() {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const tile = tiles.get(entry.target.dataset.id);
      tile.visible = entry.isIntersecting;
      syncTile(tile);
    }
  });
  for (const clip of data.clips) {
    const node = element('article', null, 'tile');
    node.dataset.id = clip.id;
    const button = element('button', null, 'expand');
    button.type = 'button';
    button.setAttribute('aria-label', 'Open ' + clip.label);
    const video = element('video');
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = 'none';
    video.poster = clip.poster;
    video.addEventListener('canplay', () => syncTile(tiles.get(clip.id)));
    video.addEventListener('error', () => {
      if (!video.getAttribute('src')) return;
      $('status').textContent = 'A preview video could not load. Its still frame is available.';
      const poster = element('img');
      poster.alt = clip.label;
      poster.src = clip.poster;
      video.replaceWith(poster);
    }, {once: true});
    button.append(video);
    button.addEventListener('click', () => showClip(clip, button));
    const rig = element('button', 'Show lights');
    rig.type = 'button';
    rig.setAttribute('aria-label', 'Show lights for ' + clip.label);
    rig.addEventListener('click', () => selectClip(clip, true));
    const footer = element('div', null, 'tile-footer');
    footer.append(element('strong', clip.label, 'tile-label'), rig);
    node.append(button, footer);
    $('grid').append(node);
    tiles.set(clip.id, {node, rig, video, clip, visible: false});
    observer.observe(node);
  }
}

function draw() {
  if (!data) return;
  const {width, height} = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  hits = [];
  const {target, table, robot, fill} = data.workspace;
  const [bottom, top] = data.ranges.height_m;
  const outer = data.ranges.radius_m;
  const filter = $('fixture').value;
  const draws = data.distribution;
  const ring = (r, z) => Array.from({length: 65}, (_, i) => [
    target[0] + r * Math.cos(i * Math.PI / 32), target[1] + r * Math.sin(i * Math.PI / 32), z,
  ]);
  const corners = [[-1,-1], [1,-1], [1,1], [-1,1]].map(([x, y]) => [
    table[0][0] + x * table[1][0], table[0][1] + y * table[1][1], table[0][2] + table[1][2],
  ]);
  const raw = ([x, y, z]) => [
    -Math.sin(yaw) * x + Math.cos(yaw) * y,
    Math.sin(elevation) * (Math.cos(yaw) * x + Math.sin(yaw) * y) - Math.cos(elevation) * z,
  ];
  const extents = [...corners, ...ring(outer, bottom), ...ring(outer, top), ...robot].map(raw);
  const [lo, hi] = [Math.min, Math.max].map(fn => [0, 1].map(axis => fn(...extents.map(p => p[axis]))));
  const scale = Math.min((width - 54) / (hi[0] - lo[0]), (height - 42) / (hi[1] - lo[1]));
  const project = point => raw(point).map((value, i) =>
    (value - (lo[i] + hi[i]) / 2) * scale + [width, height][i] / 2);
  function line(points, color, width = 1, fillStyle) {
    ctx.beginPath();
    points.map(project).forEach((point, index) => index ? ctx.lineTo(...point) : ctx.moveTo(...point));
    if (fillStyle) {
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  function marker(position, role, radius, opacity = 1, outline) {
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.arc(...project(position), radius, 0, 2 * Math.PI);
    ctx.fillStyle = palette[role];
    ctx.fill();
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.7;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  line(corners, '#536d89', 1, '#1b2b3e');
  line(robot, palette.robot, 3);
  ctx.setLineDash([4, 4]);
  const lower = ring(outer, bottom), upper = ring(outer, top);
  line(lower, '#577a95');
  line(upper, '#577a95');
  for (const index of [0, 16, 32, 48]) {
    line([lower[index], upper[index]], '#42627b');
  }
  ctx.setLineDash([]);
  for (const sample of draws) {
    for (const light of sample.points) {
      if (!filter || light.role === filter) marker(light.position, light.role, 2, .34);
    }
  }
  marker(fill, 'fill', 4);
  for (const clip of data.clips) {
    const active = selected?.id === clip.id;
    for (const light of clip.lights) {
      if (filter && light.role !== filter) continue;
      if (active) line([light.position, target], palette[light.role], light.share > .5 ? 2 : 1);
      marker(light.position, light.role, active ? 7 : 4, 1, active ? '#fff4c8' : '#16212f');
      hits.push({clip, point: project(light.position)});
    }
  }
  $('distributionSummary').textContent = draws.length + ' sampler draws before readability screening · heights ' +
    bottom.toFixed(2) + '–' + top.toFixed(2) + ' m · disk radius ' + outer.toFixed(2) + ' m. ' +
    'Outlined markers link to passing renders. Drag or use arrow keys to orbit.';
}

function angle(nextYaw, nextElevation) {
  yaw = nextYaw;
  elevation = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, nextElevation));
  draw();
}

$('play').addEventListener('click', () => setPlaying(!playing));
$('restart').addEventListener('click', () => { time = 0; updateTime(); });
$('time').addEventListener('input', () => {
  time = Number($('time').value);
  setPlaying(false);
});
$('tileSize').addEventListener('change', () => $('grid').style.setProperty('--columns', $('tileSize').value));
$('fixture').addEventListener('change', draw);
$('orbit').addEventListener('click', () => angle(-.8, .58));
$('top').addEventListener('click', () => angle(-.8, Math.PI / 2));
$('openSelected').addEventListener('click', () => showClip(selected, $('openSelected')));
$('player').addEventListener('close', () => {
  $('clipVideo').pause();
  $('clipVideo').removeAttribute('src');
  $('clipVideo').load();
  setPlaying(resumeGrid);
  returnTo.focus({preventScroll: true});
});
canvas.addEventListener('pointerdown', event => {
  canvas.setPointerCapture(event.pointerId);
  drag = {x: event.clientX, y: event.clientY, distance: 0};
});
canvas.addEventListener('pointermove', event => {
  if (!drag || !canvas.hasPointerCapture(event.pointerId)) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  drag = {x: event.clientX, y: event.clientY, distance: drag.distance + Math.hypot(dx, dy)};
  if (drag.distance > 4) angle(yaw + dx * .01, elevation + dy * .01);
});
canvas.addEventListener('pointerup', event => {
  if (drag?.distance < 5) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const sorted = hits.map(hit => ({...hit, distance: Math.hypot(x - hit.point[0], y - hit.point[1])}))
      .sort((a, b) => a.distance - b.distance);
    if (sorted[0]?.distance < 11) selectClip(sorted[0].clip);
  }
  drag = null;
});
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('keydown', event => {
  const steps = {ArrowLeft: [-.14, 0], ArrowRight: [.14, 0], ArrowUp: [0, -.14], ArrowDown: [0, .14]};
  if (!Object.hasOwn(steps, event.key)) return;
  event.preventDefault();
  angle(yaw + steps[event.key][0], elevation + steps[event.key][1]);
});
new ResizeObserver(draw).observe(canvas);

const leap = new URLSearchParams(location.search).get('environment') === 'leap';
if (leap) {
  document.querySelector('h1').textContent = 'LEAP Hand lighting coverage';
  document.title = 'LEAP Hand lighting coverage · Robot task dataset';
  $('poseLink').href = 'viewer.html?poses=leap';
  $('otherLighting').href = 'lighting.html';
  $('otherLighting').textContent = 'YAM lighting';
}
fetch(leap ? 'lighting-leap.json' : 'lighting-office.json', {cache: 'no-store'})
  .then(response => {
    if (!response.ok) throw new Error('Lighting coverage could not load.');
    return response.json();
  })
  .then(payload => {
    data = payload;
    time = data.time;
    $('time').max = data.duration - 1 / 16;
    $('summary').textContent = (data.demo || 'Round Insert') + ' · ' + data.clips.length + ' varied renders selected from ' +
      data.passing_count + ' readable draws out of ' + data.candidate_count +
      '. Same rollout, camera, room, and materials.';
    for (const [role, label] of Object.entries(roleLabels)) {
      const node = element('span');
      const dot = element('i');
      dot.style.background = palette[role];
      node.append(dot, label);
      $('legend').append(node);
    }
    makeGrid();
    selectClip(data.clips[0]);
    $('status').textContent = '';
    updateTime();
    requestAnimationFrame(tick);
  })
  .catch(error => { $('status').textContent = error.message; });
