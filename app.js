const storageKey = "wxyy-4-luogujing-grid";
const instruments = [
  { name: "大锣", token: "仓", freq: 180 },
  { name: "鼓", token: "冬", freq: 120 },
  { name: "钹", token: "才", freq: 360 },
  { name: "小锣", token: "台", freq: 520 }
];
const steps = 16;
const beatsPerMeasure = 4;

function normalizePhrase(phrase) {
  const repeats = Math.max(1, Number(phrase.repeats) || 1);
  const startMeasure = Math.min(4, Math.max(1, Number(phrase.startMeasure) || 1));
  const endMeasure = Math.min(4, Math.max(startMeasure, Number(phrase.endMeasure) || startMeasure));
  return {
    id: phrase.id || crypto.randomUUID(),
    name: phrase.name || "未命名乐句",
    startMeasure,
    endMeasure,
    repeats
  };
}

const state = JSON.parse(localStorage.getItem(storageKey) || "null") || {
  pieceName: "出场锣鼓-慢起",
  bpm: 96,
  notes: [],
  pattern: instruments.map((instrument) => Array.from({ length: steps }, (_, index) => index % 4 === 0 ? instrument.token : "")),
  saved: []
};
state.queue = Array.isArray(state.queue) ? state.queue.map(normalizePhrase) : [];

let timer = null;
let paused = false;
let playhead = 0;
let queueIndex = 0;
let repeatRound = 0;
let audioContext = null;

const grid = document.querySelector("#grid");
const savedList = document.querySelector("#savedList");
const structure = document.querySelector("#structure");
const notesList = document.querySelector("#notesList");
const pieceName = document.querySelector("#pieceName");
const bpmInput = document.querySelector("#bpmInput");
const noteInput = document.querySelector("#noteInput");

const phraseForm = document.querySelector("#phraseForm");
const phraseName = document.querySelector("#phraseName");
const phraseStart = document.querySelector("#phraseStart");
const phraseEnd = document.querySelector("#phraseEnd");
const phraseRepeats = document.querySelector("#phraseRepeats");
const queueList = document.querySelector("#queueList");
const queueEmpty = document.querySelector("#queueEmpty");
const clearQueueBtn = document.querySelector("#clearQueueBtn");
const nowStatus = document.querySelector("#nowStatus");
const nowName = document.querySelector("#nowName");
const nowMeta = document.querySelector("#nowMeta");

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function syncFields() {
  pieceName.value = state.pieceName;
  bpmInput.value = state.bpm;
}

function beatLabel(index) {
  const measure = Math.floor(index / beatsPerMeasure) + 1;
  const beat = (index % beatsPerMeasure) + 1;
  return `${measure}-${beat}`;
}

function phraseRange(phrase) {
  return [
    (phrase.startMeasure - 1) * beatsPerMeasure,
    phrase.endMeasure * beatsPerMeasure - 1
  ];
}

function currentPhrase() {
  return state.queue.length ? state.queue[queueIndex] ?? null : null;
}

function currentRange() {
  const phrase = currentPhrase();
  return phrase ? phraseRange(phrase) : [0, steps - 1];
}

// 队列增删移动后，把播放位置收敛到仍有效的范围内，不重置当前进度
function clampRuntimeToQueue() {
  if (!state.queue.length) {
    queueIndex = 0;
    repeatRound = 0;
    return;
  }
  if (queueIndex >= state.queue.length) {
    queueIndex = state.queue.length - 1;
    repeatRound = 0;
  }
  const phrase = state.queue[queueIndex];
  const [start, end] = phraseRange(phrase);
  if (repeatRound >= phrase.repeats) repeatRound = 0;
  if (playhead < start || playhead > end) playhead = start;
}

