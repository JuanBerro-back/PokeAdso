/**
 * modules/battle3d.js — Arena 3D para los combates de PokePoke.
 *
 * La interfaz GBA (placas, menús, sprites GIF) se conserva; este módulo aporta
 * el escenario 3D que hay detrás: estadio, plataformas, focos, público,
 * partículas y sacudida de cámara al atacar. Es puramente decorativo y no
 * participa en el cálculo del combate.
 */
(function (global) {
  'use strict';

  const THREE = global.THREE;
  if (!THREE) {
    console.warn('[Battle3D] three.js no está cargado; se usará el escenario 2D.');
    return;
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function bannerTexture(title, subtitle, accent) {
    const canvas = makeCanvas(768, 256);
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 768, 256);
    gradient.addColorStop(0, '#102d35');
    gradient.addColorStop(1, '#173f47');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 768, 256);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 12;
    ctx.strokeRect(10, 10, 748, 236);
    ctx.fillStyle = '#fff4d6';
    ctx.textAlign = 'center';
    ctx.font = '800 64px Inter, Segoe UI, system-ui, sans-serif';
    ctx.fillText(title, 384, 122);
    ctx.fillStyle = '#8fd8b6';
    ctx.font = '600 30px Inter, Segoe UI, system-ui, sans-serif';
    ctx.fillText(subtitle, 384, 180);
    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    texture.needsUpdate = true;
    return texture;
  }

  class BattleArena3D {
    constructor(container, options = {}) {
      this.container = typeof container === 'string' ? document.getElementById(container) : container;
      if (!this.container) throw new Error('Battle3D: contenedor no encontrado');
      this.arena = this.container.closest ? this.container.closest('.battle-arena-scene') : null;
      if (this.arena) this.arena.classList.add('battle3d-arena');
      this.options = options;
      this.disposed = false;
      this.elapsed = 0;
      this.clock = new THREE.Clock();
      this.shake = 0;
      this.bursts = [];
      this.playerPlatform = new THREE.Vector3(5.2, 0.3, 3.5);
      this.opponentPlatform = new THREE.Vector3(-4.4, 0.3, -4.8);

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'battle3d-canvas';
      this.canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block; pointer-events:none;';
      this.container.appendChild(this.canvas);

      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 1.4));
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 0.92;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0b2027);
      this.scene.fog = new THREE.Fog(0x0b2027, 18, 42);
      this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);

      this.build();
      this.resize();
      this.bind();
      this.loop();
    }

    build() {
      const scene = this.scene;

      // Luces
      scene.add(new THREE.HemisphereLight(0xffe6b8, 0x0c2226, 0.95));
      const key = new THREE.DirectionalLight(0xffe1a8, 1.25);
      key.position.set(-8, 15, 10);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -16;
      key.shadow.camera.right = 16;
      key.shadow.camera.top = 16;
      key.shadow.camera.bottom = -16;
      key.shadow.bias = -0.0007;
      scene.add(key);

      const spotA = new THREE.SpotLight(0x9fe8d2, 1.25, 40, Math.PI / 6, 0.45, 1.5);
      spotA.position.set(-9, 13, 6);
      spotA.target.position.set(-4.4, 0, -4.8);
      scene.add(spotA, spotA.target);
      const spotB = new THREE.SpotLight(0xffc977, 1.25, 40, Math.PI / 6, 0.45, 1.5);
      spotB.position.set(9, 13, 8);
      spotB.target.position.set(5.2, 0, 3.5);
      scene.add(spotB, spotB.target);

      // Suelo del estadio
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(19, 64),
        new THREE.MeshStandardMaterial({ color: 0x082628, roughness: 0.88, metalness: 0.05 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);

      const inner = new THREE.Mesh(
        new THREE.CircleGeometry(12.5, 64),
        new THREE.MeshStandardMaterial({ color: 0x0e383a, roughness: 0.78, metalness: 0.08 }),
      );
      inner.rotation.x = -Math.PI / 2;
      inner.position.y = 0.01;
      inner.receiveShadow = true;
      scene.add(inner);

      for (let i = 0; i < 5; i++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(13.4 + i * 1.4, 0.05, 4, 72),
          new THREE.MeshBasicMaterial({ color: i % 2 ? 0xe9b85e : 0x8fd8b6, transparent: true, opacity: 0.28 }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.03;
        scene.add(ring);
      }

      // Plataformas
      this.playerDisc = this.makePlatform(this.playerPlatform, 0x1e6b64, 0x8fd8b6);
      this.opponentDisc = this.makePlatform(this.opponentPlatform, 0x66322a, 0xe9b85e);

      // Gradas
      const standMaterial = new THREE.MeshStandardMaterial({ color: 0x163b40, roughness: 0.9 });
      const standMaterial2 = new THREE.MeshStandardMaterial({ color: 0x1d4d50, roughness: 0.88 });
      for (let i = 0; i < 4; i++) {
        const radius = 16 + i * 2.2;
        const height = 0.55 + i * 0.55;
        const step = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius + 0.8, height, 64, 1, true), i % 2 ? standMaterial : standMaterial2);
        step.position.y = height / 2;
        step.receiveShadow = true;
        scene.add(step);
      }

      // Público low-poly
      const crowdGeometry = new THREE.SphereGeometry(0.16, 5, 4);
      const crowdMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
      const crowd = new THREE.InstancedMesh(crowdGeometry, crowdMaterial, 260);
      const dummy = new THREE.Object3D();
      const colors = [0xe9b85e, 0x8fd8b6, 0xd96352, 0x5da7e8, 0xa879d8, 0xffefd0];
      for (let i = 0; i < 260; i++) {
        const angle = (i / 260) * Math.PI * 2 + (i % 7) * 0.01;
        const radius = 17.5 + (i % 6) * 0.9;
        dummy.position.set(Math.cos(angle) * radius, 2.2 + (i % 5) * 0.55, Math.sin(angle) * radius);
        dummy.scale.setScalar(0.9 + (i % 4) * 0.15);
        dummy.updateMatrix();
        crowd.setMatrixAt(i, dummy.matrix);
        crowd.setColorAt(i, new THREE.Color(colors[i % colors.length]));
      }
      if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
      scene.add(crowd);
      this.crowd = crowd;

      // Torres de iluminación
      for (const [x, z] of [[-15, -10], [15, -10], [-15, 11], [15, 11]]) {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.32, 11, 8),
          new THREE.MeshStandardMaterial({ color: 0x0d2a2e, roughness: 0.7, metalness: 0.2 }),
        );
        pole.position.set(x, 5.5, z);
        pole.castShadow = true;
        scene.add(pole);
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.58, 12, 8),
          new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd27a, emissiveIntensity: 1.8, roughness: 0.2 }),
        );
        lamp.position.set(x, 11.2, z);
        scene.add(lamp);
        const glow = new THREE.PointLight(0xffd27a, 0.8, 16, 2);
        glow.position.set(x, 11.2, z);
        scene.add(glow);
      }

      // Banderas / pantallas
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 3.3),
        new THREE.MeshBasicMaterial({ map: bannerTexture('POKEPOKE', 'COLISEO DE ENTRENADORES', '#e9b85e'), transparent: true }),
      );
      banner.position.set(0, 6.5, -15.5);
      scene.add(banner);

      const bannerLeft = new THREE.Mesh(
        new THREE.PlaneGeometry(6.5, 2.2),
        new THREE.MeshBasicMaterial({ map: bannerTexture('HOENN', 'LIGA POKÉMON', '#8fd8b6'), transparent: true }),
      );
      bannerLeft.position.set(-12, 4.8, 8.5);
      bannerLeft.rotation.y = 0.6;
      scene.add(bannerLeft);

      // Partículas ambientales
      const dustPositions = new Float32Array(120 * 3);
      for (let i = 0; i < 120; i++) {
        dustPositions[i * 3] = (Math.random() - 0.5) * 28;
        dustPositions[i * 3 + 1] = 0.5 + Math.random() * 9;
        dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 28;
      }
      const dustGeometry = new THREE.BufferGeometry();
      dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
      this.dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({
        color: 0xffe6a8,
        size: 0.07,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }));
      scene.add(this.dust);
    }

    makePlatform(position, color, accent) {
      const group = new THREE.Group();
      group.position.copy(position);
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(3.35, 3.8, 0.5, 40),
        new THREE.MeshStandardMaterial({ color: 0x1a3a3b, roughness: 0.85 }),
      );
      base.position.y = -0.12;
      base.castShadow = true;
      base.receiveShadow = true;
      group.add(base);
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(3.2, 3.25, 0.14, 40),
        new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 }),
      );
      top.position.y = 0.16;
      top.receiveShadow = true;
      group.add(top);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(3.32, 0.09, 6, 48),
        new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.3 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.2;
      group.add(ring);
      this.scene.add(group);
      return group;
    }

    bind() {
      this.onResize = () => this.resize();
      global.addEventListener('resize', this.onResize);
    }

    resize() {
      const rect = this.container.getBoundingClientRect();
      const width = Math.max(320, rect.width || 800);
      const height = Math.max(180, rect.height || 300);
      this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 1.4));
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }

    playAttack(side = 'opponent') {
      const target = side === 'player' ? this.playerPlatform : this.opponentPlatform;
      const color = side === 'player' ? 0xffd27a : 0x8fe8d8;
      const geometry = new THREE.BufferGeometry();
      const count = 46;
      const positions = new Float32Array(count * 3);
      const velocities = [];
      for (let i = 0; i < count; i++) {
        positions[i * 3] = target.x + (Math.random() - 0.5) * 0.8;
        positions[i * 3 + 1] = target.y + 1.2 + Math.random() * 1.4;
        positions[i * 3 + 2] = target.z + (Math.random() - 0.5) * 0.8;
        const angle = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 7;
        velocities.push(new THREE.Vector3(Math.cos(angle) * speed, 3 + Math.random() * 6, Math.sin(angle) * speed));
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({ color, size: 0.2, transparent: true, opacity: 0.95, depthWrite: false });
      const points = new THREE.Points(geometry, material);
      this.scene.add(points);
      this.bursts.push({ points, velocities, life: 0, max: 0.85 });
      this.shake = 0.55;
      if (this.playerDisc) this.playerDisc.scale.setScalar(side === 'player' ? 0.94 : 1);
      if (this.opponentDisc) this.opponentDisc.scale.setScalar(side === 'opponent' ? 0.94 : 1);
    }

    playThrow() {
      this.playAttack('opponent');
      this.shake = 0.35;
    }

    update(dt) {
      this.elapsed += dt;

      // Cámara con órbita muy lenta y sacudida al golpear.
      const angle = Math.sin(this.elapsed * 0.12) * 0.16;
      const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
      const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.6 : 0;
      this.camera.position.set(Math.sin(angle) * 3 + shakeX, 7.6 + shakeY, 14.5);
      this.camera.lookAt(0, 1.35, 0);
      this.shake = Math.max(0, this.shake - dt * 3.2);

      if (this.playerDisc) this.playerDisc.scale.lerp(new THREE.Vector3(1, 1, 1), 0.12);
      if (this.opponentDisc) this.opponentDisc.scale.lerp(new THREE.Vector3(1, 1, 1), 0.12);

      if (this.dust) this.dust.rotation.y += dt * 0.03;
      if (this.crowd) this.crowd.position.y = Math.sin(this.elapsed * 1.6) * 0.04;

      for (let index = this.bursts.length - 1; index >= 0; index--) {
        const burst = this.bursts[index];
        burst.life += dt;
        const positions = burst.points.geometry.attributes.position.array;
        for (let i = 0; i < burst.velocities.length; i++) {
          positions[i * 3] += burst.velocities[i].x * dt;
          positions[i * 3 + 1] += burst.velocities[i].y * dt;
          positions[i * 3 + 2] += burst.velocities[i].z * dt;
          burst.velocities[i].y -= 9.8 * dt;
        }
        burst.points.geometry.attributes.position.needsUpdate = true;
        burst.points.material.opacity = Math.max(0, 0.95 * (1 - burst.life / burst.max));
        if (burst.life >= burst.max) {
          this.scene.remove(burst.points);
          burst.points.geometry.dispose();
          burst.points.material.dispose();
          this.bursts.splice(index, 1);
        }
      }
    }

    loop() {
      if (this.disposed) return;
      this._raf = requestAnimationFrame(() => this.loop());
      const dt = Math.min(0.05, this.clock.getDelta());
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      if (this._raf) cancelAnimationFrame(this._raf);
      global.removeEventListener('resize', this.onResize);
      this.scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : (object.material ? [object.material] : []);
        materials.forEach((material) => {
          if (material.map) material.map.dispose();
          material.dispose();
        });
      });
      this.renderer.dispose();
      this.canvas.parentNode?.removeChild(this.canvas);
      if (this.arena) this.arena.classList.remove('battle3d-arena');
    }
  }

  let current = null;

  const Battle3D = {
    mount(container, options = {}) {
      if (current) current.dispose();
      current = new BattleArena3D(container, options);
      return current;
    },
    playAttack(side) {
      current?.playAttack(side);
    },
    playThrow() {
      current?.playThrow();
    },
    setPaused(paused) {
      if (!current) return;
      if (paused) current.clock.getDelta();
    },
    dispose() {
      if (current) current.dispose();
      current = null;
    },
    get instance() {
      return current;
    },
  };

  global.Battle3D = Battle3D;
})(typeof window !== 'undefined' ? window : this);
