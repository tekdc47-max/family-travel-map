// Rounded-rectangle SDF and smooth-step lens adapted from Shu Ding's Liquid Glass.
// https://github.com/shuding/liquid-glass/blob/main/liquid-glass.js
// Copyright (c) 2025 Shu Ding. MIT license in liquid-glass-LICENSE.txt.
const svgNamespace = 'http://www.w3.org/2000/svg';
const displacementScale = 52;

function smoothStep(start, end, value) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function roundedRectSDF(x, y, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x) - halfWidth + radius;
  const qy = Math.abs(y) - halfHeight + radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

function svgElement(name, attributes) {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function rimMap(context, width, height, radius) {
  const image = context.createImageData(width, height);
  const innerX = width / 2 - radius;
  const innerY = height / 2 - radius;
  const rim = Math.min(radius, 14);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x + .5 - width / 2;
      const dy = y + .5 - height / 2;
      const nx = Math.sign(dx) * Math.max(0, Math.abs(dx) - innerX);
      const ny = Math.sign(dy) * Math.max(0, Math.abs(dy) - innerY);
      const distance = Math.hypot(nx, ny);
      const depth = -roundedRectSDF(dx, dy, width / 2, height / 2, radius);
      const bend = smoothStep(0, rim, depth) * (1 - smoothStep(rim * .35, rim * 1.6, depth));
      const shift = distance && depth > 0 ? 24 * bend / distance : 0;
      const pixel = 4 * (y * width + x);
      // Sample toward the interior at the rim to magnify it like a convex lens.
      // The centre stays neutral and is neither blurred nor displaced.
      image.data[pixel] = 127.5 - nx * shift * 255 / displacementScale;
      image.data[pixel + 1] = 127.5 - ny * shift * 255 / displacementScale;
      image.data[pixel + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

export function applyGlassRefraction(controls) {
  if (typeof ResizeObserver === 'undefined' || !CSS.supports('backdrop-filter', 'url("#glass-lens")')) return;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;
  const svg = svgElement('svg', {width:0, height:0, 'aria-hidden':'true', focusable:'false'});
  svg.style.position = 'absolute';
  const definitions = svgElement('defs', {});
  svg.append(definitions);
  document.body.append(svg);

  const filters = new Map();
  const resize = new ResizeObserver(entries => {
    for (const {target} of entries) {
      const width = target.offsetWidth;
      const height = target.offsetHeight;
      if (!width || !height) continue;
      const lens = filters.get(target);
      if (lens.width === width && lens.height === height) continue;
      lens.width = width;
      lens.height = height;
      canvas.width = width;
      canvas.height = height;
      const radius = Math.min(width / 2, height / 2, parseFloat(getComputedStyle(target).borderTopLeftRadius));
      rimMap(context, width, height, radius);
      lens.filter.setAttribute('width', width + 32);
      lens.filter.setAttribute('height', height + 32);
      lens.image.setAttribute('width', width);
      lens.image.setAttribute('height', height);
      lens.image.setAttribute('href', canvas.toDataURL());
      target.style.setProperty('--glass-lens', `blur(.6px) url(#${lens.filter.id})`);
    }
    canvas.width = canvas.height = 0;
  });
  controls.forEach((control, index) => {
    const filter = svgElement('filter', {
      id:`glass-lens-${index}`, x:-16, y:-16, filterUnits:'userSpaceOnUse',
      'color-interpolation-filters':'sRGB'
    });
    const image = svgElement('feImage', {x:0, y:0, result:'rim', preserveAspectRatio:'none'});
    filter.append(image, svgElement('feDisplacementMap', {
      in:'SourceGraphic', in2:'rim', scale:displacementScale, xChannelSelector:'R', yChannelSelector:'G'
    }));
    definitions.append(filter);
    filters.set(control, {filter, image});
    resize.observe(control);
  });
}
