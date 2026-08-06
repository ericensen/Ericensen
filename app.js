import {
  dedupeNames,
  normalizeName,
  parseNamesFromSpeech,
  parseNamesFromText
} from "./lib/nameParser.mjs";
import { mergeDrawQueue, shuffleNames } from "./lib/drawOrder.mjs";
import { starHopperLevels } from "./lib/starHopperLevels.mjs";

const routes = new Map([
  ["home", document.querySelector("#home-view")],
  ["namehat", document.querySelector("#namehat-view")],
  ["ecosystem", document.querySelector("#ecosystem-view")],
  ["starhopper", document.querySelector("#starhopper-view")],
  ["blocks", document.querySelector("#blocks-view")]
]);

const appRegistry = [
  {
    id: "namehat",
    title: "NameHat",
    kicker: "Private random picker",
    description: "Voice capture, editable rosters, hidden draws, and no paper slips.",
    accent: "teal"
  },
  {
    id: "ecosystem",
    title: "Ecosystem Lab",
    kicker: "Simulation",
    description: "Tune predators, herbivores, plants, hunger, movement, and reproduction.",
    accent: "olive"
  },
  {
    id: "starhopper",
    title: "Star Hopper",
    kicker: "Retro platformer",
    description: "An original moon-runner with pixel art, crystals, zaps, and one level.",
    accent: "sky"
  },
  {
    id: "blocks",
    title: "Block Stack",
    kicker: "Tetris-style game",
    description: "A clean canvas game with keyboard and touch controls.",
    accent: "coral"
  },
  {
    id: "future",
    title: "Next project",
    kicker: "Open slot",
    description: "Add another app by extending the registry in app.js.",
    accent: "gold",
    disabled: true
  }
];

const state = {
  names: [],
  drawn: [],
  drawQueue: [],
  hiddenHistory: true,
  activeDraw: null
};

const storageKey = "ericensen-namehat-state-v1";
const tileStorageKey = "ericensen-namehat-tiles-v1";

const elements = {
  appGrid: document.querySelector("#app-grid"),
  nameInput: document.querySelector("#name-input"),
  singleNameInput: document.querySelector("#single-name-input"),
  addNameForm: document.querySelector("#add-name-form"),
  parseButton: document.querySelector("#parse-button"),
  clearInputButton: document.querySelector("#clear-input-button"),
  listenButton: document.querySelector("#listen-button"),
  voiceStatus: document.querySelector("#voice-status"),
  nameList: document.querySelector("#name-list"),
  emptyList: document.querySelector("#empty-list"),
  nameTotal: document.querySelector("#name-total"),
  remainingTotal: document.querySelector("#remaining-total"),
  drawnTotal: document.querySelector("#drawn-total"),
  resetDrawsButton: document.querySelector("#reset-draws-button"),
  clearRosterButton: document.querySelector("#clear-roster-button"),
  drawButton: document.querySelector("#draw-button"),
  drawMessage: document.querySelector("#draw-message"),
  drawMeterBar: document.querySelector("#draw-meter-bar"),
  toggleHistoryButton: document.querySelector("#toggle-history-button"),
  drawHistory: document.querySelector("#draw-history"),
  drawModal: document.querySelector("#draw-modal"),
  drawnName: document.querySelector("#drawn-name"),
  redrawNameButton: document.querySelector("#redraw-name-button"),
  hideNameButton: document.querySelector("#hide-name-button")
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

function setupRouter() {
  window.addEventListener("hashchange", renderRoute);
  renderRoute();
}

function renderRoute() {
  const route = window.location.hash.replace("#", "") || "home";
  const activeRoute = routes.has(route) ? route : "home";

  for (const [id, view] of routes) {
    view.classList.toggle("active-view", id === activeRoute);
  }

  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === activeRoute);
  });

  document.body.classList.toggle("blocks-route", activeRoute === "blocks");
  tetris.setRouteActive(activeRoute === "blocks");
  starHopper.setRouteActive(activeRoute === "starhopper");
  ecosystemLab.setRouteActive(activeRoute === "ecosystem");

  if (activeRoute === "blocks") {
    tetris.draw();
  }
  if (activeRoute === "starhopper") {
    starHopper.draw();
  }
  if (activeRoute === "ecosystem") {
    ecosystemLab.draw();
  }
}

function renderAppGrid() {
  elements.appGrid.innerHTML = "";
  for (const app of appRegistry) {
    const node = document.createElement(app.disabled ? "article" : "a");
    node.className = `app-card accent-${app.accent}`;
    if (!app.disabled) {
      node.href = `#${app.id}`;
    }
    node.innerHTML = `
      <span class="app-kicker">${app.kicker}</span>
      <strong>${app.title}</strong>
      <span>${app.description}</span>
    `;
    elements.appGrid.append(node);
  }
}

function loadTileState() {
  try {
    return JSON.parse(localStorage.getItem(tileStorageKey) || "{}");
  } catch {
    return {};
  }
}

function saveTileState(tileState) {
  localStorage.setItem(tileStorageKey, JSON.stringify(tileState));
}

