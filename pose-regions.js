'use strict';

const PoseRegions = (() => {
  let payload, loadFailed = false, lastStatus = '', renderer, fallbackLayer;
  const controls = {
    camera: {id: 'showCamera', color: [102, 179, 255], label: 'Camera position'},
    robot: {id: 'showRobot', color: [93, 223, 175], label: 'Robot-base position'},
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

  function createRenderer(gl) {
    function shader(type, source) {
      const compiled = gl.createShader(type);
      gl.shaderSource(compiled, source);
      gl.compileShader(compiled);
      if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(compiled);
        gl.deleteShader(compiled);
        throw new Error(message);
      }
      return compiled;
    }

    const vertex = shader(gl.VERTEX_SHADER, `
      attribute vec3 position;
      uniform vec3 center, right, up;
      uniform vec2 scale;
      void main() {
        vec3 relative = position - center;
        gl_Position = vec4(vec2(dot(relative, right), dot(relative, up)) * scale, 0., 1.);
      }`);
    const fragment = shader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec4 color;
      void main() { gl_FragColor = color; }`);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(message);
    }

    const attributes = gl.getAttribLocation(program, 'position');
    const uniform = Object.fromEntries(['center', 'right', 'up', 'scale', 'color']
      .map(name => [name, gl.getUniformLocation(program, name)]));
    const buffers = new Map();
    function bufferFor(mesh) {
      if (buffers.has(mesh)) return buffers.get(mesh);
      const triangleCount = mesh.faces.reduce((count, face) => count + face.length - 2, 0);
      const positions = new Float32Array(triangleCount * 9);
      let offset = 0;
      for (const face of mesh.faces) {
        for (let corner = 1; corner + 1 < face.length; corner++) {
          for (const index of [face[0], face[corner], face[corner + 1]]) {
            positions.set(mesh.vertices[index], offset);
            offset += 3;
          }
        }
      }
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      const entry = {buffer, count: triangleCount * 3};
      buffers.set(mesh, entry);
      return entry;
    }

    return function paint(regions, view) {
      gl.useProgram(program);
      gl.uniform3fv(uniform.center, view.center);
      gl.uniform3fv(uniform.right, view.right);
      gl.uniform3fv(uniform.up, view.up);
      gl.uniform2f(uniform.scale, 2 * view.scale / view.width, 2 * view.scale / view.height);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilMask(255);
      gl.stencilFunc(gl.EQUAL, 0, 255);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      gl.enableVertexAttribArray(attributes);

      for (const region of regions) {
        // Blend each region once per pixel, even when its faces overlap.
        gl.clear(gl.STENCIL_BUFFER_BIT);
        const [r, g, b] = region.color;
        gl.uniform4f(uniform.color, r / 255, g / 255, b / 255, .24);
        for (const mesh of region.meshes) {
          const {buffer, count} = bufferFor(mesh);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.vertexAttribPointer(attributes, 3, gl.FLOAT, false, 0, 0);
          gl.drawArrays(gl.TRIANGLES, 0, count);
        }
      }
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
    };
  }

  function rasterTriangle(a, b, c, width, height, pixels, color) {
    if (a[1] > b[1]) [a, b] = [b, a];
    if (b[1] > c[1]) [b, c] = [c, b];
    if (a[1] > b[1]) [a, b] = [b, a];
    if (c[1] === a[1]) return;
    const startY = Math.max(0, Math.ceil(a[1] - .5));
    const stopY = Math.min(height, Math.ceil(c[1] - .5));
    const longSlope = (c[0] - a[0]) / (c[1] - a[1]);
    for (let row = startY; row < stopY; row++) {
      const y = row + .5;
      const x0 = a[0] + (y - a[1]) * longSlope;
      const x1 = y < b[1]
        ? a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
        : b[0] + (y - b[1]) * (c[0] - b[0]) / (c[1] - b[1]);
      const left = Math.max(0, Math.ceil(Math.min(x0, x1) - .5));
      const right = Math.min(width, Math.ceil(Math.max(x0, x1) - .5));
      if (left < right) pixels.fill(color, row * width + left, row * width + right);
    }
  }

  function paintFallback(context, project, view, regions) {
    // Rasterize a small overlay once per role. Canvas paths containing all
    // projected faces can be very expensive to fill on software renderers.
    if (!fallbackLayer) {
      const canvas = document.createElement('canvas');
      fallbackLayer = {canvas, context: canvas.getContext('2d')};
    }
    const {canvas, context: mask} = fallbackLayer;
    const factor = Math.min(1, 320 / Math.max(view.width, view.height));
    const width = Math.max(1, Math.round(view.width * factor));
    const height = Math.max(1, Math.round(view.height * factor));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      fallbackLayer.image = null;
    }
    const image = fallbackLayer.image ??= mask.createImageData(width, height);
    const pixels = new Uint32Array(image.data.buffer);
    for (const region of regions) {
      pixels.fill(0);
      const color = new Uint32Array(Uint8Array.of(...region.color, 61).buffer)[0];
      for (const mesh of region.meshes) {
        const points = mesh.vertices.map(vertex => {
          const [x, y] = project(vertex);
          return [x * width / view.width, y * height / view.height];
        });
        for (const face of mesh.faces) {
          for (let corner = 1; corner + 1 < face.length; corner++) {
            rasterTriangle(points[face[0]], points[face[corner]], points[face[corner + 1]],
              width, height, pixels, color);
          }
        }
      }
      mask.putImageData(image, 0, 0);
      context.drawImage(canvas, 0, 0, view.width, view.height);
    }
  }

  function draw(gl, context, project, view, set, task) {
    const regions = visible(set, task);
    if (regions.length) {
      if (renderer === undefined) {
        try {
          renderer = gl?.getContextAttributes()?.stencil ? createRenderer(gl) : null;
        } catch (error) {
          console.warn('WebGL position shading unavailable', error);
          renderer = null;
        }
      }
      if (renderer) renderer(regions, view);
      else paintFallback(context, project, view, regions);
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
    fetch('pose-regions.json', {cache:'no-store'})
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
