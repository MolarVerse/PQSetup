"""Serve the managed run's companion views under PQSetup's origin."""

import re

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from .managed_run import ManagedRun

_READ_API = {
    "viewer": {"health", "manifest", "initial-recipe"},
    "enalyzer": {"meta", "status", "run-progress", "parameters", "series",
                 "summary", "summaries", "histogram", "overlays", "events"},
}
_WRITE_API = {
    "viewer": {"refresh", "positions", "analysis/rdf"},
    "enalyzer": {"refresh"},
}


async def serve_run_app(
    managed: ManagedRun, request: Request, tool: str, stage: int, path: str,
    client: httpx.AsyncClient,
) -> Response:
    if tool not in _READ_API:
        raise HTTPException(404)
    endpoint = path.removeprefix("api/")
    if request.method == "POST":
        origin = request.headers.get("origin")
        if origin and origin != managed.portal_origin and origin != f"http://{request.headers['host']}":
            raise HTTPException(403)
        if request.headers.get("sec-fetch-site") not in {None, "same-origin"}:
            raise HTTPException(403)
        if not path.startswith("api/") or endpoint not in _WRITE_API[tool]:
            raise HTTPException(404)
    elif path.startswith("api/"):
        if endpoint not in _READ_API[tool] and not (
            tool == "viewer" and re.fullmatch(r"frames/\d+", endpoint)
        ):
            raise HTTPException(404)
    elif path and not re.fullmatch(r"(?:(?:assets|fonts)/)?[\w.-]+\.(?:js|css|woff2?|png|svg|ico)", path):
        raise HTTPException(404)

    url = await run_in_threadpool(managed.open_app, tool, stage)
    content = await request.body() if request.method == "POST" else None
    headers = {}
    if "content-type" in request.headers:
        headers["content-type"] = request.headers["content-type"]
    upstream = client.build_request(
        request.method, f"{url}/{path}", params=request.query_params,
        headers=headers, content=content,
    )
    try:
        result = await client.send(upstream, stream=True)
    except httpx.HTTPError as error:
        raise HTTPException(502, "Companion app is unavailable.") from error
    content_type = result.headers.get("content-type", "application/octet-stream")
    if not path and result.is_success:
        try:
            html = (await result.aread()).decode("utf-8")
        finally:
            await result.aclose()
        base = f"/run-app/{tool}/{stage}/"
        html = re.sub(r'(src|href)="/(?!/)', rf'\1="{base}', html)
        return Response(html, media_type="text/html", headers={"Cache-Control": "no-store"})
    return StreamingResponse(
        result.aiter_bytes(), status_code=result.status_code,
        media_type=content_type, background=BackgroundTask(result.aclose),
        headers={"Cache-Control": "no-store"},
    )
