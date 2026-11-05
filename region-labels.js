// Geometry is measured in the same projected space Leaflet uses to draw the map.
function area(ring) {
  const [ox, oy] = ring[0];
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ox) * (ring[i][1] - oy) - (ring[i][0] - ox) * (ring[j][1] - oy);
  }
  return Math.abs(sum / 2);
}

export function labelShape(geometry, project) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] :
    geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  let rings, mainArea = 0;
  for (const polygon of polygons) {
    if (polygon[0]?.length < 3 || !polygon[0]) continue;
    const projected = polygon.filter(ring => ring.length >= 3).map(ring => ring.map(project));
    const size = area(projected[0]) - projected.slice(1).reduce((sum, ring) => sum + area(ring), 0);
    if (size > mainArea) { rings = projected; mainArea = size; }
  }
  if (!rings) return null;

  const edges = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[j], [u, v] = ring[i];
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    if (x !== u || y !== v) edges.push([x, y, u - x, v - y]);
  }
  const width = maxX - minX, height = maxY - minY;
  let anchor, clearance = 0;
  const middle = [(minX + maxX) / 2, (minY + maxY) / 2];
  let score = -Infinity;
  function scan(y) {
    if (y <= minY || y >= maxY) return;
    const cuts = [];
    for (const [x, a, dx, dy] of edges) {
      if ((a > y) !== (a + dy > y)) cuts.push(x + dx * (y - a) / dy);
    }
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i += 2) {
      const left = cuts[i - 1], right = cuts[i];
      // Even/odd pairing excludes holes; favor a roomy point, with a mild central bias.
      for (const fraction of [0.25, 0.5, 0.75]) {
        const x = left + (right - left) * fraction;
        const bias = Math.hypot((x - middle[0]) / width, (y - middle[1]) / height) * Math.min(width, height) * 0.05;
        let squared = Math.min(x - left, right - x) ** 2;
        if (squared === 0 || Math.sqrt(squared) - bias <= score) continue;
        for (const [a, b, dx, dy] of edges) {
          const t = Math.max(0, Math.min(1, ((x - a) * dx + (y - b) * dy) / (dx * dx + dy * dy)));
          squared = Math.min(squared, (x - a - t * dx) ** 2 + (y - b - t * dy) ** 2);
          if (score + bias > 0 && squared <= (score + bias) ** 2) break;
        }
        const room = Math.sqrt(squared);
        if (room > 0 && room - bias > score) { anchor = [x, y]; clearance = room; score = room - bias; }
      }
    }
  }
  // ponytail: a bounded search rather than a global pole-of-inaccessibility optimizer.
  for (let i = 0; i < 25; i++) scan(minY + height * (i + 0.5) / 25);
  if (!anchor) return null;
  for (let step = height / 50, pass = 0; pass < 3; pass++, step /= 2) {
    const y = anchor[1];
    for (const offset of [-2, -1, 1, 2]) scan(y + offset * step);
  }
  return {anchor, clearance, edges, width, height, area: mainArea};
}

export function labelFits(shape, halfWidth, halfHeight) {
  if (halfWidth * 2 > shape.width || halfHeight * 2 > shape.height) return false;
  if (Math.hypot(halfWidth, halfHeight) < shape.clearance) return true;
  const [x, y] = shape.anchor;
  // The anchor is already inside. Reject any outline/hole edge touching the text box.
  for (const [a, b, dx, dy] of shape.edges) {
    const u = a - x, v = b - y;
    if ((u < -halfWidth && u + dx < -halfWidth) || (u > halfWidth && u + dx > halfWidth) ||
        (v < -halfHeight && v + dy < -halfHeight) || (v > halfHeight && v + dy > halfHeight)) continue;
    const tx1 = dx ? (-halfWidth - u) / dx : -Infinity;
    const tx2 = dx ? (halfWidth - u) / dx : Infinity;
    const ty1 = dy ? (-halfHeight - v) / dy : -Infinity;
    const ty2 = dy ? (halfHeight - v) / dy : Infinity;
    if (Math.max(0, Math.min(tx1, tx2), Math.min(ty1, ty2)) <=
        Math.min(1, Math.max(tx1, tx2), Math.max(ty1, ty2))) return false;
  }
  return true;
}
