'use strict';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries([
  'cohort', 'task', 'release', 'family', 'episode', 'coverage', 'baseline',
  'families', 'histograms', 'brightness', 'brightnessPlot', 'examples', 'frames', 'rig',
  'rigInfo', 'aggregate', 'episodeVideo', 'poseLink', 'releaseLabel',
  'comparisonSection', 'comparisonInfo', 'comparison', 'compareTime', 'compareTimeLabel',
].map(id => [id, $(id)]));
const labels = {
  intensity: 'Intensity', ambient: 'Ambient', red: 'Red', green: 'Green', blue: 'Blue',
  height_m: 'Ceiling height (m)', radius_m: 'Bulb radius (m)',
};
const colors = {indoor: '#ffc477', daylight: '#8fcfff', mixed: '#84d3b3'};
const count = value => value.toLocaleString();
const percent = share => (100 * share).toFixed(1) + '%';
const name = value => value.replaceAll('_', ' ');
const numeric = value => Number.isFinite(value);
let data, choices = [], current = [], selected, exampleIds = new Set(), emitterGroups = [];
let yaw = -.7, elevation = .6;
const ctx = ui.rig.getContext('2d');

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function options(select, rows, fallback = '') {
  const previous = select.value;
  select.replaceChildren(...rows.map(([value, label]) => new Option(label, value)));
  select.value = rows.some(([value]) => value === previous) ? previous : fallback;
}

function distinct(rows, field) {
  return [...new Set(rows.map(row => row[field]).filter(Boolean))].sort();
}

function renderSettings(rows, cohortRows, production) {
  ui.families.replaceChildren();
  const known = cohortRows.filter(row => Object.hasOwn(data.families, row.settings.family));
  for (const [family, expected] of Object.entries(data.families)) {
    const n = known.filter(row => row.settings.family === family).length;
    const share = known.length ? n / known.length : 0;
    const bar = el('div', undefined, 'track');
    const fill = el('i');
    fill.style.width = percent(share);
    fill.style.background = colors[family];
    bar.append(fill);
    if (production) {
      const target = el('b');
      target.style.left = percent(expected);
      target.title = percent(expected) + ' configured';
      bar.append(target);
    }
    const item = el('div', undefined, 'family-row');
    const stats = el('span', known.length ? count(n) + ' · ' + percent(share) : '—', 'stats');
    if (production) stats.append(el('br'), el('small', percent(expected) + ' config.'));
    item.append(el('span', family), bar, stats);
    ui.families.append(item);
  }

  ui.histograms.replaceChildren();
  for (const [key, configured] of Object.entries(data.ranges)) {
    const values = rows.map(row => row.settings[key]).filter(numeric);
    const low = Math.min(configured[0], ...values);
    const high = Math.max(configured[1], ...values);
    const panel = histogram(labels[key], values, low, high, 2);
    panel.append(
      el('small', count(values.length) + ' / ' + count(rows.length) + ' recorded'));
    if (production) {
      panel.append(el('br'), el('small', 'Configured ' + configured.join('–')));
    }
    ui.histograms.append(panel);
  }
}

function histogram(label, values, low, high, precision) {
  const bins = Array(12).fill(0);
  for (const value of values) bins[Math.min(11, Math.floor(12 * (value - low) / (high - low)))]++;
  const plot = el('div', undefined, 'plot');
  const max = Math.max(1, ...bins);
  const step = (high - low) / bins.length;
  plot.setAttribute('role', 'img');
  plot.setAttribute('aria-label', label + ' histogram. Bin counts ' + bins.join(', '));
  bins.forEach((total, index) => {
    const bin = el('i');
    bin.style.height = percent(total / max);
    bin.title = (low + index * step).toFixed(precision) + '–' +
      (low + (index + 1) * step).toFixed(precision) + ' · ' + count(total);
    plot.append(bin);
  });
  const scale = el('small', undefined, 'scale');
  scale.append(el('span', low.toFixed(precision)), el('span', high.toFixed(precision)));
  const panel = el('article', undefined, 'histogram');
  panel.append(el('h3', label), plot, scale);
  return panel;
}

