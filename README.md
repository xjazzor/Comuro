# Comuro

Comuro is a Home Assistant project for monitoring saved routes and detecting current and planned roadworks that affect them.

The first data source is the official Open Data service of the City of Dortmund. The long-term goal is a clean separation between the Home Assistant integration (data, tracking, matching and entities) and a separate Home Assistant app/add-on for creating and managing routes.

## Install with HACS

Comuro is packaged as a Home Assistant **integration** and can be installed through HACS as a custom repository during development.

> **Important:** HACS requires repositories to be public on GitHub. The Comuro repository is currently private, so make it public before trying the HACS installation.

### Custom repository

In Home Assistant:

1. Open **HACS**.
2. Open the **⋮** menu in the top-right corner.
3. Select **Custom repositories**.
4. Add `https://github.com/xjazzor/Comuro`.
5. Select **Integration**.
6. Add the repository.
7. Search for **Comuro** in HACS and install it.
8. Restart Home Assistant.
9. Go to **Settings → Devices & services → Add Integration** and select **Comuro**.

For a convenient one-click link:

https://my.home-assistant.io/redirect/hacs_repository/?owner=xjazzor&repository=Comuro&category=integration

HACS uses `hacs.json` for repository metadata, while the integration itself is discovered from `custom_components/comuro/manifest.json`.

## Architecture

```text
                    Home Assistant
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
     Comuro integration      Comuro Route Editor
              │                app/add-on
              │                     │
              │              /share/comuro/
              │                routes.json
              │                     │
              └──────────┬──────────┘
                         │
                  route definitions
                         │
                         ▼
                 Dortmund Open Data
                         │
                         ▼
                 geospatial matching
                         │
                         ▼
                 route-specific state
                         │
                         ▼
                  HA entities/events
```

## Current design decisions

- Dortmund Open Data is the first provider.
- The provider uses the current and planned roadwork area datasets.
- Data is refreshed every 60 minutes.
- Construction sites are tracked across snapshots using a stable `construction_id`.
- A longer end date produces a dedicated `EXTENDED` event.
- A construction missing from one snapshot is not immediately treated as resolved; resolution requires multiple missing snapshots.
- A route match is listed only once, even when a construction geometry intersects the route multiple times.
- The route position is the first point along the route where the configured warning corridor reaches the construction.
- Matches are ordered from the start of the route.
- The visual distinction is intentionally limited to current vs. planned construction.
- The integration does not expose separate next-construction sensors.
- Route editing and visualization belong to the separate route-editor app/add-on.

## Repository structure

```text
Comuro/
├── custom_components/
│   └── comuro/
│       ├── __init__.py
│       ├── manifest.json
│       ├── config_flow.py
│       ├── const.py
│       ├── runtime.py
│       ├── coordinator.py
│       ├── entity.py
│       ├── models.py
│       ├── dortmund.py
│       ├── geo.py
│       ├── tracker.py
│       ├── sensor.py
│       ├── binary_sensor.py
│       ├── strings.json
│       └── translations/
├── comuro_route_editor/
├── contracts/
├── tests/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── hacs.yml
├── hacs.json
├── repository.yaml
├── requirements-dev.txt
├── pyproject.toml
├── LICENSE
└── .gitignore
```

## Development

Python 3.12+ is used for the development environment.

Install development dependencies:

```powershell
python -m pip install -r requirements-dev.txt
```

Run the core test suite:

```powershell
pytest
```

Run Ruff:

```powershell
ruff check custom_components tests
```

The GitHub Actions pipeline validates the Python test suite, Ruff, Home Assistant metadata with Hassfest, and HACS compatibility.

## Home Assistant integration

The integration is currently in active development and is not yet a finished release.

The initial integration uses:

- a 60-minute DataUpdateCoordinator
- Home Assistant persistent storage for construction lifecycle state
- routes read from `/share/comuro/routes.json`
- dynamic per-route entities for current/planned construction counts and current route impact

The route editor app will become the owner of `routes.json`.

## Data source

Comuro's first provider uses the official Dortmund Open Data roadwork datasets:

- `fb66-baustellen-tagesaktuell-flachen`
- `fb66-baustellen-geplant-flachen`

Dortmund states that these datasets contain the current and planned construction-site areas and that the dataset schema was technically adjusted on 2026-02-09.

The current/planned API data exposes fields such as `art_der_baumassnahme`, `auftraggeber`, `einschrankung`, `zeitraum`, `von`, `bis`, `stadtbezirk`, `status` and `kommune`. In the currently published planned records, `einschrankung` is often null, so Comuro keeps the original raw data rather than inventing a normalized restriction classification.

## License

Comuro is released under the MIT License.
