from datetime import UTC, date, datetime

from custom_components.comuro import tracker as tracker_module
from custom_components.comuro.models import ConstructionSite


NOW = datetime(
    2026,
    10,
    2,
    8,
    tzinfo=UTC,
)


def make_site(
    end=date(2026, 11, 13),
    status="aktuell",
    name="Test",
):
    return ConstructionSite(
        construction_id="dortmund:1",
        status=status,
        name=name,
        geometry={
            "type": "Point",
            "coordinates": [7.4, 51.5],
        },
        start=date(2026, 10, 1),
        end=end,
    )


def test_first_snapshot_creates_new_event():
    construction_tracker = tracker_module.ConstructionTracker()
    events = construction_tracker.process_snapshot(
        [make_site()],
        NOW,
    )
    assert [event.event_type for event in events] == [tracker_module.NEW]


def test_same_site_on_next_snapshot_is_not_new():
    construction_tracker = tracker_module.ConstructionTracker()
    construction_tracker.process_snapshot(
        [make_site()],
        NOW,
    )

    events = construction_tracker.process_snapshot(
        [make_site()],
        datetime(
            2026,
            10,
            2,
            9,
            tzinfo=UTC,
        ),
    )

    assert events == []


def test_extension_has_separate_event():
    construction_tracker = tracker_module.ConstructionTracker()
    construction_tracker.process_snapshot(
        [make_site()],
        NOW,
    )

    events = construction_tracker.process_snapshot(
        [make_site(end=date(2026, 11, 20))],
        datetime(
            2026,
            10,
            2,
            9,
            tzinfo=UTC,
        ),
    )

    assert [event.event_type for event in events] == [tracker_module.EXTENDED]


def test_status_change_has_separate_event():
    construction_tracker = tracker_module.ConstructionTracker()
    construction_tracker.process_snapshot(
        [make_site(status="geplant")],
        NOW,
    )

    events = construction_tracker.process_snapshot(
        [make_site(status="aktuell")],
        datetime(
            2026,
            10,
            2,
            9,
            tzinfo=UTC,
        ),
    )

    assert [
        event.event_type
        for event in events
    ] == [tracker_module.STATUS_CHANGED]


def test_other_change_is_updated():
    construction_tracker = tracker_module.ConstructionTracker()
    construction_tracker.process_snapshot(
        [make_site(name="Alt")],
        NOW,
    )

    events = construction_tracker.process_snapshot(
        [make_site(name="Neu")],
        datetime(
            2026,
            10,
            2,
            9,
            tzinfo=UTC,
        ),
    )

    assert [
        event.event_type
        for event in events
    ] == [tracker_module.UPDATED]


def test_missing_construction_is_only_resolved_after_threshold():
    construction_tracker = tracker_module.ConstructionTracker(
        missing_cycles_before_resolved=2
    )

    construction_tracker.process_snapshot(
        [make_site()],
        NOW,
    )

    first_missing = construction_tracker.process_snapshot(
        [],
        datetime(
            2026,
            10,
            2,
            9,
            tzinfo=UTC,
        ),
    )

    assert first_missing == []

    second_missing = construction_tracker.process_snapshot(
        [],
        datetime(
            2026,
            10,
            2,
            10,
            tzinfo=UTC,
        ),
    )

    assert [
        event.event_type
        for event in second_missing
    ] == [tracker_module.RESOLVED]


def test_tracker_roundtrip_preserves_state():
    construction_tracker = tracker_module.ConstructionTracker()
    construction_tracker.process_snapshot([make_site()], NOW)

    restored = tracker_module.ConstructionTracker.from_dict(construction_tracker.to_dict())

    assert restored.tracked["dortmund:1"].site == construction_tracker.tracked["dortmund:1"].site
    assert restored.tracked["dortmund:1"].first_seen == construction_tracker.tracked["dortmund:1"].first_seen
    assert restored.tracked["dortmund:1"].missing_cycles == 0
