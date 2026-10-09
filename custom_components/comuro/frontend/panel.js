(() => {
  const PANEL_TAG = "comuro-panel";
  const API_BASE = "comuro";
  const MAPLIBRE_MODULE =
    "https://unpkg.com/maplibre-gl@6.11.2/dist/maplibre-gl.mjs";
  const MAPLIBRE_CSS =
    "https://unpkg.com/maplibre-gl@6.11.2/dist/maplibre-gl.css";
  const LIGHT_STYLE = "/static/map/light.json";
  const DARK_STYLE = "/static/map/dark.json";
  const MAP_CENTER = [7.4653, 51.5136];

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

  class ComuroPanel extends HTMLElement {
    constructor() {
      super();

      this._hass = null;
      this._map = null;
      this._maplibre = null;
      this._mapTilesToken = null;
      this._tokenRefreshTimer = null;
      this._mapReady = false;
      this._resizeObserver = null;
      this._routes = [];
      this._selectedRoute = null;
      this._editingRouteId = null;
      this._drawing = false;
      this._points = [];
      this._markers = [];
      this._routeSourceId = "comuro-route";
      this._routeLayerId = "comuro-route-line";
      this._initialized = false;
    }

    set hass(value) {
      const oldDarkMode = this._hass?.themes?.darkMode;
      this._hass = value;

      if (this._map) {
        if (
          typeof oldDarkMode === "boolean" &&
          oldDarkMode !== value?.themes?.darkMode
        ) {
          void this._reloadMapStyle();
        }
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
      this._applyHostSizing();

      requestAnimationFrame(() => this._applyHostSizing());
      window.addEventListener("resize", this._applyHostSizing);

      void this._init();
    }

    disconnectedCallback() {
      window.removeEventListener("resize", this._applyHostSizing);
      this._resizeObserver?.disconnect();
      this._resizeObserver = null;

      if (this._tokenRefreshTimer) {
        clearInterval(this._tokenRefreshTimer);
        this._tokenRefreshTimer = null;
      }

      this._markers.forEach((marker) => marker.remove());
      this._markers = [];

      this._map?.remove();
      this._map = null;
      this._mapReady = false;
    }

    _applyHostSizing = () => {
      const elements = [
        this,
        this.closest("ha-panel-custom"),
        this.closest("partial-panel-resolver"),
      ];

      for (const element of elements) {
        if (!element) {
          continue;
        }

        element.style.display = "block";
        element.style.width = "100%";
        element.style.height = "100%";
        element.style.minHeight = "0";
        element.style.boxSizing = "border-box";
        element.style.overflow = "hidden";
      }

      const mapWrap = this.querySelector(".map-wrap");
      if (mapWrap) {
        mapWrap.style.height = "100%";
        mapWrap.style.minHeight = "0";
      }

      if (this._map) {
        this._map.resize();
      }
    };

    async _waitForHass() {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (this._hass) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      throw new Error("Home Assistant ist noch nicht verfügbar.");
    }

    async _getMapTilesToken() {
      if (!this._hass?.callWS) {
        throw new Error("Die Home-Assistant-Verbindung ist nicht verfügbar.");
      }

      const result = await this._hass.callWS({
        type: "map_tiles/access_token",
      });

      if (!result?.token) {
        throw new Error("Home Assistant hat kein Karten-Token geliefert.");
      }

      this._mapTilesToken = result.token;

      if (!this._tokenRefreshTimer) {
        this._tokenRefreshTimer = setInterval(
          () => {
            void this._refreshMapTilesToken();
          },
          20 * 60 * 1000
        );
      }

      return this._mapTilesToken;
    }

    async _refreshMapTilesToken() {
      try {
        await this._getMapTilesToken();
      } catch {
        // Keep the currently working token. A later refresh will retry.
      }
    }

    async _loadMapStyle() {
      const dark = Boolean(this._hass?.themes?.darkMode);
      const response = await fetch(
        dark ? DARK_STYLE : LIGHT_STYLE,
        { credentials: "same-origin" }
      );

      if (!response.ok) {
        throw new Error(
          "Der Home-Assistant-Kartenstil konnte nicht geladen werden."
        );
      }

      return response.json();
    }

    async _reloadMapStyle() {
      if (!this._map || !this._mapReady) {
        return;
      }

      try {
        const style = await this._loadMapStyle();
        this._map.setStyle(style);
        this._map.once("style.load", () => {
          this._addRouteLayer();
          this._redrawRoute(false);
        });
      } catch (error) {
        this._setStatus(
          "Kartenstil konnte nicht aktualisiert werden: " +
            (error?.message || error)
        );
      }
    }

    async _init() {
      try {
        await this._waitForHass();
        await loadStyle(MAPLIBRE_CSS);
        await this._getMapTilesToken();

        // MapLibre GL JS v6 is ESM-only. Use the browser's native dynamic
        // import instead of a classic <script>, which can be served with the
        // wrong MIME type by proxies/CDNs and is no longer supported by v6.
        const maplibreModule = await import(MAPLIBRE_MODULE);
        this._maplibre = maplibreModule;
        const style = await this._loadMapStyle();

        this._map = new this._maplibre.Map({
          container: this.querySelector("#map"),
          style,
          center: MAP_CENTER,
          zoom: 12,
          attributionControl: true,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          transformRequest: (url) => {
            const request = new URL(url, window.location.href);

            if (
              request.pathname.startsWith("/api/map_tiles/") &&
              this._mapTilesToken
            ) {
              return {
                url: request.href,
                headers: {
                  "X-Map-Tiles-Token": this._mapTilesToken,
                },
              };
            }

            return { url: request.href };
          },
        });

        this._map.addControl(
          new this._maplibre.NavigationControl({
            showCompass: false,
          }),
          "top-right"
        );

        this._map.on("load", async () => {
          this._mapReady = true;
          this._addRouteLayer();

          this._resizeObserver = new ResizeObserver(() => {
            this._map?.resize();
          });
          this._resizeObserver.observe(this.querySelector(".map-wrap"));

          this._applyHostSizing();
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
          this._redrawRoute(false);
        });

        this._map.on("error", (event) => {
          const status = event?.error?.status;
          if (status === 401 || status === 403) {
            void this._refreshMapTilesToken();
          }
        });
      } catch (error) {
        this._setStatus(
          "Die Karte konnte nicht geladen werden: " +
            (error?.message || error)
        );
      }
    }

    _addRouteLayer() {
      if (!this._map) {
        return;
      }

      const existingSource = this._map.getSource(this._routeSourceId);
      if (!existingSource) {
        this._map.addSource(this._routeSourceId, {
          type: "geojson",
          data: this._routeGeoJson(),
        });
      }

      if (!this._map.getLayer(this._routeLayerId)) {
        this._map.addLayer({
          id: this._routeLayerId,
          type: "line",
          source: this._routeSourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": [
              "coalesce",
              ["get", "color"],
              "#03a9f4",
            ],
            "line-width": 5,
            "line-opacity": 0.95,
          },
        });
      }
    }

    _routeGeoJson() {
      const computedStyle = getComputedStyle(this);
      const routeColor =
        computedStyle.getPropertyValue("--primary-color").trim() ||
        "#03a9f4";

      return {
        type: "FeatureCollection",
        features:
          this._points.length >= 2
            ? [
                {
                  type: "Feature",
                  properties: {
                    color: routeColor,
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

    async _loadRoutes() {
      if (!this._hass?.callApi) {
        throw new Error(
          "Die Home-Assistant-API ist noch nicht verfügbar."
        );
      }

      this._routes = await this._hass.callApi(
        "GET",
        API_BASE + "/routes"
      );
      this._renderRoutes();
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
        body.className = "route-body";

        const name = document.createElement("div");
        name.className = "route-name";
        name.textContent = route.name;

        const meta = document.createElement("div");
        meta.className = "route-meta";
        meta.textContent =
          "Puffer " +
          Number(route.buffer_m ?? 30) +
          " m";

        const statusRow = document.createElement("label");
        statusRow.className = "route-toggle";

        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = route.enabled !== false;
        toggle.setAttribute(
          "aria-label",
          route.enabled === false
            ? 'Route "' + route.name + '" aktivieren'
            : 'Route "' + route.name + '" deaktivieren'
        );
        toggle.addEventListener(
          "change",
          () => {
            toggle.disabled = true;
            void this._setRouteEnabled(route, toggle.checked).finally(() => {
              toggle.disabled = false;
              toggle.checked =
                this._routes.find((item) => item.id === route.id)
                  ?.enabled !== false;
            });
          }
        );

        const toggleText = document.createElement("span");
        toggleText.textContent =
          route.enabled === false ? "Inaktiv" : "Aktiv";

        statusRow.append(toggle, toggleText);
        body.append(name, meta, statusRow);
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

    _clearMarkers() {
      this._markers.forEach((marker) => marker.remove());
      this._markers = [];
    }

    _createEditableMarkers() {
      this._clearMarkers();

      if (!this._map || !this._drawing) {
        return;
      }

      this._points.forEach((point, index) => {
        const element = document.createElement("div");
        element.className = "route-point";
        element.title = "Punkt " + (index + 1);

        const marker = new this._maplibre.Marker({
          element,
          draggable: true,
          anchor: "center",
        })
          .setLngLat(point)
          .addTo(this._map);

        marker.on("dragend", () => {
          const position = marker.getLngLat();
          this._points[index] = [
            position.lng,
            position.lat,
          ];
          this._redrawRoute(false);
        });

        this._markers.push(marker);
      });
    }

    _redrawRoute(autoFit = false) {
      if (!this._map || !this._mapReady) {
        return;
      }

      this._map.getSource(this._routeSourceId)?.setData(
        this._routeGeoJson()
      );

      this._createEditableMarkers();

      if (autoFit) {
        this._fitRoute();
      }
    }

    _fitRoute() {
      if (!this._map || this._points.length < 2) {
        return;
      }

      const bounds = new this._maplibre.LngLatBounds();
      this._points.forEach((point) => bounds.extend(point));

      this._map.fitBounds(bounds, {
        padding: {
          top: 50,
          right: 50,
          bottom: 50,
          left: 50,
        },
        maxZoom: 16,
        duration: 700,
      });
    }

    _selectRoute(id) {
      const route = this._routes.find((item) => item.id === id);
      if (!route) {
        return;
      }

      this._selectedRoute = route;
      this._editingRouteId = null;
      this._renderRoutes();
      this._drawing = false;
      this._points = route.coordinates.map((point) => [
        Number(point[0]),
        Number(point[1]),
      ]);

      this._hideEditor();
      this._updateCursor(false);
      this._redrawRoute(false);
      requestAnimationFrame(() => {
        this._fitRoute();
      });
      this._setStatus('Route "' + route.name + '" ausgewählt.');
    }

    _startNewRoute() {
      this._selectedRoute = null;
      this._editingRouteId = null;
      this._renderRoutes();
      this._drawing = true;
      this._points = [];

      this._clearMarkers();
      this._redrawRoute(false);
      this._showEditor(
        "Route zeichnen",
        "Speichern",
        "",
        30,
        true
      );
      this._updateCursor(true);
      this._setStatus("Zeichenmodus aktiv.");
    }

    _startEdit(id) {
      const route = this._routes.find((item) => item.id === id);
      if (!route) {
        return;
      }

      this._selectedRoute = route;
      this._editingRouteId = id;
      this._renderRoutes();
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

      this._updateCursor(true);
      this._redrawRoute(false);
      requestAnimationFrame(() => {
        this._fitRoute();
      });
      this._setStatus('Bearbeitung von "' + route.name + '".');
    }

    async _setRouteEnabled(route, enabled) {
      if (!this._hass?.callApi) {
        this._setStatus("Home Assistant API ist noch nicht verfügbar.");
        return;
      }

      try {
        const updated = await this._hass.callApi(
          "PUT",
          API_BASE + "/routes/" + encodeURIComponent(route.id),
          {
            name: route.name,
            coordinates: route.coordinates,
            buffer_m: Number(route.buffer_m ?? 30),
            enabled,
          }
        );

        const index = this._routes.findIndex(
          (item) => item.id === route.id
        );
        if (index >= 0) {
          this._routes[index] = updated;
        }

        if (this._selectedRoute?.id === route.id) {
          this._selectedRoute = updated;
        }

        this._renderRoutes();
        this._setStatus(
          'Route "' + updated.name + '"' +
            (enabled ? " aktiviert." : " deaktiviert.")
        );
      } catch (error) {
        this._setStatus(
          error?.message || "Routenstatus konnte nicht geändert werden."
        );
      }
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
      const enabled =
        this._editingRouteId
          ? this._routes.find(
              (item) => item.id === this._editingRouteId
            )?.enabled !== false
          : true;

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

      const method = this._editingRouteId
        ? "PUT"
        : "POST";
      const url = this._editingRouteId
        ? API_BASE +
          "/routes/" +
          encodeURIComponent(this._editingRouteId)
        : API_BASE + "/routes";

      try {
        const route = await this._hass.callApi(
          method,
          url,
          payload
        );

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
        this._updateCursor(false);
        this._redrawRoute(true);
        this._setStatus(
          'Route "' + route.name + '" gespeichert.'
        );
      } catch (error) {
        this._setStatus(
          error?.message ||
            "Route konnte nicht gespeichert werden."
        );
      }
    }

    async _deleteRoute(id) {
      const route = this._routes.find(
        (item) => item.id === id
      );
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
        this._hideEditor();
        this._updateCursor(false);
        this._redrawRoute(false);
      }

      this._renderRoutes();
      this._setStatus("Route gelöscht.");
    }

    _undoPoint() {
      if (!this._drawing || !this._points.length) {
        return;
      }

      this._points.pop();
      this._redrawRoute(false);
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
      this._updateCursor(false);
      this._redrawRoute(false);
      this._renderRoutes();
      this._setStatus(
        selected
          ? 'Route "' + selected.name + '" ausgewählt.'
          : "Bearbeitung abgebrochen."
      );
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

      this.querySelector("#editorTitle").textContent =
        title;
      this.querySelector("#save").textContent =
        "💾 " + saveLabel;
      this.querySelector("#routeName").value = name;
      this.querySelector("#buffer").value = buffer;
      const enabledInput = this.querySelector("#enabled");
      if (enabledInput) {
        enabledInput.checked = enabled;
      }
    }

    _hideEditor() {
      this.querySelector("#editor").hidden = true;
    }

    _updateCursor(drawing) {
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

    _render() {
      this.innerHTML = `
        <style>
          :host {
            display: block;
            width: 100%;
            height: 100%;
            min-height: 0;
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
            min-height: 0;
            padding: 16px;
            box-sizing: border-box;
            background: var(--primary-background-color);
            border-inline-end: 1px solid var(--divider-color);
          }

          .header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 0 0 16px;
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
            padding: 0 4px 8px;
            color: var(--secondary-text-color);
            font-size: 14px;
          }

          .route-list {
            display: grid;
            gap: 8px;
          }

          .route {
            padding: 12px;
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
            gap: 12px;
          }

          .route-body {
            min-width: 0;
            flex: 1;
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

          .route-toggle {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            margin-top: 7px;
            color: var(--secondary-text-color);
            font-size: 12px;
            cursor: pointer;
          }

          .route-toggle input {
            appearance: none;
            width: 34px;
            height: 20px;
            margin: 0;
            border-radius: 999px;
            background: var(--disabled-text-color);
            position: relative;
            cursor: pointer;
            transition: background 120ms ease;
          }

          .route-toggle input::after {
            content: "";
            position: absolute;
            width: 14px;
            height: 14px;
            top: 3px;
            left: 3px;
            border-radius: 50%;
            background: var(--primary-background-color);
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
            transition: transform 120ms ease;
          }

          .route-toggle input:checked {
            background: var(--primary-color);
          }

          .route-toggle input:checked::after {
            transform: translateX(14px);
          }

          .route-toggle input:disabled {
            opacity: 0.55;
            cursor: wait;
          }

          .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 12px;
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
            padding: 12px;
            border-radius: var(--ha-border-radius-md, 12px);
            color: var(--secondary-text-color);
            font-size: 13px;
          }

          .empty {
            border: 1px dashed var(--divider-color);
          }

          .notice {
            margin-top: 12px;
            background: var(--secondary-background-color);
          }

          .editor {
            margin-top: 16px;
            padding: 16px;
            border: 1px solid var(--divider-color);
            border-radius: var(--ha-border-radius-md, 12px);
            background: var(--card-background-color);
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

          .hint,
          .status {
            color: var(--secondary-text-color);
            font-size: 12px;
            line-height: 1.45;
          }

          .hint {
            margin: 12px 0 0;
          }

          .status {
            margin: 16px 4px;
          }

          .map-wrap {
            position: relative;
            width: 100%;
            height: 100%;
            min-width: 0;
            min-height: 0;
            overflow: hidden;
            background: var(--primary-background-color);
          }

          #map {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
          }

          .route-point {
            width: 12px;
            height: 12px;
            border: 2px solid #ffffff;
            border-radius: 50%;
            background: var(--primary-color);
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
            cursor: grab;
          }

          .route-point:active {
            cursor: grabbing;
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
                <label class="field-label" for="routeName">
                  Name
                </label>
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

              <div id="editingNotice" class="notice" hidden>
                Die Route kann hier direkt auf der Karte bearbeitet werden.
              </div>

              <div class="actions">
                <button id="save" class="primary">
                  Speichern
                </button>
                <button id="undo">↩ Punkt zurück</button>
                <button id="cancel">Abbrechen</button>
              </div>

              <p class="hint">
                Im Zeichenmodus kannst du Punkte setzen.
                Beim Bearbeiten lassen sich die Punkte verschieben.
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
  }

  if (!customElements.get(PANEL_TAG)) {
    customElements.define(PANEL_TAG, ComuroPanel);
  }
})();
