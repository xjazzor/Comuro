(() => {
  const TAG = "comuro-route-card";

  class ComuroRouteCard extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._config = null;
      this._root = this.attachShadow({ mode: "open" });
    }

    setConfig(config) {
      if (!config || typeof config.entity !== "string" || !config.entity) {
        throw new Error(
          'Comuro Route Card benötigt "entity", z. B. binary_sensor.comuro_arbeit_betroffen.'
        );
      }
      this._config = { ...config };
      this._render();
    }

    set hass(value) {
      this._hass = value;
      this._render();
    }

    get hass() {
      return this._hass;
    }

    getCardSize() {
      return Math.min(Math.max(this._getMatches().length + 2, 3), 8);
    }

    getGridOptions() {
      const rows = Math.min(Math.max(this._getMatches().length + 2, 3), 8);
      return {
        rows,
        columns: 6,
        min_rows: 3,
        max_rows: 8,
        min_columns: 3,
        max_columns: 12,
      };
    }

    static getStubConfig() {
      return { entity: "binary_sensor.comuro_arbeit_betroffen" };
    }

    static getConfigForm() {
      return {
        schema: [
          {
            name: "entity",
            required: true,
            selector: { entity: { domain: "binary_sensor" } },
          },
        ],
      };
    }

    _getState() {
      return this._hass && this._hass.states
        ? this._hass.states[this._config.entity]
        : null;
    }

    _getMatches() {
      const state = this._getState();
      const matches = state && state.attributes
        ? state.attributes.matches
        : null;
      return Array.isArray(matches) ? matches : [];
    }

    _formatDistance(value) {
      const meters = Number(value);
      if (!Number.isFinite(meters)) return "—";

      if (Math.abs(meters) >= 1000) {
        return (meters / 1000).toLocaleString("de-DE", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }) + " km";
      }

      return Math.round(meters).toLocaleString("de-DE") + " m";
    }

    _formatDate(value) {
      if (!value) return "";
      const date = new Date(String(value).slice(0, 10) + "T00:00:00");
      if (Number.isNaN(date.getTime())) return String(value);

      return new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(date);
    }

    _escape(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    _openMoreInfo() {
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          bubbles: true,
          composed: true,
          detail: { entityId: this._config.entity },
        })
      );
    }

    _renderMatch(match) {
      const current = match.status === "aktuell";
      const status = current ? "aktuell" : "geplant";
      const icon = current ? "🔴" : "🟡";
      const label = current ? "Aktuell" : "Geplant";
      const name = this._escape(match.name || "Baustelle");
      const distance = this._formatDistance(match.route_position_m);

      let period = "Zeitraum unbekannt";

      const start = this._formatDate(match.start);
      const end = this._formatDate(match.end);

      if (start && end) {
        period = current
          ? "bis " + this._escape(end)
          : "ab " + this._escape(start) + " · bis " + this._escape(end);
      } else if (start) {
        period = "ab " + this._escape(start);
      } else if (end) {
        period = "bis " + this._escape(end);
      }

      return (
        '<div class="match ' + status + '">' +
          '<div class="marker">' + icon + "</div>" +
          '<div class="match-main">' +
            '<div class="match-title">' + name + "</div>" +
            '<div class="match-meta">' +
              this._escape(label) + " · " + this._escape(distance) +
            "</div>" +
            '<div class="match-period">' + period + "</div>" +
          "</div>" +
        "</div>"
      );
    }

    _styles() {
      return [
        ":host{display:block;color:var(--primary-text-color);font-family:var(--mdc-typography-font-family,sans-serif)}",
        "ha-card{overflow:hidden;background:var(--ha-card-background,var(--card-background-color));color:var(--primary-text-color)}",
        ".header{display:flex;align-items:center;gap:14px;padding:16px 18px 14px;cursor:pointer;user-select:none}",
        ".header:focus-visible{outline:2px solid var(--primary-color);outline-offset:-2px}",
        ".header-icon{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:var(--secondary-background-color);font-size:24px;flex:0 0 auto}",
        ".header-main{min-width:0;flex:1}",
        ".title{font-size:18px;font-weight:600;line-height:1.25}",
        ".subtitle{margin-top:3px;color:var(--secondary-text-color);font-size:13px}",
        ".summary{display:flex;flex-wrap:wrap;gap:7px;padding:0 18px 12px}",
        ".badge{display:inline-flex;align-items:center;min-height:28px;padding:0 10px;border-radius:999px;background:var(--secondary-background-color);font-size:12px;font-weight:500}",
        ".matches{display:grid;gap:1px}",
        ".match{display:flex;align-items:flex-start;gap:12px;padding:12px 18px;border-top:1px solid var(--divider-color)}",
        ".match.aktuell{background:color-mix(in srgb,var(--error-color) 5%,transparent)}",
        ".match.geplant{background:color-mix(in srgb,var(--warning-color) 4%,transparent)}",
        ".marker{width:28px;flex:0 0 28px;font-size:16px}",
        ".match-main{min-width:0;flex:1}",
        ".match-title{font-size:15px;font-weight:500;line-height:1.3;overflow-wrap:anywhere}",
        ".match-meta,.match-period{margin-top:3px;color:var(--secondary-text-color);font-size:12px}",
        ".empty{display:flex;align-items:center;gap:12px;margin:0 18px 14px;padding:14px;border-radius:10px;background:var(--secondary-background-color)}",
        ".empty-icon{font-size:22px}.empty-title{font-weight:600}.empty-text{margin-top:2px;color:var(--secondary-text-color);font-size:12px}",
        ".footer{display:flex;gap:5px;padding:10px 18px 14px;color:var(--secondary-text-color);font-size:11px}",
        ".error{padding:18px}.message{margin-top:8px;color:var(--secondary-text-color);font-size:13px;line-height:1.5}",
        "code{font-family:var(--code-font-family,monospace)}",
      ].join("");
    }

    _render() {
      if (!this._config) return;

      const state = this._getState();
      if (!state) {
        this._root.innerHTML =
          "<style>" + this._styles() + "</style>" +
          "<ha-card><div class='error'>" +
          "<div class='title'>🚧 Comuro</div>" +
          "<div class='message'>Entity <code>" +
          this._escape(this._config.entity) +
          "</code> wurde nicht gefunden.</div></div></ha-card>";
        return;
      }

      const attrs = state.attributes || {};
      const matches = this._getMatches();
      const currentCount = matches.filter(
        (match) => match && match.status === "aktuell"
      ).length;
      const plannedCount = matches.filter(
        (match) => match && match.status === "geplant"
      ).length;

      const routeName =
        attrs.route_name ||
        attrs.friendly_name ||
        state.name ||
        "Route";

      let content;

      if (!matches.length) {
        content =
          "<div class='empty'>" +
          "<div class='empty-icon'>✅</div>" +
          "<div><div class='empty-title'>Freie Fahrt</div>" +
          "<div class='empty-text'>Keine Baustellen auf dieser Route.</div></div>" +
          "</div>";
      } else {
        const rows = matches.map((match) => this._renderMatch(match)).join("");
        const badges =
          (currentCount
            ? "<span class='badge'>🔴 " + currentCount + " aktuell</span>"
            : "") +
          (plannedCount
            ? "<span class='badge'>🟡 " + plannedCount + " geplant</span>"
            : "");

        content =
          "<div class='summary'>" + badges + "</div>" +
          "<div class='matches'>" + rows + "</div>";
      }

      this._root.innerHTML =
        "<style>" + this._styles() + "</style>" +
        "<ha-card>" +
          "<div class='header' role='button' tabindex='0'>" +
            "<div class='header-icon'>🚧</div>" +
            "<div class='header-main'>" +
              "<div class='title'>" + this._escape(routeName) + "</div>" +
              "<div class='subtitle'>" +
                currentCount + " aktuell · " + plannedCount + " geplant" +
              "</div>" +
            "</div>" +
          "</div>" +
          content +
          "<div class='footer'>" +
            "<span>Vom Start der Route sortiert</span>" +
            "<span>·</span>" +
            "<span>Puffer " + this._escape(attrs.buffer_m ?? "—") + " m</span>" +
          "</div>" +
        "</ha-card>";

      const header = this._root.querySelector(".header");
      if (header) {
        header.addEventListener("click", () => this._openMoreInfo());
        header.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this._openMoreInfo();
          }
        });
      }
    }
  }

  function registerCard() {
    // Home Assistant 2026.x can execute extra modules before the scoped
    // custom-element registry polyfill replaces window.customElements.
    // Registering after the window load event avoids losing the definition.
    if (!customElements.get(TAG)) {
      customElements.define(TAG, ComuroRouteCard);
    }

    window.customCards = window.customCards || [];

    if (!window.customCards.some((card) => card.type === TAG)) {
      window.customCards.push({
        type: TAG,
        name: "Comuro Route",
        description: "Zeigt aktuelle und geplante Baustellen einer Comuro-Route.",
        preview: true,
        documentationURL: "https://github.com/xjazzor/Comuro",
        getEntitySuggestion: (hass, entityId) => {
          const state = hass && hass.states ? hass.states[entityId] : null;
          if (
            !state ||
            !entityId.startsWith("binary_sensor.") ||
            !Array.isArray(state.attributes && state.attributes.matches)
          ) {
            return null;
          }

          return {
            config: {
              type: "custom:" + TAG,
              entity: entityId,
            },
          };
        },
      });
    }
  }

  if (document.readyState === "complete") {
    registerCard();
  } else {
    window.addEventListener("load", registerCard, { once: true });
  }
})();
