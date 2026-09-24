// Colour helpers for matching the canvas to the page CSS colours.
import { Color, LinearSRGBColorSpace } from 'three';

// Khronos PBR Neutral subtracts an offset driven by the smallest channel from dark
// colours (offset = m - 6.25 m², m = min(r, g, b)), which strips the green and blue out
// of a near-black red such as the page background #0a0202. For a linear target t this
// returns the pre-tone-mapping colour c that maps back to t exactly:
//   m = sqrt(t_min / 6.25),  c = t + (m - t_min)
// Valid while m < 0.08 (dark colours only). For other tone mappers the target is used
// unchanged (close enough in the deep shadows).
export function toneMappedBase(hex, mode = 'neutral', out = new Color()) {
  out.set(hex); // sRGB hex -> linear working space
  if (mode !== 'neutral') return out;
  const tMin = Math.min(out.r, out.g, out.b);
  const m = Math.sqrt(Math.max(tMin, 0) / 6.25);
  if (m >= 0.08) return out;
  const k = m - tMin;
  return out.setRGB(out.r + k, out.g + k, out.b + k, LinearSRGBColorSpace);
}
