"""Geospatial route matching."""

from __future__ import annotations

from collections.abc import Iterable

from pyproj import Transformer
from shapely.geometry import (
    GeometryCollection,
    LineString,
    MultiLineString,
    MultiPoint,
    Point,
    shape,
)
from shapely.ops import transform

from .models import ConstructionSite, Route, RouteMatch

TO_UTM = Transformer.from_crs(
    "EPSG:4326",
    "EPSG:25832",
    always_xy=True,
).transform


def earliest_route_contact(
    route_m: LineString,
    construction_m,
    buffer_m: float,
) -> float | None:
    """Return earliest route position where warning zone is reached."""
    warning_zone = construction_m.buffer(buffer_m)
    intersection = route_m.intersection(warning_zone)

    if intersection.is_empty:
        return None

    points: list[Point] = []

    def collect(geometry) -> None:
        if geometry.is_empty:
            return

        if isinstance(geometry, Point):
            points.append(geometry)
        elif isinstance(geometry, MultiPoint):
            points.extend(geometry.geoms)
        elif isinstance(geometry, LineString):
            points.append(Point(geometry.coords[0]))
            points.append(Point(geometry.coords[-1]))
        elif isinstance(geometry, MultiLineString) or isinstance(
            geometry,
            GeometryCollection,
        ):
            for part in geometry.geoms:
                collect(part)
        else:
            points.append(
                geometry.representative_point()
            )

    collect(intersection)

    if not points:
        return None

    return min(
        route_m.project(point)
        for point in points
    )


def match_route(
    route: Route,
    constructions: Iterable[ConstructionSite],
) -> list[RouteMatch]:
    """Match a route against unique construction sites.

    A site is returned once per route, even when its geometry intersects the
    route multiple times. Sorting uses the first affected position along the
    route.
    """
    line = LineString(route.coordinates)
    line_m = transform(TO_UTM, line)

    matches: dict[str, RouteMatch] = {}

    for construction in constructions:
        construction_m = transform(
            TO_UTM,
            shape(construction.geometry),
        )

        route_position = earliest_route_contact(
            line_m,
            construction_m,
            route.buffer_m,
        )

        if route_position is None:
            continue

        match = RouteMatch(
            route_id=route.id,
            construction_id=construction.construction_id,
            status=construction.status,
            route_position_m=round(
                route_position,
                1,
            ),
            distance_m=round(
                line_m.distance(construction_m),
                1,
            ),
            geometry=construction.geometry,
            construction=construction,
        )

        existing = matches.get(
            construction.construction_id
        )

        if (
            existing is None
            or match.route_position_m
            < existing.route_position_m
        ):
            matches[
                construction.construction_id
            ] = match

    return sorted(
        matches.values(),
        key=lambda item: (
            item.route_position_m,
            item.construction.name,
        ),
    )
