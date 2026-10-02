from __future__ import annotations

from pathlib import Path
import json
import os
import threading
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Comuro Route Editor")
ROUTES_FILE = Path(os.environ.get("COMURO_ROUTES_FILE", "/share/comuro/routes.json"))
LOCK = threading.Lock()

class RoutePayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    coordinates: list[list[float]] = Field(min_length=2)
    buffer_m: int = Field(default=30, ge=0, le=500)
    enabled: bool = True

def load_routes() -> list[dict]:
    if not ROUTES_FILE.exists():
        return []
    try:
        payload = json.loads(ROUTES_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        raise HTTPException(500, f"Routendatei kann nicht gelesen werden: {err}") from err
    if isinstance(payload, dict):
        routes = payload.get("routes", [])
    elif isinstance(payload, list):
        routes = payload
    else:
        raise HTTPException(500, "Ungültiges Format der Routendatei.")
    return [route for route in routes if isinstance(route, dict)]

def save_routes(routes: list[dict]) -> None:
    ROUTES_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": 1, "routes": routes}
    temp = ROUTES_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(ROUTES_FILE)

@app.get("/api/routes")
def api_routes():
    with LOCK:
        return load_routes()

@app.post("/api/routes")
def api_create_route(payload: RoutePayload):
    route = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "coordinates": payload.coordinates,
        "buffer_m": payload.buffer_m,
        "enabled": payload.enabled,
    }
    if not route["name"]:
        raise HTTPException(400, "Bitte einen Routennamen angeben.")
    with LOCK:
        routes = load_routes()
        routes.append(route)
        save_routes(routes)
    return route

@app.delete("/api/routes/{route_id}")
def api_delete_route(route_id: str):
    with LOCK:
        routes = load_routes()
        new_routes = [route for route in routes if route.get("id") != route_id]
        if len(new_routes) == len(routes):
            raise HTTPException(404, "Route nicht gefunden.")
        save_routes(new_routes)
    return {"success": True}

@app.get("/", response_class=HTMLResponse)
def index():
    return HTML

HTML = r'''
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comuro – Route Editor</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
html,body,#map{height:100%;margin:0;font-family:system-ui,sans-serif}
#map{background:#ddd}
.panel{position:absolute;z-index:1000;top:12px;left:12px;width:370px;max-height:calc(100vh - 24px);overflow-y:auto;background:white;padding:14px;border-radius:12px;box-shadow:0 3px 18px #0004}
button,input{padding:7px;margin:3px}
button{cursor:pointer}
.route-row{padding:9px 4px;border-bottom:1px solid #ddd}
.route-row.active{background:#eef5ff}
.route-actions{float:right}
.section{margin-top:14px;border-top:1px solid #ddd;padding-top:10px}
.small{color:#666;font-size:.85em}
</style>
</head>
<body>
<div id="map"></div>
<div class="panel">
<h3>🚗 Comuro</h3>
<div class="section"><b>Meine Routen</b><div id="routes">Lade…</div>
<button onclick="newRoute()">✏️ Neue Route</button></div>
<div id="editor" class="section" style="display:none">
<b>Route zeichnen</b><br>
<input id="routeName" placeholder="z.B. Arbeitsweg" maxlength="100" style="width:240px"><br>
Puffer: <input id="buffer" type="number" value="30" min="0" max="500"> Meter<br>
<button onclick="finishRoute()">💾 Speichern</button>
<button onclick="undoPoint()">↩ Punkt zurück</button>
<button onclick="cancelDrawing()">✖ Abbrechen</button>
<p class="small">Klicke Punkt für Punkt entlang der gewünschten Strecke.</p>
</div>
<div id="status" class="section">Keine Route ausgewählt.</div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const map=L.map('map').setView([51.5136,7.4653],12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap-Mitwirkende'}).addTo(map);
let routes=[];let selectedRoute=null;let drawing=false;let points=[];let routeLine=null;
function status(text){document.getElementById('status').innerText=text;}
async function loadRoutes(){const response=await fetch('/api/routes');routes=await response.json();renderRoutes();}
function renderRoutes(){const c=document.getElementById('routes');if(!routes.length){c.innerHTML='<i>Noch keine Route gespeichert.</i>';return;}c.innerHTML='';routes.forEach(route=>{const row=document.createElement('div');row.className='route-row'+(selectedRoute&&selectedRoute.id===route.id?' active':'');row.innerHTML='<b>'+escapeHtml(route.name)+'</b> <span class="route-actions"><button onclick="selectRoute(\''+route.id+'\')">Anzeigen</button> <button onclick="deleteRoute(\''+route.id+'\')">🗑</button></span>';c.appendChild(row);});}
function selectRoute(id){const route=routes.find(r=>r.id===id);if(!route)return;selectedRoute=route;drawing=false;points=route.coordinates.map(p=>[p[1],p[0]]);redrawRoute();renderRoutes();if(routeLine)map.fitBounds(routeLine.getBounds(),{padding:[40,40]});status('Route "'+route.name+'" ausgewählt.');}
function newRoute(){drawing=true;points=[];selectedRoute=null;if(routeLine){map.removeLayer(routeLine);routeLine=null;}document.getElementById('editor').style.display='block';document.getElementById('routeName').value='';document.getElementById('buffer').value='30';map.getContainer().style.cursor='crosshair';renderRoutes();status('Zeichenmodus aktiv.');}
map.on('click',event=>{if(!drawing)return;points.push([event.latlng.lat,event.latlng.lng]);redrawRoute();});
function redrawRoute(){if(routeLine)map.removeLayer(routeLine);if(points.length>=2)routeLine=L.polyline(points,{color:'#1976d2',weight:6}).addTo(map);}
function undoPoint(){if(!drawing)return;points.pop();redrawRoute();}
function cancelDrawing(){drawing=false;points=[];if(routeLine){map.removeLayer(routeLine);routeLine=null;}document.getElementById('editor').style.display='none';map.getContainer().style.cursor='';status('Zeichnen abgebrochen.');}
async function finishRoute(){if(points.length<2){alert('Bitte mindestens zwei Punkte setzen.');return;}const name=document.getElementById('routeName').value.trim();if(!name){alert('Bitte einen Routennamen vergeben.');return;}const buffer=Number(document.getElementById('buffer').value);const coordinates=points.map(p=>[p[1],p[0]]);const response=await fetch('/api/routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,coordinates,buffer_m:buffer,enabled:true})});if(!response.ok){const error=await response.json();alert(error.detail||'Route konnte nicht gespeichert werden.');return;}const route=await response.json();routes.push(route);selectedRoute=route;drawing=false;document.getElementById('editor').style.display='none';map.getContainer().style.cursor='';renderRoutes();status('Route "'+route.name+'" gespeichert.');}
async function deleteRoute(id){const route=routes.find(r=>r.id===id);if(!route)return;if(!confirm('Route "'+route.name+'" wirklich löschen?'))return;const response=await fetch('/api/routes/'+id,{method:'DELETE'});if(!response.ok){alert('Route konnte nicht gelöscht werden.');return;}routes=routes.filter(r=>r.id!==id);if(selectedRoute&&selectedRoute.id===id){selectedRoute=null;if(routeLine){map.removeLayer(routeLine);routeLine=null;}}renderRoutes();status('Route gelöscht.');}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c]);}
loadRoutes();
</script>
</body>
</html>
'''