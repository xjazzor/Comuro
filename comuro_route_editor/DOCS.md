# Comuro Route Editor

## Purpose

The app provides a simple map-based route editor for Comuro.

Users can create multiple named routes, draw routes directly on the map, configure the warning buffer for each route, display saved routes, and delete routes.

## Data ownership

The route editor owns the route definition file `/share/comuro/routes.json`.

The Comuro integration reads this file and does not modify it.

The route editor does not fetch or evaluate roadwork data. This keeps route editing independent from the roadwork data and matching engine.

## Route changes

The integration watches the shared route file independently from the hourly Dortmund data update. A changed route is re-evaluated against the cached roadwork snapshot without another external API request.