function renderGrid() {
  const header = ['<div class="label-cell">乐器</div>'];
  for (let i = 0; i < steps; i += 1) {
    header.push(`<div class="beat-cell" data-beat="${i}">${beatLabel(i)}</div>`);
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
}

function renderSidebars() {
  const filledByMeasure = [0, 1, 2, 3].map((measure) => {
    const start = measure * beatsPerMeasure;
    const count = state.pattern.flatMap((row) => row.slice(start, start + beatsPerMeasure)).filter(Boolean).length;
    return { measure: measure + 1, count };
  });
  structure.innerHTML = filledByMeasure.map((item) => `
    <div class="structure-row"><span>第${item.measure}小节</span><strong>${item.count}个口令</strong></div>
  `).join("");

  notesList.innerHTML = state.notes.length ? state.notes.map((note) => `
    <article class="note"><p>${note}</p></article>
  `).join("") : "<p>暂无批注。</p>";

  savedList.innerHTML = state.saved.length ? state.saved.map((item) => `
    <button class="saved-item" type="button" data-load="${item.id}">
      <strong>${item.name}</strong><br><span>${item.bpm}BPM · ${(item.queue || []).length}个乐句 · ${item.notes.length}条批注</span>
    </button>
  `).join("") : "<p>还没有保存方案。</p>";
}

function renderQueue() {
  const phrases = state.queue;
  queueEmpty.hidden = phrases.length > 0;
  clearQueueBtn.disabled = phrases.length === 0;
  queueList.innerHTML = phrases.map((phrase, index) => {
    const rangeText = phrase.startMeasure === phrase.endMeasure
      ? `第${phrase.startMeasure}小节`
      : `第${phrase.startMeasure}–${phrase.endMeasure}小节`;
    return `
      <li class="queue-card" data-id="${phrase.id}">
        <div class="queue-card-main">
          <span class="queue-order">${index + 1}</span>
          <div>
            <strong class="queue-name">${phrase.name}</strong>
            <span class="queue-detail">${rangeText} · 重复${phrase.repeats}遍</span>
          </div>
        </div>
        <div class="queue-card-actions">
          <span class="queue-badge"></span>
          <button type="button" class="mini-btn" data-action="up" ${index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="mini-btn" data-action="down" ${index === phrases.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="mini-btn danger" data-action="remove">移除</button>
        </div>
      </li>`;
  }).join("");
  updateNowPlaying();
}

function updateNowPlaying() {
  const phrase = currentPhrase();
  const playing = timer !== null;

  nowStatus.textContent = playing ? (paused ? "已暂停" : "播放中") : "待机";
  nowStatus.className = `now-status ${playing ? (paused ? "paused" : "live") : ""}`;

  if (phrase) {
    const rangeText = phrase.startMeasure === phrase.endMeasure
      ? `第${phrase.startMeasure}小节`
      : `第${phrase.startMeasure}–${phrase.endMeasure}小节`;
    nowName.textContent = phrase.name;
    nowMeta.textContent = `队列 ${queueIndex + 1}/${state.queue.length} · ${rangeText} · 第${repeatRound + 1}/${phrase.repeats}遍 · ${beatLabel(playhead)}`;
  } else {
    nowName.textContent = "全段播放";
    nowMeta.textContent = playing ? `第1–4小节 · ${beatLabel(playhead)}` : "第1–4小节 · 队列为空";
  }

  queueList.querySelectorAll(".queue-card").forEach((card, index) => {
    card.classList.toggle("is-current", phrase !== null && index === queueIndex);
    const badge = card.querySelector(".queue-badge");
    if (badge) badge.textContent = phrase !== null && index === queueIndex ? "当前乐句" : "";
  });
}

function render() {
  syncFields();
  renderGrid();
  renderSidebars();
  renderQueue();
}

function playSound(instrument) {
  audioContext ||= new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
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

  document.querySelectorAll(".cell.in-phrase,.beat-cell.in-phrase").forEach((cell) => cell.classList.remove("in-phrase"));
  const phrase = currentPhrase();
  if (phrase) {
    const [start, end] = phraseRange(phrase);
    for (let s = start; s <= end; s += 1) {
      document.querySelectorAll(`[data-step="${s}"],[data-beat="${s}"]`).forEach((cell) => cell.classList.add("in-phrase"));
    }
  }
}

function tick() {
  const phrase = currentPhrase();
  const [start, end] = currentRange();
  if (playhead < start || playhead > end) playhead = start;

  highlight(playhead);
  instruments.forEach((instrument, rowIndex) => {
    if (state.pattern[rowIndex][playhead]) playSound(instrument);
  });

  if (playhead < end) {
    playhead += 1;
  } else {
    // 当前乐句本遍走完：还有遍数就再来一遍，否则马上接下一句；末句结束回到队首
    if (phrase && repeatRound < phrase.repeats - 1) {
      repeatRound += 1;
      playhead = start;
    } else if (state.queue.length && queueIndex < state.queue.length - 1) {
      queueIndex += 1;
      repeatRound = 0;
      playhead = phraseRange(state.queue[queueIndex])[0];
    } else {
      // 全段模式，或队列末句最后一遍
      repeatRound = 0;
      if (state.queue.length) queueIndex = 0;
      playhead = currentRange()[0];
    }
  }
  updateNowPlaying();
}

grid.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  const row = Number(cell.dataset.row);
  const step = Number(cell.dataset.step);
  state.pattern[row][step] = state.pattern[row][step] ? "" : instruments[row].token;
  save();
  renderGrid();
  highlight(playhead);
});

