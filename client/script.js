import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const container = document.getElementById("canvas-container");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const joystickContainer = document.getElementById("joystick-container");
const joystickKnob = document.getElementById("joystick-knob");

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87ceeb, 50, 100);

const camera = new THREE.PerspectiveCamera(
  60,
  container.clientWidth / container.clientHeight,
  0.1,
  200
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
scene.add(ambientLight);

const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x362907, 0.8);
scene.add(hemisphereLight);

const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
dirLight.position.set(20, 30, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 60;
dirLight.shadow.camera.left = -30;
dirLight.shadow.camera.right = 30;
dirLight.shadow.camera.top = 30;
dirLight.shadow.camera.bottom = -30;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
fillLight.position.set(-20, 10, -20);
scene.add(fillLight);

const groundGeo = new THREE.PlaneGeometry(80, 80);
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x4a7c59,
  roughness: 0.9,
  metalness: 0.0,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const gridHelper = new THREE.GridHelper(80, 40, 0x88bb88, 0x559955);
gridHelper.position.y = 0.05;
scene.add(gridHelper);

const clock = new THREE.Clock();
const players = new Map();

const keyState = {
  w: false,
  a: false,
  s: false,
  d: false,
};

let joystickActive = false;
let joystickX = 0;
let joystickY = 0;

let mySessionId = null;
let room = null;

const moveSpeed = 6;
const lerpSpeed = 8;

let myGroup = null;
let myTargetX = 0;
let myTargetZ = 0;
let myTargetRotY = 0;

const loader = new GLTFLoader();

function addChatMessage(sessionId, text) {
  const line = document.createElement("div");
  line.className = "chat-line";
  if (sessionId === mySessionId) {
    line.style.color = "#ffff88";
    line.textContent = `You: ${text}`;
  } else {
    line.textContent = `${sessionId.slice(0, 6)}: ${text}`;
  }
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function createPlayerGroup(avatarUrl, sessionId) {
  const group = new THREE.Group();
  const isMe = sessionId === mySessionId;
  group.userData.isMe = isMe;

  loader.load(
    avatarUrl,
    (gltf) => {
      const model = gltf.scene;
      model.scale.set(1, 1, 1);
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      group.add(model);
    },
    undefined,
    (err) => {
      console.warn("GLB load failed, using fallback:", err);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: isMe ? 0x4488ff : 0xff6644,
        roughness: 0.3,
        metalness: 0.4,
      });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.6), bodyMat);
      body.position.y = 0.7;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const headMat = new THREE.MeshStandardMaterial({
        color: isMe ? 0x66aaff : 0xff8866,
        roughness: 0.5,
      });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), headMat);
      head.position.y = 1.5;
      head.castShadow = true;
      head.receiveShadow = true;
      group.add(head);
    }
  );

  scene.add(group);
  return group;
}

function removePlayerGroup(sessionId) {
  const entry = players.get(sessionId);
  if (entry) {
    scene.remove(entry.group);
    players.delete(sessionId);
  }
}

function updatePlayerGroup(sessionId, x, z, rotationY) {
  const entry = players.get(sessionId);
  if (!entry) return;

  const isMe = sessionId === mySessionId;
  if (isMe) {
    entry.targetX = x;
    entry.targetZ = z;
    entry.targetRotY = rotationY;
  } else {
    entry.group.position.x += (x - entry.group.position.x) * 0.2;
    entry.group.position.z += (z - entry.group.position.z) * 0.2;
    entry.group.rotation.y += (rotationY - entry.group.rotation.y) * 0.2;
  }
}

function getMovementInput() {
  let dx = 0;
  let dz = 0;

  if (keyState.w) dz -= 1;
  if (keyState.s) dz += 1;
  if (keyState.a) dx -= 1;
  if (keyState.d) dx += 1;

  if (joystickActive) {
    dx += joystickX;
    dz += joystickY;
  }

  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > 1) {
    dx /= len;
    dz /= len;
  }

  return { dx, dz };
}

