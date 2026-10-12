// Keyboard / mouse / touch → one input state. Touch writes the same codes the keyboard does.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressedSet = new Set();
    this.releasedSet = new Set();
    this.dx = 0; this.dy = 0;
    this.axisX = 0; this.axisY = 0; // analog stick (touch)
    this.locked = false;
    this.touch = false;
    this.sensitivity = 0.0022;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
      this.press(e.code);
    });
    addEventListener('keyup', (e) => this.release(e.code));
    addEventListener('mousedown', (e) => { if (this.locked) this.press('Mouse' + e.button); });
    addEventListener('mouseup', (e) => this.release('Mouse' + e.button));
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    addEventListener('blur', () => { for (const c of [...this.down]) this.release(c); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) for (const c of [...this.down]) if (c.startsWith('Mouse')) this.release(c);
      this.onLockChange && this.onLockChange(this.locked);
    });
  }

  press(code) {
    if (this.suspended) return; // typing in chat
    if (!this.down.has(code)) { this.down.add(code); this.pressedSet.add(code); }
  }
  release(code) { if (this.down.has(code)) { this.down.delete(code); this.releasedSet.add(code); } }
  held(code) { return this.down.has(code); }
  pressed(code) { return this.pressedSet.has(code); }
  released(code) { return this.releasedSet.has(code); }
  endFrame() { this.pressedSet.clear(); this.releasedSet.clear(); this.dx = 0; this.dy = 0; }

  lock() {
    if (this.touch) { this.locked = true; this.onLockChange && this.onLockChange(true); return; }
    const p = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }
  unlock() {
    if (this.touch) { this.locked = false; return; }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  moveX() { return this.axisX + (this.held('KeyD') ? 1 : 0) - (this.held('KeyA') ? 1 : 0); }
  moveY() { return this.axisY + (this.held('KeyW') ? 1 : 0) - (this.held('KeyS') ? 1 : 0); }

  // On-screen controls for phones/tablets.
  setupTouch(root) {
    this.touch = true;
    root.classList.add('on');
    const stick = root.querySelector('#stick'), knob = root.querySelector('#knob');
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    const R = 50;
    root.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        const btn = t.target.closest('[data-code]');
        if (btn) { this.press(btn.dataset.code); btn.classList.add('act'); btn._tid = t.identifier; continue; }
        if (t.clientX < innerWidth * 0.4 && stickId === null) {
          stickId = t.identifier; sx = t.clientX; sy = t.clientY;
          stick.style.left = sx - 60 + 'px'; stick.style.top = sy - 60 + 'px'; stick.classList.add('show');
        } else if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
      }
      e.preventDefault();
    }, { passive: false });
    root.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - sx, dy = t.clientY - sy;
          const l = Math.hypot(dx, dy);
          if (l > R) { dx *= R / l; dy *= R / l; }
          knob.style.transform = `translate(${dx}px,${dy}px)`;
          this.axisX = dx / R; this.axisY = -dy / R;
        } else if (t.identifier === lookId) {
          this.dx += (t.clientX - lx) * 2.2; this.dy += (t.clientY - ly) * 2.2;
          lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this.axisX = this.axisY = 0; knob.style.transform = ''; stick.classList.remove('show'); }
        if (t.identifier === lookId) lookId = null;
        root.querySelectorAll('[data-code]').forEach((b) => {
          if (b._tid === t.identifier) { this.release(b.dataset.code); b.classList.remove('act'); b._tid = null; }
        });
      }
    };
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', end);
  }
}
