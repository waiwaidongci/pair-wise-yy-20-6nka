const storageKey = "wxyy-4-luogujing-grid";
const instruments = [
  { name: "大锣", token: "仓", freq: 180 },
  { name: "鼓", token: "冬", freq: 120 },
  { name: "钹", token: "才", freq: 360 },
  { name: "小锣", token: "台", freq: 520 }
];
const steps = 16;
const measures = steps / 4;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normalizePhrase(input) {
  let startMeasure = clamp(Number.parseInt(input.startMeasure, 10) || 1, 1, measures);
  let endMeasure = clamp(Number.parseInt(input.endMeasure, 10) || startMeasure, 1, measures);
  if (endMeasure < startMeasure) [startMeasure, endMeasure] = [endMeasure, startMeasure];
  return {
    id: input.id || crypto.randomUUID(),
    name: String(input.name || "").trim() || "未命名乐句",
    startMeasure,
    endMeasure,
    repeats: clamp(Number.parseInt(input.repeats, 10) || 1, 1, 99)
  };
}

function escapeHtml(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(text).replace(/[&<>"']/g, (ch) => map[ch]);
}

function defaultState() {
  return {
    pieceName: "出场锣鼓-慢起",
    bpm: 96,
    queue: [],
    notes: [],
    pattern: instruments.map((instrument) => Array.from({ length: steps }, (_, index) => index % 4 === 0 ? instrument.token : "")),
    saved: []
  };
}

const state = JSON.parse(localStorage.getItem(storageKey) || "null") || defaultState();
state.queue = Array.isArray(state.queue) ? state.queue.map(normalizePhrase) : [];
state.saved = Array.isArray(state.saved) ? state.saved : [];
// 兼容历史/残缺数据：保证网格为 instruments × steps
if (!Array.isArray(state.pattern) || state.pattern.length !== instruments.length ||
    state.pattern.some((row) => !Array.isArray(row) || row.length !== steps)) {
  state.pattern = defaultState().pattern;
}

let timer = null;
let started = false;
let playhead = 0;          // 下一个待发音的拍点
let currentStep = 0;       // 最近一次响的拍点（暂停时停住的位置）
let queueIndex = state.queue.length ? 0 : -1;
let activePhraseId = state.queue.length ? state.queue[0].id : null;
let repeatsLeft = state.queue.length ? state.queue[0].repeats : 1;
let rangeKey = "";
let audioContext = null;

const grid = document.querySelector("#grid");
const savedList = document.querySelector("#savedList");
const structure = document.querySelector("#structure");
const notesList = document.querySelector("#notesList");
const pieceName = document.querySelector("#pieceName");
const bpmInput = document.querySelector("#bpmInput");
const noteInput = document.querySelector("#noteInput");
const playBtn = document.querySelector("#playBtn");
const stopBtn = document.querySelector("#stopBtn");
const queueList = document.querySelector("#queueList");
const phraseForm = document.querySelector("#phraseForm");
const phraseName = document.querySelector("#phraseName");
const phraseStart = document.querySelector("#phraseStart");
const phraseEnd = document.querySelector("#phraseEnd");
const phraseRepeats = document.querySelector("#phraseRepeats");
const nowPlaying = document.querySelector("#nowPlaying");

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function syncFields() {
  pieceName.value = state.pieceName;
  bpmInput.value = state.bpm;
}

function beatLabel(index) {
  const measure = Math.floor(index / 4) + 1;
  const beat = (index % 4) + 1;
  return `${measure}-${beat}`;
}

function phraseRange(phrase) {
  return [(phrase.startMeasure - 1) * 4, phrase.endMeasure * 4 - 1];
}

function renderGrid() {
  const header = ['<div class="label-cell">乐器</div>'];
  for (let i = 0; i < steps; i += 1) {
    header.push(`<div class="beat-cell">${beatLabel(i)}</div>`);
  }

  const rows = instruments.flatMap((instrument, rowIndex) => {
    const row = [`<div class="label-cell">${instrument.name}</div>`];
    for (let step = 0; step < steps; step += 1) {
      const value = state.pattern[rowIndex][step];
      row.push(`<button class="cell ${value ? "filled" : ""}" type="button" data-row="${rowIndex}" data-step="${step}">${value}</button>`);
    }
    return row;
  });

  grid.innerHTML = [...header, ...rows].join("");
  rangeKey = "";
}

function renderQueue() {
  if (!state.queue.length) {
    queueList.innerHTML = '<p class="empty-hint">队列为空，当前按全段 4 小节循环播放。</p>';
  } else {
    queueList.innerHTML = state.queue.map((phrase, index) => `
      <div class="queue-item" data-qid="${phrase.id}">
        <span class="q-order">${index + 1}</span>
        <div class="q-meta">
          <strong>${escapeHtml(phrase.name)}</strong>
          <span>第${phrase.startMeasure}–${phrase.endMeasure}小节 · 重复${phrase.repeats}遍</span>
        </div>
        <span class="q-badge"></span>
        <div class="q-actions">
          <button type="button" data-action="up" title="前移一句" ${index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" data-action="down" title="后移一句" ${index === state.queue.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" data-action="remove" title="移出队列">移除</button>
        </div>
      </div>
    `).join("");
  }
  updatePlaybackUI();
}

function renderSidebars() {
  const filledByMeasure = [0, 1, 2, 3].map((measure) => {
    const start = measure * 4;
    const count = state.pattern.flatMap((row) => row.slice(start, start + 4)).filter(Boolean).length;
    return { measure: measure + 1, count };
  });
  structure.innerHTML = filledByMeasure.map((item) => `
    <div class="structure-row"><span>第${item.measure}小节</span><strong>${item.count}个口令</strong></div>
  `).join("");

  notesList.innerHTML = state.notes.length ? state.notes.map((note) => `
    <article class="note"><p>${escapeHtml(note)}</p></article>
  `).join("") : "<p>暂无批注。</p>";

  savedList.innerHTML = state.saved.length ? state.saved.map((item) => `
    <button class="saved-item" type="button" data-load="${item.id}">
      <strong>${escapeHtml(item.name)}</strong><br><span>${item.bpm}BPM · ${(item.queue || []).length}个乐句 · ${item.notes.length}条批注</span>
    </button>
  `).join("") : "<p>还没有保存方案。</p>";
}

function render() {
  syncFields();
  renderGrid();
  renderSidebars();
  renderQueue();
}

function playSound(instrument) {
  audioContext ||= new AudioContext();
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.frequency.value = instrument.freq;
  osc.type = instrument.name === "鼓" ? "sine" : "square";
  gain.gain.setValueAtTime(0.08, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
  osc.connect(gain).connect(audioContext.destination);
  osc.start();
  osc.stop(audioContext.currentTime + 0.09);
}

function highlight(step) {
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
  document.querySelectorAll(`[data-step="${step}"]`).forEach((cell) => cell.classList.add("playing"));
}

function updateInRange(phrase) {
  const key = phrase ? phrase.id : "";
  if (key === rangeKey) return;
  rangeKey = key;
  document.querySelectorAll(".cell.in-range").forEach((cell) => cell.classList.remove("in-range"));
  if (!phrase) return;
  const [start, end] = phraseRange(phrase);
  for (let step = start; step <= end; step += 1) {
    document.querySelectorAll(`[data-step="${step}"]`).forEach((cell) => cell.classList.add("in-range"));
  }
}

function updateTransport() {
  if (timer) playBtn.textContent = "暂停";
  else if (started) playBtn.textContent = "继续";
  else playBtn.textContent = "播放";
}

function updatePlaybackUI() {
  const phrase = started && state.queue.length && queueIndex >= 0 ? state.queue[queueIndex] : null;
  const paused = started && !timer;
  const pass = phrase ? phrase.repeats - repeatsLeft + 1 : 0;

  document.querySelectorAll(".queue-item").forEach((el) => {
    const isCurrent = phrase && el.dataset.qid === phrase.id;
    el.classList.toggle("current", !!isCurrent);
    el.classList.toggle("paused", !!isCurrent && paused);
    const badge = el.querySelector(".q-badge");
    if (badge) badge.textContent = isCurrent ? `${paused ? "暂停中" : "演奏中"} ${pass}/${phrase.repeats}遍` : "";
  });

  updateInRange(phrase);

  if (phrase) {
    nowPlaying.textContent = `当前乐句：${phrase.name} · 第${pass}/${phrase.repeats}遍 · 拍点${beatLabel(currentStep)}`
      + (paused ? "（已暂停，空格从该拍点继续）" : "");
  } else if (started) {
    nowPlaying.textContent = (paused ? "已暂停 · " : "") + `全段循环播放 · 拍点${beatLabel(currentStep)}`;
  } else if (state.queue.length) {
    nowPlaying.textContent = `队列就绪：${state.queue.length}个乐句，从「${state.queue[0].name}」开始；空格播放，播放中可暂停续拍`;
  } else {
    nowPlaying.textContent = "队列为空，按全段 4 小节循环播放；空格播放 / 暂停 / 继续";
  }
  nowPlaying.classList.toggle("is-paused", paused);
  updateTransport();
}

function setupPhrase(index) {
  queueIndex = index;
  const phrase = state.queue[index];
  activePhraseId = phrase.id;
  repeatsLeft = phrase.repeats;
  playhead = (phrase.startMeasure - 1) * 4;
}

// 队列在播放中被增删/移动后，把播放位置校正到仍然有效的乐句上，不打断计时
function reconcilePlayback() {
  if (!started) return;
  if (!state.queue.length) {
    queueIndex = -1;
    activePhraseId = null;
    playhead = clamp(playhead, 0, steps - 1);
    return;
  }
  let index = state.queue.findIndex((phrase) => phrase.id === activePhraseId);
  if (index === -1) index = clamp(queueIndex, 0, state.queue.length - 1);
  queueIndex = index;
  const phrase = state.queue[index];
  activePhraseId = phrase.id;
  const [start, end] = phraseRange(phrase);
  if (playhead < start || playhead > end) playhead = start;
  repeatsLeft = clamp(repeatsLeft || 1, 1, phrase.repeats);
}

function tick() {
  let phrase = null;
  if (state.queue.length) {
    if (queueIndex < 0 || queueIndex >= state.queue.length) setupPhrase(0);
    phrase = state.queue[queueIndex];
  }

  currentStep = playhead;
  highlight(playhead);
  instruments.forEach((instrument, rowIndex) => {
    if (state.pattern[rowIndex][playhead]) playSound(instrument);
  });

  if (phrase) {
    const end = phrase.endMeasure * 4 - 1;
    if (playhead >= end) {
      repeatsLeft -= 1;
      if (repeatsLeft > 0) {
        playhead = (phrase.startMeasure - 1) * 4;
      } else {
        // 当前句放完，立刻接下一句；末句结束回到队首
        setupPhrase((queueIndex + 1) % state.queue.length);
      }
    } else {
      playhead += 1;
    }
  } else {
    playhead = playhead >= steps - 1 ? 0 : playhead + 1;
  }
  updatePlaybackUI();
}

function startPlayback() {
  started = true;
  if (state.queue.length) {
    setupPhrase(0);
  } else {
    queueIndex = -1;
    activePhraseId = null;
    playhead = 0;
  }
  currentStep = playhead;
  clearInterval(timer);
  timer = setInterval(tick, 60000 / state.bpm);
  tick();
  updatePlaybackUI();
}

function pausePlayback() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  updatePlaybackUI();
}

function resumePlayback() {
  if (timer) return;
  if (!started) {
    startPlayback();
    return;
  }
  // playhead 已停在下一拍上，直接续走，不能跳回句首
  timer = setInterval(tick, 60000 / state.bpm);
  updatePlaybackUI();
}

function togglePlayback() {
  if (timer) pausePlayback();
  else if (started) resumePlayback();
  else startPlayback();
}

function stopPlayback() {
  clearInterval(timer);
  timer = null;
  started = false;
  activePhraseId = state.queue.length ? state.queue[0].id : null;
  queueIndex = state.queue.length ? 0 : -1;
  repeatsLeft = state.queue.length ? state.queue[0].repeats : 1;
  playhead = 0;
  currentStep = 0;
  rangeKey = "";
  document.querySelectorAll(".cell.playing, .cell.in-range").forEach((cell) => {
    cell.classList.remove("playing");
    cell.classList.remove("in-range");
  });
  updatePlaybackUI();
}

grid.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  const row = Number(cell.dataset.row);
  const step = Number(cell.dataset.step);
  state.pattern[row][step] = state.pattern[row][step] ? "" : instruments[row].token;
  save();
  renderGrid();
  updatePlaybackUI();
});

