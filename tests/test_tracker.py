from datetime import UTC, date, datetime

from custom_components.comuro.models import ConstructionSite
from custom_components.comuro.tracker import (
    ConstructionTracker,
    EXTENDED,
    NEW,
    RESOLVED,
    STATUS_CHANGED,
    UPDATED,
)


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
    tracker = ConstructionTracker()
    events = tracker.process_snapshot(
        [make_site()],
        NOW,
    )
    assert [event.event_type for event in events] == [NEW]


def test_same_site_on_next_snapshot_is_not_new():
    tracker = ConstructionTracker()
    tracker.process_snapshot(
        [make_site()],
        NOW,
    )

    events = tracker.process_snapshot(
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
    tracker = ConstructionTracker()
    tracker.process_snapshot(
        [make_site()],
        NOW,
    )

    events = tracker.process_snapshot(
        [make_site(end=date(2026, 11, 20))],
        datetime(
            2026,
            10,
            2,
            9,
            tzinfo=UTC,
        ),
    )

    assert [event.event_type for event in events] == [EXTENDED]


def test_status_change_has_separate_event():
    tracker = ConstructionTracker()
    tracker.process_snapshot(
        [make_site(status="geplant")],
        NOW,
    )

    events = tracker.process_snapshot(
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
    ] == [STATUS_CHANGED]


def test_other_change_is_updated():
    tracker = ConstructionTracker()
    tracker.process_snapshot(
        [make_site(name="Alt")],
        NOW,
    )

    events = tracker.process_snapshot(
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
    ] == [UPDATED]


def test_missing_construction_is_only_resolved_after_threshold():
    tracker = ConstructionTracker(
        missing_cycles_before_resolved=2
    )

    tracker.process_snapshot(
        [make_site()],
        NOW,
    )

    first_missing = tracker.process_snapshot(
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

    second_missing = tracker.process_snapshot(
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
    ] == [RESOLVED]


def test_tracker_roundtrip_preserves_state():
    tracker = ConstructionTracker()
    tracker.process_snapshot([make_site()], NOW)

    restored = ConstructionTracker.from_dict(tracker.to_dict())

    assert restored.tracked["dortmund:1"].site == tracker.tracked["dortmund:1"].site
    assert restored.tracked["dortmund:1"].first_seen == tracker.tracked["dortmund:1"].first_seen
    assert restored.tracked["dortmund:1"].missing_cycles == 0
