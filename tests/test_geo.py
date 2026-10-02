from custom_components.comuro.geo import (
    TO_UTM,
    earliest_route_contact,
    match_route,
)
from custom_components.comuro.models import (
    ConstructionSite,
    Route,
)
from shapely.geometry import LineString, Polygon
from shapely.ops import transform


def make_route():
    return Route(
        id="route-1",
        name="Test",
        coordinates=[
            [7.0, 51.5],
            [7.1, 51.5],
            [7.2, 51.5],
        ],
        buffer_m=30,
    )


def make_site(site_id, x, y=51.5):
    delta = 0.00008
    geometry = {
        "type": "Polygon",
        "coordinates": [[
            [x-delta, y-delta],
            [x+delta, y-delta],
            [x+delta, y+delta],
            [x-delta, y+delta],
            [x-delta, y-delta],
        ]],
    }
    return ConstructionSite(
        construction_id=site_id,
        status="aktuell",
        name=site_id,
        geometry=geometry,
    )


def test_match_is_sorted_by_first_contact_along_route():
    route = make_route()
    sites = [
        make_site("dortmund:far", 7.18),
        make_site("dortmund:near", 7.03),
        make_site("dortmund:middle", 7.11),
    ]

    matches = match_route(route, sites)

    assert [m.construction_id for m in matches] == [
        "dortmund:near",
        "dortmund:middle",
        "dortmund:far",
    ]


def test_same_construction_only_appears_once():
    route = make_route()

    geometry = {
        "type": "MultiPolygon",
        "coordinates": [
            [[
                [7.03, 51.4999], [7.031, 51.4999],
                [7.031, 51.5001], [7.03, 51.5001],
                [7.03, 51.4999]
            ]],
            [[
                [7.17, 51.4999], [7.171, 51.4999],
                [7.171, 51.5001], [7.17, 51.5001],
                [7.17, 51.4999]
            ]],
        ],
    }

    site = ConstructionSite(
        construction_id="dortmund:duplicate",
        status="aktuell",
        name="Mehrfachschnitt",
        geometry=geometry,
    )

    matches = match_route(route, [site])

    assert len(matches) == 1
    assert matches[0].route_position_m < 10_000


def test_earliest_contact_is_before_later_intersection():
    route = make_route()
    route_m = transform(
        TO_UTM,
        LineString(route.coordinates),
    )

    construction = transform(
        TO_UTM,
        Polygon([
            (7.18, 51.4999),
            (7.181, 51.4999),
            (7.181, 51.5001),
            (7.18, 51.5001),
            (7.18, 51.4999),
        ]),
    )

    position = earliest_route_contact(
        route_m,
        construction,
        30,
    )

    assert position is not None
