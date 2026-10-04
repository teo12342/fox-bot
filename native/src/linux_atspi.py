"""Read-only AT-SPI inspection; embedded into the native binary."""
import json
import sys
import pyatspi

nodes = []
focused = {"found": False}

def walk(element, depth):
    if depth > 8 or len(nodes) >= 500:
        return
    try:
        state = element.getState()
        if state.contains(pyatspi.STATE_DEFUNCT):
            return
        if state.contains(pyatspi.STATE_FOCUSED):
            focused.update({"found": True, "name": element.name or "",
                            "password": element.getRole() == pyatspi.ROLE_PASSWORD_TEXT})
        try:
            rect = element.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
            bounds = {"x": rect.x, "y": rect.y, "width": rect.width, "height": rect.height}
        except Exception:
            bounds = None
        nodes.append({"name": element.name or "", "role": element.getRoleName(),
                      "depth": depth, "bounds": bounds})
        # Read metadata only; never request editable-text/password values.
        for index in range(min(element.childCount, 500)):
            if len(nodes) >= 500:
                break
            try:
                walk(element.getChildAtIndex(index), depth + 1)
            except Exception:
                pass
    except Exception:
        pass

desktop = pyatspi.Registry.getDesktop(0)
walk(desktop, 0)
print(json.dumps(focused if "--focused-sensitive" in sys.argv else
                 {"elements": nodes, "limit": 500}, separators=(",", ":")))
