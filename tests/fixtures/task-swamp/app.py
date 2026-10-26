import json, sqlite3, os, html
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path


# Instrumentation preserves request return values.
import sys, functools

sys.path.insert(
    0,
    os.environ.get(
        "HORUS_CHECKOUT",
        str(Path(__file__).resolve().parents[3] / "packages" / "sdk-python"),
    ),
)
from horus_sdk import Recorder, observe, checkpoint, expect


class _HorusValue:
    def __init__(self, value):
        self.value = value


def horus_step(operation, run):
    original = None

    @observe(name=operation)
    def execute():
        nonlocal original
        original = run()
        # Only built-in JSON values enter snapshots; bytes/HTML stay out.
        return (
            original
            if type(original) in (dict, list, tuple, str, int, float, bool, type(None))
            else {"bytes": len(original)}
            if type(original) is bytes
            else None
        )

    execute()
    return _HorusValue(original)


def horus_sql(sql, task_content=()):
    original = None

    @observe(name="sqlite.execute")
    def execute(sql, parameters):
        nonlocal original
        original = stuff.execute(sql, task_content)
        return {"rowcount": original.rowcount, "lastrowid": original.lastrowid}

    execute(sql, task_content)
    return _HorusValue(original)


@observe
def horus_verify_task(i, task_content):
    # Additional diagnostic read only. Its failures cannot affect the app.
    try:
        row = stuff.execute(
            "SELECT id,title,notes,priority,done FROM things WHERE id=?", (i,)
        ).fetchone()
        if row is None:
            return
        current = dict(zip(("id", "title", "notes", "priority", "done"), row))
        checkpoint("task", current)
        for key in ("title", "notes", "priority", "done"):
            if key in task_content:
                wanted = (
                    task_content[key].strip()
                    if key == "title" and isinstance(task_content[key], str)
                    else task_content[key]
                )
                expect(
                    "PUT applied supplied " + key,
                    current[key] == wanted,
                    actual=current[key],
                    expected=wanted,
                )
    except Exception:
        pass


def horus_request(fn):
    @functools.wraps(fn)
    def wrapped(self):
        recorder = Recorder(
            "task-swamp",
            label=self.command + " request",
            max_events=1000,
            max_value_bytes=4096,
            max_seconds=60,
            sample_rate=1.0,
            redaction=False,
            redact_keys=(
                "task_content",
                "title",
                "notes",
                "session",
                "credential",
                "csrf",
            ),
            endpoint=os.environ.get("HORUS_ENDPOINT", "http://127.0.0.1:8000"),
        )
        try:
            with recorder.trace("http.request", {"method": self.command}):
                return fn(self)
        finally:
            try:
                directory = Path(
                    os.environ.get(
                        "HORUS_CAPTURE_DIR",
                        str(
                            Path(__file__).resolve().parent.parent
                            / "artifacts"
                            / "task-swamp"
                            / "captures"
                        ),
                    )
                )
                if os.environ.get("HORUS_FILE_BACKUP", "1") != "0":
                    directory.mkdir(parents=True, exist_ok=True)
                    # The SDK delivers after trace completion; this backup is optional.
                    recorder.save(directory / (recorder.id + ".json"))
            except Exception:
                # Saving evidence must never replace a response or exception.
                pass

    return wrapped


# Shared connection used by the single-threaded test server.
THE_THING = Path(
    os.environ.get("TASK_SWAMP_DB", str(Path(__file__).with_name("swamp.sqlite3")))
)
stuff = sqlite3.connect(THE_THING)
stuff.execute(
    'CREATE TABLE IF NOT EXISTS things (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT DEFAULT "", priority TEXT DEFAULT "Normal", done INTEGER DEFAULT 0, created TEXT DEFAULT CURRENT_TIMESTAMP)'
)
stuff.commit()

