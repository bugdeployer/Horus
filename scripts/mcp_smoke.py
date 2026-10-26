"""Real stdio protocol smoke test against an already running local API."""

import asyncio
import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


def payload(result):
    if result.isError:
        raise AssertionError(result.content)
    # FastMCP serializes list outputs as JSON text and dict outputs as structured data.
    if result.structuredContent:
        return result.structuredContent
    return json.loads(result.content[0].text)


async def main():
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "horus_workspace.mcp_server"],
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            assert len(tools.tools) == 7
            import subprocess

            fixture = subprocess.check_output(
                [sys.executable, "-m", "tests.support.capture_worker"],
                input=b"{}",
                cwd=params.cwd,
            )
            with urlopen(
                Request(
                    "http://127.0.0.1:8000/api/captures",
                    data=fixture,
                    headers={"Content-Type": "application/json"},
                ),
                timeout=10,
            ) as response:
                capture = json.load(response)
            graph = payload(
                await session.call_tool(
                    "application_map", {"capture_id": capture["id"]}
                )
            )
            assert graph["nodes"] and graph["edges"] and graph["capture_count"] == 1
            overview = payload(
                await session.call_tool(
                    "runtime_overview", {"capture_id": capture["id"]}
                )
            )
            assert overview["summary"]["trace_count"] == 3
            block = next(
                b for b in overview["blocks"] if b["name"].endswith("normalize_order")
            )
            inspected = payload(
                await session.call_tool(
                    "inspect_block",
                    {"capture_id": capture["id"], "block": block["name"]},
                )
            )
            assert inspected["total"] == 3
            rows = inspected["executions"]
            comparison = payload(
                await session.call_tool(
                    "compare_executions",
                    {
                        "capture_id": capture["id"],
                        "before": rows[0]["id"],
                        "after": rows[1]["id"],
                    },
                )
            )
            assert any(c["path"] == "$.output.currency" for c in comparison["changes"])
            trace = payload(
                await session.call_tool(
                    "read_trace",
                    {"capture_id": capture["id"], "trace_id": rows[1]["trace_id"]},
                )
            )
            assert any(
                e["kind"] == "invariant" and e["data"]["passed"] is False
                for e in trace["events"]
            )
            source = await session.call_tool(
                "read_runtime_source",
                {"capture_id": capture["id"], "source_id": block["source_id"]},
            )
            assert not source.isError
            invalid = await session.call_tool(
                "read_runtime_source",
                {"capture_id": capture["id"], "source_id": "../../.env"},
            )
            assert invalid.isError
            print(
                "MCP stdio smoke passed: runtime overview, block inspection, trace, comparison, saved source, boundary rejection."
            )


if __name__ == "__main__":
    asyncio.run(main())
