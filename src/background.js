const STORAGE_KEY = "underdogCaddieState";

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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((nextRow) => nextRow.some((value) => String(value || "").trim()));
}

function rosterFingerprint(names) {
  return names.map(normalizeName).sort().join("|");
}

function storageGet() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || emptyState());
    });
  });
}

function storageSet(state) {
  return chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function emptyState() {
  return {
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
}

function rebuildPlayersFromRosters(state) {
  const players = {};
  const playerInfo = state.playerInfo || {};
  Object.entries(state.rosters || {}).forEach(([rosterId, names]) => {
    names.forEach((name) => {
      const key = normalizeName(name);
      if (!players[key]) {
        players[key] = {
          name: displayName(name),
          team: playerInfo[key] ? playerInfo[key].team : "",
          position: playerInfo[key] ? playerInfo[key].position : "",
          rosterIds: {},
          manualLiveAdds: 0
        };
      }
      players[key].rosterIds[rosterId] = true;
    });
  });
  state.players = players;
  state.totalEntries = Object.keys(state.rosters || {}).length;
}

function recomputeCombos(state) {
  const combos = {};
  Object.values(state.rosters || {}).forEach((roster) => {
    const names = Array.from(new Set(roster.map(displayName))).sort();
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const key = `${normalizeName(names[i])}|${normalizeName(names[j])}`;
        combos[key] = {
          names: [names[i], names[j]],
          count: (combos[key] ? combos[key].count : 0) + 1
        };
      }
    }
  });
  state.combos = combos;
}

function finalizeState(state) {
  rebuildPlayersFromRosters(state);
  recomputeCombos(state);
  state.lastSyncAt = new Date().toISOString();
  return state;
}

async function importCsvBaseline({ csvText, fileName }) {
  const parsedRows = parseCsv(csvText || "");
  if (parsedRows.length < 2) {
    return { ok: false, error: "CSV did not contain any player rows." };
  }

  const header = parsedRows.shift().map(displayName);
  const columns = Object.fromEntries(header.map((name, index) => [name, index]));
  const required = ["Draft Entry", "Draft", "First Name", "Last Name", "Tournament Title"];
  const missing = required.filter((name) => columns[name] === undefined);
  if (missing.length) {
    return { ok: false, error: `CSV missing required columns: ${missing.join(", ")}` };
  }

  const importedAt = new Date().toISOString();
  const rosters = {};
  const rosterSources = {};
  const playerInfo = {};
  const tournaments = {};

  parsedRows.forEach((row) => {
    const draftEntry = displayName(row[columns["Draft Entry"]]);
    const draft = displayName(row[columns.Draft]);
    const firstName = displayName(row[columns["First Name"]]);
    const lastName = displayName(row[columns["Last Name"]]);
    const playerName = displayName(`${firstName} ${lastName}`);
    const tournamentTitle = displayName(row[columns["Tournament Title"]]);
    const tournamentId = displayName(row[columns.Tournament]);
    const pickedAt = displayName(row[columns["Picked At"]]);
    const pickNumber = Number(row[columns["Pick Number"]] || 0);
    const team = displayName(row[columns.Team]);
    const position = displayName(row[columns.Position]);

    if (!draftEntry || !playerName) {
      return;
    }

    const playerKey = normalizeName(playerName);
    if (!playerInfo[playerKey]) {
      playerInfo[playerKey] = {
        name: playerName,
        team,
        position
      };
    }

    if (!rosters[draftEntry]) {
      rosters[draftEntry] = [];
      rosterSources[draftEntry] = {
        source: "underdog-csv",
        capturedAt: importedAt,
        fileName: fileName || "underdog.csv",
        draft,
        tournamentTitle,
        tournamentId,
        picks: []
      };
    }

    rosters[draftEntry].push(playerName);
    rosterSources[draftEntry].picks.push({
      pickNumber,
      playerName,
      team,
      position,
      pickedAt
    });

    if (tournamentTitle) {
      tournaments[tournamentTitle] = (tournaments[tournamentTitle] || 0) + 1;
    }
  });

  const dedupedRosters = {};
  const dedupedSources = {};
  const seenFingerprints = new Set();
  Object.entries(rosters).forEach(([rosterId, names]) => {
    const uniqueNames = Array.from(new Set(names.map(displayName).filter(Boolean)));
    const fingerprint = rosterFingerprint(uniqueNames);
    if (!fingerprint || seenFingerprints.has(fingerprint)) {
      return;
    }

    seenFingerprints.add(fingerprint);
    dedupedRosters[rosterId] = uniqueNames;
    dedupedSources[rosterId] = {
      ...rosterSources[rosterId],
      picks: rosterSources[rosterId].picks.sort((a, b) => a.pickNumber - b.pickNumber),
      fingerprint
    };
  });

  const state = finalizeState({
    ...emptyState(),
    rosters: dedupedRosters,
    rosterSources: dedupedSources,
    playerInfo,
    csvImport: {
      fileName: fileName || "underdog.csv",
      importedAt,
      rows: parsedRows.length,
      teams: Object.keys(dedupedRosters).length,
      tournaments
    }
  });

  await storageSet(state);

  return {
    ok: true,
    rows: parsedRows.length,
    teams: Object.keys(dedupedRosters).length,
    players: Object.keys(state.players).length,
    tournaments
  };
}

async function upsertLiveRoster({ draftId, url, names }) {
  const cleanNames = Array.from(new Set((names || []).map(displayName).filter(Boolean))).slice(0, 24);
  if (!draftId || cleanNames.length < 1) {
    return { ok: false, error: "No live roster names detected." };
  }

  const state = await storageGet();
  state.rosters = state.rosters || {};
  state.rosterSources = state.rosterSources || {};
  state.liveDrafts = state.liveDrafts || {};

  const rosterId = `live:${draftId}`;
  state.rosters[rosterId] = cleanNames;
  state.rosterSources[rosterId] = {
    source: "live-draft",
    capturedAt: new Date().toISOString(),
    url,
    draftId,
    fingerprint: rosterFingerprint(cleanNames)
  };
  state.liveDrafts[rosterId] = {
    draftId,
    url,
    players: cleanNames,
    updatedAt: new Date().toISOString(),
    complete: cleanNames.length >= 18
  };
  state.currentRoster = cleanNames;

  finalizeState(state);
  await storageSet(state);

  return {
    ok: true,
    rosterId,
    players: cleanNames.length,
    complete: cleanNames.length >= 18
  };
}

function stateSummary(state) {
  const csvTeams = state.csvImport ? Number(state.csvImport.teams || 0) : 0;
  const liveTeams = Object.values(state.rosterSources || {}).filter((source) => source.source === "live-draft").length;
  return {
    totalEntries: Number(state.totalEntries || 0),
    players: Object.keys(state.players || {}).length,
    combos: Object.keys(state.combos || {}).length,
    baselineTeams: csvTeams,
    liveTeams,
    currentRoster: state.currentRoster || [],
    lastSyncAt: state.lastSyncAt || null,
    csvImport: state.csvImport || null
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.source !== "UNDERDOG_CADDIE") {
    return false;
  }

  if (message.type === "GET_STATE") {
    storageGet().then((state) => sendResponse(stateSummary(state)));
    return true;
  }

  if (message.type === "IMPORT_CSV") {
    importCsvBaseline({
      csvText: message.csvText,
      fileName: message.fileName
    }).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message.type === "UPSERT_LIVE_ROSTER") {
    upsertLiveRoster({
      draftId: message.draftId,
      url: message.url,
      names: message.names
    }).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message.type === "RESET_STATE") {
    storageSet(emptyState()).then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});
