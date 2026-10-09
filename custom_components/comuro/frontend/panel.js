(() => {
  const PANEL_TAG = "comuro-panel";
  const API_BASE = "comuro";

  async function ensureHomeAssistantMap() {
    if (customElements.get("ha-map")) {
      return;
    }

    let helpers;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (typeof window.loadCardHelpers === "function") {
        helpers = await window.loadCardHelpers();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!helpers) {
      throw new Error(
        "Die Home-Assistant-Kartenkomponenten konnten nicht geladen werden."
      );
    }

    // The map card is lazy-loaded by Home Assistant. Creating it here forces
    // the current frontend to load the same map component used by Lovelace.
    helpers.createCardElement({ type: "map" });

    await Promise.race([
      customElements.whenDefined("ha-map"),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "Die Home-Assistant-Standardkarte konnte nicht geladen werden."
              )
            ),
          10000
        )
      ),
    ]);
  }

  class ComuroPanel extends HTMLElement {
    constructor() {
      super();

      this._hass = null;
      this._map = null;
      this._routes = [];
      this._selectedRoute = null;
      this._editingRouteId = null;
      this._drawing = false;
      this._points = [];
      this._editingAvailable = true;
      this._initialized = false;
    }

    set hass(value) {
      this._hass = value;
      if (this._map) {
        this._map.hass = value;
      }
    }

    set narrow(value) {
      this._narrow = value;
    }

    connectedCallback() {
      if (this._initialized) {
        return;
      }

      this._initialized = true;
      this._render();
      this._init();
    }

    disconnectedCallback() {
      this._map?.removeEventListener(
        "map-clicked",
        this._handleMapClick
      );
      this._map?.removeEventListener(
        "editable-location-moved",
        this._handleLocationMoved
      );
      this._map?.removeEventListener(
        "editing-available-changed",
        this._handleEditingAvailability
      );
      this._map = null;
    }

    async _init() {
      try {
        await ensureHomeAssistantMap();

        this._map = this.querySelector("#map");
        this._map.hass = this._hass;
        this._map.addEventListener(
          "map-clicked",
          this._handleMapClick
        );
        this._map.addEventListener(
          "editable-location-moved",
          this._handleLocationMoved
        );
        this._map.addEventListener(
          "editing-available-changed",
          this._handleEditingAvailability
        );

        this._map.paths = [];
        this._map.editableLocations = [];
        this._map.autoFit = false;
        this._map.clickable = true;
        this._map.themeMode = "auto";
        this._map.zoom = 12;

        await this._loadRoutes();
      } catch (error) {
        this._setStatus(
          "Die Home-Assistant-Karte konnte nicht geladen werden: " +
            (error?.message || error)
        );
      }
    }

    async _loadRoutes() {
      if (!this._hass?.callApi) {
        throw new Error("Home Assistant API ist noch nicht verfügbar.");
      }

      this._routes = await this._hass.callApi(
        "GET",
        API_BASE + "/routes"
      );
      this._renderRoutes();
    }

    _handleMapClick = (event) => {
      if (!this._drawing) {
        return;
      }

      const [latitude, longitude] = event.detail.location;
      this._points.push([longitude, latitude]);
      this._updateMap(false);
    };

    _handleLocationMoved = (event) => {
      if (!this._drawing) {
        return;
      }

      const index = Number(
        String(event.detail.id).replace("point-", "")
      );
      if (!Number.isInteger(index) || index < 0) {
        return;
      }

      const [latitude, longitude] = event.detail.location;
      if (!this._points[index]) {
        return;
      }

      this._points[index] = [longitude, latitude];
      this._updateMap(false);
    };

    _handleEditingAvailability = (event) => {
      this._editingAvailable = event.detail.available;
      this._updateEditingNotice();
    };

    _render() {
      this.innerHTML = `
        <style>
          :host {
            display: block;
            width: 100%;
            height: 100dvh !important;
            min-height: 100dvh;
            overflow: hidden;
            color: var(--primary-text-color);
            background: var(--primary-background-color);
          }

          .layout {
            display: grid;
            grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
            width: 100%;
            height: 100%;
            min-height: 0;
          }

          .sidebar {
            z-index: 2;
            overflow-y: auto;
            padding: var(--ha-space-4, 16px);
            box-sizing: border-box;
            background: var(--primary-background-color);
            border-inline-end: 1px solid var(--divider-color);
          }

          .header {
            display: flex;
            align-items: center;
            gap: var(--ha-space-3, 12px);
            margin: 0 0 var(--ha-space-4, 16px);
          }

          .header-icon {
            display: grid;
            place-items: center;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            color: var(--primary-color);
            background: var(--secondary-background-color);
          }

          .header-title {
            font-size: 20px;
            font-weight: 500;
          }

          .section-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 var(--ha-space-1, 4px) var(--ha-space-2, 8px);
            color: var(--secondary-text-color);
            font-size: 14px;
          }

          .route-list {
            display: grid;
            gap: var(--ha-space-2, 8px);
          }

          .route {
            padding: var(--ha-space-3, 12px);
            border: 1px solid var(--divider-color);
            border-radius: var(--ha-border-radius-md, 12px);
            background: var(--card-background-color);
          }

          .route.selected {
            border-color: var(--primary-color);
            background: color-mix(
              in srgb,
              var(--primary-color) 7%,
              var(--card-background-color)
            );
          }

          .route-main {
            display: flex;
            align-items: flex-start;
            gap: var(--ha-space-3, 12px);
          }

          .route-status {
            width: 8px;
            height: 8px;
            flex: 0 0 auto;
            margin-top: 6px;
            border-radius: 50%;
            background: var(--primary-color);
          }

          .route-status.off {
            background: var(--disabled-text-color);
          }

          .route-name {
            font-size: 14px;
            font-weight: 500;
            line-height: 1.35;
          }

          .route-meta {
            margin-top: 3px;
            color: var(--secondary-text-color);
            font-size: 12px;
            line-height: 1.4;
          }

          .actions {
            display: flex;
            flex-wrap: wrap;
            gap: var(--ha-space-2, 8px);
            margin-top: var(--ha-space-3, 12px);
          }

          button {
            min-height: 36px;
            padding: 0 14px;
            border: 0;
            border-radius: var(--ha-border-radius-pill, 18px);
            cursor: pointer;
            color: var(--primary-text-color);
            background: var(--secondary-background-color);
            font: inherit;
            font-size: 13px;
          }

          button:hover {
            background: var(--divider-color);
          }

          button.primary {
            color: var(--text-primary-color, #fff);
            background: var(--primary-color);
          }

          button.danger {
            color: var(--error-color);
          }

          .empty,
          .notice {
            padding: var(--ha-space-3, 12px);
            border-radius: var(--ha-border-radius-md, 12px);
            color: var(--secondary-text-color);
            font-size: 13px;
          }

          .empty {
            border: 1px dashed var(--divider-color);
          }

          .notice {
            margin-top: var(--ha-space-3, 12px);
            background: var(--secondary-background-color);
          }

          .editor {
            margin-top: var(--ha-space-4, 16px);
            padding: var(--ha-space-4, 16px);
            border: 1px solid var(--divider-color);
            border-radius: var(--ha-border-radius-md, 12px);
            background: var(--card-background-color);
          }

          .editor-title {
            margin-bottom: var(--ha-space-3, 12px);
            font-size: 15px;
            font-weight: 500;
          }

          .field {
            margin: var(--ha-space-3, 12px) 0;
          }

          .field-label {
            display: block;
            margin-bottom: 5px;
            color: var(--secondary-text-color);
            font-size: 12px;
          }

          input[type="text"],
          input[type="number"] {
            width: 100%;
            min-height: 40px;
            box-sizing: border-box;
            padding: 8px 10px;
            border: 1px solid var(--divider-color);
            border-radius: var(--ha-border-radius-md, 12px);
            outline: none;
            color: var(--primary-text-color);
            background: var(--primary-background-color);
            font: inherit;
          }

          input:focus {
            border-color: var(--primary-color);
            box-shadow: 0 0 0 1px var(--primary-color);
          }

          .check {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
          }

          .hint,
          .status {
            color: var(--secondary-text-color);
            font-size: 12px;
            line-height: 1.45;
          }

          .hint {
            margin: var(--ha-space-3, 12px) 0 0;
          }

          .status {
            margin: var(--ha-space-4, 16px) var(--ha-space-1, 4px);
          }

          comuro-panel {
            display: block !important;
            width: 100%;
            height: 100dvh !important;
            min-height: 100dvh;
            overflow: hidden;
          }

          .map-wrap {
            position: relative;
            min-width: 0;
            min-height: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: var(--primary-background-color);
          }

          ha-map {
            position: absolute;
            inset: 0;
            display: block;
            width: 100%;
            height: 100%;
          }

          @media (max-width: 900px) {
            .layout {
              grid-template-columns: 1fr;
              grid-template-rows: minmax(0, auto) minmax(360px, 1fr);
            }

            .sidebar {
              max-height: 52vh;
              border-inline-end: 0;
              border-bottom: 1px solid var(--divider-color);
            }
          }
        </style>

        <div class="layout">
          <aside class="sidebar">
            <div class="header">
              <div class="header-icon">⌖</div>
              <div class="header-title">Comuro</div>
            </div>

            <div class="section-title">
              <span>Routen</span>
              <span id="routeCount"></span>
            </div>

            <div id="routeList" class="route-list"></div>

            <div class="actions">
              <button id="newRoute" class="primary">
                ＋ Neue Route
              </button>
            </div>

            <div id="editor" class="editor" hidden>
              <div id="editorTitle" class="editor-title">
                Route zeichnen
              </div>

              <div class="field">
                <label class="field-label" for="routeName">Name</label>
                <input
                  id="routeName"
                  type="text"
                  maxlength="100"
                  placeholder="z. B. Arbeitsweg"
                >
              </div>

              <div class="field">
                <label class="field-label" for="buffer">
                  Puffer in Metern
                </label>
                <input
                  id="buffer"
                  type="number"
                  value="30"
                  min="0"
                  max="500"
                  step="1"
                >
              </div>

              <div class="field">
                <label class="check">
                  <input id="enabled" type="checkbox" checked>
                  <span>Route aktiv</span>
                </label>
              </div>

              <div id="editingNotice" class="notice" hidden></div>

              <div class="actions">
                <button id="save" class="primary">Speichern</button>
                <button id="undo">↩ Punkt zurück</button>
                <button id="cancel">Abbrechen</button>
              </div>

              <p class="hint">
                Im Zeichenmodus kannst du Punkte auf der Karte setzen.
                Beim Bearbeiten lassen sich die vorhandenen Punkte verschieben.
              </p>
            </div>

            <div id="status" class="status">
              Keine Route ausgewählt.
            </div>
          </aside>

          <main class="map-wrap">
            <ha-map
              id="map"
              clickable
              theme-mode="auto"
              zoom="12"
            ></ha-map>
          </main>
        </div>
      `;

      this.querySelector("#newRoute").addEventListener(
        "click",
        () => this._startNewRoute()
      );
      this.querySelector("#save").addEventListener(
        "click",
        () => this._saveRoute()
      );
      this.querySelector("#undo").addEventListener(
        "click",
        () => this._undoPoint()
      );
      this.querySelector("#cancel").addEventListener(
        "click",
        () => this._cancelEdit()
      );
    }

    _renderRoutes() {
      const container = this.querySelector("#routeList");
      const count = this.querySelector("#routeCount");

      container.innerHTML = "";
      count.textContent = this._routes.length
        ? String(this._routes.length)
        : "";

      if (!this._routes.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "Noch keine Route gespeichert.";
        container.appendChild(empty);
        return;
      }

      for (const route of this._routes) {
        const item = document.createElement("div");
        item.className =
          "route" +
          (this._selectedRoute?.id === route.id ? " selected" : "");

        const main = document.createElement("div");
        main.className = "route-main";

        const dot = document.createElement("span");
        dot.className =
          "route-status" +
          (route.enabled === false ? " off" : "");

        const body = document.createElement("div");
        body.style.minWidth = "0";
        body.style.flex = "1";

        const name = document.createElement("div");
        name.className = "route-name";
        name.textContent = route.name;

        const meta = document.createElement("div");
        meta.className = "route-meta";
        meta.textContent =
          "Puffer " +
          Number(route.buffer_m ?? 30) +
          " m · " +
          (route.enabled === false ? "inaktiv" : "aktiv");

        body.append(name, meta);
        main.append(dot, body);

        const actions = document.createElement("div");
        actions.className = "actions";

        const show = document.createElement("button");
        show.textContent = "Anzeigen";
        show.addEventListener(
          "click",
          () => this._selectRoute(route.id)
        );

        const edit = document.createElement("button");
        edit.textContent = "Bearbeiten";
        edit.addEventListener(
          "click",
          () => this._startEdit(route.id)
        );

        const remove = document.createElement("button");
        remove.className = "danger";
        remove.textContent = "Löschen";
        remove.addEventListener(
          "click",
          () => this._deleteRoute(route.id)
        );

        actions.append(show, edit, remove);
        item.append(main, actions);
        container.appendChild(item);
      }
    }

    _selectRoute(id) {
      const route = this._routes.find((item) => item.id === id);
      if (!route) {
        return;
      }

      this._selectedRoute = route;
      this._editingRouteId = null;
      this._drawing = false;
      this._points = route.coordinates.map((point) => [
        Number(point[0]),
        Number(point[1]),
      ]);

      this._hideEditor();
      this._setCursor(false);
      this._updateMap();
      this._renderRoutes();
      this._fitMapToRoute();
      this._setStatus('Route "' + route.name + '" ausgewählt.');
    }

    _startNewRoute() {
      this._selectedRoute = null;
      this._editingRouteId = null;
      this._drawing = true;
      this._points = [];

      this._showEditor(
        "Route zeichnen",
        "Speichern",
        "",
        30,
        true
      );
      this._setCursor(true);
      this._updateMap();
      this._renderRoutes();
      this._setStatus("Zeichenmodus aktiv.");
    }

    _startEdit(id) {
      const route = this._routes.find((item) => item.id === id);
      if (!route) {
        return;
      }

      this._selectedRoute = route;
      this._editingRouteId = id;
      this._drawing = true;
      this._points = route.coordinates.map((point) => [
        Number(point[0]),
        Number(point[1]),
      ]);

      this._showEditor(
        "Route bearbeiten",
        "Änderungen speichern",
        route.name,
        Number(route.buffer_m ?? 30),
        route.enabled !== false
      );

      this._setCursor(true);
      this._updateMap();
      this._renderRoutes();
      this._fitMapToRoute();
      this._setStatus('Bearbeitung von "' + route.name + '".');
    }

    _updateMap(autoFit = true) {
      if (!this._map) {
        return;
      }

      const pathPoints = this._points.map((point) => ({
        point: [point[1], point[0]],
        timestamp: new Date(),
      }));

      this._map.paths = this._points.length >= 2
        ? [
            {
              points: pathPoints,
              name: this._selectedRoute?.name ?? "Neue Route",
              color: "var(--primary-color)",
            },
          ]
        : [];

      this._map.editableLocations = this._drawing
        ? this._points.map((point, index) => ({
            id: "point-" + index,
            location: [point[1], point[0]],
            title: "Punkt " + (index + 1),
            color: "var(--primary-color)",
            locationEditable: true,
            activatable: false,
          }))
        : [];

      if (autoFit) {
        this._fitMapToRoute();
      }

      this._updateEditingNotice();
    }

    _fitMapToRoute() {
      if (!this._map || this._points.length < 1) {
        return;
      }

      if (this._points.length >= 2) {
        this._map.fitMap?.({
          padding: {
            top: 40,
            right: 40,
            bottom: 40,
            left: 40,
          },
        });
      }
    }

    _showEditor(
      title,
      saveLabel,
      name,
      buffer,
      enabled
    ) {
      const editor = this.querySelector("#editor");
      editor.hidden = false;

      this.querySelector("#editorTitle").textContent = title;
      this.querySelector("#save").textContent =
        "💾 " + saveLabel;
      this.querySelector("#routeName").value = name;
      this.querySelector("#buffer").value = buffer;
      this.querySelector("#enabled").checked = enabled;
      this._updateEditingNotice();
    }

    _hideEditor() {
      this.querySelector("#editor").hidden = true;
      this._updateEditingNotice();
    }

    _updateEditingNotice() {
      const notice = this.querySelector("#editingNotice");
      if (!notice || !this._drawing) {
        if (notice) {
          notice.hidden = true;
        }
        return;
      }

      if (this._editingRouteId && !this._editingAvailable) {
        notice.hidden = false;
        notice.textContent =
          "Diese Home-Assistant-Karte unterstützt auf diesem Gerät nur die " +
          "Anzeige. Die Routenpunkte sind hier nicht verschiebbar.";
        return;
      }

      notice.hidden = true;
    }

    _setCursor(drawing) {
      this._map?.style.setProperty(
        "--ha-map-clickable-cursor",
        drawing ? "crosshair" : ""
      );
    }

    async _saveRoute() {
      if (this._points.length < 2) {
        this._setStatus("Bitte mindestens zwei Punkte setzen.");
        return;
      }

      const name = this.querySelector("#routeName").value.trim();
      if (!name) {
        this._setStatus("Bitte einen Routennamen vergeben.");
        return;
      }

      const buffer = Number(
        this.querySelector("#buffer").value
      );
      const enabled = this.querySelector("#enabled").checked;

      if (
        !Number.isInteger(buffer) ||
        buffer < 0 ||
        buffer > 500
      ) {
        this._setStatus(
          "Der Puffer muss zwischen 0 und 500 Metern liegen."
        );
        return;
      }

      const payload = {
        name,
        coordinates: this._points,
        buffer_m: buffer,
        enabled,
      };

      const method = this._editingRouteId ? "PUT" : "POST";
      const url = this._editingRouteId
        ? API_BASE +
          "/routes/" +
          encodeURIComponent(this._editingRouteId)
        : API_BASE + "/routes";

      if (!this._hass?.callApi) {
        this._setStatus("Home Assistant API ist noch nicht verfügbar.");
        return;
      }

      let route;
      try {
        route = await this._hass.callApi(
          method,
          url,
          payload
        );
      } catch (error) {
        this._setStatus(
          error?.message ||
            "Route konnte nicht gespeichert werden."
        );
        return;
      }

      if (this._editingRouteId) {
        const index = this._routes.findIndex(
          (item) => item.id === this._editingRouteId
        );
        if (index >= 0) {
          this._routes[index] = route;
        }
      } else {
        this._routes.push(route);
      }

      this._selectedRoute = route;
      this._editingRouteId = null;
      this._drawing = false;
      this._points = route.coordinates.map((point) => [
        Number(point[0]),
        Number(point[1]),
      ]);

      this._hideEditor();
      this._renderRoutes();
      this._updateMap();
      this._setCursor(false);
      this._setStatus(
        'Route "' + route.name + '" gespeichert.'
      );
    }

    async _deleteRoute(id) {
      const route = this._routes.find((item) => item.id === id);
      if (!route) {
        return;
      }

      if (
        !window.confirm(
          'Route "' + route.name + '" wirklich löschen?'
        )
      ) {
        return;
      }

      if (!this._hass?.callApi) {
        this._setStatus("Home Assistant API ist noch nicht verfügbar.");
        return;
      }

      try {
        await this._hass.callApi(
          "DELETE",
          API_BASE +
            "/routes/" +
            encodeURIComponent(id)
        );
      } catch (error) {
        this._setStatus(
          error?.message ||
            "Route konnte nicht gelöscht werden."
        );
        return;
      }

      this._routes = this._routes.filter(
        (item) => item.id !== id
      );

      if (this._selectedRoute?.id === id) {
        this._selectedRoute = null;
        this._editingRouteId = null;
        this._drawing = false;
        this._points = [];
        this._updateMap();
        this._hideEditor();
        this._setCursor(false);
      }

      this._renderRoutes();
      this._setStatus("Route gelöscht.");
    }

    _undoPoint() {
      if (!this._drawing || !this._points.length) {
        return;
      }

      this._points.pop();
      this._updateMap(false);
    }

    _cancelEdit() {
      const selected = this._selectedRoute;

      this._drawing = false;
      this._editingRouteId = null;

      if (selected) {
        this._points = selected.coordinates.map(
          (point) => [
            Number(point[0]),
            Number(point[1]),
          ]
        );
      } else {
        this._points = [];
      }

      this._hideEditor();
      this._setCursor(false);
      this._updateMap();
      this._setStatus(
        selected
          ? 'Route "' + selected.name + '" ausgewählt.'
          : "Bearbeitung abgebrochen."
      );
      this._renderRoutes();
    }

    _setStatus(message) {
      const status = this.querySelector("#status");
      if (status) {
        status.textContent = message;
      }
    }
  }

  if (!customElements.get(PANEL_TAG)) {
    customElements.define(PANEL_TAG, ComuroPanel);
  }
})();
