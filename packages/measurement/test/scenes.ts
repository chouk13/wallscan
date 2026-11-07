/** Scènes rendues partagées entre les tests (mémoïsées : le rendu 2048 × 1536 coûte ~0,3 s). */
import type { GrayImage, Quad } from "@wallscan/core";
import { renderScene } from "../bench/raster.js";
import { simpleScene, type GroundTruth, type SimpleSceneOptions } from "../bench/scene.js";
import { workImage } from "../src/image.js";

export interface RenderedScene {
  full: GrayImage;
  work: GrayImage;
  factor: number;
  truth: GroundTruth;
  /** Vérité terrain dans les coordonnées de l'image de travail. */
  wallQuad: Quad;
  refQuad: Quad | null;
}

const cache = new Map<string, RenderedScene>();

export function rendered(opts: SimpleSceneOptions = {}): RenderedScene {
  const key = JSON.stringify(opts);
  const hit = cache.get(key);
  if (hit) return hit;
  const { scene, truth } = simpleScene(opts);
  const full = renderScene(scene).image;
  const { img: work, factor } = workImage(full, 2048);
  const toWork = (q: Quad): Quad => q.map((p) => ({ x: p.x / factor, y: p.y / factor })) as Quad;
  const out: RenderedScene = { full, work, factor, truth, wallQuad: toWork(truth.wallQuadFull), refQuad: truth.reference ? toWork(truth.reference.quadFull) : null };
  cache.set(key, out);
  return out;
}

export const quadErr = (a: Quad, b: Quad): number => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
