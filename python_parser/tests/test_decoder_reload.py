"""Tests for the decoder's catalog-change fingerprint used for hot reload."""

import os

from decoder import catalog_fingerprint

MINIMAL_XML = (
    '<Bus Name="TEST_CAN">'
    '<massage id="0x2FC" name="MSG">'
    "<Byte><Num>0</Num>"
    '<Signal Bit="xxxxxx11"><signal_name>sig_a</signal_name></Signal>'
    "</Byte></massage></Bus>"
)


def test_fingerprint_stable_when_unchanged(tmp_path) -> None:
    """Same directory contents yield the same fingerprint."""
    (tmp_path / "a.xml").write_text(MINIMAL_XML)
    assert catalog_fingerprint(tmp_path) == catalog_fingerprint(tmp_path)


def test_fingerprint_changes_on_edit(tmp_path) -> None:
    """Rewriting a file (new mtime/size) changes the fingerprint."""
    f = tmp_path / "a.xml"
    f.write_text(MINIMAL_XML)
    before = catalog_fingerprint(tmp_path)
    f.write_text(MINIMAL_XML + "<!-- edited -->")
    os.utime(f, ns=(f.stat().st_atime_ns, f.stat().st_mtime_ns + 1_000_000))
    assert catalog_fingerprint(tmp_path) != before


def test_fingerprint_changes_on_add_and_delete(tmp_path) -> None:
    """Adding or removing a catalog file changes the fingerprint."""
    (tmp_path / "a.xml").write_text(MINIMAL_XML)
    only_a = catalog_fingerprint(tmp_path)

    (tmp_path / "b.xml").write_text(MINIMAL_XML)
    with_b = catalog_fingerprint(tmp_path)
    assert with_b != only_a

    (tmp_path / "b.xml").unlink()
    assert catalog_fingerprint(tmp_path) == only_a


def test_fingerprint_ignores_non_xml(tmp_path) -> None:
    """Backup files written by the catalog editor do not trigger reloads."""
    (tmp_path / "a.xml").write_text(MINIMAL_XML)
    before = catalog_fingerprint(tmp_path)
    (tmp_path / "a.xml.bak-20260722-120000").write_text(MINIMAL_XML)
    assert catalog_fingerprint(tmp_path) == before
