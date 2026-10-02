# Comuro Route Editor

The Comuro Route Editor is a Home Assistant app that provides an interactive map for creating and managing saved routes.

It is intentionally responsible only for route management. Construction-data retrieval, geospatial matching and lifecycle tracking are implemented by the Comuro Home Assistant integration.

Routes are written to `/share/comuro/routes.json`.

The route file format is defined by `/contracts/routes.schema.json`.

## Local development

Build the app locally from this directory:

```bash
docker build -t local/comuro-route-editor .
```

For Home Assistant development, add the repository as a local app repository or use a Home Assistant development environment.
