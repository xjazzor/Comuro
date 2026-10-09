# Comuro

Comuro is a Home Assistant integration for monitoring saved routes and detecting current and planned roadworks that affect them.

## Comuro Route dashboard card

Comuro also registers a native Lovelace custom card automatically. No separate frontend resource has to be added manually.

The card reads the existing `matches` attribute from a Comuro route's **Betroffen** binary sensor and displays current and planned roadworks ordered from the start of the route.

Minimal dashboard configuration:

```yaml
type: custom:comuro-route-card
entity: binary_sensor.<deine_route>_betroffen
```

The card supports the Home Assistant card editor and only requires the route's **Betroffen** entity.

## Install with HACS

In Home Assistant:

1. Open **HACS**.
2. Open the **⋮** menu in the top-right corner.
3. Select **Custom repositories**.
4. Add `https://github.com/xjazzor/Comuro`.
5. Select **Integration**.
6. Install **Comuro**.
7. Restart Home Assistant.
8. Go to **Settings → Devices & services → Add Integration** and select **Comuro**.

For a convenient one-click link:

https://my.home-assistant.io/redirect/hacs_repository/?owner=xjazzor&repository=Comuro&category=integration

## Route management

After Comuro is configured, an administrator gets a **Comuro** entry in the Home Assistant sidebar.

The native route panel provides:

- creating routes on an interactive map
- editing route names
- editing the warning buffer in meters
- enabling or disabling routes
- changing the route geometry
- deleting routes

Routes are now stored by Comuro in Home Assistant persistent storage. The old `/share/comuro/routes.json` file is imported automatically once when native storage does not exist. The legacy file is not deleted during migration.

The route panel communicates directly with the Comuro integration through Home Assistant HTTP endpoints. No separate FastAPI service, Uvicorn process or add-on is required.

The panel is registered by the integration and is administrator-only. Route changes are applied immediately against the cached Dortmund snapshot, so changing a route does not trigger another Dortmund network request.

## Architecture

```text
                         Home Assistant
                              │
                 ┌────────────┴────────────┐
                 │                         │
                 ▼                         ▼
          Comuro integration        Native Comuro panel
                 │                         │
        ┌────────┼────────┐                │
        │        │        │                │
        ▼        ▼        ▼                │
    Dortmund   Tracker   Entities ◄────────┘
        │
        ▼
  Geospatial matching
        │
        ▼
   Route-specific state
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
- Route management is part of the integration and no longer requires a separate add-on.

## Repository structure

```text
Comuro/
├── custom_components/
│   └── comuro/
│       ├── __init__.py
│       ├── manifest.json
│       ├── config_flow.py
│       ├── coordinator.py
│       ├── route_store.py
│       ├── api.py
│       ├── runtime.py
│       ├── entity.py
│       ├── dortmund.py
│       ├── geo.py
│       ├── tracker.py
│       ├── sensor.py
│       ├── binary_sensor.py
│       ├── frontend/
│       │   ├── panel.js
│       │   └── route-card.js
│       ├── strings.json
│       └── translations/
├── contracts/
├── tests/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── hacs.yml
├── hacs.json
├── requirements-dev.txt
├── pyproject.toml
└── LICENSE
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

The integration currently uses:

- a 60-minute `DataUpdateCoordinator`
- Home Assistant persistent storage for construction lifecycle state
- Home Assistant persistent storage for routes
- a native administrator-only Comuro sidebar panel
- a native Lovelace Comuro Route card, automatically registered by the integration
- dynamic per-route entities for current/planned construction counts and current route impact

## Data source

Comuro's first provider uses the official Dortmund Open Data roadwork datasets:

- `fb66-baustellen-tagesaktuell-flachen`
- `fb66-baustellen-geplant-flachen`

Dortmund states that these datasets contain the current and planned construction-site areas and that the dataset schema was technically adjusted on 2026-02-09.

The current/planned API data exposes fields such as `art_der_baumassnahme`, `auftraggeber`, `einschrankung`, `zeitraum`, `von`, `bis`, `stadtbezirk`, `status` and `kommune`. In the currently published planned records, `einschrankung` is often null, so Comuro keeps the original raw data rather than inventing a normalized restriction classification.

## License

Comuro is released under the MIT License.