pieceName.addEventListener("input", () => {
  state.pieceName = pieceName.value;
  save();
});

bpmInput.addEventListener("input", () => {
  state.bpm = Number(bpmInput.value || 96);
  save();
  if (timer) {
    clearInterval(timer);
    timer = setInterval(tick, 60000 / state.bpm);
  }
});

noteInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !noteInput.value.trim()) return;
  state.notes.unshift(noteInput.value.trim());
  noteInput.value = "";
  save();
  renderSidebars();
});

phraseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.queue.push(normalizePhrase({
    name: phraseName.value,
    startMeasure: phraseStart.value,
    endMeasure: phraseEnd.value,
    repeats: phraseRepeats.value
  }));
  phraseName.value = "";
  phraseRepeats.value = 2;
  save();
  renderQueue();
  reconcilePlayback();
  updatePlaybackUI();
});

queueList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  const item = event.target.closest(".queue-item");
  if (!button || !item) return;
  const index = state.queue.findIndex((phrase) => phrase.id === item.dataset.qid);
  if (index < 0) return;
  const { action } = button.dataset;
  if (action === "remove") {
    state.queue.splice(index, 1);
  } else if (action === "up" && index > 0) {
    [state.queue[index - 1], state.queue[index]] = [state.queue[index], state.queue[index - 1]];
  } else if (action === "down" && index < state.queue.length - 1) {
    [state.queue[index + 1], state.queue[index]] = [state.queue[index], state.queue[index + 1]];
  }
  save();
  renderQueue();
  reconcilePlayback();
  updatePlaybackUI();
});

