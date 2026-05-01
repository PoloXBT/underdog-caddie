(function () {
  if (window.__UNDERDOG_CADDIE_CONTENT__) {
    return;
  }

  window.__UNDERDOG_CADDIE_CONTENT__ = true;

  const STORAGE_KEY = "underdogCaddieState";
  const NFL_TEAM_CODES = new Set([
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
    "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
    "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
    "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"
  ]);
  const PLAYER_NAME_RE = /^(?:[A-Z][A-Za-z.'-]*|[A-Z]{2,}|[A-Z]\.)(?:\s(?:[A-Z][A-Za-z.'-]*|[A-Z]{2,}|[A-Z]\.)){1,4}(?:\s(?:Jr\.|Sr\.|II|III|IV|V))?$/;
  const POSITION_RE = /^(QB|RB|WR|TE)(?:\d+)?$/;
  const NFL_TEAM_RE = /^[A-Z]{2,4}$/;
  const NON_PLAYER_LINES = new Set([
    "players",
    "queue",
    "autopilot",
    "pick",
    "picks away",
    "pick position",
    "projected",
    "my rank",
    "adp",
    "proj",
    "drafts",
    "pick'em",
    "live",
    "results",
    "rankings",
    "news feed",
    "underdog caddie",
    "exposure"
  ]);
  const STATE = {
    totalEntries: 0,
    players: {},
    playerInfo: {},
    combos: {},
    rosters: {},
    rosterSources: {},
    currentRoster: [],
    lastSyncAt: null,
    csvImport: null,
    liveDrafts: {}
  };

  const ui = {
    root: null,
    body: null,
    status: null,
    badgeLayer: null
  };

  let lastLiveSignature = "";
  let applyingHighlights = false;

  function normalizeName(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/[^\w .'-]/g, "")
      .trim()
      .toLowerCase();
  }

  function displayName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isLikelyPlayerName(value) {
    const text = displayName(value);
    if (text.length < 5 || text.length > 42) {
      return false;
    }

    if (/team|player|draft|round|pick|available|queue|roster|contest|entry|projection|rank|exposure/i.test(text)) {
      return false;
    }

    return PLAYER_NAME_RE.test(text);
  }

  function textLines(value) {
    return String(value || "")
      .split(/\n+/)
      .map(displayName)
      .filter(Boolean);
  }

  function isNoiseLine(value) {
    const text = displayName(value);
    const lower = text.toLowerCase();
    return (
      !text ||
      NON_PLAYER_LINES.has(lower) ||
      POSITION_RE.test(text) ||
      NFL_TEAM_RE.test(text) ||
      /^\d+(\.\d+)?$/.test(text) ||
      /^\d+\s+picks?\s+away$/i.test(text) ||
      /^\d+\.\d+\|\d+$/.test(text) ||
      /^\$\d/.test(text)
    );
  }

  function firstPlayerNameFromLines(lines) {
    return lines.find((line) => !isNoiseLine(line) && isLikelyPlayerName(line)) || "";
  }

  function playerInfoFromRosterSources(saved) {
    const info = { ...(saved.playerInfo || {}) };
    Object.values(saved.rosterSources || {}).forEach((source) => {
      (source.picks || []).forEach((pick) => {
        const name = displayName(pick.playerName);
        const key = normalizeName(name);
        if (!key || info[key]) {
          return;
        }

        info[key] = {
          name,
          team: displayName(pick.team),
          position: displayName(pick.position)
        };
      });
    });
    return info;
  }

  function mergeState(saved) {
    if (!saved || typeof saved !== "object") {
      return;
    }

    Object.assign(STATE, {
      totalEntries: Number(saved.totalEntries || 0),
      players: saved.players || {},
      playerInfo: playerInfoFromRosterSources(saved),
      combos: saved.combos || {},
      rosters: saved.rosters || {},
      rosterSources: saved.rosterSources || {},
      currentRoster: saved.currentRoster || [],
      lastSyncAt: saved.lastSyncAt || null,
      csvImport: saved.csvImport || null,
      liveDrafts: saved.liveDrafts || {}
    });
  }

  function storageGet() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        resolve(result[STORAGE_KEY] || null);
      });
    });
  }

  function messageBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ source: "UNDERDOG_CADDIE", ...message }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response || null);
      });
    });
  }

  function draftIdFromLocation() {
    const path = window.location.pathname;
    const uuid = path.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuid) {
      return uuid[0];
    }
    return path.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "active-draft";
  }

  function isDraftPage() {
    return /draft|drafts|pick|active/i.test(window.location.pathname + " " + document.title);
  }

  function exposureFor(name) {
    const item = STATE.players[normalizeName(name)];
    if (!item) {
      return null;
    }

    const count = Object.keys(item.rosterIds || {}).length + Number(item.manualLiveAdds || 0);
    const total = Math.max(STATE.totalEntries, Object.keys(STATE.rosters).length);
    return {
      name: item.name,
      count,
      total,
      pct: total ? (count / total) * 100 : 0
    };
  }

  function playerInfoFor(name) {
    const key = normalizeName(name);
    return STATE.playerInfo[key] || STATE.players[key] || {};
  }

  function teamFromText(value) {
    return String(value || "")
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.toUpperCase())
      .find((token) => NFL_TEAM_CODES.has(token)) || "";
  }

  function teamForPlayer(name, contextElement = null) {
    const storedTeam = displayName(playerInfoFor(name).team).toUpperCase();
    if (storedTeam) {
      return storedTeam;
    }

    return contextElement ? teamFromText(contextElement.innerText || contextElement.textContent) : "";
  }

  function teamsFromText(value) {
    return new Set(String(value || "")
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.toUpperCase())
      .filter((token) => NFL_TEAM_CODES.has(token)));
  }

  function rosterContainerSelectors() {
    return [
      "[class*='roster' i]",
      "[data-testid*='roster' i]",
      "[aria-label*='roster' i]",
      "[class*='lineup' i]",
      "[class*='my-team' i]",
      "[class*='draftingTeamView' i]",
      "[class*='draftEntryWrapper' i]",
      "[class*='teamsDropdownWrapper' i]"
    ].join(",");
  }

  function visibleRosterTeamsFromDom() {
    const teams = new Set();
    document.querySelectorAll(rosterContainerSelectors()).forEach((container) => {
      teamsFromText(container.innerText || container.textContent).forEach((team) => teams.add(team));
    });

    return teams;
  }

  function currentRosterTeams() {
    const teams = new Set((STATE.currentRoster || [])
      .map(teamForPlayer)
      .filter(Boolean));
    visibleRosterTeamsFromDom().forEach((team) => teams.add(team));
    return teams;
  }

  function teamMatchForPlayer(name, contextElement = null) {
    const team = teamForPlayer(name, contextElement);
    if (!team) {
      return "";
    }

    return currentRosterTeams().has(team) ? team : "";
  }

  function comboCount(a, b) {
    const key = [normalizeName(a), normalizeName(b)].sort().join("|");
    return STATE.combos[key] ? STATE.combos[key].count : 0;
  }

  function pairCombosForPlayer(name) {
    const candidateKey = normalizeName(name);
    return Array.from(new Set((STATE.currentRoster || []).map(displayName).filter(Boolean)))
      .filter((rosterName) => normalizeName(rosterName) !== candidateKey)
      .map((rosterName) => ({
        name: rosterName,
        count: comboCount(name, rosterName)
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  function currentRosterMatches(name) {
    return STATE.currentRoster
      .map((rosterName) => ({
        name: rosterName,
        count: comboCount(name, rosterName)
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  }

  function exposureNames() {
    return Object.values(STATE.players || {})
      .map((player) => displayName(player.name))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
  }

  function exposedNameInText(value) {
    const text = displayName(value);
    const lower = text.toLowerCase();
    return exposureNames().find((name) => {
      const normalized = name.toLowerCase();
      return lower === normalized || lower.includes(normalized);
    }) || "";
  }

  function classifyExposure(exposure) {
    if (!exposure || !exposure.total) {
      return "none";
    }
    if (exposure.pct >= 25) {
      return "high";
    }
    if (exposure.pct >= 12) {
      return "medium";
    }
    return "low";
  }

  function candidateNamesFromText(value) {
    const text = String(value || "");
    const normalizedText = normalizeName(text);
    const parsedNames = text
      .split(/\n| {2,}|\t|·|\||\r/)
      .map(displayName)
      .filter(isLikelyPlayerName);
    const exposedNames = exposureNames().filter((name) => {
      const normalizedName = normalizeName(name);
      return normalizedText === normalizedName || normalizedText.includes(normalizedName);
    });
    return Array.from(new Set([...parsedNames, ...exposedNames]));
  }

  function namesInElement(element) {
    if (!element || element.closest(".udc-overlay")) {
      return [];
    }

    const clone = element.cloneNode(true);
    clone.querySelectorAll("[data-udc-badge]").forEach((badge) => badge.remove());
    return candidateNamesFromText(clone.textContent);
  }

  function elementOwnsDetectedName(element, name) {
    const key = normalizeName(name);
    if (!key) {
      return false;
    }

    return !Array.from(element.children || []).some((child) => {
      const childText = child.innerText || child.textContent;
      const childName = firstPlayerNameFromLines(textLines(childText)) || exposedNameInText(childText);
      return normalizeName(childName) === key;
    });
  }

  function visibleKnownPlayerNames() {
    const names = new Set();
    targetElementsForHighlights().forEach((element) => {
      if (!isVisibleElement(element) || element.closest(".udc-overlay, .udc-badge-layer")) {
        return;
      }

      const text = displayName(element.innerText || element.textContent);
      if (!text || text.length > 520) {
        return;
      }

      const name = exposedNameInText(text);
      if (name && elementOwnsDetectedName(element, name)) {
        names.add(normalizeName(name));
      }
    });
    return names;
  }

  function rosterNamesFromDraftSummaryText() {
    const lines = textLines(document.body ? document.body.innerText : "");
    const pickPositionIndex = lines.findIndex((line) => /^pick position$/i.test(line));
    if (pickPositionIndex < 2) {
      return [];
    }

    const currentUser = lines[pickPositionIndex - 2];
    if (!currentUser || isLikelyPlayerName(currentUser)) {
      return [];
    }

    const names = [];
    for (let index = pickPositionIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      const lower = line.toLowerCase();

      if (lower === "queue" || lower === "underdog caddie" || lower === "players") {
        break;
      }

      if (isNoiseLine(line)) {
        continue;
      }

      if (isLikelyPlayerName(line)) {
        names.push(line);
      }
    }

    return Array.from(new Set(names)).slice(0, 24);
  }

  function visiblePlayerListNames() {
    const lines = textLines(document.body ? document.body.innerText : "");
    const ranges = [];
    lines.forEach((line, index) => {
      if (!/^players$/i.test(line)) {
        return;
      }

      const queueIndex = lines.findIndex((nextLine, nextIndex) => nextIndex > index && /^queue$/i.test(nextLine));
      if (queueIndex > index) {
        ranges.push([index + 1, queueIndex]);
      }
    });

    const candidateSets = ranges
      .map(([start, end]) => lines
        .slice(start, end)
        .filter((line) => !isNoiseLine(line) && isLikelyPlayerName(line))
        .map(normalizeName))
      .filter((names) => names.length);

    if (!candidateSets.length) {
      const headerIndex = lines.findIndex((line, index) => (
        /^my rank$/i.test(line) &&
        /^adp$/i.test(lines[index + 1] || "") &&
        /^proj$/i.test(lines[index + 2] || "")
      ));
      const queueIndex = lines.findIndex((line, index) => index > headerIndex && /^queue$/i.test(line));
      if (headerIndex >= 0 && queueIndex > headerIndex) {
        return new Set(lines
          .slice(headerIndex + 3, queueIndex)
          .filter((line) => !isNoiseLine(line) && isLikelyPlayerName(line))
          .map(normalizeName));
      }
      return visibleKnownPlayerNames();
    }

    candidateSets.sort((a, b) => b.length - a.length);
    return new Set(candidateSets[0]);
  }

  function visibleQueueNames() {
    const lines = textLines(document.body ? document.body.innerText : "");
    const names = new Set();
    lines.forEach((line, index) => {
      if (!/^queue$/i.test(line)) {
        return;
      }

      for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
        const nextLine = lines[nextIndex];
        const lower = nextLine.toLowerCase();
        if (
          lower === "players" ||
          lower === "underdog caddie" ||
          lower === "my rank" ||
          lower === "adp" ||
          lower === "proj" ||
          lower === "pick position"
        ) {
          break;
        }

        if (!isNoiseLine(nextLine) && isLikelyPlayerName(nextLine)) {
          names.add(normalizeName(nextLine));
          continue;
        }

        const exposedName = exposedNameInText(nextLine);
        if (exposedName) {
          names.add(normalizeName(exposedName));
        }
      }
    });

    return names;
  }

  function visibleBoardAndQueueNames() {
    return new Set([...visiblePlayerListNames(), ...visibleQueueNames()]);
  }

  function queueContainerSelectors() {
    return "[class*='queue' i], [data-testid*='queue' i], [aria-label*='queue' i]";
  }

  function isQueueElement(element) {
    return Boolean(element && element.closest(queueContainerSelectors()));
  }

  function shouldBadgeCandidate(name, allowedNames, element = null) {
    const key = normalizeName(name);
    if (!key) {
      return false;
    }

    return (
      allowedNames.has(key) ||
      Boolean(exposureFor(name)) ||
      Boolean(teamForPlayer(name)) ||
      isQueueElement(element) ||
      isRosterElement(element)
    );
  }

  function isRosterElement(element) {
    if (!element) {
      return false;
    }

    const rosterContainer = element.closest(rosterContainerSelectors());
    if (rosterContainer) {
      return true;
    }

    let current = element;
    for (let depth = 0; current && current !== document.body && depth < 5; depth += 1) {
      const text = textLines(current.innerText || current.textContent);
      if (text.some((line) => /^pick position$/i.test(line))) {
        return true;
      }
      current = current.parentElement;
    }

    return false;
  }

  function cleanupRosterDecorations() {
    document.querySelectorAll(rosterContainerSelectors()).forEach((container) => {
      container.querySelectorAll("[data-udc-team-badge]").forEach((node) => node.remove());
      container.querySelectorAll(".udc-highlight, .udc-team-highlight").forEach(removeHighlightClasses);
      removeHighlightClasses(container);
    });
  }

  function inferCurrentRosterFromPage() {
    const summaryNames = rosterNamesFromDraftSummaryText();
    if (summaryNames.length) {
      STATE.currentRoster = summaryNames;
      return STATE.currentRoster;
    }

    const selectors = [
      "[class*='roster' i]",
      "[data-testid*='roster' i]",
      "[aria-label*='roster' i]",
      "[class*='lineup' i]",
      "[class*='my-team' i]",
      "[class*='team' i]"
    ];

    const candidates = [];
    document.querySelectorAll(selectors.join(",")).forEach((container) => {
      const names = Array.from(new Set(namesInElement(container)));
      if (names.length >= 1 && names.length <= 24) {
        candidates.push(names);
      }
    });

    if (!candidates.length) {
      STATE.currentRoster = [];
      return [];
    }

    candidates.sort((a, b) => b.length - a.length);
    STATE.currentRoster = candidates[0].slice(0, 24);
    return STATE.currentRoster;
  }

  async function syncLiveRoster() {
    if (!isDraftPage()) {
      return;
    }

    const names = inferCurrentRosterFromPage();
    const signature = names.map(normalizeName).sort().join("|");
    if (!signature || signature === lastLiveSignature) {
      updateOverlay();
      return;
    }

    lastLiveSignature = signature;
    await messageBackground({
      type: "UPSERT_LIVE_ROSTER",
      draftId: draftIdFromLocation(),
      url: window.location.href,
      names
    });
  }

  function ensureOverlay() {
    if (ui.root || !document.body) {
      return;
    }

    ui.root = document.createElement("aside");
    ui.root.className = "udc-overlay";
    ui.root.innerHTML = `
      <div class="udc-header">
        <div>
          <div class="udc-kicker">Underdog Caddie</div>
          <strong>Exposure</strong>
        </div>
        <button class="udc-toggle" type="button" aria-label="Toggle Underdog Caddie">-</button>
      </div>
      <div class="udc-body"></div>
      <div class="udc-status"></div>
    `;
    ui.body = ui.root.querySelector(".udc-body");
    ui.status = ui.root.querySelector(".udc-status");
    ui.root.querySelector(".udc-toggle").addEventListener("click", () => {
      ui.root.classList.toggle("is-collapsed");
    });
    document.body.appendChild(ui.root);
  }

  function ensureBadgeLayer() {
    if (ui.badgeLayer || !document.body) {
      return;
    }

    ui.badgeLayer = document.createElement("div");
    ui.badgeLayer.className = "udc-badge-layer";
    document.body.appendChild(ui.badgeLayer);
  }

  function topPlayers() {
    return Object.values(STATE.players)
      .map((player) => {
        const count = Object.keys(player.rosterIds || {}).length + Number(player.manualLiveAdds || 0);
        const total = Math.max(STATE.totalEntries, Object.keys(STATE.rosters).length);
        return {
          name: player.name,
          count,
          pct: total ? (count / total) * 100 : 0
        };
      })
      .filter((player) => player.count > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 7);
  }

  function sourceCounts() {
    const sources = Object.values(STATE.rosterSources || {});
    return {
      baseline: sources.filter((source) => source.source === "underdog-csv").length,
      live: sources.filter((source) => source.source === "live-draft").length
    };
  }

  function updateOverlay() {
    ensureOverlay();
    if (!ui.root) {
      return;
    }

    const total = Math.max(STATE.totalEntries, Object.keys(STATE.rosters).length);
    const counts = sourceCounts();
    const currentRoster = STATE.currentRoster || [];
    const rows = topPlayers()
      .map(
        (player) => `
          <div class="udc-row">
            <span>${player.name}</span>
            <b>${player.pct.toFixed(1)}%</b>
          </div>
        `
      )
      .join("");

    ui.body.innerHTML = `
      <div class="udc-metric">
        <span>Total teams</span>
        <b>${total}</b>
      </div>
      <div class="udc-metric">
        <span>CSV baseline</span>
        <b>${counts.baseline}</b>
      </div>
      <div class="udc-metric">
        <span>Live tracked</span>
        <b>${counts.live}</b>
      </div>
      <div class="udc-metric">
        <span>Current roster</span>
        <b>${currentRoster.length}/18</b>
      </div>
      <div class="udc-section-title">Top exposure</div>
      ${rows || '<div class="udc-empty">Import your Underdog CSV to start tracking exposure.</div>'}
    `;

    ui.status.textContent = STATE.lastSyncAt
      ? `Updated ${new Date(STATE.lastSyncAt).toLocaleTimeString()}`
      : "Waiting for CSV baseline";
  }

  function maybePlayerTextNode(element) {
    if (!element || element.closest(".udc-overlay, .udc-badge-layer")) {
      return "";
    }

    const text = displayName(element.innerText || element.textContent);
    if (!text || text.length > 520) {
      return "";
    }

    const lines = textLines(element.innerText || element.textContent);
    const firstName = firstPlayerNameFromLines(lines) || exposedNameInText(text);
    if (!firstName) {
      return "";
    }

    const childNames = Array.from(element.children || [])
      .map((child) => {
        const childText = child.innerText || child.textContent;
        return firstPlayerNameFromLines(textLines(childText)) || exposedNameInText(childText);
      })
      .filter(Boolean);

    if (childNames.includes(firstName)) {
      return "";
    }

    return firstName;
  }

  function targetElementsForHighlights() {
    const selectors = [
      "[class*='playerPickCell' i]",
      "[class*='playerNameRow' i]",
      "[class*='teamLineupRow' i]",
      "[class*='draftingCell' i]",
      "[class*='player' i]",
      "[class*='queue' i]"
    ];
    const seen = new Set();
    const candidates = [];
    const addCandidate = (element) => {
      if (seen.has(element) || element.closest(".udc-overlay, .udc-badge-layer")) {
        return;
      }
      seen.add(element);
      candidates.push(element);
    };

    document.querySelectorAll(selectors.join(",")).forEach((element) => {
      addCandidate(element);
    });

    document.querySelectorAll(rosterContainerSelectors()).forEach((container) => {
      container.querySelectorAll("*").forEach((element) => {
        addCandidate(element);
      });
    });

    document.querySelectorAll(queueContainerSelectors()).forEach((container) => {
      container.querySelectorAll("*").forEach((element) => {
        addCandidate(element);
      });
    });

    return candidates.length >= 12
      ? candidates.slice(0, 2000)
      : Array.from(document.querySelectorAll("body *")).slice(0, 8000);
  }

  function isVisibleElement(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 8 &&
      rect.height > 8 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity || 1) > 0
    );
  }

  function badgeFor(name) {
    const exposure = exposureFor(name);
    const badge = document.createElement("span");
    badge.className = `udc-badge udc-${classifyExposure(exposure)}`;
    badge.textContent = exposure && exposure.total ? `${exposure.pct.toFixed(0)}%` : "0%";
    badge.title = exposure
      ? `${exposure.count}/${exposure.total} teams`
      : "No exposure found";

    return badge;
  }

  function teamBadgeFor(name, row = null) {
    const team = teamMatchForPlayer(name, row);
    if (!team) {
      return null;
    }

    const badge = document.createElement("span");
    badge.className = "udc-team-badge";
    badge.textContent = team;
    badge.title = `${team} stack: current roster already has this team`;
    return badge;
  }

  function comboBadgeFor(name) {
    const combos = pairCombosForPlayer(name);
    if (!combos.length) {
      return null;
    }

    const best = combos[0];
    const badge = document.createElement("span");
    badge.className = "udc-combo-badge";
    badge.textContent = `C${best.count}`;
    badge.title = `Combos: ${combos.map((item) => `${item.name} x${item.count}`).join(", ")}`;
    return badge;
  }

  function rowDescriptor(element) {
    return [
      element.id,
      element.className,
      element.getAttribute("role"),
      element.getAttribute("aria-label"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test-id"),
      element.getAttribute("data-cy")
    ].map((value) => String(value || "")).join(" ").toLowerCase();
  }

  function scorePlayerRow(element, name) {
    const rect = element.getBoundingClientRect();
    const text = normalizeName(element.innerText || element.textContent);
    if (!text.includes(normalizeName(name)) || rect.width < 80 || rect.height < 18 || rect.height > 220) {
      return -1;
    }

    const descriptor = rowDescriptor(element);
    const style = window.getComputedStyle(element);
    let score = 0;
    if (/(player|draft|pick|card|row|cell|entry|selection)/i.test(descriptor)) {
      score += 5;
    }
    if (style.display === "flex" || style.display === "grid") {
      score += 3;
    }
    if (rect.width > 180) {
      score += 2;
    }
    if (rect.height >= 36 && rect.height <= 120) {
      score += 3;
    }
    if (element.children.length >= 2) {
      score += 1;
    }
    score -= Math.max(0, text.length - 220) / 80;
    return score;
  }

  function playerRowForElement(element, name) {
    let current = element;
    let best = element;
    let bestScore = scorePlayerRow(element, name);

    for (let depth = 0; current && current.parentElement && depth < 7; depth += 1) {
      current = current.parentElement;
      if (current === document.body || current.closest(".udc-overlay, .udc-badge-layer")) {
        break;
      }

      const score = scorePlayerRow(current, name);
      if (score > bestScore) {
        best = current;
        bestScore = score;
      }
    }

    return best;
  }

  function rowChildForElement(row, element) {
    let current = element;
    while (current && current.parentElement && current.parentElement !== row) {
      current = current.parentElement;
    }

    return current && current.parentElement === row ? current : null;
  }

  function insertStatsContainer(row, element, container) {
    const anchor = rowChildForElement(row, element);
    if (anchor && anchor !== container) {
      anchor.insertAdjacentElement("afterend", container);
      return;
    }

    if (!container.parentElement) {
      row.appendChild(container);
    }
  }

  function attachBadgeToElement(element, name) {
    const key = normalizeName(name);
    const row = playerRowForElement(element, name);
    const existingContainers = Array.from(row.children || [])
      .filter((child) => child.classList && child.classList.contains("udc-row-stats"));
    const container = existingContainers.find((child) => child.dataset.udcName === key) || existingContainers[0] || document.createElement("span");
    const directBadges = Array.from(container.children || [])
      .filter((child) => child.dataset && child.dataset.udcBadge);
    const directTeamBadges = Array.from(container.children || [])
      .filter((child) => child.dataset && child.dataset.udcTeamBadge);
    const directComboBadges = Array.from(container.children || [])
      .filter((child) => child.dataset && child.dataset.udcComboBadge);
    const existing = directBadges.find((child) => child.dataset.udcName === key) || directBadges[0];
    const badge = existing || badgeFor(name);
    const nextBadge = existing ? badgeFor(name) : badge;
    const nextTeamBadge = isRosterElement(row) ? null : teamBadgeFor(name, row);
    const teamBadge = directTeamBadges.find((child) => child.dataset.udcName === key) || directTeamBadges[0] || nextTeamBadge;
    const nextComboBadge = comboBadgeFor(name);
    const comboBadge = directComboBadges.find((child) => child.dataset.udcName === key) || directComboBadges[0] || nextComboBadge;

    container.className = "udc-row-stats";
    container.dataset.udcRowStats = "true";
    container.dataset.udcName = key;
    badge.className = nextBadge.className;
    badge.textContent = nextBadge.textContent;
    badge.title = nextBadge.title;
    badge.dataset.udcBadge = "true";
    badge.dataset.udcInlineBadge = "true";
    badge.dataset.udcName = key;
    badge.dataset.udcMetric = "exposure";
    delete badge.dataset.udcTeamBadge;
    delete badge.dataset.udcComboBadge;
    delete badge.dataset.udcFloatingBadge;
    badge.style.left = "";
    badge.style.top = "";

    directBadges.forEach((child) => {
      if (child !== badge) {
        child.remove();
      }
    });

    if (!existing) {
      container.appendChild(badge);
    }

    directTeamBadges.forEach((child) => {
      if (child !== teamBadge) {
        child.remove();
      }
    });

    if (nextTeamBadge && teamBadge) {
      teamBadge.className = nextTeamBadge.className;
      teamBadge.textContent = nextTeamBadge.textContent;
      teamBadge.title = nextTeamBadge.title;
      teamBadge.dataset.udcTeamBadge = "true";
      teamBadge.dataset.udcInlineBadge = "true";
      teamBadge.dataset.udcName = key;
      teamBadge.dataset.udcMetric = "team";
      delete teamBadge.dataset.udcBadge;
      delete teamBadge.dataset.udcComboBadge;
      if (!teamBadge.parentElement) {
        container.appendChild(teamBadge);
      }
    } else {
      directTeamBadges.forEach((child) => child.remove());
    }

    directComboBadges.forEach((child) => {
      if (child !== comboBadge) {
        child.remove();
      }
    });

    if (nextComboBadge && comboBadge) {
      comboBadge.className = nextComboBadge.className;
      comboBadge.textContent = nextComboBadge.textContent;
      comboBadge.title = nextComboBadge.title;
      comboBadge.dataset.udcComboBadge = "true";
      comboBadge.dataset.udcInlineBadge = "true";
      comboBadge.dataset.udcName = key;
      comboBadge.dataset.udcMetric = "combo";
      delete comboBadge.dataset.udcBadge;
      delete comboBadge.dataset.udcTeamBadge;
      if (!comboBadge.parentElement) {
        container.appendChild(comboBadge);
      }
    } else {
      directComboBadges.forEach((child) => child.remove());
    }

    existingContainers.forEach((child) => {
      if (child !== container) {
        child.remove();
      }
    });

    insertStatsContainer(row, element, container);

    return { badge, row, teamMatch: Boolean(nextTeamBadge) };
  }

  function removeHighlightClasses(element) {
    element.classList.remove("udc-highlight", "udc-highlight-high", "udc-highlight-medium", "udc-highlight-low", "udc-highlight-none", "udc-team-highlight");
  }

  function cleanupInjectedRowMutations() {
    document.querySelectorAll(".udc-highlight, .udc-team-highlight").forEach(removeHighlightClasses);
  }

  function highlightBoard() {
    if (!document.body) {
      return;
    }

    ensureBadgeLayer();
    const playerListNames = visibleBoardAndQueueNames();
    applyingHighlights = true;
    cleanupInjectedRowMutations();
    cleanupRosterDecorations();

    if (!playerListNames.size && !Object.keys(STATE.players || {}).length) {
      document.querySelectorAll("[data-udc-badge]").forEach((node) => node.remove());
      document.querySelectorAll(".udc-highlight").forEach(removeHighlightClasses);
      setTimeout(() => {
        applyingHighlights = false;
      }, 0);
      return;
    }

    const seenElements = new Set();
    const candidates = targetElementsForHighlights()
      .map((element) => ({ element, name: maybePlayerTextNode(element) }))
      .filter((item) => {
        const key = normalizeName(item.name);
        if (!item.name || !shouldBadgeCandidate(item.name, playerListNames, item.element) || seenElements.has(item.element) || !isVisibleElement(item.element)) {
          return false;
        }
        seenElements.add(item.element);
        return true;
      });

    const activeBadges = new Set();
    candidates.forEach(({ element, name }) => {
      const attached = attachBadgeToElement(element, name);
      removeHighlightClasses(attached.row);
      activeBadges.add(attached.badge);
    });

    document.querySelectorAll("[data-udc-badge]").forEach((node) => {
      if (!activeBadges.has(node)) {
        node.remove();
      }
    });
    document.querySelectorAll("[data-udc-row-stats]").forEach((node) => {
      if (!node.querySelector("[data-udc-badge]")) {
        node.remove();
      }
    });
    document.querySelectorAll(".udc-highlight, .udc-team-highlight").forEach(removeHighlightClasses);

    setTimeout(() => {
      applyingHighlights = false;
    }, 0);
  }

  function scheduleWork() {
    clearTimeout(scheduleWork.timer);
    scheduleWork.timer = setTimeout(() => {
      syncLiveRoster();
      highlightBoard();
      updateOverlay();
    }, 250);
  }

  function scheduleHighlights(delay = 50) {
    clearTimeout(scheduleHighlights.timer);
    scheduleHighlights.timer = setTimeout(() => {
      window.requestAnimationFrame(highlightBoard);
    }, delay);
  }

  function observeDom() {
    const observer = new MutationObserver(() => {
      if (!applyingHighlights) {
        scheduleHighlights();
        scheduleWork();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });

    window.addEventListener("scroll", () => scheduleHighlights(0), {
      capture: true,
      passive: true
    });
    document.addEventListener("scroll", () => scheduleHighlights(0), {
      capture: true,
      passive: true
    });
    window.addEventListener("resize", () => scheduleHighlights(0), { passive: true });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.source !== "UNDERDOG_CADDIE") {
      return false;
    }

    if (message.type === "GET_STATE") {
      sendResponse({
        totalEntries: Math.max(STATE.totalEntries, Object.keys(STATE.rosters).length),
        players: Object.keys(STATE.players).length,
        combos: Object.keys(STATE.combos).length,
        baselineTeams: sourceCounts().baseline,
        liveTeams: sourceCounts().live,
        currentRoster: STATE.currentRoster || [],
        lastSyncAt: STATE.lastSyncAt,
        csvImport: STATE.csvImport
      });
      return false;
    }

    return false;
  });

  storageGet().then((saved) => {
    mergeState(saved);
    ensureOverlay();
    inferCurrentRosterFromPage();
    updateOverlay();
    observeDom();
    scheduleWork();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY] || !changes[STORAGE_KEY].newValue) {
      return;
    }

    mergeState(changes[STORAGE_KEY].newValue);
    updateOverlay();
    scheduleWork();
  });
})();