pieceName.addEventListener("input", () => {
  state.pieceName = pieceName.value;
  save();
});

bpmInput.addEventListener("input", () => {
  state.bpm = Number(bpmInput.value || 96);
  save();
  if (timer && !paused) {
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
  const startMeasure = Number(phraseStart.value);
  let endMeasure = Number(phraseEnd.value);
  if (endMeasure < startMeasure) endMeasure = startMeasure;
  const repeats = Math.max(1, Number(phraseRepeats.value) || 1);
  state.queue.push(normalizePhrase({
    name: phraseName.value.trim() || `乐句 ${state.queue.length + 1}`,
    startMeasure,
    endMeasure,
    repeats
  }));
  phraseName.value = "";
  phraseRepeats.value = 2;
  save();
  clampRuntimeToQueue();
  renderQueue();
});

queueList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const card = event.target.closest(".queue-card");
  const id = card?.dataset.id;
  const index = state.queue.findIndex((phrase) => phrase.id === id);
  if (index < 0) return;
  const action = button.dataset.action;

  if (action === "up" && index > 0) {
    [state.queue[index - 1], state.queue[index]] = [state.queue[index], state.queue[index - 1]];
    if (queueIndex === index) queueIndex -= 1;
    else if (queueIndex === index - 1) queueIndex += 1;
  } else if (action === "down" && index < state.queue.length - 1) {
    [state.queue[index + 1], state.queue[index]] = [state.queue[index], state.queue[index + 1]];
    if (queueIndex === index) queueIndex += 1;
    else if (queueIndex === index + 1) queueIndex -= 1;
  } else if (action === "remove") {
    state.queue.splice(index, 1);
    if (state.queue.length === 0) {
      queueIndex = 0;
      repeatRound = 0;
    } else if (queueIndex > index) {
      queueIndex -= 1;
    } else if (queueIndex >= state.queue.length) {
      queueIndex = state.queue.length - 1;
      repeatRound = 0;
    }
  } else {
    return;
  }

  save();
  clampRuntimeToQueue();
  renderQueue();
  highlight(playhead);
});

clearQueueBtn.addEventListener("click", () => {
  state.queue = [];
  queueIndex = 0;
  repeatRound = 0;
  save();
  renderQueue();
  highlight(playhead);
});

const playBtn = document.querySelector("#playBtn");

function startTimer() {
  clearInterval(timer);
  timer = setInterval(tick, 60000 / state.bpm);
  paused = false;
  playBtn.textContent = "暂停";
}

// 从停止状态开始：回到起点；暂停后继续则保留当前拍点，不跳回句首
function handlePlay() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    paused = true;
    playBtn.textContent = "继续";
  } else {
    if (!paused) {
      queueIndex = 0;
      repeatRound = 0;
      playhead = currentRange()[0];
    }
    tick();
    startTimer();
  }
  updateNowPlaying();
}

function stopPlayback() {
  clearInterval(timer);
  timer = null;
  paused = false;
  playBtn.textContent = "播放";
  queueIndex = 0;
  repeatRound = 0;
  playhead = currentRange()[0];
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
  updateNowPlaying();
}

playBtn.addEventListener("click", handlePlay);
document.querySelector("#stopBtn").addEventListener("click", stopPlayback);

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
  event.preventDefault();
  handlePlay();
});

document.querySelector("#saveBtn").addEventListener("click", () => {
  state.saved.unshift({
    id: crypto.randomUUID(),
    name: state.pieceName || "未命名片段",
    bpm: state.bpm,
    notes: [...state.notes],
    queue: state.queue.map((phrase) => ({ ...phrase })),
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
  state.notes = [...item.notes];
  state.queue = (item.queue || []).map(normalizePhrase);
  state.pattern = item.pattern.map((row) => [...row]);
  queueIndex = 0;
  repeatRound = 0;
  playhead = currentRange()[0];
  save();
  render();
  highlight(playhead);
});

render();