function cameraExamples() {
  ui.examples.replaceChildren();
  ui.brightnessPlot.replaceChildren();
  exampleIds = new Set();
  const measured = current.filter(row => numeric(row.brightness))
    .sort((a, b) => a.brightness - b.brightness);
  ui.brightness.textContent = measured.length
    ? count(measured.length) + ' / ' + count(current.length) +
      (data.brightness_sample_hz ? ' previews measured at ' + data.brightness_sample_hz + ' frames per second.'
        : ' episodes measured.') +
      ' Each value is the lowest sampled mean RGB (0–255) in the fixed task-area crop.'
    : 'Task-area brightness measurements are unavailable for this selection.';
  ui.brightnessPlot.hidden = !measured.length;
  if (!measured.length) return;
  const low = Math.floor(measured[0].brightness);
  const high = Math.max(low + 1, Math.ceil(measured.at(-1).brightness));
  ui.brightnessPlot.append(histogram('Lowest task-area RGB mean per episode',
    measured.map(row => row.brightness), low, high, 1));

  const choices = new Map();
  for (const [label, index] of [
    ['Darkest', 0], ['Median', Math.floor(measured.length / 2)], ['Brightest', measured.length - 1],
  ]) {
    const row = measured[index];
    if (choices.has(row)) choices.get(row).push(label);
    else choices.set(row, [label]);
  }
  for (const [row, marks] of choices) {
    exampleIds.add(row.id);
    const button = el('button');
    button.type = 'button';
    if (row.frames?.length) button.append(image(row.frames[0]));
    button.append(el('strong', marks.join(' / ') + ' · ' + row.brightness.toFixed(1)),
      el('br'), el('small', name(row.task) + ' · ' + (row.settings.family ?? 'family unavailable')));
    button.addEventListener('click', () => {
      ui.episode.value = row.id;
      inspect();
    });
    ui.examples.append(button);
  }
}

function image(frame) {
  const img = el('img');
  img.src = frame.src;
  img.alt = frame.label;
  img.loading = 'lazy';
  return img;
}

function sourceChanged() {
  const source = data.cohorts.find(cohort => cohort.label === ui.cohort.value);
  choices = data.episodes.filter(row => source?.label === data.all_cohort || row.cohort === source?.label);
  options(ui.task, [['', 'All tasks'], ...distinct(choices, 'task').map(task => [task, name(task)])]);
  ui.poseLink.hidden = !(data.pose_viewer || data.cohorts.some(cohort => cohort.kind === 'preview'));
  ui.baseline.textContent = source?.kind === 'preview'
    ? 'Designed review examples. Each preview is a rendered setting.'
    : source?.kind === 'public_preview'
      ? 'One vote per published Joint preview. White ticks show the configured sampler mix.'
      : 'One vote per completed episode. White ticks show the configured family mix.';
  taskChanged();
}

function taskChanged() {
  const taskRows = choices.filter(row => !ui.task.value || ui.task.value === row.task);
  const releases = distinct(taskRows, 'release');
  ui.releaseLabel.hidden = !ui.task.value || releases.length < 2;
  options(ui.release, [['', 'All releases'], ...releases.map(release => [release, release.slice(0, 12)])]);
  if (ui.releaseLabel.hidden) ui.release.value = '';
  filter();
}

function filter() {
  const rows = choices.filter(row => (!ui.task.value || row.task === ui.task.value) &&
    (!ui.release.value || row.release === ui.release.value));
  current = rows.filter(row => !ui.family.value || row.settings.family === ui.family.value);
  const kind = data.cohorts.find(cohort => cohort.label === ui.cohort.value)?.kind;
  const n = current.filter(row => row.settings.family).length;
  const total = count(current.length) + (kind?.includes('preview') ? ' previews' : ' episodes');
  ui.coverage.textContent = current.length
    ? count(n) + ' / ' + total + ' with a recorded light family'
    : 'No matching lighting records. Configured settings are shown below.';
  renderSettings(current, rows, kind !== 'preview');
  cameraExamples();
  const example = current.find(row => exampleIds.has(row.id) && row.frames?.length) || current[0];
  options(ui.episode, example ? current.map(row => [
    row.id, name(row.task) + ' · ' + row.id.split(':').at(-1).split('/').slice(-2).join('/'),
  ]) : [['', 'No matches']], example?.id ?? '');
  ui.episode.disabled = !example;
  emitterGroups = groupEmitters(current);
  ui.aggregate.disabled = !emitterGroups.length;
  inspect();
}

