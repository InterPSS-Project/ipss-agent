#!/usr/bin/env python3
"""Talk to the draw.io MCP server (`@drawio/mcp`) over stdio.

The official draw.io MCP server opens diagrams in the draw.io editor and reads or replaces
the pages of a local `.drawio` file. DSH mounts it as `mcp__drawio__*` when the profile row
is loaded (see docs/oneline-diagram-process.md); this script speaks the same stdio protocol
directly, so the round-trip also works from a plain shell, from Codex / Claude Code, or in
this session before the profile row is live.

    python3 wspace/script/drawio_mcp.py list  <file.drawio>
    python3 wspace/script/drawio_mcp.py get   <file.drawio> [--page 0] [--out page.xml]
    python3 wspace/script/drawio_mcp.py set   <file.drawio> --page 0 --content page.xml
    python3 wspace/script/drawio_mcp.py open  <file.drawio> [--page 0]     # opens the editor
    python3 wspace/script/drawio_mcp.py shapes "transformer"

`set` replaces one page and leaves the rest of the file alone, so a hand edit made in the
editor (or a page produced here) can be pushed back into the case's diagram and re-checked
with `gen_oneline_diagram.py <case> --check <file>`. The server re-serialises the file it
writes, which changes its bytes but not its structure.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import subprocess
import sys
import threading

DEFAULT_SERVER = os.path.join(
    os.environ.get("DSH_HOME", os.path.expanduser("~/.dsh")),
    "mcp-servers", "drawio", "node_modules", "@drawio", "mcp", "src", "index.js",
)
PROTOCOL = "2024-11-05"


class McpError(RuntimeError):
    pass


class DrawioMcp:
    """Minimal MCP client: newline-delimited JSON-RPC over the server's stdio."""

    def __init__(self, node="node", server=DEFAULT_SERVER, timeout=60.0):
        self.timeout = timeout
        if not os.path.isfile(server):
            raise McpError("MCP server not found: %s\ninstall it as $DSH_HOME/mcp-servers/drawio "
                           "(see docs/oneline-diagram-process.md) or pass --server" % server)
        self.proc = subprocess.Popen(
            [node, server], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1,
        )
        self.inbox: queue.Queue = queue.Queue()
        self.stderr: list[str] = []
        self._next_id = 1
        threading.Thread(target=self._pump_stdout, daemon=True).start()
        threading.Thread(target=self._pump_stderr, daemon=True).start()

    # -- plumbing -----------------------------------------------------------
    def _pump_stdout(self):
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                self.inbox.put(json.loads(line))
            except json.JSONDecodeError:
                pass
        self.inbox.put(None)

    def _pump_stderr(self):
        for line in self.proc.stderr:
            self.stderr.append(line.rstrip())

    def _send(self, message):
        self.proc.stdin.write(json.dumps(message) + "\n")
        self.proc.stdin.flush()

    def request(self, method, params=None):
        mid = self._next_id
        self._next_id += 1
        self._send({"jsonrpc": "2.0", "id": mid, "method": method, "params": params or {}})
        while True:
            try:
                message = self.inbox.get(timeout=self.timeout)
            except queue.Empty:
                raise McpError("timed out waiting for %s%s" % (
                    method, ("; server stderr: " + " | ".join(self.stderr[-3:])) if self.stderr else ""))
            if message is None:
                raise McpError("the MCP server exited%s" % (
                    ("; stderr: " + " | ".join(self.stderr[-3:])) if self.stderr else ""))
            if message.get("id") != mid:
                continue                      # a notification or another reply
            if "error" in message:
                raise McpError(json.dumps(message["error"]))
            return message.get("result", {})

    def notify(self, method, params=None):
        self._send({"jsonrpc": "2.0", "method": method, "params": params or {}})

    # -- MCP surface --------------------------------------------------------
    def open_session(self):
        result = self.request("initialize", {
            "protocolVersion": PROTOCOL, "capabilities": {},
            "clientInfo": {"name": "ipss-agent-drawio-mcp", "version": "1.0"},
        })
        self.notify("notifications/initialized")
        return result.get("serverInfo", {})

    def call(self, tool, **arguments):
        result = self.request("tools/call", {"name": tool, "arguments": arguments})
        text = "\n".join(part.get("text", "") for part in result.get("content", []))
        if result.get("isError"):
            raise McpError(text.strip() or ("%s failed" % tool))
        return text

    def close(self):
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        self.proc.terminate()


