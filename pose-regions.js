'use strict';

const PoseRegions = (() => {
  let payload, loadFailed = false, lastStatus = '';
  const controls = {
    camera: {id: 'showCamera', color: '102,179,255', label: 'Camera position'},
    robot: {id: 'showRobot', color: '93,223,175', label: 'Robot-base position'},
  };

  function visible(set, task) {
    if (!payload || !document.getElementById('showRegions').checked) return [];
    const byTask = payload.catalog[set] ?? {};
    const entries = task ? [byTask[task]].filter(Boolean) : Object.values(byTask);
    return Object.entries(controls).map(([role, control]) => {
      const ids = new Set(entries.map(pair => pair[role]));
      return {...control, meshes: [...ids].map(id => payload.meshes[id])};
    }).filter(({id, meshes}) => meshes.length && document.getElementById(id).checked);
  }

  function draw(context, project, set, task) {
    const regions = visible(set, task);
    for (const region of regions) {
      const shape = new Path2D();
      for (const mesh of region.meshes) {
        const points = mesh.vertices.map(project);
        for (const face of mesh.faces) {
          const a = points[face[0]], b = points[face[1]], c = points[face[2]];
          const area = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
          if (Math.abs(area) < 1e-7) continue;
          // Wind all projected faces the same way so self-overlap fills once.
          shape.moveTo(a[0], a[1]);
          if (area > 0) {
            for (let i = 1; i < face.length; i++) shape.lineTo(...points[face[i]]);
          } else {
            for (let i = face.length - 1; i >= 1; i--) shape.lineTo(...points[face[i]]);
          }
          shape.closePath();
        }
      }
      context.fillStyle = 'rgba(' + region.color + ',.24)';
      context.fill(shape);
    }

    const active = document.getElementById('showRegions').checked;
    const signature = [active, set, Boolean(payload), loadFailed, ...regions.map(r => r.id)].join('/');
    if (signature === lastStatus) return;
    lastStatus = signature;
    const status = document.getElementById('regionStatus');
    status.replaceChildren();
    if (!active) return;
    if (regions.length) {
      for (const region of regions) {
        const key = document.createElement('span');
        key.style.color = 'rgb(' + region.color + ')';
        key.textContent = '■ ' + region.label + '   ';
        status.append(key);
      }
      status.append(' · Configured position ranges before clearance and framing checks.');
    } else if (set === 'original') {
      status.textContent = 'Historical data includes sampled poses only.';
    } else if (!payload) {
      status.textContent = loadFailed ? 'Position regions could not be loaded.' : 'Loading position regions…';
    }
  }

  function bounds(set, task) {
    return visible(set, task).flatMap(({meshes}) => meshes.flatMap(({bounds: [lo, hi]}) =>
      [lo[0], hi[0]].flatMap(x => [lo[1], hi[1]].flatMap(y => [lo[2], hi[2]].map(z => [x,y,z])))));
  }

  function load(redraw) {
    fetch('pose-regions.json?v=1')
      .then(response => {
        if (!response.ok) throw new Error('Position regions HTTP ' + response.status);
        return response.json();
      })
      .then(data => { payload = data; })
      .catch(() => { loadFailed = true; })
      .finally(redraw);
  }

  return {load, draw, bounds};
})();
