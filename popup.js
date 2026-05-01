function queryActiveTab(message) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab || !tab.id) {
        resolve(null);
        return;
      }

      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response || null);
      });
    });
  });
}

function messageBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ source: "UNDERDOG_CADDIE", ...message }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || null);
    });
  });
}

function readSelectedCsv() {
  return new Promise((resolve, reject) => {
    const file = document.getElementById("csvImport").files[0];
    if (!file) {
      reject(new Error("Choose an Underdog CSV first."));
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve({
        fileName: file.name,
        csvText: String(reader.result || "")
      });
    });
    reader.addEventListener("error", () => reject(new Error("Could not read selected CSV.")));
    reader.readAsText(file);
  });
}

function setText(id, value) {
  document.getElementById(id).textContent = String(value);
}

async function refresh() {
  const [contentState, backgroundState] = await Promise.all([
    queryActiveTab({
      source: "UNDERDOG_CADDIE",
      type: "GET_STATE"
    }),
    messageBackground({
      type: "GET_STATE"
    })
  ]);

  const activeState = contentState || backgroundState;
  if (!activeState) {
    document.getElementById("status").textContent = "No local data yet.";
    return;
  }

  setText("entries", activeState.totalEntries || 0);
  setText("baselineTeams", activeState.baselineTeams || 0);
  setText("liveTeams", activeState.liveTeams || 0);
  setText("players", activeState.players || 0);

  if (activeState.csvImport) {
    const tournaments = activeState.csvImport.tournaments
      ? Object.keys(activeState.csvImport.tournaments).join(", ")
      : "CSV";
    document.getElementById("status").textContent = `Baseline: ${activeState.csvImport.teams} teams from ${tournaments}.`;
  } else {
    document.getElementById("status").textContent = "Import an Underdog CSV baseline, then draft normally.";
  }
}

document.getElementById("importCsv").addEventListener("click", async () => {
  try {
    document.getElementById("status").textContent = "Importing Underdog CSV baseline...";
    const file = await readSelectedCsv();
    const response = await messageBackground({
      type: "IMPORT_CSV",
      fileName: file.fileName,
      csvText: file.csvText
    });
    const tournaments = response && response.tournaments
      ? Object.keys(response.tournaments).join(", ")
      : "CSV";
    const resultText = response && response.ok
      ? `Imported ${response.teams} teams, ${response.players} players from ${tournaments}.`
      : `CSV import failed: ${response && response.error ? response.error : "unknown error"}`;
    await refresh();
    document.getElementById("status").textContent = resultText;
  } catch (error) {
    document.getElementById("status").textContent = error.message;
  }
});

document.getElementById("refresh").addEventListener("click", refresh);
document.getElementById("reset").addEventListener("click", async () => {
  await messageBackground({ type: "RESET_STATE" });
  await refresh();
});

refresh();
