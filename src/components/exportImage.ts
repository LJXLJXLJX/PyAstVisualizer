import type { Rect } from '@xyflow/react';
import { toPng } from 'html-to-image';

const PADDING = 40;
const MAX_SIDE = 8192;
const MAX_AREA = 40_000_000;

export interface ExportInfo {
  width: number;
  height: number;
  scale: number;
}

/**
 * 把画布中所有已渲染节点和连线导出为 PNG。
 * 按节点包围盒计算尺寸，超出浏览器画布限制时自动缩小。
 */
export async function exportPng(viewport: HTMLElement, bounds: Rect, background: string): Promise<{ dataUrl: string; info: ExportInfo }> {
  const w = bounds.width + PADDING * 2;
  const h = bounds.height + PADDING * 2;
  const scale = Math.min(2, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const tx = (-bounds.x + PADDING) * scale;
  const ty = (-bounds.y + PADDING) * scale;
  const dataUrl = await toPng(viewport, {
    backgroundColor: background,
    width,
    height,
    pixelRatio: 1,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
    },
  });
  return { dataUrl, info: { width, height, scale } };
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
