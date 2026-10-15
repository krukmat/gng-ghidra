#!/usr/bin/env python3
"""Build a local, explicit visual-progress review page.

The page is NOT evidence that the game runs. Code statuses are copied from
docs/visual-milestones.json. Optional private screenshots in ignored out/
are merely attached to cards; their existence never implies acceptance.
"""
from __future__ import annotations
import argparse
import base64
import html
import json
import mimetypes
from pathlib import Path

VALID_STATUS={"READY_FOR_LOCAL_REVIEW","PLANNED","BLOCKED","ACCEPTED"}
MAX_IMAGE_BYTES=8*1024*1024

def safe(text: object) -> str:
    return html.escape(str(text),quote=True)

def image_html(image: Path, label: str) -> str:
    if not image.is_file():
        return ('<div class="empty">Sin captura local: ' + safe(label) +
                '<span>Cuando exista, se mostrará aquí.</span></div>')
    if image.suffix.lower() not in {".png",".jpg",".jpeg",".webp"}:
        raise ValueError("Only png/jpg/webp visual evidence is supported")
    content=image.read_bytes()
    if len(content)>MAX_IMAGE_BYTES:
        raise ValueError("Screenshot too large (>8 MiB): "+str(image))
    mime=mimetypes.guess_type(image.name)[0]
    if mime not in {"image/png","image/jpeg","image/webp"}:
        raise ValueError("Invalid screenshot content type")
    data=base64.b64encode(content).decode("ascii")
    return '<img alt="'+safe(label)+'" src="data:'+mime+';base64,'+data+'">'

