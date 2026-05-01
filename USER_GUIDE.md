# Underdog Caddie User Guide

Underdog Caddie is a free local Chrome extension for Underdog Fantasy draft rooms. It imports your Underdog CSV exposure file, watches your current draft room, and adds small inline badges to player rows so you can see exposure, same-team roster context, and repeated player combos while you draft.

All imported data stays in Chrome extension local storage on your machine. The extension does not modify your CSV file and does not send your draft data to a server.

## What You Need

- Google Chrome or another Chromium browser that supports unpacked extensions.
- An Underdog account.
- A CSV export from Underdog that contains your current drafted teams.
- This `underdog-caddie` folder.

## Install In Chrome

1. Download or clone this project.
2. Keep the `underdog-caddie` folder somewhere stable on your computer.
3. Open Chrome.
4. Go to `chrome://extensions`.
5. Turn on Developer mode in the top right.
6. Click Load unpacked.
7. Select the `underdog-caddie` folder.
8. Confirm that Underdog Caddie appears in your extension list.
9. Pin the extension if you want quick access from the Chrome toolbar.

If you move or delete the folder later, Chrome may stop loading the extension. Keep the folder in the same place after installing it.

## Import Your Underdog CSV

Underdog Caddie uses your CSV as the baseline for exposure and combo calculations.

1. Export your current entries from Underdog as a CSV.
2. Open Chrome and click the Underdog Caddie extension icon.
3. Click Import CSV baseline.
4. Choose your Underdog CSV export.
5. Wait for the import to finish.
6. Open an Underdog draft room and draft normally.

The imported CSV is copied into Chrome local extension storage. Your original CSV file is not changed.

## Recommended Workflow

Use a fresh CSV as your starting point for the day.

1. Before drafting, export your latest Underdog CSV.
2. Import that CSV into Underdog Caddie.
3. Draft with the inline badges visible.
4. Let the extension track live roster changes during the session.
5. Later, export a new CSV from Underdog and import it again to make completed drafts part of your long-term baseline.

Re-importing a CSV replaces the baseline and clears prior local live-draft state.

## CSV Baseline vs Live Tracking

Underdog Caddie has two sources of roster data:

- CSV baseline
- live tracked drafts

The CSV baseline is the official imported data set. It is used for exposure percentages and historical combo counts.

Live tracking watches your visible draft room roster. When your roster changes, the extension saves that draft locally as a `live-draft` entry. These live entries affect local exposure calculations during the current data set, but they do not write back to your CSV.

The overlay metric `Live tracked` shows how many draft rooms have been saved locally during the current data set.

## Where Badges Appear

Badges are injected inline next to visible player names in:

- the main player list
- the queue
- your current roster list

Underdog uses dynamic page rendering, so the extension continuously re-detects visible player rows as you scroll.

## Badge Meanings

Each player can show up to three badge types.

### Exposure Badge

Example:

```text
23%
```

This is the percentage of imported teams that already contain that player.

Hovering the `%` badge shows the raw count:

```text
12/52 teams
```

Use this to spot players you already have a lot of across your imported teams.

### Team Badge

Example:

```text
IND
```

This appears when the player is on an NFL team that already exists on your current draft roster.

Example:

- You drafted an `IND` player.
- Another `IND` player appears in the player list or queue.
- That player gets an `IND` badge.

Use this to quickly identify stack options or same-team concentration.

Roster rows do not show team badges because they are already part of your current roster.

### Combo Badge

Example:

```text
C5
```

`C#` shows the highest historical pair-combo count between that player and anyone currently on your roster.

Example current roster:

```text
Lamar Jackson
Bijan Robinson
```

Candidate player:

```text
Jayden Higgins
```

Historical CSV combos:

```text
Jayden Higgins + Lamar Jackson = 5 teams
Jayden Higgins + Bijan Robinson = 1 team
```

The badge shows:

```text
C5
```

Hovering the `C#` badge shows the matching combos:

```text
Combos: Lamar Jackson x5, Bijan Robinson x1
```

This is a pair-level signal. It does not mean every `C5` player has the same full roster construction.

## How To Use The Signals

Underdog Caddie is meant to answer fast draft-room questions:

- Am I taking this player too often?
- Am I creating another team with a pairing I already have a lot?
- Am I stacking a team I already started on this roster?
- Is this a good spot to diversify?

A practical read:

- High `%`: you already have a lot of this player.
- Team badge: this player matches a team already on your roster.
- High `C#`: this player frequently appears with someone already on your current roster.

## Troubleshooting

If badges do not appear:

1. Confirm the extension is enabled at `chrome://extensions`.
2. Confirm you loaded the `underdog-caddie` folder, not the parent project folder.
3. Import a fresh Underdog CSV.
4. Refresh the Underdog draft room.
5. Make sure you are on `underdogfantasy.com`.

If Chrome says the extension cannot load, check that `manifest.json` is directly inside the selected `underdog-caddie` folder.

If exposure looks stale, export a fresh CSV from Underdog and import it again.

## Privacy

Underdog Caddie stores data locally in `chrome.storage.local`.

It does not:

- upload your CSV
- send your rosters to a remote server
- modify your Underdog account
- change your original CSV file

## Current Limitations

Underdog can change its page structure at any time. If the draft room DOM changes, badge detection may need updates.

The extension reads visible player rows from the page. Rows that are not currently rendered by Underdog may not have badges until they appear.

Team badges depend on team data from the CSV or team codes visible in the row text.

Combo badges compare exact historical player pairings from imported CSV teams. They do not currently compare broader roster-construction archetypes.
