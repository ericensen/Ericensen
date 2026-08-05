import {
  dedupeNames,
  normalizeName,
  parseNamesFromSpeech,
  parseNamesFromText
} from "./lib/nameParser.mjs";
import { mergeDrawQueue, shuffleNames } from "./lib/drawOrder.mjs";

const routes = new Map([
  ["home", document.querySelector("#home-view")],
  ["namehat", document.querySelector("#namehat-view")],
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

  if (activeRoute === "blocks") {
    tetris.draw();
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
    actionButtons.forEach((button) => {
      button.textContent = label;
      button.setAttribute("aria-label", ariaLabel);
    });
  }

  function updateFullscreenToggle() {
    const fullscreenActive = document.fullscreenElement === gameView;
    fullscreenToggleButton.textContent = fullscreenActive ? "×" : "⛶";
    fullscreenToggleButton.setAttribute(
      "aria-label",
      fullscreenActive ? "Exit fullscreen" : "Enter fullscreen"
    );
    fullscreenToggleButton.title = fullscreenActive ? "Exit fullscreen" : "Enter fullscreen";
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
    if (event.key.toLocaleLowerCase() === "p") togglePause();
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
