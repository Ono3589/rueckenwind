// Kleine Kartenvorschau: OpenStreetMap-Kacheln als Hintergrund, die Route als Linie darüber.
// Alles ist ein einziges SVG, damit es sich ohne Kartenbibliothek an jede Breite anpasst.

const TILE = 256;
const MAX_ZOOM = 17;

function project(lat, lon, z) {
  const n = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

// Douglas-Peucker: Linie ausdünnen, damit sie klein im localStorage bleibt
export function simplify(points, tol = 0.00004, maxPoints = 160) {
  if (points.length < 3) return points;
  const sqDist = (p, a, b) => {
    let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
    if (dx || dy) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p[0] - x; dy = p[1] - y;
    return dx * dx + dy * dy;
  };
  const run = (t) => {
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [first, last] = stack.pop();
      let max = 0, idx = -1;
      for (let i = first + 1; i < last; i++) {
        const d = sqDist(points[i], points[first], points[last]);
        if (d > max) { max = d; idx = i; }
      }
      if (max > t * t && idx > -1) { keep[idx] = 1; stack.push([first, idx], [idx, last]); }
    }
    return points.filter((_, i) => keep[i]);
  };
  let out = run(tol);
  for (let k = 0; out.length > maxPoints && k < 6; k++) out = run((tol *= 1.8));
  return out;
}

// path: [[lat, lon], …]; fit = ausgewählter Zoom, damit die ganze Route mit Rand ins Bild passt
export function mapThumb(path, { width = 480, height = 200, pad = 34 } = {}) {
  if (!path || path.length < 2) return '';
  const lats = path.map((p) => p[0]);
  const lons = path.map((p) => p[1]);
  const box = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  let z = MAX_ZOOM;
  for (; z > 2; z--) {
    const [x1, y1] = project(box[1], box[2], z);
    const [x2, y2] = project(box[0], box[3], z);
    if (x2 - x1 <= width - 2 * pad && y2 - y1 <= height - 2 * pad) break;
  }
  const [ax, ay] = project(box[1], box[2], z);
  const [bx, by] = project(box[0], box[3], z);
  const left = (ax + bx) / 2 - width / 2;
  const top = (ay + by) / 2 - height / 2;
  const n = 2 ** z;

  const tiles = [];
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      tiles.push(`<image href="https://tile.openstreetmap.org/${z}/${wx}/${ty}.png" x="${(tx * TILE - left).toFixed(1)}" y="${(ty * TILE - top).toFixed(1)}" width="${TILE}" height="${TILE}"/>`);
    }
  }

  const pts = path.map(([lat, lon]) => {
    const [x, y] = project(lat, lon, z);
    return [x - left, y - top];
  });
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];
  const vb = `0 0 ${width} ${height}`;
  return `
  <svg class="map-tiles" viewBox="${vb}" aria-hidden="true" focusable="false"><rect width="${width}" height="${height}" fill="#e6e2da"/>${tiles.join('')}</svg>
  <svg class="map-route" viewBox="${vb}" aria-hidden="true" focusable="false">
    <path class="casing" d="${d}"/>
    <path class="line" d="${d}"/>
    <circle class="start" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="7"/>
    <circle class="end" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="7"/>
  </svg>`;
}
