import { hexColor } from './theme';

type Point = [number, number, number];
type Surface = { vertices: Point[]; color: string; metal: boolean };
const tau = 2 * Math.PI;

function circlePoint(radius: number, angle: number, z: number): Point {
  return [radius * Math.cos(angle), radius * Math.sin(angle), z];
}

// Join two profiles to form the walls and bevels of a hollow machined part.
function band(inner: number, outer: number, innerZ: number, outerZ: number,
  count: number, color: string, start = -Math.PI / 2, sweep = tau, metal = true) {
  const faces: Surface[] = [];
  for (let i = 0; i < count; i++) {
    const a = start + sweep * i / count;
    const b = start + sweep * (i + 1) / count;
    faces.push({ color, metal, vertices: [
      circlePoint(outer, a, outerZ), circlePoint(outer, b, outerZ),
      circlePoint(inner, b, innerZ), circlePoint(inner, a, innerZ),
    ] });
  }
  return faces;
}

const chassis = [
  ...band(0.92, 1, -0.43, -0.32, 6, '#365164'),
  ...band(1, 1, -0.32, 0.16, 6, '#526e80'),
  ...band(0.95, 1, 0.24, 0.16, 6, '#a3b9c8'),
  ...band(0.87, 0.95, 0.24, 0.24, 6, '#405a6d'),
  ...band(0.86, 0.87, 0.235, 0.24, 6, '#8de5ef', undefined, tau, false),
  ...band(0.8, 0.86, -0.15, 0.235, 6, '#284553'),
  ...band(0, 0.81, -0.16, -0.16, 6, '#102735'),
  ...band(0.22, 0.34, -0.05, -0.11, 6, '#9fbccc'),
  ...band(0, 0.22, -0.049, -0.049, 6, '#c5fff7', undefined, tau, false),
];
function coil(radius: number, segments: number, z: number, color: string) {
  const faces: Surface[] = [];
  for (let i = 0; i < segments; i++) {
    const a = i * tau / segments;
    const span = 0.82 * tau / segments;
    faces.push(...band(radius, radius, z - 0.08, z, 4, '#285070', a, span),
      ...band(radius - 0.075, radius, z, z, 4, color, a, span, false),
      ...band(radius - 0.075, radius - 0.075, z, z - 0.08, 4, '#335168', a, span));
  }
  return faces;
}
const outerCoil = coil(0.69, 8, 0.065, '#5baff1');
const innerCoil = coil(0.49, 6, -0.008, '#83dfed');

export function drawReactor(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, t: number) {
  if (radius <= 0) return;
  function camera([px, py, pz]: Point, c: number, s: number): Point {
    return [c * px - s * py, s * px + c * py, pz];
  }
  const polygons: { points: Point[]; depth: number; fill: string }[] = [];
  function submit(mesh: Surface[], angle: number) {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const face of mesh) {
      const points = face.vertices.map(p => camera(p, c, s));
      const [a, b, d] = points;
      const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
      const vx = d[0]-a[0], vy = d[1]-a[1], vz = d[2]-a[2];
      const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      const diffuse = Math.max(0, (-0.48*nx - 0.58*ny + 0.66*nz) / (Math.hypot(nx,ny,nz) || 1));
      const light = 0.32 + 0.78 * diffuse + 0.36 * diffuse ** 8;
      const base = parseInt(face.color.slice(1), 16);
      const fill = face.metal ? 'rgb(' + [16,8,0].map(n => Math.round(((base >> n) & 255)*light)).join(',') + ')' : face.color;
      polygons.push({ points, fill, depth: points.reduce((sum,p) => sum+p[2],0)/points.length });
    }
  }
  submit(chassis,0);
  submit(outerCoil,t*0.00032);
  submit(innerCoil,-t*0.00051);
  polygons.sort((a,b) => a.depth-b.depth);
  ctx.save();
  ctx.translate(x,y);
  ctx.scale(radius,radius);
  ctx.shadowBlur = 0;
  for (const poly of polygons) {
    ctx.beginPath();
    poly.points.forEach(([px,py,pz],i) => {
      const k = 4/(4-pz);
      if (i) ctx.lineTo(px*k,py*k);
      else ctx.moveTo(px*k,py*k);
    });
    ctx.closePath();
    ctx.fillStyle = poly.fill;
    ctx.fill();
  }
  // Two short travelling reflections trace opposite edges of the fixed bezel.
  const rgb = hexColor.rgb;
  const phase = (t / 4200) % 1;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const [px, py] = circlePoint(0.99, i * tau / 6 - Math.PI / 2, 0);
    if (i) ctx.lineTo(px,py);
    else ctx.moveTo(px,py);
  }
  ctx.closePath();
  ctx.setLineDash([0.42, 2.55]);
  ctx.lineDashOffset = -phase * 5.94;
  ctx.strokeStyle = 'rgb(' + rgb + ')';
  ctx.lineWidth = 0.018;
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = Math.min(10, radius * 0.07);
  ctx.stroke();
  ctx.restore();

  const pulse = (t / 2100) % 1;
  ctx.beginPath();
  ctx.arc(0, 0, 0.25 + pulse * 0.39, 0, tau);
  ctx.strokeStyle = 'rgba(' + rgb + ',' + (Math.sin(pulse * Math.PI) * 0.36) + ')';
  ctx.lineWidth = 0.012;
  ctx.stroke();
  const halo = ctx.createRadialGradient(0,0,0,0,0,0.36 + 0.025*Math.sin(t/650));
  halo.addColorStop(0,'rgba('+hexColor.rgb+',0.5)');
  halo.addColorStop(1,'rgba('+hexColor.rgb+',0)');
  ctx.fillStyle = halo;
  ctx.fillRect(-0.4,-0.4,0.8,0.8);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 0.14px Consolas, monospace';
  ctx.fillStyle = '#103647';
  ctx.fillText('HEX',0,0);
  ctx.restore();
}
