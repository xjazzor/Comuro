(() => {
  const PANEL_TAG = "comuro-panel";
  const API_BASE = "/api/comuro";

  function loadStyle(href) {
    if (document.querySelector('link[data-comuro-href="' + href + '"]')) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.comuroHref = href;
      link.onload = resolve;
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }

  function loadScript(src, globalName) {
    if (globalName && window[globalName]) {
      return Promise.resolve(window[globalName]);
    }
    const existing = document.querySelector(
      'script[data-comuro-src="' + src + '"]'
    );
    if (existing) {
      return new Promise((resolve, reject) => {
        const check = () => {
          if (!globalName || window[globalName]) {
            resolve(window[globalName]);
          } else {
            reject(new Error("Comuro dependency did not load: " + src));
          }
        };
        existing.addEventListener("load", check, { once: true });
        existing.addEventListener("error", reject, { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.dataset.comuroSrc = src;
      script.onload = () => resolve(globalName ? window[globalName] : undefined);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  class ComuroPanel extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._map = null;
      this._leafletReady = null;
      this._routes = [];
      this._selectedRoute = null;
      this._editingRouteId = null;
      this._drawing = false;
      this._points = [];
      this._routeLine = null;
      this._initialized = false;
    }

    set hass(value) {
      this._hass = value;
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

    async _init() {
      try {
        await Promise.all([
          loadStyle("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"),
          loadScript(
            "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
            "L"
          ),
        ]);

        this._leafletReady = true;
        this._map = window.L.map(this.querySelector("#map")).setView(
          [51.5136, 7.4653],
          12
        );

        window.L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
          {
            maxZoom: 20,
            attribution:
              '&copy; OpenStreetMap-Mitwirkende &copy; CARTO',
          }
        ).addTo(this._map);

        this._map.on("click", (event) => {
          if (!this._drawing) {
            return;
          }
          this._points.push([
            event.latlng.lat,
            event.latlng.lng,
          ]);
          this._redrawRoute();
        });

        await this._loadRoutes();
      } catch (error) {
        this._setStatus(
          "Die Kartenbibliothek konnte nicht geladen werden: " +
            (error?.message || error)
        );
      }
    }

    _render() {
      this.innerHTML = `
        <style>
          :host {
            display: block;
            height: 100%;
            --comuro-border: var(--divider-color, #ddd);
            --comuro-card: var(--ha-card-background, var(--card-background-color, #fff));
            --comuro-text: var(--primary-text-color, #111);
            --comuro-secondary: var(--secondary-text-color, #666);
          }

          .layout {
            display: grid;
            grid-template-columns: 380px minmax(0, 1fr);
            height: 100%;
            min-height: 0;
          }

          .sidebar {
            z-index: 10;
            overflow: auto;
            padding: 20px;
            background: var(--primary-background-color, #fafafa);
            border-right: 1px solid var(--comuro-border);
          }

          .title {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 18px;
          }

          .title h1 {
            font-size: 22px;
            margin: 0;
            color: var(--comuro-text);
          }

          .route-list {
            display: grid;
            gap: 8px;
          }

          .route {
            border: 1px solid var(--comuro-border);
            border-radius: 12px;
            background: var(--comuro-card);
            padding: 12px;
          }

          .route.selected {
            outline: 2px solid var(--primary-color, #03a9f4);
          }

          .route-name {
            font-weight: 600;
            color: var(--comuro-text);
            margin-bottom: 4px;
          }

          .route-meta {
            color: var(--comuro-secondary);
            font-size: 13px;
            margin-bottom: 10px;
          }

          .actions {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
          }

          button {
            border: 0;
            border-radius: 10px;
            padding: 8px 11px;
            cursor: pointer;
            color: var(--primary-text-color, #111);
            background: var(--secondary-background-color, #eee);
          }

          button.primary {
            color: var(--text-primary-color, #fff);
            background: var(--primary-color, #03a9f4);
          }

          button.danger {
            background: var(--error-color, #db4437);
            color: #fff;
          }

          .editor {
            margin-top: 18px;
            padding-top: 18px;
            border-top: 1px solid var(--comuro-border);
          }

          .field {
            margin: 10px 0;
          }

          .field label {
            display: block;
            font-size: 13px;
            color: var(--comuro-secondary);
            margin-bottom: 4px;
          }

          input[type="text"],
          input[type="number"] {
            width: 100%;
            box-sizing: border-box;
            border: 1px solid var(--comuro-border);
            border-radius: 8px;
            padding: 9px;
            color: var(--comuro-text);
            background: var(--comuro-card);
          }

          .hint,
          .status {
            color: var(--comuro-secondary);
            font-size: 13px;
            line-height: 1.45;
          }

          .status {
            margin-top: 16px;
          }

          #map {
            width: 100%;
            height: 100%;
            min-height: 320px;
          }

          @media (max-width: 900px) {
            .layout {
              grid-template-columns: 1fr;
              grid-template-rows: auto minmax(360px, 1fr);
            }

            .sidebar {
              max-height: 55vh;
              border-right: 0;
              border-bottom: 1px solid var(--comuro-border);
            }
          }
        </style>

        <div class="layout">
          <aside class="sidebar">
            <div class="title">
              <ha-icon icon="mdi:map-marker-path"></ha-icon>
              <h1>Comuro – Routen</h1>
            </div>

            <div id="routeList" class="route-list"></div>

            <div class="actions" style="margin-top: 12px">
              <button id="newRoute" class="primary">＋ Neue Route</button>
            </div>

            <div id="editor" class="editor" hidden>
              <strong id="editorTitle">Route zeichnen</strong>

              <div class="field">
                <label for="routeName">Name</label>
                <input id="routeName" type="text" maxlength="100"
                       placeholder="z. B. Arbeitsweg">
              </div>

              <div class="field">
                <label for="buffer">Puffer in Metern</label>
                <input id="buffer" type="number" value="30" min="0" max="500">
              </div>

              <div class="field">
                <label>
                  <input id="enabled" type="checkbox" checked>
                  Route aktiv
                </label>
              </div>

              <div class="actions">
                <button id="save" class="primary">Speichern</button>
                <button id="undo">↩ Punkt zurück</button>
                <button id="cancel">Abbrechen</button>
              </div>

              <p class="hint">
                Neue Route: Klicke Punkt für Punkt entlang der gewünschten Strecke.
                Beim Bearbeiten kannst du Name, Puffer, Aktivität und Verlauf ändern.
              </p>
            </div>

            <div id="status" class="status">Keine Route ausgewählt.</div>
          </aside>

          <main id="map"></main>
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

    async _loadRoutes() {
      const response = await fetch(API_BASE + "/routes");
      if (!response.ok) {
        throw new Error("Routen konnten nicht geladen werden.");
      }
      this._routes = await response.json();
      this._renderRoutes();
    }

    _renderRoutes() {
      const container = this.querySelector("#routeList");
      container.innerHTML = "";

      if (!this._routes.length) {
        const empty = document.createElement("div");
        empty.className = "hint";
        empty.textContent = "Noch keine Route gespeichert.";
        container.appendChild(empty);
        return;
      }

      for (const route of this._routes) {
        const item = document.createElement("div");
        item.className =
          "route" +
          (this._selectedRoute?.id === route.id ? " selected" : "");

        const name = document.createElement("div");
        name.className = "route-name";
        name.textContent = route.name;

        const meta = document.createElement("div");
        meta.className = "route-meta";
        meta.textContent =
          "Puffer: " +
          Number(route.buffer_m ?? 30) +
          " m · " +
          (route.enabled === false ? "inaktiv" : "aktiv");

        const actions = document.createElement("div");
        actions.className = "actions";

        const show = document.createElement("button");
        show.textContent = "Anzeigen";
        show.addEventListener("click", () => this._selectRoute(route.id));

        const edit = document.createElement("button");
        edit.textContent = "✏️ Bearbeiten";
        edit.addEventListener("click", () => this._startEdit(route.id));

        const remove = document.createElement("button");
        remove.className = "danger";
        remove.textContent = "🗑";
        remove.addEventListener("click", () => this._deleteRoute(route.id));

        actions.append(show, edit, remove);
        item.append(name, meta, actions);
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
      this._points = route.coordinates.map((p) => [p[1], p[0]]);
      this._redrawRoute();
      this._hideEditor();
      this._fitRoute();
      this._renderRoutes();
      this._setStatus('Route "' + route.name + '" ausgewählt.');
    }

    _startNewRoute() {
      this._selectedRoute = null;
      this._editingRouteId = null;
      this._drawing = true;
      this._points = [];
      this._removeRouteLine();
      this._showEditor("Route zeichnen", "Speichern", "", 30, true);
      this._setCursor(true);
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
      this._points = route.coordinates.map((p) => [p[1], p[0]]);
      this._showEditor(
        "Route bearbeiten",
        "Änderungen speichern",
        route.name,
        Number(route.buffer_m ?? 30),
        route.enabled !== false
      );
      this._redrawRoute();
      this._setCursor(true);
      this._fitRoute();
      this._renderRoutes();
      this._setStatus('Bearbeitung von "' + route.name + '".');
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

      const buffer = Number(this.querySelector("#buffer").value);
      const enabled = this.querySelector("#enabled").checked;
      if (!Number.isInteger(buffer) || buffer < 0 || buffer > 500) {
        this._setStatus("Der Puffer muss zwischen 0 und 500 Metern liegen.");
        return;
      }

      const payload = {
        name,
        coordinates: this._points.map((p) => [p[1], p[0]]),
        buffer_m: buffer,
        enabled,
      };

      const method = this._editingRouteId ? "PUT" : "POST";
      const url = this._editingRouteId
        ? API_BASE + "/routes/" + encodeURIComponent(this._editingRouteId)
        : API_BASE + "/routes";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        this._setStatus(error.message || "Route konnte nicht gespeichert werden.");
        return;
      }

      const route = await response.json();
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
      this._hideEditor();
      this._setCursor(false);
      this._renderRoutes();
      this._redrawRoute();
      this._fitRoute();
      this._setStatus('Route "' + route.name + '" gespeichert.');
    }

    async _deleteRoute(id) {
      const route = this._routes.find((item) => item.id === id);
      if (!route) {
        return;
      }

      if (!window.confirm('Route "' + route.name + '" wirklich löschen?')) {
        return;
      }

      const response = await fetch(
        API_BASE + "/routes/" + encodeURIComponent(id),
        { method: "DELETE" }
      );

      if (!response.ok) {
        this._setStatus("Route konnte nicht gelöscht werden.");
        return;
      }

      this._routes = this._routes.filter((item) => item.id !== id);
      if (this._selectedRoute?.id === id) {
        this._selectedRoute = null;
        this._editingRouteId = null;
        this._drawing = false;
        this._points = [];
        this._removeRouteLine();
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
      this._redrawRoute();
    }

    _cancelEdit() {
      this._drawing = false;
      this._editingRouteId = null;
      this._points = [];

      if (this._selectedRoute) {
        this._points = this._selectedRoute.coordinates.map(
          (p) => [p[1], p[0]]
        );
        this._redrawRoute();
      } else {
        this._removeRouteLine();
      }

      this._hideEditor();
      this._setCursor(false);
      this._setStatus("Bearbeitung abgebrochen.");
      this._renderRoutes();
    }

    _showEditor(title, saveLabel, name, buffer, enabled) {
      const editor = this.querySelector("#editor");
      editor.hidden = false;
      this.querySelector("#editorTitle").textContent = title;
      this.querySelector("#save").textContent = "💾 " + saveLabel;
      this.querySelector("#routeName").value = name;
      this.querySelector("#buffer").value = buffer;
      this.querySelector("#enabled").checked = enabled;
    }

    _hideEditor() {
      this.querySelector("#editor").hidden = true;
    }

    _redrawRoute() {
      if (!this._map || !this._leafletReady) {
        return;
      }

      this._removeRouteLine();
      if (this._points.length >= 2) {
        this._routeLine = window.L.polyline(
          this._points,
          { weight: 6 }
        ).addTo(this._map);
      }
    }

    _removeRouteLine() {
      if (this._routeLine && this._map) {
        this._map.removeLayer(this._routeLine);
        this._routeLine = null;
      }
    }

    _fitRoute() {
      if (
        !this._map ||
        !this._routeLine ||
        !this._routeLine.getBounds().isValid()
      ) {
        return;
      }

      this._map.fitBounds(
        this._routeLine.getBounds(),
        { padding: [40, 40] }
      );
    }

    _setCursor(drawing) {
      if (!this._map) {
        return;
      }
      this._map.getContainer().style.cursor =
        drawing ? "crosshair" : "";
    }

    _setStatus(message) {
      this.querySelector("#status").textContent = message;
    }
  }

  if (!customElements.get(PANEL_TAG)) {
    customElements.define(PANEL_TAG, ComuroPanel);
  }
})();
