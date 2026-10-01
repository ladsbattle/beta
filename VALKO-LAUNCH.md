# Valko Launch Plan

Valko is not enabled yet, but his place in this project is reserved. Use this file when his official release is confirmed.

## Do not proceed until confirmed

Obtain the final values below from the maintainer. Do not infer them from placeholders.

- Metal Orbit maximum level
- Valko's final display name and character order
- Companion short names in display order
- Corresponding card names and published Google Sheets rows
- One transparent PNG portrait per companion
- Final Metal theme color, if the existing placeholder color should change
- Release date and Version History text

## Current reserved state

- `js/catalog.js`
  - `CHARACTER_RELEASES` contains `敖尹: false`; this single flag controls both Valko and the Metal Orbit.
  - `LIMITS` contains `金屬: 120` as the current confirmed maximum level.
  - `ORBIT_LABEL` already contains `金屬`.
  - `CHARACTER_CATALOG` contains 敖尹 after 夏以晝 with the five-star companion `夜行狼王` and four-star companion `刃影`; the character remains hidden.
  - Orbit and Endless Challenge share-link logic can already use `orbit=金屬` and an exact `companion` value; do not add a Valko-only URL parameter.
- `index.html`
  - The Metal Orbit button is intentionally absent.
- `css/styles.css`
  - Metal theme tokens and generic `data-theme="金屬"` selectors already exist.
- `assets/companions/`
  - The portraits for `夜行狼王`, `刃影`, and any later Valko companions are not present.
- `UI-SYSTEM.md`
  - Valko is documented as a future character, but Metal is not yet listed as an active Orbit.

## Implementation order

1. Update the Orbit and Endless Challenge worksheets without changing their column order. Verify the published CSV contains the exact final Orbit, card, and companion names.
2. In `js/catalog.js`:
   - confirm the Metal `maxLevel` value;
   - set `CHARACTER_RELEASES['敖尹']` to `true`; this reveals both Valko and the Metal Orbit;
   - preserve `夜行狼王` and `刃影`, then add any later companion short names to `companions` with their confirmed `rarity`; five-star companions need an explicit `order` that follows release order, display before four-star companions, and become Endless Challenge options automatically. Four-star companions do not need `order` and use automatic name sorting.
3. Confirm that the catalog-generated `金屬` Orbit button appears immediately after `引力`.
4. In `css/styles.css`:
   - confirm or replace `--col-metal`, `--col-metal-bg`, and `--col-metal-border`;
   - no companion-name selector needs to be added; cards, badges and scores inherit `data-theme="金屬"` from the catalog.
5. Add each portrait to `assets/companions/<companion short name>.png`. The filename must exactly match both Google Sheets and `CHARACTER_CATALOG`.
6. Update `UI-SYSTEM.md` so Metal is an active Orbit and Valko is an active character.
7. Add the release entry to the Version History worksheet.
8. Change the CSS and JS `?v=` cache versions in `index.html`; update `sitemap.xml` `lastmod` for the release.

## Preserve

- Do not change the Google Sheets column order documented in `README.md`.
- Do not rename `ladsbattle_local_folder_v1`; existing favorites and browsing history must remain available.
- Keep Valko after 夏以晝 in the character order.
- Keep the existing desktop and mobile filter geometry unless the maintainer requests a redesign.
- Do not use temporary companion names or guessed portraits in production.

## Acceptance checklist

- Metal Orbit appears after Gravity Orbit and uses the approved Metal theme.
- Quick ranges stop at the confirmed maximum; exact and manual level boundaries are correct.
- Valko appears after 夏以晝; companions appear in the supplied order with correct portraits.
- Orbit and Endless Challenge results match the published CSV.
- Card, companion, Stella, video-only, reset, and advanced-filter behavior remain correct.
- Shared URLs restore Metal Orbit exact levels and Valko companion searches.
- Desktop and mobile layouts have no unexpected movement, overflow, missing images, or placeholder names.
- Existing non-Valko searches, detail views, favorites, and browsing history still work.
- JavaScript syntax check passes and the browser console has no errors.
- After deployment, verify the production URL directly; local preview is not deployment acceptance.
