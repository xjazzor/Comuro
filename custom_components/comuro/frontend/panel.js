(() => {
  const PANEL_TAG = "comuro-panel";
  const API_BASE = "/api/comuro";
  const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

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
        existing.addEventListener(
          "load",
          () => resolve(globalName ? window[globalName] : undefined),
          { once: true }
        );
        existing.addEventListener("error", reject, { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.dataset.comuroSrc = src;
      script.onload = () =>
        resolve(globalName ? window[globalName] : undefined);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  class ComuroPanel extends HTMLElement {
    constructor() {
      super();

      this._hass = null;
      this._map = null;
      this._mapReady = false;
      this._mapResizeObserver = null;
      this._routes = [];
      this._selectedRoute = null;
      this._editingRouteId = null;
      this._drawing = false;
      this._points = [];
      this._initialized = false;
    }

    set hass(value) {
      this._hass = value;
    }

    set narrow(value) {
      this._narrow = value;
      if (this._map) {
        window.setTimeout(() => this._map.resize(), 0);
      }
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
      this._mapResizeObserver?.disconnect();
      this._mapResizeObserver = null;
      this._map?.remove();
      this._map = null;
      this._mapReady = false;
    }

    async _init() {
      try {
        await Promise.all([
          loadStyle(
            "https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css"
          ),
          loadScript(
            "https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js",
            "maplibregl"
          ),
        ]);

        this._map = new window.maplibregl.Map({
          container: this.querySelector("#map"),
          style: MAP_STYLE,
          center: [7.4653, 51.5136],
          zoom: 12,
          attributionControl: true,
        });

        this._map.addControl(
          new window.maplibregl.NavigationControl(),
          "top-right"
        );

        this._map.on("load", async () => {
          this._mapReady = true;
          this._setupMapLayers();

          this._mapResizeObserver = new ResizeObserver(() => {
            this._map?.resize();
          });
          this._mapResizeObserver.observe(this.querySelector("#map"));

          await this._loadRoutes();
        });

        this._map.on("click", (event) => {
          if (!this._drawing) {
            return;
          }

          this._points.push([
            event.lngLat.lng,
            event.lngLat.lat,
          ]);
          this._redrawRoute();
        });
      } catch (error) {
        this._setStatus(
          "Die Karte konnte nicht geladen werden: " +
            (error?.message || error)
        );
      }
    }

    _setupMapLayers() {
      this._map.addSource("comuro-route", {
        type: "geojson",
        data: this._routeGeoJson(),
      });

      this._map.addLayer({
        id: "comuro-route-line",
        type: "line",
        source: "comuro-route",
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "editing"], true],
            "#03a9f4",
            "#5f6368",
          ],
          "line-width": [
            "case",
            ["==", ["get", "editing"], true],
            5,
            4,
          ],
          "line-opacity": 0.95,
        },
      });

      this._map.addSource("comuro-route-points", {
        type: "geojson",
        data: this._pointsGeoJson(),
      });

      this._map.addLayer({
        id: "comuro-route-points",
        type: "circle",
        source: "comuro-route-points",
        paint: {
          "circle-radius": 5,
          "circle-color": "#03a9f4",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
    }

    _routeGeoJson() {
      return {
        type: "FeatureCollection",
        features:
          this._points.length >= 2
            ? [
                {
                  type: "Feature",
                  properties: {
                    editing: this._drawing,
                  },
                  geometry: {
                    type: "LineString",
                    coordinates: this._points,
                  },
                },
              ]
            : [],
      };
    }

    _pointsGeoJson() {
      return {
        type: "FeatureCollection",
        features: this._points.map((coordinates, index) => ({
          type: "Feature",
          properties: { index: index + 1 },
          geometry: {
            type: "Point",
            coordinates,
          },
        })),
      };
    }

    async _loadRoutes() {
      const response = await fetch(API_BASE + "/routes", {
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error("Routen konnten nicht geladen werden.");
      }

      this._routes = await response.json();
      this._renderRoutes();
    }

    _render() {
      this.innerHTML = `
        <style>
          :host {
            --comuro-bg:
              var(--primary-background-color, #111);
            --comuro-surface:
              var(--card-background-color, var(--ha-card-background, #1c1c1c));
            --comuro-surface-2:
              var(--secondary-background-color, #242424);
            --comuro-border:
              var(--divider-color, rgba(127, 127, 127, 0.24));
            --comuro-text:
              var(--primary-text-color, #fff);
            --comuro-secondary:
              var(--secondary-text-color, #9e9e9e);
            --comuro-primary:
              var(--primary-color, #03a9f4);
            --comuro-danger:
              var(--error-color, #db4437);
            display: block;
            width: 100%;
            height: 100%;
            overflow: hidden;
            color: var(--comuro-text);
            background: var(--comuro-bg);
          }

          .layout {
            display: grid;
            grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
            height: 100%;
            min-height: 0;
          }

          .sidebar {
            z-index: 2;
            min-width: 0;
            overflow-y: auto;
            padding: 16px;
            box-sizing: border-box;
            background: var(--comuro-bg);
            border-right: 1px solid var(--comuro-border);
          }

          .header {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 4px 4px 16px;
          }

          .header-icon {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            color: var(--comuro-primary);
            background: color-mix(
              in srgb,
              var(--comuro-primary) 14%,
              transparent
            );
            font-size: 16px;
          }

          .header-title {
            font-size: 20px;
            font-weight: 500;
            letter-spacing: -0.01em;
          }

          .section {
            margin-top: 8px;
          }

          .section-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 4px;
            color: var(--comuro-secondary);
            font-size: 13px;
            font-weight: 500;
          }

          .route-list {
            display: grid;
            gap: 8px;
          }

          .route {
            background: var(--comuro-surface);
            border: 1px solid var(--comuro-border);
            border-radius: 12px;
            padding: 12px;
            box-sizing: border-box;
            transition: border-color 120ms ease, background 120ms ease;
          }

          .route:hover {
            border-color: color-mix(
              in srgb,
              var(--comuro-primary) 45%,
              var(--comuro-border)
            );
          }

          .route.selected {
            border-color: var(--comuro-primary);
            background: color-mix(
              in srgb,
              var(--comuro-primary) 7%,
              var(--comuro-surface)
            );
          }

          .route-main {
            display: flex;
            align-items: flex-start;
            gap: 10px;
          }

          .route-status {
            flex: 0 0 auto;
            width: 8px;
            height: 8px;
            margin-top: 6px;
            border-radius: 50%;
            background: var(--comuro-primary);
          }

          .route-status.off {
            background: var(--comuro-secondary);
          }

          .route-name {
            flex: 1;
            min-width: 0;
            font-size: 15px;
            font-weight: 500;
            line-height: 1.3;
          }

          .route-meta {
            margin-top: 3px;
            color: var(--comuro-secondary);
            font-size: 12px;
            line-height: 1.4;
          }

          .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 10px;
          }

          button {
            min-height: 36px;
            border: 1px solid var(--comuro-border);
            border-radius: 10px;
            padding: 7px 12px;
            box-sizing: border-box;
            cursor: pointer;
            color: var(--comuro-text);
            background: var(--comuro-surface);
            font: inherit;
            font-size: 13px;
          }

          button:hover {
            background: var(--comuro-surface-2);
          }

          button.primary {
            border-color: var(--comuro-primary);
            color: var(--text-primary-color, #fff);
            background: var(--comuro-primary);
          }

          button.primary:hover {
            filter: brightness(1.06);
          }

          button.danger {
            border-color: color-mix(
              in srgb,
              var(--comuro-danger) 35%,
              var(--comuro-border)
            );
            color: var(--comuro-danger);
          }

          .empty {
            padding: 16px 12px;
            border: 1px dashed var(--comuro-border);
            border-radius: 12px;
            color: var(--comuro-secondary);
            font-size: 13px;
          }

          .editor {
            margin-top: 16px;
            padding: 14px;
            border: 1px solid var(--comuro-border);
            border-radius: 12px;
            background: var(--comuro-surface);
          }

          .editor-title {
            margin-bottom: 12px;
            font-size: 15px;
            font-weight: 500;
          }

          .field {
            margin: 12px 0;
          }

          .field-label {
            display: block;
            margin-bottom: 5px;
            color: var(--comuro-secondary);
            font-size: 12px;
          }

          input[type="text"],
          input[type="number"] {
            width: 100%;
            min-height: 40px;
            box-sizing: border-box;
            padding: 8px 10px;
            border: 1px solid var(--comuro-border);
            border-radius: 10px;
            outline: none;
            color: var(--comuro-text);
            background: var(--comuro-surface-2);
            font: inherit;
          }

          input:focus {
            border-color: var(--comuro-primary);
            box-shadow: 0 0 0 1px var(--comuro-primary);
          }

          .check {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
          }

          .hint,
          .status {
            color: var(--comuro-secondary);
            font-size: 12px;
            line-height: 1.45;
          }

          .hint {
            margin: 12px 0 0;
          }

          .status {
            margin: 16px 4px 4px;
          }

          .map-wrap {
            min-width: 0;
            min-height: 0;
            position: relative;
          }

          #map {
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
              border-right: 0;
              border-bottom: 1px solid var(--comuro-border);
            }
          }
        </style>

        <div class="layout">
          <aside class="sidebar">
            <div class="header">
              <div class="header-icon">⌘</div>
              <div class="header-title">Comuro</div>
            </div>

            <div class="section">
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

              <div class="actions">
                <button id="save" class="primary">Speichern</button>
                <button id="undo">↩ Punkt zurück</button>
                <button id="cancel">Abbrechen</button>
              </div>

              <p class="hint">
                Klicke im Zeichenmodus Punkt für Punkt entlang der Strecke.
                Beim Bearbeiten kannst du Verlauf, Name, Puffer und Aktivität
                ändern.
              </p>
            </div>

            <div id="status" class="status">
              Keine Route ausgewählt.
            </div>
          </aside>

          <main class="map-wrap">
            <div id="map"></div>
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
        point[0],
        point[1],
      ]);

      this._redrawRoute();
      this._hideEditor();
      this._fitRoute();
      this._renderRoutes();
      this._setCursor(false);
      this._setStatus('Route "' + route.name + '" ausgewählt.');
    }

    _startNewRoute() {
      this._selectedRoute = null;
      this._editingRouteId = null;
      this._drawing = true;
      this._points = [];

      this._redrawRoute();
      this._showEditor(
        "Route zeichnen",
        "Speichern",
        "",
        30,
        true
      );
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
      this._points = route.coordinates.map((point) => [
        point[0],
        point[1],
      ]);

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

      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        this._setStatus(
          error.message ||
            "Route konnte nicht gespeichert werden."
        );
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
      this._points = route.coordinates.map((point) => [
        point[0],
        point[1],
      ]);

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

      if (
        !window.confirm(
          'Route "' + route.name + '" wirklich löschen?'
        )
      ) {
        return;
      }

      const response = await fetch(
        API_BASE +
          "/routes/" +
          encodeURIComponent(id),
        {
          method: "DELETE",
          credentials: "same-origin",
        }
      );

      if (!response.ok) {
        this._setStatus("Route konnte nicht gelöscht werden.");
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
        this._redrawRoute();
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
      const selected = this._selectedRoute;

      this._drawing = false;
      this._editingRouteId = null;

      if (selected) {
        this._points = selected.coordinates.map((point) => [
          point[0],
          point[1],
        ]);
      } else {
        this._points = [];
      }

      this._hideEditor();
      this._setCursor(false);
      this._redrawRoute();
      this._setStatus(
        selected
          ? 'Route "' + selected.name + '" ausgewählt.'
          : "Bearbeitung abgebrochen."
      );
      this._renderRoutes();
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
    }

    _hideEditor() {
      this.querySelector("#editor").hidden = true;
    }

    _redrawRoute() {
      if (!this._mapReady) {
        return;
      }

      this._map.getSource("comuro-route")?.setData(
        this._routeGeoJson()
      );
      this._map.getSource("comuro-route-points")?.setData(
        this._pointsGeoJson()
      );
    }

    _removeRouteLine() {
      this._points = [];
      this._redrawRoute();
    }

    _fitRoute() {
      if (!this._map || this._points.length < 2) {
        return;
      }

      const bounds = new window.maplibregl.LngLatBounds();
      for (const point of this._points) {
        bounds.extend(point);
      }

      this._map.fitBounds(bounds, {
        padding: 70,
        duration: 700,
        maxZoom: 16,
      });
    }

    _setCursor(drawing) {
      if (!this._map) {
        return;
      }

      this._map.getCanvas().style.cursor =
        drawing ? "crosshair" : "";
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