function inspect() {
  selected = current.find(row => row.id === ui.episode.value);
  ui.frames.replaceChildren();
  const aggregate = ui.aggregate.getAttribute('aria-pressed') === 'true';
  const n = current.filter(row => row.lights?.length).length;
  ui.rigInfo.textContent = aggregate
    ? count(n) + ' / ' + count(current.length) + ' records with scene lights. Marker size tracks record count.'
    : selected?.lights?.length
      ? selected.lights.length + ' world lights · ' + (selected.settings.family ?? 'family unavailable') +
        (selected.robot ? '' : ' · robot base shown')
      : 'Saved light positions are unavailable for this selection.';
  for (const frame of selected?.frames ?? []) {
    const figure = el('figure');
    figure.append(image(frame), el('figcaption', frame.label));
    ui.frames.append(figure);
  }
  if (selected?.video !== ui.episodeVideo.dataset.source) {
    ui.episodeVideo.pause();
    if (selected?.video) {
      ui.episodeVideo.src = selected.video;
      ui.episodeVideo.dataset.source = selected.video;
    } else {
      ui.episodeVideo.removeAttribute('src');
      delete ui.episodeVideo.dataset.source;
    }
    ui.episodeVideo.load();
  }
  ui.episodeVideo.hidden = !selected?.video;
  drawRig();
}

function groupEmitters(rows) {
  const groups = new Map();
  for (const row of rows) for (const light of row.lights ?? []) {
    const [x, y, z] = light.position;
    const key = [light.name, Math.round(x * 20), Math.round(y * 20)].join('/');
    if (!groups.has(key)) groups.set(key, {...light, low: z, high: z, ids: new Set()});
    const group = groups.get(key);
    group.low = Math.min(group.low, z);
    group.high = Math.max(group.high, z);
    group.ids.add(row.id);
  }
  return [...groups.values()].map(({ids, ...group}) => ({
    ...group, count: ids.size, position: [...group.position.slice(0, 2), (group.low + group.high) / 2],
  }));
}

