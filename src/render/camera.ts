/** 2D camera: center in tile coordinates, zoom in CSS pixels per tile. */
export class Camera {
  cx = 128;
  cy = 80;
  zoom = 4;
  viewW = 800;
  viewH = 600;
  worldW = 256;
  worldH = 160;
  minZoom = 1;
  maxZoom = 48;
  /** Smoothed targets for animated moves. */
  targetCx: number | null = null;
  targetCy: number | null = null;
  targetZoom: number | null = null;

  setWorld(w: number, h: number): void {
    this.worldW = w;
    this.worldH = h;
  }

  fitZoom(): number {
    return Math.min(this.viewW / this.worldW, this.viewH / this.worldH);
  }

  fit(): void {
    this.cx = this.worldW / 2;
    this.cy = this.worldH / 2;
    this.zoom = this.fitZoom() * 0.98;
    this.minZoom = this.fitZoom() * 0.6;
    this.targetCx = this.targetCy = this.targetZoom = null;
  }

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.minZoom = this.fitZoom() * 0.6;
    if (this.zoom < this.minZoom) this.zoom = this.minZoom;
  }

  worldToScreen(x: number, y: number): [number, number] {
    return [(x - this.cx) * this.zoom + this.viewW / 2, (y - this.cy) * this.zoom + this.viewH / 2];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.viewW / 2) / this.zoom + this.cx, (sy - this.viewH / 2) / this.zoom + this.cy];
  }

  zoomAt(factor: number, sx: number, sy: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const [nx, ny] = this.screenToWorld(sx, sy);
    this.cx += wx - nx;
    this.cy += wy - ny;
    this.targetZoom = null;
    this.clamp();
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.cx -= dxScreen / this.zoom;
    this.cy -= dyScreen / this.zoom;
    this.targetCx = this.targetCy = null;
    this.clamp();
  }

  flyTo(x: number, y: number, zoom?: number): void {
    this.targetCx = x;
    this.targetCy = y;
    if (zoom !== undefined) this.targetZoom = Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 6);
    if (this.targetCx !== null && this.targetCy !== null) {
      this.cx += (this.targetCx - this.cx) * k;
      this.cy += (this.targetCy - this.cy) * k;
      if (Math.abs(this.targetCx - this.cx) + Math.abs(this.targetCy - this.cy) < 0.01) this.targetCx = this.targetCy = null;
    }
    if (this.targetZoom !== null) {
      this.zoom += (this.targetZoom - this.zoom) * k;
      if (Math.abs(this.targetZoom - this.zoom) < 0.01) this.targetZoom = null;
    }
    this.clamp();
  }

  clamp(): void {
    const marginX = this.viewW / this.zoom / 2;
    const marginY = this.viewH / this.zoom / 2;
    const pad = 8;
    if (marginX * 2 >= this.worldW + pad * 2) this.cx = this.worldW / 2;
    else this.cx = Math.min(this.worldW + pad - marginX, Math.max(-pad + marginX, this.cx));
    if (marginY * 2 >= this.worldH + pad * 2) this.cy = this.worldH / 2;
    else this.cy = Math.min(this.worldH + pad - marginY, Math.max(-pad + marginY, this.cy));
  }

  /** Visible world rectangle (tiles). */
  bounds(margin = 1): { x0: number; y0: number; x1: number; y1: number } {
    const hw = this.viewW / this.zoom / 2 + margin, hh = this.viewH / this.zoom / 2 + margin;
    return { x0: this.cx - hw, y0: this.cy - hh, x1: this.cx + hw, y1: this.cy + hh };
  }
}
