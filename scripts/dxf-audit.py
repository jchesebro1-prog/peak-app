"""Audit a conduit riser DXF (#321) with ezdxf — a local check, not a gate.

    ~/.venvs/venue-templates/bin/python -I scripts/dxf-audit.py <file.dxf>

Reads the file the way a CAD package would (ezdxf's recover mode), runs its
auditor, and prints entity counts plus each block's attribute tags. Exits 1
on any auditor error.
"""
import sys
from collections import Counter

from ezdxf import recover


def main(path):
    doc, auditor = recover.readfile(path)
    msp = doc.modelspace()
    print("version", doc.dxfversion, "errors", len(auditor.errors), "fixes", len(auditor.fixes))
    for e in auditor.errors:
        print("  error:", e.message)
    print("entities", dict(Counter(e.dxftype() for e in msp)))
    for block in doc.blocks:
        tags = [e.dxf.tag for e in block if e.dxftype() == "ATTDEF"]
        if tags:
            print("block", block.name, tags)
    bad = [i.dxf.name for i in msp.query("INSERT") if not doc.blocks.get(i.dxf.name)]
    if bad:
        print("inserts naming missing blocks:", sorted(set(bad)))
    return 1 if auditor.errors or bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