playBtn.addEventListener("click", togglePlayback);
stopBtn.addEventListener("click", stopPlayback);

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;
  if (event.code !== "Space" || typing) return;
  event.preventDefault();
  togglePlayback();
});

document.querySelector("#saveBtn").addEventListener("click", () => {
  state.saved.unshift({
    id: crypto.randomUUID(),
    name: state.pieceName || "未命名片段",
    bpm: state.bpm,
    queue: state.queue.map((phrase) => ({ ...phrase })),
    notes: [...state.notes],
    pattern: state.pattern.map((row) => [...row]),
    createdAt: new Date().toISOString()
  });
  save();
  renderSidebars();
});

savedList.addEventListener("click", (event) => {
  const id = event.target.closest("[data-load]")?.dataset.load;
  const item = state.saved.find((entry) => entry.id === id);
  if (!item) return;
  stopPlayback();
  state.pieceName = item.name;
  state.bpm = item.bpm;
  state.queue = Array.isArray(item.queue) ? item.queue.map(normalizePhrase) : [];
  state.notes = [...item.notes];
  state.pattern = Array.isArray(item.pattern) && item.pattern.length === instruments.length &&
    item.pattern.every((row) => Array.isArray(row) && row.length === steps)
    ? item.pattern.map((row) => [...row])
    : defaultState().pattern;
  save();
  render();
});

render();