PAGE = r"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Task Swamp</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f1e8;color:#243c30;font:16px system-ui,sans-serif}button,input,textarea,select{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #db692f;outline-offset:3px}header{border-bottom:1px solid #ccd0bd;padding:22px 5%;display:flex;justify-content:space-between;align-items:center}.brand{font-weight:850;letter-spacing:-1px;font-size:24px}.tag{font:12px monospace;text-transform:uppercase;letter-spacing:2px}main{max-width:1100px;margin:auto;padding:55px 24px}h1{font:clamp(42px,7vw,76px) Georgia,serif;letter-spacing:-3px;margin:12px 0}p{color:#657063;line-height:1.6}.hero{display:flex;justify-content:space-between;gap:24px;align-items:center;margin-bottom:40px}.stamp{border:1px solid #a5af93;border-radius:50%;width:130px;height:130px;display:grid;place-content:center;text-align:center;transform:rotate(9deg);flex-shrink:0;font:13px monospace}.stamp strong{font-size:34px}.layout{display:grid;grid-template-columns:300px 1fr;gap:28px}.panel{background:#e8ebdc;border:1px solid #d2d7c4;padding:24px;border-radius:8px;height:fit-content}h2{font:25px Georgia,serif;margin:0 0 22px}label{display:block;font-size:12px;font-weight:700;margin:18px 0 7px;text-transform:uppercase;letter-spacing:1px}input,textarea,select{width:100%;border:1px solid #bac3ad;border-radius:4px;background:#fafbf5;padding:11px;color:#243c30}textarea{resize:vertical;min-height:90px}.primary{background:#284b38;color:#fff;border:0;border-radius:4px;padding:12px 18px;font-weight:650}.wide{width:100%;margin-top:20px}.toolbar{display:flex;gap:10px;margin-bottom:18px}.toolbar input{flex:1;min-width:0}.toolbar select{width:145px}.task{border-top:1px solid #cbd0c0;padding:20px 0;display:flex;gap:14px}.check{width:24px;height:24px;flex-shrink:0;border:1px solid #9aa98d;border-radius:50%;background:transparent;color:#284b38;margin-top:3px}.task.done .check{background:#284b38;color:white}.task.done h3{text-decoration:line-through;color:#7a8576}.content{flex:1;min-width:0}h3{font-size:18px;margin:0 0 7px;overflow-wrap:anywhere}.notes{white-space:pre-wrap;margin:0;font-size:14px;overflow-wrap:anywhere}.meta{display:flex;gap:12px;align-items:center;margin-top:13px;font:11px monospace;color:#77816d}.pill{background:#e3e7d6;padding:4px 7px;border-radius:3px}.High{background:#f1d7c3;color:#9b491c}.actions{display:flex;gap:12px;margin-top:12px}.link{padding:0;border:0;background:transparent;color:#66765c;font-size:12px;text-decoration:underline}.empty{padding:45px 20px;text-align:center;border:1px dashed #bac3ad;border-radius:6px}footer{margin-top:50px;border-top:1px solid #cbd0c0;padding-top:18px;font:11px monospace;color:#79826f;display:flex;justify-content:space-between}#message{font-size:13px;min-height:20px;margin-top:10px;color:#99491f}@media(max-width:700px){main{padding-top:30px}.layout{grid-template-columns:1fr}.stamp{display:none}.hero{margin-bottom:25px}.tag{font-size:10px}footer{gap:20px}}
</style><header><div class="brand">✳ task swamp</div><span class="tag">a little order in the bog</span></header><main><div class="hero"><div><span class="tag">Your personal clearing</span><h1>Get it out of your head.</h1><p>Big plans. Small errands. That thing you keep forgetting.<br>Give it a home, then get it done.</p></div><div class="stamp"><strong id="count">0</strong>THINGS TO DO</div></div><div class="layout"><form class="panel" id="form"><h2 id="formtitle">Plant a task</h2><input type="hidden" id="identity"><label for="title">What needs doing?</label><input id="title" maxlength="200" required placeholder="Something worth finishing"><label for="notes">The details</label><textarea id="notes" maxlength="5000" placeholder="Leave yourself a little context…"></textarea><label for="priority">Priority</label><select id="priority"><option>Normal</option><option>High</option><option>Low</option></select><button class="primary wide" id="save">Add to the swamp ↗</button><button type="button" class="link" id="cancel" hidden style="margin-top:15px">Cancel editing</button><div id="message" role="status" aria-live="polite"></div></form><section aria-label="Your tasks"><div class="toolbar"><input id="search" aria-label="Search tasks" placeholder="Search your swamp…"><select id="filter" aria-label="Filter tasks"><option value="all">All tasks</option><option value="open">Still growing</option><option value="done">Completed</option></select></div><div id="list" aria-live="polite"></div></section></div><footer><span>LESS OVERTHINKING. MORE CHECKMARKS.</span><span>Rooted in SQLite · Saved on this computer</span></footer></main><script>
// shared mutable soup. please do not stir counterclockwise
var a=[],b={},c='all',q='',theMode=0;
function $(x){return document.getElementById(x)}
function safe(x){return String(x).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]))}
async function spaghetti(m,d){var r=await fetch('/api',{method:m,headers:{'Content-Type':'application/json'},body:d?JSON.stringify(d):undefined});var z=await r.json();if(!r.ok)throw Error(z.error||'Something went wrong');return z}
function paint(){ $('count').textContent=a.filter(t=>!t.done).length;var x=a.filter(t=>(c==='all'||(c==='done'?t.done:!t.done))&&(t.title+' '+t.notes).toLowerCase().includes(q));$('list').innerHTML=x.length?x.map(t=>`<article class="task ${t.done?'done':''}"><button class="check" data-do="toggle" data-id="${t.id}" aria-label="${t.done?'Reopen':'Complete'} ${safe(t.title)}">${t.done?'✓':''}</button><div class="content"><h3>${safe(t.title)}</h3>${t.notes?`<p class="notes">${safe(t.notes)}</p>`:''}<div class="meta"><span class="pill ${t.priority}">${t.priority}</span><span>${t.done?'FINISHED':'IN THE SWAMP'}</span></div><div class="actions"><button class="link" data-do="edit" data-id="${t.id}">Edit</button><button class="link" data-do="delete" data-id="${t.id}">Delete</button></div></div></article>`).join(''):`<div class="empty"><h2>${a.length?'Nothing in this clearing.':'A fresh patch of possibility.'}</h2><p>${a.length?'Try another search or filter.':'Add your first task. Small is a good place to start.'}</p></div>`}
async function reload(){a=await spaghetti('GET');paint()}
function reset(){ $('form').reset();$('identity').value='';$('formtitle').textContent='Plant a task';$('save').textContent='Add to the swamp ↗';$('cancel').hidden=true;theMode=0 }
$('form').onsubmit=async e=>{e.preventDefault();$('save').disabled=true;try{b={title:$('title').value,notes:$('notes').value,priority:$('priority').value};if(theMode)b.id=+$('identity').value;await spaghetti(theMode?'PUT':'POST',b);reset();await reload();$('message').textContent='Saved. One less thing to remember.'}catch(e){$('message').textContent=e.message}finally{$('save').disabled=false}};
$('list').onclick=async e=>{var z=e.target.closest('[data-do]');if(!z)return;var t=a.find(t=>t.id===+z.dataset.id);if(!t)return;try{if(z.dataset.do==='edit'){theMode=1;$('identity').value=t.id;['title','notes','priority'].forEach(k=>$(k).value=t[k]);$('formtitle').textContent='A little adjustment';$('save').textContent='Save changes ↗';$('cancel').hidden=false;$('title').focus();return}if(z.dataset.do==='delete'){if(!confirm('Delete this task permanently?'))return;await spaghetti('DELETE',{id:t.id});if(+$('identity').value===t.id)reset()}else{await spaghetti('PUT',{id:t.id,done:!t.done})}await reload()}catch(e){$('message').textContent=e.message}};
$('cancel').onclick=reset;$('search').oninput=e=>{q=e.target.value.toLowerCase();paint()};$('filter').onchange=e=>{c=e.target.value;paint()};reload().catch(e=>{$('message').textContent='Could not load tasks. '+e.message});
</script></html>"""


class Everything(BaseHTTPRequestHandler):
    def do_GET(self):
        self.the_whole_business()

    def do_POST(self):
        self.the_whole_business()

    def do_PUT(self):
        self.the_whole_business()

    def do_DELETE(self):
        self.the_whole_business()

    @horus_request
    @observe(state_fields=("command",), class_name="Everything")
    def the_whole_business(self):
        global stuff
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if self.path == "/":
            if self.command != "GET":
                return self.out(405, {"error": "Method not allowed"})
            raw = horus_step("response.html.encode", lambda: PAGE.encode()).value
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if self.path != "/api":
            return self.out(404, {"error": "Not found"})
        try:
            if self.command == "GET":
                checkpoint(
                    "sqlite.shared_state",
                    {
                        "row_factory": "Row"
                        if stuff.row_factory is sqlite3.Row
                        else None
                    },
                )
                horus_step(
                    "sqlite.shared_state.set",
                    lambda: setattr(stuff, "row_factory", sqlite3.Row),
                )
                checkpoint(
                    "sqlite.shared_state",
                    {
                        "row_factory": "Row"
                        if stuff.row_factory is sqlite3.Row
                        else None
                    },
                )
                return self.out(
                    200,
                    [
                        dict(x)
                        for x in horus_sql(
                            'SELECT * FROM things ORDER BY done, CASE priority WHEN "High" THEN 0 WHEN "Normal" THEN 1 ELSE 2 END, id DESC'
                        ).value
                    ],
                )
            n = horus_step(
                "request.length", lambda: int(self.headers.get("Content-Length", "0"))
            ).value
            if n > 30000:
                return self.out(413, {"error": "Too much swamp"})
            d = horus_step(
                "request.parse", lambda: json.loads(self.rfile.read(n))
            ).value
            if not isinstance(d, dict):
                raise ValueError("Expected an object")
            checkpoint(
                "request.payload",
                {
                    k: d[k]
                    for k in ("id", "title", "notes", "priority", "done")
                    if k in d
                },
            )
            if self.command in ("PUT", "DELETE"):
                i = horus_step("business.task_id", lambda: int(d.get("id", 0))).value
                checkpoint(
                    "task",
                    {
                        "id": i,
                        **{
                            k: d[k]
                            for k in ("title", "notes", "priority", "done")
                            if k in d
                        },
                    },
                )
                if not horus_sql(
                    "SELECT id FROM things WHERE id=?", (i,)
                ).value.fetchone():
                    return self.out(404, {"error": "Task not found"})
            if self.command == "DELETE":
                horus_sql("DELETE FROM things WHERE id=?", (i,))
            elif self.command == "PUT":
                updates = {}
                allowed = ("title", "notes", "priority", "done")
                for key in allowed:
                    if key not in d:
                        continue
                    value = d[key]
                    if key == "title":
                        if (
                            not isinstance(value, str)
                            or not value.strip()
                            or len(value) > 200
                        ):
                            raise ValueError("Invalid title")
                        value = value.strip()
                    if key == "notes" and (
                        not isinstance(value, str) or len(value) > 5000
                    ):
                        raise ValueError("Invalid notes")
                    if key == "priority" and value not in ("Normal", "High", "Low"):
                        raise ValueError("Invalid priority")
                    if key == "done":
                        if not isinstance(value, bool):
                            raise ValueError("Invalid completion state")
                        value = int(value)
                    updates[key] = value
                checkpoint("task.update", {"id": i, "updates": updates})
                if not updates:
                    raise ValueError("No fields supplied")
                horus_sql(
                    "UPDATE things SET "
                    + ",".join(key + "=?" for key in updates)
                    + " WHERE id=?",
                    tuple(updates.values()) + (i,),
                )
            else:
                t = d.get("title", "")
                notes = d.get("notes", "")
                p = d.get("priority", "Normal")
                if not isinstance(t, str) or not t.strip() or len(t) > 200:
                    raise ValueError("Task title must be 1–200 characters")
                if not isinstance(notes, str) or len(notes) > 5000:
                    raise ValueError("Notes must be under 5,000 characters")
                if p not in ("Normal", "High", "Low"):
                    raise ValueError("Invalid priority")
                if self.command == "POST":
                    horus_sql(
                        "INSERT INTO things(title,notes,priority) VALUES(?,?,?)",
                        (t.strip(), notes, p),
                    )
                else:
                    horus_sql(
                        "UPDATE things SET title=?,notes=?,priority=? WHERE id=?",
                        (t.strip(), notes, p, i),
                    )
            horus_step("sqlite.commit", lambda: stuff.commit())
            if self.command == "PUT":
                horus_verify_task(i, d)
            self.out(200, {"ok": True})
        except (ValueError, TypeError):
            self.out(400, {"error": "Invalid task data. Check your fields."})
        except sqlite3.Error:
            horus_step("sqlite.rollback", lambda: stuff.rollback())
            self.out(500, {"error": "The database could not save that change."})

    def out(self, n, d):
        checkpoint("response.payload", {"status": n, "payload": d})
        if self.command == "GET" and self.path == "/api":
            checkpoint("database.rows", d)
        raw = horus_step("response.json.encode", lambda: json.dumps(d).encode()).value
        checkpoint("response", {"status": n, "bytes": len(raw)})
        self.send_response(n)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)


if __name__ == "__main__":
    print("Task Swamp: http://127.0.0.1:8765", flush=True)
    HTTPServer(
        ("127.0.0.1", int(os.environ.get("PORT", "8765"))), Everything
    ).serve_forever()
