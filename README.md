# Underdog Caddie

Underdog Caddie is a free local Chrome extension for Underdog Fantasy draft rooms. It imports your Underdog CSV exposure file and adds inline draft-room badges for player exposure, same-team roster context, and repeated historical combos.

The goal is simple: give drafters a fast, local, no-subscription way to understand what they already have while they are on the clock.

## Features

- Runs on `underdogfantasy.com` draft pages.
- Imports Underdog CSV exports as the exposure baseline.
- Stores data locally in `chrome.storage.local`.
- Tracks visible draft-room roster changes locally during a session.
- Adds inline badges to the main player list, queue, and current roster list.
- Shows exposure percentage for each detected player.
- Shows same-team badges when a candidate matches a team already on your roster.
- Shows `C#` combo badges for historical pairings with your current roster.

## Quick Install

1. Download or clone this project.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on Developer mode.
4. Click Load unpacked.
5. Select the `underdog-caddie` folder.
6. Click the extension icon and import your Underdog CSV.
7. Open an Underdog draft room.

See [USER_GUIDE.md](./USER_GUIDE.md) for the full install, import, and usage walkthrough.

## Badge Summary

- `%`: how often this player appears in your imported teams.
- Team code, such as `IND`: this player matches a team already on your current roster.
- `C#`: this player's strongest historical pair combo with someone on your current roster.

Hover the `%` badge for raw exposure count. Hover the `C#` badge for combo details.

## Data And Privacy

Underdog Caddie runs locally in your browser.

It does not upload your CSV, send rosters to a server, modify your Underdog account, or change your original CSV file.

## Development

This is a Manifest V3 Chrome extension. There is no build step.

To test local changes:

1. Open `chrome://extensions`.
2. Load the `underdog-caddie` folder as an unpacked extension.
3. After editing files, click Reload on the extension card.
4. Refresh the Underdog draft room.

## Limitations

Underdog uses dynamic DOM rendering and can change its page structure. Badge detection may need updates if Underdog changes draft-room markup.

Combo badges are pair-level historical signals based on imported CSV teams. They are not full roster-construction comparisons.