function connect() {
  const hostname = window.location.hostname;
  const isLocal =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "";
  const wsUrl = isLocal
    ? "ws://localhost:2567"
    : `wss://${hostname}`;

  const client = new Colyseus.Client(wsUrl);

  client
    .joinOrCreate("custom_room", {
      avatarUrl:
        "https://models.readyplayer.me/67a8b2a0a1b2c3d4e5f6a7b8.glb",
    })
    .then((joinedRoom) => {
      room = joinedRoom;
      mySessionId = room.sessionId;
      console.log("Joined room:", room.sessionId);

      room.onStateChange((state) => {
        const statePlayers = state.players || {};

        for (const id in statePlayers) {
          const p = statePlayers[id];
          const isNew = !players.has(id);

          if (isNew) {
            const group = createPlayerGroup(p.avatarUrl, id);
            group.position.set(p.x, 0, p.z);
            group.rotation.y = p.rotationY || 0;

            players.set(id, { group, targetX: p.x, targetZ: p.z, targetRotY: p.rotationY || 0 });

            if (id === mySessionId) {
              myGroup = group;
              myTargetX = p.x;
              myTargetZ = p.z;
              myTargetRotY = p.rotationY || 0;
            }
          }
        }

        for (const id of players.keys()) {
          if (!statePlayers[id]) {
            removePlayerGroup(id);
            if (id === mySessionId) {
              myGroup = null;
            }
          }
        }
      });

      room.onMessage("chat", (data) => {
        addChatMessage(data.sessionId, data.message);
      });

      function sendMove() {
        if (!myGroup) return;
        room.send("move", {
          x: myGroup.position.x,
          z: myGroup.position.z,
          rotationY: myGroup.rotation.y,
        });
      }

      setInterval(sendMove, 50);
    })
    .catch((err) => {
      console.error("Failed to join room:", err);
    });
}

function onResize() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

window.addEventListener("resize", onResize);

document.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (key in keyState) {
    keyState[key] = true;
    e.preventDefault();
  }
});

document.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  if (key in keyState) {
    keyState[key] = false;
    e.preventDefault();
  }
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const text = chatInput.value.trim();
    if (text.length > 0 && room) {
      room.send("chat", { message: text });
      chatInput.value = "";
    }
    e.preventDefault();
  }
});

let joystickTouchId = null;
const joystickCenter = { x: 0, y: 0 };
const joystickMaxDist = 35;

function getJoystickCenter() {
  const rect = joystickContainer.getBoundingClientRect();
  joystickCenter.x = rect.left + rect.width / 2;
  joystickCenter.y = rect.top + rect.height / 2;
}

joystickContainer.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    if (joystickTouchId !== null) return;
    const touch = e.changedTouches[0];
    joystickTouchId = touch.identifier;
    getJoystickCenter();
    joystickActive = true;
    handleJoystickMove(touch.clientX, touch.clientY);
  },
  { passive: false }
);

document.addEventListener(
  "touchmove",
  (e) => {
    if (joystickTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === joystickTouchId) {
        e.preventDefault();
        handleJoystickMove(touch.clientX, touch.clientY);
      }
    }
  },
  { passive: false }
);

document.addEventListener(
  "touchend",
  (e) => {
    if (joystickTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joystickTouchId) {
        joystickTouchId = null;
        joystickActive = false;
        joystickX = 0;
        joystickY = 0;
        joystickKnob.style.transform = "translate(0px, 0px)";
      }
    }
  },
  { passive: false }
);

document.addEventListener(
  "touchcancel",
  () => {
    joystickTouchId = null;
    joystickActive = false;
    joystickX = 0;
    joystickY = 0;
    joystickKnob.style.transform = "translate(0px, 0px)";
  },
  { passive: false }
);

function handleJoystickMove(clientX, clientY) {
  const dx = clientX - joystickCenter.x;
  const dy = clientY - joystickCenter.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  let clampedDx = dx;
  let clampedDy = dy;

  if (dist > joystickMaxDist) {
    clampedDx = (dx / dist) * joystickMaxDist;
    clampedDy = (dy / dist) * joystickMaxDist;
  }

  joystickKnob.style.transform = `translate(${clampedDx}px, ${clampedDy}px)`;

  const normalizedDist = Math.min(dist, joystickMaxDist) / joystickMaxDist;
  if (dist > 5) {
    joystickX = (clampedDx / joystickMaxDist) * normalizedDist;
    joystickY = -(clampedDy / joystickMaxDist) * normalizedDist;
  } else {
    joystickX = 0;
    joystickY = 0;
  }
}

connect();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  if (myGroup) {
    const input = getMovementInput();

    if (input.dx !== 0 || input.dz !== 0) {
      const angle = Math.atan2(input.dx, input.dz);
      myTargetRotY = angle;

      myTargetX += Math.sin(angle) * moveSpeed * delta;
      myTargetZ += Math.cos(angle) * moveSpeed * delta;
    }

    myGroup.position.x += (myTargetX - myGroup.position.x) * lerpSpeed * delta;
    myGroup.position.z += (myTargetZ - myGroup.position.z) * lerpSpeed * delta;

    let rotDiff = myTargetRotY - myGroup.rotation.y;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    myGroup.rotation.y += rotDiff * lerpSpeed * delta;

    camera.position.x = myGroup.position.x;
    camera.position.z = myGroup.position.z + 6;
    camera.position.y = 4;
    camera.lookAt(myGroup.position.x, 1, myGroup.position.z);
  }

  renderer.render(scene, camera);
}

animate();
