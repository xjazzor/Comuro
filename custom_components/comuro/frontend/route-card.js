(() => {
  const TAG = "comuro-route-card";

  class ComuroRouteCard extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._config = null;
      this._root = this.attachShadow({ mode: "open" });
      this._filter = "all";
    }

    setConfig(config) {
      if (!config || typeof config.entity !== "string" || !config.entity) {
        throw new Error(
          'Comuro Route Card benötigt "entity", z. B. binary_sensor.comuro_arbeit_betroffen.'
        );
      }

      const firstConfig = !this._config;
      this._config = {
        show_filter: true,
        default_filter: "all",
        show_counts: true,
        show_distance: true,
        show_status: true,
        show_dates: true,
        show_footer: true,
        show_icon: true,
        compact: false,
        max_items: 0,
        ...config,
      };

      if (firstConfig || !["all", "aktuell", "geplant"].includes(this._filter)) {
        this._filter = this._config.default_filter;
      }

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
      const matches = this._getFilteredMatches();
      return Math.min(Math.max(matches.length + 3, 4), 10);
    }

    getGridOptions() {
      const rows = Math.min(Math.max(this._getFilteredMatches().length + 3, 4), 10);

      return {
        rows,
        columns: 6,
        min_rows: 4,
        max_rows: 10,
        min_columns: 3,
        max_columns: 12,
      };
    }

    static getStubConfig() {
      return {
        entity: "binary_sensor.comuro_arbeit_betroffen",
      };
    }

    static getConfigForm() {
      return {
        schema: [
          {
            name: "entity",
            required: true,
            selector: {
              entity: {
                domain: "binary_sensor",
              },
            },
          },
          {
            name: "title",
            selector: {
              text: {},
            },
          },
          {
            name: "icon",
            selector: {
              text: {},
            },
          },
          {
            name: "show_filter",
            selector: {
              boolean: {},
            },
          },
          {
            name: "default_filter",
            selector: {
              select: {
                options: [
                  "all",
                  "aktuell",
                  "geplant",
                ],
                mode: "dropdown",
              },
            },
          },
          {
            name: "max_items",
            selector: {
              number: {
                min: 0,
                max: 50,
                mode: "slider",
              },
            },
          },
          {
            name: "show_counts",
            selector: {
              boolean: {},
            },
          },
          {
            name: "show_distance",
            selector: {
              boolean: {},
            },
          },
          {
            name: "show_status",
            selector: {
              boolean: {},
            },
          },
          {
            name: "show_dates",
            selector: {
              boolean: {},
            },
          },
          {
            name: "show_footer",
            selector: {
              boolean: {},
            },
          },
          {
            name: "show_icon",
            selector: {
              boolean: {},
            },
          },
          {
            name: "compact",
            selector: {
              boolean: {},
            },
          },
          {
            name: "accent_color",
            selector: {
              text: {},
            },
          },
          {
            name: "current_color",
            selector: {
              text: {},
            },
          },
          {
            name: "planned_color",
            selector: {
              text: {},
            },
          },
          {
            name: "current_background",
            selector: {
              text: {},
            },
          },
          {
            name: "planned_background",
            selector: {
              text: {},
            },
          },
          {
            name: "card_background",
            selector: {
              text: {},
            },
          },
          {
            name: "divider_color",
            selector: {
              text: {},
            },
          },
          {
            name: "secondary_text_color",
            selector: {
              text: {},
            },
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

    _getFilteredMatches() {
      let matches = this._getMatches();

      if (this._filter !== "all") {
        matches = matches.filter(
          (match) => match && match.status === this._filter
        );
      }

      const maxItems = Number(this._config.max_items || 0);

      if (Number.isFinite(maxItems) && maxItems > 0) {
        matches = matches.slice(0, maxItems);
      }

      return matches;
    }

    _formatDistance(value) {
      const meters = Number(value);

      if (!Number.isFinite(meters)) {
        return "—";
      }

      if (Math.abs(meters) >= 1000) {
        return (meters / 1000).toLocaleString("de-DE", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }) + " km";
      }

      return Math.round(meters).toLocaleString("de-DE") + " m";
    }

    _formatDate(value) {
      if (!value) {
        return "";
      }

      const date = new Date(String(value).slice(0, 10) + "T00:00:00");

      if (Number.isNaN(date.getTime())) {
        return String(value);
      }

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
          detail: {
            entityId: this._config.entity,
          },
        })
      );
    }

    _setFilter(filter) {
      this._filter = filter;
      this._render();
    }

    _color(value, fallback) {
      const text = String(value || "").trim();

      if (
        /^#[0-9a-f]{3,8}$/i.test(text) ||
        /^rgba?\([^)]+\)$/i.test(text) ||
        /^hsla?\([^)]+\)$/i.test(text) ||
        /^var\(--[a-z0-9-_]+\)$/i.test(text)
      ) {
        return text;
      }

      return fallback;
    }

    _renderMatch(match) {
      const current = match.status === "aktuell";
      const status = current ? "aktuell" : "geplant";
      const color = current ? "var(--comuro-current-color)" : "var(--comuro-planned-color)";
      const icon = current ? "🔴" : "🟡";
      const label = current ? "Aktuell" : "Geplant";
      const name = this._escape(match.name || "Baustelle");
      const distance = this._formatDistance(match.route_position_m);

      let details = [];

      if (this._config.show_status) {
        details.push(label);
      }

      if (this._config.show_distance) {
        details.push(distance);
      }

      let period = "";

      if (this._config.show_dates) {
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
      }

      return (
        '<div class="match ' + status + '" style="--comuro-row-color:' + color + '">' +
          (this._config.show_icon
            ? '<div class="marker">' + icon + "</div>"
            : "") +
          '<div class="match-main">' +
            '<div class="match-title">' + name + "</div>" +
            (details.length
              ? '<div class="match-meta">' + this._escape(details.join(" · ")) + "</div>"
              : "") +
            (period
              ? '<div class="match-period">' + period + "</div>"
              : "") +
          "</div>" +
        "</div>"
      );
    }

    _renderFilterButton(filter, label, count) {
      const active = this._filter === filter;
      const disabled = count === 0 && filter !== "all";

      return (
        '<button class="filter-button' +
          (active ? " active" : "") +
          (disabled ? " disabled" : "") +
          '" type="button" data-filter="' + filter + '"' +
          ' aria-pressed="' + String(active) + '"' +
          (disabled ? " disabled" : "") +
        ">" +
          this._escape(label) +
          '<span class="filter-count">' + count + "</span>" +
        "</button>"
      );
    }

    _styles() {
      return `
        :host {
          display: block;
          color: var(--primary-text-color);
          font-family: var(--mdc-typography-font-family, sans-serif);

          --comuro-accent: var(--primary-color);
          --comuro-current-color: var(--error-color);
          --comuro-planned-color: var(--warning-color);
          --comuro-current-background: color-mix(
            in srgb,
            var(--comuro-current-color) 5%,
            transparent
          );
          --comuro-planned-background: color-mix(
            in srgb,
            var(--comuro-planned-color) 4%,
            transparent
          );
        }

        ha-card {
          overflow: hidden;
          background: var(
            --comuro-card-background,
            var(--ha-card-background, var(--card-background-color))
          );
          color: var(--primary-text-color);
        }

        .header {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 16px 18px 14px;
          cursor: pointer;
          user-select: none;
        }

        .header:focus-visible {
          outline: 2px solid var(--comuro-accent);
          outline-offset: -2px;
        }

        .header-icon {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: var(--secondary-background-color);
          color: var(--comuro-accent);
          font-size: 24px;
          flex: 0 0 auto;
        }

        .header-main {
          min-width: 0;
          flex: 1;
        }

        .title {
          font-size: 18px;
          font-weight: 600;
          line-height: 1.25;
          color: var(--primary-text-color);
        }

        .subtitle {
          margin-top: 3px;
          color: var(--comuro-secondary-text, var(--secondary-text-color));
          font-size: 13px;
        }

        .filters {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          padding: 0 18px 12px;
        }

        .filter-button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 30px;
          padding: 0 10px;
          border: 1px solid var(--divider-color);
          border-radius: 999px;
          color: var(--primary-text-color);
          background: transparent;
          font: inherit;
          font-size: 12px;
          cursor: pointer;
        }

        .filter-button:hover {
          background: var(--secondary-background-color);
        }

        .filter-button.active {
          border-color: var(--comuro-accent);
          color: var(--comuro-accent);
          background: color-mix(
            in srgb,
            var(--comuro-accent) 10%,
            transparent
          );
        }

        .filter-button.disabled {
          opacity: 0.45;
          cursor: default;
        }

        .filter-count {
          color: var(--comuro-secondary-text, var(--secondary-text-color));
        }

        .summary {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          padding: 0 18px 12px;
        }

        .badge {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          background: var(--secondary-background-color);
          font-size: 12px;
          font-weight: 500;
        }

        .matches {
          display: grid;
          gap: 1px;
        }

        .match {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 12px 18px;
          border-top: 1px solid var(--comuro-divider, var(--divider-color));
          background: var(--comuro-row-background, transparent);
          box-shadow: inset 3px 0 0 var(--comuro-row-color);
        }

        .match.aktuell {
          background: var(--comuro-current-background);
        }

        .match.geplant {
          background: var(--comuro-planned-background);
        }

        .marker {
          width: 28px;
          flex: 0 0 28px;
          font-size: 16px;
        }

        .match-main {
          min-width: 0;
          flex: 1;
        }

        .match-title {
          font-size: 15px;
          font-weight: 500;
          line-height: 1.3;
          overflow-wrap: anywhere;
        }

        .match-meta,
        .match-period {
          margin-top: 3px;
          color: var(--comuro-secondary-text, var(--secondary-text-color));
          font-size: 12px;
        }

        .empty {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 0 18px 14px;
          padding: 14px;
          border-radius: 10px;
          background: var(--secondary-background-color);
        }

        .empty-icon {
          font-size: 22px;
        }

        .empty-title {
          font-weight: 600;
        }

        .empty-text {
          margin-top: 2px;
          color: var(--comuro-secondary-text, var(--secondary-text-color));
          font-size: 12px;
        }

        .footer {
          display: flex;
          gap: 5px;
          padding: 10px 18px 14px;
          color: var(--comuro-secondary-text, var(--secondary-text-color));
          font-size: 11px;
        }

        .compact .header {
          padding: 12px 14px 10px;
        }

        .compact .header-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          font-size: 20px;
        }

        .compact .title {
          font-size: 16px;
        }

        .compact .filters,
        .compact .summary {
          padding-inline: 14px;
          padding-bottom: 9px;
        }

        .compact .match {
          gap: 9px;
          padding: 9px 14px;
        }

        .compact .marker {
          width: 24px;
          flex-basis: 24px;
          font-size: 14px;
        }

        .compact .footer {
          padding: 8px 14px 10px;
        }

        .error {
          padding: 18px;
        }

        .message {
          margin-top: 8px;
          color: var(--comuro-secondary-text, var(--secondary-text-color));
          font-size: 13px;
          line-height: 1.5;
        }

        code {
          font-family: var(--code-font-family, monospace);
        }
      `;
    }

    _render() {
      if (!this._config) {
        return;
      }

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
      const allMatches = this._getMatches();
      const matches = this._getFilteredMatches();

      const currentCount = allMatches.filter(
        (match) => match && match.status === "aktuell"
      ).length;
      const plannedCount = allMatches.filter(
        (match) => match && match.status === "geplant"
      ).length;

      const routeName =
        this._config.title ||
        attrs.route_name ||
        attrs.friendly_name ||
        state.name ||
        "Route";

      const activeFilterLabel =
        this._filter === "aktuell"
          ? "aktuelle Baustellen"
          : this._filter === "geplant"
            ? "geplante Baustellen"
            : "Baustellen";

      let content = "";

      if (!allMatches.length) {
        content =
          "<div class='empty'>" +
          "<div class='empty-icon'>✅</div>" +
          "<div>" +
          "<div class='empty-title'>Freie Fahrt</div>" +
          "<div class='empty-text'>Keine Baustellen auf dieser Route.</div>" +
          "</div>" +
          "</div>";
      } else if (!matches.length) {
        content =
          "<div class='empty'>" +
          "<div class='empty-icon'>ℹ️</div>" +
          "<div>" +
          "<div class='empty-title'>Nichts gefunden</div>" +
          "<div class='empty-text'>" +
          this._escape(activeFilterLabel) +
          " sind auf dieser Route nicht vorhanden.</div>" +
          "</div>" +
          "</div>";
      } else {
        const rows = matches
          .map((match) => this._renderMatch(match))
          .join("");

        content = "<div class='matches'>" + rows + "</div>";
      }

      const filterControls = this._config.show_filter
        ? "<div class='filters'>" +
          this._renderFilterButton("all", "Alle", allMatches.length) +
          this._renderFilterButton("aktuell", "Aktuell", currentCount) +
          this._renderFilterButton("geplant", "Geplant", plannedCount) +
          "</div>"
        : "";

      const summary = this._config.show_counts
        ? "<div class='summary'>" +
          "<span class='badge'>🔴 " + currentCount + " aktuell</span>" +
          "<span class='badge'>🟡 " + plannedCount + " geplant</span>" +
          "</div>"
        : "";

      const footer = this._config.show_footer
        ? "<div class='footer'>" +
          "<span>Vom Start der Route sortiert</span>" +
          "<span>·</span>" +
          "<span>Puffer " +
          this._escape(attrs.buffer_m ?? "—") +
          " m</span>" +
          "</div>"
        : "";

      const customStyle =
        "--comuro-accent:" +
        this._color(
          this._config.accent_color,
          "var(--primary-color)"
        ) +
        ";" +
        "--comuro-current-color:" +
        this._color(
          this._config.current_color,
          "var(--error-color)"
        ) +
        ";" +
        "--comuro-planned-color:" +
        this._color(
          this._config.planned_color,
          "var(--warning-color)"
        ) +
        ";" +
        "--comuro-current-background:" +
        this._color(
          this._config.current_background,
          "color-mix(in srgb, var(--comuro-current-color) 5%, transparent)"
        ) +
        ";" +
        "--comuro-planned-background:" +
        this._color(
          this._config.planned_background,
          "color-mix(in srgb, var(--comuro-planned-color) 4%, transparent)"
        ) +
        ";" +
        "--comuro-card-background:" +
        this._color(
          this._config.card_background,
          "var(--ha-card-background, var(--card-background-color))"
        ) +
        ";" +
        "--comuro-divider:" +
        this._color(
          this._config.divider_color,
          "var(--divider-color)"
        ) +
        ";" +
        "--comuro-secondary-text:" +
        this._color(
          this._config.secondary_text_color,
          "var(--secondary-text-color)"
        ) +
        ";";

      this._root.innerHTML =
        "<style>" +
        this._styles() +
        "</style>" +
        "<div class='" +
        (this._config.compact ? "compact" : "") +
        "' style='" +
        customStyle +
        "'>" +
        "<ha-card>" +
          "<div class='header' role='button' tabindex='0'>" +
            (this._config.show_icon
              ? "<div class='header-icon'>" +
                this._escape(this._config.icon || "🚧") +
                "</div>"
              : "") +
            "<div class='header-main'>" +
              "<div class='title'>" +
                this._escape(routeName) +
              "</div>" +
              (this._config.show_counts
                ? "<div class='subtitle'>" +
                  currentCount +
                  " aktuell · " +
                  plannedCount +
                  " geplant" +
                  "</div>"
                : "") +
            "</div>" +
          "</div>" +
          filterControls +
          summary +
          content +
          footer +
        "</ha-card>" +
        "</div>";

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

      this._root.querySelectorAll(".filter-button").forEach((button) => {
        button.addEventListener("click", () => {
          this._setFilter(button.dataset.filter);
        });
      });
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
