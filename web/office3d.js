import * as THREE from './three.module.js';

const colors = {
  background: 0xeaf4ef, floor: 0xf0e3ce, edge: 0xa6beb3, wall: 0xe1efe8, window: 0xbbdceb,
  desk: 0xd4a97d, table: 0xabc4ad, monitor: 0x334f58, screen: 0x9deddb, plant: 0x609570, pot: 0xcd8872
};
const people = [
  [0xe4b593, 0x392f2c, 0x497bc0], [0xcf9b77, 0x241f23, 0xbb7954],
  [0xb87854, 0x292230, 0xa25688], [0xab7153, 0x2b2526, 0x38826e],
  [0xefc7a2, 0x833c2d, 0xc29748], [0xdeb391, 0x454048, 0x5d7396]
];

export function mountOffice(container, onSelect, reducedMotion) {
  const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setClearColor(colors.background);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('aria-label', '3D office. Drag to rotate, select a person, or use the named desks below.');
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 70);
  let angle = 0.57;
  let zoom = 16;
  const materials = new Map();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitSphere = new THREE.SphereGeometry(1, 16, 12);
  const materialsFor = color => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
    return materials.get(color);
  };
  function shape(geometry, parent, color, dimensions, position, shade = true) {
    const mesh = new THREE.Mesh(geometry, materialsFor(color));
    mesh.scale.set(...dimensions);
    mesh.position.set(...position);
    mesh.castShadow = shade;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const box = (parent, color, dimensions, position, shade) => shape(unitBox, parent, color, dimensions, position, shade);
  const oval = (parent, color, dimensions, position, shade) => shape(unitSphere, parent, color, dimensions, position, shade);
  const group = (parent, x, y, z) => {
    const node = new THREE.Group();
    node.position.set(x, y, z);
    parent.add(node);
    return node;
  };

  const ambient = new THREE.HemisphereLight(0xfbffff, 0x91a388, 2.2);
  scene.add(ambient);
  const sunlight = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sunlight.position.set(-6, 11, 8);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  Object.assign(sunlight.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9 });
  sunlight.shadow.normalBias = 0.025;
  scene.add(sunlight);

  box(scene, colors.edge, [13.1, 0.22, 9.2], [0, -0.18, 0], false);
  box(scene, colors.floor, [13, 0.12, 9.1], [0, -0.04, 0], false);
  for (let x = -6; x <= 6; x += 0.65) box(scene, 0xdecdb5, [0.014, 0.005, 8.9], [x, 0.025, 0], false);
  box(scene, colors.wall, [13, 2.35, 0.13], [0, 1.2, -4.53]);
  box(scene, colors.wall, [0.14, 1.1, 9], [-6.48, 0.61, 0]);
  for (const x of [-4.6, -2.3, 0, 2.3, 4.6]) {
    box(scene, 0xf4fffb, [1.85, 1.33, 0.09], [x, 1.51, -4.44]);
    box(scene, colors.window, [1.66, 1.13, 0.08], [x, 1.51, -4.38]);
    box(scene, 0xf4fffb, [0.04, 1.15, 0.09], [x, 1.51, -4.34]);
  }

  for (const [x, z] of [[-5.55, -3.6], [5.72, -3.5], [5.88, 3.52], [-5.86, 3.38]]) {
    const stand = group(scene, x, 0, z);
    box(stand, colors.pot, [0.38, 0.36, 0.38], [0, 0.21, 0]);
    box(stand, 0x829759, [0.08, 0.53, 0.08], [0, 0.56, 0]);
    for (let i = 0; i < 5; i++) {
      const leaf = oval(stand, colors.plant, [0.15, 0.10, 0.29], [Math.cos(i * 2) * 0.19, 0.62 + i * 0.08, Math.sin(i * 2) * 0.19]);
      leaf.rotation.set(i * 0.6, i * 2, 0.35);
    }
  }

  const meeting = group(scene, 0, 0, -3.08);
  box(meeting, 0xc1d9cc, [3.3, 0.025, 1.68], [0, 0.03, 0], false);
  box(meeting, colors.table, [2.2, 0.12, 1.05], [0, 0.77, 0]);
  box(meeting, 0x729888, [1.4, 0.55, 0.43], [0, 0.40, 0]);
  for (const x of [-0.73, 0, 0.73]) box(meeting, 0xf3fcf5, [0.32, 0.025, 0.25], [x, 0.85, 0.07]);

  const agents = people.map(([skin, hair, fabric], index) => {
    const x = (index % 3 - 1) * 3.84;
    const z = Math.floor(index / 3) * 3.38 - 0.82;
    const desk = group(scene, x, 0, z);
    desk.userData.agent = index;
    const rug = box(desk, 0xd9e8df, [2.86, 0.035, 1.87], [0, 0.032, 0.47], false);
    box(desk, colors.desk, [2.28, 0.12, 0.91], [0, 0.84, 0]);
    for (const sign of [-1, 1]) box(desk, 0xb88f67, [0.15, 0.79, 0.75], [sign * 0.99, 0.43, 0]);
    box(desk, colors.monitor, [0.92, 0.55, 0.09], [0, 1.31, -0.22]);
    box(desk, colors.screen, [0.78, 0.41, 0.018], [0, 1.31, -0.168]);
    for (let run = 0; run < 5; run++) {
      box(desk, 0x428a8d, [0.048, 0.07 + run * 0.042, 0.007], [-0.22 + run * 0.11, 1.17 + run * 0.021, -0.15], false);
    }
    box(desk, colors.monitor, [0.50, 0.04, 0.18], [0, 0.93, 0.2]);
    oval(desk, 0xf5f7e5, [0.105, 0.12, 0.105], [-0.82, 1.01, -0.05]);
    const home = new THREE.Vector3(x, 0, z + 0.93);
    const figure = group(scene, ...home.toArray());
    figure.userData.agent = index;
    box(figure, fabric, [0.41, 0.5, 0.27], [0, 0.91, 0]);
    box(figure, 0xf1ebdc, [0.13, 0.20, 0.02], [0, 1.01, -0.144]);
    box(figure, 0x465867, [0.37, 0.17, 0.24], [0, 0.58, 0]);
    oval(figure, skin, [0.17, 0.205, 0.15], [0, 1.39, -0.015]);
    oval(figure, hair, [0.18, 0.11, 0.16], [0, 1.52, 0.015]);
    for (const offset of [-0.07, 0.07]) {
      oval(figure, 0x37343b, [0.018, 0.019, 0.016], [offset, 1.40, -0.152], false);
    }
    const limbs = [-1, 1].map(sign => {
      const arm = group(figure, sign * 0.24, 1.08, 0);
      box(arm, fabric, [0.125, 0.30, 0.13], [0, -0.13, 0]);
      oval(arm, skin, [0.056, 0.075, 0.056], [0, -0.31, 0]);
      const leg = group(figure, sign * 0.10, 0.62, 0);
      box(leg, 0x465867, [0.14, 0.46, 0.15], [0, -0.20, 0]);
      box(leg, 0x303443, [0.145, 0.105, 0.22], [0, -0.46, -0.05]);
      return { arm, leg };
    });
    return { figure, limbs, home, rug, destination: home.clone(), atMeeting: false };
  });

  let motion = !reducedMotion;
  let selection = 5;
  let frame = 0;
  let visible = false;
  let elapsed = 0;
  let previous = performance.now();
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function view() {
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    renderer.setSize(rect.width, rect.height);
    camera.aspect = rect.width / rect.height;
    camera.position.set(Math.sin(angle) * zoom, zoom * 0.69, Math.cos(angle) * zoom);
    camera.lookAt(0, 0.28, -0.15);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  const size = new ResizeObserver(view);
  size.observe(container);
  function update(timestamp) {
    if (!visible) return;
    const delta = Math.min(0.05, (timestamp - previous) / 1000);
    previous = timestamp;
    elapsed += delta;
    agents.forEach(({ figure, limbs, destination }, index) => {
      const x = destination.x - figure.position.x;
      const z = destination.z - figure.position.z;
      const distance = Math.hypot(x, z);
      const walking = distance > 0.04;
      if (walking) {
        const stride = motion ? Math.min(distance, delta * 2.8) : distance;
        figure.position.x += x * stride / distance;
        figure.position.z += z * stride / distance;
        figure.rotation.y = Math.atan2(-x, -z);
      } else {
        figure.rotation.y = 0;
      }
      const pace = elapsed * (walking ? 9 : 5) + index;
      limbs.forEach(({ arm, leg }, side) => {
        arm.rotation.x = motion ? (walking ? Math.sin(pace + side * Math.PI) * 0.48 : 0.92 + Math.sin(pace + side) * 0.11) : 0.55;
        leg.rotation.x = motion && walking ? Math.sin(pace + side * Math.PI) * 0.39 : 0;
      });
    });
    renderer.render(scene, camera);
    frame = requestAnimationFrame(update);
  }

  let down;
  renderer.domElement.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    down = { pointerId: event.pointerId, x: event.clientX, angle, moved: false };
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', event => {
    if (!down || down.pointerId !== event.pointerId) return;
    const distance = event.clientX - down.x;
    if (Math.abs(distance) > 5) down.moved = true;
    if (down.moved) {
      angle = Math.max(-1.2, Math.min(1.24, down.angle - distance * 0.008));
      view();
    }
  });
  renderer.domElement.addEventListener('pointercancel', () => { down = null; });
  renderer.domElement.addEventListener('pointerup', event => {
    if (!down || down.pointerId !== event.pointerId) return;
    const moved = down.moved;
    down = null;
    if (moved) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(scene.children, true).at(0);
    for (let object = hit?.object; object; object = object.parent) {
      if (Number.isInteger(object.userData.agent)) {
        onSelect(object.userData.agent);
        break;
      }
    }
  });
  const highlight = new THREE.MeshStandardMaterial({ color: 0x8dbdac, roughness: 0.85 });
  function select(index) {
    agents[selection].rug.material = materialsFor(0xd9e8df);
    selection = index;
    agents[index].rug.material = highlight;
    view();
  }
  select(selection);
  return {
    select,
    setVisible(next) {
      if (next === visible) return;
      visible = next;
      cancelAnimationFrame(frame);
      if (visible) {
        view();
        previous = performance.now();
        frame = requestAnimationFrame(update);
      }
    },
    setMotion(value) { motion = value; },
    meet(index, meeting) {
      const agent = agents[index];
      agent.atMeeting = meeting;
      agent.destination = meeting ? new THREE.Vector3((index % 3 - 1) * 0.58, 0, -2.08) : agent.home.clone();
    },
    reset() { angle = 0.57; zoom = 16; view(); }
  };
}
