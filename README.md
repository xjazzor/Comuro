# Comuro

Comuro is a Home Assistant-focused route monitoring project that detects current and planned roadworks affecting saved routes.

The project is currently being developed in phases:

1. **Core engine** – provider, geospatial matching, and construction lifecycle tracking
2. **Home Assistant integration** – coordinator, persistent storage, entities, config flow
3. **Route editor app/add-on** – interactive route creation and management
4. **Integration** – connect saved routes from the route editor with the HA integration
5. **Notifications and event handling** – new roadworks, extensions, status changes, and resolved roadworks

## Current design decisions

- Dortmund Open Data is the first data provider.
- Roadwork data is refreshed every **60 minutes**.
- Construction sites are tracked across snapshots using a stable source identifier.
- End-date extensions are detected as a dedicated **EXTENDED** event.
- Temporary API omissions do not immediately resolve a construction; resolution requires multiple missing snapshots.
- Route matches are ordered by the **first affected position along the route**, measured from the route start.
- A construction is listed only once per route even when its geometry intersects the route multiple times.
- Current and planned construction sites are distinguished visually by status only.

## Project structure

```text
Comuro/
├── comuro/
│   ├── __init__.py
│   ├── models.py
│   ├── dortmund.py
│   ├── geo.py
│   └── tracker.py
├── tests/
│   ├── test_models.py
│   ├── test_geo.py
│   └── test_tracker.py
├── integration/
├── addon/
├── docs/
├── pyproject.toml
├── LICENSE
└── .gitignore
```

## Development

Python 3.12 or newer is required for the current development setup.

Install test dependencies:

```powershell
python -m pip install -e ".[test]"
```

Run the tests:

```powershell
pytest
```

## Data source

The first provider uses the official Open Data datasets published by the City of Dortmund:

- current roadworks
- planned roadworks

The provider normalizes these external records into Comuro's internal data model so the matching and tracking logic remain independent of the source.

## License

Comuro is released under the MIT License.