function drawRig() {
  const {width, height} = ui.rig.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  ui.rig.width = width * ratio;
  ui.rig.height = height * ratio;
  ctx.scale(ratio, ratio);
  const aggregate = ui.aggregate.getAttribute('aria-pressed') === 'true';
  const lights = aggregate ? emitterGroups : selected?.lights ?? [];
  const table = selected?.table;
  const robot = selected?.robot ?? [];
  const corners = table ? [[-1,-1], [1,-1], [1,1], [-1,1]].map(([x, y]) => [
    table[0][0] + x * table[1][0], table[0][1] + y * table[1][1], table[0][2] + table[1][2],
  ]) : [];
  const base = selected?.robot_base;
  const points = [...corners, ...robot.flat(), ...(base ? [base] : []), ...lights.flatMap(light => [
    light.position, ...(aggregate ? [[...light.position.slice(0,2), light.low],
      [...light.position.slice(0,2), light.high]] : []),
  ])];
  if (!points.length) return;
  const raw = ([x, y, z]) => [
    -Math.sin(yaw) * x + Math.cos(yaw) * y,
    Math.sin(elevation) * (Math.cos(yaw) * x + Math.sin(yaw) * y) - Math.cos(elevation) * z,
  ];
  const projections = points.map(raw);
  const bounds = [0, 1].map(i => [
    Math.min(...projections.map(point => point[i])), Math.max(...projections.map(point => point[i])),
  ]);
  const scale = Math.min((width - 112) / Math.max(1, bounds[0][1] - bounds[0][0]),
    (height - 64) / Math.max(1, bounds[1][1] - bounds[1][0]));
  const project = point => raw(point).map((value, i) =>
    (value - (bounds[i][0] + bounds[i][1]) / 2) * scale + [width, height][i] / 2);
  function path(points, color, width = 1, fill) {
    ctx.beginPath();
    points.forEach((point, i) => i ? ctx.lineTo(...point) : ctx.moveTo(...point));
    if (fill) {
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  if (corners.length) path(corners.map(project), '#536d89', 1, '#1b2b3e');
  for (const segment of robot) path(segment.map(project), '#7189a3', 2);
  ctx.font = '12px system-ui';
  if (base) {
    const p = project(base);
    ctx.fillStyle = '#a6bad1';
    ctx.fillRect(p[0] - 4, p[1] - 4, 8, 8);
    ctx.fillText('Robot base', p[0] + 7, p[1] + 4);
  }
  const maxCount = Math.max(1, ...lights.map(light => light.count || 1));
  for (const light of lights) {
    const point = project(light.position);
    const color = light.name.includes('daylight') ? colors.daylight :
      light.name.includes('ceiling') ? colors.indoor : colors.mixed;
    if (aggregate) {
      const [x, y] = light.position;
      path([project([x, y, light.low]), project([x, y, light.high])], color, 2);
    } else {
      const norm = Math.hypot(...light.direction);
      if (norm > 0) {
        const target = project(light.position.map((value, i) => value + .5 * light.direction[i] / norm));
        const aim = Math.atan2(target[1] - point[1], target[0] - point[0]);
        path([point, target], color, 1.5);
        path([-0.5, 0, 0.5].map((delta, i) => i === 1 ? target : [
          target[0] - 7 * Math.cos(aim + delta), target[1] - 7 * Math.sin(aim + delta),
        ]), color, 1.5);
      }
    }
    const radius = aggregate ? 4 + 10 * Math.sqrt(light.count / maxCount) : 6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(...point, radius, 0, Math.PI * 2);
    ctx.fill();
    const label = aggregate ? count(light.count) : name(light.name.replace(/^(dataset|office)_/, ''));
    ctx.fillText(label, point[0] + radius + 4, point[1] - 4);
  }
}

function setupComparison(rows) {
  if (!rows.length) return;
  ui.comparisonSection.hidden = false;
  ui.comparisonInfo.textContent = name(rows[0].task) +
    ' · Same saved motion, camera, room, and surfaces. Starts at ' + rows[0].phase + '.';
  const videos = [];
  function seek() {
    const time = Number(ui.compareTime.value);
    ui.compareTimeLabel.value = time.toFixed(2) + ' s';
    for (const video of videos) {
      if (video.readyState >= 1) {
        video.pause();
        video.currentTime = Math.min(time, video.duration);
      }
    }
  }
  const durations = [];
  const start = rows[0].time;
  ui.compareTime.max = start;
  ui.compareTime.value = start;
  for (const row of rows) {
    const figure = el('figure');
    const video = el('video');
    video.src = row.video;
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.addEventListener('loadedmetadata', () => {
      durations.push(video.duration);
      ui.compareTime.max = Math.min(...durations);
      seek();
    });
    videos.push(video);
    figure.append(video, el('figcaption', [
      row.settings.family, numeric(row.settings.intensity) ? 'intensity ' +
      row.settings.intensity.toFixed(2) : null,
    ].filter(Boolean).join(' · ')));
    ui.comparison.append(figure);
  }
  ui.compareTime.addEventListener('input', seek);
  seek();
}

ui.cohort.addEventListener('change', sourceChanged);
ui.task.addEventListener('change', taskChanged);
ui.release.addEventListener('change', filter);
ui.family.addEventListener('change', filter);
ui.episode.addEventListener('change', inspect);
ui.aggregate.addEventListener('click', () => {
  ui.aggregate.setAttribute('aria-pressed', ui.aggregate.getAttribute('aria-pressed') !== 'true');
  inspect();
});
ui.rig.addEventListener('pointerdown', event => ui.rig.setPointerCapture(event.pointerId));
ui.rig.addEventListener('pointermove', event => {
  if (!ui.rig.hasPointerCapture(event.pointerId)) return;
  yaw += event.movementX * .009;
  elevation = Math.max(-1.4, Math.min(1.4, elevation + event.movementY * .009));
  drawRig();
});
ui.rig.addEventListener('keydown', event => {
  const directions = {ArrowLeft: [-.12,0], ArrowRight: [.12,0], ArrowDown: [0,.12], ArrowUp: [0,-.12]};
  if (!Object.hasOwn(directions, event.key)) return;
  event.preventDefault();
  yaw += directions[event.key][0];
  elevation = Math.max(-1.4, Math.min(1.4, elevation + directions[event.key][1]));
  drawRig();
});
new ResizeObserver(drawRig).observe(ui.rig);

fetch('lighting.json', {cache: 'no-store'})
  .then(response => {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  })
  .then(payload => {
    data = payload;
    const populated = new Set(data.episodes.map(row => row.cohort));
    const source = data.cohorts.find(cohort => cohort.label === data.all_cohort || populated.has(cohort.label))
      ?? data.cohorts[0];
    options(ui.cohort, data.cohorts.length
      ? data.cohorts.map(cohort => [cohort.label, cohort.label]) : [['', 'Configured sampler']],
      source?.label ?? '');
    options(ui.family, [['', 'All families'], ...Object.keys(data.families).map(family => [family, family])]);
    sourceChanged();
    setupComparison(data.comparison);
  })
  .catch(error => {
    ui.coverage.textContent = 'Lighting data could not be loaded (' + error.message + ').';
  });