def render(milestones:dict, evidence_dir:Path) -> str:
    if milestones.get("schema")!="gng.visual-progress.v1":
        raise ValueError("Unexpected visual milestone schema")
    items=milestones.get("milestones")
    if not isinstance(items,list) or not items:
        raise ValueError("No visual milestones found")
    ids=[x["id"] for x in items]
    if len(set(ids))!=len(ids):
        raise ValueError("Duplicate milestone ID")
    cards=[]
    counts={status:0 for status in VALID_STATUS}
    for item in items:
        status=item.get("status")
        if status not in VALID_STATUS:
            raise ValueError("Unsupported milestone status: "+str(status))
        counts[status]+=1
        ident=item["id"]
        if not isinstance(ident,str) or not ident or any(
            x not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789." for x in ident):
            raise ValueError("Unsafe milestone identifier")
        deps=item.get("dependencies",[])
        if not isinstance(deps,list) or any(d not in ids or d==ident for d in deps):
            raise ValueError("Unresolved milestone dependencies: "+ident)
        photos=[]
        for slot in item.get("screenshots",[]):
            if slot not in {"before","after"}:
                raise ValueError("Unsupported screenshot slot")
            label=("ANTES" if slot=="before" else "DESPUÉS")
            folder=evidence_dir/ident.lower()
            file=next((p for suffix in (".png",".jpg",".jpeg",".webp")
                       if (p:=folder/(slot+suffix)).is_file()),
                      folder/(slot+".png"))
            photos.append('<div class="photo"><h4>'+label+'</h4>'+
                          image_html(file,ident+" "+label)+'</div>')
        status_label=milestones["statuses"].get(status,status)
        cards.append('''<section class="card"><div class="top"><span class="id">'''+
            safe(ident)+'''</span><span class="status '''+safe(status.lower())+
            '''">'''+safe(status_label)+'''</span></div>
            <h2>'''+safe(item["title"])+'''</h2>
            <div class="stage">'''+safe(item["stage"])+'''</div>
            <p>'''+safe(item["visible"])+'''</p>
            <p class="accept"><strong>Criterio de aceptación:</strong> '''+
            safe(item["acceptance"])+'''</p>
            <p class="next"><strong>Próxima tarea:</strong> '''+
            safe(item["next"])+'''</p><div class="images">'''+
            ''.join(photos)+'''</div>
            <div class="artifact"><strong>Archivo objetivo:</strong> <code>'''+
            safe(item["deliverable"])+'''</code></div></section>''')
    summary=(
        f'{counts["ACCEPTED"]} aceptados visualmente · '
        f'{counts["READY_FOR_LOCAL_REVIEW"]} pendientes de revisar localmente · '
        f'{counts["PLANNED"]} planificados · {counts["BLOCKED"]} bloqueados'
    )
    return '''<!doctype html><html lang="es"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>GnG — Evolución visual verificable</title>
    <style>
    :root{color-scheme:dark;background:#0b1220;color:#eaf0fb;font-family:system-ui,-apple-system,sans-serif}
    *{box-sizing:border-box}body{margin:0}main{margin:auto;max-width:1120px;padding:28px 16px 60px}
    h1{font-size:clamp(26px,5vw,40px);margin:8px 0}
    .lead{color:#bcc9df;line-height:1.6;max-width:830px}
    .summary{background:#1b2b41;padding:14px 18px;border:1px solid #405270;border-radius:10px;margin:20px 0}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
    .card{background:#121e31;border:1px solid #32435b;border-radius:14px;padding:20px;min-width:0}
    .top{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
    .id{font:700 15px ui-monospace,monospace;color:#8fdfd0}.status{font-size:11px;color:#b6c6dd;background:#26354a;padding:5px 8px;border-radius:7px}
    .status.accepted{color:#88f4b0}.status.blocked{color:#f0ba8a}.card h2{margin:12px 0 5px;font-size:19px}
    .stage{font-size:11px;color:#86bccb;letter-spacing:.08em;font-weight:700}
    .card p{line-height:1.55;color:#c3d2e6;font-size:14px}
    .accept{border-left:2px solid #5679ad;padding-left:10px}
    .next{border-left:2px solid #668c82;padding-left:10px}
    .images{display:flex;flex-wrap:wrap;gap:10px;margin-top:15px}
    .photo{flex:1 1 140px;min-width:0}
    .photo h4{font-size:11px;letter-spacing:.08em;color:#92a7c4;margin:0 0 6px}
    .photo img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#060b14;border:1px solid #374962;border-radius:7px;image-rendering:pixelated}
    .empty{border:1px dashed #456077;background:#101a2c;border-radius:7px;aspect-ratio:4/3;padding:15px;display:flex;flex-direction:column;justify-content:center;color:#a6b6cc;font-size:12px}
    .empty span{color:#7b90ae;margin-top:8px}.artifact{margin-top:15px;font-size:12px;color:#9db0c8;overflow-wrap:anywhere}
    code{color:#dce9ff}.footer{font-size:12px;line-height:1.6;color:#91a5c1;margin-top:24px}
    </style></head><body><main><div class="id">GNG · MAIN · VISUAL DELIVERY</div>
    <h1>Avance visible, no solo tests</h1>
    <p class="lead">Cada bloque termina con algo observable y una comparación antes/después cuando existe. Las capturas locales pueden añadirse sin publicar la ROM. Ningún estado se convierte en «Aceptado» por el simple hecho de tener una imagen o por pasar CI.</p>
    <div class="summary">'''+safe(summary)+'''</div><div class="grid">'''+''.join(cards)+'''</div>
    <div class="footer">Sin capturas no hay comparación visual. Las fases ROM GRAPHICS y VRAM FIXTURE NO representan gameplay. Los primeros frames de ROM traducida deben etiquetarse por separado. No subir este HTML si contiene capturas privadas o material derivado de ROM.</div></main></body></html>'''

def build(manifest:Path, evidence:Path, output:Path) -> dict:
    data=json.loads(manifest.read_text(encoding="utf-8"))
    generated=render(data,evidence)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(generated,encoding="utf-8")
    attached=sum(
        (evidence/item["id"].lower()/f"{slot}{suffix}").is_file()
        for item in data["milestones"]
        for slot in item.get("screenshots",[])
        for suffix in (".png",".jpg",".jpeg",".webp"))
    return {"output":str(output),
            "milestones":len(data["milestones"]),
            "local_screenshots":attached,
            "accepted":sum(x["status"]=="ACCEPTED" for x in data["milestones"])}

def main() -> None:
    base=Path(__file__).resolve().parents[1]
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest",type=Path,default=base/"docs/visual-milestones.json")
    ap.add_argument("--evidence",type=Path,default=base/"out/visual-evidence")
    ap.add_argument("--out",type=Path,default=base/"out/visual-progress.html")
    args=ap.parse_args()
    result=build(args.manifest,args.evidence,args.out)
    print("GNG_VISUAL_PROGRESS=GENERATED milestones="+str(result["milestones"])+
          " accepted="+str(result["accepted"])+
          " screenshots="+str(result["local_screenshots"]))
    print("GNG_VISUAL_PROGRESS_HTML="+result["output"])
    print("GNG_GAMEPLAY=NOT_ESTABLISHED status comes from roadmap, not screenshot detection")

if __name__=="__main__":
    main()