function setTileCollapsed(tile, button, body, collapsed, label) {
  tile.dataset.collapsed = String(collapsed);
  body.hidden = collapsed;
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${label}`);
}

function setupCollapsibleTiles() {
  const savedTileState = loadTileState();

  document.querySelectorAll("[data-collapsible-tile]").forEach((tile, index) => {
    const button = tile.querySelector("[data-tile-toggle]");
    const bodyId = button?.getAttribute("aria-controls");
    const body = bodyId ? document.getElementById(bodyId) : null;
    if (!button || !body) {
      return;
    }

    const label = tile.dataset.tileLabel || "Tile";
    const storageId = bodyId || `tile-${index}`;
    const collapsed = Boolean(savedTileState[storageId]);
    setTileCollapsed(tile, button, body, collapsed, label);

    button.addEventListener("click", () => {
      const nextCollapsed = button.getAttribute("aria-expanded") === "true";
      const nextTileState = loadTileState();
      nextTileState[storageId] = nextCollapsed;
      saveTileState(nextTileState);
      setTileCollapsed(tile, button, body, nextCollapsed, label);
    });
  });
}

function loadNameState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    state.names = Array.isArray(saved.names) ? dedupeNames(saved.names) : [];
    state.drawn = Array.isArray(saved.drawn)
      ? saved.drawn.filter((name) => state.names.includes(name))
      : [];
    state.drawQueue = Array.isArray(saved.drawQueue) ? saved.drawQueue : [];
  } catch {
    state.names = [];
    state.drawn = [];
    state.drawQueue = [];
  }
  syncDrawQueue();
}

function saveNameState() {
  localStorage.setItem(
    storageKey,
    JSON.stringify({ names: state.names, drawn: state.drawn, drawQueue: state.drawQueue })
  );
}

function remainingNames() {
  return state.names.filter((name) => !state.drawn.includes(name));
}

function syncDrawQueue({ reshuffle = false } = {}) {
  const remaining = remainingNames();
  if (reshuffle) {
    state.drawQueue = shuffleNames(remaining);
    return;
  }

  if (state.drawn.length === 0) {
    state.drawQueue = [];
    return;
  }

  state.drawQueue = mergeDrawQueue(state.drawQueue, remaining);
}

function setNames(nextNames) {
  state.names = dedupeNames(nextNames);
  state.drawn = state.drawn.filter((name) => state.names.includes(name));
  syncDrawQueue();
  saveNameState();
  renderNames();
}

function renderNames() {
  const remaining = remainingNames();
  elements.nameList.innerHTML = "";
  elements.emptyList.hidden = state.names.length > 0;

  state.names.forEach((name, index) => {
    const item = document.createElement("div");
    item.className = "name-row";
    item.dataset.drawn = String(state.drawn.includes(name));
    item.innerHTML = `
      <span class="name-number">${index + 1}</span>
      <input type="text" value="${escapeHtml(name)}" aria-label="Edit ${escapeHtml(name)}">
      <button type="button" aria-label="Remove ${escapeHtml(name)}">×</button>
    `;

    const input = item.querySelector("input");
    const remove = item.querySelector("button");

    input.addEventListener("change", () => {
      const copy = [...state.names];
      copy[index] = normalizeName(input.value);
      setNames(copy);
    });

    remove.addEventListener("click", () => {
      setNames(state.names.filter((_, itemIndex) => itemIndex !== index));
    });

    elements.nameList.append(item);
  });

  elements.nameTotal.textContent = state.names.length;
  elements.remainingTotal.textContent = remaining.length;
  elements.drawnTotal.textContent = state.drawn.length;
  elements.drawButton.disabled = remaining.length === 0;
  elements.resetDrawsButton.disabled = state.drawn.length === 0;
  elements.clearRosterButton.disabled = state.names.length === 0;
  elements.redrawNameButton.disabled = !(state.activeDraw && state.drawQueue.length > 0);
  elements.drawMessage.textContent =
    state.names.length === 0
      ? "Add names to begin."
      : remaining.length === 0
        ? "All names have been drawn."
        : `${remaining.length} ready in a shuffled order.`;
  elements.drawMeterBar.style.width = state.names.length
    ? `${Math.max(4, (remaining.length / state.names.length) * 100)}%`
    : "0%";

  renderHistory();
}

function renderHistory() {
  elements.drawHistory.innerHTML = "";
  state.drawn.forEach((name, index) => {
    const item = document.createElement("li");
    item.textContent = state.hiddenHistory ? `Draw ${index + 1}` : name;
    elements.drawHistory.append(item);
  });
  elements.toggleHistoryButton.textContent = state.hiddenHistory ? "Show drawn" : "Hide drawn";
}

function setupNameHat() {
  loadNameState();
  renderNames();

  elements.parseButton.addEventListener("click", () => {
    const parsed = parseNamesFromText(elements.nameInput.value);
    setNames([...state.names, ...parsed]);
    if (parsed.length) {
      elements.nameInput.value = state.names.join("\n");
    }
    elements.voiceStatus.textContent = parsed.length
      ? `${parsed.length} ${parsed.length === 1 ? "name" : "names"} captured.`
      : "No names found.";
  });

  elements.clearInputButton.addEventListener("click", () => {
    elements.nameInput.value = "";
    elements.voiceStatus.textContent = "";
  });

  elements.addNameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = normalizeName(elements.singleNameInput.value);
    if (!name) {
      return;
    }
    setNames([...state.names, name]);
    elements.singleNameInput.value = "";
  });

  elements.resetDrawsButton.addEventListener("click", () => {
    state.drawn = [];
    state.activeDraw = null;
    syncDrawQueue({ reshuffle: true });
    saveNameState();
    renderNames();
  });

  elements.clearRosterButton.addEventListener("click", () => {
    if (!state.names.length || !window.confirm("Clear all names and drawn history?")) {
      return;
    }
    state.names = [];
    state.drawn = [];
    state.drawQueue = [];
    state.activeDraw = null;
    elements.nameInput.value = "";
    elements.voiceStatus.textContent = "Roster cleared.";
    elements.drawModal.hidden = true;
    saveNameState();
    renderNames();
  });

  elements.drawButton.addEventListener("click", drawName);
  elements.redrawNameButton.addEventListener("click", redrawName);
  elements.hideNameButton.addEventListener("click", closeDrawModal);
  elements.drawModal.addEventListener("click", (event) => {
    if (event.target === elements.drawModal) {
      closeDrawModal();
    }
  });

  elements.toggleHistoryButton.addEventListener("click", () => {
    state.hiddenHistory = !state.hiddenHistory;
    elements.drawHistory.hidden = false;
    renderHistory();
  });

  setupVoice();
}

function setupVoice() {
  if (!SpeechRecognition) {
    elements.listenButton.disabled = true;
    elements.voiceStatus.textContent = "Voice capture is unavailable in this browser.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.addEventListener("result", (event) => {
    let finalText = "";
    let interimText = "";
    let capturedStatus = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) {
        finalText += `${result[0].transcript} `;
      } else {
        interimText += result[0].transcript;
      }
    }

    if (finalText) {
      const parsed = parseNamesFromSpeech(finalText);
      if (parsed.length) {
        const previousTotal = state.names.length;
        setNames([...state.names, ...parsed]);
        elements.nameInput.value = state.names.join("\n");
        const capturedCount = state.names.length - previousTotal;
        capturedStatus = capturedCount
          ? `${capturedCount} ${capturedCount === 1 ? "name" : "names"} captured.`
          : "Those names are already on the list.";
      }
    }

    elements.voiceStatus.textContent = interimText || capturedStatus || (isListening ? "Listening..." : "");
  });

  recognition.addEventListener("end", () => {
    isListening = false;
    elements.listenButton.classList.remove("listening");
    elements.listenButton.setAttribute("aria-label", "Start voice capture");
  });

  recognition.addEventListener("error", (event) => {
    isListening = false;
    elements.listenButton.classList.remove("listening");
    elements.voiceStatus.textContent = event.error === "not-allowed"
      ? "Microphone access was blocked."
      : "Voice capture stopped.";
  });

  elements.listenButton.addEventListener("click", () => {
    if (isListening) {
      recognition.stop();
      return;
    }

    elements.voiceStatus.textContent = "Listening...";
    elements.listenButton.classList.add("listening");
    elements.listenButton.setAttribute("aria-label", "Stop voice capture");
    isListening = true;
    recognition.start();
  });
}

function drawName() {
  if (state.drawQueue.length) {
    syncDrawQueue();
  } else {
    state.drawQueue = shuffleNames(remainingNames());
  }

  if (!state.drawQueue.length) {
    renderNames();
    return;
  }

  const drawn = state.drawQueue.shift();
  state.activeDraw = drawn;
  state.drawn.push(drawn);
  saveNameState();
  elements.drawnName.textContent = drawn;
  elements.drawModal.hidden = false;
  elements.hideNameButton.focus();
  renderNames();
}

function redrawName() {
  const previousDraw = state.activeDraw;
  if (!previousDraw) {
    return;
  }

  syncDrawQueue();
  if (!state.drawQueue.length) {
    renderNames();
    return;
  }

  const previousIndex = state.drawn.lastIndexOf(previousDraw);
  if (previousIndex >= 0) {
    state.drawn.splice(previousIndex, 1);
  }

  const replacement = state.drawQueue.shift();
  const returnIndex = Math.floor(Math.random() * (state.drawQueue.length + 1));
  state.drawQueue.splice(returnIndex, 0, previousDraw);
  state.activeDraw = replacement;
  state.drawn.push(replacement);
  elements.drawnName.textContent = replacement;
  saveNameState();
  renderNames();
  elements.hideNameButton.focus();
}

function closeDrawModal() {
  elements.drawModal.hidden = true;
  state.activeDraw = null;
  if (elements.drawButton.closest("[hidden]")) {
    document.querySelector('[aria-controls="draw-body"]')?.focus();
  } else {
    elements.drawButton.focus();
  }
}

function escapeHtml(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}

function setShortcutLabel(button, label, shortcut, ariaLabel = label) {
  if (!button) {
    return;
  }
  const labelNode = document.createElement("span");
  labelNode.className = "button-label";
  labelNode.textContent = label;
  const shortcutNode = document.createElement("kbd");
  shortcutNode.textContent = shortcut;
  button.replaceChildren(labelNode, shortcutNode);
  button.setAttribute("aria-label", `${ariaLabel}, keyboard shortcut ${shortcut}`);
}

function setupHubCanvas() {
  const canvas = document.querySelector("#hub-canvas");
  const context = canvas.getContext("2d");
  let frame = 0;

  function paint() {
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#f8f4ea";
    context.fillRect(0, 0, width, height);

    const points = [
      [120, 150, "#2f8f83"],
      [360, 98, "#d7564a"],
      [540, 220, "#e2a82e"],
      [250, 340, "#24324a"],
      [470, 390, "#6f8a43"]
    ];

    context.lineWidth = 2;
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[(index + 2) % points.length];
      context.strokeStyle = "rgba(36, 50, 74, 0.15)";
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    }

    points.forEach(([x, y, color], index) => {
      const pulse = Math.sin((frame + index * 24) / 24) * 4;
      context.fillStyle = color;
      context.beginPath();
      context.roundRect(x - 48 - pulse / 2, y - 32 - pulse / 2, 96 + pulse, 64 + pulse, 8);
      context.fill();
      context.fillStyle = "rgba(255, 255, 255, 0.82)";
      context.fillRect(x - 24, y - 7, 48, 6);
      context.fillRect(x - 24, y + 7, 32, 6);
    });

    frame += 1;
    requestAnimationFrame(paint);
  }

  paint();
}

const ecosystemLab = (() => {
  const canvas = document.querySelector("#ecosystem-canvas");
  const context = canvas.getContext("2d");
  const actionButton = document.querySelector("#ecosystem-action-button");
  const reseedButton = document.querySelector("#ecosystem-reseed-button");
  const plantCount = document.querySelector("#eco-plant-count");
  const herbivoreCount = document.querySelector("#eco-herbivore-count");
  const predatorCount = document.querySelector("#eco-predator-count");
  const controls = [
    ["startPlants", "#eco-start-plants", "#eco-start-plants-value"],
    ["startHerbivores", "#eco-start-herbivores", "#eco-start-herbivores-value"],
    ["startPredators", "#eco-start-predators", "#eco-start-predators-value"],
    ["plantSpawn", "#eco-plant-spawn", "#eco-plant-spawn-value"],
    ["herbivoreSpeed", "#eco-herbivore-speed", "#eco-herbivore-speed-value"],
    ["herbivoreFeed", "#eco-herbivore-feed", "#eco-herbivore-feed-value"],
    ["herbivoreRepro", "#eco-herbivore-repro", "#eco-herbivore-repro-value"],
    ["predatorSpeed", "#eco-predator-speed", "#eco-predator-speed-value"],
    ["predatorFeed", "#eco-predator-feed", "#eco-predator-feed-value"],
    ["predatorRepro", "#eco-predator-repro", "#eco-predator-repro-value"]
  ].map(([key, inputSelector, outputSelector]) => ({
    key,
    input: document.querySelector(inputSelector),
    output: document.querySelector(outputSelector)
  }));
  const colors = {
    plant: "#52a85f",
    herbivore: "#2f7ed8",
    predator: "#d7564a"
  };
  const settings = {};
  const world = { width: canvas.width, height: canvas.height };
  const caps = { plants: 700, herbivores: 220, predators: 120 };
  let routeActive = false;
  let running = true;
  let animationFrame = 0;
  let lastTime = 0;
  let plantSpawnCarry = 0;
  let organisms = emptyOrganisms();

  function emptyOrganisms() {
    return { plants: [], herbivores: [], predators: [] };
  }

  function readSettings() {
    controls.forEach(({ key, input, output }) => {
      const value = Number(input.value);
      settings[key] = value;
      output.textContent = Number.isInteger(value) ? String(value) : value.toFixed(1);
    });
  }

  function randomPoint(margin = 10) {
    return {
      x: margin + Math.random() * (world.width - margin * 2),
      y: margin + Math.random() * (world.height - margin * 2)
    };
  }

  function randomDirection() {
    const angle = Math.random() * Math.PI * 2;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  function spawnPlant(point = randomPoint(8)) {
    if (organisms.plants.length >= caps.plants) {
      return;
    }
    organisms.plants.push({
      ...point,
      radius: 3 + Math.random() * 1.4,
      age: 0
    });
  }

  function createAnimal(type, point = randomPoint(18)) {
    const direction = randomDirection();
    return {
      ...point,
      type,
      radius: type === "predator" ? 5 : 4,
      hunger: Math.random() * 4,
      reproCooldown: Math.random() * reproductionCooldown(type),
      wanderTimer: 0,
      vx: direction.x,
      vy: direction.y
    };
  }

  function spawnAnimal(type, point = randomPoint(18)) {
    const list = type === "predator" ? organisms.predators : organisms.herbivores;
    const cap = type === "predator" ? caps.predators : caps.herbivores;
    if (list.length >= cap) {
      return;
    }
    list.push(createAnimal(type, point));
  }

  function seed() {
    readSettings();
    organisms = emptyOrganisms();
    plantSpawnCarry = 0;
    for (let index = 0; index < settings.startPlants; index += 1) {
      spawnPlant();
    }
    for (let index = 0; index < settings.startHerbivores; index += 1) {
      spawnAnimal("herbivore");
    }
    for (let index = 0; index < settings.startPredators; index += 1) {
      spawnAnimal("predator");
    }
    running = true;
    updateActionButton();
    updateCounts();
    draw();
    startLoop();
  }

  function distanceSquared(left, right) {
    const dx = left.x - right.x;
    const dy = left.y - right.y;
    return dx * dx + dy * dy;
  }

  function nearest(source, candidates, maxDistance) {
    const maxSquared = maxDistance * maxDistance;
    let best = null;
    let bestDistance = maxSquared;
    candidates.forEach((candidate) => {
      const distance = distanceSquared(source, candidate);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    });
    return best;
  }

  function feedNeed(type) {
    return type === "predator" ? settings.predatorFeed : settings.herbivoreFeed;
  }

  function movementSpeed(type) {
    return type === "predator" ? settings.predatorSpeed : settings.herbivoreSpeed;
  }

  function reproductionCooldown(type) {
    return type === "predator" ? settings.predatorRepro : settings.herbivoreRepro;
  }

  function steerToward(animal, target, strength = 0.08) {
    const dx = target.x - animal.x;
    const dy = target.y - animal.y;
    const length = Math.hypot(dx, dy) || 1;
    animal.vx += (dx / length) * strength;
    animal.vy += (dy / length) * strength;
  }

  function wander(animal, delta) {
    animal.wanderTimer -= delta;
    if (animal.wanderTimer <= 0) {
      const direction = randomDirection();
      animal.vx += direction.x * 0.8;
      animal.vy += direction.y * 0.8;
      animal.wanderTimer = 0.7 + Math.random() * 1.6;
    }
  }

  function normalizeVelocity(animal) {
    const length = Math.hypot(animal.vx, animal.vy) || 1;
    animal.vx /= length;
    animal.vy /= length;
  }

  function containAnimal(animal) {
    if (animal.x < animal.radius) {
      animal.x = animal.radius;
      animal.vx = Math.abs(animal.vx);
    }
    if (animal.x > world.width - animal.radius) {
      animal.x = world.width - animal.radius;
      animal.vx = -Math.abs(animal.vx);
    }
    if (animal.y < animal.radius) {
      animal.y = animal.radius;
      animal.vy = Math.abs(animal.vy);
    }
    if (animal.y > world.height - animal.radius) {
      animal.y = world.height - animal.radius;
      animal.vy = -Math.abs(animal.vy);
    }
  }

  function eatPlants(animal) {
    const plantIndex = organisms.plants.findIndex((plant) => (
      distanceSquared(animal, plant) < (animal.radius + plant.radius + 2) ** 2
    ));
    if (plantIndex >= 0) {
      organisms.plants.splice(plantIndex, 1);
      animal.hunger = 0;
      animal.reproCooldown = Math.max(0, animal.reproCooldown - 1.25);
    }
  }

  function eatHerbivores(animal) {
    const herbivoreIndex = organisms.herbivores.findIndex((herbivore) => (
      distanceSquared(animal, herbivore) < (animal.radius + herbivore.radius + 2) ** 2
    ));
    if (herbivoreIndex >= 0) {
      organisms.herbivores.splice(herbivoreIndex, 1);
      animal.hunger = 0;
      animal.reproCooldown = Math.max(0, animal.reproCooldown - 1.5);
    }
  }

  function updateAnimal(animal, type, delta) {
    const hungry = animal.hunger > feedNeed(type) * 0.35;
    const target = type === "predator"
      ? nearest(animal, organisms.herbivores, hungry ? 210 : 90)
      : nearest(animal, organisms.plants, hungry ? 170 : 70);

    if (target) {
      steerToward(animal, target, hungry ? 0.18 : 0.08);
    } else {
      wander(animal, delta);
    }

    animal.hunger += delta;
    animal.reproCooldown = Math.max(0, animal.reproCooldown - delta);
    normalizeVelocity(animal);
    const speed = movementSpeed(type) * (hungry ? 1.12 : 0.92);
    animal.x += animal.vx * speed * delta;
    animal.y += animal.vy * speed * delta;
    containAnimal(animal);

    if (type === "predator") {
      eatHerbivores(animal);
    } else {
      eatPlants(animal);
    }
  }

  function removeStarved(type) {
    const list = type === "predator" ? organisms.predators : organisms.herbivores;
    const need = feedNeed(type);
    const survivors = list.filter((animal) => animal.hunger <= need);
    if (type === "predator") {
      organisms.predators = survivors;
    } else {
      organisms.herbivores = survivors;
    }
  }

  function reproduce(type) {
    const list = type === "predator" ? organisms.predators : organisms.herbivores;
    const cap = type === "predator" ? caps.predators : caps.herbivores;
    const newborns = [];
    const cooldown = reproductionCooldown(type);

    for (let leftIndex = 0; leftIndex < list.length; leftIndex += 1) {
      const left = list[leftIndex];
      if (left.reproCooldown > 0 || left.hunger > feedNeed(type) * 0.72) {
        continue;
      }
      for (let rightIndex = leftIndex + 1; rightIndex < list.length; rightIndex += 1) {
        const right = list[rightIndex];
        if (right.reproCooldown > 0 || right.hunger > feedNeed(type) * 0.72) {
          continue;
        }
        if (distanceSquared(left, right) > (left.radius + right.radius + 5) ** 2) {
          continue;
        }
        if (list.length + newborns.length >= cap) {
          return;
        }
        const point = {
          x: (left.x + right.x) / 2 + (Math.random() - 0.5) * 16,
          y: (left.y + right.y) / 2 + (Math.random() - 0.5) * 16
        };
        newborns.push(createAnimal(type, point));
        left.reproCooldown = cooldown;
        right.reproCooldown = cooldown;
        break;
      }
    }

    list.push(...newborns);
  }

  function spawnPlants(delta) {
    plantSpawnCarry += settings.plantSpawn * delta;
    while (plantSpawnCarry >= 1) {
      spawnPlant();
      plantSpawnCarry -= 1;
    }
  }

  function update(delta) {
    readSettings();
    spawnPlants(delta);
    organisms.plants.forEach((plant) => {
      plant.age += delta;
    });
    organisms.herbivores.forEach((animal) => updateAnimal(animal, "herbivore", delta));
    organisms.predators.forEach((animal) => updateAnimal(animal, "predator", delta));
    removeStarved("herbivore");
    removeStarved("predator");
    reproduce("herbivore");
    reproduce("predator");
    updateCounts();
  }

  function updateCounts() {
    plantCount.textContent = organisms.plants.length;
    herbivoreCount.textContent = organisms.herbivores.length;
    predatorCount.textContent = organisms.predators.length;
  }

  function drawBackground() {
    context.fillStyle = "#f3f8f2";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(36, 50, 74, 0.055)";
    context.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 48) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 48) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
  }

  function drawDot(item, color, radius) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(item.x, item.y, radius, 0, Math.PI * 2);
    context.fill();
  }

  function draw() {
    drawBackground();
    organisms.plants.forEach((plant) => drawDot(plant, colors.plant, plant.radius));
    organisms.herbivores.forEach((animal) => drawDot(animal, colors.herbivore, animal.radius));
    organisms.predators.forEach((animal) => drawDot(animal, colors.predator, animal.radius));
    updateCounts();
  }

  function updateActionButton() {
    setShortcutLabel(actionButton, running ? "Pause" : "Run", "Space", running ? "Pause simulation" : "Run simulation");
  }

  function toggleRunning() {
    running = !running;
    updateActionButton();
    if (running) {
      startLoop();
    }
  }

  function startLoop() {
    if (!routeActive || animationFrame) {
      return;
    }
    lastTime = performance.now();
    animationFrame = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  }

  function loop(time) {
    animationFrame = 0;
    const delta = Math.min(0.05, (time - lastTime) / 1000 || 0);
    lastTime = time;
    if (running) {
      update(delta);
    }
    draw();
    if (routeActive && running) {
      animationFrame = requestAnimationFrame(loop);
    }
  }

  controls.forEach(({ input }) => {
    input.addEventListener("input", readSettings);
  });
  actionButton.addEventListener("click", toggleRunning);
  reseedButton.addEventListener("click", seed);
  document.addEventListener("keydown", (event) => {
    if (!routes.get("ecosystem").classList.contains("active-view")) {
      return;
    }
    const target = event.target;
    const isTextInput = target instanceof HTMLElement
      && (target.matches("input, textarea, select") || target.isContentEditable);
    const isNativeButtonKey = target instanceof HTMLElement
      && target.closest("button")
      && (event.key === " " || event.key === "Enter");
    if (isTextInput || isNativeButtonKey) {
      return;
    }

    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      toggleRunning();
    }
    if (event.key.toLocaleLowerCase() === "r" && !event.repeat) {
      event.preventDefault();
      seed();
    }
  });

  readSettings();
  setShortcutLabel(reseedButton, "Reseed", "R", "Reseed ecosystem");
  seed();
  updateActionButton();

  return {
    draw,
    setRouteActive(isActive) {
      routeActive = isActive;
      if (routeActive) {
        draw();
        if (running) {
          startLoop();
        }
      } else {
        stopLoop();
      }
    }
  };
})();

const starHopper = (() => {
  const canvas = document.querySelector("#starhopper-canvas");
  const context = canvas.getContext("2d");
  const overlay = document.querySelector("#starhopper-overlay");
  const overlayTitle = document.querySelector("#starhopper-overlay-title");
  const overlaySubtitle = document.querySelector("#starhopper-overlay-subtitle");
  const actionButton = document.querySelector("#starhopper-action-button");
  const restartButton = document.querySelector("#starhopper-restart-button");
  const pogoButton = document.querySelector('[data-star-control="pogo"]');
  const scoreValue = document.querySelector("#starhopper-score-value");
  const crystalValue = document.querySelector("#starhopper-crystal-value");
  const healthValue = document.querySelector("#starhopper-health-value");
  const bestValue = document.querySelector("#starhopper-best-value");
  const statusValue = document.querySelector("#starhopper-status-value");
  const progressBar = document.querySelector("#starhopper-progress-bar");
  const level = starHopperLevels[0];
  const tileSize = level.tileSize;
  const bestKey = "ericensen-starhopper-best-v1";
  const gravity = 1900;
  const runSpeed = 260;
  const jumpVelocity = -660;
  const pogoBounceVelocities = [-540, -720, -900];
  const pogoSettleVelocities = [-420, -260];
  const zapSpeed = 680;
  const playerWidth = 24;
  const playerHeight = 44;
  const controls = { left: false, right: false };

  let routeActive = false;
  let animationFrame = 0;
  let lastTime = 0;
  let game = createGameState();

  function createGameState() {
    const world = parseLevel(level);
    return {
      ...world,
      mode: "ready",
      score: 0,
      health: 3,
      crystalsCollected: 0,
      hasKey: false,
      pogoActive: false,
      pogoBounceCount: 0,
      pogoSettleBounces: 0,
      pogoPulse: 0,
      cameraX: 0,
      time: 0,
      pulses: [],
      particles: [],
      player: {
        x: world.spawn.x,
        y: world.spawn.y,
        vx: 0,
        vy: 0,
        width: playerWidth,
        height: playerHeight,
        facing: 1,
        grounded: false,
        coyote: 0,
        invulnerable: 0,
        zapCooldown: 0
      }
    };
  }

  function parseLevel(levelData) {
    const solids = [];
    const hazards = [];
    const crystals = [];
    const enemies = [];
    let spawn = { x: tileSize * 2, y: tileSize * 10 };
    let key = null;
    let exit = null;

    levelData.rows.forEach((rowText, rowIndex) => {
      [...rowText].forEach((tile, columnIndex) => {
        const x = columnIndex * tileSize;
        const y = rowIndex * tileSize;
        if (tile === "#") {
          solids.push({
            x,
            y,
            width: tileSize,
            height: tileSize,
            type: tile
          });
        }
        if (tile === "=") {
          solids.push({
            x,
            y: y + 8,
            width: tileSize,
            height: 16,
            type: tile
          });
        }
        if (tile === "^") {
          hazards.push({
            x: x + 3,
            y: y + 10,
            width: tileSize - 6,
            height: tileSize - 10
          });
        }
        if (tile === "*") {
          crystals.push({
            x: x + 9,
            y: y + 8,
            width: 14,
            height: 16,
            collected: false
          });
        }
        if (tile === "P") {
          spawn = { x: x + 4, y: y - playerHeight + tileSize };
        }
        if (tile === "K") {
          key = {
            x: x + 7,
            y: y + 3,
            width: 18,
            height: 26,
            collected: false
          };
        }
        if (tile === "X") {
          exit = {
            x: x - 8,
            y: y - 48,
            width: 48,
            height: 80
          };
        }
        if (tile === "M") {
          enemies.push({
            kind: "crawler",
            x: x + 2,
            y: y + 8,
            width: 28,
            height: 24,
            vx: 48,
            vy: 0,
            originX: x,
            active: true
          });
        }
        if (tile === "D") {
          enemies.push({
            kind: "drifter",
            x: x,
            y: y,
            width: 30,
            height: 28,
            originX: x,
            originY: y,
            phase: columnIndex * 0.4,
            active: true
          });
        }
      });
    });

    return {
      width: levelData.width * tileSize,
      height: levelData.rows.length * tileSize,
      solids,
      hazards,
      crystals,
      enemies,
      spawn,
      key,
      exit
    };
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function rectsOverlap(left, right) {
    return left.x < right.x + right.width
      && left.x + left.width > right.x
      && left.y < right.y + right.height
      && left.y + left.height > right.y;
  }

  function solidAt(rect) {
    return game.solids.find((solid) => rectsOverlap(rect, solid));
  }

  function updateOverlay(title, subtitle, buttonLabel) {
    overlayTitle.textContent = title;
    overlaySubtitle.textContent = subtitle;
    setShortcutLabel(actionButton, buttonLabel, "Enter", `${buttonLabel} Star Hopper`);
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function showOverlay(title, subtitle, buttonLabel) {
    updateOverlay(title, subtitle, buttonLabel);
    overlay.hidden = false;
  }

  function readBest() {
    const saved = Number(localStorage.getItem(bestKey) || "0");
    return Number.isFinite(saved) ? saved : 0;
  }

  function saveBest() {
    if (game.score > readBest()) {
      localStorage.setItem(bestKey, String(game.score));
    }
  }

  function statusLabel() {
    if (game.mode === "won") {
      return "Clear";
    }
    if (game.mode === "over") {
      return "Down";
    }
    if (game.pogoActive) {
      return `Pogo ${Math.min(Math.max(game.pogoBounceCount, 1), 3)}`;
    }
    if (game.hasKey) {
      return "Gate";
    }
    return game.mode === "playing" ? "Run" : "Ready";
  }

  function updateHud() {
    scoreValue.textContent = game.score;
    crystalValue.textContent = `${game.crystalsCollected}/${game.crystals.length}`;
    healthValue.textContent = game.health;
    bestValue.textContent = Math.max(readBest(), game.score);
    statusValue.textContent = statusLabel();
    const progress = clamp((game.player.x / Math.max(1, game.width - canvas.width)) * 100, 0, 100);
    progressBar.style.width = `${progress}%`;
  }

  function updatePogoButton() {
    pogoButton?.setAttribute("aria-pressed", String(game.pogoActive));
  }

  function start() {
    game = createGameState();
    game.mode = "playing";
    controls.left = false;
    controls.right = false;
    updatePogoButton();
    hideOverlay();
    updateHud();
    canvas.focus({ preventScroll: true });
    startLoop();
  }

  function endGame() {
    game.mode = "over";
    saveBest();
    showOverlay("Signal Lost", "Crater Run", "Try Again");
    updateHud();
  }

  function winGame() {
    if (game.mode !== "playing") {
      return;
    }
    game.mode = "won";
    game.score += 500 + game.health * 120;
    saveBest();
    showOverlay("Level Clear", "Crater Run", "Play Again");
    updateHud();
  }

  function resetPlayer() {
    game.player.x = game.spawn.x;
    game.player.y = game.spawn.y;
    game.player.vx = 0;
    game.player.vy = 0;
    game.player.invulnerable = 1.2;
    game.cameraX = 0;
  }

  function damagePlayer() {
    if (game.mode !== "playing" || game.player.invulnerable > 0) {
      return;
    }
    game.health -= 1;
    game.player.vy = -420;
    game.player.vx = -game.player.facing * 180;
    game.player.invulnerable = 1.1;
    if (game.health <= 0) {
      endGame();
      return;
    }
    resetPlayer();
  }

  function jump() {
    if (game.mode !== "playing") {
      return;
    }
    if (game.pogoActive) {
      pogoSpring();
      return;
    }
    if (game.player.grounded || game.player.coyote > 0) {
      game.player.vy = jumpVelocity;
      game.player.grounded = false;
      game.player.coyote = 0;
      sparkle(
        game.player.x + 12,
        game.player.y + game.player.height,
        "#f2d16b",
        5
      );
    }
  }

  function pogoSpring({ settling = false } = {}) {
    if (game.mode !== "playing" || !(game.player.grounded || game.player.coyote > 0)) {
      return;
    }
    const bounceIndex = Math.min(game.pogoBounceCount, pogoBounceVelocities.length - 1);
    const settleIndex = Math.max(0, pogoSettleVelocities.length - game.pogoSettleBounces);
    const velocity = settling
      ? pogoSettleVelocities[Math.min(settleIndex, pogoSettleVelocities.length - 1)]
      : pogoBounceVelocities[bounceIndex];

    game.player.vy = velocity;
    game.player.grounded = false;
    game.player.coyote = 0;
    game.pogoPulse = 1;

    if (settling) {
      game.pogoSettleBounces = Math.max(0, game.pogoSettleBounces - 1);
    } else {
      game.pogoBounceCount += 1;
    }

    sparkle(
      game.player.x + 12,
      game.player.y + game.player.height,
      settling ? "#c8b6ff" : "#b48dff",
      settling ? 5 : 8 + bounceIndex * 2
    );
  }

  function togglePogo() {
    if (game.mode !== "playing") {
      return;
    }
    game.pogoActive = !game.pogoActive;
    if (game.pogoActive) {
      game.pogoSettleBounces = 0;
      pogoSpring();
    } else {
      game.pogoSettleBounces = Math.min(2, game.pogoBounceCount);
      game.pogoBounceCount = 0;
    }
    updatePogoButton();
    updateHud();
    sparkle(game.player.x + 12, game.player.y + game.player.height, "#b48dff", 6);
  }

  function zap() {
    if (game.mode !== "playing" || game.player.zapCooldown > 0) {
      return;
    }
    const x = game.player.facing > 0
      ? game.player.x + game.player.width
      : game.player.x - 12;
    game.pulses.push({
      x,
      y: game.player.y + 18,
      width: 12,
      height: 8,
      vx: game.player.facing * zapSpeed,
      life: 0.9
    });
    game.player.zapCooldown = 0.24;
  }

  function sparkle(x, y, color, count) {
    for (let index = 0; index < count; index += 1) {
      game.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 130,
        vy: -60 - Math.random() * 130,
        life: 0.35 + Math.random() * 0.35,
        color
      });
    }
  }

  function resolveHorizontal(entity) {
    const hit = solidAt(entity);
    if (!hit) {
      return false;
    }
    if (entity.vx > 0) {
      entity.x = hit.x - entity.width;
    } else if (entity.vx < 0) {
      entity.x = hit.x + hit.width;
    }
    entity.vx = 0;
    return true;
  }

  function resolveVertical(entity) {
    const hit = solidAt(entity);
    if (!hit) {
      return false;
    }
    if (entity.vy > 0) {
      entity.y = hit.y - entity.height;
      entity.grounded = true;
      entity.coyote = 0.1;
    } else if (entity.vy < 0) {
      entity.y = hit.y + hit.height;
    }
    entity.vy = 0;
    return true;
  }

  function updatePlayer(delta) {
    const player = game.player;
    const direction = Number(controls.right) - Number(controls.left);
    player.vx = direction * runSpeed;
    if (direction !== 0) {
      player.facing = direction;
    }
    player.vy += gravity * delta;
    player.zapCooldown = Math.max(0, player.zapCooldown - delta);
    player.invulnerable = Math.max(0, player.invulnerable - delta);
    game.pogoPulse = Math.max(0, game.pogoPulse - delta * 4.8);

    player.x += player.vx * delta;
    resolveHorizontal(player);
    player.x = clamp(player.x, 0, game.width - player.width);

    const wasGrounded = player.grounded;
    const wasFalling = player.vy >= 0;
    player.grounded = false;
    player.y += player.vy * delta;
    resolveVertical(player);
    const landed = player.grounded && (!wasGrounded || wasFalling);
    if (!player.grounded) {
      player.coyote = Math.max(0, player.coyote - delta);
    } else if (landed && game.pogoActive) {
      pogoSpring();
    } else if (landed && game.pogoSettleBounces > 0) {
      pogoSpring({ settling: true });
    } else if (landed) {
      game.pogoBounceCount = 0;
    }

    if (player.y > game.height + 120) {
      damagePlayer();
    }
  }

  function updateEnemies(delta) {
    game.enemies.forEach((enemy) => {
      if (!enemy.active) {
        return;
      }
      if (enemy.kind === "drifter") {
        enemy.x = enemy.originX + Math.sin(game.time * 1.35 + enemy.phase) * 62;
        enemy.y = enemy.originY + Math.sin(game.time * 2.2 + enemy.phase) * 18;
        return;
      }

      enemy.vy += gravity * delta;
      const previousVx = enemy.vx;
      enemy.x += enemy.vx * delta;
      if (resolveHorizontal(enemy)) {
        enemy.vx = -previousVx;
      }
      if (Math.abs(enemy.x - enemy.originX) > 126) {
        enemy.vx = enemy.x > enemy.originX ? -Math.abs(enemy.vx) : Math.abs(enemy.vx);
      }
      enemy.grounded = false;
      enemy.y += enemy.vy * delta;
      resolveVertical(enemy);

      const probeX = enemy.vx > 0 ? enemy.x + enemy.width + 3 : enemy.x - 3;
      const groundProbe = {
        x: probeX,
        y: enemy.y + enemy.height + 4,
        width: 4,
        height: 6
      };
      if (!solidAt(groundProbe)) {
        enemy.vx *= -1;
      }
    });
  }

  function updatePulses(delta) {
    game.pulses.forEach((pulse) => {
      pulse.x += pulse.vx * delta;
      pulse.life -= delta;
      if (solidAt(pulse)) {
        pulse.life = 0;
      }

      game.enemies.forEach((enemy) => {
        if (!enemy.active || pulse.life <= 0 || !rectsOverlap(pulse, enemy)) {
          return;
        }
        enemy.active = false;
        pulse.life = 0;
        game.score += 150;
        sparkle(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, "#8ef0ff", 9);
      });
    });
    game.pulses = game.pulses.filter((pulse) => pulse.life > 0);
  }

  function updateParticles(delta) {
    game.particles.forEach((particle) => {
      particle.life -= delta;
      particle.vy += 420 * delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
    });
    game.particles = game.particles.filter((particle) => particle.life > 0);
  }

  function collectItems() {
    game.crystals.forEach((crystal) => {
      if (crystal.collected || !rectsOverlap(game.player, crystal)) {
        return;
      }
      crystal.collected = true;
      game.crystalsCollected += 1;
      game.score += 50;
      sparkle(crystal.x + 7, crystal.y + 8, "#f2d16b", 8);
    });

    if (game.key && !game.key.collected && rectsOverlap(game.player, game.key)) {
      game.key.collected = true;
      game.hasKey = true;
      game.score += 250;
      sparkle(game.key.x + 9, game.key.y + 13, "#b48dff", 12);
    }
  }

  function checkThreats() {
    if (game.hazards.some((hazard) => rectsOverlap(game.player, hazard))) {
      damagePlayer();
      return;
    }
    if (game.enemies.some((enemy) => enemy.active && rectsOverlap(game.player, enemy))) {
      damagePlayer();
    }
  }

  function checkExit() {
    if (game.exit && game.hasKey && rectsOverlap(game.player, game.exit)) {
      winGame();
    }
  }

  function updateCamera() {
    const target = game.player.x - canvas.width * 0.42;
    game.cameraX += (target - game.cameraX) * 0.12;
    game.cameraX = clamp(game.cameraX, 0, Math.max(0, game.width - canvas.width));
  }

  function update(delta) {
    if (game.mode !== "playing") {
      return;
    }
    game.time += delta;
    updatePlayer(delta);
    updateEnemies(delta);
    updatePulses(delta);
    updateParticles(delta);
    collectItems();
    checkThreats();
    checkExit();
    updateCamera();
    updateHud();
  }

  function startLoop() {
    if (!routeActive || animationFrame) {
      return;
    }
    lastTime = performance.now();
    animationFrame = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  }

  function loop(time) {
    animationFrame = 0;
    const delta = Math.min(0.033, (time - lastTime) / 1000 || 0);
    lastTime = time;
    update(delta);
    draw();
    if (routeActive) {
      animationFrame = requestAnimationFrame(loop);
    }
  }

  function drawBackground() {
    const sky = context.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, "#121a3d");
    sky.addColorStop(0.52, "#263876");
    sky.addColorStop(1, "#5d477e");
    context.fillStyle = sky;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "rgba(255, 255, 255, 0.72)";
    for (let index = 0; index < 54; index += 1) {
      const x = (index * 173 - game.cameraX * 0.18) % canvas.width;
      const y = 22 + ((index * 47) % 210);
      const size = index % 7 === 0 ? 3 : 2;
      context.fillRect((x + canvas.width) % canvas.width, y, size, size);
    }

    context.fillStyle = "#e9d77a";
    context.fillRect(760 - game.cameraX * 0.08, 58, 72, 72);
    context.fillStyle = "rgba(255, 255, 255, 0.18)";
    context.fillRect(780 - game.cameraX * 0.08, 74, 16, 16);
    context.fillRect(814 - game.cameraX * 0.08, 100, 10, 10);

    drawParallaxHills("#27375e", 0.24, 326, 84);
    drawParallaxHills("#1e2d48", 0.42, 378, 112);
  }

  function drawParallaxHills(color, speed, baseY, height) {
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(0, canvas.height);
    for (let x = -80; x <= canvas.width + 120; x += 120) {
      const worldX = x + (game.cameraX * speed) % 120;
      context.lineTo(worldX, baseY);
      context.lineTo(worldX + 60, baseY - height);
      context.lineTo(worldX + 120, baseY);
    }
    context.lineTo(canvas.width, canvas.height);
    context.closePath();
    context.fill();
  }

  function drawSolid(tile) {
    const x = tile.x;
    const y = tile.y;
    if (tile.type === "=") {
      context.fillStyle = "#f2b45f";
      context.fillRect(x, y, tileSize, 16);
      context.fillStyle = "#ffdc8f";
      context.fillRect(x + 2, y + 1, tileSize - 4, 4);
      context.fillStyle = "#9a5d3d";
      context.fillRect(x, y + 14, tileSize, 4);
      return;
    }

    context.fillStyle = "#704b86";
    context.fillRect(x, y, tileSize, tileSize);
    context.fillStyle = "#9b6fbb";
    context.fillRect(x + 2, y + 2, tileSize - 4, 6);
    context.fillStyle = "#4c355f";
    context.fillRect(x + 5, y + 18, 8, 5);
    context.fillRect(x + 22, y + 12, 5, 9);
  }

  function drawHazard(hazard) {
    context.fillStyle = "#f66b5b";
    context.beginPath();
    context.moveTo(hazard.x - 1, hazard.y + hazard.height);
    context.lineTo(hazard.x + hazard.width / 2, hazard.y);
    context.lineTo(hazard.x + hazard.width + 1, hazard.y + hazard.height);
    context.closePath();
    context.fill();
    context.fillStyle = "#ffd3c2";
    context.fillRect(hazard.x + hazard.width / 2 - 1, hazard.y + 8, 2, 9);
  }

  function drawCrystal(crystal) {
    if (crystal.collected) {
      return;
    }
    const bob = Math.sin(game.time * 5 + crystal.x * 0.02) * 3;
    const x = crystal.x;
    const y = crystal.y + bob;
    context.fillStyle = "#ffe88a";
    context.fillRect(x + 4, y, 6, 4);
    context.fillRect(x + 2, y + 4, 10, 6);
    context.fillRect(x + 5, y + 10, 4, 6);
    context.fillStyle = "#fff8c7";
    context.fillRect(x + 5, y + 3, 3, 3);
  }

  function drawKey() {
    if (!game.key || game.key.collected) {
      return;
    }
    const bob = Math.sin(game.time * 4) * 4;
    const x = game.key.x;
    const y = game.key.y + bob;
    context.fillStyle = "#b48dff";
    context.fillRect(x + 6, y, 6, 22);
    context.fillRect(x, y + 2, 18, 8);
    context.fillStyle = "#f3e8ff";
    context.fillRect(x + 3, y + 4, 5, 3);
    context.fillRect(x + 12, y + 16, 5, 4);
  }

  function drawExit() {
    if (!game.exit) {
      return;
    }
    const x = game.exit.x;
    const y = game.exit.y;
    context.fillStyle = game.hasKey ? "#5ce1c7" : "#556178";
    context.fillRect(x + 4, y + 8, 40, 72);
    context.fillStyle = "#18213f";
    context.fillRect(x + 12, y + 18, 24, 52);
    context.fillStyle = game.hasKey ? "rgba(92, 225, 199, 0.48)" : "rgba(255, 255, 255, 0.16)";
    context.fillRect(x + 16, y + 22, 16, 44);
    context.fillStyle = "#f2d16b";
    context.fillRect(x + 18, y, 12, 12);
  }

  function drawEnemy(enemy) {
    if (!enemy.active) {
      return;
    }
    if (enemy.kind === "drifter") {
      context.fillStyle = "#80e6ff";
      context.fillRect(enemy.x + 5, enemy.y + 7, 20, 14);
      context.fillStyle = "#d5fbff";
      context.fillRect(enemy.x + 9, enemy.y + 10, 5, 4);
      context.fillRect(enemy.x + 18, enemy.y + 10, 5, 4);
      context.fillStyle = "#35507d";
      context.fillRect(enemy.x, enemy.y + 12, 5, 5);
      context.fillRect(enemy.x + 25, enemy.y + 12, 5, 5);
      return;
    }

    context.fillStyle = "#78d45e";
    context.fillRect(enemy.x + 2, enemy.y + 8, 24, 14);
    context.fillStyle = "#b8f49d";
    context.fillRect(enemy.x + 7, enemy.y + 4, 14, 8);
    context.fillStyle = "#20283f";
    context.fillRect(enemy.x + (enemy.vx > 0 ? 19 : 7), enemy.y + 7, 3, 3);
    context.fillStyle = "#4a8e3d";
    context.fillRect(enemy.x + 5, enemy.y + 22, 7, 3);
    context.fillRect(enemy.x + 17, enemy.y + 22, 7, 3);
  }

  function drawPulse(pulse) {
    context.fillStyle = "#8ef0ff";
    context.fillRect(pulse.x, pulse.y, pulse.width, pulse.height);
    context.fillStyle = "#ffffff";
    context.fillRect(pulse.x + 2, pulse.y + 2, pulse.width - 4, 2);
  }

  function drawParticle(particle) {
    context.globalAlpha = clamp(particle.life * 2, 0, 1);
    context.fillStyle = particle.color;
    context.fillRect(particle.x, particle.y, 4, 4);
    context.globalAlpha = 1;
  }

  function drawPlayer() {
    const player = game.player;
    if (player.invulnerable > 0 && Math.floor(game.time * 18) % 2 === 0) {
      return;
    }
    const x = Math.round(player.x);
    const y = Math.round(player.y);
    const faceOffset = player.facing > 0 ? 11 : 4;

    context.fillStyle = "#ffcf6d";
    context.fillRect(x + 4, y + 2, 16, 16);
    context.fillStyle = "#f5f0cf";
    context.fillRect(x + faceOffset, y + 6, 8, 5);
    context.fillStyle = "#17202f";
    context.fillRect(x + faceOffset + (player.facing > 0 ? 5 : 0), y + 8, 2, 2);
    context.fillStyle = "#42d3c7";
    context.fillRect(x + 5, y + 18, 14, 18);
    context.fillStyle = "#2b8f8d";
    context.fillRect(x + 3, y + 22, 4, 12);
    context.fillRect(x + 18, y + 22, 4, 12);
    context.fillStyle = "#fb6f69";
    context.fillRect(x + 2, y + 36, 8, 6);
    context.fillRect(x + 14, y + 36, 8, 6);
    const pogoVisible = game.pogoActive || game.pogoSettleBounces > 0 || game.pogoPulse > 0;
    if (pogoVisible) {
      const springLength = 14 + Math.round((1 - game.pogoPulse) * 9);
      const footY = y + 33 + springLength;
      context.fillStyle = "#f3e8ff";
      context.fillRect(x + 11, y + 27, 3, springLength);
      context.fillStyle = "#b48dff";
      context.fillRect(x + 7, y + 34, 11, 3);
      context.fillRect(x + 8, footY - 4, 9, 3);
      context.fillStyle = "#17202f";
      context.fillRect(x + 5, footY, 15, 4);
    }
  }

  function drawWorld() {
    drawBackground();
    context.save();
    context.translate(-Math.round(game.cameraX), 0);

    const minX = game.cameraX - tileSize;
    const maxX = game.cameraX + canvas.width + tileSize;
    game.solids.forEach((solid) => {
      if (solid.x + solid.width >= minX && solid.x <= maxX) {
        drawSolid(solid);
      }
    });
    game.hazards.forEach((hazard) => {
      if (hazard.x + hazard.width >= minX && hazard.x <= maxX) {
        drawHazard(hazard);
      }
    });
    drawExit();
    game.crystals.forEach(drawCrystal);
    drawKey();
    game.enemies.forEach(drawEnemy);
    game.pulses.forEach(drawPulse);
    game.particles.forEach(drawParticle);
    drawPlayer();
    context.restore();
  }

  function draw() {
    context.imageSmoothingEnabled = false;
    drawWorld();
    updateHud();
  }

  function handleKeyboard(event, isDown) {
    if (!routes.get("starhopper").classList.contains("active-view")) {
      return;
    }
    const target = event.target;
    const isTextInput = target instanceof HTMLElement
      && (target.matches("input, textarea, select") || target.isContentEditable);
    if (isTextInput) {
      return;
    }
    const isNativeButtonKey = target instanceof HTMLElement
      && target.closest("button")
      && (event.key === " " || event.key === "Enter");
    if (isNativeButtonKey) {
      return;
    }

    const key = event.key.toLowerCase();
    if (event.key === "ArrowLeft" || key === "a") {
      event.preventDefault();
      controls.left = isDown;
    }
    if (event.key === "ArrowRight" || key === "d") {
      event.preventDefault();
      controls.right = isDown;
    }
    if (isDown && (event.key === "ArrowUp" || key === "w" || event.key === " ")) {
      event.preventDefault();
      jump();
    }
    if (isDown && key === "c" && !event.repeat) {
      event.preventDefault();
      togglePogo();
    }
    if (isDown && (key === "z" || key === "x" || key === "k")) {
      event.preventDefault();
      zap();
    }
    if (isDown && event.key === "Enter" && game.mode !== "playing") {
      event.preventDefault();
      start();
    }
    if (isDown && key === "r" && !event.repeat) {
      event.preventDefault();
      start();
    }
  }

  function activateStarControl(control) {
    if (control === "left" || control === "right") {
      controls[control] = true;
      window.setTimeout(() => {
        controls[control] = false;
      }, 120);
    }
    if (control === "jump") {
      jump();
    }
    if (control === "pogo") {
      togglePogo();
    }
    if (control === "zap") {
      zap();
    }
  }

  function bindTouchControls() {
    document.querySelectorAll("[data-star-control]").forEach((button) => {
      const control = button.dataset.starControl;
      let ignoreClickUntil = 0;

      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        ignoreClickUntil = performance.now() + 450;
        if (control === "left" || control === "right") {
          controls[control] = true;
          return;
        }
        activateStarControl(control);
      });
      const release = () => {
        if (control === "left" || control === "right") {
          controls[control] = false;
        }
      };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", release);
      button.addEventListener("lostpointercapture", release);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        if (performance.now() < ignoreClickUntil) {
          return;
        }
        activateStarControl(control);
      });
    });
  }

  actionButton.addEventListener("click", start);
  restartButton.addEventListener("click", start);
  document.addEventListener("keydown", (event) => handleKeyboard(event, true));
  document.addEventListener("keyup", (event) => handleKeyboard(event, false));
  bindTouchControls();
  setShortcutLabel(restartButton, "Restart", "R", "Restart Star Hopper");
  updatePogoButton();
  showOverlay("Star Hopper", "Level 1: Crater Run", "Start");
  updateHud();
  draw();

  return {
    draw,
    setRouteActive(isActive) {
      routeActive = isActive;
      if (routeActive) {
        draw();
        startLoop();
      } else {
        stopLoop();
        controls.left = false;
        controls.right = false;
      }
    }
  };
})();

const tetris = (() => {
  const boardCanvas = document.querySelector("#tetris-board");
  const nextCanvas = document.querySelector("#next-board");
  const fullscreenNextCanvas = document.querySelector("#fullscreen-next-board");
  const boardContext = boardCanvas.getContext("2d");
  const nextContext = nextCanvas.getContext("2d");
  const fullscreenNextContext = fullscreenNextCanvas.getContext("2d");
  const overlay = document.querySelector("#game-overlay");
  const scoreValue = document.querySelector("#score-value");
  const linesValue = document.querySelector("#lines-value");
  const levelValue = document.querySelector("#level-value");
  const fullscreenScoreValue = document.querySelector("#fullscreen-score-value");
  const fullscreenLinesValue = document.querySelector("#fullscreen-lines-value");
  const fullscreenLevelValue = document.querySelector("#fullscreen-level-value");
  const gameActionButton = document.querySelector("#game-action-button");
  const fullscreenActionButton = document.querySelector("#fullscreen-action-button");
  const fullscreenToggleButton = document.querySelector("#fullscreen-toggle-button");
  const actionButtons = [gameActionButton, fullscreenActionButton];
  const gameView = document.querySelector("#blocks-view");
  const gameStage = document.querySelector("#blocks-view .game-stage");
  const finalScorePanel = document.querySelector("#final-score-panel");
  const finalScoreValue = document.querySelector("#final-score-value");
  const scoreForm = document.querySelector("#score-form");
  const playerNameInput = document.querySelector("#player-name-input");
  const leaderboardList = document.querySelector("#leaderboard-list");
  const leaderboardEmpty = document.querySelector("#leaderboard-empty");
  const clearScoresButton = document.querySelector("#clear-scores-button");
  const leaderboardKey = "ericensen-block-stack-leaderboard-v1";
  const playerNameKey = "ericensen-block-stack-player-name-v1";
  const width = 10;
  const height = 20;
  const cell = 30;
  const colors = {
    I: "#2f8f83",
    J: "#31588f",
    L: "#d7564a",
    O: "#e2a82e",
    S: "#6f8a43",
    T: "#8c5fbf",
    Z: "#b6425b"
  };
  const shapes = {
    I: [[1, 1, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]],
    O: [[1, 1], [1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    T: [[0, 1, 0], [1, 1, 1]],
    Z: [[1, 1, 0], [0, 1, 1]]
  };
  let board = createBoard();
  let piece = null;
  let nextPiece = createPiece();
  let score = 0;
  let lines = 0;
  let level = 1;
  let dropCounter = 0;
  let lastTime = 0;
  let animationFrame = 0;
  let running = false;
  let paused = false;
  let gameOver = false;
  let routeActive = false;
  let scoreSaved = false;

  function createBoard() {
    return Array.from({ length: height }, () => Array(width).fill(""));
  }

  function createPiece() {
    const keys = Object.keys(shapes);
    const type = keys[Math.floor(Math.random() * keys.length)];
    return {
      type,
      shape: shapes[type].map((row) => [...row]),
      x: Math.floor(width / 2) - 1,
      y: 0
    };
  }

  function updatePlayingClass() {
    const fullscreenActive = document.fullscreenElement === gameView;
    document.body.classList.toggle("blocks-playing", routeActive && running && !gameOver);
    document.body.classList.toggle("blocks-fullscreen-active", fullscreenActive);
    gameView.classList.toggle("fullscreen-active", fullscreenActive);
    updateActionButtons();
    updateFullscreenToggle();
  }

  function setRouteActive(isActive) {
    routeActive = isActive;
    updatePlayingClass();
  }

  function updateActionButtons() {
    const label = !running || gameOver ? "Start" : paused ? "Resume" : "Pause";
    const ariaLabel = label === "Start" ? "Start game" : `${label} game`;
    const shortcut = label === "Start" ? "Enter" : "P / Enter";
    actionButtons.forEach((button) => {
      setShortcutLabel(button, label, shortcut, ariaLabel);
    });
  }

  function updateFullscreenToggle() {
    const fullscreenActive = document.fullscreenElement === gameView;
    const label = fullscreenActive ? "Exit" : "Full";
    const ariaLabel = fullscreenActive ? "Exit fullscreen" : "Enter fullscreen";
    setShortcutLabel(fullscreenToggleButton, label, "F", ariaLabel);
    fullscreenToggleButton.title = `${ariaLabel} (F)`;
  }

  function loadLeaderboard() {
    try {
      const saved = JSON.parse(localStorage.getItem(leaderboardKey) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  function saveLeaderboard(scores) {
    localStorage.setItem(leaderboardKey, JSON.stringify(scores.slice(0, 12)));
  }

  function formatScoreDate(value) {
    return new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function renderLeaderboard() {
    const scores = loadLeaderboard().sort((left, right) => right.score - left.score).slice(0, 10);
    leaderboardList.innerHTML = "";
    leaderboardEmpty.hidden = scores.length > 0;
    clearScoresButton.disabled = scores.length === 0;

    scores.forEach((entry, index) => {
      const item = document.createElement("li");
      item.innerHTML = `
        <span class="score-rank">${index + 1}</span>
        <span class="score-player">${escapeHtml(entry.name)}</span>
        <span class="score-date">${formatScoreDate(entry.date)}</span>
        <strong>${entry.score}</strong>
      `;
      leaderboardList.append(item);
    });
  }

  function saveScore(name) {
    if (scoreSaved || score <= 0) {
      return;
    }

    const playerName = normalizeName(name) || "Player";
    const scores = loadLeaderboard();
    scores.push({
      name: playerName,
      date: new Date().toISOString(),
      score,
      lines,
      level
    });
    scores.sort((left, right) => right.score - left.score);
    saveLeaderboard(scores);
    localStorage.setItem(playerNameKey, playerName);
    scoreSaved = true;
    finalScorePanel.hidden = true;
    renderLeaderboard();
  }

  function showFinalScore() {
    finalScoreValue.textContent = score;
    finalScorePanel.hidden = score <= 0 || scoreSaved;
    if (!finalScorePanel.hidden) {
      playerNameInput.value = localStorage.getItem(playerNameKey) || "";
      window.setTimeout(() => playerNameInput.focus(), 50);
    }
  }

  function finishGame() {
    running = false;
    gameOver = true;
    updatePlayingClass();
    overlay.hidden = false;
    overlay.querySelector("strong").textContent = "Game Over";
    overlay.querySelector("span").textContent = "Start again";
    updateActionButtons();
    showFinalScore();
  }

  function enterFullscreen() {
    if (document.fullscreenElement || !gameView.requestFullscreen) {
      document.body.classList.toggle("blocks-fullscreen-unavailable", !gameView.requestFullscreen);
      return;
    }

    gameView.requestFullscreen({ navigationUI: "hide" }).then(() => {
      document.body.classList.remove("blocks-fullscreen-unavailable");
      screen.orientation?.lock?.("portrait").catch(() => {});
    }).catch(() => {
      document.body.classList.add("blocks-fullscreen-unavailable");
    });
  }

  function exitFullscreen() {
    if (document.fullscreenElement === gameView && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement === gameView) {
      exitFullscreen();
      return;
    }
    enterFullscreen();
  }

  function rotate(shape) {
    return shape[0].map((_, column) => shape.map((row) => row[column]).reverse());
  }

  function collides(testPiece = piece) {
    return testPiece.shape.some((row, y) =>
      row.some((value, x) => {
        if (!value) {
          return false;
        }
        const boardX = testPiece.x + x;
        const boardY = testPiece.y + y;
        return boardX < 0 || boardX >= width || boardY >= height || Boolean(board[boardY]?.[boardX]);
      })
    );
  }

  function merge() {
    piece.shape.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value) {
          board[piece.y + y][piece.x + x] = piece.type;
        }
      });
    });
  }

  function clearLines() {
    let cleared = 0;
    board = board.filter((row) => {
      if (row.every(Boolean)) {
        cleared += 1;
        return false;
      }
      return true;
    });

    while (board.length < height) {
      board.unshift(Array(width).fill(""));
    }

    if (cleared) {
      lines += cleared;
      score += [0, 100, 300, 500, 800][cleared] * level;
      level = Math.floor(lines / 8) + 1;
      updateScore();
    }
  }

  function spawn() {
    piece = nextPiece;
    piece.x = Math.floor(width / 2) - Math.ceil(piece.shape[0].length / 2);
    piece.y = 0;
    nextPiece = createPiece();
    drawNext();

    if (collides(piece)) {
      finishGame();
    }
  }

  function drop() {
    if (!piece || paused || !running) {
      return;
    }

    piece.y += 1;
    if (collides()) {
      piece.y -= 1;
      merge();
      clearLines();
      spawn();
    }
    dropCounter = 0;
  }

  function hardDrop() {
    if (!running || paused || !piece) {
      return;
    }
    while (!collides({ ...piece, y: piece.y + 1 })) {
      piece.y += 1;
      score += 2;
    }
    drop();
    updateScore();
  }

  function move(direction) {
    if (!running || paused || !piece) {
      return;
    }
    piece.x += direction;
    if (collides()) {
      piece.x -= direction;
    }
    draw();
  }

  function turn() {
    if (!running || paused || !piece) {
      return;
    }
    const currentShape = piece.shape;
    piece.shape = rotate(piece.shape);
    if (collides()) {
      piece.x += piece.x < width / 2 ? 1 : -1;
      if (collides()) {
        piece.shape = currentShape;
      }
    }
    draw();
  }

  function update(time = 0) {
    if (!running) {
      draw();
      return;
    }

    const delta = time - lastTime;
    lastTime = time;
    if (!paused) {
      dropCounter += delta;
      if (dropCounter > Math.max(120, 760 - level * 55)) {
        drop();
      }
    }
    draw();
    animationFrame = requestAnimationFrame(update);
  }

  function drawCell(context, x, y, type, size = cell) {
    context.fillStyle = colors[type] || "#24324a";
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    context.fillStyle = "rgba(255, 255, 255, 0.2)";
    context.fillRect(x * size + 4, y * size + 4, size - 8, 4);
  }

  function draw() {
    boardContext.fillStyle = "#111827";
    boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    boardContext.strokeStyle = "rgba(255,255,255,0.06)";
    boardContext.lineWidth = 1;
    for (let x = 0; x <= width; x += 1) {
      boardContext.beginPath();
      boardContext.moveTo(x * cell, 0);
      boardContext.lineTo(x * cell, boardCanvas.height);
      boardContext.stroke();
    }
    for (let y = 0; y <= height; y += 1) {
      boardContext.beginPath();
      boardContext.moveTo(0, y * cell);
      boardContext.lineTo(boardCanvas.width, y * cell);
      boardContext.stroke();
    }
    board.forEach((row, y) => {
      row.forEach((type, x) => {
        if (type) {
          drawCell(boardContext, x, y, type);
        }
      });
    });
    if (piece) {
      piece.shape.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value) {
            drawCell(boardContext, piece.x + x, piece.y + y, piece.type);
          }
        });
      });
    }
  }

  function drawNextPreview(context, canvas, size) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#f8f4ea";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const offsetX = Math.floor((5 - nextPiece.shape[0].length) / 2);
    const offsetY = Math.floor((5 - nextPiece.shape.length) / 2);
    nextPiece.shape.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value) {
          drawCell(context, x + offsetX, y + offsetY, nextPiece.type, size);
        }
      });
    });
  }

  function drawNext() {
    drawNextPreview(nextContext, nextCanvas, 24);
    drawNextPreview(fullscreenNextContext, fullscreenNextCanvas, 16);
  }

  function updateScore() {
    scoreValue.textContent = score;
    linesValue.textContent = lines;
    levelValue.textContent = level;
    fullscreenScoreValue.textContent = score;
    fullscreenLinesValue.textContent = lines;
    fullscreenLevelValue.textContent = level;
  }

  function start() {
    enterFullscreen();
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }
    board = createBoard();
    score = 0;
    lines = 0;
    level = 1;
    nextPiece = createPiece();
    running = true;
    paused = false;
    gameOver = false;
    scoreSaved = false;
    updatePlayingClass();
    overlay.hidden = true;
    finalScorePanel.hidden = true;
    updateActionButtons();
    updateScore();
    spawn();
    lastTime = 0;
    animationFrame = requestAnimationFrame(update);
    boardCanvas.focus({ preventScroll: true });
  }

  function togglePause() {
    if (!running || gameOver) {
      return;
    }
    paused = !paused;
    overlay.hidden = !paused;
    overlay.querySelector("strong").textContent = "Paused";
    overlay.querySelector("span").textContent = "Press Pause";
    updatePlayingClass();
  }

  function handleGameAction() {
    if (!running || gameOver) {
      start();
      return;
    }
    togglePause();
  }

  function bindGameControl(selector, action, options = {}) {
    const button = document.querySelector(selector);
    let repeatDelay = 0;
    let repeatInterval = 0;
    let ignoreClickUntil = 0;

    const stopRepeat = () => {
      window.clearTimeout(repeatDelay);
      window.clearInterval(repeatInterval);
      repeatDelay = 0;
      repeatInterval = 0;
    };

    button.addEventListener("pointerdown", (event) => {
      if (button.disabled) {
        return;
      }
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      ignoreClickUntil = performance.now() + 450;
      action();

      if (options.repeat) {
        repeatDelay = window.setTimeout(() => {
          repeatInterval = window.setInterval(action, options.interval ?? 85);
        }, options.delay ?? 210);
      }
    });

    button.addEventListener("pointerup", stopRepeat);
    button.addEventListener("pointercancel", stopRepeat);
    button.addEventListener("pointerleave", stopRepeat);
    button.addEventListener("lostpointercapture", stopRepeat);
    button.addEventListener("click", (event) => {
      if (performance.now() < ignoreClickUntil) {
        event.preventDefault();
        return;
      }
      action();
    });
  }

  function setupBoardGestures() {
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let didGesture = false;

    gameStage.addEventListener("pointerdown", (event) => {
      if (!running || paused || (event.target !== boardCanvas && event.target !== gameStage)) {
        return;
      }
      event.preventDefault();
      gameStage.setPointerCapture?.(event.pointerId);
      startX = event.clientX;
      startY = event.clientY;
      lastX = event.clientX;
      didGesture = false;
    });

    gameStage.addEventListener("pointermove", (event) => {
      if (!running || paused || (event.target !== boardCanvas && event.target !== gameStage)) {
        return;
      }
      event.preventDefault();
      const totalX = event.clientX - startX;
      const totalY = event.clientY - startY;
      const stepX = event.clientX - lastX;

      if (Math.abs(totalY) > 34 && Math.abs(totalY) > Math.abs(totalX) * 1.1) {
        didGesture = true;
        return;
      }

      if (Math.abs(stepX) > 30 && Math.abs(totalX) > 24) {
        didGesture = true;
        move(Math.sign(stepX));
        lastX = event.clientX;
      }
    });

    gameStage.addEventListener("pointerup", (event) => {
      if (!running || paused) {
        return;
      }
      event.preventDefault();
      if (!didGesture) {
        turn();
      }
    });

    gameStage.addEventListener("pointercancel", () => {
      didGesture = false;
    });
  }

  gameActionButton.addEventListener("click", handleGameAction);
  fullscreenActionButton.addEventListener("click", handleGameAction);
  fullscreenToggleButton.addEventListener("click", toggleFullscreen);
  bindGameControl("#move-left", () => move(-1), { repeat: true });
  bindGameControl("#move-right", () => move(1), { repeat: true });
  bindGameControl("#rotate-piece", turn);
  bindGameControl("#drop-piece", drop, { repeat: true, delay: 170, interval: 70 });
  bindGameControl("#hard-drop-piece", hardDrop);
  bindGameControl("#fullscreen-drop-piece", drop, { repeat: true, delay: 170, interval: 70 });
  bindGameControl("#fullscreen-hard-drop-piece", hardDrop);
  setupBoardGestures();
  scoreForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveScore(playerNameInput.value);
  });
  clearScoresButton.addEventListener("click", () => {
    if (!loadLeaderboard().length || !window.confirm("Clear the Blocks leaderboard?")) {
      return;
    }
    saveLeaderboard([]);
    renderLeaderboard();
  });
  document.addEventListener("fullscreenchange", updatePlayingClass);
  document.addEventListener("keydown", (event) => {
    if (!routes.get("blocks").classList.contains("active-view")) {
      return;
    }
    const target = event.target;
    const isTextInput = target instanceof HTMLElement
      && (target.matches("input, textarea, select") || target.isContentEditable);

    if (isTextInput) {
      return;
    }
    const isNativeButtonKey = target instanceof HTMLElement
      && target.closest("button")
      && (event.key === " " || event.key === "Enter");
    if (isNativeButtonKey) {
      return;
    }

    const key = event.key.toLocaleLowerCase();

    if (key === "f") {
      event.preventDefault();
      toggleFullscreen();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      handleGameAction();
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      drop();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      turn();
    }
    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      hardDrop();
    }
    if (key === "p") {
      event.preventDefault();
      togglePause();
    }
  });

  drawNext();
  draw();
  renderLeaderboard();

  return { draw, setRouteActive };
})();

renderAppGrid();
setupRouter();
setupCollapsibleTiles();
setupNameHat();
setupHubCanvas();