# -- commands ----------------------------------------------------------------
def cmd_list(mcp, args):
    pages = json.loads(mcp.call("list_pages", path=args.file))
    for page in pages:
        print("[%s] %-28s %s  (%s bytes)" % (page.get("index"), page.get("id"),
                                             page.get("name"), page.get("approxSizeBytes")))
    return 0


def cmd_get(mcp, args):
    page = 0 if args.page is None else args.page
    xml = mcp.call("get_page", path=args.file, page=page)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(xml)
        print("wrote page %s of %s to %s (%d chars)" % (page, args.file, args.out, len(xml)))
    else:
        sys.stdout.write(xml if xml.endswith("\n") else xml + "\n")
    return 0


def cmd_set(mcp, args):
    if args.content == "-":
        content = sys.stdin.read()
    else:
        with open(args.content, encoding="utf-8") as fh:
            content = fh.read()
    print(mcp.call("set_page", path=args.file, page=args.page, content=content).strip())
    return 0


def cmd_open(mcp, args):
    page = 0 if args.page is None else args.page
    xml = mcp.call("get_page", path=args.file, page=page)
    call = {"content": xml}
    for flag, key in (("lightbox", "lightbox"), ("dark", "dark")):
        if getattr(args, flag):
            call[key] = True
    if args.post_layout:
        call["postLayout"] = args.post_layout
    print(mcp.call("open_drawio_xml", **call).strip())
    return 0


def cmd_shapes(mcp, args):
    print(mcp.call("search_shapes", query=args.query).strip())
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--node", default=os.environ.get("DRAWIO_MCP_NODE", "node"),
                    help="node binary (default: node on PATH, else /opt/homebrew/bin/node)")
    ap.add_argument("--server", default=DEFAULT_SERVER, help="path to @drawio/mcp src/index.js")
    ap.add_argument("--timeout", type=float, default=60.0)
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("list", help="list the pages of a .drawio file")
    p.add_argument("file")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("get", help="read one page's mxGraphModel XML")
    p.add_argument("file")
    p.add_argument("--page", type=int, default=None)
    p.add_argument("--out", help="write the XML here instead of stdout")
    p.set_defaults(func=cmd_get)

    p = sub.add_parser("set", help="replace one page's content")
    p.add_argument("file")
    p.add_argument("--page", type=int, default=0)
    p.add_argument("--content", required=True, help="XML file, or - for stdin")
    p.set_defaults(func=cmd_set)

    p = sub.add_parser("open", help="open the page in the draw.io editor (default browser)")
    p.add_argument("file")
    p.add_argument("--page", type=int, default=None)
    p.add_argument("--lightbox", action="store_true")
    p.add_argument("--dark", action="store_true")
    p.add_argument("--post-layout", choices=["elk"], default=None,
                   help="let the server re-place vertices with ELK (hierarchical diagrams only)")
    p.set_defaults(func=cmd_open)

    p = sub.add_parser("shapes", help="search the draw.io shape library")
    p.add_argument("query")
    p.set_defaults(func=cmd_shapes)

    args = ap.parse_args()
    node = args.node
    if node == "node":
        from shutil import which
        node = which("node") or "/opt/homebrew/bin/node"
    mcp = None
    try:
        mcp = DrawioMcp(node=node, server=args.server, timeout=args.timeout)
        info = mcp.open_session()
        if os.environ.get("DRAWIO_MCP_VERBOSE"):
            print("# connected to %s %s" % (info.get("name"), info.get("version")), file=sys.stderr)
        return args.func(mcp, args)
    except McpError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 1
    finally:
        if mcp is not None:
            mcp.close()


if __name__ == "__main__":
    sys.exit(main())
