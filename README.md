# Estanza 3D Floorplan Card for Home Assistant

## For AI agents

- **Install** through HACS: add `https://github.com/estanza-casa/estanza-card` as a custom repository of type Dashboard and download it. Or by hand: copy `estanza-card.js` from a release to `<config>/www/` and add `/local/estanza-card.js` as a dashboard resource of type `module`.
- **Configure** with `type: custom:estanza-card` and one of `share_url`, `share_id` or `home_document`. Every other key is optional; see [Configuration](#configuration).

  ```yaml
  type: custom:estanza-card
  share_url: https://estanza.casa/share/abc123
  show_cables: true
  bindings:
    - scope: { type: room, id: kitchen }
      area_id: kitchen
    - scope: { type: light, id: kitchen-pendant }
      entity_id: light.kitchen_pendant
  ```

- **Editor links carry over.** A light or a piece linked to an entity in the Estanza editor arrives linked, a piece with no entity takes its socket's, and a binding in the card wins.
- Set up and edit your home from your AI: https://estanza.casa/mcp/

A dashboard card that shows your Estanza home in Home Assistant, in 3D or as a floor plan, and brings it to life with your entities.

Turn on the kitchen light and the kitchen in the model lights up, in the colour and brightness the bulb reports. Open the front door and the door in the model swings open. Rooms show their temperature, and a room with motion or presence is outlined. Tap a light, a cover, a lock or a room to control it.

| 3D, light theme                                                                                                                    | 3D, dark theme                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| ![The 3D card in a light theme](https://raw.githubusercontent.com/estanza-casa/estanza-card/main/docs/images/card-3d-light.png)    | ![The 3D card in a dark theme](https://raw.githubusercontent.com/estanza-casa/estanza-card/main/docs/images/card-3d-dark.png)    |
| **Floor plan, light theme**                                                                                                        | **Floor plan, dark theme**                                                                                                       |
| ![The floor plan in a light theme](https://raw.githubusercontent.com/estanza-casa/estanza-card/main/docs/images/card-2d-light.png) | ![The floor plan in a dark theme](https://raw.githubusercontent.com/estanza-casa/estanza-card/main/docs/images/card-2d-dark.png) |

The screenshots show Casa Aurora, the Estanza demo home.

## Our commitments

> The card is 100% free, forever, in full, and the rendered scene carries no watermark on any tier.

> The card only contacts Estanza to fetch your home from your share link. No telemetry.

## Install

The card installs through HACS as a custom repository. It ships as one file, `estanza-card.js`, loaded as a dashboard resource of type `module`.

### HACS, one click

[Open this repository in HACS on your Home Assistant](https://my.home-assistant.io/redirect/hacs_repository/?owner=estanza-casa&repository=estanza-card&category=plugin). Confirm your Home Assistant address when asked, then press **Download**.

### HACS, by hand

1. In Home Assistant, open **HACS**.
2. Open the three-dot menu in the top right corner and choose **Custom repositories**.
3. Paste `https://github.com/estanza-casa/estanza-card`, pick **Dashboard** as the type and press **Add**.
4. Search HACS for **Estanza 3D Floorplan Card**, open it and press **Download**.
5. Reload the browser when HACS asks. HACS registers the dashboard resource for you.

### Manual install

1. Download `estanza-card.js` from a release.
2. Copy it to `<config>/www/estanza-card.js`. Create the `www/` folder if it does not exist. Files in `www/` are served under `/local/`.
3. If you just created `www/`, restart Home Assistant now (**Settings → System**, the power button, **Restart Home Assistant**). Home Assistant only serves `www/` if it existed at startup. Without the restart, `/local/estanza-card.js` returns 404 and the card never loads. To check, open `/local/estanza-card.js` in the browser: you should see code.
4. Add the resource. Go to **Settings → Dashboards**, open the three-dot menu, then **Resources** (or go to `/config/lovelace/resources`). Press **Add resource**, enter `/local/estanza-card.js`, pick **JavaScript module** and press **Create**.

   If you manage resources in YAML, add this to `configuration.yaml` and restart:

   ```yaml
   lovelace:
     resource_mode: yaml
     resources:
       - url: /local/estanza-card.js
         type: module
   ```

5. Hard-refresh the browser. Home Assistant caches resources hard, and a stale cache looks like a broken card.

### Add the card to a dashboard

We recommend a dashboard of its own, so your home gets its own entry in the sidebar.

1. Open **Settings → Dashboards**, press **Add dashboard** and choose **New dashboard from scratch**.
2. Enter the title `Estanza`, pick the icon `mdi:home-outline`, leave **Add to sidebar** on and press **Create**.
3. Open the new dashboard and press the pencil in the top right corner. On a narrow screen it is **Edit dashboard** in the three-dot menu.
4. A new dashboard starts with a sections view, which cannot be changed to another type. Add a Panel view so the card fills the screen: press **+** next to the view name, choose **Panel (single card)** under Layout and press **Save**.
5. In the Panel view, press **Add card**, open the **By card** tab, search for `Estanza` and pick it. Link your home (see below) and press **Save**.
6. Optionally, delete the empty sections view (pencil next to its name, **Delete view**). Press **Done**.

A Panel view turns on the [wall tablet](#wall-tablet) layout. Set `tablet: off` to keep the normal card.

To use an existing dashboard instead, edit it, press **+** inside a section, open **By card** and pick **Estanza**. In a section the card is as wide as the section.

## Link your home

The visual editor does all of this. You never need to write YAML.

1. **Add your home.** Paste your share link from Share on estanza.casa into **Share link or ID** (the id alone also works). To run fully offline, press **Load home file** and pick an exported `.json` instead.
2. **Tap a thing in the plan.** The editor draws your home with a mark on every light, door, window and device. Tap a room, light, door or window to open a picker.
3. **Pick an entity.** The picker lists only entities that fit, best match first, matched by name and by area. Each row shows the entity's area and live state. For a room you can pick its Home Assistant area: every light in it then drives the room, and its temperature and humidity sensors are found automatically.
4. **Check the list below the plan.** Linked things are grouped by floor and room. Things not linked yet show a suggested match, and one button links every suggestion at once. It never replaces a link you made.

### Links made in the Estanza editor

A light or a piece of furniture you linked to an entity in the Estanza editor arrives linked in the card, with no setup. A piece with no entity of its own takes the one on the socket it owns. A link set in the card always wins over the one from Estanza. This works with a share link and with a loaded home file.

## What the card shows

| Scope    | Reads                                                                          | Shows                                                         |
| -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `light`  | `light.*`, then `switch.*`                                                     | On and off, in the reported colour and brightness.            |
| `room`   | Every entity of its area, plus any you list                                    | Its lights follow, and its temperature shows.                 |
| `door`   | `binary_sensor.*` (door, garage door, opening), `cover.*` (door, garage, gate) | The door swings open, part way for a cover with a position.   |
| `prop`   | Any entity; `climate.*`, then a temperature `sensor.*` for temperature         | A mark, and its temperature on its room if the room has none. |
| `window` | `binary_sensor.*` (window), then `cover.*`                                     | The sashes open, part way for a cover with a position.        |

- A 3D model you uploaded to Estanza is drawn from your share link. Until it arrives, and in a home loaded from a file, it shows as a plain box of its size.
- A door with no linked entity is drawn closed.
- An `unavailable` entity leaves its thing dark and drawn faint.
- A light with a colour uses it. A light with only a colour temperature uses the nearest warm, neutral or cool white. A lit lamp spills its colour on the floor and walls.
- **Temperatures** show as a small pill in each room. A room outside the comfort band (18 to 26 °C by default) wins when two pills compete for space. `temperature_tint: true` tints cold rooms navy and hot rooms red.
- **Occupancy**: a room with an occupancy, motion or presence `binary_sensor` on is outlined.
- **Day and night**: with `night: auto` the 3D scene follows the real sun from `sun.sun`, including its direction. Without a Home Assistant location or `sun.sun`, it uses the browser clock (night from 20:00 to 07:00).
- **Quality**: the 3D view starts at full quality and steps down on its own if the device is slow. Set `quality` to pick a tier yourself.
- **Theme**: the controls, sheets and floor plan paper follow your Home Assistant theme, light or dark.

### Floors

A home with several storeys gets a floor stack on the left: one button per storey plus **All floors**, which pulls the storeys apart so you can see every one. With one storey in view, the others are shown faint, or hidden with `other_floors: hidden`. A dot on a storey button means a light is on there or something needs a look. The card first opens on the storey with the most linked things, then remembers your choice in this browser.

### Floor plan

The **2D** and **3D** buttons in the top left switch views. The plan shows lit rooms, open doors and windows, temperatures, occupancy and alerts, and works with the floor stack. The card opens on 3D unless you set `default_view: 2d`, and remembers your choice in this browser.

### Tile

In a sections view, resize the card to two or three rows and it becomes a small still floor plan. It shows lit rooms, alerts and a count of lights on. A tap opens `navigation_path` if set, otherwise the house in a dialog.

### Alerts

The card reads alerts from the entities you linked. A room linked to its area picks up that area's sensors on its own.

| Alert                    | Source                                           | Severity |
| ------------------------ | ------------------------------------------------ | -------- |
| Leak                     | `binary_sensor` with device class `moisture`     | Critical |
| Smoke                    | `smoke`                                          | Critical |
| Gas                      | `gas` or `safety`                                | Critical |
| Alarm                    | an `alarm_control_panel` in state `triggered`    | Critical |
| Door or window left open | open longer than `open_alert_after` (10 minutes) | Notice   |
| Problem                  | `problem`                                        | Notice   |

A critical alert turns its room red, adds a pin and a banner, and moves the card to that room. An alarm panel with no area covers the whole house. A notice gets a quiet pin and never moves the card. An armed alarm shows a shield.

## Tap to control

Every action goes through Home Assistant in your browser, with your own login. Nothing reaches Estanza.

| Gesture | Light or switch                    | Cover                       | Lock                                        | Room                 | Any other device            |
| ------- | ---------------------------------- | --------------------------- | ------------------------------------------- | -------------------- | --------------------------- |
| Tap     | Toggles it                         | `cover.toggle`              | Asks you to tap again within 4 s to confirm | Opens the room sheet | Home Assistant's own dialog |
| Hold    | Brightness, power, whites and more | Position, open, stop, close | Home Assistant's own dialog                 | The same room sheet  | Nothing                     |

- **Any other device** is anything linked to a light or a piece of furniture that the card cannot switch itself: a media player, a thermostat, a fan, a camera, a sensor, a vacuum, a scene or a script. It gets a mark with its own icon, and a tap opens Home Assistant's dialog for it, which holds that device's own controls. Its state shows in the room sheet.
- A piece linked only to a thermostat or a temperature sensor gets no mark when its room already shows a temperature. Its reading is in the room's pill, and the room sheet lists it.

- The room sheet has one switch for all the room's lights, its temperature and humidity, and its devices, doors and windows.
- The thing changes at once. If Home Assistant refuses the call or does not confirm it within 5 seconds, it goes back and a message offers to try again.
- A drag rotates the view and never toggles anything.
- With a mouse, a right-click is a hold. A right-click on empty space does nothing.
- Every mark works with the keyboard: Tab to move, Enter or Space to tap, Shift+F10 or the menu key to hold.
- A window with only a sensor cannot be opened from the card. Link a cover to open it.
- `interaction: none` makes the card read only. You can still rotate the view.
- `prefers-reduced-motion` is respected.

### Choose what a tap and a hold do

In the editor, open a linked thing's picker and set **On tap** and **On hold**. Every thing also offers **Show details** and **Nothing**.

| Thing         | Its own actions                                         |
| ------------- | ------------------------------------------------------- |
| Light, switch | Turn on or off; on hold, also show controls             |
| Cover         | Open or close, open, close; on hold, also show controls |
| Lock          | Lock or unlock, lock, unlock, always with a confirm tap |
| Room          | Show the room, turn its lights on or off                |
| Other device  | Show details by default, or nothing                     |
| Sensor only   | None, only details or nothing                           |

In YAML the editor writes Home Assistant's usual action format:

```yaml
- scope:
    type: door
    id: garage-door
  entity_id: cover.garage
  tap_action:
    action: perform-action
    perform_action: cover.open_cover
  hold_action:
    action: more-info
```

An action the thing cannot do falls back to its default. An action type the card does not know does nothing.

### Every Home Assistant action

A binding takes `tap_action`, `hold_action` and `double_tap_action`, in the same format as Home Assistant's own cards. The card hands every action it does not run itself to Home Assistant's own action handler, so they behave exactly as they do on a core card. The editor shows an action it has no choice for as **Set in YAML** and leaves it alone.

`toggle` switches the thing, as a plain tap does.

```yaml
tap_action:
  action: toggle
```

`more-info` opens Home Assistant's dialog for the thing, or for `entity` when you set one.

```yaml
tap_action:
  action: more-info
  entity: camera.front_door
```

`perform-action` runs any action with its `data` and `target`. With no `data` or `target`, `cover.open_cover`, `cover.close_cover`, `lock.lock` and `lock.unlock` act on the thing's own entity and show their progress on the mark.

```yaml
tap_action:
  action: perform-action
  perform_action: climate.set_temperature
  target:
    entity_id: climate.living_room
  data:
    temperature: 21
```

`navigate` opens another dashboard or panel. `navigation_replace: true` replaces the page in the browser history.

```yaml
tap_action:
  action: navigate
  navigation_path: /lovelace/kitchen
  navigation_replace: false
```

`url` opens a link in a new tab.

```yaml
tap_action:
  action: url
  url_path: https://www.home-assistant.io
```

`assist` opens Assist, with the pipeline you name.

```yaml
hold_action:
  action: assist
  pipeline_id: last_used
  start_listening: true
```

`fire-dom-event` sends an `ll-custom` event that carries the whole action. Popup tools such as [browser_mod](https://github.com/thomasloven/hass-browser_mod) listen for it, so a tap can open any card in a popup, a camera feed or your fridge's own card:

```yaml
tap_action:
  action: fire-dom-event
  browser_mod:
    service: browser_mod.popup
    data:
      title: Front door
      content:
        type: picture-entity
        entity: camera.front_door
```

`none` does nothing.

```yaml
hold_action:
  action: none
```

`double_tap_action` takes any of these. A thing with one waits a quarter of a second after a tap for a second tap. A thing without one acts on the first tap at once.

```yaml
double_tap_action:
  action: navigate
  navigation_path: /lovelace/cameras
```

`confirmation` works on any action and opens Home Assistant's own dialog. `true` asks whether to run the action, `text` sets the question, `title`, `confirm_text` and `dismiss_text` label the dialog, and `exemptions` lists the users who are never asked.

```yaml
tap_action:
  action: toggle
  confirmation:
    text: Turn off the freezer?
    exemptions:
      - user: 0123456789abcdef0123456789abcdef
```

A lock or a garage door with `confirmation` asks in this dialog instead of waiting for a second tap. An action Home Assistant runs does not show its progress on the mark.

## Wall tablet

In a Panel view the card becomes a wall tablet: the house fills the screen and the controls get larger. `tablet: on` turns this on in any view, `tablet: off` turns it off.

- After `idle_seconds` without a touch (45 by default), open sheets close and the view returns to its start position.
- To protect the screen from burn-in, the view shifts slightly every 15 minutes.
- From `late_night` (23:00 by default) until 06:00, while idle, the scene dims and temperatures hide. Alerts are never dimmed.
- A critical alert keeps the tablet on its room.

## Configuration

The editor writes this for you. Here is the YAML if you prefer it.

```yaml
type: custom:estanza-card
share_url: https://estanza.casa/share/abc123
title: Ground floor
bindings:
  - scope:
      type: room
      id: kitchen
    area_id: kitchen
  - scope:
      type: light
      id: sofa-lamp
    entity_id: light.living_room_lamp
  - scope:
      type: door
      id: patio-door
    entity_id: binary_sensor.patio_door
  - scope:
      type: prop
      id: hall-thermostat
    entity_id: climate.hall
registry_ids:
  binary_sensor.patio_door: 4e1f0c2a9b7d4c8e8a36d51b0f2c7e91
  climate.hall: 9a02c4d7e5b14f3c8d2e61a7b0c9f834
  light.living_room_lamp: 1ceecefa14bb86f177229053abd5b0ef
```

| Key                | Default                    | Meaning                                                                                           |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `share_url`        |                            | Your home's Estanza share link.                                                                   |
| `share_id`         |                            | The share id on its own. Use `share_url` or `share_id`, not both.                                 |
| `home_document`    |                            | A home file exported from Share. Renders offline. Wins over a share link.                         |
| `title`            | none                       | Heading above the scene.                                                                          |
| `api_origin`       | `https://api.estanza.casa` | Estanza API to load the home from.                                                                |
| `models_origin`    | `https://app.estanza.casa` | Site serving the furniture models under `/assets/props/`.                                         |
| `interaction`      | `control`                  | `control` lets taps work the home; `none` makes the card read only.                               |
| `bindings`         | none                       | Which thing in the home is which entity. See below.                                               |
| `spill`            | `wash`                     | How far a lit lamp's colour reaches: `wash`, `pool` (floor only) or `off`.                        |
| `night`            | `auto`                     | When the 3D scene is night: `auto` follows the sun, `day` never, `night` always.                  |
| `quality`          | `auto`                     | 3D quality: `auto`, `full`, `sharp`, `balanced` or `saver`.                                       |
| `other_floors`     | `ghosted`                  | How other storeys show when one is in view: `ghosted` or `hidden`.                                |
| `comfort_min`      | 18 °C                      | Lowest comfortable temperature, in your unit.                                                     |
| `comfort_max`      | 26 °C                      | Highest comfortable temperature, in your unit.                                                    |
| `temperature_tint` | `false`                    | Tint cold rooms navy and hot rooms red.                                                           |
| `show_cables`      | `false`                    | Draw cable runs, their lengths and their endpoints on the 2D plan.                                |
| `default_view`     | `3d`                       | `3d` opens on the house, `2d` on the floor plan.                                                  |
| `tablet`           | `auto`                     | Wall tablet layout: `auto` in a Panel view, `on` always, `off` never.                             |
| `idle_seconds`     | 45                         | Seconds without a touch before a wall tablet returns to its start view.                           |
| `late_night`       | `23:00`                    | Time (`HH:MM`) a wall tablet dims for the night, or `off`.                                        |
| `open_alert_after` | 10                         | Minutes a door or window may stay open before it is flagged.                                      |
| `registry_ids`     | none                       | Stable registry id per linked entity, so renamed entities keep their links. The editor writes it. |
| `navigation_path`  | none                       | Where a tap on the tile goes. Without it, the tile opens the house in a dialog.                   |
| `grid_options`     | none                       | Home Assistant's `rows` and `columns` in a sections view. Two or three rows make the tile.        |

A card with no home shows "No home configured" until you add one.

### Bindings

Each binding links one thing in the home to one or more entities.

| Key                     | Meaning                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `scope.type`            | `light`, `room`, `door`, `prop` (an object such as a thermostat) or `window`.            |
| `scope.id`              | The thing's id in the Estanza home.                                                      |
| `area_id`               | Link every entity of a Home Assistant area. The usual form for a room.                   |
| `entity_id`             | Link one entity.                                                                         |
| `entity_ids`            | Link several entities.                                                                   |
| `temperature_entity_id` | The room's thermometer, when the automatic choice is wrong.                              |
| `humidity_entity_id`    | The room's hygrometer, when the automatic choice is wrong.                               |
| `tap_action`            | What a tap does. See [Tap to control](#tap-to-control).                                  |
| `hold_action`           | What a hold does.                                                                        |
| `double_tap_action`     | What a double tap does. See [Every Home Assistant action](#every-home-assistant-action). |

A binding needs `area_id`, `entity_id` or `entity_ids`. Bindings on the same thing are merged. A binding on a light wins over the binding on its room. A thing with no binding here uses the entity linked to it in the Estanza editor, if any. A device whose tap and hold both do nothing has no mark, so `tap_action: { action: none }` hides it.

A room takes its temperature from `temperature_entity_id` first, then a temperature sensor among its own entities, then the one its area names, then the first one in its area. Humidity works the same way. Set these two keys in YAML; the editor keeps them.

### Renamed entities

The editor stores each linked entity's registry id in `registry_ids`. If you rename an entity, for example `light.kitchen` to `light.kitchen_ceiling`, the card keeps working and the editor offers to update the link. A deleted entity is listed in the editor as not found, so you can pick another. Rooms linked to an area pick up renames on their own. Older configs without `registry_ids` keep working and gain the ids on the next save. If your Home Assistant user cannot read the entity registry, the card uses entity ids only.

## Privacy

Your entities, their states and your Home Assistant login never leave your browser. The card reads them from Home Assistant and draws them locally.

**With a share link**, the card fetches your home's geometry from `GET /v1/integrations/home-assistant/<token>` on the Estanza API. The request carries the token and the card version (in an `X-Estanza-Card` header), nothing else. No entity, area or state is ever sent. The card checks again every 5 minutes and when the page comes back into view, using an `ETag`, so an unchanged home costs almost nothing. It never checks while the page is hidden. A 3D model you uploaded is fetched from `GET /v1/integrations/home-assistant/<token>/models/<id>`, with no cookie. Estanza counts card loads per home per day, with the country the request came from. Your IP address is never stored.

**With a pasted home file** (`home_document`), the card sends no request to Estanza at all.

In both cases the furniture models are fetched by file name from the Estanza web app, which serves the same public CC0 models to everyone. Point `models_origin` at your own copy and the card never touches the public internet. Point `api_origin` at your own Estanza instance to fetch the home from there.

A share link is a still snapshot of your home's shape. Anyone who opens it on the web sees the walls, rooms and furniture, never your lights, doors or temperatures. Live state only exists inside your own Home Assistant.

There is no tracking code in this repository.

## Updating

1. New versions show under **Settings → Updates**. Install the update through HACS.
2. Reload the browser tab with your dashboard.
3. In the Home Assistant companion app, open **Settings → Companion app**, use **Reset frontend cache**, then open the dashboard again.

The card editor footer shows the running version, and the browser console prints `ESTANZA-CARD v…` when the card loads.

When a newer card is suggested, the editor shows "A newer Estanza card is available in HACS." When your home needs a newer card, the card shows "This home needs a newer Estanza card. Update it in HACS." instead of the home.

HACS does not update a card you installed by hand. A card loaded from `/local/` shows a quiet line under the home when a newer card is out, with a link to the release. To update, download the new `estanza-card.js` from that release, replace the file in `<config>/www/`, and reload the dashboard. Dismissing the line hides it until the next release.

## Troubleshooting

- **The card does not load after a manual install.** Open `/local/estanza-card.js` in the browser. A 404 means Home Assistant needs a restart because `www/` was created after it started.
- **The card looks broken after an update.** Hard-refresh the browser, or reset the frontend cache in the companion app.
- **"Could not read this link. Copy the share link again in Estanza".** The share was unpublished or the link is wrong. A republished home arrives within 5 minutes, or when the dashboard comes back into view.
- **"Furniture could not be loaded".** `models_origin` did not return models. The card draws the home without furniture and logs the address it tried in the browser console.
- **A message instead of the scene.** Your browser has no WebGL.

## Development

Building the card and running its tests needs five of Estanza's private packages, so you cannot build it outside the Estanza team. Outside contributions are welcome as issues. Every release ships the built `estanza-card.js`, which includes everything it needs.

With those packages in place:

```bash
corepack pnpm install
corepack pnpm lint:fix
corepack pnpm check
```

`check` runs `lint:check`, `format:check`, `typecheck`, `test` and `build`, and stops at the first failure. Run it before every commit; this repository has no CI. `build` writes `dist/estanza-card.js`.

### Releasing

1. Run `corepack pnpm release <patch|minor|major>` from a clean `main`. Add `--dry-run` first to see what it would do.
2. Bump `LATEST_CARD_VERSION` in the Estanza api (`apps/api/src/app/modules/integration/integration.service.ts`) to the version you just released, and ship that change. Cards installed by hand learn about a release only from that constant. Bump it after the release exists, so the link the card shows never points at a missing release.

`release` reads that constant from an Estanza checkout next to this one (`../estanza`) and, when it does not match the release, ends by printing `Bump LATEST_CARD_VERSION in the estanza api to <version>`. Without that checkout it prints the reminder every time.

### A local Home Assistant

`dev/` runs a real Home Assistant in Docker with fake entities for every room of Casa Aurora and a dashboard with the card already linked. It needs Docker and the same private packages. It makes no requests to Estanza.

```bash
corepack pnpm ha:up        # start Home Assistant and serve the card; Ctrl-C stops the card server
corepack pnpm ha:down      # undo renames and deletions, then stop and remove the container
corepack pnpm ha:scenario  # drive the house through an evening, printing each step
corepack pnpm ha:scenario alert leak          # also smoke, gas, safety, problem
corepack pnpm ha:scenario clear leak          # or alarm, or all
corepack pnpm ha:scenario alarm triggered     # or armed_away, armed_home, disarmed
corepack pnpm ha:scenario door-left-open d1 12  # open a door and back-date it 12 minutes
corepack pnpm ha:scenario window-left-open win4 15
corepack pnpm ha:scenario rename light.kitchen_light light.kitchen_ceiling  # rename in the registry
corepack pnpm ha:scenario delete binary_sensor.window_win1                  # remove from the registry
corepack pnpm ha:card      # serve the card again when Home Assistant is already up
corepack pnpm ha:share republish  # change the home the stub share link serves; also publish, revoke
corepack pnpm ha:share verdict required  # the update verdict the stub answers; also ok, suggested
```

- **URL:** `http://127.0.0.1:<port>/estanza-dev/casa-aurora`. `ha:up` prints the port (8123 when free). Other tabs show the card without tablet mode, with a short idle time, through a stub share link, in sections and masonry views, and a Controls tab to flip every entity by hand.
- **Login:** `dev` / `estanza-dev`. The instance is bound to `127.0.0.1` only.
- **Live reload:** Home Assistant loads the card from the Vite dev server (port 5199, or a free one). Save a file in `src/` and reload the browser.
- **Reset:** run `ha:down` and delete `dev/ha-config/`. `ha:up` is safe to run again.
- **More entities:** add YAML to `dev/ha-template/packages/extra.yaml` and run `ha:up` again. A template entity needs a `unique_id` before you can give it an area.
- **Several clones** can each run their own Home Assistant side by side.
- **Home Assistant version** is pinned in `dev/compose.yaml`. Bump it on purpose, never to `latest` or `stable`.

Each room gets entities backed by helpers, so every state can be flipped from the UI or the REST API. Door and window ids match the home file, so `binary_sensor.door_d1` is the front door `d1`. A restart resets the house to lights off, doors shut and heating off.

| Entity                                  | Backed by                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `light.<room>_light`, colour and dimmer | `input_boolean.<room>_light_on`, `input_number` brightness, hue and saturation               |
| `sensor.<room>_temperature`             | `input_number.<room>_temperature`                                                            |
| `sensor.<room>_humidity`                | `input_number.<room>_humidity`                                                               |
| `binary_sensor.door_<id>`, one per door | `input_boolean.door_<id>_open`                                                               |
| `cover.door_d7`, the garage door        | `input_number.door_d7_position`                                                              |
| `binary_sensor.window_<id>`             | `input_boolean.window_<id>_open`                                                             |
| `climate.living_room_thermostat`        | `generic_thermostat` over `input_boolean.living_room_heater` and the living room temperature |
| `lock.door_d1`, the front door lock     | `input_boolean.door_d1_locked`                                                               |
| `switch.living_room_television`, a plug | `input_boolean.living_room_television_on`, bound to the living room television               |

The dev instance also has alert sensors (leak, smoke, gas, safety, problem, and a house alarm with no area). Because Home Assistant cannot back-date a state change, a dev-only service, `estanza_dev.backdate`, powers the left-open helpers.

## Licence

MIT, see [LICENSE](LICENSE).

Home Assistant is a trademark of the Open Home Foundation. This project is not affiliated with or endorsed by the Open Home Foundation.
